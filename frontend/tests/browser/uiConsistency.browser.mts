import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { newProject, parseProject } from "../../lib/projectDocument";
import { defaultBuilding } from "../../lib/buildingDocument";
import { DEFAULT_ELECTRICAL_LAYOUT } from "../../lib/electricalLayout";
import { eventually, menu, startBrowserHarness } from "./harness.mjs";

let harness;
before(async () => { harness = await startBrowserHarness(); await mkdir("../.local-logs/ui-nov01-qa", { recursive: true }); });
after(async () => { await harness?.close(); });
function fixture() {
  const project = newProject();
  const measure = (value: number) => ({ value, uncertainty_mm: 0, verified: true, source_type: "USER_MEASURED" });
  const vertices = [{ x: 0, y: 0 }, { x: 6400, y: 0 }, { x: 6400, y: 4200 }, { x: 0, y: 4200 }];
  const obstacles = ["board", "a", "b", "c"].map((id, i) => ({ id, name: id === "board" ? "Consumer unit" : `Socket ${id}`, representation_key: id === "board" ? "electrical-board-compact" : "electrical-socket-double", fixture_kind: "FURNITURE", base_z_mm: 400, verified: true, center: { x: 800 + i * 1300, y: 200 }, rotation_deg: 0, dimensions: { width: measure(100), depth: measure(50), height: measure(100) } }));
  project.rooms = [{ id: "room-a", source_floorplan_room_id: "outline-a", name: "Studio", version: 1, vertices, wall_height: measure(2400), wall_thickness: measure(50), wall_thickness_overrides_mm: {}, person_mockup: null, openings: [], obstacles }];
  project.floorplan = { walls: [{ id: "wall-a", points: [...vertices, vertices[0]] }], rooms: [{ id: "outline-a", sourceWallId: "wall-a", sourceWallIds: ["wall-a"], colourIndex: 0, name: "Studio", vertices }], roomFinishes: {}, openings: [], measurements: [], annotations: [], dimensionOffsets: {}, hiddenDimensions: [], canvasSize: { width: 1100, height: 700 }, selectedRoomId: "outline-a", wallHeight: 2400, wallThickness: 50, squaredWalls: true, snapEnabled: true, snapSize: 50, viewSettings: { zoom: 1, pan: { x: 0, y: 0 }, showRoomNames: true, showMeasurements: true, showWallThickness: true, showAnnotations: true, showGrid: true } };
  project.electricalLayout = { ...DEFAULT_ELECTRICAL_LAYOUT, circuits: [{ id: "sockets", name: "Sockets", color: "#287fb8", socketTopology: "RING", consumerUnitId: "board", socketIds: ["a", "b", "c"] }] };
  project.building = defaultBuilding(project);
  return parseProject(project);
}

test("floating Export uses the floorplan dialog and is restricted to Floorplan 2D", async t => {
  const session = await harness.session(fixture()); t.after(() => session.close()); const { page } = session;
  await page.getByRole("button", { name: "Export floorplan", exact: true }).click();
  await page.locator(".floorplan-export-dialog").waitFor();
  await page.locator(".floorplan-export-dialog").getByRole("button", { name: "Cancel", exact: true }).click();
  await page.getByRole("button", { name: "3D", exact: true }).click();
  await page.waitForFunction(() => !document.querySelector(".floorplan-export-shortcut"));
  await page.getByRole("button", { name: "2D", exact: true }).click();
  await page.getByRole("button", { name: "Export floorplan", exact: true }).waitFor();
});

