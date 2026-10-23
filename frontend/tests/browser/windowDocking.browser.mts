import assert from "node:assert/strict";
import test, { before, after } from "node:test";
import { cfdProject } from "../climoptixFixtures";
import { cfdWindow, eventually, menu, startBrowserHarness } from "./harness.mjs";

let harness;
before(async () => { harness = await startBrowserHarness(); });
after(async () => { await harness?.close(); });

const panel = (page, title) => page.locator(".floating-toolbar").filter({ has: page.getByLabel(`Move ${title}`, { exact: true }) }).filter({ visible: true });
async function layout(page, title, action) {
  const window = panel(page, title);
  await window.getByLabel(`Move ${title}`, { exact: true }).click({ position: { x: 100, y: 20 } });
  await window.getByRole("button", { name: `Window layout for ${title}`, exact: true }).click();
  await page.getByRole("menu", { name: `${title} window layout`, exact: true }).getByRole("menuitem", { name: action, exact: true }).click();
  return window;
}
async function open(t, cfd = false) {
  const session = await harness.session(cfdProject());
  t.after(() => session.close());
  if (cfd) await session.page.getByRole("combobox", { name: "Workspace", exact: true }).selectOption("CLIMOPTIX");
  return session;
}
async function screenshot(page, name) {
  if (process.env.BROWSER_ARTIFACTS) {
    // Bounds animates camera fitting for 250 ms after its canvas is resized.
    await page.waitForTimeout(300);
    await page.screenshot({ path: `${process.env.BROWSER_ARTIFACTS}/window-docking-${name}.png` });
  }
}
async function sameWidth(locator, expected) {
  await eventually(() => locator.boundingBox(), box => !!box && Math.abs(box.width - expected) < 2);
}
// Compare authoritative measurements, not optional defaults filled by the editor
// (e.g. empty component colours/person state or saved view settings).
const geometry = project => JSON.parse(JSON.stringify({
  rooms: project.rooms.map(room => ({
    id: room.id, vertices: room.vertices, height: room.wall_height,
    thickness: room.wall_thickness, obstacles: room.obstacles,
    openings: room.openings.map(opening => ({ id: opening.id, kind: opening.kind, wall: opening.parent_wall_id, offset: opening.offset_mm, width: opening.width, height: opening.height, sill: opening.sill_height_mm, profile: opening.passage_profile })),
  })),
  floorplan: { walls: project.floorplan.walls, rooms: project.floorplan.rooms, openings: project.floorplan.openings, wallHeight: project.floorplan.wallHeight, wallThickness: project.floorplan.wallThickness },
  building: project.building, instances: project.assetInstances,
}));

test("CFD attaches to either side, truly resizes WebGL, resizes the rail and restores floating dimensions without losing inputs", async t => {
  const { page, saved } = await open(t, true);
  const ui = page.locator(".cfx-workspace");
  const viewer = ui.locator(":scope > .cfx-viewer");
  const full = await ui.boundingBox();
  await cfdWindow(ui, "Simulation");
  await ui.getByRole("tab", { name: "Run", exact: true }).click();
  const cpu = ui.getByRole("spinbutton", { name: "CPU cores", exact: true });
  await cpu.fill("7"); await cpu.press("Enter");
  const original = await panel(page, "Simulation setup").boundingBox();
  const window = await layout(page, "Simulation setup", "Dock left");
  await eventually(() => window.getAttribute("data-edge-docked"), value => value === "LEFT");
  const docked = await window.boundingBox();
  const reduced = await viewer.boundingBox();
  assert.ok(reduced.x >= docked.x + docked.width + 7);
  assert.ok(reduced.width < full.width - 200);
  await sameWidth(viewer.locator("canvas").first(), reduced.width);
  assert.equal(await cpu.inputValue(), "7");
  const edge = await window.locator(".floating-toolbar-resize-right").boundingBox();
  await page.mouse.move(edge.x + edge.width / 2, edge.y + 60); await page.mouse.down();
  await page.mouse.move(edge.x - 100, edge.y + 60, { steps: 8 }); await page.mouse.up();
  await eventually(() => window.boundingBox(), box => box.width < docked.width - 50);
  await screenshot(page, "cfd-left");
  await layout(page, "Simulation setup", "Dock right");
  await eventually(() => window.getAttribute("data-edge-docked"), value => value === "RIGHT");
  const right = await window.boundingBox(), rightView = await viewer.boundingBox();
  assert.ok(rightView.x + rightView.width <= right.x - 7);
  await layout(page, "Simulation setup", "Float window");
  await sameWidth(viewer, full.width);
  await sameWidth(window, original.width);
  assert.equal(await cpu.inputValue(), "7");
  await eventually(saved, project => project.cfdScenarios[0].resources.cpu === 7);
});

