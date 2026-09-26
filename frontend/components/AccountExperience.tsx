"use client";

import { type FormEvent, useEffect, useState } from "react";
import { acceptAuthRedirect, currentSession, sendMagicLink, sendPasswordReset, signIn, signOut, signUp, updatePassword, type AuthSession } from "@/lib/commercialAuth";
import { PlansAndBillingPanel } from "@/components/PlansAndBillingPanel";
import type { PlanKey } from "@/lib/commercialCatalogue";

type Mode = "signin" | "signup" | "magic" | "reset";
type AccountSection = "account" | "plans";
const base = process.env.NEXT_PUBLIC_BASE_PATH ?? "";

export function AccountExperience({ embedded = false, onClose, embeddedSection, onEmbeddedSectionChange }: { embedded?: boolean; onClose?: () => void; embeddedSection?: AccountSection; onEmbeddedSectionChange?: (section: AccountSection) => void }) {
  const [mode, setMode] = useState<Mode>("signin");
  const [session, setSession] = useState<AuthSession | null>(null);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [recovery, setRecovery] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [ready, setReady] = useState(false);
  const [section, setSection] = useState<AccountSection>("account");
  const [pendingPlanKey, setPendingPlanKey] = useState<PlanKey | null>(null);

  useEffect(() => {
    let mounted = true;
    void (async () => {
      const redirect = await acceptAuthRedirect();
      const current = await currentSession();
      if (!mounted) return;
      const requestedSection = embedded ? null : new URLSearchParams(window.location.search).get("tab");
      setSection(requestedSection === "plans" ? "plans" : "account");
      setSession(current);
      setRecovery(redirect === "recovery");
      if (redirect === "recovery") setNotice("Choose a new password for your account.");
      else if (redirect === "session") setNotice("Your email link is confirmed. You are signed in.");
      setReady(true);
    })().catch((cause) => { if (mounted) { setError(cause instanceof Error ? cause.message : "Account access is temporarily unavailable."); setReady(true); } });
    return () => { mounted = false; };
  }, [embedded]);

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
        if (signedIn && pendingPlanKey) selectSection("plans");
      } else if (mode === "signup") {
        const registered = await signUp(email, password);
        setSession(registered);
        if (registered && pendingPlanKey) selectSection("plans");
        setNotice(registered ? "Account created." : "Check your email to verify your account, then sign in.");
      } else if (mode === "magic") {
        await sendMagicLink(email);
        setNotice("If the address can receive account email, a sign-in link is on its way.");
      } else {
        await sendPasswordReset(email);
        setNotice("If the address can receive account email, a password-reset link is on its way.");
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The account request could not be completed.");
    } finally { setBusy(false); }
  }

  async function leaveAccount() {
    await signOut(); setSession(null); setNotice("You are signed out.");
  }

  function selectSection(next: AccountSection) {
    setSection(next);
    onEmbeddedSectionChange?.(next);
    if (embedded) return;
    const url = new URL(window.location.href);
    if (next === "plans") url.searchParams.set("tab", "plans");
    else url.searchParams.delete("tab");
    window.history.replaceState(null, "", url.pathname + url.search + url.hash);
  }

  const sectionTabs = <nav className="commercial-tabs account-section-tabs" role="tablist" aria-label="Account sections">
    <button id="account-section-tab" type="button" role="tab" aria-controls="account-section-panel" aria-selected={(embedded ? embeddedSection : section) === "account"} className={(embedded ? embeddedSection : section) === "account" ? "selected" : ""} onClick={() => selectSection("account")}>Account</button>
    <button id="plans-section-tab" type="button" role="tab" aria-controls="plans-section-panel" aria-selected={(embedded ? embeddedSection : section) === "plans"} className={(embedded ? embeddedSection : section) === "plans" ? "selected" : ""} onClick={() => selectSection("plans")}>Plans</button>
  </nav>;

  const accountContent = <section className="commercial-card account-card">
    <p className="commercial-eyebrow">YOUR WORKSPACE</p>
    <h1>{session ? "Account ready" : recovery ? "Set a new password" : "Sign in when you want cloud features"}</h1>
    <p className="commercial-lede">FreeFloorplan3D works without an account. Create an account only if you want cloud backups, paid plans or AI rendering.</p>
    {session ? (
      <div className="commercial-stack">
        <p className="commercial-status">Signed in{session.user.email ? " as " + session.user.email : ""}.</p>
        <a className="commercial-primary" href={base + "/workspace/"} target={embedded ? "_blank" : undefined} rel={embedded ? "noopener noreferrer" : undefined}>Open cloud workspace</a>
        <button className="commercial-secondary" type="button" onClick={() => void leaveAccount()}>Sign out</button>
      </div>
    ) : !ready ? <p role="status">Checking account…</p> : (
      <>
        {!recovery && <div className="commercial-tabs" role="tablist" aria-label="Account options">
          {(["signin", "signup", "magic"] as const).map((value) => <button key={value} type="button" role="tab" aria-selected={mode === value} className={mode === value ? "selected" : ""} onClick={() => { setMode(value); setError(""); setNotice(""); }}>
            {value === "signin" ? "Sign in" : value === "signup" ? "Create account" : "Email link"}
          </button>)}
        </div>}
        <form className="commercial-stack" onSubmit={submit}>
          {recovery ? <label>New password<input autoComplete="new-password" type="password" minLength={10} required value={password} onChange={(event) => setPassword(event.target.value)} /></label> : <>
            <label>Email<input autoComplete="email" type="email" required maxLength={320} value={email} onChange={(event) => setEmail(event.target.value)} /></label>
            {(mode === "signin" || mode === "signup") && <label>Password<input autoComplete={mode === "signup" ? "new-password" : "current-password"} type="password" minLength={10} required value={password} onChange={(event) => setPassword(event.target.value)} /></label>}
          </>}
          {error && <p className="commercial-error" role="alert">{error}</p>}
          {notice && <p className="commercial-status" role="status">{notice}</p>}
          <button className="commercial-primary" type="submit" disabled={busy}>{busy ? "Please wait…" : recovery ? "Update password" : mode === "signin" ? "Sign in" : mode === "signup" ? "Create account" : mode === "magic" ? "Send sign-in link" : "Send reset link"}</button>
        </form>
        {!recovery && mode === "signin" && <button className="commercial-text-button" type="button" onClick={() => { setMode("reset"); setError(""); setNotice(""); }}>Forgot your password?</button>}
        {mode === "reset" && !recovery && <button className="commercial-text-button" type="button" onClick={() => { setMode("signin"); setError(""); setNotice(""); }}>Back to sign in</button>}
      </>
    )}
    <p className="commercial-footnote">Email verification is required before paid workspace features are available. Use the same browser tab after following an email link.</p>
  </section>;

  const content = <>
    {!embedded && sectionTabs}
    {(embedded ? embeddedSection : section) === "account" ? <div id="account-section-panel" role="tabpanel" aria-labelledby="account-section-tab" className="account-tab-panel">
      {accountContent}
    </div> : <div id="plans-section-panel" role="tabpanel" aria-labelledby="plans-section-tab" className="account-tab-panel">
      <PlansAndBillingPanel
        onSignInRequired={(planKey) => { setPendingPlanKey(planKey); selectSection("account"); setMode("signin"); }}
        keepPlannerOpen={embedded}
        onContinueFree={embedded ? onClose : undefined}
        selectedPlanKey={pendingPlanKey}
      />
    </div>}
    {!embedded && <footer className="commercial-footer"><a href={base + "/"}>Back to your floorplan</a></footer>}
    {embedded && onClose && <button type="button" className="commercial-secondary account-dialog-return" onClick={onClose}>Return to planner</button>}
  </>;

  return embedded ? <div className="account-dialog-content">{content}</div> : <main className="commercial-page">
    <header className="commercial-header"><a href={base + "/"} className="commercial-brand">FreeFloorplan3D</a><nav><a href={base + "/"}>Planner</a></nav></header>
    {content}
  </main>;
}
