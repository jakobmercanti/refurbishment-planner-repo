import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { hvacProject } from "../hvacFixtures";
import { realPreparation } from "../climoptixFixtures";
import { duplicateFloor, projectFloors, selectFloor } from "../../lib/buildingDocument";
import { resolveHvacVents } from "../../lib/hvacDocument";
import { eventually, menu, startBrowserHarness, cfdWindow } from "./harness.mjs";

let harness;
before(async () => { harness = await startBrowserHarness({ climoptixEnabled: true }); await mkdir("../.local-logs/hvac-reaudit-qa", { recursive: true }); });
after(async () => { await harness?.close(); });
async function dismiss(page) {
  const buttons = page.locator(".floating-toolbar:not(.heating-layout-window) .floating-toolbar-close:visible");
  while (await buttons.count()) {
    const i = await buttons.evaluateAll(els => els.map((e, i) => ({ i, z: Number(getComputedStyle(e.closest(".floating-toolbar")).zIndex) || 0 })).sort((a, b) => b.z - a.z || b.i - a.i)[0].i);
    await buttons.nth(i).click();
  }
}
async function ventilation(s) { await dismiss(s.page); await menu(s.page, "Tools", "Heating Layout"); const panel = s.page.locator(".heating-layout-window"); await panel.getByRole("tab", { name: "Ventilation", exact: true }).click(); return panel; }
async function number(panel, label, value) { const field = panel.getByRole("spinbutton", { name: label, exact: true }); await field.fill(String(value)); await field.press("Enter"); }
async function details(panel, label) { const summary = panel.locator("summary").filter({ hasText: label }).first(); if (!(await summary.evaluate(e => e.closest("details").open))) await summary.click(); }

test("two untouched rooms retain separate default scenario identities and temperatures", async t => {
  const p = hvacProject(); p.hvac!.scenarios = []; p.hvac!.activeScenarioId = null;
  const s = await harness.session(p); t.after(() => s.close()); const panel = await ventilation(s);
  await details(panel, "Room air & design conditions"); await number(panel, "Room setpoint (°C)", 24);
  await eventually(s.saved, p => p.hvac.scenarios.length === 1);
  await panel.getByRole("combobox", { name: "Ventilation room", exact: true }).selectOption("room-1"); await number(panel, "Room setpoint (°C)", 23);
  const saved = await eventually(s.saved, p => p.hvac.scenarios.length === 2);
  assert.equal(new Set(saved.hvac.scenarios.map(s => s.id)).size, 2);
  assert.equal(saved.hvac.scenarios.find(s => s.roomId === "room-0").conditions.roomC, 24);
  await panel.getByRole("combobox", { name: "Ventilation room", exact: true }).selectOption("room-0");
  assert.equal(await panel.getByRole("spinbutton", { name: "Room setpoint (°C)", exact: true }).inputValue(), "24");
});
test("switching rooms during preflight cannot publish a case for the previous room", async t => {
  const s = await harness.session(hvacProject()); t.after(() => s.close()); const panel = await ventilation(s);
  let entered, release, completed;
  const started = new Promise(resolve => { entered = resolve; }), gate = new Promise(resolve => { release = resolve; }), finished = new Promise(resolve => { completed = resolve; });
  await s.context.route("**/climoptix/prepare", async route => {
    entered(); await gate;
    try { await route.fulfill({ json: realPreparation(route.request().postDataJSON()) }); } catch { /* Expected when the room switch aborts this request. */ } finally { completed(); }
  });
  await panel.getByRole("button", { name: "Evaluate same configuration in CFD", exact: true }).click(); await started;
  await panel.getByRole("combobox", { name: "Ventilation room", exact: true }).selectOption("room-1"); release(); await finished;
  assert.equal(await panel.getByLabel("HVAC CFD preflight", { exact: true }).count(), 0);
  assert.equal(await panel.getByRole("button", { name: "Evaluate same configuration in CFD", exact: true }).isEnabled(), true);
  assert.equal((await s.saved()).hvac.snapshots.length, 0);
});

