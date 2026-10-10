"use client";

import { Fragment, useCallback, useEffect, useRef, useState } from "react";
import { WindowHelpButton } from "@/components/WindowHelpButton";
import { commercialRequest } from "@/lib/commercialApi";
import {
  buildPlanComparison,
  formatPounds,
  includesPlannerBuild,
  resolveCommercialCatalogue,
  type CommercialCatalogue,
  type PlanKey,
} from "@/lib/commercialCatalogue";
import { currentSession, isAuthConfigured, type AuthSession } from "@/lib/commercialAuth";

type Summary = { plan: string; status: string; current_period_end?: string; cancel_at_period_end?: boolean };
type HelpTopic = "saving" | "storage" | "assets" | "electrical" | "heating" | "energy";
type HelpContent = { title: string; body: string };

const HELP_COPY: Record<HelpTopic, HelpContent> = {
  saving: {
    title: "Free saving and cloud backup",
    body: "You never need a subscription to create or save a floorplan. FreeFloorplan3D saves projects locally in your browser and allows you to keep portable project files. Paid plans add private online storage, so your projects can be backed up and accessed through your account.",
  },
  storage: {
    title: "What uses cloud storage?",
    body: "Cloud storage is used by projects, uploaded custom assets and generated asset files stored in your online workspace. Local projects stored only on your device do not use your cloud allowance.",
  },
  heating: {
    title: "Free Heating Layout module",
    body: "Heating Layout uses your existing floorplan for preliminary room heat loss, radiator sizing, low-temperature comparisons and editable underfloor-heating layouts. It is free without an account. Review assumptions and have final system design checked by a qualified heating professional.",
  },
  energy: {
    title: "Free Energy & Insulation / EPC retrofit planning",
    body: "Explore wall construction layers, U-values, insulation thickness and their effect on heating demand using the same floorplan. The module is free without an account. Results and the fabric-target score support preliminary retrofit planning; they are not an official EPC, EPC band or SAP/RdSAP assessment.",
  },
  assets: {
    title: "What are cloud assets?",
    body: "Cloud assets are your private uploaded or generated 3D objects, such as GLB or STL models. The asset limit counts unique objects in your online library, not every time an object is placed in a floorplan.",
  },
  electrical: {
    title: "Full Electrical Layout module",
    body: "The full furniture and electrical-item catalogue and Full Electrical Layout module are free for everyone, without an account. Create schematic connections, circuits and focused electrical drawings without subscription limits.",
  },
};

const isPlanKey = (value: string | undefined): value is PlanKey =>
  value === "free" || value === "starter" || value === "pro" || value === "studio";

function PlanHelpButton({ topic, onOpen }: { topic: HelpTopic; onOpen: (topic: HelpTopic) => void }) {
  const labels: Record<HelpTopic, string> = {
    saving: "Saving and backup information",
    storage: "Cloud storage information",
    assets: "Cloud assets information",
    heating: "Free Heating Layout module information",
    energy: "Free Energy and Insulation module information",
    electrical: "Full Electrical Layout module information",
  };
  return <button
    type="button"
    className="plan-help-trigger"
    aria-label={labels[topic]}
    aria-haspopup="dialog"
    onClick={() => onOpen(topic)}
  >?</button>;
}

function PlanHelpDialog({ content, onClose }: { content: HelpContent; onClose: () => void }) {
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
        <div className="window-header-actions"><WindowHelpButton title={content.title} /><button ref={closeButton} type="button" className="modal-close" aria-label="Close information" onClick={onClose}>×</button></div>
      </header>
      <p>{content.body}</p>
    </section>
  </div>;
}

function planHighlights(plan: CommercialCatalogue["plans"][number]): string[] {
  if (plan.plan_key === "free") {
    return ["Unlimited local floorplans", "Browser saving and portable files", "Full furniture & electrical catalogue", "Full Electrical Layout module", "Heating Layout module", "Energy & Insulation / EPC retrofit planning"];
  }
  const storage = `${Math.round(plan.storage_limit_bytes / 1024 ** 3)} GB private cloud`;
  const assets = `${plan.asset_limit.toLocaleString("en-GB")} private assets`;
  const projects = `${plan.project_limit.toLocaleString("en-GB")} cloud projects`;
  return [
    storage,
    assets,
    projects,
    "Full Electrical Layout module",
    "Heating Layout module",
    "Energy & Insulation / EPC retrofit planning",
    ...(includesPlannerBuild(plan.plan_key) ? ["Full PlannerBuild project planning"] : []),
  ].filter(Boolean);
}

