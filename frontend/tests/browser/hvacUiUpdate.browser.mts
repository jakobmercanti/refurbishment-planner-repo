import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { newProject, parseProject } from "../../lib/projectDocument";
import { defaultBuilding } from "../../lib/buildingDocument";
import { newHeatingProject } from "../../lib/heatingDocument";
import { newEnergyProject } from "../../lib/energyDocument";
import { createRoomUFH, newHeatingRadiator } from "../../lib/heatingDesign";
import { snapRadiatorToWall } from "../../lib/heatingCalculations";
import { elementFromRadiator } from "../../lib/heatingElements";
import { hvacProject } from "../hvacFixtures";
import { eventually, menu, startBrowserHarness } from "./harness.mjs";
let harness;
before(async () => { harness = await startBrowserHarness({ climoptixEnabled: true }); await mkdir("../.local-logs/hvac-ui-qa", { recursive: true }); });
after(async () => { await harness?.close(); });
function fixture() {
  const p = newProject();
  const measure = (value: number) => ({ value, uncertainty_mm: 0, verified: true, source_type: "USER_MEASURED" });
  const vertices = [{x:0,y:0},{x:3050,y:0},{x:3050,y:2079},{x:0,y:2079}];
  const room = { id:"room-a", source_floorplan_room_id:"outline-a", name:"Room 1", version:1, vertices, wall_height:measure(2400),wall_thickness:measure(100),wall_thickness_overrides_mm:{},person_mockup:null,openings:[],obstacles:[] };
  room.obstacles = [elementFromRadiator(snapRadiatorToWall(newHeatingRadiator(room),room,{x:3050,y:1000}))];
  p.name="Heating audit"; p.rooms=[room];
  p.floorplan={walls:[{id:"wall-a",points:[...vertices,vertices[0]]}],rooms:[{id:"outline-a",sourceWallId:"wall-a",sourceWallIds:["wall-a"],colourIndex:0,name:"Room 1",vertices}],roomFinishes:{},openings:[],measurements:[],annotations:[],dimensionOffsets:{},hiddenDimensions:[],canvasSize:{width:1100,height:700},selectedRoomId:"outline-a",wallHeight:2400,wallThickness:100,squaredWalls:true,snapEnabled:true,snapSize:50,viewSettings:{zoom:1,pan:{x:0,y:0},showRoomNames:true,showMeasurements:true,showWallThickness:true,showAnnotations:true,showGrid:true}};
  p.heatingLayout=newHeatingProject();p.energyLayout=newEnergyProject();p.building=defaultBuilding(p);
  return parseProject(p);
}

async function open(s, tab = "Heating") {
  await menu(s.page, "Tools", "Heating & ventilation");
  const panel = s.page.locator(".heating-layout-window");
  await panel.getByRole("tab", { name: tab, exact: true }).click(); return panel;
}
async function number(panel, name, value) { const field = panel.getByRole("spinbutton", { name, exact: true }); await field.fill(String(value)); await field.press("Enter"); }
async function expand(panel, title) { const summary = panel.locator("summary").filter({ hasText: title }).first(); if (!(await summary.evaluate(e => e.closest("details").open))) await summary.click(); }

