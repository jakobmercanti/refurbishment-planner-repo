"use client";

import { useEffect, useRef, useState } from "react";
import { paidPlan, prepareBillingNavigation } from "@/lib/billingNavigation";

const base = process.env.NEXT_PUBLIC_BASE_PATH ?? "";

export function CheckoutExperience() {
  const [state, setState] = useState<{ phase: "loading" | "signin" | "ready" | "error"; plan?: string | null; url?: string; error?: string }>({ phase: "loading" });
  const request = useRef<Promise<string | null> | null>(null);

  useEffect(() => {
    let mounted = true;
    const params = new URLSearchParams(window.location.search);
    const plan = paidPlan(params.get("plan"));
    // Share one request across Strict Mode effect replays. Never create two checkout sessions.
    request.current ??= prepareBillingNavigation(params.get("plan"), params.get("action") === "portal");
    void request.current.then((url) => {
      if (!mounted) return;
      setState(url ? { phase: "ready", plan, url } : { phase: "signin", plan });
      if (url) window.location.replace(url);
    }).catch((cause) => {
      if (!mounted) return;
      setState({ phase: "error", plan, error: cause instanceof Error && cause.name === "TimeoutError"
        ? "The billing service took too long to respond. Please retry."
        : cause instanceof Error ? cause.message : "Checkout could not be started. Please retry." });
    });
    return () => { mounted = false; };
  }, []);

  return <main className="commercial-page">
    <header className="commercial-header"><a className="commercial-brand" href={`${base}/`}>FreeFloorplan3D</a><nav><a href={`${base}/plans/`}>Plans</a> · <a href={`${base}/`}>Back to planner</a></nav></header>
    <section className="commercial-card account-card">
      <p className="commercial-eyebrow">SECURE BILLING</p>
      <h1>{state.phase === "signin" ? "Sign in to continue" : "Opening Stripe"}</h1>
      {state.phase === "loading" && <p role="status">Checking your account and preparing secure checkout… This can take up to a minute.</p>}
      {state.phase === "signin" && <div className="commercial-stack"><p>Sign in before choosing a paid plan. Your selection is kept; no payment has been taken.</p><a className="commercial-primary" href={`${base}/account/${state.plan ? `?plan=${state.plan}` : ""}`}>Sign in{state.plan ? ` to choose ${state.plan}` : ""}</a></div>}
      {state.phase === "ready" && <div className="commercial-stack"><p role="status">Stripe is ready. If you are not redirected, use the link below.</p><a className="commercial-primary" href={state.url}>Continue to Stripe</a></div>}
      {state.phase === "error" && <div className="commercial-stack"><p className="commercial-error" role="alert">{state.error}</p><a className="commercial-secondary" href={`${base}/checkout/${state.plan ? `?plan=${state.plan}` : "?action=portal"}`}>Retry</a></div>}
      <p className="commercial-footnote">No payment is taken until you confirm it on Stripe. Test-mode checkout is labelled by Stripe on its payment page.</p>
      <a href={`${base}/plans/`}>Back to plans</a>
      <p><a href={`${base}/`}>Back to planner</a></p>
      <noscript><p>JavaScript must be enabled to securely sign in and prepare Stripe checkout.</p></noscript>
    </section>
  </main>;
}
