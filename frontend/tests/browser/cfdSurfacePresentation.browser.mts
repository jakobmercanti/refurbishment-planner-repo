import assert from "node:assert/strict";
import test, { before, after } from "node:test";
import { cfdProject, realPreparation } from "../climoptixFixtures";
import { ventSchema } from "../../lib/climoptixDocument";
import { refinementColour } from "../../lib/climoptixWorkflow";
import { newHeatingProject } from "../../lib/heatingDocument";
import { newHeatingRadiator, newUFHZone } from "../../lib/heatingDesign";
import { elementFromRadiator } from "../../lib/heatingElements";
import { snapRadiatorToWall } from "../../lib/heatingCalculations";
import type { CFDBoundary } from "../../lib/climoptixDocument";
import { cfdWindow, eventually, startBrowserHarness } from "./harness.mjs";

let harness;
before(async () => { harness = await startBrowserHarness({ climoptixEnabled: true }); });
after(async () => { await harness?.close(); });
test("boundary conditions can be added through an explicit room and real surface picker", async t => {
  const project = cfdProject(); project.cfdScenarios[0].seed = null;
  const {page,ui,saved} = await open(t,project);
  await cfdWindow(ui,'Boundaries');
  const picker = ui.getByRole('combobox',{name:'Boundary seed room',exact:true});
  await picker.selectOption({index:1});
  await eventually(saved,p=>!!p.cfdScenarios[0].seed);
  await eventually(()=>ui.getAttribute('data-preparation-state'),s=>s==='checked');
  await ui.getByRole('button',{name:'Actions for boundary group Default surfaces',exact:true}).click();
  const actions = ui.getByRole('dialog', {name:'Actions — Default surfaces', exact:true});
  await actions.getByRole('button',{name:'Add boundary conditions to Default surfaces',exact:true}).click();
  const dialog = ui.locator('.floating-toolbar').filter({has:page.getByText('Assign boundary surfaces',{exact:true})});
  await dialog.getByRole('combobox',{name:'Boundary assignment surface type',exact:true}).selectOption('wall');
  const available = dialog.getByRole('checkbox',{name:/Assign surface/});
  assert.ok(await available.count()>0);
  await available.first().check();
  await dialog.getByRole('button',{name:'Apply and edit conditions',exact:true}).click();
  await ui.getByRole('region',{name:'Boundary group conditions',exact:true}).waitFor();
  await eventually(saved,p=>p.cfdScenarios[0].boundaries.collections.some(g=>g.id!=='all-surfaces'&&g.patchIds.length===1&&g.boundary));
});
const button = (scope, name) => scope.getByRole("button", { name, exact: true });