test("small room UFH applies valid parallel runs, rejects impossible bends, and keeps four equal actions", async t => {
  const p = fixture(); p.heatingLayout = createRoomUFH(p.rooms[0], p.heatingLayout!).heating;
  const s = await harness.session(p); t.after(() => s.close()); const { page } = s, panel = await open(s);
  await panel.getByRole("tab", { name: "Underfloor", exact: true }).click();
  const setup = panel.locator("details").filter({ has: page.locator("summary", { hasText: /^UFH setup & drawing/ }) }).first();
  const create = setup.getByRole("button", { name: "Create room UFH", exact: true });
  assert.ok(Math.abs((await create.boundingBox()).height - (await panel.getByRole("tab", { name: "Heating", exact: true }).boundingBox()).height) < 2);
  await setup.locator(":scope > summary").click(); assert.equal(await create.isVisible(), false); await setup.locator(":scope > summary").click();
  const initial = await s.saved(), zone = initial.heatingLayout.ufhZones[0], oldPath = JSON.stringify(initial.heatingLayout.ufhCircuits[0].pathMm);
  await number(panel, "Parallel tube runs", 12); await panel.getByRole("button", { name: "Apply spacing and circuit count", exact: true }).click();
  const applied = await eventually(s.saved, p => p.heatingLayout.ufhZones[0].runCountTarget === 12);
  assert.notEqual(JSON.stringify(applied.heatingLayout.ufhCircuits[0].pathMm), oldPath);
  assert.ok(applied.heatingLayout.ufhZones[0].spacingMm >= 2 * zone.minBendRadiusMm);
  const actions = panel.getByRole("button", { name: "Apply spacing and circuit count", exact: true }).locator("..").locator(":scope > button");
  assert.equal(await actions.count(), 4); const boxes = await actions.evaluateAll(els => els.map(e => ({ w: e.getBoundingClientRect().width, y: e.getBoundingClientRect().y })));
  assert.ok(Math.max(...boxes.map(b => b.w)) - Math.min(...boxes.map(b => b.w)) < 2); assert.equal(new Set(boxes.map(b => Math.round(b.y))).size, 2);
  await number(panel, "Parallel tube runs", 30); await panel.getByRole("button", { name: "Apply spacing and circuit count", exact: true }).click();
  await panel.getByRole("alert").filter({ hasText: "minimum bend radius" }).first().waitFor();
  assert.equal((await s.saved()).heatingLayout.ufhZones[0].runCountTarget, 12);
  assert.equal(await panel.getByText(/Covered area estimate/).count(), 0);
  await page.screenshot({ path: "../.local-logs/hvac-ui-qa/ufh.png" });
});

test("room geometry saves first, reopening Heating regenerates UFH, and Undo restores both", async t => {
  const project = fixture();
  project.heatingLayout = createRoomUFH(project.rooms[0], project.heatingLayout!).heating;
  const session = await harness.session(project);
  t.after(() => session.close());
  const { page } = session;
  const before = await session.saved();
  const wall = page.locator(".wall-interaction-line").first();
  const center = await wall.evaluate((line: SVGLineElement) => {
    const matrix = line.getScreenCTM()!;
    const x = (line.x1.baseVal.value + line.x2.baseVal.value) / 2;
    const y = (line.y1.baseVal.value + line.y2.baseVal.value) / 2;
    const point = new DOMPoint(x, y).matrixTransform(matrix);
    return { x: point.x, y: point.y };
  });
  await page.mouse.click(center.x, center.y, { button: "right" });
  const apply = page.getByRole("menuitem", { name: "Apply wall length", exact: true });
  const field = apply.locator("..").getByRole("spinbutton").first();
  await field.fill("3800");
  await apply.click();
  const resized = await eventually(session.saved, p => p.rooms[0].vertices.some(point => point.x === 3800));
  assert.deepEqual(resized.heatingLayout.ufhCircuits, before.heatingLayout.ufhCircuits);
  assert.ok(resized.heatingLayout.pendingRoomResize[before.rooms[0].id]);
  await menu(page, "Tools", "Heating & ventilation");
  const applied = await eventually(session.saved, p => !p.heatingLayout.pendingRoomResize);
  assert.notDeepEqual(applied.heatingLayout.ufhCircuits, before.heatingLayout.ufhCircuits);
  assert.equal(applied.heatingLayout.ufhZones[0].spacingMm, before.heatingLayout.ufhZones[0].spacingMm);
  await page.locator(".heating-layout-window .floating-toolbar-close").click();
  await page.keyboard.press("Control+z");
  const undone = await eventually(session.saved, p => JSON.stringify(p.rooms[0].vertices) === JSON.stringify(before.rooms[0].vertices));
  assert.deepEqual(undone.heatingLayout.ufhCircuits, before.heatingLayout.ufhCircuits);
  await page.mouse.move(center.x, center.y);
  await page.mouse.down();
  await page.mouse.move(center.x, center.y - 42, { steps: 15 });
  await page.waitForTimeout(1100); // Longer than the ordinary autosave delay.
  assert.deepEqual((await session.saved()).rooms[0].vertices, before.rooms[0].vertices);
  assert.deepEqual((await session.saved()).heatingLayout.ufhCircuits, before.heatingLayout.ufhCircuits);
  await page.mouse.up();
  const dragged = await eventually(session.saved, p => JSON.stringify(p.rooms[0].vertices) !== JSON.stringify(before.rooms[0].vertices));
  assert.deepEqual(dragged.heatingLayout.ufhCircuits, before.heatingLayout.ufhCircuits);
  await menu(page, "Tools", "Heating & ventilation");
  const refreshed = await eventually(session.saved, p => !p.heatingLayout.pendingRoomResize);
  assert.notDeepEqual(refreshed.heatingLayout.ufhCircuits, before.heatingLayout.ufhCircuits);
});

