import assert from "node:assert/strict";
import test, { before, after } from "node:test";
import { readFile } from "node:fs/promises";
import { newProject, parseProject } from "../../lib/projectDocument";
import { defaultBuilding, duplicateFloor, projectFloors } from "../../lib/buildingDocument";
import { newHeatingProject } from "../../lib/heatingDocument";
import { newEnergyProject } from "../../lib/energyDocument";
import { newHeatingRadiator } from "../../lib/heatingDesign";
import { snapRadiatorToWall } from "../../lib/heatingCalculations";
import { elementFromRadiator } from "../../lib/heatingElements";
import { eventually, menu, startBrowserHarness } from "./harness.mjs";

let harness;
before(async () => { harness = await startBrowserHarness(); });
after(async () => { await harness?.close(); });

function fixture(levels = 1) {
  let project = newProject();
  const measure = (value: number) => ({ value, uncertainty_mm: 0, verified: true, source_type: "USER_MEASURED" });
  const vertices = [{ x: 0, y: 0 }, { x: 6400, y: 0 }, { x: 6400, y: 4200 }, { x: 0, y: 4200 }];
  const room = { id: "room-a", source_floorplan_room_id: "outline-a", name: "Studio", version: 1, vertices, wall_height: measure(2400), wall_thickness: measure(50), wall_thickness_overrides_mm: {}, person_mockup: null, openings: [], obstacles: [] };
  project.name = "Current workflow regression"; project.rooms = [room];
  project.rooms[0].obstacles = [elementFromRadiator(snapRadiatorToWall(newHeatingRadiator(room), room, { x: 6400, y: 2100 }))];
  project.floorplan = { walls: [{ id: "wall-a", points: [...vertices, vertices[0]] }], rooms: [{ id: "outline-a", sourceWallId: "wall-a", sourceWallIds: ["wall-a"], colourIndex: 0, name: "Studio", vertices }], roomFinishes: {}, openings: [], measurements: [], annotations: [], dimensionOffsets: {}, hiddenDimensions: [], canvasSize: { width: 1100, height: 700 }, selectedRoomId: "outline-a", wallHeight: 2400, wallThickness: 50, squaredWalls: true, snapEnabled: true, snapSize: 50, viewSettings: { zoom: 1, pan: { x: 0, y: 0 }, showRoomNames: true, showMeasurements: true, showWallThickness: true, showAnnotations: true, showGrid: true } };
  project.heatingLayout = newHeatingProject(); project.energyLayout = newEnergyProject(); project.building = defaultBuilding(project);
  for (let i = 1; i < levels; i++) project = duplicateFloor(project, project.building!.activeFloorId);
  return parseProject(project);
}

// Compare the persisted contract, not transient properties explicitly set to undefined by React.
const wire = value => JSON.parse(JSON.stringify(value));
const floors = project => wire(projectFloors(project));

test("signed-out checkout reaches the real sign-in form and retains each selected plan", async t => {
  const session = await harness.session(); t.after(() => session.close()); const { page } = session;
  for (const plan of ["starter", "pro", "studio"]) {
    await page.goto(harness.origin + "/planner/checkout/?plan=" + plan);
    await page.waitForURL("**/account/?plan=" + plan);
    await page.getByRole("textbox", { name: "Email", exact: true }).waitFor();
    assert.equal(await page.locator('input[type="password"]').count(), 1);
    assert.match(await page.locator("main").innerText(), /Your selection is kept; no payment has been taken/);
  }
  assert.equal(harness.requests.filter(request => request.path.includes("billing/checkout") && request.method === "POST").length, 0);
});

test("current Preferences persist theme/density, follow System and preserve building data", async t => {
  const session = await harness.session(fixture(2)); t.after(() => session.close()); const { page } = session;
  const before = floors(await session.saved());
  await menu(page, "Settings", "Preferences…"); const preferences = page.locator(".settings-dialog");
  await page.emulateMedia({ colorScheme: "dark" }); await preferences.getByRole("button", { name: "System", exact: true }).click();
  await page.waitForFunction(() => document.documentElement.dataset.theme === "dark");
  await page.emulateMedia({ colorScheme: "light" }); await page.waitForFunction(() => document.documentElement.dataset.theme === "light");
  await preferences.getByRole("button", { name: "Dark", exact: true }).click();
  await preferences.getByRole("button", { name: "Compact", exact: true }).click();
  await preferences.getByRole("button", { name: "Help for Preferences", exact: true }).click();
  await page.locator(".window-help-host").waitFor(); await page.keyboard.press("Tab");
  assert.ok(await page.evaluate(() => !!document.activeElement?.closest(".window-help-host")));
  await page.keyboard.press("Escape"); await preferences.getByRole("button", { name: "Done", exact: true }).click();
  await page.reload(); await page.getByRole("combobox", { name: "Selected floor", exact: true }).waitFor();
  await page.waitForFunction(() => document.documentElement.dataset.theme === "dark" && document.documentElement.dataset.density === "compact");
  assert.deepEqual(floors(await session.saved()), before);
  assert.equal(harness.requests.some(request => request.path.endsWith("/settings") && request.method === "PUT"), false);
});

