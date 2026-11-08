import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { hvacProject } from "../hvacFixtures";
import { ventSchema } from "../../lib/climoptixDocument";
import { createRoomUFH } from "../../lib/heatingDesign";
import { eventually, menu, startBrowserHarness } from "./harness.mjs";

let harness;
before(async () => { harness = await startBrowserHarness({ climoptixEnabled: true }); });
after(async () => { await harness?.close(); });
function fixture() {
  const p = hvacProject(), op = p.hvac!.scenarios[0], id = "audit-vent";
  p.hvac!.devices = [{ vent: ventSchema.parse({ id, name: "Audit outlet", role: "extract", control: "pressure", valueSI: 100, host: { patchId: `${op.floorId}:${op.roomId}:floor` } }), floorId: op.floorId, roomId: op.roomId, enabled: true, outdoorAirFraction: 1, extractKind: "exhaust" }];
  op.ventOverrides[id] = { valueSI: 0, temperatureK: 310 };
  p.hvac!.scenarios.push({ ...structuredClone(op), id: "independent", name: "Independent" });
  return p;
}
async function open(s, tab = "Ventilation") {
  await menu(s.page, "Tools", "Heating & ventilation");
  const panel = s.page.locator(".heating-layout-window");
  await panel.getByRole("tab", { name: tab, exact: true }).click(); return panel;
}

test("the separate vent editor changes quantity without reusing pressure or scenario values", async t => {
  const s = await harness.session(fixture()); t.after(() => s.close());
  const panel = await open(s);
  await panel.getByRole("button", { name: "Select Audit outlet", exact: true }).click();
  const quantity = { name: "Vent controlling quantity", exact: true };
  assert.equal(await panel.getByRole("combobox", quantity).count(), 0);
  const edit = panel.getByRole("button", { name: "Edit Audit outlet", exact: true });
  await edit.click();
  const editor = s.page.locator(".hvac-vent-editor");
  await editor.getByRole("combobox", quantity).selectOption("volumeFlow");
  let saved = await eventually(s.saved, p => p.hvac.devices[0].vent.control === "volumeFlow");
  assert.equal(saved.hvac.devices[0].vent.valueSI, .05);
  for (const op of saved.hvac.scenarios) assert.deepEqual(op.ventOverrides["audit-vent"], { temperatureK: 310 });
  await editor.getByRole("button", { name: "Done", exact: true }).click();
  await edit.click();
  await editor.getByRole("combobox", quantity).selectOption("massFlow");
  saved = await eventually(s.saved, p => p.hvac.devices[0].vent.control === "massFlow");
  assert.equal(saved.hvac.devices[0].vent.valueSI, .06);
  assert.equal(await editor.getByRole("alert").count(), 0);
  await editor.getByRole("button", { name: "Done", exact: true }).click();
  await edit.click();
  assert.equal(await editor.getByRole("combobox", quantity).inputValue(), "massFlow");
});

test("failed host checks stop loading and both vent editors offer a working retry", async t => {
  const s = await harness.session(fixture()); t.after(() => s.close());
  let failing = true;
  await s.context.route("**/climoptix/prepare", route => failing ? route.fulfill({ status: 503, json: { detail: "Host preparation unavailable for audit" } }) : route.fallback());
  await s.page.reload(); const panel = await open(s);
  await panel.getByRole("alert").filter({ hasText: "Host preparation unavailable for audit" }).waitFor();
  assert.equal(await panel.getByText("Checking measured host faces…", { exact: true }).count(), 0);
  assert.equal(await panel.getByRole("button", { name: "Add supply inlet", exact: true }).isDisabled(), true);
  await panel.getByRole("button", { name: "Edit Audit outlet", exact: true }).click();
  const editor = s.page.locator(".hvac-vent-editor");
  await editor.getByRole("alert").filter({ hasText: "Host preparation unavailable for audit" }).waitFor();
  assert.equal(await editor.getByText("Checking measured host faces…", { exact: true }).count(), 0);
  failing = false;
  await editor.getByRole("button", { name: "Retry host checks", exact: true }).click();
  await editor.getByRole("checkbox", { name: "Advanced mode" }).check();
  await eventually(() => editor.getByRole("combobox", { name: "Vent host face" }).locator("option").count(), n => n > 1);
  assert.equal(await editor.getByRole("alert").count(), 0);
  await editor.getByRole("button", { name: "Done", exact: true }).click();
  await panel.getByRole("button", { name: "Retry host checks", exact: true }).click();
  await eventually(() => panel.getByRole("button", { name: "Add supply inlet", exact: true }).isEnabled(), Boolean);
  assert.equal(await panel.getByRole("alert").count(), 0);
});

