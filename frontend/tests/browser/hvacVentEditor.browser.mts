import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { hvacProject } from "../hvacFixtures";
import { ventSchema } from "../../lib/climoptixDocument";
import { eventually, menu, startBrowserHarness } from "./harness.mjs";
let harness;
before(async () => { harness = await startBrowserHarness({ climoptixEnabled: true }); });
after(async () => { await harness?.close(); });
async function open(s, tab) { await menu(s.page, "Tools", "Heating Layout"); const panel = s.page.locator(".heating-layout-window"); await panel.getByRole("tab", { name: tab, exact: true }).click(); return panel; }
async function number(panel, name, value) { const input = panel.getByRole("spinbutton", { name, exact: true }); await input.fill(String(value)); await input.press("Enter"); }
test("the separate vent editor changes the current operation and preserves independent scenario overrides", async t => {
  const p = hvacProject(), op = p.hvac!.scenarios[0], id = "shared-editor-vent";
  p.hvac!.devices = [{ vent: ventSchema.parse({ id, name: "Scenario vent", role: "supply", valueSI: .05, host: { patchId: `${op.floorId}:${op.roomId}:floor` } }), floorId: op.floorId, roomId: op.roomId, enabled: true, outdoorAirFraction: 1, extractKind: "exhaust" }];
  op.ventOverrides[id] = { valueSI: .12, temperatureK: 310 };
  const sibling = structuredClone(op); sibling.id = "independent-operation"; sibling.name = "Independent"; sibling.ventOverrides[id] = { valueSI: .18, temperatureK: 320 }; p.hvac!.scenarios.push(sibling);
  const s = await harness.session(p); t.after(() => s.close()); const panel = await open(s, "Ventilation");
  await panel.getByRole("button", { name: "Edit Scenario vent", exact: true }).click(); const editor = s.page.locator(".hvac-vent-editor");
  await number(editor, "Volume flow (L/s)", 80);
  await number(editor, "Supply / inflow temperature (K)", 295.15);
  const saved = await eventually(s.saved, p => p.hvac.devices[0].vent.valueSI === .08 && Math.abs(p.hvac.devices[0].vent.temperatureK - 295.15) < .001);
  assert.equal(saved.hvac.scenarios.find(s => s.id === op.id).ventOverrides[id], undefined);
  assert.deepEqual(saved.hvac.scenarios.find(s => s.id === sibling.id).ventOverrides[id], { valueSI: .18, temperatureK: 320 });
});
