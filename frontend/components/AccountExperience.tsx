"use client";

import { type FormEvent, useCallback, useEffect, useRef, useState } from "react";
import { acceptAuthRedirect, currentSession, sendPasswordReset, signIn, signOut, signUp, updatePassword, type AuthSession } from "@/lib/commercialAuth";
import { PlansRedirect } from "@/components/PlansRedirect";
import type { PlanKey } from "@/lib/commercialCatalogue";

type Mode = "signin" | "signup" | "reset";
type AccountSection = "account" | "plans";
const base = process.env.NEXT_PUBLIC_BASE_PATH ?? "";

export function AccountExperience({ embedded = false, embeddedSection, onEmbeddedSectionChange }: { embedded?: boolean; onClose?: () => void; embeddedSection?: AccountSection; onEmbeddedSectionChange?: (section: AccountSection) => void }) {
  const [mode, setMode] = useState<Mode>("signin");
  const [session, setSession] = useState<AuthSession | null>(null);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [recovery, setRecovery] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [ready, setReady] = useState(false);
  const [section, setSection] = useState<AccountSection>("account");
  const [pendingPlanKey, setPendingPlanKey] = useState<PlanKey | null>(null);
  const authForm = useRef<HTMLFormElement>(null);

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
      const current = await currentSession();
      if (!mounted) return;
      const requestedSection = embedded ? null : new URLSearchParams(window.location.search).get("tab");
      const requestedPlan = embedded ? null : new URLSearchParams(window.location.search).get("plan");
      if (requestedPlan === "starter" || requestedPlan === "pro" || requestedPlan === "studio") {
        setPendingPlanKey(requestedPlan);
      }
      setSection(requestedSection === "plans" ? "plans" : "account");
      if (redirect !== "recovery" && (redirect === "session" || (current && requestedPlan))) selectSection("plans");
      setSession(current);
      setRecovery(redirect === "recovery");
      if (redirect === "recovery") setNotice("Choose a new password for your account.");
      else if (redirect === "session") setNotice("Your email link is confirmed. You are signed in.");
      setReady(true);
    })().catch((cause) => { if (mounted) { setError(cause instanceof Error ? cause.message : "Account access is temporarily unavailable."); setReady(true); } });
    return () => { mounted = false; };
  }, [embedded, selectSection]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true); setError(""); setNotice("");
    try {
      if (recovery) {
        await updatePassword(password);
        setRecovery(false); setPassword(""); setNotice("Password updated. You can continue to your workspace.");
      } else if (mode === "signin") {
        const signedIn = await signIn(email, password);
        setSession(signedIn);
        selectSection("plans");
      } else if (mode === "signup") {
        const registered = await signUp(email, password);
        setSession(registered);
        if (registered) selectSection("plans");
        setNotice(registered ? "Account created." : "Check your email to verify your account, then sign in.");
      } else {
        await sendPasswordReset(email);
        setNotice("If the address can receive account email, a password-reset link is on its way.");
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The account request could not be completed.");
    } finally { setBusy(false); setShowPassword(false); }
  }

  async function leaveAccount() {
    await signOut(); setSession(null); setNotice("You are signed out.");
  }

  const sectionTabs = <nav className="commercial-tabs account-section-tabs" role="tablist" aria-label="Account sections">
    <button id="account-section-tab" type="button" role="tab" aria-controls="account-section-panel" aria-selected={(embedded ? embeddedSection : section) === "account"} className={(embedded ? embeddedSection : section) === "account" ? "selected" : ""} onClick={() => selectSection("account")}>{session ? "Account" : "Sign in"}</button>
    <a id="plans-section-tab" href={`${base}/plans/`}>Plans</a>
  </nav>;

  const accountContent = <section className="commercial-card account-card">
    <p className="commercial-eyebrow">YOUR WORKSPACE</p>
    <h1>{session ? "Account ready" : recovery ? "Set a new password" : pendingPlanKey ? "Sign in to continue" : "Sign in when you want cloud features"}</h1>
    <p className="commercial-lede">{pendingPlanKey && !session && !recovery
      ? `Sign in to continue with ${pendingPlanKey.charAt(0).toUpperCase() + pendingPlanKey.slice(1)}. Your selection is kept; no payment has been taken.`
      : "FreeFloorplan3D works without an account. Create an account only if you want cloud backups, paid plans or AI rendering."}</p>
    {session ? (
      <div className="commercial-stack">
        <p className="commercial-status">Signed in{session.user.email ? " as " + session.user.email : ""}.</p>
        <a className="commercial-primary" href={base + "/workspace/"} target={embedded ? "_blank" : undefined} rel={embedded ? "noopener noreferrer" : undefined}>Open cloud workspace</a>
        <button className="commercial-secondary" type="button" onClick={() => void leaveAccount()}>Sign out</button>
      </div>
    ) : !ready ? <p role="status">Checking account…</p> : (
      <>
        {!recovery && <div className="commercial-tabs account-auth-tabs" role="tablist" aria-label="Account options">
          {(["signin", "signup"] as const).map((value) => <button key={value} type="button" role="tab" aria-selected={mode === value} className={mode === value ? "selected" : ""} onClick={() => { setMode(value); setError(""); setNotice(""); }}>
            {value === "signin" ? "Sign in" : "Create account"}
          </button>)}
        </div>}
        <form ref={authForm} className="commercial-stack" onSubmit={submit}>
          {recovery ? <label>New password<input autoComplete="new-password" type={showPassword ? "text" : "password"} minLength={10} required value={password} onChange={(event) => setPassword(event.target.value)} /></label> : <>
            <label>Email<input autoComplete="email" type="email" required maxLength={320} value={email} onChange={(event) => setEmail(event.target.value)} /></label>
            {(mode === "signin" || mode === "signup") && <label>Password<input autoComplete={mode === "signup" ? "new-password" : "current-password"} type={showPassword ? "text" : "password"} minLength={10} required value={password} onChange={(event) => setPassword(event.target.value)} /></label>}
          </>}
          {(recovery || mode === "signin" || mode === "signup") && <button className="commercial-secondary account-password-toggle" type="button" aria-pressed={showPassword} onClick={() => setShowPassword(value => !value)}>{showPassword ? "Hide password" : "Show password"}</button>}
          {error && <p className="commercial-error" role="alert">{error}</p>}
          {notice && <p className="commercial-status" role="status">{notice}</p>}
          <button className="commercial-primary" type="submit" disabled={busy}>{busy ? "Please wait…" : recovery ? "Update password" : mode === "signin" ? "Sign in" : mode === "signup" ? "Create account" : "Send reset link"}</button>
        </form>
        {!recovery && mode === "signin" && <button className="commercial-secondary account-recovery-button" type="button" onClick={() => { setMode("reset"); setError(""); setNotice(""); }}>Forgot your password?</button>}
        {mode === "reset" && !recovery && <button className="commercial-secondary account-recovery-button" type="button" onClick={() => { setMode("signin"); setError(""); setNotice(""); }}>Back to sign in</button>}
      </>
    )}
    <p className="commercial-footnote">Email verification is required before paid workspace features are available. Use the same browser tab after following an email link.</p>
  </section>;

  const content = <>
    {!embedded && sectionTabs}
    {(embedded ? embeddedSection : section) === "account" ? <div id="account-section-panel" role="tabpanel" aria-labelledby="account-section-tab" className="account-tab-panel">
      {accountContent}
    </div> : <div id="plans-section-panel" role="tabpanel" aria-labelledby="plans-section-tab" className="account-tab-panel">
      <PlansRedirect
        selectedPlanKey={pendingPlanKey}
      />
    </div>}
    {!embedded && <footer className="commercial-footer"><a href={base + "/"}>Back to your floorplan</a></footer>}
  </>;

  return embedded ? <div className="account-dialog-content">{content}</div> : <main className="commercial-page">
    <header className="commercial-header"><a href={base + "/"} className="commercial-brand">FreeFloorplan3D</a><nav><a href={base + "/"}>Planner</a></nav></header>
    {content}
  </main>;
}
