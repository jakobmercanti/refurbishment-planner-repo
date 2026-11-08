import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { hvacProject } from "../hvacFixtures";
import { ventSchema } from "../../lib/climoptixDocument";
import { resolveHvacVents } from "../../lib/hvacDocument";
import { eventually, menu, cfdWindow, startBrowserHarness } from "./harness.mjs";

let harness;
before(async () => { harness = await startBrowserHarness({ climoptixEnabled: true }); await mkdir("../.local-logs/vent-list-qa", { recursive: true }); });
after(async () => { await harness?.close(); });
function fixture() {
  const p = hvacProject(), op = p.hvac!.scenarios[0];
  p.hvac!.devices = ["Supply A", "Supply B", "Extract C", "Other room"].map((name, index) => ({
    vent: ventSchema.parse({ id: `list-${index}`, name, role: index === 2 ? "extract" : "supply", control: index === 2 ? "pressure" : "volumeFlow", valueSI: index === 2 ? 0 : .05,
      host: { patchId: `${op.floorId}:${index === 3 ? "room-1" : op.roomId}:floor`, u: .25 + .2 * index }, widthMm: 300, heightMm: 200 }),
    floorId: op.floorId, roomId: index === 3 ? "room-1" : op.roomId, enabled: true, outdoorAirFraction: .8, extractKind: "exhaust",
  }));
  const scenario = p.cfdScenarios![0];
  p.hvac!.bindings[scenario.id] = { deviceIds: ["list-0", "list-1", "list-2"], operatingScenarioId: op.id, editMode: "design", overrides: {} };
  scenario.objectGroups = [{ id: "objects-default", name: "General", memberIds: ["vent:list-0", "vent:list-1", "vent:list-2"] }];
  return p;
}
async function floorplan(s) {
  await s.page.getByRole("combobox", { name: "Workspace", exact: true }).selectOption("FLOORPLAN");
  await menu(s.page, "Tools", "Heating & ventilation"); const panel = s.page.locator(".heating-layout-window");
  await panel.getByRole("tab", { name: "Ventilation", exact: true }).click(); return panel;
}
async function cfd(s) {
  await s.page.getByRole("combobox", { name: "Workspace", exact: true }).selectOption("CLIMOPTIX");
  const ui = s.page.locator(".cfx-workspace"); await cfdWindow(ui, "Equipment"); return ui;
}
const row = (root, name) => root.locator(".cfx-device-row").filter({ has: root.page().getByRole("button", { name: `Select ${name}`, exact: true }) });
async function presentation(root) {
  return root.evaluate(e => {
    const style = getComputedStyle(e), name = e.querySelector(".cfx-device-name"), actions = [...e.querySelectorAll(".cfx-device-actions > button")];
    return { padding: style.padding, gap: style.gap, radius: style.borderRadius, border: style.borderColor, background: style.backgroundColor,
      name: [getComputedStyle(name).fontSize, getComputedStyle(name).backgroundColor],
      buttons: actions.map(b => { const s = getComputedStyle(b); return [s.fontSize, s.minHeight, s.padding, s.borderRadius]; }),
      equal: Math.max(...actions.map(b => b.getBoundingClientRect().height)) - Math.min(...actions.map(b => b.getBoundingClientRect().height)) < 1,
      clipped: actions.some(b => b.scrollWidth > b.clientWidth + 2 || b.scrollHeight > b.clientHeight + 2),
      widths: actions.map(b=>b.getBoundingClientRect().width), wrapped: actions.some(b => { const range = document.createRange(); range.selectNodeContents(b); return range.getClientRects().length > 1; }), overflow: e.scrollWidth > e.clientWidth + 2 };
  });
}
async function settledPresentation(root, page) {
  await page.mouse.move(0, 0);
  await root.locator(".cfx-device-name").evaluate(async node => { await Promise.all(node.getAnimations().map(animation => animation.finished.catch(() => {}))); });
  return presentation(root);
}

