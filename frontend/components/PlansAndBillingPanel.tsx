"use client";

import { Fragment, useCallback, useEffect, useRef, useState } from "react";
import { commercialRequest, createCheckout, openBillingPortal } from "@/lib/commercialApi";
import {
  buildPlanComparison,
  formatPounds,
  resolveCommercialCatalogue,
  type CommercialCatalogue,
  type PlanKey,
} from "@/lib/commercialCatalogue";
import { currentSession, isAuthConfigured, type AuthSession } from "@/lib/commercialAuth";

type Summary = { plan: string; status: string; current_period_end?: string; cancel_at_period_end?: boolean };
type HelpTopic = "saving" | "storage" | "assets" | "renders" | "electrical";
type HelpContent = { title: string; body: string };

const HELP_COPY: Record<HelpTopic, HelpContent> = {
  saving: {
    title: "Free saving and cloud backup",
    body: "You never need a subscription to create or save a floorplan. FreeFloorplan3D saves projects locally in your browser and allows you to keep portable project files. Paid plans add private online storage, so your projects can be backed up and accessed through your account.",
  },
  storage: {
    title: "What uses cloud storage?",
    body: "Cloud storage is used by projects, uploaded custom assets, generated asset files and saved AI renders stored in your online workspace. Local projects stored only on your device do not use your cloud allowance.",
  },
  renders: {
    title: "What are AI renders?",
    body: "AI renders turn a selected 3D camera view into a more photorealistic visualisation. Medium renders are designed for faster everyday previews. High renders use the higher-quality rendering option for presentation images. AI images are visual aids only and never change floorplan dimensions or fit calculations.",
  },
  assets: {
    title: "What are cloud assets?",
    body: "Cloud assets are your private uploaded or generated 3D objects, such as GLB or STL models. The asset limit counts unique objects in your online library, not every time an object is placed in a floorplan.",
  },
  electrical: {
    title: "Electrical layout",
    body: "Free projects can contain up to 5 electrical fittings. Any paid plan allows unlimited electrical fittings per project. Doors, windows and ordinary fittings do not count toward this limit.",
  },
};

const isPlanKey = (value: string | undefined): value is PlanKey =>
  value === "free" || value === "starter" || value === "pro" || value === "studio";

function PlanHelpButton({ topic, onOpen }: { topic: HelpTopic; onOpen: (topic: HelpTopic) => void }) {
  const labels: Record<HelpTopic, string> = {
    saving: "Saving and backup information",
    storage: "Cloud storage information",
    assets: "Cloud assets information",
    renders: "AI render information",
    electrical: "Electrical layout information",
  };
  return <button
    type="button"
    className="plan-help-trigger"
    aria-label={labels[topic]}
    aria-haspopup="dialog"
    onClick={() => onOpen(topic)}
  >?</button>;
}

function PlanHelpDialog({ content, packs, onClose }: { content: HelpContent; packs: CommercialCatalogue["packs"]; onClose: () => void }) {
  const closeButton = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    closeButton.current?.focus();
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
      } else if (event.key === "Tab") {
        event.preventDefault();
        closeButton.current?.focus();
      }
    };
    document.addEventListener("keydown", handleKeyDown, true);
    return () => {
      document.removeEventListener("keydown", handleKeyDown, true);
      previousFocus?.focus();
    };
  }, [onClose]);

  return <div
    className="plan-help-backdrop"
    role="presentation"
    onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}
  >
    <section className="plan-help-dialog" role="dialog" aria-modal="true" aria-labelledby="plan-help-title">
      <header>
        <div><span className="commercial-eyebrow">PLAN GUIDE</span><h2 id="plan-help-title">{content.title}</h2></div>
        <button ref={closeButton} type="button" className="modal-close" aria-label="Close information" onClick={onClose}>×</button>
      </header>
      <p>{content.body}</p>
      {packs.length > 0 && <section className="plan-help-pack-list" aria-label="Render pack prices">
        <h3>Current render packs</h3>
        {(["medium", "high"] as const).map((quality) => {
          const options = packs.filter((pack) => pack.quality_class === quality).sort((a, b) => a.quantity - b.quantity);
          return options.length > 0 && <p key={quality}><strong>{quality === "medium" ? "Medium" : "High"}</strong>{options.map((pack) => <span key={pack.pack_key}>{pack.quantity} · {formatPounds(pack.price_pence)}</span>)}</p>;
        })}
      </section>}
    </section>
  </div>;
}