test("an existing case immediately includes conventional additions, return edits and inverse CFD additions", async t => {
  const p = hvacProject(), caseId = p.cfdScenarios![0].id;
  p.cfdScenarios!.push({ ...structuredClone(p.cfdScenarios![0]), id: "other-case", name: "Sibling" });
  for (const c of p.cfdScenarios!) p.hvac!.bindings[c.id] = { deviceIds: [], operatingScenarioId: "operation-1", editMode: "design", overrides: {} };
  const s = await harness.session(p); t.after(() => s.close()); const panel = await ventilation(s);
  await panel.getByRole("button", { name: "Add return", exact: true }).click();
  await details(panel, "Scenario override · retain design flow and temperature");
  await number(panel, "Scenario relative pressure (Pa)", -12);
  await eventually(s.saved, p => Object.values(p.hvac.scenarios[0].ventOverrides).some(o => o.valueSI === -12));
  await panel.getByRole("combobox", { name: "Outlet air path", exact: true }).selectOption("exhaust");
  let saved = await eventually(s.saved, p => p.hvac.devices[0]?.extractKind === "exhaust");
  assert.equal(resolveHvacVents(saved, saved.cfdScenarios.find(c => c.id === caseId)).length, 1);
  await s.page.getByRole("combobox", { name: "Workspace", exact: true }).selectOption("CLIMOPTIX");
  const ui = s.page.getByRole("region", { name: "Climoptix CFD workspace", exact: true }); await cfdWindow(ui, "Equipment");
  await ui.getByRole("button", { name: "Select Return 1", exact: true }).waitFor();
  await ui.getByRole("button", { name: "+ Supply", exact: true }).click();
  const editor = ui.getByRole("region", { name: "Equipment editor", exact: true }); await editor.getByRole("button", { name: "Done", exact: true }).click();
  await ui.getByRole("button", { name: "Delete Return 1", exact: true }).click();
  saved = await eventually(s.saved, p => p.hvac.devices.length === 1 && p.hvac.devices[0].vent.role === "supply");
  assert.equal(resolveHvacVents(saved, saved.cfdScenarios.find(c => c.id === "other-case")).length, 1);
  await cfdWindow(ui, "Physics"); await ui.getByRole("button", { name: "Import insulation & heating conditions", exact: true }).click();
  const importer = s.page.locator(".floating-toolbar").filter({ has: s.page.getByLabel("Move Import insulation & heating conditions", { exact: true }) });
  assert.equal(await importer.getByRole("button", { name: "Apply selected heating conditions", exact: true }).count(), 0);
  await importer.getByLabel("Shared HVAC devices", { exact: true }).getByRole("button", { name: "Open Ventilation", exact: true }).click();
  await panel.getByRole("button", { name: "Remove Supply vent", exact: true }).waitFor();
  assert.equal(await panel.getByRole("button", { name: "Remove Return 1", exact: true }).count(), 0);
});

test("conventional plan drag commits measured host coordinates, undo and Escape without stale copies", async t => {
  const p = hvacProject(); delete p.hvac; p.cfdScenarios = [];
  const s = await harness.session(p); t.after(() => s.close()); const panel = await ventilation(s);
  await panel.getByRole("button", { name: "Check room geometry", exact: true }).click();
  await eventually(() => panel.innerText(), text => text.includes("Geometry checked"));
  await panel.getByRole("button", { name: "Add supply inlet", exact: true }).click();
  assert.doesNotMatch(await panel.getByRole("combobox", { name: "Vent host face", exact: true }).innerText(), /Missing host/);
  const before = await eventually(s.saved, p => p.hvac?.devices.length === 1);
  const marker = panel.getByRole("button", { name: "Select Supply 1 in plan", exact: true }); await marker.scrollIntoViewIfNeeded();
  let box = await marker.boundingBox(); await s.page.mouse.move(box.x + box.width / 2, box.y + box.height / 2); await s.page.mouse.down(); await s.page.mouse.move(box.x + box.width / 2 + 12, box.y + box.height / 2, { steps: 5 }); await s.page.mouse.up();
  const moved = await eventually(s.saved, p => Math.abs(p.hvac.devices[0].vent.host.u - before.hvac.devices[0].vent.host.u) > .01);
  await marker.scrollIntoViewIfNeeded(); box = await marker.boundingBox(); await s.page.mouse.move(box.x + box.width / 2, box.y + box.height / 2); await s.page.mouse.down(); await s.page.mouse.move(box.x + box.width / 2 + 12, box.y + box.height / 2, { steps: 5 }); await s.page.keyboard.press("Escape"); await s.page.mouse.up();
  assert.deepEqual((await s.saved()).hvac.devices[0].vent.host, moved.hvac.devices[0].vent.host);
  await panel.getByRole("button", { name: "Undo HVAC", exact: true }).click();
  await eventually(s.saved, p => JSON.stringify(p.hvac.devices[0].vent.host) === JSON.stringify(before.hvac.devices[0].vent.host));
});

