"use client";

export interface AuthSession {
  access_token: string;
  refresh_token: string;
  expires_at: number;
  user: { id: string; email?: string };
}

const SESSION_KEY = "freefloorplan3d:commercial-session:v1";
const RECOVERY_KEY = "freefloorplan3d:password-recovery:v1";
export const AUTH_SESSION_CHANGED = "freefloorplan3d:auth-session-changed";
let refreshInFlight: Promise<AuthSession | null> | null = null;
let sessionChannel: BroadcastChannel | null = null;
let sessionRequest: Promise<void> | null = null;
let pendingSessionRequestId: string | null = null;
let sessionRevision = 0;
let canRequestSessionFromTabs = true;
let authRedirectInFlight: Promise<"recovery" | "session" | null> | null = null;

// Share only between live same-origin tabs. Tokens remain in sessionStorage,
// never in URLs, localStorage, or an opener on the external billing page.
function connectSessionTabs() {
  if (sessionChannel || typeof window === "undefined" || !window.BroadcastChannel) return;
  sessionChannel = new window.BroadcastChannel("freefloorplan3d:account-tabs:v1");
  sessionChannel.onmessage = event => {
    if (event.data?.type === "request") {
      const session = readStoredSession();
      if (session) sessionChannel?.postMessage({ type: "response", requestId: event.data.requestId, session });
    } else if (event.data?.type === "changed" || (event.data?.type === "response" && event.data.requestId === pendingSessionRequestId)) {
      const session = event.data.session;
      if (session === null && event.data.type === "changed") { pendingSessionRequestId = null; saveSession(null, false); }
      else if (session && typeof session.access_token === "string" && typeof session.refresh_token === "string" &&
        Number.isFinite(session.expires_at) && typeof session.user?.id === "string") saveSession(session, false);
    }
  };
}

async function requestSessionFromOpenTabs() {
  connectSessionTabs();
  if (!sessionChannel || !canRequestSessionFromTabs || readStoredSession()) return;
  sessionRequest ??= new Promise<void>(resolve => {
    const requestId = crypto.randomUUID();
    pendingSessionRequestId = requestId;
    const finish = () => { pendingSessionRequestId = null; sessionChannel?.removeEventListener("message", receive); resolve(); };
    const receive = (event: MessageEvent) => {
      if (event.data?.type === "response" && event.data.requestId === requestId) { clearTimeout(timer); finish(); }
    };
    // A background tab can have timers throttled to one second.
    const timer = setTimeout(finish, 1500);
    sessionChannel!.addEventListener("message", receive);
    sessionChannel!.postMessage({ type: "request", requestId });
  }).finally(() => { sessionRequest = null; });
  await sessionRequest;
}

export class AuthRequestError extends Error {
  constructor(message: string, readonly status: number, readonly code?: string) {
    super(message);
  }
}

function configuration() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim().replace(/\/$/, "");
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY?.trim();
  if (!url || !key) throw new Error("Account access is not configured yet.");
  return { url, key };
}

export function isAuthConfigured(): boolean {
  try { configuration(); return true; } catch { return false; }
}

function saveSession(session: AuthSession | null, broadcast = true) {
  if (typeof window === "undefined") return;
  sessionRevision++;
  canRequestSessionFromTabs = session !== null;
  if (!session) pendingSessionRequestId = null;
  if (session) sessionStorage.setItem(SESSION_KEY, JSON.stringify(session));
  else { sessionStorage.removeItem(SESSION_KEY); sessionStorage.removeItem(RECOVERY_KEY); }
  connectSessionTabs();
  if (broadcast) sessionChannel?.postMessage({ type: "changed", session });
  window.dispatchEvent(new Event(AUTH_SESSION_CHANGED));
}

function readStoredSession(): AuthSession | null {
  if (typeof window === "undefined") return null;
  try {
    const value = JSON.parse(sessionStorage.getItem(SESSION_KEY) ?? "null") as Partial<AuthSession> | null;
    if (!value || typeof value.access_token !== "string" || typeof value.refresh_token !== "string" ||
        typeof value.expires_at !== "number" || typeof value.user?.id !== "string") return null;
    return value as AuthSession;
  } catch {
    saveSession(null);
    return null;
  }
}

