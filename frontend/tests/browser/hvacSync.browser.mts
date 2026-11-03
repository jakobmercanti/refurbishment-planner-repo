import { conventionalHvac } from "../../lib/hvacHeating";
import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { hvacProject } from "../hvacFixtures";
import { createRoomUFH } from "../../lib/heatingDesign";
import { duplicateFloor, projectFloors, selectFloor } from "../../lib/buildingDocument";
import { hvacBoundaryPackage, resolveHvacScenario } from "../../lib/hvacBridge";
import { labelFor } from "../../components/CFDFields";
import { eventually, menu, startBrowserHarness, cfdWindow } from "./harness.mjs";

let harness;
before(async () => { harness = await startBrowserHarness({ climoptixEnabled: true }); });
after(async () => { await harness?.close(); });
async function dismiss(page) {
  const buttons = page.locator(".floating-toolbar:not(.heating-layout-window) .floating-toolbar-close:visible");
  while (await buttons.count()) {
    const i = await buttons.evaluateAll(els => els.map((e, i) => ({ i, z: Number(getComputedStyle(e.closest(".floating-toolbar")).zIndex) || 0 })).sort((a, b) => b.z - a.z || b.i - a.i)[0].i);
    await buttons.nth(i).click();
  }
}
async function heating(s, tab = "Heating") {
  await dismiss(s.page); await menu(s.page, "Tools", "Heating Layout");
  const panel = s.page.locator(".heating-layout-window");
  await panel.getByRole("tab", { name: tab, exact: true }).click(); return panel;
}
async function cfd(s, tab = "Equipment") {
  await s.page.getByRole("combobox", { name: "Workspace", exact: true }).selectOption("CLIMOPTIX");
  const ui = s.page.getByRole("region", { name: "Climoptix CFD workspace", exact: true }); await cfdWindow(ui, tab); return ui;
}
async function number(panel, label, value) { const field = panel.getByRole("spinbutton", { name: label, exact: true }); await field.fill(String(value)); await field.press("Enter"); }
async function expand(panel, title) { const summary = panel.locator("summary").filter({ hasText: title }).first(); if (!(await summary.evaluate(e => e.closest("details").open))) await summary.click(); }
async function packageFrom(shared, page) {
  const [file] = await Promise.all([page.waitForEvent("download"), shared.getByRole("button", { name: "Export shared boundary package", exact: true }).click()]);
  return JSON.parse(await readFile(await file.path(), "utf8"));
}