test("drag shows the exact docking preview, moving away cancels it, Escape cancels a drop, and undocking restores the view", async t => {
  const { page } = await open(t, true);
  const ui = page.locator(".cfx-workspace"), window = panel(page, "Simulation setup");
  const root = await ui.boundingBox(), original = await window.boundingBox();
  const title = window.getByLabel("Move Simulation setup", { exact: true });
  async function startDrag() {
    const box = await title.boundingBox();
    await page.mouse.move(box.x + 100, box.y + 20); await page.mouse.down();
    return box;
  }
  await startDrag();
  await page.mouse.move(root.x + 108, root.y + 90, { steps: 8 });
  const preview = page.locator(".window-dock-preview");
  await preview.waitFor();
  assert.equal(await preview.getAttribute("data-dock-side"), "LEFT");
  await sameWidth(ui.locator(":scope > .cfx-viewer"), root.width);
  await screenshot(page, "preview-light");
  await page.mouse.move(root.x + 280, root.y + 130, { steps: 8 });
  await eventually(() => preview.count(), count => count === 0);
  await page.mouse.up();
  assert.equal(await window.getAttribute("data-edge-docked"), null);
  await startDrag();
  await page.mouse.move(root.x + 108, root.y + 90, { steps: 8 });
  await preview.waitFor(); await page.keyboard.press("Escape"); await page.mouse.up();
  assert.equal(await preview.count(), 0);
  assert.equal(await window.getAttribute("data-edge-docked"), null);
  await startDrag();
  await page.mouse.move(root.x + 108, root.y + 90, { steps: 8 });
  await preview.waitFor(); const planned = await preview.boundingBox(); await page.mouse.up();
  await eventually(() => window.getAttribute("data-edge-docked"), value => value === "LEFT");
  const attached = await window.boundingBox();
  assert.ok(Math.abs(attached.width - planned.width) < 2);
  assert.ok(Math.abs(attached.height - planned.height) < 2);
  // A title click is not an undock.
  await title.click({ position: { x: 100, y: 20 } });
  assert.equal(await window.getAttribute("data-edge-docked"), "LEFT");
  await startDrag();
  await page.mouse.move(root.x + 380, root.y + 210, { steps: 12 }); await page.mouse.up();
  await eventually(() => window.getAttribute("data-edge-docked"), value => value === null);
  await sameWidth(window, original.width);
  await sameWidth(ui.locator(":scope > .cfx-viewer"), root.width);
  assert.equal(await preview.count(), 0);
});

test("floorplan 2D docks left/right without changing geometry; a hidden view and closed panels reserve no space", async t => {
  const { page, saved } = await open(t);
  const root = page.locator(".building-plan-stage"), drawing = page.locator(".full-plan-drawing");
  const full = await root.boundingBox(), before = geometry(await saved());
  const build = await layout(page, "Build floorplan", "Dock left");
  const view = await layout(page, "View properties", "Dock right");
  const buildBox = await build.boundingBox(), viewBox = await view.boundingBox(), canvas = await drawing.boundingBox();
  assert.ok(canvas.x >= buildBox.x + buildBox.width + 7);
  assert.ok(canvas.x + canvas.width <= viewBox.x - 7);
  assert.ok(canvas.width >= 320 - 2);
  await sameWidth(drawing.locator(".floor-canvas"), canvas.width);
  await screenshot(page, "floorplan-2d");
  await page.getByRole("button", { name: "3D", exact: true }).click();
  await sameWidth(page.locator(".analysis-workspace > .viewer-shell"), full.width);
  await page.getByRole("button", { name: "2D", exact: true }).click();
  await eventually(() => drawing.boundingBox(), box => box.width < full.width - 400);
  await build.getByRole("button", { name: "Hide Build floorplan", exact: true }).click();
  await view.getByRole("button", { name: "Hide View properties", exact: true }).click();
  await sameWidth(drawing, full.width);
  assert.deepEqual(geometry(await saved()), before);
});

