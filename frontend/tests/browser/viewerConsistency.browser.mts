import assert from "node:assert/strict";
import test, { before, after } from "node:test";
import { readFile } from "node:fs/promises";
import { newProject, parseProject } from "../../lib/projectDocument";
import { defaultBuilding } from "../../lib/buildingDocument";
import { electricalAsset } from "../../lib/electricalAssets";
import { eventually, menu, startBrowserHarness } from "./harness.mjs";

let harness, palettes;
before(async () => { palettes = JSON.parse(await readFile(new URL("../../../data/ui_theme_defaults.json", import.meta.url), "utf8")).themes; harness = await startBrowserHarness(); });
after(async () => { await harness?.close(); });
function fixture() {
  const project = newProject();
  const measure = value => ({ value, uncertainty_mm: 0, verified: true, source_type: "USER_MEASURED" });
  const vertices = [{ x: 0, y: 0 }, { x: 2400, y: 0 }, { x: 2400, y: 1800 }, { x: 0, y: 1800 }];
  project.rooms = [{ id: "room-view", source_floorplan_room_id: "outline-view", name: "Studio", version: 1, vertices, wall_height: measure(2400), wall_thickness: measure(50), openings: [], obstacles: [] }];
  project.floorplan = { walls: [{ id: "wall-view", points: [...vertices, vertices[0]] }], rooms: [{ id: "outline-view", sourceWallId: "wall-view", sourceWallIds: ["wall-view"], colourIndex: 0, name: "Studio", vertices }], roomFinishes: {}, openings: [], measurements: [], annotations: [], dimensionOffsets: {}, hiddenDimensions: [], canvasSize: { width: 1100, height: 700 }, selectedRoomId: "outline-view", wallHeight: 2400, wallThickness: 50, squaredWalls: true, snapEnabled: true, snapSize: 50, viewSettings: { zoom: 1, pan: { x: 0, y: 0 }, showRoomNames: true, showMeasurements: true, showWallThickness: true, showAnnotations: true, showGrid: true } };
  project.building = defaultBuilding(project); return parseProject(project);
}
const wire = value => JSON.parse(JSON.stringify(value));
const content = project => wire({ rooms: project.rooms, heating: project.heatingLayout, energy: project.energyLayout, building: project.building });
async function dragToMenu(page, window) {
  const bar = await window.locator(".floating-toolbar-titlebar").boundingBox();
  const stage = await page.locator(".building-plan-stage").boundingBox();
  const before = await window.boundingBox();
  await page.mouse.move(bar.x + 150, bar.y + bar.height / 2);
  await page.mouse.down(); await page.mouse.move(bar.x + 150, stage.y + 8 + bar.height / 2, { steps: 12 }); await page.mouse.up();
  await eventually(() => window.boundingBox(), box => Math.abs(box.y - stage.y - 8) < 2, "A free window must reach the area directly below the main menu");
  assert.equal(Math.round((await window.boundingBox()).width), Math.round(before.width), "Dragging must not resize the window");
}

test("service modules are 2D-only, including detached heating settings, without changing saved data", async t => {
  const session = await harness.session(fixture()); t.after(() => session.close()); const { page } = session;
  await menu(page, "Tools", "Heating Layout");
  await page.getByRole("button", { name: "Building assumptions…", exact: true }).click();
  const detached = page.locator(".floating-toolbar").filter({ has: page.locator('.floating-toolbar-titlebar', { hasText: "Heating — Building assumptions" }) });
  await detached.waitFor();
  await eventually(session.saved, value => value.heatingLayout?.enabled);
  const before = content(await session.saved());
  await page.getByRole("button", { name: "3D", exact: true }).click();
  assert.equal(await detached.isVisible(), false, "Portalled module settings must not leak into the 3D viewer");
  await page.getByRole("button", { name: "Tools", exact: true }).click();
  const dropdown = page.locator(".software-dropdown");
  assert.deepEqual(await dropdown.getByRole("button").allTextContents(), ["Save view…"]);
  await page.keyboard.press("Escape");
  assert.deepEqual(content(await session.saved()), before, "Switching views is not a project edit");
  await page.getByRole("button", { name: "2D", exact: true }).click();
  await page.locator(".heating-layout-window").waitFor();
  await page.getByRole("button", { name: "Tools", exact: true }).click();
  for (const name of ["Full Electrical Layout module…", "Heating Layout", "Energy & Insulation"]) assert.ok(await dropdown.getByRole("button", { name, exact: true }).isVisible());
});