test("an existing CFD case receives conventional vents without handoff; inverse edits, undo and reload agree", async t => {
  const p = hvacProject(); delete p.hvac;
  const s = await harness.session(p); t.after(() => s.close());
  const panel = await heating(s, "Ventilation");
  await panel.getByRole("button", { name: "Check room geometry", exact: true }).click();
  await eventually(() => panel.innerText(), text => text.includes("Geometry checked"));
  await panel.getByRole("button", { name: "Add supply inlet", exact: true }).click();
  await number(panel, "Volume flow (L/s)", 80);
  await expand(panel, "Room air & design conditions"); await number(panel, "Room setpoint (°C)", 23);
  let saved = await eventually(s.saved, p => p.hvac?.devices[0]?.vent.valueSI === .08 && p.hvac.scenarios.length === 1);
  const id = saved.hvac.devices[0].vent.id, opId = saved.hvac.scenarios[0].id;
  const ui = await cfd(s), shared = ui.getByLabel("Shared HVAC devices", { exact: true });
  await shared.getByRole("combobox", { name: "CFD shared operating scenario", exact: true }).selectOption(opId);
  await ui.getByRole("button", { name: "Edit Supply 1", exact: true }).click();
  assert.equal(await ui.getByRole("spinbutton", { name: "Volume flow (L/s)", exact: true }).inputValue(), "80");
  await number(ui, "Vent width (mm)", 550); await number(ui, "Volume flow (L/s)", 90);
  const editor = ui.getByRole("region", { name: "Equipment editor", exact: true }); await editor.getByRole("button", { name: "Done", exact: true }).click();
  await shared.getByRole("combobox", { name: "CFD vent edit scope", exact: true }).selectOption("override");
  await ui.getByRole("button", { name: "Edit Supply 1", exact: true }).click(); await number(ui, "Volume flow (L/s)", 120); await editor.getByRole("button", { name: "Done", exact: true }).click();
  saved = await eventually(s.saved, p => p.hvac.scenarios[0].ventOverrides[id]?.valueSI === .12);
  assert.equal(saved.hvac.devices[0].vent.valueSI, .09); assert.equal(saved.hvac.devices[0].vent.widthMm, 550);
  await s.page.screenshot({ path: "../.local-logs/hvac-sync-cfd.png" });
  await shared.getByRole("button", { name: "Open Ventilation", exact: true }).click();
  await expand(panel, "Scenario override · retain design flow and temperature");
  await eventually(() => panel.getByRole("spinbutton", { name: "Scenario volume flow (L/s)", exact: true }).inputValue(), value => value === "120");
  await number(panel, "Vent width (mm)", 600);
  await panel.getByRole("button", { name: "Undo HVAC", exact: true }).click(); await eventually(s.saved, p => p.hvac.devices[0].vent.widthMm === 550);
  await panel.getByRole("button", { name: "Redo HVAC", exact: true }).click(); await eventually(s.saved, p => p.hvac.devices[0].vent.widthMm === 600);
  await s.page.reload(); await s.page.getByRole("combobox", { name: "Selected floor", exact: true }).waitFor();
  const reloaded = await cfd(s); await reloaded.getByRole("button", { name: "Edit Supply 1", exact: true }).click();
  assert.equal(await reloaded.getByRole("spinbutton", { name: "Volume flow (L/s)", exact: true }).inputValue(), "120");
  assert.equal(await reloaded.getByRole("spinbutton", { name: "Vent width (mm)", exact: true }).inputValue(), "600");
});

test("Heating-only radiator dimensions, rating and deletion update the existing CFD case and undo restores one source", async t => {
  const p = hvacProject(); delete p.hvac;
  const s = await harness.session(p); t.after(() => s.close()); const panel = await heating(s);
  await panel.getByRole("tab", { name: "Heating elements", exact: true }).click(); await expand(panel, "Heating elements in Living room");
  await panel.getByLabel("Edit heating element User reference radiator", { exact: true }).click();
  const radiator = s.page.getByRole("region", { name: "Heating element editor", exact: true });
  await number(radiator, "Width mm", 750); await expand(radiator, "Heating technical specifications"); await number(radiator, "Rated output W", 1600);
  await radiator.getByRole("button", { name: "Done", exact: true }).click();
  const prepared = s.page.waitForResponse(r => r.url().endsWith("/climoptix/prepare") && r.ok());
  const ui = await cfd(s), shared = ui.getByLabel("Shared HVAC devices", { exact: true });
  await shared.locator("details").first().locator("summary").click();
  await eventually(() => shared.innerText(), text => text.includes("1600.0 W"));
  const report = await (await prepared).json(), source = report.objects.find(o => o.id === p.rooms[0].obstacles[0].id);
  assert.equal(source.heatW, 1600);
  const extent = axis => Math.max(...source.verticesMm.map(v => v[axis])) - Math.min(...source.verticesMm.map(v => v[axis]));
  assert.ok(Math.abs(Math.max(extent(0), extent(1)) - 750) < 1e-6);
  let pkg = await packageFrom(shared, s.page); assert.equal(pkg.heaters.length, 1); assert.equal(pkg.heaters[0].watts, 1600);
  await cfdWindow(ui, "Domain"); await number(ui, labelFor("baseCellMm"), 180);
  await eventually(s.saved, p => p.cfdScenarios[0].mesh.baseCellMm === 180);
  await cfdWindow(ui, "Equipment"); await shared.getByRole("button", { name: "Edit shared Heating geometry", exact: true }).click();
  await panel.getByRole("tab", { name: "Heating elements", exact: true }).click(); await expand(panel, "Heating elements in Living room");
  await panel.getByLabel("Edit heating element User reference radiator", { exact: true }).click();
  await radiator.getByRole("button", { name: "Delete heater", exact: true }).click();
  await eventually(s.saved, p => p.rooms[0].obstacles.length === 0);
  await cfd(s); pkg = await packageFrom(shared, s.page); assert.equal(pkg.heaters.length, 0); assert.equal(pkg.caseSettings.assetOverrides.length, 0);
  await shared.getByRole("button", { name: "Edit shared Heating geometry", exact: true }).click();
  await panel.getByRole("button", { name: "Undo heating", exact: true }).click();
  const restored = await eventually(s.saved, p => p.rooms[0].obstacles.length === 1);
  assert.equal(hvacBoundaryPackage(restored, restored.cfdScenarios[0]).heaters[0].watts, 1600);
});