test("building, roof and portalled help windows share stacking, close cleanup and viewport reservations", async t => {
  const { page } = await open(t);
  await page.getByRole("button", { name: "Manage floors and building", exact: true }).click();
  const manager = await layout(page, "Floors & building", "Dock left");
  await manager.getByRole("button", { name: "Edit roof", exact: true }).click();
  const roof = await layout(page, "Roof & ceiling", "Dock left");
  const top = await manager.boundingBox(), bottom = await roof.boundingBox();
  assert.ok(top.y + top.height <= bottom.y - 7);
  assert.ok(Math.abs(top.width - bottom.width) < 1);
  const rail = await roof.locator(".floating-toolbar-resize-right").boundingBox();
  await page.mouse.move(rail.x + 2, rail.y + 40); await page.mouse.down();
  await page.mouse.move(rail.x - 70, rail.y + 40, { steps: 8 }); await page.mouse.up();
  await eventually(() => manager.boundingBox(), box => box.width < top.width - 50);
  const resized = await manager.boundingBox();
  await sameWidth(roof, resized.width);
  await roof.getByRole("button", { name: "Help for Roof & ceiling", exact: true }).click();
  const help = await layout(page, "Help — Roof & ceiling", "Dock right");
  assert.equal(await help.getAttribute("data-edge-docked"), "RIGHT");
  const helpTitle = await help.getByLabel("Move Help — Roof & ceiling", { exact: true }).boundingBox();
  await page.mouse.move(helpTitle.x + 80, helpTitle.y + 20); await page.mouse.down();
  await page.mouse.move(700, helpTitle.y + 90, { steps: 8 });
  await page.keyboard.press("Escape"); await page.mouse.up();
  assert.equal(await help.getAttribute("data-edge-docked"), "RIGHT");
  await screenshot(page, "building-help");
  await help.getByRole("button", { name: "Hide Help — Roof & ceiling", exact: true }).click();
  await roof.getByRole("button", { name: "Hide Roof & ceiling", exact: true }).click();
  await eventually(() => manager.boundingBox(), box => box.height > top.height + 100);
  await manager.getByRole("button", { name: "Hide Floors & building", exact: true }).click();
  const root = await page.locator(".building-plan-stage").boundingBox();
  await sameWidth(page.locator(".full-plan-drawing"), root.width);
});

test("floorplan 3D shrinks its canvas, and drag-undocking restores the original floating window", async t => {
  const { page } = await open(t);
  await page.getByRole("button", { name: "3D", exact: true }).click();
  const viewer = page.locator(".analysis-workspace > .viewer-shell");
  const full = await viewer.boundingBox();
  const window = panel(page, "Add elements"), original = await window.boundingBox();
  await layout(page, "Add elements", "Dock left");
  await layout(page, "View properties", "Dock right");
  const reduced = await viewer.boundingBox();
  assert.ok(reduced.width < full.width - 400);
  await sameWidth(viewer.locator("canvas").first(), reduced.width);
  const title = await window.getByLabel("Move Add elements", { exact: true }).boundingBox();
  await page.mouse.move(title.x + 60, title.y + 20); await page.mouse.down();
  await page.mouse.move(700, title.y + 140, { steps: 16 }); await page.mouse.up();
  assert.equal(await window.getAttribute("data-edge-docked"), null);
  await sameWidth(window, original.width);
  await layout(page, "View properties", "Float window");
  await sameWidth(viewer, full.width);
  await screenshot(page, "floorplan-3d");
});

