"use client";

export interface AuthSession {
  access_token: string;
  refresh_token: string;
  expires_at: number;
  user: { id: string; email?: string };
}

const SESSION_KEY = "freefloorplan3d:commercial-session:v1";
let refreshInFlight: Promise<AuthSession | null> | null = null;

function configuration() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim().replace(/\/$/, "");
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY?.trim();
  if (!url || !key) throw new Error("Account access is not configured yet.");
  return { url, key };
}

function saveSession(session: AuthSession | null) {
  if (typeof window === "undefined") return;
  if (session) sessionStorage.setItem(SESSION_KEY, JSON.stringify(session));
  else sessionStorage.removeItem(SESSION_KEY);
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

async function authRequest<T>(path: string, body?: unknown, accessToken?: string): Promise<T> {
  const { url, key } = configuration();
  const response = await fetch(`${url}/auth/v1/${path}`, {
    method: body === undefined ? "GET" : "POST",
    headers: { apikey: key, Authorization: `Bearer ${accessToken ?? key}`, ...(body === undefined ? {} : { "Content-Type": "application/json" }) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const result = await response.json().catch(() => ({})) as Record<string, unknown>;
  if (!response.ok) {
    const known = typeof result.msg === "string" ? result.msg : typeof result.message === "string" ? result.message : "Account request failed.";
    throw new Error(known.slice(0, 240));
  }
  return result as T;
}

function normalizeSession(value: Record<string, unknown>): AuthSession | null {
  const user = value.user as AuthSession["user"] | undefined;
  if (typeof value.access_token !== "string" || typeof value.refresh_token !== "string" || !user || typeof user.id !== "string") return null;
  const expiresIn = typeof value.expires_in === "number" ? value.expires_in : 3600;
  return { access_token: value.access_token, refresh_token: value.refresh_token, expires_at: Math.floor(Date.now() / 1000) + expiresIn, user };
}

export async function currentSession(): Promise<AuthSession | null> {
  const session = readStoredSession();
  if (!session) return null;
  if (session.expires_at > Math.floor(Date.now() / 1000) + 60) return session;
  if (!refreshInFlight) {
    refreshInFlight = authRequest<Record<string, unknown>>("token?grant_type=refresh_token", { refresh_token: session.refresh_token })
      .then((result) => { const updated = normalizeSession(result); saveSession(updated); return updated; })
      .catch(() => { saveSession(null); return null; })
      .finally(() => { refreshInFlight = null; });
  }
  return refreshInFlight;
}

export async function signIn(email: string, password: string): Promise<AuthSession> {
  const result = await authRequest<Record<string, unknown>>("token?grant_type=password", { email: email.trim(), password });
  const session = normalizeSession(result);
  if (!session) throw new Error("Sign-in did not return a valid session.");
  saveSession(session);
  return session;
}

export async function signUp(email: string, password: string): Promise<AuthSession | null> {
  const result = await authRequest<Record<string, unknown>>("signup", { email: email.trim(), password });
  const session = normalizeSession(result);
  saveSession(session);
  return session;
}

function accountRedirect() {
  const base = process.env.NEXT_PUBLIC_BASE_PATH ?? "";
  return `${window.location.origin}${base}/account/`;
}

export async function sendMagicLink(email: string): Promise<void> {
  await authRequest("otp?redirect_to=" + encodeURIComponent(accountRedirect()), { email: email.trim(), create_user: true });
}

export async function sendPasswordReset(email: string): Promise<void> {
  await authRequest("recover?redirect_to=" + encodeURIComponent(accountRedirect()), { email: email.trim() });
}

export async function updatePassword(password: string): Promise<void> {
  const session = await currentSession();
  if (!session) throw new Error("The password reset link has expired. Request a new one.");
  const { url, key } = configuration();
  const response = await fetch(`${url}/auth/v1/user`, {
    method: "PUT", headers: { apikey: key, Authorization: `Bearer ${session.access_token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ password }),
  });
  if (!response.ok) throw new Error("The password could not be updated. Request a fresh reset link and try again.");
}

export async function signOut(): Promise<void> {
  const session = readStoredSession();
  saveSession(null);
  if (!session) return;
  try { await authRequest("logout", {}, session.access_token); } catch { /* local sign-out must still complete */ }
}

export async function acceptAuthRedirect(): Promise<"recovery" | "session" | null> {
  if (typeof window === "undefined" || !window.location.hash) return null;
  const values = new URLSearchParams(window.location.hash.slice(1));
  const type = values.get("type");
  const accessToken = values.get("access_token");
  const refreshToken = values.get("refresh_token");
  if (!accessToken || !refreshToken) return null;
  let user: AuthSession["user"];
  try { user = await authRequest<AuthSession["user"]>("user", undefined, accessToken); }
  catch { return null; }
  const session = normalizeSession({ access_token: accessToken, refresh_token: refreshToken, expires_in: Number(values.get("expires_in") ?? 3600), user });
  if (!session) return null;
  saveSession(session);
  window.history.replaceState(null, "", `${window.location.pathname}${window.location.search}`);
  return type === "recovery" ? "recovery" : "session";
}
