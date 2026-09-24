"use client";

import { FormEvent, useEffect, useState } from "react";
import { acceptAuthRedirect, currentSession, sendMagicLink, sendPasswordReset, signIn, signOut, signUp, updatePassword, type AuthSession } from "@/lib/commercialAuth";

type Mode = "signin" | "signup" | "magic" | "reset";
const base = process.env.NEXT_PUBLIC_BASE_PATH ?? "";

export default function AccountPage() {
  const [mode, setMode] = useState<Mode>("signin");
  const [session, setSession] = useState<AuthSession | null>(null);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [recovery, setRecovery] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let mounted = true;
    void (async () => {
      const redirect = await acceptAuthRedirect();
      const current = await currentSession();
      if (!mounted) return;
      setSession(current);
      setRecovery(redirect === "recovery");
      if (redirect === "recovery") setNotice("Choose a new password for your account.");
      else if (redirect === "session") setNotice("Your email link is confirmed. You are signed in.");
      setReady(true);
    })().catch(() => { if (mounted) { setError("Account access is not configured yet."); setReady(true); } });
    return () => { mounted = false; };
  }, []);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true); setError(""); setNotice("");
    try {
      if (recovery) {
        await updatePassword(password);
        setRecovery(false); setPassword(""); setNotice("Password updated. You can continue to your workspace.");
      } else if (mode === "signin") {
        setSession(await signIn(email, password));
      } else if (mode === "signup") {
        const registered = await signUp(email, password);
        setSession(registered);
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

  return (
    <main className="commercial-page">
      <header className="commercial-header"><a href={`${base}/`} className="commercial-brand">FreeFloorplan3D</a><nav><a href={`${base}/`}>Planner</a><a href={`${base}/billing/`}>Plans</a></nav></header>
      <section className="commercial-card account-card">
        <p className="commercial-eyebrow">YOUR WORKSPACE</p>
        <h1>{session ? "Account ready" : recovery ? "Set a new password" : "Sign in or create an account"}</h1>
        <p className="commercial-lede">The floorplan editor stays free and works without an account. Sign in only when you want cloud projects, paid plans or rendering.</p>
        {session ? (
          <div className="commercial-stack">
            <p className="commercial-status">Signed in{session.user.email ? ` as ${session.user.email}` : ""}.</p>
            <a className="commercial-primary" href={`${base}/workspace/`}>Open cloud workspace</a>
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
      </section>
      <footer className="commercial-footer"><a href={`${base}/`}>Back to your floorplan</a></footer>
    </main>
  );
}
