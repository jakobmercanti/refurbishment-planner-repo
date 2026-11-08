import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { newProject, parseProject } from "../../lib/projectDocument";
import { defaultBuilding } from "../../lib/buildingDocument";
import { newHeatingProject } from "../../lib/heatingDocument";
import { newEnergyProject } from "../../lib/energyDocument";
import { energyElements } from "../../lib/energyCalculations";
import { newHvacProject } from "../../lib/hvacDocument";
import { newCFDScenario, ventSchema } from "../../lib/climoptixDocument";
import { preparationRequestBody } from "../../lib/climoptix";
import { realPreparation } from "../climoptixFixtures";
import { newHeatingRadiator } from "../../lib/heatingDesign";
import { snapRadiatorToWall } from "../../lib/heatingCalculations";
import { elementFromRadiator } from "../../lib/heatingElements";
import { DEFAULT_ELECTRICAL_LAYOUT } from "../../lib/electricalLayout";
import { createFloorPlanViewport, floorPlanToScreen } from "../../components/FloorPlanCanvas";
import { eventually, menu, startBrowserHarness } from "./harness.mjs";

let harness;
before(async () => { harness = await startBrowserHarness(); await mkdir("../.local-logs/services-3d-qa", { recursive: true }); });
after(async () => { await harness?.close(); });
function fixture() {
  const p = newProject(), measure = value => ({ value, uncertainty_mm: 0, verified: true, source_type: "USER_MEASURED" });
  const vertices = [{ x: 0, y: 0 }, { x: 4000, y: 0 }, { x: 4000, y: 3000 }, { x: 0, y: 3000 }];
  const room = { id: "room-a", source_floorplan_room_id: "outline-a", name: "Studio", version: 1, vertices, wall_height: measure(2400), wall_thickness: measure(100), wall_thickness_overrides_mm: {}, person_mockup: null, openings: [], obstacles: [] };
  room.obstacles = [elementFromRadiator(snapRadiatorToWall(newHeatingRadiator(room), room, { x: 4000, y: 1500 }))];
  p.name = "3D services"; p.rooms = [room];
  p.floorplan = { walls: [{ id: "wall-a", points: [...vertices, vertices[0]] }], rooms: [{ id: "outline-a", sourceWallId: "wall-a", sourceWallIds: ["wall-a"], colourIndex: 0, name: "Studio", vertices }], roomFinishes: {}, openings: [], measurements: [], annotations: [], dimensionOffsets: {}, hiddenDimensions: [], canvasSize: { width: 1100, height: 700 }, selectedRoomId: "outline-a", wallHeight: 2400, wallThickness: 100, squaredWalls: true, snapEnabled: true, snapSize: 50, viewSettings: { zoom: 1, pan: { x: 0, y: 0 }, showRoomNames: true, showMeasurements: true, showWallThickness: true, showAnnotations: true, showGrid: true } };
  p.heatingLayout = newHeatingProject(); p.energyLayout = newEnergyProject(); p.hvac = newHvacProject(); p.building = defaultBuilding(p); p.building.roof.enabled = false;
  const scenario = { ...newCFDScenario(p.projectId), seed: { floorId: p.building.activeFloorId, roomId: room.id } };
  const report = realPreparation(JSON.parse(preparationRequestBody(p, scenario, "a".repeat(64))));
  p.hvac.devices = report.patches.filter(v => v.host && v.kind === "wall").map((host, i) => ({ vent: ventSchema.parse({ id: `vent-${i}`, name: `Wall vent ${i + 1}`, role: "supply", widthMm: 650, heightMm: 500, host: { patchId: host.id, u: .5, v: .6 } }), floorId: p.building.activeFloorId, roomId: room.id, enabled: true, outdoorAirFraction: 1, extractKind: "exhaust" }));
  return parseProject(p);
}
async function enter3D(page) { await page.getByRole("button", { name: "3D", exact: true }).click(); await page.locator(".viewer-shell canvas").waitFor(); }
async function walls(page, label) { await page.getByRole("button", { name: "Show", exact: true }).click(); await page.locator("summary", { hasText: "Wall display" }).click(); await page.getByRole("menuitemradio", { name: label, exact: true }).click(); }
async function minimise(panel, title) { await panel.getByRole("button", { name: `Minimise ${title}`, exact: true }).click(); }
async function restore(page, title) { await page.getByRole("button", { name: `Restore ${title}`, exact: true }).click(); }
async function pointOnFloor(layer, p) {
  const viewport = createFloorPlanViewport([{ x: 0, y: 0 }, { x: 4000, y: 3000 }], 680), at = floorPlanToScreen(p, viewport);
  return layer.evaluate((svg, at) => {
    const marker = document.createElementNS("http://www.w3.org/2000/svg", "circle"); marker.setAttribute("cx", String(at.x)); marker.setAttribute("cy", String(at.y)); marker.setAttribute("r", ".1"); svg.append(marker);
    const b = marker.getBoundingClientRect(); marker.remove(); return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
  }, at);
}

