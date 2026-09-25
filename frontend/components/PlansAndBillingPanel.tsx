"use client";

import { useEffect, useState } from "react";
import { commercialRequest, createCheckout, openBillingPortal } from "@/lib/commercialApi";
import { currentSession, type AuthSession } from "@/lib/commercialAuth";

type Plan = { plan_key: string; name: string; monthly_price_pence: number; storage_limit_bytes: number; asset_limit: number; project_limit: number; included_medium: number; included_high: number };
type Pack = { pack_key: string; quality_class: string; quantity: number; price_pence: number };
type Catalogue = { plans: Plan[]; packs: Pack[]; billing_enabled: boolean; cloud_enabled: boolean };
type Summary = { plan: string; status: string; current_period_end?: string; cancel_at_period_end?: boolean };
const base = process.env.NEXT_PUBLIC_BASE_PATH ?? "";

export function PlansAndBillingPanel({ onSignInRequired }: { onSignInRequired: () => void }) {
  const [catalogue, setCatalogue] = useState<Catalogue | null>(null);
  const [session, setSession] = useState<AuthSession | null>(null);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let mounted = true;
    void Promise.all([commercialRequest<Catalogue>("/catalogue", {}, false), currentSession()]).then(async ([products, signedIn]) => {
      if (!mounted) return;
      setCatalogue(products);
      setSession(signedIn);
      if (signedIn) {
        try { setSummary(await commercialRequest<Summary>("/summary")); } catch { /* Account setup explains if services are unavailable. */ }
      }
      const url = new URL(window.location.href);
      const result = url.searchParams.get("checkout");
      if (result === "success") setNotice("Checkout completed. Your plan will appear after Stripe confirms the subscription.");
      if (result === "cancelled") setNotice("Checkout was cancelled; no plan change was made.");
      if (result === "success" || result === "cancelled") {
        url.searchParams.delete("checkout");
        window.history.replaceState(null, "", `${url.pathname}${url.search}${url.hash}`);
      }
    }).catch((cause) => { if (mounted) setError(cause instanceof Error ? cause.message : "Plans are temporarily unavailable."); });
    return () => { mounted = false; };
  }, []);

  async function checkout(key: string) {
    setBusy(true);
    setError("");
    try {
      if (!session) { onSignInRequired(); return; }
      await createCheckout(key);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Checkout could not be started."); }
    finally { setBusy(false); }
  }

  async function portal() {
    setBusy(true);
    setError("");
    try { await openBillingPortal(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Billing portal could not be opened."); }
    finally { setBusy(false); }
  }

  const active = summary?.status === "active" || summary?.status === "trialing";
  return <div className="commercial-content account-plans-content">
    <section className="commercial-page-heading"><div><p className="commercial-eyebrow">PLANS & BILLING</p><h1>Keep planning free. Add cloud when you need it.</h1><p>The 2D/3D planner stays usable without an account. Paid plans add private cloud storage, project backup and optional visual renders.</p></div></section>
    {error && <p className="commercial-error" role="alert">{error}</p>}{notice && <p className="commercial-status" role="status">{notice}</p>}
    {!catalogue ? <section className="commercial-panel"><p>Loading the plan catalogue…</p></section> : <>
      {!catalogue.billing_enabled && <p className="commercial-status">Checkout is not configured on this environment. No payment will be taken.</p>}
      <section className="plan-grid" aria-label="Monthly plans">{catalogue.plans.map((plan) => <article className={`plan-card ${plan.plan_key === "pro" ? "plan-featured" : ""}`} key={plan.plan_key}>
        <p className="commercial-eyebrow">{plan.plan_key === "free" ? "NO ACCOUNT REQUIRED" : "MONTHLY"}</p><h2>{plan.name}</h2><p className="plan-price">{plan.monthly_price_pence ? <>£{(plan.monthly_price_pence / 100).toFixed(2)}<small> / month</small></> : <><strong>£0</strong><small> / always</small></>}</p>
        <ul><li>{plan.plan_key === "free" ? "Local browser projects" : `${plan.project_limit.toLocaleString()} cloud projects`}</li><li>{plan.storage_limit_bytes ? `${(plan.storage_limit_bytes / 1024 ** 3).toFixed(0)} GB private storage` : "No cloud storage"}</li><li>{plan.asset_limit ? `${plan.asset_limit.toLocaleString()} model assets` : "No cloud assets"}</li><li>{plan.included_medium + plan.included_high ? `${plan.included_medium} medium + ${plan.included_high} high renders / month` : "No included AI renders"}</li></ul>
        {plan.plan_key === "free" ? <a className="commercial-secondary" href={`${base}/`}>Continue free</a> : <button className="commercial-primary" disabled={busy || !catalogue.billing_enabled || active} onClick={() => void checkout(plan.plan_key)}>{active ? "Manage your current plan" : busy ? "Opening checkout…" : "Choose plan"}</button>}
      </article>)}</section>
      {active && <section className="commercial-panel"><div className="commercial-panel-heading"><div><h2>Current subscription</h2><p>{summary?.plan} · {summary?.status}{summary?.cancel_at_period_end ? " · Cancels at period end" : ""}{summary?.current_period_end ? ` · Renews/ends ${new Date(summary.current_period_end).toLocaleDateString()}` : ""}</p></div><button className="commercial-primary" disabled={busy} onClick={() => void portal()}>Manage or cancel plan</button></div></section>}
      <section className="commercial-panel"><h2>Render credit packs</h2><p>One-time purchases are available to active subscribers. Credits are consumed only when a render is queued and refunded if it fails.</p><div className="pack-grid">{catalogue.packs.map((pack) => <article key={pack.pack_key}><div><strong>{pack.quantity} {pack.quality_class === "high" ? "high" : "medium"} render{pack.quantity === 1 ? "" : "s"}</strong><span>£{(pack.price_pence / 100).toFixed(2)}</span></div><button className="commercial-secondary" disabled={busy || !catalogue.billing_enabled || !active} onClick={() => void checkout(pack.pack_key)}>{active ? "Buy credits" : "Requires a paid plan"}</button></article>)}</div></section>
    </>}
    <p className="commercial-footnote">Payments are processed by Stripe. Final taxes and payment totals are shown at checkout after the business tax settings are configured. AI outputs and model bounds are visual aids only; they never influence deterministic fit decisions.</p>
  </div>;
}