test("help consolidates fields, layers select together, results fill the panel, and manifold labels are opaque", async t => {
  const p = fixture(); p.heatingLayout = createRoomUFH(p.rooms[0], p.heatingLayout!).heating; p.heatingLayout.display.manifolds = true;
  const s = await harness.session(p); t.after(() => s.close()); const { page } = s, panel = await open(s);
  const setup = panel.locator("details").filter({ has: page.locator("summary", { hasText: /^Room setup/ }) }).first();
  assert.equal(await setup.getByRole("button", { name: /^Help for/ }).count(), 1);
  await panel.getByRole("button", { name: "Help for Heating Layout", exact: true }).click();
  await page.locator(".window-help-host").getByRole("heading", { name: "Room target temperature °C", exact: true }).waitFor(); await page.keyboard.press("Escape");
  await panel.getByRole("tab", { name: "System", exact: true }).click(); await expand(panel, "Canvas layers");
  const layerColumns = () => panel.getByRole("checkbox", { name: "demand", exact: true }).evaluate(e => getComputedStyle(e.parentElement.parentElement).gridTemplateColumns.split(" ").length);
  assert.equal(await layerColumns(), 3);
  await page.setViewportSize({ width: 540, height: 900 }); await eventually(layerColumns, n => n === 2);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await panel.getByRole("button", { name: "Deselect all", exact: true }).click(); await eventually(s.saved, p => Object.values(p.heatingLayout.display).every(v => !v));
  await panel.getByRole("button", { name: "Select all", exact: true }).click(); await eventually(s.saved, p => Object.values(p.heatingLayout.display).every(Boolean));
  assert.equal(await page.locator("[data-manifold-label]").getAttribute("fill"), "#fff");
  await panel.getByRole("tab", { name: "Results", exact: true }).click(); await panel.getByRole("combobox", { name: "Show heating results for room", exact: true }).selectOption("room-a");
  const roomButton = panel.getByRole("button").filter({ hasText: /290 W required|W required/ }).first();
  const widths = await roomButton.evaluate(e => [e.getBoundingClientRect().width, e.parentElement.getBoundingClientRect().width]); assert.ok(widths[0] > widths[1] * .93);
  await panel.locator(".window-header-actions").getByRole("button", { name: "Help for Heating Layout", exact: true }).click();
  await page.locator(".window-help-host").getByRole("heading", { name: "Vent role, shape and host", exact: true }).waitFor();
});