test("independent heating import uses measured radiator and UFH sources without copying geometry or claiming a thermal solve",async t=>{
  const project=cfdProject(false),room=project.rooms[0];
  const heater=elementFromRadiator(snapRadiatorToWall(newHeatingRadiator(room),room,{x:2000,y:2000}));
  heater.name="Source radiator";room.obstacles.push(heater);
  project.heatingLayout={...newHeatingProject(),enabled:true,ufhZones:[newUFHZone(room,null)]};
  const {page,ui,saved}=await open(t,project);
  const before=structuredClone(await saved());
  await cfdWindow(ui,'Boundaries');
  await button(ui,'Import insulation & heating conditions').click();
  const dialog=page.getByRole('dialog',{name:'Import insulation & heating conditions',exact:true});
  await dialog.waitFor();
  assert.equal(await dialog.evaluate(node=>node.parentElement?.classList.contains('cfx-workspace')),true);
  assert.match(await dialog.innerText(),/current native worker cannot solve temperature or buoyancy/);
  const radiator=dialog.getByRole('checkbox',{name:/Source radiator/}),floor=dialog.getByRole('checkbox',{name:/UFH floor/});
  await radiator.check();await floor.check();
  const temperatures=dialog.getByRole('spinbutton');
  assert.equal(await temperatures.count(),2);
  await temperatures.first().fill('320');await temperatures.first().press('Enter');
  await button(dialog,'Apply selected heating conditions').click();
  const result=await eventually(saved,p=>p.cfdScenarios[0].assetOverrides.some(a=>a.objectId===heater.id&&a.temperatureK===320));
  const scenario=result.cfdScenarios[0];assert.equal(scenario.physics.energy,true);assert.equal(scenario.physics.boussinesq,true);
  assert.equal(scenario.assetOverrides.find(a=>a.objectId===heater.id).heatW,0);
  assert.ok(Object.values(scenario.boundaries.patches).some(patch=>(patch as CFDBoundary).materialLabel.includes('UFH')&&(patch as CFDBoundary).thermal.value===303.15));
  assert.deepEqual(result.rooms,before.rooms);assert.deepEqual(result.heatingLayout,before.heatingLayout);
  assert.equal(await dialog.isVisible(),false);
});
test("probe coordinates live in Post, select actual orange 3D markers, and window minimisation preserves layout",async t=>{
  const project=cfdProject(false);project.cfdScenarios[0].outputs.probesMm=[[1600,1600,1100],[2100,1700,1200]];
  const {page,ui,saved}=await open(t,project,1440,true);
  const originalRooms=structuredClone((await saved()).rooms);
  await ui.getByRole('tab',{name:'Post-processing',exact:true}).click();
  const row=ui.getByRole('group',{name:'Probe 1',exact:true});await button(row,'Probe 1').click();
  await eventually(()=>renderState(page,'probe:0'),state=>state?.colour==='#ff7900');
  const marker=await renderState(page,'probe:0');assert.deepEqual(marker.position,[1.6,1.1,-1.6]);
  await layout(page,'Dock left');
  // Exercise actual pointer selection after the setup window is temporarily hidden.
  await button(page,'Minimise Simulation setup').click();await button(ui,'Select probe 2 in 3D').click();await button(page,'Restore Simulation setup').click();
  await eventually(()=>renderState(page,'probe:1'),state=>state?.colour==='#ff7900');
  const setup=ui.locator('.cfx-setup-window'),before=await setup.boundingBox();
  await button(page,'Minimise Simulation setup').click();assert.equal(await setup.isVisible(),false);
  await button(page,'Restore Simulation setup').click();const after=await setup.boundingBox();
  assert.ok(Math.abs(before.x-after.x)<2&&Math.abs(before.y-after.y)<2&&Math.abs(before.width-after.width)<2,JSON.stringify({before,after}));
  assert.equal(await row.getByRole('spinbutton',{name:'Probe 1 X (mm)',exact:true}).inputValue(),'1600');
  assert.deepEqual((await saved()).rooms,originalRooms);
  await button(page,'Window layout for Simulation setup').click();await page.getByRole('menuitem',{name:'Minimise window',exact:true}).click();await button(page,'Restore Simulation setup').click();
});
const frame = page => page.locator(".cfx-setup-window");
async function open(t, project = cfdProject(), width = 1440, inspect = false) {
  const session = await harness.session(project, { viewport: { width, height: 1000 } });
  t.after(() => session.close());
  if (inspect) {
    // Test-only standard React inspector hook, not an application debug API.
    // Read the actual production R3F store/materials/camera, not a parallel mock.
    await session.context.addInitScript(() => {
      window.__cfdStores = [];
      window.__REACT_DEVTOOLS_GLOBAL_HOOK__ = {
        supportsFiber: true, inject: () => 1, onCommitFiberUnmount() {},
        onCommitFiberRoot(_, root) {
          const store = root.containerInfo;
          if (typeof store?.getState === "function" && !window.__cfdStores.includes(store)) window.__cfdStores.push(store);
        },
      };
      window.__cfdState = () => window.__cfdStores.map(store => store.getState()).find(s => s.gl?.domElement?.closest(".cfx-viewport"));
    });
    await session.page.reload();
  }
  await session.page.getByRole("combobox", { name: "Workspace", exact: true }).selectOption("CLIMOPTIX");
  const ui = session.page.locator(".cfx-workspace");
  await cfdWindow(ui, "Solver");
  await eventually(() => ui.getAttribute("data-preparation-state"), v => v === "checked");
  if (inspect) await eventually(() => session.page.evaluate(() => !!window.__cfdState()?.scene), Boolean);
  return { ...session, ui };
}
async function layout(page, action) {
  await button(frame(page), "Window layout for Simulation setup").click();
  await page.getByRole("menuitem", { name: action, exact: true }).click();
}
async function capture(page, name) {
  if (process.env.BROWSER_ARTIFACTS) await page.screenshot({ path: `${process.env.BROWSER_ARTIFACTS}/cfd-surface-${name}.png` });
}
async function renderState(page, name) {
  return page.evaluate(name => {
    const s = window.__cfdState(), mesh = s?.scene.getObjectByName(name);
    if (!mesh) return null;
    const p = mesh.geometry.attributes.position;
    return { colour: `#${mesh.material.color.getHexString()}`, opacity: mesh.material.opacity, transparent: mesh.material.transparent,
      wireframe: mesh.material.wireframe, shape: mesh.geometry.type, vertices: Array.from(p.array),
      target: s.controls?.target.toArray(), position: mesh.position.toArray() };
  }, name);
}
async function cameraState(page) {
  return page.evaluate(() => { const s = window.__cfdState(); return { position: s.camera.position.toArray(), quaternion: s.camera.quaternion.toArray(), target: s.controls.target.toArray() }; });
}
async function fittedCamera(page, before) {
  // Bounds copies the new OrbitControls target when its demand-rendered fit
  // finishes. A fixed sleep races slow software-rendered browser sweeps.
  await eventually(() => cameraState(page), after => after.target.some((v, i) => Math.abs(v - before.target[i]) > 1e-6),
    'The explicit view fit must finish before checking selection');
  let previous = '', stable = 0;
  return eventually(() => cameraState(page), after => {
    const next = JSON.stringify(after);
    stable = next === previous ? stable + 1 : 0; previous = next;
    return stable >= 3;
  }, 'The camera must settle after the explicit fit');
}
async function assertCameraUnchanged(page, before) {
  // Wait past Bounds' animation duration; a single-frame assertion misses fits.
  await page.waitForTimeout(400);
  const after = await cameraState(page);
  for (const key of ["position", "quaternion", "target"]) after[key].forEach((v, i) => assert.ok(Math.abs(v - before[key][i]) < 1e-6, `${key}[${i}] changed on selection`));
}