test("vents belong to the ventilation workbench in both views, respect walls, and deselect on background click", async t => {
  const p = fixture(), s = await harness.session(p); t.after(() => s.close()); const { page } = s;
  assert.equal(await page.locator("[data-hvac-plan-vent]").count(), 0);
  await enter3D(page);
  const viewProperties = page.getByLabel("3D view properties", { exact: true });
  await viewProperties.getByRole("button", { name: /^All roof:/ }).waitFor();
  assert.equal(await viewProperties.getByRole("button", { name: /Exterior view/i }).count(), 0);
  assert.equal(await page.locator("[data-hvac-scene-vent]").count(), 0);
  await menu(page, "Tools", "Heating & ventilation"); await page.locator(".heating-layout-window").getByRole("tab", { name: "Ventilation", exact: true }).click(); const panel = page.locator(".heating-layout-window"); await panel.waitFor();
  assert.equal(await page.getByRole("button", { name: "3D", exact: true }).getAttribute("aria-pressed"), "true");
  await minimise(panel, "Heating Layout");
  await walls(page, "Invisible walls");
  const labels = page.locator("[data-hvac-scene-vent]"); await eventually(() => labels.count(), n => n === p.hvac.devices.length);
  const visible = labels.filter({ visible: true }).first(); await visible.waitFor({ state: "visible" });
  const box = await visible.boundingBox(); await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await eventually(() => page.locator('[data-hvac-scene-vent][data-selected="true"]').count(), n => n === 1);
  const canvas = await page.locator(".viewer-shell canvas").boundingBox(); await page.mouse.click(canvas.x + 15, canvas.y + 15);
  await eventually(() => page.locator('[data-hvac-scene-vent][data-selected="true"]').count(), n => n === 0);
  await walls(page, "Solid walls"); await eventually(() => labels.filter({ visible: true }).count(), n => n < p.hvac.devices.length);
  await page.screenshot({ path: "../.local-logs/services-3d-qa/vent-occlusion.png" });
  await restore(page, "Heating Layout"); await panel.getByRole("button", { name: "Hide Heating Layout", exact: true }).click();
  assert.equal(await labels.count(), 0);
  await page.getByRole("button", { name: "2D", exact: true }).click(); assert.equal(await page.locator("[data-hvac-plan-vent]").count(), 0);
  await menu(page, "Tools", "Heating & ventilation"); await page.locator(".heating-layout-window").getByRole("tab", { name: "Ventilation", exact: true }).click(); await page.locator("[data-hvac-plan-vent]").first().waitFor();
  await panel.getByRole("tab", { name: "Heating", exact: true }).click(); assert.equal(await page.locator("[data-hvac-plan-vent]").count(), 0);
  assert.deepEqual((await s.saved()).hvac.devices, p.hvac.devices);
});

test("all application menu siblings have a constant white gap in comfortable and compact modes", async t => {
  const s = await harness.session(fixture()); t.after(() => s.close()); const { page } = s;
  for (const density of ["comfortable", "compact"]) {
    await page.evaluate(d => document.documentElement.dataset.density = d, density);
    for (const name of ["File", "Tools", "Library", "Toolbar", "Settings"]) {
      await page.getByRole("button", { name, exact: true }).click();
      const gaps = await page.locator(".software-dropdown").evaluate(e => [...e.children].filter(n => n.getBoundingClientRect().height > 0).map(n => n.getBoundingClientRect()).slice(1).map((b, i) => b.y - [...e.children].filter(n => n.getBoundingClientRect().height > 0)[i].getBoundingClientRect().bottom));
      assert.ok(gaps.every(n => Math.abs(n - 4) < 1), `${density}/${name}: ${gaps}`);
      await page.keyboard.press("Escape");
    }
  }
});