function planHighlights(plan: CommercialCatalogue["plans"][number]): string[] {
  if (plan.plan_key === "free") {
    return ["Unlimited local floorplans", "Browser saving and portable files", "5 electrical fittings per project"];
  }
  const storage = `${Math.round(plan.storage_limit_bytes / 1024 ** 3)} GB private cloud`;
  const assets = `${plan.asset_limit.toLocaleString("en-GB")} private assets`;
  const projects = `${plan.project_limit.toLocaleString("en-GB")} cloud projects`;
  const renders = [
    plan.included_medium ? `${plan.included_medium} Medium renders / month` : "",
    plan.included_high ? `${plan.included_high} High renders / month` : "",
  ].filter(Boolean).join(" + ");
  return [storage, assets, projects, renders, "Unlimited electrical fittings"].filter(Boolean);
}

export function PlansAndBillingPanel({
  onSignInRequired,
  keepPlannerOpen = false,
  onContinueFree,
  selectedPlanKey,
}: {
  onSignInRequired: (planKey: PlanKey) => void;
  keepPlannerOpen?: boolean;
  onContinueFree?: () => void;
  selectedPlanKey?: PlanKey | null;
}) {
  const [catalogue, setCatalogue] = useState(() => resolveCommercialCatalogue(null));
  const [session, setSession] = useState<AuthSession | null>(null);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [catalogueUnavailable, setCatalogueUnavailable] = useState(true);
  const [accountUnavailable, setAccountUnavailable] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [reload, setReload] = useState(0);
  const [actionError, setActionError] = useState("");
  const [notice, setNotice] = useState("");
  const [helpTopic, setHelpTopic] = useState<HelpTopic | null>(null);
  const closeHelp = useCallback(() => setHelpTopic(null), []);

  function retryServices() {
    setLoading(true);
    setCatalogueUnavailable(false);
    setAccountUnavailable(false);
    setActionError("");
    setReload((value) => value + 1);
  }

  useEffect(() => {
    let mounted = true;
    async function loadServices() {
      setLoading(true);
      setCatalogueUnavailable(false);
      setAccountUnavailable(false);
      setActionError("");
      const [catalogueResult, sessionResult] = await Promise.allSettled([
        commercialRequest<unknown>("/catalogue", {}, false),
        currentSession(),
      ]);
      if (!mounted) return;

      const url = new URL(window.location.href);
      const result = url.searchParams.get("checkout");
      if (result === "success") setNotice("Checkout completed. Your plan will appear after Stripe confirms the subscription.");
      if (result === "cancelled") setNotice("Checkout was cancelled; no plan change was made.");
      if (result === "success" || result === "cancelled") {
        url.searchParams.delete("checkout");
        window.history.replaceState(null, "", `${url.pathname}${url.search}${url.hash}`);
      }

      if (catalogueResult.status === "fulfilled") {
        const resolved = resolveCommercialCatalogue(catalogueResult.value);
        setCatalogue(resolved);
        setCatalogueUnavailable(!resolved.serviceAvailable);
      } else {
        setCatalogue(resolveCommercialCatalogue(null));
        setCatalogueUnavailable(true);
      }

      if (sessionResult.status === "rejected") {
        setSession(null);
        setSummary(null);
        setAccountUnavailable(true);
        setLoading(false);
        return;
      }

      const signedIn = sessionResult.value;
      setSession(signedIn);
      setAccountUnavailable(!signedIn && !isAuthConfigured());
      if (signedIn) {
        try {
          const account = await commercialRequest<Summary>("/summary");
          if (mounted) setSummary(account);
        } catch {
          if (mounted) {
            setSummary(null);
            setAccountUnavailable(true);
          }
        }
      } else {
        setSummary(null);
      }
      if (mounted) setLoading(false);
    }

    void loadServices();
    return () => { mounted = false; };
  }, [reload]);

  async function checkout(planKey: PlanKey) {
    if (!session) {
      onSignInRequired(planKey);
      return;
    }
    setBusy(true);
    setActionError("");
    try {
      await createCheckout(planKey, keepPlannerOpen);
    } catch (cause) {
      setActionError(cause instanceof Error ? cause.message : "Checkout could not be started.");
    } finally {
      setBusy(false);
    }
  }

  async function portal() {
    setBusy(true);
    setActionError("");
    try {
      await openBillingPortal(keepPlannerOpen);
    } catch (cause) {
      setActionError(cause instanceof Error ? cause.message : "The billing portal could not be opened.");
    } finally {
      setBusy(false);
    }
  }

  const active = summary?.status === "active" || summary?.status === "trialing";
  const currentPlanKey = isPlanKey(summary?.plan) ? summary.plan : !session ? "free" : null;
  const onlineUnavailable = !loading && (catalogueUnavailable || accountUnavailable);
  const serviceMessage = onlineUnavailable
    ? "Online account services are temporarily unavailable. Plan information is still shown; purchase actions are disabled."
    : !loading && !catalogue.billingEnabled
      ? "Checkout is not configured in this environment. Plan information is still shown; no payment will be taken."
      : "";
  const comparison = buildPlanComparison(catalogue.plans, catalogue.packs.length > 0);

  return <div className="commercial-content account-plans-content">
    <section className="commercial-page-heading plan-page-heading">
      <div><p className="commercial-eyebrow">PLANS &amp; BILLING</p><h1>Keep planning free. Add cloud when you need it.</h1><p>Every plan includes the full floorplan editor. Paid plans add private cloud storage, project backup and AI rendering allowances.</p></div>
    </section>

    {actionError && <p className="commercial-error plan-action-error" role="alert">{actionError}</p>}
    {notice && <p className="commercial-status plan-action-error" role="status">{notice}</p>}

    <section className="plan-grid" aria-label="Monthly plans">
      {catalogue.plans.map((plan) => {
        const isCurrent = currentPlanKey === plan.plan_key && (plan.plan_key === "free" ? Boolean(session && summary?.status === "free") : active);
        const isPaid = plan.plan_key !== "free";
        const unavailableReason = onlineUnavailable
          ? "Online account services are temporarily unavailable. Retry before choosing a plan."
          : !catalogue.billingEnabled
            ? "Checkout is not configured in this environment."
            : !active && !catalogue.availablePlanKeys.has(plan.plan_key)
              ? "This plan is not currently available for checkout."
              : accountUnavailable
                ? "Your account status could not be checked. Retry before choosing a plan."
                : "";
        const canUsePaidActions = !loading && !unavailableReason && !busy;

        return <article className={`plan-card ${plan.plan_key === "pro" ? "plan-featured" : ""}`} key={plan.plan_key} aria-current={isCurrent ? "true" : undefined}>
          {plan.plan_key === "pro" && <span className="plan-recommended">Recommended</span>}
          <div className="plan-card-heading">
            <div><p className="commercial-eyebrow">{isPaid ? "PAID MONTHLY" : "FREE FOREVER"}</p><h2>{plan.name}</h2></div>
            {isCurrent && <span className="plan-current-badge">Current plan</span>}
          </div>
          <p className="plan-description">{plan.description}</p>
          <p className="plan-price">{plan.monthly_price_pence ? formatPounds(plan.monthly_price_pence) : "£0"}<small>{plan.monthly_price_pence ? " / month" : " · Free forever"}</small></p>
          <ul>{planHighlights(plan).map((highlight) => <li key={highlight}>{highlight}</li>)}</ul>
          <div className="plan-card-actions">
            {plan.plan_key === "free" ? (
              onContinueFree
                ? <button className="commercial-secondary" type="button" onClick={onContinueFree}>Continue free</button>
                : <a className="commercial-secondary" href={`${process.env.NEXT_PUBLIC_BASE_PATH ?? ""}/`}>Continue free</a>
            ) : (
              <>
              <button
                className={plan.plan_key === "pro" ? "commercial-primary" : "commercial-secondary"}
                type="button"
                disabled={!canUsePaidActions}
                title={unavailableReason || undefined}
                aria-describedby={!canUsePaidActions ? `plan-${plan.plan_key}-action-note` : undefined}
                onClick={() => void (active ? portal() : checkout(plan.plan_key))}
              >
                {busy ? "Please wait…" : active ? (isCurrent ? "Manage plan" : "Change plan") : selectedPlanKey === plan.plan_key ? `Continue with ${plan.name}` : `Choose ${plan.name}`}
              </button>
              {!canUsePaidActions && <small id={`plan-${plan.plan_key}-action-note`} className="plan-action-note">{loading ? "Checking availability…" : unavailableReason}</small>}
              </>
            )}
          </div>
        </article>;
      })}
    </section>

    {serviceMessage && <div id="plan-service-message" className={`plan-service-status ${onlineUnavailable ? "is-unavailable" : ""}`} role="status">
      <span>{serviceMessage}</span>
      {onlineUnavailable && <button type="button" className="commercial-secondary" onClick={retryServices} disabled={loading}>Retry</button>}
    </div>}

    {active && <section className="commercial-panel plan-current-subscription" aria-label="Current subscription">
      <div><h2>Current subscription</h2><p>{summary?.plan} · {summary?.status}{summary?.cancel_at_period_end ? " · Cancels at period end" : ""}{summary?.current_period_end ? ` · Renews/ends ${new Date(summary.current_period_end).toLocaleDateString()}` : ""}</p></div>
      <button className="commercial-secondary" type="button" disabled={busy || loading || onlineUnavailable || !catalogue.billingEnabled} onClick={() => void portal()}>Manage or cancel plan</button>
    </section>}

    <section className="plan-comparison-section" aria-labelledby="plan-comparison-title">
      <div className="plan-comparison-heading"><div><p className="commercial-eyebrow">AT A GLANCE</p><h2 id="plan-comparison-title">Compare plans</h2></div></div>
      <div className="plan-comparison-scroll" role="region" aria-label="Plan comparison table" tabIndex={0}>
        <table className="plan-comparison-table">
          <thead><tr><th scope="col">Feature</th>{catalogue.plans.map((plan) => <th scope="col" key={plan.plan_key}>{plan.name}</th>)}</tr></thead>
          <tbody>{comparison.map((section) => <Fragment key={section.title}>
            <tr className="plan-comparison-group"><th scope="rowgroup" colSpan={catalogue.plans.length + 1}>{section.title}</th></tr>
            {section.rows.map((row) => <tr key={row.label}>
              <th scope="row"><span>{row.label}</span>{row.help && <PlanHelpButton topic={row.help} onOpen={setHelpTopic} />}</th>
              {catalogue.plans.map((plan) => <td key={plan.plan_key}>{row.values[plan.plan_key]}</td>)}
            </tr>)}
          </Fragment>)}</tbody>
        </table>
      </div>
    </section>

    {catalogue.packs.length > 0 && <section className="plan-render-pack-note" aria-label="Render packs">
      <p>Need more renders? Additional render packs are available on paid plans. <PlanHelpButton topic="renders" onOpen={setHelpTopic} /></p>
    </section>}

    <p className="commercial-footnote plan-billing-footnote">Payments are securely processed by Stripe. Taxes and final payment totals are shown at checkout. <span>AI renders are visual aids and never affect floorplan dimensions or deterministic fit calculations.</span></p>
    {helpTopic && <PlanHelpDialog
      content={helpTopic === "renders" && catalogue.packs.length
        ? { ...HELP_COPY.renders, body: `${HELP_COPY.renders.body} Additional render packs can be purchased separately.` }
        : HELP_COPY[helpTopic]}
      packs={helpTopic === "renders" ? catalogue.packs : []}
      onClose={closeHelp}
    />}
  </div>;
}