test("UFH floor settings export live and CFD operating watts are shared with conventional calculations and Heating status", async t => {
  const p = hvacProject(), caseId = p.cfdScenarios![0].id;
  p.heatingLayout = createRoomUFH(p.rooms[0], p.heatingLayout!).heating;
  p.hvac!.bindings[caseId] = { deviceIds: [], operatingScenarioId: "operation-1", editMode: "design", overrides: {} };
  const zone = p.heatingLayout.ufhZones[0];
  const s = await harness.session(p); t.after(() => s.close()); const panel = await heating(s);
  await panel.getByRole("tab", { name: "Underfloor", exact: true }).click();
  await panel.getByRole("button", { name: "UFH system, floor & pipe settings…", exact: true }).click();
  const floor = s.page.getByRole("textbox", { name: "Floor build-up", exact: true }); await floor.fill("Reviewed timber build-up"); await floor.press("Tab");
  const settings = s.page.locator(".floating-toolbar").filter({ has: s.page.getByLabel("Move Heating — UFH system, floor & pipe settings", { exact: true }) });
  await settings.getByRole("button", { name: "Done", exact: true }).click();
  const ui = await cfd(s), shared = ui.getByLabel("Shared HVAC devices", { exact: true });
  const pkg = await packageFrom(shared, s.page), ufh = pkg.heaters.find(h => h.id === zone.zoneId);
  assert.equal(ufh.footprint.zone.floorConstruction, "Reviewed timber build-up"); assert.ok(ufh.footprint.circuits.length > 0);
  const details = shared.getByLabel(`Shared heating source · ${zone.name}`, { exact: true });
  await details.locator("summary").click(); await number(details, `Scenario effective output · ${zone.name} (W)`, 900);
  const saved = await eventually(s.saved, p => p.hvac.scenarios[0].heaterOverrides[zone.zoneId]?.actualW === 900);
  assert.equal(conventionalHvac(saved, saved.hvac.scenarios[0]).heatingW, 1900);
  await shared.getByRole("button", { name: "Edit shared Heating geometry", exact: true }).click();
  await expand(panel, "HVAC operating overrides"); assert.match(await panel.innerText(), /900 W effective room input/);
  assert.equal((await s.saved()).heatingLayout.ufhZones[0].floorConstruction, "Reviewed timber build-up");
});