export function PlansAndBillingPanel({
  selectedPlanKey,
}: {
  selectedPlanKey?: PlanKey | null;
}) {
  const [catalogue, setCatalogue] = useState(() => resolveCommercialCatalogue(null));
  const [session, setSession] = useState<AuthSession | null>(null);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [catalogueUnavailable, setCatalogueUnavailable] = useState(true);
  const [accountUnavailable, setAccountUnavailable] = useState(false);
  const [loading, setLoading] = useState(true);
  const [reload, setReload] = useState(0);
  const [notice, setNotice] = useState("");
  const [helpTopic, setHelpTopic] = useState<HelpTopic | null>(null);
  const closeHelp = useCallback(() => setHelpTopic(null), []);

  function retryServices() {
    setLoading(true);
    setCatalogueUnavailable(false);
    setAccountUnavailable(false);
    setReload((value) => value + 1);
  }

  useEffect(() => {
    let mounted = true;
    async function loadServices() {
      setLoading(true);
      setCatalogueUnavailable(false);
      setAccountUnavailable(false);
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

  const active = summary?.status === "active" || summary?.status === "trialing";
  const currentPlanKey = isPlanKey(summary?.plan) ? summary.plan : !session ? "free" : null;
  const onlineUnavailable = !loading && (catalogueUnavailable || accountUnavailable);
  const serviceMessage = onlineUnavailable
    ? "Online account services are temporarily unavailable. Open your selected plan to check again; no payment will be taken here."
    : !loading && !catalogue.billingEnabled
      ? "Checkout is not configured in this environment. Plan information is still shown; no payment will be taken."
      : "";
  const comparison = buildPlanComparison(catalogue.plans);

  return <div className="commercial-content account-plans-content">
    <section className="commercial-page-heading plan-page-heading">
      <div><p className="commercial-eyebrow">PLANS &amp; BILLING</p><h1>Keep planning free. Add cloud when you need it.</h1><p>Every plan includes the full floorplan editor, furniture/electrical catalogue and free Electrical Layout, Heating Layout and Energy &amp; Insulation modules. Explore heat loss, radiators, UFH, U-values and EPC retrofit improvements without an account. These are preliminary planning tools, not an official EPC. Paid plans add private cloud storage and project backup. Studio also includes full PlannerBuild project planning.</p></div>
    </section>

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
              <form action={`${process.env.NEXT_PUBLIC_BASE_PATH ?? ""}/`} method="get">
                <button className="commercial-secondary" type="submit">Continue free</button>
              </form>
            ) : (
              <>
              <form action={`${process.env.NEXT_PUBLIC_BASE_PATH ?? ""}/checkout/`} method="get">
                <input type="hidden" name="plan" value={plan.plan_key} />
                <button className={plan.plan_key === "pro" ? "commercial-primary" : "commercial-secondary"} type="submit">
                  {active ? (isCurrent ? "Manage plan" : "Change plan") : selectedPlanKey === plan.plan_key ? `Continue with ${plan.name}` : `Choose ${plan.name}`}
                </button>
              </form>
              {!loading && unavailableReason && <small className="plan-action-note">Availability will be checked on the next page.</small>}
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
      <a className="commercial-secondary" href={`${process.env.NEXT_PUBLIC_BASE_PATH ?? ""}/checkout/?action=portal`}>Manage or cancel plan</a>
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
              {catalogue.plans.map((plan) => {
                const value = row.values[plan.plan_key];
                return <td key={plan.plan_key}>{value === "Included"
                  ? <span className="plan-comparison-included" role="img" aria-label="Included">✓</span>
                  : value === "Not included" ? "—" : value}</td>;
              })}
            </tr>)}
          </Fragment>)}</tbody>
        </table>
      </div>
    </section>

    <p className="commercial-footnote plan-billing-footnote">Payments are securely processed by Stripe. Taxes and final payment totals are shown at checkout. <span>Heating and energy results are preliminary estimates, not certified system designs or an official EPC.</span></p>
    {helpTopic && <PlanHelpDialog
      content={HELP_COPY[helpTopic]}
      onClose={closeHelp}
    />}
  </div>;
}