test("Settings View styles match the real export preview", async t => {
  const session = await harness.session(fixture()); t.after(() => session.close()); const { page } = session;
  for (const style of ["Traditional", "Modern", "Creative"]) {
    await page.getByRole("button", { name: "Settings", exact: true }).click();
    const view = page.locator(".software-view-setting");
    if (!await view.evaluate(element => element.open)) await view.locator("summary").click();
    await view.getByRole("button", { name: new RegExp(style + " style$") }).click();
    const svg = page.getByRole("img", { name: "Interactive complete building floorplan", exact: true });
    await eventually(() => page.locator(".full-plan-page").getAttribute("class"), value => value.includes(style.toLowerCase() + "-floorplan"));
    assert.ok(await svg.isVisible());
    await menu(page, "Tools", "Export floorplan…"); const preview = page.locator(".export-svg-preview svg");
    await preview.waitFor(); assert.match(await preview.getAttribute("class"), new RegExp(style.toLowerCase() + "-floorplan"));
    await page.getByRole("dialog", { name: "Preview and save", exact: true }).getByRole("button", { name: "Cancel", exact: true }).click();
  }
});

test("wall-adjacent thin heating symbols can be picked above wall hit areas without altering measured data", async t => {
  const session = await harness.session(fixture()); t.after(() => session.close()); const { page } = session;
  const before = (await session.saved()).rooms;
  await menu(page, "Toolbar", "Hide all");
  const heater = page.getByRole("button", { name: /^Heating element:/ });
  await heater.click(); await eventually(() => heater.getAttribute("class"), value => value.includes("selected"));
  assert.deepEqual(wire((await session.saved()).rooms), wire(before));
});

test("insulation draft Cancel, Apply and Undo keep exact wall geometry while lowering U", async t => {
  const session = await harness.session(fixture()); t.after(() => session.close()); const { page } = session;
  await menu(page, "Tools", "Energy & Insulation"); const panel = page.locator(".energy-layout-window"), editor = page.locator(".wall-layers-popup");
  await panel.getByRole("combobox", { name: "Select wall", exact: true }).selectOption("room-a|wall:3");
  await eventually(() => panel.innerText(), value => /Estimated U 0.300/.test(value));
  await eventually(session.saved, value => value.energyLayout?.enabled === true);
  const before = await session.saved();
  await panel.getByRole("button", { name: "Define wall layers" }).click(); await editor.getByRole("button", { name: "Add layer", exact: true }).click();
  assert.match(await editor.innerText(), /Estimated U: 0.224/); await editor.getByRole("button", { name: "Cancel", exact: true }).click();
  assert.deepEqual((await session.saved()).energyLayout, before.energyLayout);
  await panel.getByRole("button", { name: "Define wall layers" }).click();
  await editor.getByRole("button", { name: "Add layer", exact: true }).click(); await editor.getByRole("button", { name: "Add layer", exact: true }).click();
  assert.match(await editor.innerText(), /Estimated U: 0.178/); await editor.getByRole("button", { name: "Done", exact: true }).click();
  await eventually(session.saved, value => JSON.stringify(value.energyLayout) !== JSON.stringify(before.energyLayout));
  const geometry = value => ({ rooms: value.rooms.map(room => ({ vertices: room.vertices, openings: room.openings, obstacles: room.obstacles })), walls: value.floorplan.walls.map(wall => wall.points) });
  assert.deepEqual(geometry(await session.saved()), geometry(before));
  await panel.getByRole("button", { name: "Undo", exact: true }).click();
  await eventually(() => panel.innerText(), value => /Estimated U 0.300/.test(value));
  assert.deepEqual(geometry(await session.saved()), geometry(before));
  await page.reload(); await menu(page, "Tools", "Heating Layout");
  await page.getByRole("button", { name: "Help for Heating Layout", exact: true }).click();
  assert.match(await page.locator(".window-help-host").innerText(), /not mains cold water/);
});

