import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { hvacProject } from "../hvacFixtures";
import { thermalProject, realThermal } from "../thermalFixtures";
import { createRoomUFH } from "../../lib/heatingDesign";
import { cfdWindow, eventually, startBrowserHarness } from "./harness.mjs";

let harness;
before(async () => { harness = await startBrowserHarness({ climoptixEnabled: true }); });
after(async () => { await harness?.close(); });
function fixture() {
  const p = hvacProject(), room = p.rooms[0], s = p.cfdScenarios![0];
  for (const r of p.rooms) r.openings = [];
  p.energyLayout = thermalProject(false).energyLayout;
  p.energyLayout!.existingAssignments = p.energyLayout!.existingAssignments.map(a => ({ ...a, adjacentTemperatureC: 18, ...(a.elementId.endsWith("|floor") ? { boundary: "Ground", adjacentTemperatureC: 10 } : {}) }));
  p.heatingLayout = createRoomUFH(room, p.heatingLayout!).heating;
  p.hvac!.bindings[s.id] = { deviceIds: [], operatingScenarioId: "operation-1", editMode: "design", overrides: {} };
  p.hvac!.scenarios[0].heaterOverrides[p.heatingLayout.ufhZones[0].zoneId] = { enabled: true, actualW: 900 };
  return p;
}
async function cfd(s, tab = "Equipment") {
  await s.page.getByRole("combobox", { name: "Workspace", exact: true }).selectOption("CLIMOPTIX");
  const ui = s.page.getByRole("region", { name: "Climoptix CFD workspace", exact: true }); await cfdWindow(ui, tab); return ui;
}
async function capture(shared, page) {
  const [file] = await Promise.all([page.waitForEvent("download"), shared.getByRole("button", { name: "Export shared boundary package", exact: true }).click()]);
  return JSON.parse(await readFile(await file.path(), "utf8"));
}
async function expand(root, text) { const summary = root.locator("summary").filter({ hasText: text }).first(); if (!(await summary.evaluate(e => e.closest("details").open))) await summary.click(); }
const capturePanel = ui => ui.locator('[aria-label="Shared boundary capture"]:visible');
async function thermalRoutes(context) {
  await context.route("**/climoptix/thermal-*", async route => {
    await route.fulfill({ json: realThermal(route.request().postDataJSON(), route.request().url().endsWith("thermal-preview")) });
  });
}

test("switching to CFD captures checked radiator/UFH watts and fabric; surface editor shows the real combined condition", async t => {
  const p = fixture(), s = await harness.session(p); t.after(() => s.close());
  const ui = await cfd(s), shared = ui.getByLabel("Shared HVAC devices", { exact: true });
  const audit = capturePanel(ui);
  await eventually(() => audit.innerText(), text => text.includes("900.0 W mapped") && text.includes("1000.0 W mapped"));
  const pkg = await capture(shared, s.page), heat = pkg.checkedBoundaryCapture.sources.find(v => v.kind === "ufh");
  assert.equal(heat.status, "applied"); assert.ok(Math.abs(heat.appliedW - 900) < 1e-5);
  const patches = pkg.checkedPatches.filter(p => heat.patchIds.includes(p.id));
  assert.ok(patches.every(p => p.boundary.thermal.type === "heatTransfer"));
  assert.ok(Math.abs(patches.reduce((sum,p) => sum + p.areaM2 * p.boundary.thermal.sourceFluxWm2,0) - 900) < 1e-5);
  await cfdWindow(ui, "Boundaries");
  await ui.getByRole("button", { name: `Edit surface ${patches[0].id}`, exact: true }).click();
  const editor = s.page.getByRole("region", { name: "Edit boundary surface", exact: true });
  const surface = s.page.locator(".floating-toolbar").filter({ has: s.page.getByLabel("Move Edit boundary surface", { exact: true }) });
  const controls = await editor.count() ? editor : surface;
  assert.equal(await controls.getByRole("combobox", { name: "Boundary thermal condition", exact: true }).inputValue(), "heatTransfer");
  assert.equal(await controls.getByRole("combobox", { name: "Boundary thermal condition", exact: true }).isDisabled(), true);
  assert.match(await controls.innerText(), /Additional upward UFH flux/);
  assert.equal(await controls.getByRole("spinbutton", { name: "Ambient temperature (K)", exact: true }).inputValue(), "283.15");
  await s.page.screenshot({ path: "../.local-logs/boundary-capture-surface.png" });
});