async function authRequest<T>(path: string, body?: unknown, accessToken?: string, method = body === undefined ? "GET" : "POST"): Promise<T> {
  const { key } = configuration();
  const base = process.env.NEXT_PUBLIC_BASE_PATH ?? "";
  if (typeof window !== "undefined" && window.location?.origin) {
    const origin = new URL(window.location.origin);
    const loopback = ["localhost", "127.0.0.1", "[::1]"].includes(origin.hostname);
    if (origin.protocol !== "https:" && !(origin.protocol === "http:" && loopback)) {
      throw new Error("For secure account access, use HTTPS or open this app at http://localhost:3000 on this computer.");
    }
  }
  try {
    // Never retry password/sign-up/refresh requests automatically: the provider
    // may have accepted a request even when its response could not be read.
    const response = await fetch(`${base}/auth-api/${path}`, {
      signal: AbortSignal.timeout(20_000), method,
      cache: "no-store", credentials: "omit", redirect: "error", referrerPolicy: "no-referrer",
      headers: { apikey: key, ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}), ...(body === undefined ? {} : { "Content-Type": "application/json" }) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const value: unknown = response.status === 204 ? {} : await response.json().catch(() => null);
    const result = value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
    if (!response.ok) {
      const known = result && [result.msg, result.message, result.error_description].find(value => typeof value === "string");
      const code = typeof result?.error_code === "string" ? result.error_code : undefined;
      const message = code === "email_not_confirmed" ? "This account needs email verification. Use Resend verification email below, then open the newest link."
        : code === "email_address_not_authorized" ? "Email delivery is not configured for this address. Please contact support; repeated requests will not help."
        : code === "over_email_send_rate_limit" ? "The email sending limit has been reached. Please wait before requesting another verification or reset email."
        : response.status === 429 ? "Too many account requests. Please wait a little before trying again."
        : response.status >= 500 ? "Account services are temporarily unavailable. Please try again in a moment."
        : typeof known === "string" ? known.slice(0, 240) : "The account request could not be completed. Please try again.";
      throw new AuthRequestError(message, response.status, code);
    }
    if (!result) throw new AuthRequestError("The account service returned an unexpected response. Please try again.", 502);
    return result as T;
  } catch (error) {
    if (error instanceof AuthRequestError) throw error;
    if (typeof navigator !== "undefined" && navigator.onLine === false) throw new Error("You are offline. Reconnect to the internet, then try again.");
    if (error instanceof Error && ["TimeoutError", "AbortError"].includes(error.name)) throw new Error("The account request timed out. Please try again. If you were creating an account, check your email first.");
    throw new Error("Cannot reach account services. Check your connection and try again. If you were creating an account, check your email first.");
  }
}

function normalizeSession(value: Record<string, unknown>): AuthSession | null {
  const user = value.user as AuthSession["user"] | undefined;
  if (typeof value.access_token !== "string" || typeof value.refresh_token !== "string" || !user || typeof user.id !== "string") return null;
  const expiresIn = typeof value.expires_in === "number" ? value.expires_in : 3600;
  return { access_token: value.access_token, refresh_token: value.refresh_token, expires_at: Math.floor(Date.now() / 1000) + expiresIn, user };
}

export async function currentSession(): Promise<AuthSession | null> {
  await requestSessionFromOpenTabs();
  const session = readStoredSession();
  if (!session) return null;
  if (session.expires_at > Math.floor(Date.now() / 1000) + 60) return session;
  if (!refreshInFlight) {
    const revision = sessionRevision;
    refreshInFlight = authRequest<Record<string, unknown>>("token?grant_type=refresh_token", { refresh_token: session.refresh_token })
      .then((result) => {
        // Signing out in either tab must not be undone by an older network response.
        if (revision !== sessionRevision) return readStoredSession();
        const updated = normalizeSession(result); saveSession(updated); return updated;
      })
      .catch((error) => {
        if (revision !== sessionRevision) return readStoredSession();
        if (error instanceof AuthRequestError && [400, 401, 403].includes(error.status)) {
          saveSession(null);
          return null;
        }
        throw error;
      })
      .finally(() => { refreshInFlight = null; });
  }
  return refreshInFlight;
}

export async function signIn(email: string, password: string): Promise<AuthSession> {
  const result = await authRequest<Record<string, unknown>>("token?grant_type=password", { email: email.trim(), password });
  const session = normalizeSession(result);
  if (!session) throw new Error("Sign-in did not return a valid session.");
  sessionStorage.removeItem(RECOVERY_KEY);
  saveSession(session);
  return session;
}

export async function signUp(email: string, password: string): Promise<AuthSession | null> {
  const result = await authRequest<Record<string, unknown>>("signup?redirect_to=" + encodeURIComponent(accountRedirect()), { email: email.trim(), password });
  const session = normalizeSession(result);
  const user = result.user && typeof result.user === "object" ? result.user as Record<string, unknown> : result;
  if (!session && (typeof user.id !== "string" || !user.id)) throw new Error("The account service returned an unexpected response. Please try again.");
  sessionStorage.removeItem(RECOVERY_KEY);
  saveSession(session);
  return session;
}

export async function resendVerificationEmail(email: string): Promise<void> {
  await authRequest("resend?redirect_to=" + encodeURIComponent(accountRedirect()), { type: "signup", email: email.trim() });
}

function accountRedirect() {
  // Local development may share production accounts without allowing loopback
  // redirects on the production project. Email links then return to its approved
  // HTTPS account page; the user can sign in locally after verifying there.
  const configured = process.env.NEXT_PUBLIC_AUTH_REDIRECT_URL?.trim();
  if (configured) {
    const url = new URL(configured);
    if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash || !url.pathname.endsWith("/account/")) {
      throw new Error("The account email return address is not configured correctly.");
    }
    return url.href;
  }
  const base = process.env.NEXT_PUBLIC_BASE_PATH ?? "";
  return `${window.location.origin}${base}/account/`;
}