test("real 3D selection only highlights orange without moving the camera; face placement reuses the vent", async t => {
  const project = cfdProject(), scenario = project.cfdScenarios![0];
  const report = realPreparation({ project, scenario, clientRevision: "a".repeat(64) });
  scenario.mesh.refinements = [
    { id: "colour-five", name: "Occupied zone", shape: "box", centerMm: [2000, 2500, 1100], sizeMm: [1000, 1600, 1200], cellMm: 6.25, level: 5, objectId: null },
    { id: "colour-two", name: "Other zone", shape: "box", centerMm: [5500, 3000, 1100], sizeMm: [1200, 1800, 1200], cellMm: 50, level: 2, objectId: null },
  ];
  scenario.vents = ["wall", "floor", "ceiling"].map((kind, i) => ventSchema.parse({ id: `surface-${kind}`, name: `${kind} device`, role: i === 2 ? "extract" : "supply",
    host: { patchId: report.patches.find(p => p.kind === kind && p.host)!.id, u: .4, v: .5 } }));
  const { page, ui, saved } = await open(t, project, 1440, true);
  const sourceRooms = structuredClone((await saved()).rooms);
  await layout(page, "Dock left");
  await eventually(() => renderState(page, "refinement:colour-five"), Boolean);
  const initial = await renderState(page, "refinement:colour-five");
  assert.equal(initial.shape, "BoxGeometry"); assert.equal(initial.wireframe, false);
  assert.ok(initial.transparent && initial.opacity > 0 && initial.opacity < 1);
  assert.equal(initial.colour, refinementColour(5));
  for (const vent of scenario.vents) {
    const rendered = await renderState(page, `vent:${vent.id}`), host = report.patches.find(p => p.id === vent.host.patchId)!.host!;
    assert.ok(rendered && !rendered.transparent && rendered.opacity === 1 && !rendered.wireframe);
    assert.equal(rendered.colour, vent.role === "supply" ? "#278ade" : "#be5b9d");
    for (let i = 0; i < rendered.vertices.length; i += 3) {
      const mm = [rendered.vertices[i] * 1000, -rendered.vertices[i + 2] * 1000, rendered.vertices[i + 1] * 1000];
      const distance = mm.reduce((v, p, axis) => v + (p - host.originMm[axis]) * host.normal[axis], 0);
      assert.ok(Math.abs(distance + 2) < .001, `${vent.id} must be a surface patch, not a volume: ${distance}`);
    }
  }
  assert.doesNotMatch(await ui.locator(".cfx-viewer > footer").innerText(), /Dashed|wireframe|prescribed flow|solved results/);
  await page.waitForTimeout(400);
  await page.evaluate(() => {
    const s = window.__cfdState(); s.camera.position.set(12, 7, 9); s.controls.target.set(3, 1, -3); s.controls.update(); s.invalidate();
  });
  await page.waitForTimeout(200);
  const beforeSelection = await cameraState(page);
  await ui.locator(".cfx-refinement-name").filter({ hasText: "Occupied zone" }).click();
  await eventually(() => renderState(page, "refinement:colour-five"), s => s?.colour === "#ff7900");
  await assertCameraUnchanged(page, beforeSelection);
  const viewport = ui.locator('.cfx-viewport'), scope = await viewport.getAttribute('data-scope');
  await ui.locator('#cfx-setup-panel-mesh').click({position:{x:10,y:400}});
  assert.equal(await ui.locator('.cfx-refinement-row.selected').count(),0);
  assert.equal(await viewport.getAttribute('data-scope'),scope);
  await ui.locator('.cfx-refinement-name').filter({hasText:'Occupied zone'}).click();
  const canvasBox = await viewport.locator('canvas').boundingBox();
  await viewport.locator('.stable-canvas-host').click({position:{x:canvasBox.width-10,y:canvasBox.height-20}});
  assert.equal(await ui.locator('.cfx-refinement-row.selected').count(),0,'3D background removes selection');
  await assertCameraUnchanged(page, beforeSelection);
  await ui.locator(".cfx-refinement-name").filter({hasText:"Other zone"}).click();
  await page.evaluate(() => {
    const s = window.__cfdState(); s.camera.position.set(2, 1.1, -.5); s.controls.target.set(2, 1.1, -2.5); s.controls.update(); s.invalidate();
  });
  await page.waitForTimeout(250);
  const beforePointerSelection = await cameraState(page);
  const point = await page.evaluate(() => {
    const s = window.__cfdState(), mesh = s.scene.getObjectByName("refinement:colour-five"), box = s.gl.domElement.getBoundingClientRect();
    const p = mesh.position.clone().project(s.camera);
    return {x:box.x+(p.x+1)*box.width/2,y:box.y+(1-p.y)*box.height/2};
  });
  await page.mouse.click(point.x, point.y);
  await eventually(() => renderState(page,"refinement:colour-five"), s => s?.colour === "#ff7900");
  await assertCameraUnchanged(page, beforePointerSelection);
  await button(ui.locator(".cfx-view-selector"), "Fit").click();
  assert.notDeepEqual(await fittedCamera(page, beforePointerSelection), beforePointerSelection, "Explicit Fit remains available");
  await capture(page, "refinement-selected");
  await cfdWindow(ui, "Equipment");
  const beforeVent = await cameraState(page);
  await ui.locator(".cfx-device-name").filter({ hasText: "floor device" }).click();
  const vent = scenario.vents[1];
  await eventually(() => renderState(page, `vent:${vent.id}`), s => s?.colour === "#ff7900");
  await assertCameraUnchanged(page, beforeVent);
  const beforeScopeChange = await cameraState(page);
  await ui.getByRole("combobox", { name: "CFD view scope", exact: true }).selectOption("room:room-1");
  await eventually(() => ui.locator(".cfx-viewport").getAttribute("data-scope"), v => v === "room:room-1");
  const beforeScopedSelection = await fittedCamera(page, beforeScopeChange);
  await ui.locator(".cfx-device-name").filter({ hasText: "floor device" }).click();
  assert.equal(await ui.locator(".cfx-viewport").getAttribute("data-scope"), "room:room-1");
  await assertCameraUnchanged(page, beforeScopedSelection);
  await capture(page, "vent-selected");
  await button(ui, "Edit floor device").click();
  const editor = page.locator(".cfx-equipment-editor");
  await button(editor, "Place this vent on face…").click();
  assert.equal(await frame(page).isVisible(), false);
  await capture(page, "face-placement");
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  const findHost = hostIds => page.evaluate(hostIds => {
    const s = window.__cfdState(), box = s.gl.domElement.getBoundingClientRect();
    const ray = new s.raycaster.constructor(), pointer = s.pointer.clone();
    for (let y = box.top + 150; y < box.bottom - 100; y += 25) for (let x = box.left + 30; x < box.right - 30; x += 25) {
      if (document.elementFromPoint(x, y)?.closest(".stable-canvas-host") !== s.gl.domElement.closest(".stable-canvas-host")) continue;
      pointer.set((x-box.left)/box.width*2-1, -(y-box.top)/box.height*2+1); ray.setFromCamera(pointer, s.camera);
      const hit = ray.intersectObjects(s.scene.children, true).find(hit => hit.object.name && !hit.object.name.startsWith("vent:"));
      if (hit && hostIds.includes(hit.object.name)) return { x, y, hostId: hit.object.name };
    }
  }, hostIds);
  const wallIds = report.patches.filter(p => p.host && p.kind === 'wall').map(p => p.id);
  const candidate = await eventually(() => findHost(wallIds), Boolean);
  assert.ok(candidate, "An existing planar host must be reachable for an actual pointer placement");
  await page.mouse.click(candidate.x, candidate.y);
  const placement = page.getByRole('region',{name:'Vent placement editor',exact:true});
  await eventually(() => placement.getByRole('combobox',{name:'Vent host face',exact:true}).inputValue(), value => value === candidate.hostId);
  const second = await eventually(() => findHost(wallIds.filter(id => id !== candidate.hostId)), Boolean);
  await page.mouse.click(second.x, second.y);
  await eventually(() => placement.getByRole('combobox',{name:'Vent host face',exact:true}).inputValue(), value => value === second.hostId);
  const host = report.patches.find(p => p.id === second.hostId).host;
  const uInput=placement.getByRole('spinbutton',{name:'Host U (0–1)',exact:true});
  const vInput=placement.getByRole('spinbutton',{name:'Host V (0–1)',exact:true});
  await uInput.fill('.65'); await uInput.press('Enter'); await vInput.fill('.55'); await vInput.press('Enter');
  // Face polygons/holes can clamp the requested UV. Drag the actual preview,
  // not the unvalidated requested coordinate on a randomly reachable wall.
  const u=Number(await uInput.inputValue()),v=Number(await vInput.inputValue());
  const center=host.originMm.map((c,i)=>c+host.uAxis[i]*host.widthMm*u+host.vAxis[i]*host.heightMm*v);
  await page.evaluate(({center,normal})=>{
    const s=window.__cfdState(); s.controls.target.set(center[0]/1000,center[2]/1000,-center[1]/1000);
    s.camera.position.set(center[0]/1000+normal[0]*3,center[2]/1000+normal[2]*3,-center[1]/1000-normal[1]*3);
    s.controls.update(); s.invalidate();
  },{center,normal:host.normal});
  await page.waitForTimeout(250);
  const hit = await page.evaluate(center=>{
    const s=window.__cfdState(), box=s.gl.domElement.getBoundingClientRect();
    const p=s.controls.target.clone().set(center[0]/1000,center[2]/1000,-center[1]/1000).project(s.camera);
    return {x:box.x+(p.x+1)*box.width/2,y:box.y+(1-p.y)*box.height/2};
  },center);
  const beforeDrag=await placement.getByLabel('Live vent coordinates').innerText();
  await page.mouse.move(hit.x,hit.y); await page.mouse.down(); await page.mouse.move(hit.x+60,hit.y+15,{steps:8});
  await eventually(()=>placement.getByLabel('Live vent coordinates').innerText(),text=>text!==beforeDrag,'Dragging must update coordinates before pointer release');
  await page.mouse.up();
  assert.notEqual(await uInput.inputValue(),'.65');
  const footer=ui.locator('.cfx-placement-actions');
  assert.ok(await footer.isVisible());
  const fb=await footer.boundingBox(), wb=await ui.locator('.cfx-placement-editor').boundingBox();
  assert.ok(Math.abs(fb.y+fb.height-wb.y-wb.height)<3,'OK/Cancel stay pinned to the window bottom');
  await capture(page,'placement-live-drag');
  assert.deepEqual((await saved()).cfdScenarios[0].vents, scenario.vents, 'Placement is a draft until OK');
  await button(ui.locator('.cfx-placement-editor'), 'OK').click();
  const stored = await eventually(saved, p => p.cfdScenarios[0].vents.find(v => v.id === vent.id)?.host.patchId === second.hostId);
  await eventually(() => frame(page).isVisible(), Boolean);
  assert.equal(stored.cfdScenarios[0].vents.length, 3, "Repositioning must not create another vent");
  assert.deepEqual(stored.rooms, sourceRooms, "CFD placement never changes shared source geometry");
});

