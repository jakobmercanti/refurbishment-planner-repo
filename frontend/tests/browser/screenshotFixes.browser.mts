import assert from "node:assert/strict";
import test, { before, after } from "node:test";
import { cfdProject } from "../climoptixFixtures";
import { electricalAsset } from "../../lib/electricalAssets";
import { cfdWindow, eventually, menu, startBrowserHarness } from "./harness.mjs";

let harness;
before(async () => { harness = await startBrowserHarness({ climoptixEnabled: true }); });
after(async () => { await harness?.close(); });
const button = (scope, name) => scope.getByRole("button", { name, exact: true });
const frame = page => page.locator(".cfx-setup-window");
async function open(t, project = cfdProject()) {
  const session = await harness.session(project, { viewport: { width: 1440, height: 1000 } });
  t.after(() => session.close()); return session;
}
async function layout(page, window, action) {
  const title = await window.locator(".floating-toolbar-titlebar").getAttribute("aria-label");
  await button(window, `Window layout for ${title.slice(5)}`).click();
  await page.getByRole("menuitem", { name: action, exact: true }).click();
}
async function drag(page, from, to, fraction = .5) {
  await from.scrollIntoViewIfNeeded(); const a = await from.boundingBox();
  await to.scrollIntoViewIfNeeded(); const b = await to.boundingBox();
  await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2); await page.mouse.down();
  await page.mouse.move(b.x + b.width / 2, b.y + b.height * fraction, { steps: 18 }); await page.mouse.up();
}
async function capture(page, name) {
  if (process.env.BROWSER_ARTIFACTS) await page.screenshot({ path: `${process.env.BROWSER_ARTIFACTS}/screenshot-fixes-${name}.png` });
}

test("real captured mouse gestures reorder groups and simulations, cancel safely and keep action popovers inside short viewports", async t => {
  const { page, saved } = await open(t);
  await page.getByRole("combobox", { name: "Workspace", exact: true }).selectOption("CLIMOPTIX");
  const ui = page.locator(".cfx-workspace"); await cfdWindow(ui, "Simulations");
  await layout(page, frame(page), "Maximise window");
  await button(ui, "New simulation").click(); await button(ui, "New simulation").click();
  await button(ui, "Add group").click();
  const general = ui.getByRole("region", { name: "Simulation group General", exact: true });
  const group = ui.getByRole("region", { name: "Simulation group Group", exact: true });
  const grip = button(ui, "Reorder Group"), collapse = button(group, "Collapse group Group");
  const [g, c] = await Promise.all([grip.boundingBox(), collapse.boundingBox()]);
  assert.ok(Math.abs(g.y - c.y) < 2, JSON.stringify({ g, c }));
  await drag(page, grip, general.locator(".cfx-group-heading"), .1);
  await eventually(saved, p => p.cfdSimulationGroups[0].name === "Group");
  await drag(page, button(ui, "Reorder Simulation 3"), general.locator('.cfx-reorder-item').first(), .1);
  await eventually(saved, p => p.cfdScenarios[0].name === "Simulation 3");
  await drag(page, button(ui, "Reorder Office airflow"), group.locator(".cfx-list-header"));
  await eventually(saved, p => p.cfdScenarios.find(s => s.name === "Office airflow").group === "Group");
  const before = JSON.stringify((await saved()).cfdScenarios);
  const a = await button(ui, "Reorder Simulation 2").boundingBox(), b = await group.locator(".cfx-list-header").boundingBox();
  await page.mouse.move(a.x + 10, a.y + 10); await page.mouse.down(); await page.mouse.move(b.x + 50, b.y + 15, { steps: 12 });
  await page.keyboard.press("Escape"); await page.mouse.up();
  assert.equal(JSON.stringify((await saved()).cfdScenarios), before);
  assert.equal(await frame(page).getAttribute("data-window-maximized"), "true", "Drag cancellation must not restore the window");
  await page.setViewportSize({ width: 760, height: 500 });
  await ui.getByLabel("Actions for Simulation 2", { exact: true }).click();
  const popup = ui.locator(".cfx-row-menu-panel:popover-open"); const box = await popup.boundingBox();
  assert.ok(box.x >= 0 && box.y >= 0 && box.x + box.width <= 761 && box.y + box.height <= 501, JSON.stringify(box));
  await capture(page, "short-popover");
  await page.keyboard.press("Escape"); await eventually(() => popup.count(), n => !n);
  await page.keyboard.press("Escape");
  await eventually(() => frame(page).getAttribute("data-window-maximized"), v => v === null);
  assert.ok(await frame(page).isVisible(), "Escape restores, not closes, a maximised setup");
});