test("free windows can reach the menu edge in both viewers while docked headers keep their selector gutter", async t => {
  const session = await harness.session(fixture()); t.after(() => session.close()); const { page } = session;
  const add = page.locator('.floating-toolbar').filter({ has: page.locator('.floating-toolbar-titlebar', { hasText: "Add to plan" }) }).filter({ visible: true });
  const selector = await page.locator('.building-floor-bar').boundingBox(), docked = await add.boundingBox();
  assert.ok(docked.y >= selector.y + selector.height, "Automatic docking must retain the floor-selector gutter");
  await dragToMenu(page, add);
  await menu(page, "Tools", "Heating Layout"); await dragToMenu(page, page.locator(".heating-layout-window"));
  await page.getByRole("button", { name: "3D", exact: true }).click();
  await dragToMenu(page, page.locator('.floating-toolbar').filter({ has: page.locator('.floating-toolbar-titlebar', { hasText: "View properties" }) }).filter({ visible: true }));
});

test("a new multi-gang switch matches existing fittings at 50%, 100% and enlarged zoom, then places at its measured size", async t => {
  const project = fixture(), asset = electricalAsset("electrical-switch-triple")!;
  const measure = value => ({ value, uncertainty_mm: 5, verified: false, source_type: "USER_MEASURED" });
  const placed = { id: "switch-existing", name: asset.name, model_id: asset.key, kind: "BOX", fixture_kind: "FURNITURE", representation_key: asset.key, center: { x: 1200, y: 32 }, rotation_deg: 180, base_z_mm: 1100, wall_lock: true, verified: false, dimensions: { width: measure(asset.width), depth: measure(asset.depth), height: measure(asset.height) } };
  project.rooms[0].obstacles = [placed];
  const session = await harness.session(parseProject(project)); t.after(() => session.close()); const { page } = session;
  const catalogue = [{ id: asset.key, name: asset.name, category_id: "electric", category_name: "Electrical", subcategory: asset.subcategory, fixture_kind: "FURNITURE", representation_key: asset.key, width_mm: asset.width, depth_mm: asset.depth, height_mm: asset.height, color_hex: "#fffdf8", is_default: true, active: true, plan_shape: "RECTANGLE", supplier: "Regression fixture", sku: "test", description: "", images: [], supplier_editable: false, created_at: "2026-10-19T00:00:00Z", updated_at: "2026-10-19T00:00:00Z" }];
  await page.route("**/catalog/items", route => route.fulfill({ json: catalogue }));
  await page.reload(); await menu(page, "Tools", "Full Electrical Layout module…");
  const electrical = page.locator('.electrical-layout-window:not(.heating-layout-window)'), title = await electrical.locator('.floating-toolbar-titlebar').boundingBox();
  await page.mouse.move(title.x + 140, title.y + title.height / 2); await page.mouse.down(); await page.mouse.move(148, title.y + title.height / 2, { steps: 12 }); await page.mouse.up();
  await electrical.getByRole("button", { name: "Add electrical fitting…", exact: true }).click();
  const fittings = page.getByRole("region", { name: "Add fittings", exact: true });
  const expand = fittings.getByRole("button", { name: "Expand fittings selector", exact: true }); if(await expand.isVisible())await expand.click();
  await fittings.getByRole("button", { name: /^Subcategory/ }).click(); await fittings.getByRole("option", { name: "Switches", exact: true }).click();
  await fittings.getByRole("listbox", { name: "Object options", exact: true }).waitFor();
  const options = await fittings.getByRole("option").allTextContents();
  assert.ok(options.some(name => name.startsWith(asset.name)), `Catalogue switch options: ${JSON.stringify(options)}`);
  await fittings.getByRole("option", { name: new RegExp("^" + asset.name) }).click();
  await fittings.getByRole("button", { name: "Add element", exact: true }).click();
  const existing = page.getByRole("button", { name: `Electrical fitting: ${asset.name}`, exact: true }).locator("image").first();
  for (const steps of [-3, 0, 2]) {
    if(steps>=0)await page.getByRole("button", { name: "Reset zoom to 100%", exact: true }).click();
    for(let i=0;i<Math.abs(steps);i++)await page.getByRole("button", { name: steps<0?"Zoom out":"Zoom in", exact: true }).click();
    const box = await existing.boundingBox();
    // Stay above the placement status strip even when zooming the bottom wall off-screen.
    const at = { x: box.x + box.width / 2 + 70, y: box.y + box.height / 2 - 100 };
    await page.mouse.move(at.x, at.y);
    const preview = page.locator(".placement-preview image").first();
    try { await preview.waitFor(); } catch (error) {
      if(process.env.BROWSER_ARTIFACTS)await page.screenshot({ path: process.env.BROWSER_ARTIFACTS + "/viewer-placement-diagnostic.png" });
      const hit = await page.evaluate(({ x, y }) => { const e = document.elementFromPoint(x, y); return { tag: e?.tagName, window: e?.closest('.floating-toolbar')?.querySelector('.floating-toolbar-titlebar')?.textContent }; }, at);
      throw new Error(`Placement preview at zoom step ${steps}, existing ${JSON.stringify(box)}, hit ${JSON.stringify(hit)}`, { cause: error });
    }
    const ghost = await preview.boundingBox();
    assert.ok(Math.abs(ghost.width - box.width) < .05 && Math.abs(ghost.height - box.height) < .05, JSON.stringify({ box, ghost }));
    assert.equal(await preview.evaluate(element => getComputedStyle(element).pointerEvents), "none", "A placement ghost must never steal a canvas click");
  }
  // A measured wall placement commits exactly the catalogue dimensions, not the schematic face.
  await page.getByRole("button", { name: "Reset zoom to 100%", exact: true }).click();
  const box = await existing.boundingBox(); await page.mouse.move(box.x + box.width / 2 + 70, box.y + box.height / 2);
  await eventually(() => page.locator(".placement-preview text").textContent(), text => text === "Click to place");
  if(process.env.BROWSER_ARTIFACTS)await page.screenshot({ path: process.env.BROWSER_ARTIFACTS + "/viewer-electrical-preview.png" });
  await page.mouse.click(box.x + box.width / 2 + 70, box.y + box.height / 2);
  await eventually(session.saved, value => value.rooms[0].obstacles.length === 2);
  const saved = await session.saved(), added = saved.rooms[0].obstacles.find(item => item.id !== placed.id);
  assert.deepEqual(added.dimensions, placed.dimensions);
  const existingSaved = saved.rooms[0].obstacles.find(item=>item.id===placed.id);
  assert.ok(Math.hypot(existingSaved.center.x-placed.center.x,existingSaved.center.y-placed.center.y)<1e-8, "Adding a fitting must not move an existing wall-mounted switch");
  assert.deepEqual({...existingSaved,center:placed.center},placed);
});

