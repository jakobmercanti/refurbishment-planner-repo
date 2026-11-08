import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { hvacProject } from "../hvacFixtures";
import { ventSchema } from "../../lib/climoptixDocument";
import { realDefaultSetup, realPreparation } from "../climoptixFixtures";
import { preparationRequestBody } from "../../lib/climoptix";
import { ventCenter } from "../../lib/climoptixPreview";
import { cfdWindow, eventually, menu, startBrowserHarness } from "./harness.mjs";
let harness;
before(async () => { harness = await startBrowserHarness({ climoptixEnabled: true }); });
after(async () => { await harness?.close(); });
async function open(s, tab) { await menu(s.page, "Tools", "Heating & ventilation"); const panel = s.page.locator(".heating-layout-window"); await panel.getByRole("tab", { name: tab, exact: true }).click(); return panel; }
async function number(panel, name, value) { const input = panel.getByRole("spinbutton", { name, exact: true }); await input.fill(String(value)); await input.press("Enter"); }
test("the 2D vent editor places XYZ coordinates and shares design edits, with advanced fields initially hidden", async t => {
  const p = hvacProject(), op = p.hvac!.scenarios[0], id = "shared-editor-vent";
  const report = realPreparation(JSON.parse(preparationRequestBody(p, p.cfdScenarios![0], "a".repeat(64))));
  const wall = report.patches.find(patch => patch.roomId === op.roomId && patch.kind === "wall" && patch.hostable && patch.host)!;
  const vent = ventSchema.parse({ id, name: "Scenario vent", role: "supply", valueSI: .05, host: { patchId: wall.id } });
  p.hvac!.devices = [{ vent, floorId: op.floorId, roomId: op.roomId, enabled: true, outdoorAirFraction: 1, extractKind: "exhaust" }];
  op.ventOverrides[id] = { valueSI: .12, temperatureK: 310 };
  const sibling = structuredClone(op); sibling.id = "independent-operation"; sibling.name = "Independent"; sibling.ventOverrides[id] = { valueSI: .18, temperatureK: 320 }; p.hvac!.scenarios.push(sibling);
  const s = await harness.session(p); t.after(() => s.close()); const panel = await open(s, "Ventilation");
  await panel.getByRole("button", { name: "Edit Scenario vent", exact: true }).click(); const editor = s.page.locator(".hvac-vent-editor");
  const advanced = editor.getByRole("checkbox", { name: "Advanced mode", exact: true });
  assert.equal(await advanced.isChecked(), false);
  assert.equal(await editor.getByLabel("Vent host face").count(), 0);
  assert.equal(await editor.getByLabel("Open area fraction (0–1)").count(), 0);
  const position = ventCenter(vent, wall.host!, .5, .65);
  for (const [index, axis] of ["X", "Y", "Z"].entries()) {
    await editor.getByRole("spinbutton", { name: `Vent ${axis} (mm)`, exact: true }).fill(String(position[index]));
  }
  const applyPosition = editor.getByRole("button", { name: "Apply position", exact: true });
  await applyPosition.click();
  await eventually(s.saved, project => Math.abs(project.hvac.devices[0].vent.host.v - .65) < .001);
  await editor.getByRole("spinbutton", { name: "Vent Z (mm)", exact: true }).fill("999999");
  await applyPosition.click();
  await editor.getByRole("alert").getByText(/Enter a centre on a measured wall/).waitFor();
  assert.ok(Math.abs((await s.saved()).hvac.devices[0].vent.host.v - .65) < .001);
  await advanced.check();
  assert.ok(await editor.getByLabel("Vent host face").isVisible());
  assert.ok(await editor.getByLabel("Open area fraction (0–1)").isVisible());
  await advanced.uncheck();
  const unit = await editor.getByLabel("Flow display unit").boundingBox();
  const flow = await editor.getByRole("spinbutton", { name: "Volume flow (L/s)", exact: true }).boundingBox();
  assert.ok(unit && flow && Math.abs(unit.y - flow.y) < 2 && unit.x < flow.x);
  await number(editor, "Volume flow (L/s)", 80);
  await number(editor, "Supply / inflow temperature (K)", 295.15);
  const saved = await eventually(s.saved, p => p.hvac.devices[0].vent.valueSI === .08 && Math.abs(p.hvac.devices[0].vent.temperatureK - 295.15) < .001);
  assert.equal(saved.hvac.scenarios.find(s => s.id === op.id).ventOverrides[id], undefined);
  assert.equal(saved.hvac.scenarios.find(s => s.id === sibling.id).ventOverrides[id], undefined);
});