test("a 3D vent drag snaps onto a different measured wall, with undo", async t => {
  const p=fixture(),s=await harness.session(p);t.after(()=>s.close());const {page}=s;
  await enter3D(page);await menu(page,"Tools","Heating & ventilation");const panel=page.locator(".heating-layout-window");await panel.getByRole("tab",{name:"Ventilation",exact:true}).click();await minimise(panel,"Heating Layout");await walls(page,"Transparent walls");
  const labels=page.locator("[data-hvac-scene-vent]").filter({visible:true});
  await eventually(()=>labels.count(),n=>n>=2);
  const first=labels.nth(0),second=labels.nth(1),id=await first.getAttribute("data-hvac-scene-vent"),targetId=await second.getAttribute("data-hvac-scene-vent");
  const from=await first.boundingBox(),to=await second.boundingBox();
  await page.mouse.move(from.x+from.width/2,from.y+from.height/2);await page.mouse.down();await page.mouse.move(to.x+to.width/2,to.y+to.height/2,{steps:16});await page.mouse.up();
  const target=p.hvac.devices.find(d=>d.vent.id===targetId).vent.host.patchId;
  await eventually(s.saved,p=>p.hvac.devices.find(d=>d.vent.id===id).vent.host.patchId===target);
  await restore(page,"Heating Layout");await panel.getByRole("button",{name:"Undo HVAC",exact:true}).click();
  await eventually(s.saved,p=>p.hvac.devices.find(d=>d.vent.id===id).vent.host.patchId!==target);
});

test("heating text stays screen-facing in perspective and section help leaves the menu closed", async t=>{
 const s=await harness.session(fixture());t.after(()=>s.close());const {page}=s;
 await enter3D(page);await menu(page,"Tools","Heating & ventilation");const panel=page.locator(".heating-layout-window");
 await panel.getByRole("tab",{name:"Results",exact:true}).click();
 const section=panel.locator("details").filter({has:page.locator("summary",{hasText:/^Heating results/})}).first();
 const help=section.locator(":scope > summary > button");await help.waitFor();const open=await section.getAttribute("open");await help.click();
 await page.getByText("Heat required and heat available",{exact:true}).waitFor();assert.equal(await section.getAttribute("open"),open);
 await page.getByRole("button",{name:"Hide Help — Heating results",exact:true}).click();await minimise(panel,"Heating Layout");
 const card=page.getByLabel("Service labels",{exact:true}).locator(".heating-room-indicator");await card.waitFor();const parallel=await card.boundingBox();
 await page.getByRole("button",{name:"Perspective",exact:true}).click();await page.waitForTimeout(350);
 const perspective=await card.boundingBox();assert.ok(Math.abs(parallel.width-perspective.width)<1);assert.ok(Math.abs(parallel.height-perspective.height)<1);
 await page.screenshot({path:"../.local-logs/services-3d-qa/screen-facing-labels.png"});
});

test("Heating keeps its live editor in 3D, creates UFH, draws pipes and retains changes when returning to 2D", async t => {
  const p = fixture(), s = await harness.session(p); t.after(() => s.close()); const { page } = s;
  await enter3D(page); await menu(page, "Tools", "Heating & ventilation"); const panel = page.locator(".heating-layout-window");
  await panel.getByRole("tab", { name: "Underfloor", exact: true }).click();
  await panel.getByRole("button", { name: "Create room UFH", exact: true }).click();
  await eventually(s.saved, p => p.heatingLayout.ufhCircuits.length > 0);
  const layer = page.getByLabel("Interactive 3D service layer", { exact: true }); await layer.waitFor();
  await minimise(panel, "Heating Layout");
  const manifold = layer.getByRole("button", { name: /^Heating manifold:/ }); await manifold.waitFor();
  const before = (await s.saved()).heatingLayout.manifolds[0].positionMm, box = await manifold.boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2); await page.mouse.down(); await page.mouse.move(box.x + box.width / 2 - 35, box.y + box.height / 2 + 20, { steps: 8 }); await page.mouse.up();
  await eventually(s.saved, p => JSON.stringify(p.heatingLayout.manifolds[0].positionMm) !== JSON.stringify(before));
  await page.screenshot({ path: "../.local-logs/services-3d-qa/heating.png" });
  await restore(page, "Heating Layout"); const saved = await s.saved();
  await page.getByRole("button", { name: "2D", exact: true }).click();
  assert.equal(await panel.getByRole("tab", { name: "Underfloor", exact: true }).getAttribute("aria-selected"), "true");
  assert.deepEqual((await s.saved()).heatingLayout, saved.heatingLayout);
  await page.getByRole("button", { name: "3D", exact: true }).click(); assert.ok(await panel.isVisible());
});