test("room settings launchers share one wide row and two compact rows; every window still opens", async t => {
  const session = await harness.session(fixture()); t.after(() => session.close()); const { page } = session;
  await menu(page, "Tools", "Heating Layout"); const heating = page.locator(".heating-layout-window");
  const buttons = heating.locator(".heating-settings-launcher");
  assert.equal(await buttons.count(), 3);
  const boxes = await buttons.evaluateAll(elements => elements.map(element => { const r = element.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height }; }));
  assert.ok(boxes.every(box => Math.abs(box.y - boxes[0].y) < 1), JSON.stringify(boxes));
  assert.ok(boxes.every(box => Math.abs(box.width - boxes[0].width) < 1));
  if(process.env.BROWSER_ARTIFACTS)await heating.screenshot({ path: process.env.BROWSER_ARTIFACTS + "/viewer-heating-wide.png" });
  for (const index of [0, 1, 2]) {
    await buttons.nth(index).click();
    const window = page.locator(".floating-toolbar").filter({ has: page.locator('.floating-toolbar-titlebar', { hasText: "Heating —" }) });
    await window.waitFor(); assert.ok(await window.getByRole("button", { name: /^Help for Heating/ }).isVisible());
    await window.getByRole("button", { name: "Done", exact: true }).click();
  }
  const edge = await heating.getByRole("button", { name: "Resize Heating Layout from the right edge", exact: true }).boundingBox();
  await page.mouse.move(edge.x + edge.width / 2, edge.y + edge.height / 2); await page.mouse.down();
  await page.mouse.move(edge.x + edge.width / 2 - 220, edge.y + edge.height / 2, { steps: 12 }); await page.mouse.up();
  await eventually(() => buttons.evaluateAll(elements => elements.map(element => Math.round(element.getBoundingClientRect().y))), rows => new Set(rows).size === 2, "Resizing the window itself should produce two rows");
  await page.setViewportSize({ width: 540, height: 850 });
  await eventually(() => buttons.evaluateAll(elements => elements.map(element => Math.round(element.getBoundingClientRect().y))), rows => new Set(rows).size === 2, "Compact room settings should wrap to two rows");
  await buttons.first().scrollIntoViewIfNeeded();
  assert.equal(await heating.evaluate(element => element.scrollWidth > element.clientWidth + 1), false);
  if(process.env.BROWSER_ARTIFACTS)await page.screenshot({ path: process.env.BROWSER_ARTIFACTS + "/viewer-heating-compact.png" });
});