test("vent edits, main 2D drag, undo and native Save As share canonical values", async t => {
  const p = hvacProject(); p.hvac!.devices = [];
  const s = await harness.session(p); t.after(() => s.close()); const { page } = s, panel = await open(s, "Ventilation");
  const add = panel.getByRole("button", { name: "Add supply inlet", exact: true }); await eventually(() => add.isEnabled(), Boolean); await add.click();
  const first = await eventually(s.saved, p => p.hvac.devices.length === 1), device = first.hvac.devices[0]; assert.notEqual(device.vent.host.patchId, "unassigned");
  assert.match(device.vent.host.patchId, /wall/i);
  const badge = page.locator(".ventilation-room-indicator").first();
  await badge.waitFor();
  assert.match(await badge.textContent(), /Supply air changes:.*Predicted temperature:/);
  assert.equal(await panel.getByRole("table", { name: "Vent positions", exact: true }).count(), 0);
  assert.equal(await panel.getByRole("combobox", { name: "Vent host face", exact: true }).count(), 0);
  await panel.getByRole("button", { name: `Edit ${device.vent.name}`, exact: true }).click(); const editor = page.locator(".hvac-vent-editor"); await editor.waitFor();
  await editor.getByRole("checkbox", { name: "Advanced mode" }).check();
  await number(editor, "Host U (0–1)", .35);
  await eventually(s.saved, p => p.hvac.devices[0].vent.host.u === .35);
  await number(editor, "Vent width (mm)", 260); await eventually(s.saved, p => p.hvac.devices[0].vent.widthMm === 260); await editor.getByRole("button", { name: "Done", exact: true }).click();
  const marker = page.getByRole("button", { name: `Select shared vent ${device.vent.name}`, exact: true }); await marker.waitFor();
  await panel.getByRole("button", { name: "Minimise Heating Layout", exact: true }).click();
  const b = await marker.boundingBox(), before = (await s.saved()).hvac.devices[0].vent.host;
  const room = await page.locator(".full-room-highlight.selected polygon").boundingBox();
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2); await page.mouse.down(); await page.mouse.move(room.x + room.width / 2, room.y + room.height / 2, { steps: 8 }); await page.mouse.up();
  const moved = await eventually(s.saved, p => JSON.stringify(p.hvac.devices[0].vent.host) !== JSON.stringify(before)); assert.equal(moved.hvac.devices[0].vent.widthMm, 260);
  await page.getByRole("button", { name: "Restore Heating Layout", exact: true }).click(); const reopened = panel; await reopened.getByRole("button", { name: "Undo HVAC", exact: true }).click(); await eventually(s.saved, p => JSON.stringify(p.hvac.devices[0].vent.host) === JSON.stringify(before));
  await marker.focus(); await marker.press("Enter"); await editor.waitFor(); await editor.getByRole("button", { name: "Done", exact: true }).click();
  await page.evaluate(() => { window.showSaveFilePicker = async options => { window.__saveName = options.suggestedName; return { createWritable: async () => ({ write: async blob => { window.__savedCalculation = JSON.parse(await blob.text()); }, close: async () => {} }) }; }; });
  await reopened.getByRole("button", { name: "Export calculations", exact: true }).click(); await eventually(() => page.evaluate(() => window.__saveName), n => n === "hvac-conventional.json"); await eventually(() => page.evaluate(() => window.__savedCalculation?.result?.volumeM3 > 0), Boolean);
  assert.equal(await reopened.getByRole("button", { name: "Evaluate in CFD", exact: true }).count(), 1);
  const font = await reopened.getByRole("table", { name: "Ventilation calculations", exact: true }).locator("tbody td").first().evaluate(e => ({ weight: getComputedStyle(e).fontWeight, border: getComputedStyle(e).borderTopWidth })); assert.equal(font.weight, "400"); assert.equal(font.border, "1px");
  await page.evaluate(() => { window.showSaveFilePicker = async () => { throw new DOMException("Cancelled", "AbortError"); }; });
  await reopened.getByRole("button", { name: "Export calculations", exact: true }).click(); assert.equal(await reopened.getByRole("alert").count(), 0);
  await page.screenshot({ path: "../.local-logs/hvac-ui-qa/ventilation.png" });
});