test("boundary groups offer conditions and explicit unique surface assignment with unassignment, without creating geometry", async t => {
  const { page, ui, saved } = await open(t);
  const source = structuredClone((await saved()).rooms);
  await cfdWindow(ui, "Boundaries"); await layout(page, "Maximise window");
  await button(ui, "Add boundary group").click();
  const group = ui.getByRole("region", { name: "Boundary group Group", exact: true });
  await button(group, "Actions for boundary group Group").click();
  await button(ui.getByRole("dialog", {name:"Actions — Group", exact:true}), "Conditions for boundary group Group").click();
  const editor = page.locator(".floating-toolbar").filter({ has: page.getByLabel("Move Edit boundary group", { exact: true }) });
  assert.ok(await editor.getByRole("checkbox", { name: "Use group conditions", exact: true }).isChecked());
  await editor.getByRole("combobox", { name: "Boundary flow condition", exact: true }).selectOption("slip");
  await button(editor, "Hide Edit boundary group").click();
  await eventually(() => ui.getAttribute("data-preparation-state"), v => v === "checked");
  await button(group, "Actions for boundary group Group").click();
  await button(ui.getByRole("dialog", {name:"Actions — Group", exact:true}), "Assign surfaces to Group").click();
  const assign = page.locator(".floating-toolbar").filter({ has: page.getByLabel("Move Assign boundary surfaces", { exact: true }) });
  const checks = assign.getByRole("checkbox");
  const ids = await checks.evaluateAll(els => els.slice(0, 2).map(el => el.getAttribute("aria-label").replace("Assign surface ", "")));
  await checks.nth(0).check(); await checks.nth(1).check(); await button(assign, "Apply assignment").click();
  const result = await eventually(saved, p => p.cfdScenarios[0].boundaries.collections.find(g => g.name === "Group")?.patchIds.length === 2);
  const id = result.cfdScenarios[0].boundaries.collections.find(g => g.name === "Group").id;
  assert.equal(result.cfdScenarios[0].boundaries.collections.find(g => g.id === id).boundary.flow.type, "slip");
  assert.equal(await group.locator(".cfx-surface-row").count(), 2);
  await capture(page, "boundary-assigned");
  await eventually(() => ui.getAttribute("data-preparation-state"), v => v === "checked");
  await button(group, "Actions for boundary group Group").click();
  await button(ui.getByRole("dialog", {name:"Actions — Group", exact:true}), "Assign surfaces to Group").click();
  await assign.getByRole("checkbox", { name: `Assign surface ${ids[0]}`, exact: true }).uncheck();
  await button(assign, "Apply assignment").click();
  await eventually(saved, p => p.cfdScenarios[0].boundaries.collections.find(g => g.id === id)?.patchIds.length === 1);
  assert.deepEqual((await saved()).rooms, source);
});