test("Show wall display uses standard menu styling in both themes, styles, densities and small screens", async t => {
  const session = await harness.session(fixture()); t.after(() => session.close()); const { page } = session;
  await page.getByRole("button", { name: "3D", exact: true }).click();
  for (const style of ["DEFAULT", "MODERN"]) for (const theme of ["light", "dark"]) for (const density of ["comfortable", "compact"]) for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 850 });
    await page.evaluate(({ style, theme, density, palette }) => {
      const root = document.documentElement; root.dataset.theme = theme; root.dataset.density = density; document.body.dataset.uiStyle = style.toLowerCase();
      for (const [key, value] of Object.entries(palette.colours)) root.style.setProperty("--configured-" + key, value);
      for (const [key, value] of Object.entries(palette.buttons)) root.style.setProperty("--configured-ui-button-" + key, value);
      for (const [key, value] of Object.entries(palette.windows)) root.style.setProperty("--configured-ui-window-" + key, value);
      root.style.setProperty("--font-sans", palette.typography.sans); root.style.setProperty("--font-mono", palette.typography.controls);
    }, { style, theme, density, palette: palettes[style] });
    await page.getByRole("button", { name: "Show", exact: true }).click();
    const show = page.locator(".software-show-menu"), summary = show.locator(".software-wall-setting > summary");
    assert.equal(await summary.innerText(), "Wall display");
    const styles = await show.evaluate(element => [element.querySelector("summary"), ...element.querySelectorAll(":scope > button")].map(item => { const s = getComputedStyle(item), b = item.getBoundingClientRect(); return { family: s.fontFamily, size: s.fontSize, weight: s.fontWeight, height: b.height, radius: s.borderRadius, background: s.backgroundColor, colour: s.color }; }));
    assert.ok(styles.length > 2); assert.ok(styles.every(s => JSON.stringify(s) === JSON.stringify(styles[0])), JSON.stringify({ style, theme, density, width, styles }));
    const bounds = await show.boundingBox(); assert.ok(bounds.x >= -1 && bounds.x + bounds.width <= width + 1);
    await summary.click(); assert.equal(await show.getByRole("menuitemradio").count(), 5);
    if(process.env.BROWSER_ARTIFACTS && style === "MODERN" && density === "comfortable")await page.screenshot({ path: `${process.env.BROWSER_ARTIFACTS}/viewer-show-${theme}-${width}.png` });
    await page.keyboard.press("Escape"); await page.keyboard.press("Escape");
  }
});