test("a delayed hosts-only response cannot overwrite a newer complete geometry check", async t => {
  const s = await harness.session(fixture()); t.after(() => s.close());
  let release; const gate = new Promise<void>(resolve => { release = resolve; }); t.after(() => release());
  let hostRequests = 0;
  await s.context.route("**/climoptix/prepare", async route => {
    if (route.request().postDataJSON().scenario.id === "hvac-hosts") { hostRequests++; await gate; }
    await route.fallback();
  });
  await s.page.reload(); const panel = await open(s);
  await eventually(() => hostRequests, n => n === 1);
  await panel.getByRole("button", { name: "Check room geometry", exact: true }).click();
  await panel.getByText(/^Geometry checked\./).waitFor();
  const response = s.page.waitForResponse(r => r.url().endsWith("/climoptix/prepare") && r.request().postDataJSON().scenario.id === "hvac-hosts");
  release(); await response;
  await eventually(() => panel.getByText("Checking measured host faces…", { exact: true }).count(), n => n === 0);
  assert.equal(await panel.getByText(/^Geometry checked\./).count(), 1);
  assert.equal(hostRequests, 1, "background preparation and the workbench share one request");
});

test("explicit workbench and section navigation resets scroll and supports the keyboard", async t => {
  const p = fixture(); p.heatingLayout = createRoomUFH(p.rooms[0], p.heatingLayout!).heating;
  const s = await harness.session(p); t.after(() => s.close()); const panel = await open(s, "Heating");
  const content = panel.locator(".floating-toolbar-content");
  await panel.getByRole("tab", { name: "Underfloor", exact: true }).click();
  await panel.evaluate(root => root.querySelectorAll("details").forEach(d => { d.open = true; }));
  await content.evaluate(e => { e.scrollTop = e.scrollHeight; });
  assert.ok(await content.evaluate(e => e.scrollTop > 100));
  await panel.getByRole("tab", { name: "Ventilation", exact: true }).click();
  assert.ok(await content.evaluate(e => e.scrollTop < 2));
  await panel.getByRole("tab", { name: "Ventilation", exact: true }).press("Home");
  assert.equal(await panel.getByRole("tab", { name: "Heating", exact: true }).getAttribute("aria-selected"), "true");
  assert.ok(await content.evaluate(e => e.scrollTop < 2));
  const first = panel.getByRole("tab", { name: "Room setup", exact: true });
  await first.click(); await first.press("End");
  const results = panel.getByRole("tab", { name: "Results", exact: true });
  assert.equal(await results.getAttribute("aria-selected"), "true"); assert.equal(await results.evaluate(e => e === document.activeElement), true);
  await panel.getByRole("tabpanel", { name: "Results", exact: true }).waitFor();
  await results.press("Home");
  assert.equal(await first.getAttribute("aria-selected"), "true");
});

test("geometry failures from superseded inputs cannot attach to the current room", async t => {
  const s = await harness.session(fixture()); t.after(() => s.close()); const panel = await open(s);
  let started, release, finished;
  const entered = new Promise<void>(resolve => { started = resolve; }), gate = new Promise<void>(resolve => { release = resolve; }), completed = new Promise<void>(resolve => { finished = resolve; });
  t.after(() => release());
  await s.context.route("**/climoptix/prepare", async route => {
    if (route.request().postDataJSON().scenario.id !== "hvac-preview") { await route.fallback(); return; }
    started(); await gate;
    try { await route.fulfill({ status: 503, json: { detail: "Failure from the previous room" } }); } catch { /* The old request is correctly aborted. */ } finally { finished(); }
  });
  await panel.getByRole("button", { name: "Check room geometry", exact: true }).click(); await entered;
  await panel.getByRole("combobox", { name: "Ventilation room", exact: true }).selectOption("room-1");
  release(); await completed;
  await eventually(() => panel.getByRole("button", { name: "Check room geometry", exact: true }).isEnabled(), Boolean);
  assert.equal(await panel.getByText("Failure from the previous room", { exact: true }).count(), 0);
});