test("Run uses three/four columns, probes label XYZ in a single action row, plane menus explain orientation and export action labels are centred", async t => {
  const project = cfdProject(); project.cfdScenarios![0].outputs.probesMm = [[1000, 1500, 1200], [2000, 2500, 1000]];
  const { page, ui } = await open(t, project, 960);
  await layout(page, "Maximise window");
  await ui.getByRole("tab", { name: "Run", exact: true }).click();
  const grid = ui.locator("#cfx-panel-run .cfx-grid").first();
  assert.equal(await grid.evaluate(el => getComputedStyle(el).gridTemplateColumns.split(" ").length), 3);
  assert.equal(await ui.getByText("Solver not connected", {exact:true}).count(), 0);
  assert.ok(await ui.getByRole("region", {name:"OpenFOAM connection", exact:true}).isVisible());
  assert.equal(await ui.getByRole("button", { name: "Retry check", exact: true }).count(), 0);
  await capture(page, "run-960");
  await page.setViewportSize({ width: 1440, height: 1000 });
  await eventually(() => grid.evaluate(el => getComputedStyle(el).gridTemplateColumns.split(" ").length), n => n === 4);
  await cfdWindow(ui, "Solver");await ui.getByRole("tab", {name:"Post-processing",exact:true}).click();
  const row = ui.getByRole("group", { name: "Probe 1", exact: true });
  await row.scrollIntoViewIfNeeded();
  const y = [];
  for (const axis of ["X", "Y", "Z"]) y.push((await row.getByRole("spinbutton", { name: `Probe 1 ${axis} (mm)`, exact: true }).boundingBox()).y);
  assert.ok(Math.max(...y) - Math.min(...y) < 2, `Probe controls must share a row: ${y}`);
  await capture(page, "probes");
  await cfdWindow(ui, "Solver"); await ui.getByRole("tab", { name: "Post-processing", exact: true }).click();
  assert.ok(await ui.getByRole("spinbutton", { name: "X plane count", exact: true }).isDisabled());
  await ui.getByRole("checkbox", { name: "YZ slices (normal X)", exact: true }).check();
  assert.ok(await ui.getByRole("spinbutton", { name: "X plane count", exact: true }).isEnabled());
  await capture(page, "post");
  await cfdWindow(ui, "Review & export"); await ui.getByRole("tab", { name: "Import / export", exact: true }).click();
  for (const width of [1440, 960, 390]) {
    await page.setViewportSize({ width, height: 1000 });
    const alignments = await ui.locator(".cfx-transfer-actions > *").evaluateAll(els => els.map(el => {
      const text = [...el.childNodes].find(node => node.nodeType === Node.TEXT_NODE && node.textContent.trim());
      const range = document.createRange(); range.selectNode(text);
      const t = range.getBoundingClientRect(), r = el.getBoundingClientRect();
      return Math.abs((r.x+r.width/2)-(t.x+t.width/2));
    }));
    assert.ok(alignments.every(error => error < 2), `${width}: ${alignments}`);
    const tabs = await ui.getByRole("tablist", { name: "Review and transfer", exact: true }).boundingBox();
    const help = await button(ui, "Help for Simulation review and transfer").boundingBox();
    assert.ok(help.x >= tabs.x + tabs.width - 1 && Math.abs(help.y + help.height / 2 - tabs.y - tabs.height / 2) < 2,
      `${width}: help stays at the right of the tab row: ${JSON.stringify({ tabs, help })}`);
    assert.ok(await ui.locator(".cfx-setup-panel:visible").evaluate(el => el.scrollWidth <= el.clientWidth + 2));
    await capture(page, `export-${width}`);
  }
});