test("new outline confirmation preserves on Cancel and project Undo restores every floor", async t => {
  const session = await harness.session(fixture(2)); t.after(() => session.close()); const { page } = session;
  const before = floors(await session.saved());
  await page.getByRole("button", { name: "New outline", exact: true }).click();
  await page.getByRole("dialog", { name: "New outline", exact: true }).getByRole("button", { name: "OK", exact: true }).click();
  const warning = page.getByRole("dialog", { name: "Replace current building?", exact: true }); await warning.waitFor();
  await warning.getByRole("button", { name: "Cancel", exact: true }).click();
  assert.deepEqual(floors(await session.saved()), before);
  await page.getByRole("dialog", { name: "New outline", exact: true }).getByRole("button", { name: "OK", exact: true }).click();
  await warning.getByRole("button", { name: "Delete contents & start", exact: true }).click();
  await eventually(session.saved, value => value.building.floors.length === 1);
  await page.getByRole("button", { name: "Manage floors and building", exact: true }).click();
  await page.locator(".building-properties-window").getByRole("button", { name: "Undo project change", exact: true }).click();
  await eventually(session.saved, value => value.building.floors.length === 2);
  assert.deepEqual(floors(await session.saved()), before);
});

test("current native project download reopens in a clean context with floor and service data intact", async t => {
  const session = await harness.session(fixture(2)); t.after(() => session.close()); const { page } = session;
  const before = await session.saved(), download = page.waitForEvent("download");
  await menu(page, "File", /^Save\s*Ctrl/); const saved = await download;
  assert.match(saved.suggestedFilename(), /\.floorplan3d$/);
  const bytes = await readFile(await saved.path());
  const clean = await harness.session(); t.after(() => clean.close()); await clean.page.goto(harness.origin + "/planner/");
  await clean.page.getByRole("combobox", { name: "Workspace", exact: true }).waitFor();
  await clean.page.locator('input[accept^=".floorplan3d"]').setInputFiles({ name: saved.suggestedFilename(), mimeType: "application/zip", buffer: bytes });
  await eventually(clean.saved, value => value?.projectId === before.projectId);
  assert.deepEqual(floors(await clean.saved()), floors(before));
  assert.ok(harness.events.some(event => event.event === "floorplan_downloaded" && event.format === "floorplan3d"));
  for (const event of harness.events) assert.deepEqual(Object.keys(event).sort(), event.event === "floorplan_downloaded" ? ["event", "format"] : ["event"]);
});

test("Library imports and places a local GLB using the current free import form", async t => {
  const session = await harness.session(fixture()); t.after(() => session.close()); const { page } = session;
  const before = (await session.saved()).rooms;
  await menu(page, "Library", "My 3D models…");
  const library = page.getByRole("dialog", { name: "My 3D models", exact: true });
  await library.getByRole("combobox", { name: "Category", exact: true }).selectOption("custom");
  await library.getByRole("textbox", { name: "Subcategory", exact: true }).fill("Regression models");
  await library.getByRole("combobox", { name: "Format", exact: true }).selectOption("glb");
  await library.getByRole("textbox", { name: "Asset name", exact: true }).fill("Local test triangle");
  const mesh = new Float32Array([0, 0, 0, 1, 0, 1, 0, 1, 0]);
  const metadata = { asset: { version: "2.0" }, buffers: [{ byteLength: mesh.byteLength }], bufferViews: [{ buffer: 0, byteOffset: 0, byteLength: mesh.byteLength }], accessors: [{ bufferView: 0, componentType: 5126, count: 3, type: "VEC3", min: [0, 0, 0], max: [1, 1, 1] }], meshes: [{ primitives: [{ attributes: { POSITION: 0 } }] }], nodes: [{ mesh: 0 }], scenes: [{ nodes: [0] }], scene: 0 };
  const raw = JSON.stringify(metadata), json = Buffer.from(raw.padEnd(Math.ceil(raw.length / 4) * 4, " "));
  const glb = Buffer.alloc(28 + json.length + mesh.byteLength);
  glb.writeUInt32LE(0x46546c67, 0); glb.writeUInt32LE(2, 4); glb.writeUInt32LE(glb.length, 8); glb.writeUInt32LE(json.length, 12); glb.writeUInt32LE(0x4e4f534a, 16); json.copy(glb, 20);
  glb.writeUInt32LE(mesh.byteLength, 20 + json.length); glb.writeUInt32LE(0x004e4942, 24 + json.length); Buffer.from(mesh.buffer).copy(glb, 28 + json.length);
  await library.getByLabel(/Choose GLB file/).setInputFiles({ name: "local.glb", mimeType: "model/gltf-binary", buffer: glb });
  await library.getByRole("button", { name: "Place in 3D", exact: true }).click();
  await eventually(session.saved, value => value.assetInstances.length === 1);
  await library.getByRole("button", { name: "Close models", exact: true }).click();
  await page.reload(); await page.getByRole("combobox", { name: "Selected floor", exact: true }).waitFor();
  await menu(page, "Library", "My 3D models…");
  assert.equal(await library.getByRole("button", { name: "Remove placement", exact: true }).count(), 1);
  assert.deepEqual(wire((await session.saved()).rooms), wire(before));
  await library.getByRole("button", { name: "Close models", exact: true }).click();
  await page.getByRole("button", { name: "3D", exact: true }).click(); await page.locator("canvas").first().waitFor();
});