test("malformed help metadata keeps one usable main guide", async t => {
  const s = await harness.session(fixture()); t.after(() => s.close()); const panel = await open(s);
  await panel.evaluate(root => { const marker = document.createElement("span"); marker.hidden = true; marker.dataset.windowHelpTopic = "Broken metadata"; marker.dataset.windowHelpSteps = JSON.stringify([{ heading: "Broken", text: "Bad links", links: {} }]); root.appendChild(marker); });
  assert.equal(await panel.locator(".floating-toolbar-titlebar .window-help-button").count(), 1);
  await panel.getByRole("button", { name: "Help for Heating Layout", exact: true }).click();
  await s.page.locator(".window-help-host").getByRole("heading", { name: "Move and edit vents", exact: true }).waitFor();
  await s.page.keyboard.press("Escape");
});

test("the full vent editor retains its main and section guides and readable controls", async t => {
  const s = await harness.session(fixture()); t.after(() => s.close()); const panel = await open(s);
  await panel.getByRole("button", { name: "Edit Audit outlet", exact: true }).click(); const editor = s.page.locator(".hvac-vent-editor");
  await editor.getByRole("checkbox", { name: "Advanced mode" }).check();
  await eventually(() => editor.getByRole("combobox", { name: "Vent host face" }).locator("option").count(), n => n > 1);
  await mkdir("../.local-logs/audit3-qa", { recursive: true });
  for (const [width, density, theme] of [[1440, "comfortable", "dark"], [390, "compact", "light"]] as const) {
    await s.page.setViewportSize({ width, height: 1000 });
    await s.page.evaluate(({ density, theme }) => { document.documentElement.dataset.density = density; document.documentElement.dataset.theme = theme; }, { density, theme });
    const result = await editor.evaluate(root => {
      const enabled = root.querySelector("input[type=checkbox]")!, box = enabled.getBoundingClientRect(), hit = document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2), windowBox = root.getBoundingClientRect();
      const obstructingControls = [...document.querySelectorAll(".floorplan-export-shortcut,.building-floor-bar")].filter(control => {
        const r = control.getBoundingClientRect(), left = Math.max(r.left, windowBox.left), right = Math.min(r.right, windowBox.right), top = Math.max(r.top, windowBox.top), bottom = Math.min(r.bottom, windowBox.bottom);
        return left < right && top < bottom && !root.contains(document.elementFromPoint((left + right) / 2, (top + bottom) / 2));
      }).map(control => control.className);
      const sections = [...root.querySelectorAll(".menu-section-help")].map(button => button.parentElement);
      return { overflow: root.scrollWidth > root.clientWidth + 2, help: root.querySelectorAll(".floating-toolbar-titlebar .window-help-button").length,
        sectionHelp: sections.length > 0 && new Set(sections).size === sections.length,
        clipped: [...root.querySelectorAll("button")].filter(e => e.checkVisibility() && (e.scrollWidth > e.clientWidth + 2 || e.scrollHeight > e.clientHeight + 2)).map(e => e.textContent),
        blocker: hit === enabled ? null : hit?.outerHTML, obstructingControls };
    });
    assert.deepEqual(result, { overflow: false, help: 1, sectionHelp: true, clipped: [], blocker: null, obstructingControls: [] }, `${width}/${density}/${theme}`);
    await editor.locator(".floating-toolbar-content").evaluate(e => e.scrollTo(0, 0));
    await s.page.screenshot({ path: `../.local-logs/audit3-qa/vent-editor-${width}.png` });
  }
});