test("boundary folders edit only on request, drafts remain grouped, responsive sections and 3D return preserve setup", async t => {
  const { page, saved } = await open(t);
  await page.getByRole("combobox", { name: "Workspace", exact: true }).selectOption("CLIMOPTIX");
  const ui = page.locator(".cfx-workspace"); await cfdWindow(ui, "Boundaries");
  await layout(page, frame(page), "Maximise window");
  await button(ui, "Add boundary group").click();
  assert.equal(await button(ui, "Hide Edit boundary group").count(), 0);
  await button(ui, "Edit boundary group Group").click();
  const editor = page.locator(".floating-toolbar").filter({ has: page.getByLabel("Move Edit boundary group", { exact: true }) });
  assert.ok((await editor.boundingBox()).height < 390);
  await button(editor, "Hide Edit boundary group").click();
  await cfdWindow(ui, "Physics");
  for (const title of ["Models & equations", "Fluid properties", "Reference & ambient conditions", "Initial fields", "Requested outputs & monitoring points"]) assert.ok(await ui.locator("summary").getByText(title, { exact: true }).isVisible());
  await capture(page, "physics-sections");
  await cfdWindow(ui, "Solver"); await ui.getByRole("tab", { name: "Post-processing", exact: true }).click();
  const planes = ui.getByRole("group", { name: "Sampling plane directions", exact: true });
  assert.equal(await planes.evaluate(el => getComputedStyle(el).gridTemplateColumns.split(" ").length), 3);
  await page.setViewportSize({ width: 1050, height: 850 });
  await eventually(() => planes.evaluate(el => getComputedStyle(el).gridTemplateColumns.split(" ").length), n => n === 3);
  await capture(page, "post-columns");
  await ui.getByRole("tab", { name: "Mesh", exact: true }).click();
  await button(ui, "Add refinement region").click(); await button(ui, "Hide Edit refinement").click();
  await button(ui, "View refinements in 3D").click();
  assert.equal(await frame(page).isVisible(), false);
  await page.setViewportSize({ width: 390, height: 850 });
  const controls = await ui.locator(".cfx-view-selector").boundingBox();
  assert.ok(controls.x >= 0 && controls.x + controls.width <= 391, JSON.stringify(controls));
  assert.ok(await ui.locator(".cfx-viewer > footer").evaluate(el => el.scrollWidth <= el.clientWidth + 1));
  await capture(page, "mobile-inspection-legend");
  await button(ui, "Return to setup").waitFor(); await page.keyboard.press("Escape");
  await eventually(() => frame(page).isVisible(), Boolean);
  assert.equal(await frame(page).getAttribute("data-window-maximized"), "true");
  await page.setViewportSize({ width: 1050, height: 850 });
  await button(ui, "View refinements in 3D").click(); await button(ui, "Return to setup").click();
  assert.ok(await frame(page).isVisible());
  await cfdWindow(ui, "Simulations"); await button(ui, "New simulation").click();
  await cfdWindow(ui, "Equipment");
  await button(ui, "+ Supply").click();
  await eventually(saved, p => p.cfdScenarios.at(-1).vents.length === 1);
  const ventEditor = page.locator(".cfx-equipment-editor");
  assert.ok(await ventEditor.getByText(/Unassigned vent/).isVisible());
  await button(ventEditor, "Hide Edit equipment").click();
});