test("Floorplan and CFD vent rows use the same format and responsive control sizes", async t => {
  const s = await harness.session(fixture()); t.after(() => s.close());
  for (const [width, density, theme] of [[1440, "comfortable", "light"], [768, "compact", "dark"], [390, "compact", "light"], [1440, "compact", "light"]] as const) {
    await s.page.setViewportSize({ width, height: 1000 });
    await s.page.evaluate(({ density, theme }) => { document.documentElement.dataset.density = density; document.documentElement.dataset.theme = theme; document.body.dataset.uiStyle = "modern"; }, { density, theme });
    const panel = await floorplan(s), list = panel.getByRole("list", { name: "Room vents", exact: true });
    assert.equal(await list.locator("[data-item-id]").count(), 3);
    const floorRow = row(list, "Supply A"); await floorRow.getByRole("button", { name: "Select Supply A", exact: true }).click(); await floorRow.scrollIntoViewIfNeeded();
    const { widths: floorWidths, ...floor } = await settledPresentation(floorRow, s.page);
    assert.equal(floor.equal, true);
    assert.equal(floor.clipped, false);
    assert.equal(floor.wrapped, false, `${width}px, button widths ${floorWidths}`);
    assert.equal(floor.overflow, false);
    assert.equal(await floorRow.getByRole("button", { name: "Delete Supply A", exact: true }).count(), 1);
    await s.page.screenshot({ path: `../.local-logs/vent-list-qa/floorplan-${width}.png` });
    const ui = await cfd(s), cfdRow = row(ui, "Supply A"); await cfdRow.getByRole("button", { name: "Select Supply A", exact: true }).click(); await cfdRow.scrollIntoViewIfNeeded();
    const { widths: simulationWidths, ...simulation } = await settledPresentation(cfdRow, s.page);
    assert.deepEqual(simulation, floor, `${width}/${density}/${theme}, CFD button widths ${simulationWidths}`);
    await s.page.screenshot({ path: `../.local-logs/vent-list-qa/cfd-${width}.png` });
  }
});

test("room list drag, keyboard and menu reorder update CFD and preserve the other room", async t => {
  const s = await harness.session(fixture()); t.after(() => s.close()); const panel = await floorplan(s), list = panel.getByRole("list", { name: "Room vents", exact: true });
  await list.getByRole("button", { name: "Reorder Supply B", exact: true }).press("ArrowUp");
  let saved = await eventually(s.saved, p => p.hvac.devices[0].vent.name === "Supply B");
  assert.deepEqual(saved.hvac.devices.map(d => d.vent.name), ["Supply B", "Supply A", "Extract C", "Other room"]);
  assert.deepEqual(saved.cfdScenarios[0].objectGroups[0].memberIds, ["vent:list-1", "vent:list-0", "vent:list-2"]);
  const grip = list.getByRole("button", { name: "Reorder Supply A", exact: true }); await grip.scrollIntoViewIfNeeded();
  const start = await grip.boundingBox(), target = await list.locator('[data-item-id="vent:list-2"]').boundingBox();
  await s.page.mouse.move(start.x + start.width / 2, start.y + start.height / 2); await s.page.mouse.down();
  await s.page.mouse.move(target.x + target.width / 2, target.y + target.height - 2, { steps: 8 }); await s.page.mouse.up();
  saved = await eventually(s.saved, p => p.hvac.devices[2].vent.name === "Supply A");
  const before = JSON.stringify(saved.hvac.devices);
  const b = await list.getByRole("button", { name: "Reorder Supply B", exact: true }).boundingBox(), a = await grip.boundingBox();
  await s.page.mouse.move(b.x + b.width / 2, b.y + b.height / 2); await s.page.mouse.down(); await s.page.mouse.move(a.x + a.width / 2, a.y + a.height - 2, { steps: 8 });
  await s.page.keyboard.press("Escape"); await s.page.mouse.up(); assert.equal(JSON.stringify((await s.saved()).hvac.devices), before);
  await panel.getByRole("button", { name: "Undo HVAC", exact: true }).click(); await eventually(s.saved, p => p.hvac.devices[1].vent.name === "Supply A");
  await panel.getByRole("button", { name: "Redo HVAC", exact: true }).click(); await eventually(s.saved, p => p.hvac.devices[2].vent.name === "Supply A");
  await row(list, "Supply A").getByLabel("Move Supply A", { exact: true }).click();
  await row(list, "Supply A").getByRole("button", { name: "Move to top", exact: true }).click();
  saved = await eventually(s.saved, p => p.hvac.devices[0].vent.name === "Supply A"); assert.equal(saved.hvac.devices[3].vent.name, "Other room");
  const ui = await cfd(s), general = ui.getByRole("list", { name: "General objects", exact: true });
  assert.equal(await general.locator('[data-item-id^="vent:"]').first().getAttribute("data-item-id"), "vent:list-0");
  await general.getByRole("button", { name: "Reorder Supply A", exact: true }).press("ArrowDown");
  await eventually(s.saved, p => p.hvac.devices.findIndex(d => d.vent.id === "list-0") > p.hvac.devices.findIndex(d => d.vent.id === "list-1"));
  const returned = await floorplan(s); assert.equal(await returned.getByRole("list", { name: "Room vents", exact: true }).locator("[data-item-id]").first().getAttribute("data-item-id"), "vent:list-1");
  await s.page.reload(); const reloaded = await floorplan(s); assert.equal(await reloaded.getByRole("list", { name: "Room vents", exact: true }).locator("[data-item-id]").first().getAttribute("data-item-id"), "vent:list-1");
});