test("CFD room physics and Ventilation conditions update the same selected operation without changing its sibling", async t => {
  const p = hvacProject(), caseId = p.cfdScenarios![0].id;
  const sibling = { ...structuredClone(p.hvac!.scenarios[0]), id: "sibling-operation", name: "Other conditions" }; p.hvac!.scenarios.push(sibling);
  p.hvac!.bindings[caseId] = { deviceIds: [], operatingScenarioId: "operation-1", editMode: "design", overrides: {} };
  const s = await harness.session(p); t.after(() => s.close()); const ui = await cfd(s, "Physics");
  await number(ui, "Air density (kg/m³)", 1.3); await number(ui, "Heat capacity (J/kg·K)", 1010);
  let saved = await eventually(s.saved, p => p.hvac.scenarios[0].conditions.densityKgM3 === 1.3 && p.hvac.scenarios[0].conditions.cpJKgK === 1010);
  assert.equal(saved.hvac.scenarios[1].conditions.densityKgM3, 1.2);
  await cfdWindow(ui, "Equipment"); const shared = ui.getByLabel("Shared HVAC devices", { exact: true }); await shared.getByRole("button", { name: "Open Ventilation", exact: true }).click();
  const panel = s.page.locator(".heating-layout-window"); await expand(panel, "Room air & design conditions");
  await expand(panel, "Advanced & validation");
  assert.equal(await panel.getByRole("spinbutton", { name: "Air density (kg/m³)", exact: true }).inputValue(), "1.3");
  await number(panel, "Room setpoint (°C)", 24);
  saved = await eventually(s.saved, p => p.hvac.scenarios.find(op => op.id === "operation-1").conditions.roomC === 24);
  assert.equal(resolveHvacScenario(saved, saved.cfdScenarios[0]).physics.referenceTemperatureK, 297.15);
  await cfd(s); await shared.getByRole("combobox", { name: "CFD shared operating scenario", exact: true }).selectOption("sibling-operation");
  await eventually(s.saved, p => p.hvac.activeScenarioId === "sibling-operation");
  await shared.getByRole("button", { name: "Open Ventilation", exact: true }).click();
  assert.equal(await panel.getByRole("combobox", { name: "HVAC operating scenario", exact: true }).inputValue(), "sibling-operation");
  await expand(panel, "Room air & design conditions");
  assert.equal(await panel.getByRole("spinbutton", { name: "Room setpoint (°C)", exact: true }).inputValue(), "25");
});

test("a radiator's CFD source link opens Heating on its actual floor and selected room", async t => {
  let p = hvacProject(); const ground = projectFloors(p)[0].id;
  p = duplicateFloor(p, ground); const upper = projectFloors(p).find(f => f.id !== ground)!, target = upper.content.rooms[1];
  const heater = upper.content.rooms[0].obstacles[0]; upper.content.rooms[0].obstacles = []; target.obstacles = [{ ...heater, center: { x: target.vertices[0].x + 500, y: target.vertices[0].y + 150 } }];
  p.cfdScenarios![0].seed = { floorId: upper.id, roomId: target.id }; p = selectFloor(p, ground);
  const s = await harness.session(p); t.after(() => s.close()); const ui = await cfd(s);
  const row = ui.locator(".cfx-device-row").filter({ has: s.page.getByRole("button", { name: "Select User reference radiator", exact: true }) });
  await row.getByRole("button", { name: "Edit in Heating", exact: true }).click();
  const panel = s.page.locator(".heating-layout-window");
  await eventually(() => panel.getByRole("combobox", { name: "Selected room", exact: true }).inputValue(), value => value === target.id);
  assert.equal(await s.page.getByRole("combobox", { name: "Selected floor", exact: true }).inputValue(), upper.id);
  await s.page.screenshot({ path: "../.local-logs/hvac-sync-heating-source.png" });
});

test("connecting an older case preserves its own air settings until a shared operation is explicitly selected", async t => {
  const p = hvacProject(); p.cfdScenarios![0].physics.referenceTemperatureK = 294.15;
  const s = await harness.session(p); t.after(() => s.close()); const ui = await cfd(s);
  const shared = ui.getByLabel("Shared HVAC devices", { exact: true }), source = shared.getByRole("combobox", { name: "CFD shared operating scenario", exact: true });
  assert.equal(await source.inputValue(), "");
  let pkg = await packageFrom(shared, s.page); assert.equal(pkg.caseSettings.physics.referenceTemperatureK, 294.15); assert.equal(pkg.operatingScenarioId, null);
  await source.selectOption("operation-1");
  await eventually(s.saved, p => p.hvac.bindings[p.cfdScenarios[0].id].operatingScenarioId === "operation-1");
  pkg = await packageFrom(shared, s.page); assert.equal(pkg.caseSettings.physics.referenceTemperatureK, 298.15); assert.equal(pkg.conditions.roomC, 25);
  await source.scrollIntoViewIfNeeded(); await s.page.screenshot({ path: "../.local-logs/hvac-sync-operating-link.png" });
});