test("compact windows shrink without clipped actions and keep resize targets", async t => {
  const session = await harness.session(fixture()); t.after(() => session.close()); const { page } = session;
  const panel = page.locator(".full-plan-build-toolbar");
  const before = await panel.boundingBox(); assert.ok(before);
  const railWidth = await panel.locator(".floating-toolbar-resize-right").evaluate(el => el.getBoundingClientRect().width);
  await menu(page, "Settings", "Preferences…"); const preferences = page.locator(".settings-dialog");
  const dialogBefore = await preferences.boundingBox();
  await preferences.getByRole("button", { name: "Compact", exact: true }).click();
  const dialogCompact = await preferences.boundingBox(); assert.ok(dialogBefore && dialogCompact && dialogCompact.width < dialogBefore.width - 20);
  await preferences.getByRole("button", { name: "Done", exact: true }).click();
  await page.waitForFunction(() => document.documentElement.dataset.density === "compact");
  const compact = await panel.boundingBox(); assert.ok(compact && compact.width < before.width - 20);
  assert.equal(await panel.locator(".floating-toolbar-resize-right").evaluate(el => el.getBoundingClientRect().width), railWidth);
  assert.deepEqual(await panel.locator(".floating-toolbar-content button:visible").evaluateAll(buttons => buttons.filter(b => b.scrollWidth > b.clientWidth + 1 || b.scrollHeight > b.clientHeight + 1).map(b => b.textContent)), []);
  const rail = await panel.locator(".floating-toolbar-resize-right").boundingBox(); assert.ok(rail);
  await page.mouse.move(rail.x + rail.width / 2, rail.y + 15); await page.mouse.down(); await page.mouse.move(rail.x + rail.width / 2 + 60, rail.y + 15, { steps: 8 }); await page.mouse.up();
  const resized = await panel.boundingBox(); assert.ok(resized && Math.abs(resized.width - compact.width - 60) < 3);
  await page.screenshot({ path: "../.local-logs/ui-nov01-qa/compact.png" });
});

test("socket ring generation persists, individual plan testing works, broken returns fail", async t => {
  const session = await harness.session(fixture()); t.after(() => session.close()); const { page } = session;
  await menu(page, "Tools", "Full Electrical Layout module…");
  const panel = page.locator(".electrical-layout-window");
  await panel.locator("summary").filter({ hasText: "Circuits (1)" }).click();
  assert.equal(await panel.getByRole("button", { name: "Create socket routes", exact: true }).count(), 1);
  await panel.getByRole("button", { name: "Create socket routes", exact: true }).click();
  await eventually(session.saved, value => value?.electricalLayout?.connections.length === 4);
  await panel.getByRole("button", { name: "Check layout", exact: true }).click();
  const tester = page.locator(".electrical-lighting-test-window");
  await tester.getByRole("button", { name: /^Socket a/ }).click();
  assert.equal(await tester.getByRole("button", { name: /^Socket a/ }).getAttribute("aria-pressed"), "true");
  const planSocket = page.getByRole("button", { name: "Electrical fitting: Socket b, connected", exact: true });
  await planSocket.focus(); await planSocket.press("Enter");
  assert.equal(await tester.getByRole("button", { name: /^Socket b/ }).getAttribute("aria-pressed"), "true");
  assert.equal(await tester.locator(".socket-test-list button").filter({ hasText: "Closed ring connected" }).count(), 3);
  await page.screenshot({ path: "../.local-logs/ui-nov01-qa/socket-ring.png" });
  await tester.getByRole("button", { name: "Hide Electrical layout test", exact: true }).click();
  const saved = await session.saved(); const connection = saved.electricalLayout.connections.at(-1);
  await panel.locator("summary").filter({ hasText: "Connections (4)" }).click();
  const row = panel.locator(".electrical-connection-row").last();
  await row.getByRole("button", { name: /^Delete connection/ }).click();
  await eventually(session.saved, value => value?.electricalLayout?.connections.length === 3 && !value.electricalLayout.connections.some(e => e.id === connection.id));
  await panel.getByRole("button", { name: "Check layout", exact: true }).click();
  assert.equal(await tester.locator(".socket-test-list button").filter({ hasText: "Ring incomplete" }).count(), 3);
});