test("dark/light compact screens suspend docks safely, restore them on resize, and isolate workbench layouts", async t => {
  const { page } = await open(t, true);
  const window = await layout(page, "Simulation setup", "Dock right");
  const ui = page.locator(".cfx-workspace");
  for (const style of ["default", "modern"]) for (const theme of ["dark", "light"]) {
    await page.evaluate(value => { document.body.dataset.uiStyle = value; }, style);
    await page.emulateMedia({ colorScheme: theme });
    for (const width of [1024, 768, 390, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      await eventually(() => window.getAttribute("data-edge-docked"), value => width >= 720 ? value === "RIGHT" : value === null);
      const root = await ui.boundingBox(), viewer = await ui.locator(":scope > .cfx-viewer").boundingBox();
      assert.ok(viewer.width >= Math.min(248, width));
      if (width === 390) {
        await sameWidth(ui.locator(":scope > .cfx-viewer"), root.width);
        assert.equal(await ui.getByRole("combobox", { name: "CFD scenario", exact: true }).count(), 0);
        assert.ok(await ui.getByRole("combobox", { name: "CFD phase", exact: true }).isVisible());
      } else {
        const name = await ui.locator(".cfx-study-name strong").first().boundingBox();
        assert.ok(name.width > 100 && name.height < 80, JSON.stringify(name));
      }
      const box = await window.boundingBox();
      assert.ok(box.x >= -1 && box.x + box.width <= width + 1);
      assert.ok(box.y + box.height <= 901);
      await screenshot(page, `${style}-${theme}-${width}`);
    }
  }
  await page.getByRole("combobox", { name: "Workspace", exact: true }).selectOption("FLOORPLAN");
  await sameWidth(page.locator(".full-plan-drawing"), 1440);
  await page.getByRole("combobox", { name: "Workspace", exact: true }).selectOption("CLIMOPTIX");
  await eventually(() => window.getAttribute("data-edge-docked"), value => value === "RIGHT");
  // The menu is keyboard navigable, including the non-dragging alternative.
  await window.getByRole("button", { name: "Window layout for Simulation setup", exact: true }).click();
  const options = page.getByRole("menu", { name: "Simulation setup window layout", exact: true });
  await options.getByRole("menuitem", { name: "Dock left", exact: true }).press("End");
  await page.keyboard.press("Enter");
  await sameWidth(ui.locator(":scope > .cfx-viewer"), 1440);
  assert.equal(await window.getAttribute("data-edge-docked"), null);
});

test("wall-layer property editor docks with an adaptive preview, preserves its draft and Cancel still leaves the model unchanged", async t => {
  const { page, saved } = await open(t);
  await menu(page, "Tools", "Energy & Insulation");
  const energy = page.locator(".energy-layout-window");
  await energy.getByRole("combobox", { name: "Select wall", exact: true }).selectOption({ index: 0 });
  await eventually(saved, project => project.energyLayout?.enabled === true);
  const before = (await saved()).energyLayout;
  await energy.getByRole("button", { name: /Define wall layers/ }).click();
  const editor = page.getByRole("dialog", { name: "Define wall layers", exact: true });
  await editor.getByRole("button", { name: "Add layer", exact: true }).click();
  const draft = await editor.locator(".appearance-object-heading").textContent();
  await layout(page, "Define wall layers", "Dock right");
  const box = await editor.boundingBox();
  assert.ok(box.width <= 561);
  assert.equal(await editor.locator(".appearance-object-heading").textContent(), draft);
  assert.equal(await editor.locator(".popup-content").evaluate(element => element.scrollWidth > element.clientWidth + 2), false);
  const cancel = editor.getByRole("button", { name: "Cancel", exact: true });
  const footer = await cancel.boundingBox();
  assert.ok(footer.y + footer.height <= box.y + box.height);
  await screenshot(page, "wall-layers");
  await cancel.click();
  assert.deepEqual((await saved()).energyLayout, before);
});