export async function sendMagicLink(email: string): Promise<void> {
  await authRequest("otp?redirect_to=" + encodeURIComponent(accountRedirect()), { email: email.trim(), create_user: true });
}

export async function sendPasswordReset(email: string): Promise<void> {
  await authRequest("recover?redirect_to=" + encodeURIComponent(accountRedirect()), { email: email.trim() });
}

export async function updatePassword(password: string, expectedUserId?: string): Promise<void> {
  const session = await currentSession();
  if (!session) throw new AuthRequestError("The password reset link has expired. Request a new one.", 401, "recovery_link_invalid");
  if (expectedUserId && session.user.id !== expectedUserId) throw new AuthRequestError("The signed-in account changed. Open a new password reset link for the intended account.", 401, "recovery_link_invalid");
  try { await authRequest("user", { password }, session.access_token, "PUT"); }
  catch (error) {
    if (error instanceof AuthRequestError && [401, 403].includes(error.status)) {
      sessionStorage.removeItem(RECOVERY_KEY);
      throw new AuthRequestError("The password reset session has expired. Request a new password reset link below.", error.status, "recovery_link_invalid");
    }
    throw error;
  }
  sessionStorage.removeItem(RECOVERY_KEY);
}

export async function signOut(): Promise<void> {
  const session = readStoredSession();
  saveSession(null);
  if (!session) return;
  try { await authRequest("logout", {}, session.access_token); } catch { /* local sign-out must still complete */ }
}

export async function acceptAuthRedirect(): Promise<"recovery" | "session" | null> {
  // Strict Mode can initialize twice while the first lookup is pending. Consume
  // the link once and retain reset intent locally after its URL is cleaned.
  if (!authRedirectInFlight) authRedirectInFlight = consumeAuthRedirect().finally(() => { authRedirectInFlight = null; });
  return authRedirectInFlight;
}

async function consumeAuthRedirect(): Promise<"recovery" | "session" | null> {
  if (typeof window === "undefined") return null;
  if (!window.location.hash) {
    try {
      const marker = JSON.parse(sessionStorage.getItem(RECOVERY_KEY) ?? "null") as { userId?: string; expiresAt?: number } | null;
      const session = readStoredSession();
      if (marker && session && marker.userId === session.user.id && typeof marker.expiresAt === "number" && marker.expiresAt > Date.now() / 1000) return "recovery";
      sessionStorage.removeItem(RECOVERY_KEY);
    } catch { sessionStorage.removeItem(RECOVERY_KEY); }
    return null;
  }
  const values = new URLSearchParams(window.location.hash.slice(1));
  const clearHash = () => window.history.replaceState(null, "", `${window.location.pathname}${window.location.search}`);
  if (values.has("error") || values.has("error_code")) {
    clearHash(); sessionStorage.removeItem(RECOVERY_KEY);
    throw new AuthRequestError("This email link has expired or has already been used. Request a new password reset link below.", 400, "recovery_link_invalid");
  }
  const type = values.get("type");
  const accessToken = values.get("access_token");
  const refreshToken = values.get("refresh_token");
  if (!accessToken || !refreshToken) {
    if (type === "recovery") {
      clearHash(); sessionStorage.removeItem(RECOVERY_KEY);
      throw new AuthRequestError("This reset link is incomplete. Request a new password reset link below.", 400, "recovery_link_invalid");
    }
    return null;
  }
  let user: AuthSession["user"];
  const revision = sessionRevision;
  try { user = await authRequest<AuthSession["user"]>("user", undefined, accessToken); }
  catch (error) {
    if (error instanceof AuthRequestError && [400, 401, 403].includes(error.status)) {
      clearHash(); sessionStorage.removeItem(RECOVERY_KEY);
      throw new AuthRequestError("This email link has expired or has already been used. Request a new password reset link below.", error.status, "recovery_link_invalid");
    }
    throw error;
  }
  const expiresIn = Number(values.get("expires_in") ?? 3600);
  if (!Number.isFinite(expiresIn) || expiresIn <= 0 || expiresIn > 86400 || revision !== sessionRevision) {
    clearHash(); sessionStorage.removeItem(RECOVERY_KEY);
    throw new AuthRequestError("This reset link is invalid or the account session changed. Request a new password reset link below.", 400, "recovery_link_invalid");
  }
  const session = normalizeSession({ access_token: accessToken, refresh_token: refreshToken, expires_in: expiresIn, user });
  if (!session) throw new AuthRequestError("This email link could not be verified. Request a new password reset link below.", 400, "recovery_link_invalid");
  if (type === "recovery") sessionStorage.setItem(RECOVERY_KEY, JSON.stringify({ userId: session.user.id, expiresAt: session.expires_at }));
  else sessionStorage.removeItem(RECOVERY_KEY);
  saveSession(session);
  clearHash();
  return type === "recovery" ? "recovery" : "session";
}