test("main 3D floorplan shows and drags the shared vent and opens its editor", async t => {
  const s = await harness.session(hvacProject()); t.after(() => s.close()); const { page } = s;
  const panel = await open(s, "Ventilation");
  const add = panel.getByRole("button", { name: "Add supply inlet", exact: true }); await eventually(() => add.isEnabled(), Boolean); await add.click();
  const saved = await eventually(s.saved, p => p.hvac.devices.length === 1), device = saved.hvac.devices[0];
  await panel.getByRole("button", { name: `Edit ${device.vent.name}`, exact: true }).click();
  const editor = page.locator(".hvac-vent-editor");
  await editor.getByRole("checkbox", { name: "Advanced mode" }).check();
  const hosts = editor.getByRole("combobox", { name: "Vent host face", exact: true });
  await hosts.locator("option").filter({ hasText: /^Floor/ }).first().waitFor({ state: "attached" });
  const floorHost = await hosts.locator("option").filter({ hasText: /^Floor/ }).first().getAttribute("value"); await hosts.selectOption(floorHost);
  await number(editor, "Vent width (mm)", 600); await number(editor, "Vent height (mm)", 600);
  await editor.getByRole("button", { name: "Done", exact: true }).click();
  await panel.locator(".floating-toolbar-close").click(); await page.getByRole("button", { name: "3D", exact: true }).click();
  await menu(page, "Tools", "Heating & ventilation"); await page.locator(".heating-layout-window").getByRole("tab", { name: "Ventilation", exact: true }).click(); await page.getByRole("button", { name: "Minimise Heating Layout", exact: true }).click();
  await page.getByRole("button", { name: "Top", exact: true }).click();
  const label = page.locator(`[data-hvac-scene-vent="${device.vent.id}"]`); await label.waitFor({ state: "visible" });
  const canvas = await page.locator(".viewer-shell canvas").boundingBox();
  await page.mouse.click(canvas.x + 15, canvas.y + 15);
  await eventually(() => label.getAttribute("data-selected"), value => value === "false");
  await page.screenshot({ path: "../.local-logs/hvac-ui-qa/3d-before.png" });
  const box = await label.boundingBox(), before = (await s.saved()).hvac.devices[0].vent.host;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2); await page.mouse.down();
  await eventually(() => label.getAttribute("data-selected"), value => value === "true", "The vent must receive pointer down");
  await page.mouse.move(box.x + box.width / 2 + 35, box.y + box.height / 2 + 15, { steps: 10 }); await page.mouse.up();
  await eventually(async () => ({ host: (await s.saved()).hvac.devices[0].vent.host, error: await label.locator("..").getByRole("alert").allTextContents() }), value => JSON.stringify(value.host) !== JSON.stringify(before), "3D dragging must commit shared host coordinates");
  const after = await label.boundingBox(); await page.mouse.dblclick(after.x + after.width / 2, after.y + after.height / 2); await page.locator(".hvac-vent-editor").waitFor();
  await page.screenshot({ path: "../.local-logs/hvac-ui-qa/3d-vent.png" });
});

test("Preferences consolidates field guidance into its main help window", async t => {
  const s = await harness.session(fixture()); t.after(() => s.close()); const { page } = s;
  await menu(page, "Settings", "Preferences…"); const preferences = page.getByRole("dialog", { name: "Preferences", exact: true });
  assert.equal(await preferences.getByRole("button", { name: /^Help for/ }).count(), 1);
  await preferences.getByRole("button", { name: "Help for Preferences", exact: true }).click();
  const help = page.locator(".window-help-host"); await help.getByRole("heading", { name: "Mouse buttons", exact: true }).waitFor();
  await page.keyboard.press("Escape"); assert.ok(await preferences.isVisible());
});