test("CFD source navigation selects the source floor and room", async t => {
  let p = hvacProject(); const ground = projectFloors(p)[0].id;
  p = duplicateFloor(p, ground); const upper = projectFloors(p).find(f => f.id !== ground)!, room = upper.content.rooms[1];
  const c = p.cfdScenarios![0]; c.seed = { floorId: upper.id, roomId: room.id };
  p.hvac!.scenarios[0] = { ...p.hvac!.scenarios[0], floorId: upper.id, roomId: room.id };
  p.hvac!.bindings[c.id] = { deviceIds: [], operatingScenarioId: "operation-1", editMode: "design", overrides: {} };
  p = selectFloor(p, ground);
  const s = await harness.session(p); t.after(() => s.close());
  await s.page.getByRole("combobox", { name: "Workspace", exact: true }).selectOption("CLIMOPTIX");
  const ui = s.page.getByRole("region", { name: "Climoptix CFD workspace", exact: true }); await cfdWindow(ui, "Equipment");
  await ui.getByRole("button", { name: "Open Ventilation", exact: true }).click();
  const panel = s.page.locator(".heating-layout-window"); await panel.getByRole("combobox", { name: "Ventilation room", exact: true }).waitFor();
  assert.equal(await s.page.getByRole("combobox", { name: "Selected floor", exact: true }).inputValue(), upper.id);
  assert.equal(await panel.getByRole("combobox", { name: "Ventilation room", exact: true }).inputValue(), room.id);
});
test("duplicating a shared CFD case preserves heater-off state independently", async t => {
  const p = hvacProject(), sourceId = p.cfdScenarios![0].id, heater = p.rooms[0].obstacles[0].id;
  p.hvac!.bindings[sourceId] = { deviceIds: [], operatingScenarioId: "operation-1", editMode: "design", overrides: {} };
  p.hvac!.scenarios[0].heaterOverrides[heater] = { enabled: false, actualW: 700 };
  const s = await harness.session(p); t.after(() => s.close());
  await s.page.getByRole("combobox", { name: "Workspace", exact: true }).selectOption("CLIMOPTIX");
  const ui = s.page.getByRole("region", { name: "Climoptix CFD workspace", exact: true }); await cfdWindow(ui, "Studies");
  await ui.getByLabel(`Actions for ${p.cfdScenarios![0].name}`, { exact: true }).click();
  await ui.getByRole("button", { name: "Duplicate simulation", exact: true }).click();
  const saved = await eventually(s.saved, p => p.cfdScenarios.length === 2 && p.hvac.scenarios.length === 2), copy = saved.cfdScenarios.find(c => c.id !== sourceId);
  const copiedOperation = saved.hvac.bindings[copy.id].operatingScenarioId;
  assert.notEqual(copiedOperation, "operation-1"); assert.equal(saved.hvac.scenarios.find(op => op.id === copiedOperation).heaterOverrides[heater].enabled, false);
  await cfdWindow(ui, "Equipment"); const shared = ui.getByLabel("Shared HVAC devices", { exact: true });
  await shared.locator("details").first().locator("summary").click();
  await shared.getByRole("button", { name: "Use Heating output", exact: true }).click();
  const changed = await eventually(s.saved, p => !p.hvac.scenarios.find(op => op.id === copiedOperation).heaterOverrides[heater]);
  assert.equal(changed.hvac.scenarios.find(op => op.id === "operation-1").heaterOverrides[heater].enabled, false);
});

for (const [label, width, height, dark] of [["wide", 1440, 1000, false], ["tablet-dark", 820, 1180, true], ["phone", 390, 844, false]] as const) test(`${label}: HVAC controls match native Heating styles with long names and visible focus`, async t => {
  const s = await harness.session(hvacProject(), { viewport: { width, height } }); t.after(() => s.close()); const panel = await ventilation(s);
  if (dark) { await s.page.emulateMedia({ colorScheme: "dark" }); await eventually(() => s.page.locator("html").getAttribute("data-theme"), theme => theme === "dark"); }
  await panel.getByRole("button", { name: "Add supply inlet", exact: true }).click();
  const name = panel.getByRole("textbox", { name: "Vent name", exact: true }); await name.fill("Supply with a deliberately long HVAC device name for the north perimeter occupied zone and ventilation coordination"); await name.press("Enter");
  const flow = panel.getByRole("spinbutton", { name: "Volume flow (L/s)", exact: true });
  const style = e => { const s = getComputedStyle(e); return [s.fontFamily, s.fontSize, s.color, s.backgroundColor, s.borderRadius, s.padding]; };
  const ventStyle = await flow.evaluate(style);
  await panel.getByRole("tab", { name: "Heating", exact: true }).click();
  const native = panel.getByRole("spinbutton", { name: "Room target temperature °C", exact: true });
  assert.deepEqual(ventStyle, await native.evaluate(style));
  await panel.getByRole("tab", { name: "Ventilation", exact: true }).click();
  await panel.getByRole("button", { name: /Supply with a deliberately long HVAC device name/, exact: false }).first().click();
  await flow.focus(); assert.equal(await flow.evaluate(e => getComputedStyle(e).outlineStyle), "solid");
  assert.notEqual(await panel.getByRole("tab", { name: "Ventilation", exact: true }).evaluate(e => getComputedStyle(e).boxShadow), "none");
  assert.ok(await s.page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 2));
  const controls = panel.getByRole("region", { name: "Ventilation controls", exact: true });
  assert.ok(await controls.evaluate(e => Number.parseFloat(getComputedStyle(e).rowGap) >= 8));
  await panel.locator(".floating-toolbar-content").evaluate(e => e.scrollTo(0, 0));
  await s.page.screenshot({ path: `../.local-logs/hvac-reaudit-qa/${label}.png` });
});
