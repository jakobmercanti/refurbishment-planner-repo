// Render the client component with TSX; the geometry suite uses Node's TS-only loader.
import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { PlansAndBillingPanel } from "../components/PlansAndBillingPanel";
import {
  FALLBACK_PLANS,
  FALLBACK_RENDER_PACKS,
  buildPlanComparison,
  resolveCommercialCatalogue,
} from "../lib/commercialCatalogue";

test("fallback offer contains the approved four plans and render pack prices", () => {
  assert.deepEqual(FALLBACK_PLANS.map((plan) => [plan.plan_key, plan.monthly_price_pence]), [
    ["free", 0], ["starter", 990], ["pro", 1999], ["studio", 2999],
  ]);
  assert.deepEqual(FALLBACK_PLANS.map((plan) => [plan.storage_limit_bytes, plan.asset_limit, plan.project_limit, plan.included_medium, plan.included_high]), [
    [0, 0, 0, 0, 0],
    [10 * 1024 ** 3, 100, 50, 10, 0],
    [50 * 1024 ** 3, 500, 250, 30, 5],
    [100 * 1024 ** 3, 1000, 1000, 60, 15],
  ]);
  assert.deepEqual(FALLBACK_PLANS.map((plan) => plan.max_electrical_elements_per_project), [5, null, null, null]);
  assert.deepEqual(FALLBACK_RENDER_PACKS.map((pack) => [pack.pack_key, pack.price_pence]), [
    ["medium_1", 50], ["medium_10", 449], ["medium_50", 1999], ["medium_100", 3499],
    ["high_1", 99], ["high_10", 899], ["high_50", 3999], ["high_100", 6999],
  ]);
});

test("offline catalogue keeps all plan information but cannot start billing actions", () => {
  const catalogue = resolveCommercialCatalogue(null);
  assert.equal(catalogue.serviceAvailable, false);
  assert.equal(catalogue.billingEnabled, false);
  assert.equal(catalogue.plans.length, 4);
  assert.equal(catalogue.availablePlanKeys.size, 0);

  const markup = renderToStaticMarkup(createElement(PlansAndBillingPanel, { onSignInRequired: () => undefined }));
  assert.equal((markup.match(/<article class="plan-card/g) ?? []).length, 4);
  for (const label of ["Free", "Starter", "Pro", "Studio", "£9.90", "£19.99", "£29.99", "10 GB private cloud", "100 private assets", "5 electrical fittings per project"]) {
    assert.ok(markup.includes(label), `expected initial Plans markup to include ${label}`);
  }
  assert.match(markup, /Checking availability/);
});

test("live catalogue values override fallback while missing electrical fields retain compatible defaults", () => {
  const catalogue = resolveCommercialCatalogue({
    plans: [
      { plan_key: "free", name: "Free", monthly_price_pence: 0, storage_limit_bytes: 0, asset_limit: 0, project_limit: 0, included_medium: 0, included_high: 0, max_electrical_elements_per_project: 5 },
      { plan_key: "starter", name: "Starter", monthly_price_pence: 1090, storage_limit_bytes: 10 * 1024 ** 3, asset_limit: 120, project_limit: 55, included_medium: 12, included_high: 0 },
    ],
    packs: [],
    billing_enabled: true,
    cloud_enabled: true,
  });
  assert.equal(catalogue.serviceAvailable, true);
  assert.equal(catalogue.billingEnabled, true);
  assert.equal(catalogue.plans.find((plan) => plan.plan_key === "starter")?.monthly_price_pence, 1090);
  assert.equal(catalogue.plans.find((plan) => plan.plan_key === "starter")?.asset_limit, 120);
  assert.equal(catalogue.plans.find((plan) => plan.plan_key === "starter")?.max_electrical_elements_per_project, null);
  assert.equal(catalogue.availablePlanKeys.has("studio"), false);
  assert.equal(catalogue.packs.length, 0);
});

test("comparison table derives values from the catalogue, including paid electrical limits", () => {
  const sections = buildPlanComparison(FALLBACK_PLANS, true);
  const row = (sectionName: string, label: string) => {
    const section = sections.find((item) => item.title === sectionName);
    assert.ok(section, `missing ${sectionName} comparison section`);
    const result = section.rows.find((item) => item.label === label);
    assert.ok(result, `missing ${label} comparison row`);
    return result.values;
  };
  assert.deepEqual(row("Cloud", "Private cloud storage"), { free: "—", starter: "10 GB", pro: "50 GB", studio: "100 GB" });
  assert.deepEqual(row("Cloud", "Cloud projects"), { free: "—", starter: "50", pro: "250", studio: "1,000" });
  assert.deepEqual(row("AI rendering", "Medium renders / month"), { free: "—", starter: "10", pro: "30", studio: "60" });
  assert.deepEqual(row("AI rendering", "High renders / month"), { free: "—", starter: "—", pro: "5", studio: "15" });
  assert.deepEqual(row("Other", "Electrical elements / project"), { free: "5", starter: "Unlimited", pro: "Unlimited", studio: "Unlimited" });
  const packRow = buildPlanComparison(FALLBACK_PLANS, false).find((section) => section.title === "AI rendering")?.rows;
  assert.deepEqual(packRow?.[packRow.length - 1]?.values, {
    free: "—", starter: "—", pro: "—", studio: "—",
  });
});