test("outside left clicks dismiss the background toolbar menu even over floating UI; Heating fields align and fullscreen restores", async t => {
  const { page } = await open(t);
  await menu(page, "Tools", "Heating Layout"); const heating = page.locator(".heating-layout-window");
  const temperature = heating.getByRole("spinbutton", { name: "Room target temperature °C", exact: true });
  const method = heating.getByRole("combobox", { name: /^Heating method/ });
  const [a, b] = await Promise.all([temperature.boundingBox(), method.boundingBox()]);
  assert.ok(Math.abs(a.y - b.y) < 2, JSON.stringify({ a, b }));
  const heading = heating.getByRole("button", { name: "Help for Selected room", exact: true });
  const room = heating.getByRole("combobox", { name: "Selected room", exact: true });
  assert.ok((await heading.boundingBox()).x > (await room.boundingBox()).x + (await room.boundingBox()).width);
  await capture(page, "heating");
  const point = await page.evaluate(() => {
    const svg = document.querySelector(".floor-canvas"), box = svg.getBoundingClientRect();
    for (let y = box.top + 40; y < box.bottom - 40; y += 35) for (let x = box.left + 30; x < box.right - 30; x += 35) {
      const el = document.elementFromPoint(x, y);
      if (el === svg || el?.classList.contains("canvas-background")) return { x, y };
    }
  });
  assert.ok(point); await page.mouse.click(point.x, point.y, { button: "right" });
  await page.locator(".toolbar-context-menu").waitFor();
  await heating.getByLabel("Move Heating Layout", { exact: true }).click({ position: { x: 100, y: 20 } });
  assert.equal(await page.locator(".toolbar-context-menu").count(), 0);
  await layout(page, heating, "Maximise window");
  assert.equal(await page.locator(".topbar").isVisible(), false);
  await page.keyboard.press("Escape");
  await eventually(() => heating.getAttribute("data-window-maximized"), v => v === null);
  assert.ok(await page.locator(".topbar").isVisible());
});

test("pendant schematic and newly placed preview share zoom scaling without changing catalogue millimetres", async t => {
  const project = cfdProject(), asset = electricalAsset("electrical-pendant-dome")!;
  const measure = value => ({ value, verified: false, uncertainty_mm: 5, source_type: "USER_MEASURED" });
  const dimensions = { width: measure(asset.width), depth: measure(asset.depth), height: measure(asset.height) };
  project.rooms[0].obstacles = [{ id: "existing-pendant", name: asset.name, representation_key: asset.key, model_id: asset.key, kind: "BOX", fixture_kind: "FURNITURE", center: { x: 2000, y: 3000 }, rotation_deg: 0, base_z_mm: 1500, verified: false, dimensions }];
  const { page, saved } = await open(t, project);
  await page.route("**/catalog/items", route => route.fulfill({ json: [{ id: asset.key, name: asset.name, category_id: "electric", category_name: "Electrical", subcategory: asset.subcategory, fixture_kind: "FURNITURE", representation_key: asset.key, width_mm: asset.width, depth_mm: asset.depth, height_mm: asset.height, color_hex: "#fffdf8", is_default: true, active: true, plan_shape: "RECTANGLE", supplier: "Regression fixture", sku: "test", description: "", images: [], supplier_editable: false, created_at: "2026-10-19T00:00:00Z", updated_at: "2026-10-19T00:00:00Z" }] }));
  await page.reload(); await menu(page, "Tools", "Full Electrical Layout module…");
  const window = page.locator(".electrical-layout-window:not(.heating-layout-window)");
  const bar = await window.locator(".floating-toolbar-titlebar").boundingBox();
  await page.mouse.move(bar.x + 140, bar.y + 20); await page.mouse.down();
  await page.mouse.move(1240, bar.y + 20, { steps: 15 }); await page.mouse.up();
  await button(window, "Add electrical fitting…").click();
  const fittings = page.getByRole("region", { name: "Add fittings", exact: true });
  const expand = button(fittings, "Expand fittings selector"); if (await expand.isVisible()) await expand.click();
  await fittings.getByRole("button", { name: /^Subcategory/ }).click(); await fittings.getByRole("option", { name: "Pendants", exact: true }).click();
  await fittings.getByRole("option", { name: new RegExp("^" + asset.name) }).click(); await button(fittings, "Add element").click();
  const existing = button(page, `Electrical fitting: ${asset.name}`).locator("image").first();
  for (const zoom of [0, -2, 2]) {
    await button(page, "Reset zoom to 100%").click();
    for (let i = 0; i < Math.abs(zoom); i++) await button(page, zoom < 0 ? "Zoom out" : "Zoom in").click();
    const box = await existing.boundingBox();
    assert.ok(box.width < 60, `Compact schematic at zoom step ${zoom}: ${box.width}`);
    await page.mouse.move(box.x + 80, box.y + 30);
    const preview = page.locator(".placement-preview image").first();
    try { await preview.waitFor(); } catch (error) {
      await capture(page, "pendant-failure");
      throw new Error(`No preview at zoom ${zoom}, existing ${JSON.stringify(box)}`, { cause: error });
    }
    const ghost = await preview.boundingBox(); assert.ok(Math.abs(ghost.width - box.width) < .1, JSON.stringify({ box, ghost }));
  }
  await capture(page, "pendant-preview");
  const box = await existing.boundingBox(); await page.mouse.click(box.x + 80, box.y + 30);
  await eventually(saved, p => p.rooms[0].obstacles.length === 2);
  assert.deepEqual((await saved()).rooms[0].obstacles.find(o => o.id !== "existing-pendant").dimensions, dimensions);
});

