import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { hvacProject } from "../hvacFixtures";
import { resolveHvacVents } from "../../lib/hvacDocument";
import { eventually, menu, startBrowserHarness } from "./harness.mjs";

let harness;
before(async () => { harness = await startBrowserHarness({ climoptixEnabled: true }); await mkdir("../.local-logs/hvac-qa", { recursive: true }); });
after(async () => { await harness?.close(); });
async function openVentilation(session) {
  await dismissOtherWindows(session.page);
  await menu(session.page, "Tools", "Heating Layout");
  const panel = session.page.locator(".heating-layout-window");
  await panel.getByRole("tab", { name: "Ventilation", exact: true }).click();
  return panel;
}
async function enter(panel, label, value) { const input = panel.getByRole("spinbutton", { name: label, exact: true }); await input.fill(String(value)); await input.press("Enter"); }
async function dismissOtherWindows(page) {
  const close = page.locator(".floating-toolbar:not(.heating-layout-window) .floating-toolbar-close:visible");
  while (await close.count()) {
    const index = await close.evaluateAll(buttons => buttons.map((button, index) => ({ index, z: Number(getComputedStyle(button.closest(".floating-toolbar")).zIndex) || 0 })).sort((a, b) => b.z - a.z || b.index - a.index)[0].index);
    await close.nth(index).click();
  }
}

test("native top tabs preserve Heating and canonical vent CRUD, units, validation and undo", async t => {
  const s = await harness.session(hvacProject()); t.after(() => s.close());
  const panel = await openVentilation(s); await dismissOtherWindows(s.page);
  await panel.getByRole("button", { name: "Add supply inlet", exact: true }).click();
  await enter(panel, "Volume flow (L/s)", 100);
  await enter(panel, "Vent width (mm)", 450);
  const name = panel.getByRole("textbox", { name: "Vent name", exact: true }); await name.fill("Supply north"); await name.press("Enter");
  let saved = await eventually(s.saved, p => p.hvac.devices[0]?.vent.name === "Supply north" && p.hvac.devices[0]?.vent.valueSI === .1);
  const id = saved.hvac.devices[0].vent.id;
  assert.equal(saved.hvac.devices[0].vent.widthMm, 450);
  await panel.getByRole("combobox", { name: "Flow display unit", exact: true }).selectOption("m³/h");
  assert.equal(await panel.getByRole("spinbutton", { name: "Volume flow (m³/h)", exact: true }).inputValue(), "360");
  await enter(panel, "Volume flow (m³/h)", -1); await panel.getByRole("alert").waitFor();
  assert.equal((await s.saved()).hvac.devices[0].vent.valueSI, .1);
  await panel.getByRole("button", { name: "Duplicate Supply north", exact: true }).click();
  saved = await eventually(s.saved, p => p.hvac.devices.length === 2); assert.notEqual(saved.hvac.devices[1].vent.id, id);
  s.page.once("dialog", d => d.accept()); await panel.getByRole("button", { name: "Remove Supply north copy", exact: true }).click();
  await eventually(s.saved, p => p.hvac.devices.length === 1);
  await panel.getByRole("button", { name: "Undo HVAC", exact: true }).click(); await eventually(s.saved, p => p.hvac.devices.length === 2);
  await panel.getByRole("button", { name: "Redo HVAC", exact: true }).click(); await eventually(s.saved, p => p.hvac.devices.length === 1);
  await panel.getByRole("tab", { name: "Heating", exact: true }).click(); await panel.getByRole("tab", { name: "Underfloor", exact: true }).waitFor();
  await panel.getByRole("tab", { name: "Ventilation", exact: true }).click();
  await panel.getByRole("button", { name: "Supply north · Supply · Design", exact: true }).click();
  assert.equal(await panel.getByRole("combobox", { name: "Flow display unit", exact: true }).inputValue(), "m³/h");
  await panel.getByRole("tab", { name: "Heating", exact: true }).click();
  assert.equal((await s.saved()).rooms[0].obstacles[0].heating_spec.ratedOutputW, 1000);
  await s.page.screenshot({ path: "../.local-logs/hvac-qa/heating-tabs.png" });
});

