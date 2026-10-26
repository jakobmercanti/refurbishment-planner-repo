"use client";

import { type FormEvent, useCallback, useEffect, useId, useRef, useState } from "react";
import { AUTH_SESSION_CHANGED, AuthRequestError, acceptAuthRedirect, currentSession, resendVerificationEmail, sendPasswordReset, signIn, signOut, signUp, updatePassword, type AuthSession } from "@/lib/commercialAuth";
import { PlansRedirect } from "@/components/PlansRedirect";
import { UiTheme, type SoftwareUi } from "@/components/UiTheme";
import type { PlanKey } from "@/lib/commercialCatalogue";

type Mode = "signin" | "signup" | "reset";
type AccountSection = "account" | "plans";
const base = process.env.NEXT_PUBLIC_BASE_PATH ?? "";

export function AccountExperience({ embedded = false, onClose, embeddedSection, onEmbeddedSectionChange }: { embedded?: boolean; onClose?: () => void; embeddedSection?: AccountSection; onEmbeddedSectionChange?: (section: AccountSection) => void }) {
  const [mode, setMode] = useState<Mode>("signin");
  const [session, setSession] = useState<AuthSession | null>(null);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [recovery, setRecovery] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [ready, setReady] = useState(false);
  const [section, setSection] = useState<AccountSection>("account");
  const [pendingPlanKey, setPendingPlanKey] = useState<PlanKey | null>(null);
  const [verificationNeeded, setVerificationNeeded] = useState(false);
  const [resendReadyAt, setResendReadyAt] = useState(0);
  const authForm = useRef<HTMLFormElement>(null);
  const formId = useId();
  const submitting = useRef(false);
  const emailInput = useRef<HTMLInputElement>(null);
  const [uiSettings, setUiSettings] = useState<SoftwareUi | null>(null);
  const returnToPlanner = useCallback(() => {
    if (embedded) onClose?.();
    else window.location.assign(base + "/");
  }, [embedded, onClose]);

  useEffect(() => {
    if (embedded) return; // The planner already owns the theme in a dialog.
    const controller = new AbortController();
    void fetch(`${process.env.NEXT_PUBLIC_API_URL ?? "/engineering-api"}/settings`, { signal: controller.signal })
      .then(response => response.ok ? response.json() : null)
      .then(settings => { if (settings?.ui?.themes?.[settings.ui.style]) setUiSettings(settings.ui); })
      .catch(() => undefined);
    return () => controller.abort();
  }, [embedded]);

  useEffect(() => {
    if (!resendReadyAt) return;
    const timer = setTimeout(() => setResendReadyAt(0), Math.max(0, resendReadyAt - Date.now()));
    return () => clearTimeout(timer);
  }, [resendReadyAt]);

  useEffect(() => {
    let mounted = true;
    const refresh = () => { void currentSession().then(value => { if (mounted) setSession(value); }).catch(() => { if (mounted) setError("Account status could not be refreshed. Please retry."); }); };
    window.addEventListener(AUTH_SESSION_CHANGED, refresh);
    window.addEventListener("focus", refresh);
    return () => { mounted = false; window.removeEventListener(AUTH_SESSION_CHANGED, refresh); window.removeEventListener("focus", refresh); };
  }, []);

  const selectSection = useCallback((next: AccountSection) => {
    setSection(next);
    onEmbeddedSectionChange?.(next);
    if (embedded) return;
    const url = new URL(window.location.href);
    if (next === "plans") url.searchParams.set("tab", "plans");
    else url.searchParams.delete("tab");
    window.history.replaceState(null, "", url.pathname + url.search + url.hash);
  }, [embedded, onEmbeddedSectionChange]);

  useEffect(() => {
    if (!pendingPlanKey || session || !ready || (embedded ? embeddedSection : section) !== "account") return;
    authForm.current?.scrollIntoView({ block: "nearest" });
    authForm.current?.querySelector<HTMLInputElement>('input[type="email"]')?.focus();
  }, [pendingPlanKey, session, ready, embedded, embeddedSection, section]);

  useEffect(() => {
    let mounted = true;
    void (async () => {
      const redirect = await acceptAuthRedirect();
      if (!mounted) return;
      if (redirect === "recovery") { setRecovery(true); selectSection("account"); }
      const current = await currentSession();
      if (redirect === "recovery" && !current) throw new AuthRequestError("The password reset session has expired. Request a new password reset link below.", 401, "recovery_link_invalid");
      if (!mounted) return;
      const requestedSection = embedded ? null : new URLSearchParams(window.location.search).get("tab");
      const requestedPlan = embedded ? null : new URLSearchParams(window.location.search).get("plan");
      if (requestedPlan === "starter" || requestedPlan === "pro" || requestedPlan === "studio") {
        setPendingPlanKey(requestedPlan);
      }
      if (redirect === "recovery") selectSection("account");
      else setSection(requestedSection === "plans" ? "plans" : "account");
      if (redirect === "session" && !requestedPlan) { returnToPlanner(); return; }
      if (redirect !== "recovery" && current && requestedPlan) selectSection("plans");
      setSession(current);
      setRecovery(redirect === "recovery");
      if (redirect === "recovery") setNotice("Reset link verified.");
      else if (redirect === "session") setNotice("Your email link is confirmed. You are signed in.");
      setReady(true);
    })().catch((cause) => {
      if (mounted) {
        if ((cause instanceof AuthRequestError && cause.code === "recovery_link_invalid") || new URLSearchParams(window.location.hash.slice(1)).get("type") === "recovery") { setRecovery(false); setMode("reset"); selectSection("account"); }
        setError(cause instanceof Error ? cause.message : "Account access is temporarily unavailable."); setReady(true);
      }
    });
    return () => { mounted = false; };
  }, [embedded, selectSection, returnToPlanner]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting.current) return;
    submitting.current = true;
    setBusy(true); setError(""); setNotice("");
    try {
      if (recovery) {
        if (password.length < 10) { setError("Use at least 10 characters for your new password."); return; }
        if (password !== confirmPassword) { setError("The passwords do not match. Enter the same new password twice."); return; }
        await updatePassword(password, session?.user.id);
        if (session?.user.email) setEmail(session.user.email);
        await signOut();
        setSession(null); setRecovery(false); setMode("signin"); selectSection("account");
        setPassword(""); setConfirmPassword(""); setNotice("Password changed. Sign in below with your new password.");
      } else if (mode === "signin") {
        const signedIn = await signIn(email, password);
        setSession(signedIn);
        if (pendingPlanKey) selectSection("plans");
        else returnToPlanner();
      } else if (mode === "signup") {
        const registered = await signUp(email, password);
        setSession(registered);
        if (registered) { if (pendingPlanKey) selectSection("plans"); else returnToPlanner(); }
        setPassword("");
        setVerificationNeeded(!registered);
        if (!registered) setResendReadyAt(Date.now() + 60_000);
        setNotice(registered ? "Account created." : "Account request accepted. If this is a new account, check your inbox and spam for a verification link. If you already registered, use Sign in or Forgot your password. This response does not confirm that an email was sent.");
      } else {
        await sendPasswordReset(email);
        setNotice("Password reset requested. If this address has an account and can receive email, open the newest reset link in your inbox or spam folder, then choose a new password.");
      }
    } catch (cause) {
      if (recovery && cause instanceof AuthRequestError && [401, 403].includes(cause.status)) {
        setRecovery(false); setMode("reset"); setPassword(""); setConfirmPassword("");
      }
      if (cause instanceof AuthRequestError && cause.code === "email_not_confirmed") setVerificationNeeded(true);
      setError(cause instanceof Error ? cause.message : "The account request could not be completed.");
    } finally { submitting.current = false; setBusy(false); setShowPassword(false); }
  }

  async function resendVerification() {
    if (busy || resendReadyAt || !emailInput.current?.reportValidity()) return;
    setBusy(true); setError(""); setNotice("");
    // An interrupted response may still have sent mail. Do not permit rapid
    // repeated sends, and never resend automatically after a network failure.
    setResendReadyAt(Date.now() + 60_000);
    try {
      await resendVerificationEmail(email);
      setNotice("Verification requested. If this address has an unverified account, check your inbox and spam and use the newest link. An already verified account should use Sign in. Delivery is not guaranteed by this response.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The verification email could not be requested. Please try again later.");
    } finally { setBusy(false); }
  }

  async function leaveAccount() {
    await signOut(); setSession(null); setRecovery(false); setMode("signin"); setPassword(""); setConfirmPassword(""); setNotice("You are signed out.");
  }

  function startPasswordChange() {
    selectSection("account"); setRecovery(true); setPassword(""); setConfirmPassword(""); setError(""); setNotice("");
  }

  const sectionTabs = <nav className="account-section-links" aria-label="Account links">
    {section === "plans" && <button type="button" className="commercial-secondary" onClick={() => selectSection("account")}>Back to account</button>}
    <a id="plans-section-tab" href={`${base}/plans/`} target="_blank" rel="noopener noreferrer">Open plans and billing <span aria-hidden="true">↗</span></a>
  </nav>;

  const accountContent = <section className="commercial-card account-card">
    <p className="commercial-eyebrow">{recovery || mode === "reset" ? "PASSWORD RESET" : "YOUR WORKSPACE"}</p>
    <h1>{recovery ? "Set a new password" : mode === "reset" ? "Reset your password" : session ? "Account ready" : pendingPlanKey ? "Sign in to continue" : "Sign in"}</h1>
    <p className="commercial-lede">{recovery ? "Enter your new password twice. Use at least 10 characters. After saving, you will be signed out so you can sign in with your new password."
      : mode === "reset" ? "Enter your account email to request a reset link. Open that link to set a new password; you do not need to know your old password."
      : pendingPlanKey && !session
      ? `Sign in to continue with ${pendingPlanKey.charAt(0).toUpperCase() + pendingPlanKey.slice(1)}. Your selection is kept; no payment has been taken.`
      : "Floorplanning, Electrical Layout, Heating Layout and Energy & Insulation / EPC retrofit planning are free without an account. Create an account only for cloud backups or paid plans. Energy tools are for preliminary planning, not an official EPC."}</p>
    {!ready ? <p role="status">Checking account…</p> : session && !recovery && mode !== "reset" ? (
      <div className="commercial-stack">
        <p className="commercial-status">Signed in{session.user.email ? " as " + session.user.email : ""}.</p>
        <div className="account-ready-actions">
          <a className="commercial-primary" href={base + "/workspace/"} target={embedded ? "_blank" : undefined} rel={embedded ? "noopener noreferrer" : undefined}>Open cloud workspace</a>
          <a className="commercial-secondary" href={base + "/plans/"} target="_blank" rel="noopener noreferrer">Open plans and billing ↗</a>
          <button className="commercial-secondary" type="button" onClick={startPasswordChange}>Change password</button>
          <button className="commercial-secondary" type="button" onClick={() => void leaveAccount()}>Sign out</button>
        </div>
      </div>
    ) : (
      <>
        <form id={formId} ref={authForm} className="commercial-stack" onSubmit={submit}>
          {recovery ? <>
            {session?.user.email && <p className="commercial-footnote">Changing the password for {session.user.email}.</p>}
            <label>New password<input autoComplete="new-password" type={showPassword ? "text" : "password"} minLength={10} required disabled={busy} value={password} onChange={(event) => setPassword(event.target.value)} /></label>
            <label>Confirm new password<input autoComplete="new-password" type={showPassword ? "text" : "password"} minLength={10} required disabled={busy} value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} /></label>
          </> : <>
            <label>Email<input ref={emailInput} autoComplete="email" type="email" required disabled={busy} maxLength={320} value={email} onChange={(event) => setEmail(event.target.value)} /></label>
            {(mode === "signin" || mode === "signup") && <label>Password<input autoComplete={mode === "signup" ? "new-password" : "current-password"} type={showPassword ? "text" : "password"} minLength={10} required disabled={busy} value={password} onChange={(event) => setPassword(event.target.value)} /></label>}
          </>}
          {!recovery && mode !== "reset" && <div className="commercial-tabs account-auth-tabs" role="group" aria-label="Account actions">
            {(["signin", "signup"] as const).map((value) => <button key={value} type={mode === value ? "submit" : "button"}
              disabled={busy || (value === "signup" && mode === value && verificationNeeded && !!resendReadyAt)} aria-pressed={mode === value} className={mode === value ? "selected" : ""}
              onClick={event => { if (mode !== value) { event.preventDefault(); setMode(value); setVerificationNeeded(false); setError(""); setNotice(""); } }}>
              {busy && mode === value ? "Please wait…" : value === "signin" ? "Sign in" : "Create account"}
            </button>)}
          </div>}
          {error && <p className="commercial-error" role="alert">{error}</p>}
          {notice && <p className="commercial-status" role="status">{notice}</p>}
          {(recovery || mode !== "reset") && <div className="account-utility-actions">
            <button className="commercial-secondary account-password-toggle" type="button" disabled={busy} aria-pressed={showPassword} onClick={() => setShowPassword(value => !value)}>{showPassword ? "Hide password" : "Show password"}</button>
            {!recovery && mode === "signin" && <button className="commercial-secondary" type="button" disabled={busy} onClick={() => { setMode("reset"); setVerificationNeeded(false); setError(""); setNotice(""); }}>Forgot your password?</button>}
          </div>}
          {embedded && <a className="commercial-secondary" href={base + "/plans/"} target="_blank" rel="noopener noreferrer">Open plans and billing ↗</a>}
          {(recovery || mode === "reset") && <div className="account-form-actions">
            <button className="commercial-primary" type="submit" disabled={busy}>{busy ? "Please wait…" : recovery ? "Save new password" : "Send reset link"}</button>
            {recovery && <button className="commercial-secondary" type="button" disabled={busy} onClick={() => void leaveAccount()}>Cancel and return to sign in</button>}
            {mode === "reset" && !recovery && <button className="commercial-secondary" type="button" disabled={busy} onClick={() => { setMode("signin"); setVerificationNeeded(false); setError(""); setNotice(""); }}>Back to sign in</button>}
          </div>}
          {!recovery && (mode === "signup" || verificationNeeded) && <div className="commercial-stack">
            <p className="commercial-footnote">Already registered? Choose Sign in or reset your password; creating the account again does not resend verification. New or unverified accounts can request another link below. Allow at least 60 seconds between requests.</p>
            <button className="commercial-secondary" type="button" disabled={busy || !!resendReadyAt} onClick={() => void resendVerification()}>{resendReadyAt ? "Resend available after 60 seconds" : "Resend verification email"}</button>
            {mode === "signup" && <button className="commercial-secondary" type="button" disabled={busy} onClick={() => { setMode("signin"); setVerificationNeeded(false); setError(""); setNotice(""); }}>Use existing account · Sign in</button>}
          </div>}
        </form>
      </>
    )}
    <p className="commercial-footnote">{recovery || mode === "reset" ? "Use only the newest reset email. If a link has expired or was already used, request a new one. Your saved floorplans are not changed by resetting your password."
      : "Email verification is required before paid workspace features are available. Sign-in and sign-out are shared between open tabs on this site; your planner stays open."}</p>
  </section>;

  const content = <>
    {!embedded && (!session || recovery || mode === "reset" || section === "plans") && sectionTabs}
    {(embedded ? embeddedSection : section) === "account" ? <div id="account-section-panel" role="region" aria-label="Account details" className="account-tab-panel">
      {accountContent}
    </div> : <div id="plans-section-panel" role="region" aria-label="Plans and billing" className="account-tab-panel">
      <PlansRedirect
        selectedPlanKey={pendingPlanKey}
      />
    </div>}
    {!embedded && <footer className="commercial-footer"><a href={base + "/"}>Back to your floorplan</a></footer>}
  </>;

  return embedded ? <div className="account-dialog-content">{content}</div> : <main className="commercial-page account-page">
    <UiTheme settings={uiSettings} />
    <header className="commercial-header"><a href={base + "/"} className="commercial-brand">FreeFloorplan3D</a><nav aria-label="Account navigation"><a className="commercial-secondary" href={base + "/"}>Back to floorplan</a></nav></header>
    {content}
  </main>;
}