test("service section help never repeats the main guide or another section guide", async t => {
  const session = await harness.session(fixture()); t.after(() => session.close()); const { page } = session;
  for (const [entry, selector] of [["Full Electrical Layout module…", ".electrical-layout-window"], ["Heating Layout", ".heating-layout-window"], ["Energy & Insulation", ".energy-layout-window"]]) {
    await menu(page, "Tools", entry); const panel = page.locator(selector);
    await panel.locator(".floating-toolbar-titlebar .window-help-button").click();
    const help = page.locator(".window-help-host .floating-toolbar-content"); await help.waitFor();
    const main = (await help.locator("p").allTextContents()).join("\n"); await page.keyboard.press("Escape");
    const buttons = panel.locator(".service-menu-help:visible"); const seen = new Set([main]);
    for (let i = 0; i < await buttons.count(); i++) {
      await buttons.nth(i).click(); await help.waitFor(); const body = (await help.locator("p").allTextContents()).join("\n");
      assert.ok(body && !seen.has(body), `${entry}: repeated help`); seen.add(body); await page.keyboard.press("Escape");
    }
    await panel.locator(".floating-toolbar-close").click();
  }
});

test("opening controls use one outlined chevron and keep content gutters clear of resize rails", async t => {
  const session = await harness.session(fixture()); t.after(() => session.close()); const { page } = session;
  const selector = page.getByRole("combobox", { name: "Add to plan", exact: true });
  await selector.selectOption("WINDOW");
  const panel = page.locator(".floating-toolbar").filter({ has: selector });
  assert.ok(await selector.evaluate(el => parseFloat(getComputedStyle(el).paddingRight)) >= 30);
  assert.ok(await selector.evaluate(el => getComputedStyle(el).backgroundImage.includes("data:image/svg+xml")));
  const arrows = panel.locator(".fixture-colours-toggle > span[aria-hidden], .fixture-section-toggle > span[aria-hidden], .fixture-cascading-collapsed > button");
  assert.ok(await arrows.count() >= 2);
  assert.ok((await arrows.evaluateAll(elements => elements.map(el => getComputedStyle(el, el.tagName === "BUTTON" ? "::after" : null).maskImage))).every(mask => mask.includes("data:image/svg+xml")));
  const gutters = await panel.locator(".floating-toolbar-content").evaluate(el => { const s = getComputedStyle(el); return [parseFloat(s.paddingLeft), parseFloat(s.paddingRight), parseFloat(s.marginLeft), parseFloat(s.marginRight)]; });
  assert.ok(gutters.every(v => v <= 5));
  await page.screenshot({ path: "../.local-logs/ui-nov01-qa/chevrons-and-gutters.png" });
});

test("small-screen Export and Floor controls do not overlap", async t => {
  const session = await harness.session(fixture(), { viewport: { width: 390, height: 844 } }); t.after(() => session.close()); const { page } = session;
  const shortcut = await page.locator(".floorplan-export-shortcut").boundingBox(), floor = await page.locator(".building-floor-bar").boundingBox();
  assert.ok(shortcut && floor && shortcut.x + shortcut.width + 4 <= floor.x);
  assert.ok(await page.locator(".building-floor-bar").evaluate(el => parseFloat(getComputedStyle(el).paddingLeft)) >= 10);
  await page.screenshot({ path: "../.local-logs/ui-nov01-qa/mobile-toolbar.png" });
});

