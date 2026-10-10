// Render the client component with TSX; the geometry suite uses Node's TS-only loader.
import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { PlansAndBillingPanel } from "../components/PlansAndBillingPanel";
import { PlansRedirect } from "../components/PlansRedirect";
import { AccountDialog } from "../components/AccountDialog";
import { AccountExperience } from "../components/AccountExperience";
import {
  FALLBACK_PLANS,
  FALLBACK_RENDER_PACKS,
  buildPlanComparison,
  includesPlannerBuild,
  resolveCommercialCatalogue,
} from "../lib/commercialCatalogue";

test("all account Plans entry points use the standalone page and retain a selected tier", () => {
  const redirected = renderToStaticMarkup(createElement(PlansRedirect, { selectedPlanKey: "studio" }));
  assert.match(redirected, /<form[^>]+action="[^\"]*\/plans\/" method="get"/);
  assert.match(redirected, /name="plan" value="studio"/);
  const embedded = renderToStaticMarkup(createElement(AccountDialog, { initialSection: "plans", onClose: () => undefined }));
  assert.match(embedded, /id="plans-section-tab" href="[^\"]*\/plans\/"/);
  assert.ok(embedded.includes('data-plans-redirect="true"'));
  const standalone = renderToStaticMarkup(createElement(AccountExperience));
  assert.match(standalone, /id="plans-section-tab" href="[^\"]*\/plans\/"/);
  assert.doesNotMatch(standalone, /AI render/i);
  assert.match(standalone, /Heating Layout/);
  assert.match(standalone, /EPC retrofit planning/);
});

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
  assert.deepEqual(FALLBACK_RENDER_PACKS.map((pack) => [pack.pack_key, pack.price_pence]), [
    ["medium_1", 50], ["medium_10", 449], ["medium_50", 1999], ["medium_100", 3499],
    ["high_1", 99], ["high_10", 899], ["high_50", 3999], ["high_100", 6999],
  ]);
});

test("initial catalogue renders working native plan forms before hydration without starting billing", () => {
  const catalogue = resolveCommercialCatalogue(null);
  assert.equal(catalogue.serviceAvailable, false);
  assert.equal(catalogue.billingEnabled, false);
  assert.equal(catalogue.plans.length, 4);
  assert.equal(catalogue.availablePlanKeys.size, 0);

  const markup = renderToStaticMarkup(createElement(PlansAndBillingPanel, {}));
  assert.equal((markup.match(/<article class="plan-card/g) ?? []).length, 4);
  for (const label of ["Free", "Starter", "Pro", "Studio", "£9.90", "£19.99", "£29.99", "10 GB private cloud", "100 private assets", "Full furniture &amp; electrical catalogue", "Full Electrical Layout module", "Full PlannerBuild project planning"]) {
    assert.ok(markup.includes(label), `expected initial Plans markup to include ${label}`);
  }
  assert.ok(markup.includes('<span class="plan-comparison-included" role="img" aria-label="Included">✓</span>'));
  assert.ok(markup.includes("<td>—</td>"));
  assert.ok(!markup.includes("<td>Included</td>"));
  assert.ok(!markup.includes("<td>Not included</td>"));
  assert.equal(includesPlannerBuild("studio"), true);
  assert.equal(includesPlannerBuild("free"), false);
  assert.equal(includesPlannerBuild("starter"), false);
  assert.equal(includesPlannerBuild("pro"), false);
  const freeCardFeatures = markup.match(/<article class="plan-card [^>]*>.*?<ul>(.*?)<\/ul>/s)?.[1] ?? "";
  assert.ok(freeCardFeatures.includes("Full Electrical Layout module"));
  assert.ok(freeCardFeatures.includes("Heating Layout module"));
  assert.ok(freeCardFeatures.includes("Energy &amp; Insulation / EPC retrofit planning"));
  assert.match(markup, /not an official EPC/);
  assert.doesNotMatch(markup, /AI render|Medium renders|High renders|render packs|rendering allowance/i);
  for (const plan of ["starter", "pro", "studio"]) {
    assert.match(markup, new RegExp(`<form action="[^"]*/checkout/" method="get"><input type="hidden" name="plan" value="${plan}"/>.*?<button[^>]+type="submit"`));
  }
  assert.match(markup, /<form action="[^\"]*\/" method="get"><button[^>]+type="submit">Continue free<\/button><\/form>/);
  assert.ok(!markup.includes("disabled=\"\""));
});

test("live catalogue values override fallback without gating electrical module access", () => {
  const catalogue = resolveCommercialCatalogue({
    plans: [
      { plan_key: "free", name: "Free", monthly_price_pence: 0, storage_limit_bytes: 0, asset_limit: 0, project_limit: 0, included_medium: 0, included_high: 0 },
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
  assert.equal(catalogue.availablePlanKeys.has("studio"), false);
  assert.equal(catalogue.packs.length, 0);
});

test("comparison table includes the Full Electrical Layout module on every plan and PlannerBuild on Studio+", () => {
  const sections = buildPlanComparison(FALLBACK_PLANS);
  const row = (sectionName: string, label: string) => {
    const section = sections.find((item) => item.title === sectionName);
    assert.ok(section, `missing ${sectionName} comparison section`);
    const result = section.rows.find((item) => item.label === label);
    assert.ok(result, `missing ${label} comparison row`);
    return result.values;
  };
  assert.deepEqual(row("Cloud", "Private cloud storage"), { free: "—", starter: "10 GB", pro: "50 GB", studio: "100 GB" });
  assert.deepEqual(row("Cloud", "Cloud projects"), { free: "—", starter: "50", pro: "250", studio: "1,000" });
  for (const label of ["Heating Layout module", "Energy & Insulation / EPC retrofit planning"]) {
    assert.deepEqual(row("Other", label), { free: "Included", starter: "Included", pro: "Included", studio: "Included" });
  }
  assert.ok(!sections.some((section) => /render/i.test(section.title)));
  assert.deepEqual(row("Other", "Full Electrical Layout module"), { free: "Included", starter: "Included", pro: "Included", studio: "Included" });
  assert.deepEqual(row("Other", "Full PlannerBuild project-planning module"), { free: "Not included", starter: "Not included", pro: "Not included", studio: "Included" });

});