test("fullscreen retains related help and layer drafts while hiding unrelated windows, and Escape restores before closing", async t => {
  const { page, saved } = await open(t);
  await menu(page, "Tools", "Energy & Insulation"); const energy = page.locator(".energy-layout-window");
  await energy.getByRole("combobox", { name: "Select wall", exact: true }).selectOption({ index: 1 });
  await eventually(saved, p => p.energyLayout?.enabled);
  const source = JSON.stringify((await saved()).rooms);
  await layout(page, energy, "Maximise window");
  await button(energy, "Help for Energy & Insulation").click();
  const help = page.locator(".floating-toolbar").filter({ has: page.getByLabel("Move Help — Energy & Insulation", { exact: true }) });
  assert.ok(await help.isVisible()); await layout(page, help, "Maximise window");
  await page.keyboard.press("Escape");
  await eventually(() => help.getAttribute("data-window-maximized"), v => v === null);
  assert.ok(await help.isVisible()); await page.keyboard.press("Escape"); await help.waitFor({ state: "detached" });
  assert.equal(await energy.getAttribute("data-window-maximized"), "true");
  await energy.getByRole("button", { name: /Define wall layers/ }).click();
  const editor = page.getByRole("dialog", { name: "Define wall layers", exact: true });
  assert.ok(await editor.isVisible()); await button(editor, "Add layer").click();
  assert.equal(await editor.locator(".appearance-object-heading").count(), 0);
  const draft = await editor.getByRole("group").first().textContent();
  await layout(page, editor, "Maximise window");
  assert.ok(await energy.evaluate(el => el.inert));
  await capture(page, "layers-fullscreen");
  await page.keyboard.press("Escape");
  await eventually(() => editor.getAttribute("data-window-maximized"), v => v === null);
  assert.equal(await editor.getByRole("group").first().textContent(), draft);
  await button(editor, "Cancel").click();
  assert.equal(await energy.getAttribute("data-window-maximized"), "true");
  assert.equal(JSON.stringify((await saved()).rooms), source);
  await button(energy, "Hide Energy & Insulation").click(); assert.ok(await page.locator(".topbar").isVisible());
});

test("3D and CFD background menus dismiss on an outside left press over UI", async t => {
  const { page } = await open(t);
  for (const workspace of ["FLOORPLAN", "CLIMOPTIX"]) {
    await page.getByRole("combobox", { name: "Workspace", exact: true }).selectOption(workspace);
    if (workspace === "FLOORPLAN") await button(page, "3D").click();
    else await button(page.locator(".cfx-workspace"), "Hide Simulation setup").click();
    const canvas = page.locator(workspace === "FLOORPLAN" ? ".analysis-workspace:visible .stable-canvas-host canvas" : ".cfx-workspace canvas");
    await canvas.waitFor(); const box = await canvas.boundingBox();
    // StableCanvas uses a wrapper event source; the hit element need not be the
    // canvas itself. Reuse the unobstructed navigation reproduction coordinates.
    await page.mouse.click(box.x + box.width * .55, box.y + box.height * .7, { button: "right" });
    const popup = page.locator(workspace === "FLOORPLAN" ? ".toolbar-context-menu" : ".cfx-context-menu");
    await popup.waitFor();
    if (workspace === "FLOORPLAN") await page.locator(".floating-toolbar-titlebar:visible").first().click({ position: { x: 90, y: 20 } });
    else await button(page.locator(".cfx-view-selector"), "Fit").click();
    await eventually(() => popup.count(), n => n === 0);
  }
});