test("missing domain does not fabricate surfaces or zero named planes; group conditions remain editable and assignments/runnable exports stay blocked", async t => {
  const project = cfdProject(); project.cfdScenarios![0].seed = null;
  const { page, ui, saved } = await open(t, project);
  await layout(page, "Maximise window");
  await ui.getByRole("tab", { name: "Post-processing", exact: true }).click();
  const positions = ui.locator("summary").filter({ hasText: "Plane positions" });
  assert.match(await positions.innerText(), /3 requested · domain pending/);
  await positions.click();
  assert.ok(await ui.getByText("Choose a seed room in Domain and resolve preparation checks to calculate plane positions.", { exact: true }).isVisible());
  await cfdWindow(ui, "Boundaries");
  await button(ui, "Add boundary group").click();
  await button(ui, "Actions for boundary group Group").click();
  await button(ui, "Conditions for boundary group Group").click();
  const editor = page.locator(".floating-toolbar").filter({ has: page.getByLabel("Move Edit boundary group", { exact: true }) });
  assert.ok(await editor.getByRole("combobox", { name: "Boundary flow condition", exact: true }).isEnabled());
  await button(editor, "Hide Edit boundary group").click();
  await button(ui, "Actions for boundary group Group").click();
  await button(ui, "Assign surfaces to Group").click();
  const assign = page.locator(".floating-toolbar").filter({ has: page.getByLabel("Move Assign boundary surfaces", { exact: true }) });
  assert.equal(await assign.getByRole("checkbox").count(), 0);
  assert.ok(await button(assign, "Apply assignment").isDisabled());
  await button(assign, "Cancel").click();
  const stored = await eventually(saved, p => p.cfdScenarios[0].boundaries.collections.some(g => g.name === "Group"));
  assert.equal(stored.cfdScenarios[0].boundaries.collections.find(g => g.name === "Group").patchIds.length, 0);
  await cfdWindow(ui, "Solver"); await ui.getByRole("tab", { name: "Run", exact: true }).click();
  await eventually(() => button(ui, "Export OpenFOAM settings").isDisabled(), Boolean);
  assert.ok(await button(ui, "Run solver").isDisabled());
});
