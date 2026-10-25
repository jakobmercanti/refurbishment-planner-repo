import assert from "node:assert/strict";
import test, { before, after } from "node:test";
import { cfdProject, realPreparation } from "../climoptixFixtures";
import { ventSchema } from "../../lib/climoptixDocument";
import { refinementColour } from "../../lib/climoptixWorkflow";
import { cfdWindow, eventually, startBrowserHarness } from "./harness.mjs";

let harness;
before(async () => { harness = await startBrowserHarness({ climoptixEnabled: true }); });
after(async () => { await harness?.close(); });
const button = (scope, name) => scope.getByRole("button", { name, exact: true });
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

test("real 3D meshes use filled translucent refinement cuboids, opaque host-plane vents and orange camera-centred selection; face placement reuses the vent", async t => {
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
  await ui.locator(".cfx-refinement-name").filter({ hasText: "Occupied zone" }).click();
  await eventually(() => renderState(page, "refinement:colour-five"), s => s?.colour === "#ff7900" && s.target.every((v, i) => Math.abs(v - [2, 1.1, -2.5][i]) < .03));
  await capture(page, "refinement-selected");
  await cfdWindow(ui, "Equipment");
  await ui.locator(".cfx-device-name").filter({ hasText: "floor device" }).click();
  const vent = scenario.vents[1], h = report.patches.find(p => p.id === vent.host.patchId)!.host!;
  const center = h.originMm.map((v, i) => v + h.uAxis[i] * h.widthMm * .4 + h.vAxis[i] * h.heightMm * .5);
  await eventually(() => renderState(page, `vent:${vent.id}`), s => s?.colour === "#ff7900" && s.target.every((v, i) => Math.abs(v - [center[0]/1000, center[2]/1000, -center[1]/1000][i]) < .03));
  await ui.getByRole("combobox", { name: "CFD view scope", exact: true }).selectOption("room:room-1");
  await eventually(() => ui.locator(".cfx-viewport").getAttribute("data-scope"), v => v === "room:room-1");
  await ui.locator(".cfx-device-name").filter({ hasText: "floor device" }).click();
  await eventually(() => ui.locator(".cfx-viewport").getAttribute("data-scope"), v => v === "building");
  await eventually(() => renderState(page, `vent:${vent.id}`), s => s.target.every((v, i) => Math.abs(v - [center[0]/1000, center[2]/1000, -center[1]/1000][i]) < .03));
  await capture(page, "vent-selected");
  await button(ui, "Edit floor device").click();
  const editor = page.locator(".cfx-equipment-editor");
  await button(editor, "Place this vent on face…").click();
  assert.equal(await frame(page).isVisible(), false);
  await capture(page, "face-placement");
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  const candidate = await eventually(() => page.evaluate(hostIds => {
    const s = window.__cfdState(), box = s.gl.domElement.getBoundingClientRect();
    const ray = new s.raycaster.constructor(), pointer = s.pointer.clone();
    for (let y = box.top + 150; y < box.bottom - 100; y += 25) for (let x = box.left + 30; x < box.right - 30; x += 25) {
      if (document.elementFromPoint(x, y)?.closest(".stable-canvas-host") !== s.gl.domElement.closest(".stable-canvas-host")) continue;
      pointer.set((x-box.left)/box.width*2-1, -(y-box.top)/box.height*2+1); ray.setFromCamera(pointer, s.camera);
      const hit = ray.intersectObjects(s.scene.children, true).find(hit => hit.object.name && !hit.object.name.startsWith("vent:"));
      if (hit && hostIds.includes(hit.object.name)) return { x, y, hostId: hit.object.name };
    }
  }, report.patches.filter(p => p.host).map(p => p.id)), Boolean);
  assert.ok(candidate, "An existing planar host must be reachable for an actual pointer placement");
  await page.mouse.click(candidate.x, candidate.y);
  const stored = await eventually(saved, p => p.cfdScenarios[0].vents.find(v => v.id === vent.id)?.host.patchId === candidate.hostId);
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
  await button(group, "Conditions for boundary group Group").click();
  const editor = page.locator(".floating-toolbar").filter({ has: page.getByLabel("Move Edit boundary group", { exact: true }) });
  assert.ok(await editor.getByRole("checkbox", { name: "Use group conditions", exact: true }).isChecked());
  await editor.getByRole("combobox", { name: "Boundary flow condition", exact: true }).selectOption("slip");
  await button(editor, "Hide Edit boundary group").click();
  await eventually(() => ui.getAttribute("data-preparation-state"), v => v === "checked");
  await button(group, "Assign surfaces to Group").click();
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
  await button(group, "Assign surfaces to Group").click();
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
  const status = ui.getByRole("status").filter({ hasText: "Solver not connected" });
  assert.equal(await status.evaluate(el => getComputedStyle(el).borderTopWidth), "0px");
  assert.equal(await ui.getByRole("button", { name: "Retry check", exact: true }).count(), 0);
  await capture(page, "run-960");
  await page.setViewportSize({ width: 1440, height: 1000 });
  await eventually(() => grid.evaluate(el => getComputedStyle(el).gridTemplateColumns.split(" ").length), n => n === 4);
  await cfdWindow(ui, "Physics");
  await ui.locator("summary").filter({ hasText: "Requested outputs & monitoring points" }).click();
  const row = ui.getByRole("group", { name: "Probe 1", exact: true });
  await row.scrollIntoViewIfNeeded();
  const y = [];
  for (const axis of ["X", "Y", "Z"]) y.push((await row.getByRole("spinbutton", { name: `Probe 1 ${axis} (mm)`, exact: true }).boundingBox()).y);
  y.push((await button(row, "Remove probe 1").boundingBox()).y);
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
  await button(ui, "Conditions for boundary group Group").click();
  const editor = page.locator(".floating-toolbar").filter({ has: page.getByLabel("Move Edit boundary group", { exact: true }) });
  assert.ok(await editor.getByRole("combobox", { name: "Boundary flow condition", exact: true }).isEnabled());
  await button(editor, "Hide Edit boundary group").click();
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