test("3D insulation selects real walls, uses the same U and W values, and applies edits with undo", async t => {
  const source = fixture(), s = await harness.session(source); t.after(() => s.close()); const { page } = s;
  await enter3D(page); await menu(page, "Tools", "Energy & Insulation"); const panel = page.locator(".energy-layout-window"); await panel.waitFor();
  await minimise(panel, "Energy & Insulation"); await walls(page, "Invisible walls");
  const label = page.getByLabel("Service labels",{exact:true}).locator("text[data-energy-label]").filter({ visible: true }).first(); await label.waitFor();
  const labelText = await label.textContent();
  assert.match(labelText, /U [\d.]+ · \d+ W/);
  assert.ok(energyElements(source.rooms, source.heatingLayout, source.energyLayout).some(e => labelText.includes(`${Math.round(e.heatLossW)} W`) && labelText.includes(e.uValue.toFixed(2))), "3D labels must use the same authoritative values as the plan");
  await label.click(); await restore(page, "Energy & Insulation");
  await panel.getByRole("button", { name: "Define wall layers", exact: true }).click();
  const editor = page.locator(".wall-layers-popup"), before = await eventually(s.saved, p => p.energyLayout.enabled);
  await editor.getByRole("button", { name: "Add layer", exact: true }).click(); await editor.getByRole("button", { name: "Cancel", exact: true }).click();
  assert.deepEqual((await s.saved()).energyLayout, before.energyLayout);
  assert.ok(await panel.getByRole("button", { name: "Define wall layers", exact: true }).isVisible());
  await panel.getByRole("button", { name: "Define wall layers", exact: true }).click(); await editor.getByRole("button", { name: "Add layer", exact: true }).click(); await editor.getByRole("button", { name: "Done", exact: true }).click();
  await eventually(s.saved, p => JSON.stringify(p.energyLayout) !== JSON.stringify(before.energyLayout));
  await panel.getByRole("button", { name: "Undo", exact: true }).click(); await eventually(s.saved, p => JSON.stringify(p.energyLayout) === JSON.stringify(before.energyLayout));
  await page.screenshot({ path: "../.local-logs/services-3d-qa/insulation.png" });
  await page.getByRole("button", { name: "2D", exact: true }).click(); assert.ok(await panel.isVisible());
});

test("3D heating pipe drawing and corner editing use mm ray intersections and keyboard undo", async t => {
  const s = await harness.session(fixture()); t.after(() => s.close()); const { page } = s;
  await enter3D(page); await page.getByRole("button", { name: "Perspective", exact: true }).click();
  await menu(page, "Tools", "Heating & ventilation"); const panel = page.locator(".heating-layout-window");
  await panel.getByRole("tab", { name: "System", exact: true }).click(); await panel.locator("summary").filter({ hasText: "Heating pipes & connections" }).click();
  await panel.getByRole("button", { name: "Draw heating pipe", exact: true }).click(); await minimise(panel, "Heating Layout");
  const layer = page.getByLabel("Interactive 3D service layer", { exact: true }); await layer.waitFor();
  const points = [{ x: 800, y: 2200 }, { x: 1800, y: 2200 }, { x: 1800, y: 2600 }];
  for (const point of points) { const at = await pointOnFloor(layer, point); await page.mouse.click(at.x, at.y); }
  await restore(page, "Heating Layout"); await panel.getByRole("button", { name: "Finish pipe", exact: true }).click();
  const saved = await eventually(s.saved, p => p.heatingLayout.pipes.length === 1), path = saved.heatingLayout.pipes[0].pathMm;
  assert.equal(path.length, points.length); path.forEach((p, i) => assert.ok(Math.hypot(p.x - points[i].x, p.y - points[i].y) < 1, JSON.stringify(path)));
  await minimise(panel, "Heating Layout"); const corner = layer.getByRole("button", { name: "Pipe 1 corner 2", exact: true }); await corner.waitFor();
  const b = await corner.boundingBox(); await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2); await page.mouse.down(); await page.mouse.move(b.x + b.width / 2 + 30, b.y + b.height / 2, { steps: 8 }); await page.mouse.up();
  await eventually(s.saved, p => JSON.stringify(p.heatingLayout.pipes[0].pathMm) !== JSON.stringify(path));
  await corner.focus(); await page.keyboard.press("Control+z"); await eventually(s.saved, p => JSON.stringify(p.heatingLayout.pipes[0].pathMm) === JSON.stringify(path));
});