test("real preflight opens exact shared CFD case; CFD permanent and operating edits return to Ventilation", async t => {
  const s = await harness.session(hvacProject()); t.after(() => s.close());
  const panel = await openVentilation(s); await dismissOtherWindows(s.page);
  await panel.getByRole("button", { name: "Check room geometry", exact: true }).click();
  await eventually(() => panel.innerText(), text => text.includes("Geometry checked"));
  await panel.getByRole("button", { name: "Add supply inlet", exact: true }).click();
  await enter(panel, "Volume flow (L/s)", 100);
  await eventually(s.saved, p => p.hvac.devices[0]?.vent.host.patchId !== "unassigned");
  await panel.getByRole("button", { name: "Evaluate in CFD", exact: true }).click();
  const preflight = panel.getByLabel("HVAC CFD preflight", { exact: true }); await preflight.waitFor();
  assert.match(await preflight.innerText(), /1000 W/);
  assert.match(await preflight.innerText(), /Thermal execution is not connected/);
  await preflight.getByRole("button", { name: "Create new case & open in CFD", exact: true }).click();
  const ui = s.page.getByRole("region", { name: "Climoptix CFD workspace", exact: true });
  const shared = ui.getByLabel("Shared HVAC devices", { exact: true }); await shared.waitFor();
  let saved = await eventually(s.saved, p => p.hvac.snapshots.length === 1); const caseId = saved.hvac.snapshots[0].caseId;
  assert.equal(saved.cfdScenarios.find(c => c.id === caseId).vents.length, 0);
  assert.equal(resolveHvacVents(saved, saved.cfdScenarios.find(c => c.id === caseId)).length, 1);
  await ui.getByRole("button", { name: /Edit Supply 1/, exact: false }).first().click();
  await enter(ui, "Volume flow (L/s)", 125);
  const editor = ui.getByRole("region", { name: "Equipment editor", exact: true }); await editor.getByRole("button", { name: "Done", exact: true }).click();
  saved = await eventually(s.saved, p => p.hvac.devices[0].vent.valueSI === .125);
  await shared.getByRole("combobox", { name: "CFD vent edit scope", exact: true }).selectOption("override");
  await ui.getByRole("button", { name: /Edit Supply 1/, exact: false }).first().click(); await enter(ui, "Volume flow (L/s)", 150); await editor.getByRole("button", { name: "Done", exact: true }).click();
  saved = await eventually(s.saved, p => p.hvac.scenarios[0].ventOverrides[p.hvac.devices[0].vent.id]?.valueSI === .15);
  assert.equal(saved.hvac.devices[0].vent.valueSI, .125);
  const radiatorDetails = shared.locator("details").first(); await radiatorDetails.locator("summary").click();
  await enter(radiatorDetails, "Scenario effective output · User reference radiator (W)", -1);
  await shared.getByRole("alert").waitFor();
  assert.notEqual((await s.saved()).hvac.scenarios[0].heaterOverrides[Object.keys((await s.saved()).hvac.scenarios[0].heaterOverrides)[0]]?.actualW, -1);
  await radiatorDetails.getByRole("checkbox").uncheck();
  await shared.getByRole("button", { name: "Open Ventilation", exact: true }).click();
  await panel.getByRole("tab", { name: "Ventilation", exact: true }).waitFor();
  assert.doesNotMatch(await panel.getByRole("combobox", { name: "Vent host face", exact: true }).innerText(), /Missing host/);
  assert.match(await panel.innerText(), /Scenario override/); assert.match(await panel.innerText(), /CFD case outdated/);
  const snapBefore = JSON.stringify((await s.saved()).hvac.snapshots[0]);
  await enter(panel, "Vent width (mm)", 600); await eventually(s.saved, p => p.hvac.devices[0].vent.widthMm === 600);
  assert.equal(JSON.stringify((await s.saved()).hvac.snapshots[0]), snapBefore);
  await s.page.screenshot({ path: "../.local-logs/hvac-qa/roundtrip.png" });
});

test("room filtering, scenario presets, saved identity and reload remain deterministic", async t => {
  const s = await harness.session(hvacProject()); t.after(() => s.close()); const panel = await openVentilation(s); await dismissOtherWindows(s.page);
  await panel.getByRole("button", { name: "Add return", exact: true }).click(); const saved = await eventually(s.saved, p => p.hvac.devices.length === 1); const id = saved.hvac.devices[0].vent.id;
  await panel.getByRole("combobox", { name: "Ventilation room", exact: true }).selectOption("room-1"); assert.equal(await panel.getByRole("button", { name: "Remove Return 1", exact: true }).count(), 0);
  await panel.getByRole("combobox", { name: "Ventilation room", exact: true }).selectOption("room-0"); await panel.getByRole("button", { name: "Remove Return 1", exact: true }).waitFor();
  await panel.locator("summary").filter({ hasText: "Room air & design conditions" }).click();
  await panel.getByRole("combobox", { name: "New HVAC scenario preset", exact: true }).selectOption("Summer cooling");
  await eventually(s.saved, p => p.hvac.scenarios.some(op => op.name === "Summer cooling" && op.conditions.roomC === 25));
  await s.page.reload(); await s.page.getByRole("combobox", { name: "Selected floor", exact: true }).waitFor();
  const reloaded = await openVentilation(s); await reloaded.getByRole("button", { name: "Remove Return 1", exact: true }).waitFor();
  assert.equal((await s.saved()).hvac.devices[0].vent.id, id);
});

for (const [label, width, height] of [["desktop", 1440, 1000], ["tablet", 820, 1180], ["phone", 390, 844]] as const) test(`${label}: keyboard tabs and compact HVAC controls render without page overflow`, async t => {
  const s = await harness.session(hvacProject(), { viewport: { width, height } }); t.after(() => s.close()); const panel = await openVentilation(s); await dismissOtherWindows(s.page);
  const tab = panel.getByRole("tab", { name: "Ventilation", exact: true }); await tab.focus(); await tab.press("ArrowLeft"); assert.equal(await panel.getByRole("tab", { name: "Heating", exact: true }).getAttribute("aria-selected"), "true");
  await panel.getByRole("tab", { name: "Heating", exact: true }).press("ArrowRight");
  await panel.getByRole("button", { name: "Add supply inlet", exact: true }).click();
  const box = await panel.boundingBox(); assert.ok(box.x >= 0 && box.x + box.width <= width + 2, JSON.stringify(box));
  assert.ok(await s.page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 2));
  await s.page.screenshot({ path: `../.local-logs/hvac-qa/${label}.png` });
});

test("unavailable preflight reports a real error and never fabricates a completed case", async t => {
  const s = await harness.session(hvacProject()); t.after(() => s.close()); await s.context.route("**/climoptix/prepare", route => route.fulfill({ status: 503, json: { detail: "Preparation unavailable" } }));
  const panel = await openVentilation(s); await panel.getByRole("button", { name: "Evaluate in CFD", exact: true }).click();
  await eventually(() => panel.getByRole("alert").innerText(), text => text.includes("Preparation unavailable"));
  assert.equal((await s.saved()).hvac.snapshots.length, 0); assert.equal(await panel.getByRole("button", { name: "Create new case & open in CFD", exact: true }).count(), 0);
});