test("changing CFD UFH operation off/on refreshes checked boundary power and survives reload", async t => {
  const p = fixture(), s = await harness.session(p); t.after(() => s.close());
  const ui = await cfd(s), shared = ui.getByLabel("Shared HVAC devices", { exact: true }), audit = capturePanel(ui);
  await eventually(() => audit.innerText(), text => text.includes("900.0 W mapped"));
  const source = shared.getByLabel(`Shared heating source · ${p.heatingLayout!.ufhZones[0].name}`, { exact: true });
  await source.locator("summary").click(); await source.getByRole("checkbox").uncheck();
  await eventually(() => audit.innerText(), text => text.includes("Underfloor heating · Off"));
  let pkg = await capture(shared, s.page); assert.equal(pkg.checkedBoundaryCapture.sources.find(v => v.kind === "ufh").appliedW, 0);
  assert.ok(pkg.checkedPatches.every(p => !p.boundary.thermal.sourceFluxWm2));
  await source.getByRole("checkbox").check();
  await eventually(() => audit.innerText(), text => text.includes("900.0 W mapped"));
  await s.page.reload(); await s.page.getByRole("combobox", { name: "Selected floor", exact: true }).waitFor();
  await cfd(s); await eventually(() => audit.innerText(), text => text.includes("900.0 W mapped"));
  pkg = await capture(shared, s.page); assert.equal(pkg.checkedBoundaryCapture.sources.find(v => v.kind === "ufh").status, "applied");
});

test("Insulation source edits return as current checked CFD coefficients without losing source identity", async t => {
  const p = fixture(), s = await harness.session(p); t.after(() => s.close()); await thermalRoutes(s.context);
  const ui = await cfd(s), shared = ui.getByLabel("Shared HVAC devices", { exact: true });
  await eventually(() => capturePanel(ui).innerText(), text => text.includes("900.0 W mapped"));
  const before = await capture(shared, s.page), wallBefore = before.checkedBoundaryCapture.envelope.find(v => v.id.endsWith("wall:0"));
  await cfdWindow(ui, "Boundaries"); await s.page.getByRole("tab", { name: "Thermal", exact: true }).click();
  const thermal = s.page.getByRole("region", { name: "Thermal envelope setup", exact: true });
  await eventually(() => thermal.getByRole("list", { name: "Thermal surfaces" }).getByRole("button").count(), n => n > 2);
  await thermal.getByRole("list", { name: "Thermal surfaces" }).getByRole("button").filter({ hasText: "Wall 1" }).first().click();
  await thermal.getByRole("button", { name: "Edit in Insulation", exact: true }).click();
  const insulation = s.page.getByRole("region", { name: "Energy & Insulation controls", exact: true });
  await insulation.getByRole("button", { name: /Define wall layers/ }).click();
  const layers = s.page.getByRole("dialog", { name: /Define wall layers/ }); await layers.getByRole("button", { name: "Edit layer 1", exact: true }).click();
  const thickness = layers.getByRole("spinbutton", { name: "Layer 1 thickness mm", exact: true }); await thickness.fill("120"); await thickness.press("Enter");
  await layers.getByRole("button", { name: "Done", exact: true }).click();
  await eventually(s.saved, p => p.energyLayout.assemblies.some(a => a.layers.some(l => l.thicknessMm === 120)));
  await s.page.getByRole("button", { name: "Return to Climoptix", exact: true }).click({ noWaitAfter: true }); await cfdWindow(ui, "Equipment");
  const expected = 1 / (120 / 1000 / .04 + .04);
  await eventually(() => capturePanel(ui).innerText(), text => text.includes("900.0 W mapped"));
  const after = await capture(shared, s.page), wallAfter = after.checkedBoundaryCapture.envelope.find(v => v.id.endsWith("wall:0"));
  assert.ok(Math.abs(wallAfter.coefficientWm2K - expected) < 1e-8);
  assert.ok(wallAfter.coefficientWm2K < wallBefore.coefficientWm2K);
  assert.equal(wallAfter.status, "applied");
});

for (const [width,height,dark] of [[390,844,false],[820,1180,true]] as const) test(`boundary capture remains native and usable at ${width}px`, async t => {
  const p = fixture(); p.hvac!.scenarios[0].name = "A reviewed operating scenario with a long descriptive name";
  const s = await harness.session(p, { viewport: { width, height } }); t.after(() => s.close());
  if (dark) await s.page.emulateMedia({ colorScheme: "dark" });
  const ui = await cfd(s), capture = capturePanel(ui);
  await eventually(() => capture.innerText(), text => text.includes("900.0 W mapped"));
  await expand(capture, "Insulation boundary regions");
  assert.ok(await s.page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 2));
  await s.page.screenshot({ path: `../.local-logs/boundary-capture-${width}.png` });
});

test("unlocated people/equipment/solar/infiltration inputs cannot show a falsely complete capture", async t => {
  const p = fixture(); Object.assign(p.hvac!.scenarios[0].conditions, { occupants: 2, sensibleWPerson: 75, equipmentW: 200, solarW: 100, infiltrationM3S: .01 });
  const s = await harness.session(p); t.after(() => s.close()); const ui = await cfd(s), panel = capturePanel(ui);
  await eventually(() => panel.innerText(), text => text.includes("People gains · Needs input") && text.includes("Infiltration · Needs input"));
  const pkg = await capture(ui.getByLabel("Shared HVAC devices", { exact: true }), s.page);
  assert.equal(pkg.checkedBoundaryCapture.state, "review");
  const unmapped = pkg.checkedBoundaryCapture.sources.filter(s => ["people", "equipment", "solar", "infiltration"].includes(s.kind));
  assert.equal(unmapped.length, 4); assert.ok(unmapped.every(s => s.appliedW === 0 && !s.patchIds.length));
  await s.page.screenshot({ path: "../.local-logs/boundary-capture-unlocated.png" });
});