test("3D electrical controls create a closed ring, test individual sockets, and retain BOM and file access", async t => {
  const p = fixture(), measure = value => ({ value, uncertainty_mm: 0, verified: true, source_type: "USER_MEASURED" });
  const objects = ["board", "a", "b"].map((id, i) => ({ id, name: id === "board" ? "Consumer unit" : `Socket ${id}`, representation_key: id === "board" ? "electrical-board-compact" : "electrical-socket-double", fixture_kind: "FURNITURE", base_z_mm: 400, verified: true, center: { x: 500 + i * 1200, y: 100 }, rotation_deg: 0, dimensions: { width: measure(100), depth: measure(50), height: measure(100) } }));
  p.rooms[0].obstacles.push(...objects);
  p.electricalLayout = { ...DEFAULT_ELECTRICAL_LAYOUT, circuits: [{ id: "sockets", name: "Sockets", color: "#287fb8", socketTopology: "RING", consumerUnitId: "board", socketIds: ["a", "b"] }] };
  const s = await harness.session(p); t.after(() => s.close()); const { page } = s;
  await enter3D(page); await menu(page, "Tools", "Full Electrical Layout module…"); const panel = page.locator(".electrical-layout-window:not(.heating-layout-window)");
  assert.equal(await page.getByRole("button", { name: "3D", exact: true }).getAttribute("aria-pressed"), "true");
  await page.getByRole("button", { name: "2D", exact: true }).click();
  assert.equal(await page.locator(".floorplan-add-elements-toolbar").filter({ visible: true }).count(), 0, "Electrical opens the fitting catalogue only when requested");
  await page.getByRole("button", { name: "3D", exact: true }).click();
  await panel.locator("summary").filter({ hasText: "Circuits (1)" }).click(); await panel.getByRole("button", { name: /^Edit circuit / }).click(); await page.getByRole("dialog", { name: /^Edit circuit/ }).getByRole("button", { name: "Save and create socket routes", exact: true }).click(); await eventually(s.saved, p => p.electricalLayout.connections.length === 3);
  await panel.getByRole("button", { name: "Check layout", exact: true }).click(); const tester = page.locator(".electrical-lighting-test-window"); await tester.waitFor();
  const socket = page.getByLabel("Interactive 3D service layer", { exact: true }).getByRole("button", { name: "Electrical fitting: Socket b, connected", exact: true });
  await socket.focus(); await socket.press("Enter");
  assert.equal(await tester.getByRole("button", { name: /^Socket b/ }).getAttribute("aria-pressed"), "true");
  assert.equal(await tester.locator(".socket-test-list button").filter({ hasText: "Closed ring connected" }).count(), 2);
  await tester.getByRole("button", { name: "Hide Electrical layout test", exact: true }).click();
  await panel.getByRole("button", { name: "Add electrical fitting…", exact: true }).click();
  const catalogue = page.locator(".floorplan-add-elements-toolbar").filter({ visible: true }); await catalogue.waitFor();
  assert.equal(await page.locator(".viewer-add-elements-toolbar").isVisible(), false, "The service catalogue replaces the duplicate general catalogue");
  await catalogue.getByRole("button", { name: "Hide Add to plan", exact: true }).click();
  const downloaded = page.waitForEvent("download"); await panel.getByRole("button", { name: "Save layout", exact: true }).click();
  assert.match((await downloaded).suggestedFilename(), /\.electricallayout$/);
  await panel.getByRole("button", { name: "BOM / Export", exact: true }).click(); await page.locator(".electrical-schedule-window").waitFor();
  await page.screenshot({ path: "../.local-logs/services-3d-qa/electrical.png" });
  await page.getByRole("button", { name: "2D", exact: true }).click(); assert.ok(await panel.isVisible()); assert.ok(await page.locator(".electrical-schedule-window").isVisible());
});