test("Restore default replaces edited shared vents and clears the old conflict in both workbenches", async t => {
  const project = hvacProject(), hvac = project.hvac!, op = hvac.scenarios[0];
  const study = realDefaultSetup(JSON.parse(preparationRequestBody(project, project.cfdScenarios![0], "a".repeat(64))));
  hvac.devices = study.vents.map((vent, index) => ({
    vent: { ...vent, widthMm: vent.widthMm - 100, name: index === 0 ? "Edited inlet" : vent.name },
    floorId: op.floorId, roomId: op.roomId, enabled: true, outdoorAirFraction: 1, extractKind: "exhaust",
  }));
  op.ventOverrides[study.vents[0].id] = { valueSI: .03 };
  hvac.bindings[study.id] = { deviceIds: hvac.devices.map(d => d.vent.id), operatingScenarioId: op.id, editMode: "design", overrides: {} };
  project.cfdScenarios = [{ ...study, vents: [] }];
  const s = await harness.session(project);
  t.after(() => s.close());
  const { page } = s;
  await page.getByRole("combobox", { name: "Workspace", exact: true }).selectOption("CLIMOPTIX");
  const cfd = page.locator(".cfx-workspace");
  await cfdWindow(cfd, "Simulations");
  await cfd.getByRole("button", { name: "Restore default", exact: true }).click();
  await page.getByRole("dialog", { name: "Restore the default workbench?", exact: true })
    .getByRole("button", { name: "Restore default", exact: true }).click();
  const restored = await eventually(s.saved, p => p.cfdScenarios[0].id !== study.id && p.cfdScenarios[0].validation?.errors === 0);
  assert.deepEqual(restored.hvac.devices.map(d => d.vent.name), ["Default inlet", "Default outlet"]);
  assert.equal(restored.hvac.devices[0].vent.widthMm, study.vents[0].widthMm);
  assert.deepEqual(restored.hvac.scenarios[0].ventOverrides, {});
  await cfdWindow(cfd, "Equipment");
  await cfd.getByRole("button", { name: "Edit Default inlet", exact: true }).click();
  const cfdEditor = cfd.getByRole("region", { name: "Equipment editor", exact: true });
  await number(cfdEditor, "Volume flow (L/s)", 25);
  await cfdEditor.getByRole("button", { name: "Done", exact: true }).click();
  await eventually(s.saved, p => p.hvac.devices[0].vent.valueSI === .025);
  await page.getByRole("combobox", { name: "Workspace", exact: true }).selectOption("FLOORPLAN");
  const ventilation = await open(s, "Ventilation");
  await ventilation.getByRole("button", { name: "Edit Default inlet", exact: true }).click();
  const ventEditor = page.locator(".hvac-vent-editor");
  assert.equal(await ventEditor.getByRole("spinbutton", { name: "Volume flow (L/s)", exact: true }).inputValue(), "25");
  assert.equal(await ventilation.getByRole("button", { name: "Edit Edited inlet", exact: true }).count(), 0);
  await number(ventEditor, "Volume flow (L/s)", 30);
  await ventEditor.getByRole("button", { name: "Done", exact: true }).click();
  await eventually(s.saved, p => p.hvac.devices[0].vent.valueSI === .03);
  await page.getByRole("combobox", { name: "Workspace", exact: true }).selectOption("CLIMOPTIX");
  await cfdWindow(cfd, "Equipment");
  await cfd.getByRole("button", { name: "Edit Default inlet", exact: true }).click();
  assert.equal(await cfdEditor.getByRole("spinbutton", { name: "Volume flow (L/s)", exact: true }).inputValue(), "30");
});