test("modern electrical selector stays clickable and changes the fitting; list has a top gutter", async t => {
  const session = await harness.session(fixture()); t.after(() => session.close()); const { page, context } = session;
  await context.route("**/catalog/items", route => route.fulfill({ json: ["single", "double"].map((type, index) => ({ id: `switch-${type}`, category_id: "electric", category_name: "Electric", fixture_kind: "FURNITURE", subcategory: "Switches", name: `${index ? "Double" : "Single"} rocker switch`, supplier: "Default", sku: type, width_mm: 86, depth_mm: 12, height_mm: 86, color_hex: "#a6adb1", description: "", is_default: true, representation_key: `electrical-switch-${type}` })) }));
  await menu(page, "Tools", "Full Electrical Layout module…");
  await page.locator(".electrical-layout-window").getByRole("button", { name: "Add electrical fitting…", exact: true }).click();
  await page.evaluate(() => { document.body.dataset.uiStyle = "modern"; });
  const editor = page.locator(".element-add-editor:visible");
  const expand = editor.getByRole("button", { name: "Expand fittings selector", exact: true });
  assert.equal(await expand.evaluate(el => getComputedStyle(el).maskImage), "none");
  assert.match(await expand.evaluate(el => getComputedStyle(el, "::after").maskImage), /data:image\/svg\+xml/);
  await expand.click(); await editor.getByRole("button", { name: /^Object/ }).click();
  await editor.getByRole("option", { name: "Double rocker switch", exact: true }).click();
  await editor.locator(".fixture-cascading-collapsed").getByText("Double rocker switch", { exact: true }).waitFor();
  await editor.locator(".fixture-list article").first().scrollIntoViewIfNeeded();
  const header = await editor.getByRole("button", { name: "Elements list", exact: true }).boundingBox(), first = await editor.locator(".fixture-list article").first().boundingBox();
  assert.ok(header && first && first.y - header.y - header.height >= 7);
  await page.screenshot({ path: "../.local-logs/ui-nov01-qa/electrical-selector-modern.png" });
});

test("Heating adds and deletes shared construction scenarios inside the submenu", async t => {
  const session = await harness.session(fixture()); t.after(() => session.close()); const { page } = session;
  await menu(page, "Tools", "Heating Layout"); const panel = page.locator(".heating-layout-window");
  const addElement = panel.getByRole("button", { name: "Add element", exact: true }).first();
  assert.equal(await addElement.evaluate(el => el.scrollHeight > el.clientHeight + 1), false);
  assert.equal(await addElement.evaluate(el => { const range = document.createRange(); range.selectNodeContents(el); return range.getClientRects().length; }), 1);
  const section = panel.locator("details").filter({ has: page.getByText(/^Construction scenario ·/, { exact: false }) });
  await section.locator("summary").first().click();
  const remove = section.getByRole("button", { name: "Delete selected scenario", exact: true });
  assert.equal(await remove.isDisabled(), true);
  await section.getByRole("textbox", { name: "New scenario name", exact: true }).fill("Heating upgrade");
  await section.getByRole("button", { name: "Add scenario", exact: true }).click();
  const saved = await eventually(session.saved, value => value?.energyLayout?.scenarios.length === 1);
  assert.equal(saved.energyLayout.scenarios[0].name, "Heating upgrade");
  assert.equal(await remove.isDisabled(), false);
  page.once("dialog", dialog => dialog.dismiss()); await remove.click();
  assert.equal((await session.saved()).energyLayout.scenarios.length, 1);
  await page.screenshot({ path: "../.local-logs/ui-nov01-qa/heating-scenarios.png" });
  page.once("dialog", dialog => dialog.accept()); await remove.click();
  await eventually(session.saved, value => value?.energyLayout?.scenarios.length === 0 && value.energyLayout.activeScenarioId === null);
  assert.equal(await remove.isDisabled(), true);
  await section.getByRole("button", { name: "Add scenario", exact: true }).click();
  const automatic = await eventually(session.saved, value => value?.energyLayout?.scenarios[0]?.name === "Upgrade 1");
  await page.reload(); await menu(page, "Tools", "Heating Layout");
  await panel.locator("summary").filter({ hasText: "Construction scenario · Upgrade 1" }).click();
  assert.equal(await panel.getByRole("combobox", { name: "Load construction scenario", exact: true }).inputValue(), automatic.energyLayout.activeScenarioId);
});