test("duplicate, separate editing, focus return and delete operate on canonical shared vents", async t => {
  const p = fixture(); p.hvac!.scenarios[0].ventOverrides["list-0"] = { valueSI: .12 };
  const s = await harness.session(p); t.after(() => s.close()); const panel = await floorplan(s), list = panel.getByRole("list", { name: "Room vents", exact: true });
  await list.getByRole("button", { name: "Select Supply A", exact: true }).click(); assert.equal(await list.getByRole("button", { name: "Select Supply A", exact: true }).getAttribute("aria-pressed"), "true");
  const duplicate = list.getByRole("button", { name: "Duplicate Supply A", exact: true }); await duplicate.click();
  const editor = s.page.locator(".hvac-vent-editor"); await editor.waitFor();
  let saved = await eventually(s.saved, p => p.hvac.devices.length === 5); const copy = saved.hvac.devices.find(d => d.vent.name === "Supply A copy");
  assert.equal(copy.vent.valueSI, .05); assert.equal(copy.outdoorAirFraction, .8); assert.equal(copy.vent.host.u, .4);
  const width = editor.getByRole("spinbutton", { name: "Vent width (mm)", exact: true }); await width.fill("350"); await width.press("Enter");
  await eventually(s.saved, p => p.hvac.devices.find(d => d.vent.id === copy.vent.id).vent.widthMm === 350);
  await editor.getByRole("button", { name: "Done", exact: true }).click(); assert.equal(await duplicate.evaluate(e => e === document.activeElement), true);
  await list.getByRole("button", { name: "Delete Supply A copy", exact: true }).click();
  saved = await eventually(s.saved, p => p.hvac.devices.length === 4); assert.ok(!resolveHvacVents(saved, saved.cfdScenarios[0]).some(v => v.id === copy.vent.id));
  await panel.getByRole("button", { name: "Undo HVAC", exact: true }).click(); await eventually(s.saved, p => p.hvac.devices.length === 5);
  const ui = await cfd(s); await row(ui, "Supply A copy").waitFor();
  await ui.getByRole("button", { name: "Delete Supply A copy", exact: true }).click(); await eventually(s.saved, p => p.hvac.devices.length === 4);
  await floorplan(s); assert.equal(await list.getByRole("button", { name: "Select Supply A copy", exact: true }).count(), 0);
});
