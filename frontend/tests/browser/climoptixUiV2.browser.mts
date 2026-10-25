import assert from "node:assert/strict";
import test, { before, after } from "node:test";
import { cfdProject, realPreparation } from "../climoptixFixtures";
import { realThermal } from "../thermalFixtures";
import { duplicateCFDScenario } from "../../lib/climoptixDocument";
import { cfdWindow, eventually, startBrowserHarness } from "./harness.mjs";

let harness;
before(async () => { harness = await startBrowserHarness({ climoptixEnabled: true }); });
after(async () => { await harness?.close(); });
async function open(t, project = cfdProject(), options = {}) {
  const session = await harness.session(project, options);
  t.after(() => session.close());
  const reports = [];
  await session.context.route("**/climoptix/prepare", async route => {
    const report = realPreparation(route.request().postDataJSON()); reports.push(report);
    await route.fulfill({ contentType: "application/json", body: JSON.stringify(report) });
  });
  await session.context.route("**/climoptix/thermal-envelope", route => route.fulfill({ contentType: "application/json", body: JSON.stringify(realThermal(route.request().postDataJSON(), false)) }));
  await session.page.getByRole("combobox", { name: "Workspace", exact: true }).selectOption("CLIMOPTIX");
  const ui = session.page.getByRole("region", { name: "Climoptix CFD workspace", exact: true });
  await ui.getByLabel("Move Simulation setup", { exact: true }).waitFor();
  await ready(ui);
  return { ...session, ui, reports };
}
async function ready(ui) { await eventually(() => ui.getAttribute("data-preparation-state"), s => s === "checked"); }
async function screenshot(page, name) { if (process.env.BROWSER_ARTIFACTS) await page.screenshot({ path: `${process.env.BROWSER_ARTIFACTS}/cfd-ui-v2-${name}.png` }); }

test("touch transfers require a deliberate grip drag and Escape cancels without closing setup", async t => {
  const project = cfdProject();
  project.cfdSimulationGroups = [{ id: "general", name: "General" }, { id: "target", name: "Target" }];
  const { page, context, ui, saved } = await open(t, project, { hasTouch: true });
  const client = await context.newCDPSession(page);
  const start = async () => {
    const box = await ui.getByRole("button", { name: "Reorder Office airflow", exact: true }).boundingBox();
    await client.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ id: 1, x: box.x + box.width / 2, y: box.y + box.height / 2 }] });
  };
  const move = async group => {
    const box = await ui.getByRole("list", { name: `${group} simulations`, exact: true }).boundingBox();
    await client.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ id: 1, x: box.x + 60, y: box.y + 18 }] });
  };
  const end = () => client.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  await start(); await end();
  assert.equal((await saved()).cfdScenarios[0].group, "General", "A tap must not reorganize simulations");
  await start(); await move("Target"); await end();
  await eventually(saved, p => p.cfdScenarios[0].group === "Target");
  await start(); await move("General"); await page.keyboard.press("Escape"); await end();
  assert.equal((await saved()).cfdScenarios[0].group, "Target");
  assert.ok(await ui.getByLabel("Move Simulation setup", { exact: true }).isVisible());
});

test("simulation folders nest independent simulations, drag safely, duplicate, dissolve and survive reload", async t => {
  const p = cfdProject(), first = p.cfdScenarios![0], second = duplicateCFDScenario(first);
  first.name = "Baseline"; second.name = "Alternative"; p.cfdScenarios!.push(second);
  const { page, ui, saved } = await open(t, p);
  assert.equal(await ui.locator(".cfx-setup-footer").count(), 0);
  assert.equal(await ui.getByRole("textbox", { name: "Study name", exact: true }).count(), 0);
  assert.equal(await ui.getByRole("textbox", { name: "Simulation group", exact: true }).count(), 0);
  const row = ui.locator(".cfx-study-row").filter({ has: page.getByRole("button", { name: "Select Baseline", exact: true }) });
  const sizes = await row.locator(".cfx-study-actions > button").evaluateAll(nodes => nodes.map(n => n.getBoundingClientRect().width));
  assert.ok(Math.max(...sizes) - Math.min(...sizes) < 1, JSON.stringify(sizes));
  await ui.getByRole("button", { name: "Add group", exact: true }).click();
  await eventually(saved, p => p.cfdSimulationGroups?.some(g => g.name === "Group"));
  await ui.getByRole("button", { name: "Undo", exact: true }).click();
  await eventually(saved, p => !p.cfdSimulationGroups?.some(g => g.name === "Group"));
  await ui.getByRole("button", { name: "Redo", exact: true }).click();
  await eventually(saved, p => p.cfdSimulationGroups?.some(g => g.name === "Group"));
  const folder = ui.getByRole("region", { name: "Simulation group Group", exact: true });
  await ui.getByRole("button", { name: "Reorder Baseline", exact: true }).dragTo(folder.getByRole("list", { name: "Group simulations", exact: true }), { targetPosition: { x: 60, y: 20 } });
  await eventually(saved, p => p.cfdScenarios.find(s => s.id === first.id).group === "Group");
  await ui.getByRole("button", { name: "Reorder Group", exact: true }).press("ArrowUp");
  await eventually(saved, p => p.cfdSimulationGroups[0].name === "Group");
  await ui.getByLabel("Actions for Baseline", { exact: true }).click();
  await row.getByRole("button", { name: "Rename", exact: true }).click();
  const name = ui.getByRole("textbox", { name: "Simulation name", exact: true });
  await name.fill("Renamed baseline"); await name.press("Enter");
  await eventually(saved, p => p.cfdScenarios.find(s => s.id === first.id).name === "Renamed baseline");
  await ui.getByRole("button", { name: "Duplicate group Group", exact: true }).click();
  await eventually(saved, p => p.cfdScenarios.length === 3 && p.cfdSimulationGroups.some(g => g.name === "Group copy"));
  await ui.getByRole("button", { name: "Delete group Group copy", exact: true }).click();
  await eventually(saved, p => p.cfdScenarios.length === 3 && p.cfdScenarios.some(s => s.group === "Ungrouped"));
  await ready(ui);
  const before = (await saved()).cfdScenarios.map(s => ({ id: s.id, group: s.group }));
  await folder.getByRole("list", { name: "Group simulations", exact: true }).evaluate((node, payload) => {
    const data = new DataTransfer(); data.setData("application/x-climoptix-reorder", JSON.stringify(payload));
    node.dispatchEvent(new DragEvent("drop", { bubbles: true, dataTransfer: data }));
  }, { id: second.id, scope: `simulations:${p.projectId}`, token: "forged" });
  assert.deepEqual((await saved()).cfdScenarios.map(s => ({ id: s.id, group: s.group })), before);
  await screenshot(page, "simulation-folders");
  await page.reload();
  await page.getByRole("combobox", { name: "Workspace", exact: true }).selectOption("CLIMOPTIX");
  await ui.getByRole("region", { name: "Simulation group Group", exact: true }).waitFor();
  assert.equal((await saved()).cfdSimulationGroups[0].name, "Group");
});

test("equipment is a draggable CRUD list with a separate floating editor and unchanged measured source", async t => {
  const { page, ui, saved } = await open(t);
  const source = JSON.stringify((await saved()).rooms);
  await cfdWindow(ui, "Equipment");
  await ui.getByRole("button", { name: "+ Supply", exact: true }).click();
  const editor = ui.getByRole("region", { name: "Equipment editor", exact: true });
  const rename = async value => { const name = editor.getByRole("textbox", { name: "Vent name", exact: true }); await name.fill(value); await name.press("Enter"); };
  await rename("Supply A"); await editor.getByRole("button", { name: "Done", exact: true }).click();
  const list = ui.getByRole("list", { name: "General objects", exact: true });
  assert.equal(await list.locator("[data-item-id]").count(), 1);
  await ui.getByRole("button", { name: "+ Extract", exact: true }).click();
  await rename("Extract B");
  const u = editor.getByRole("spinbutton", { name: "Host U (0–1)", exact: true }); await u.fill("0.75"); await u.press("Enter");
  await editor.getByRole("button", { name: "Done", exact: true }).click();
  await list.getByRole("button", { name: "Duplicate Supply A", exact: true }).click();
  await eventually(saved, p => p.cfdScenarios[0].vents.length === 3);
  await editor.getByRole("button", { name: "Done", exact: true }).click();
  await list.getByRole("button", { name: "Reorder Supply A copy", exact: true }).press("ArrowUp");
  await eventually(saved, p => p.cfdScenarios[0].objectGroups[0].memberIds[1] === `vent:${p.cfdScenarios[0].vents.find(v => v.name === "Supply A copy").id}`);
  await list.getByRole("button", { name: "Delete Extract B", exact: true }).click();
  await eventually(saved, p => p.cfdScenarios[0].vents.length === 2);
  await list.getByRole("button", { name: "Edit Supply A copy", exact: true }).click();
  assert.equal(await u.inputValue(), "0.65");
  await screenshot(page, "equipment-editor");
  await editor.getByRole("button", { name: "Done", exact: true }).click();
  assert.ok(await list.getByRole("button", { name: "Edit Supply A copy", exact: true }).evaluate(node => node === document.activeElement));
  assert.equal(JSON.stringify((await saved()).rooms), source);
});

test("boundary groups colour real 3D patches, transfer surfaces and apply physical conditions through preparation", async t => {
  const { page, ui, saved, reports } = await open(t);
  await cfdWindow(ui, "Boundaries");
  const original = ui.getByRole("region", { name: "Boundary group Default surfaces", exact: true });
  const count = reports.at(-1).patches.length;
  assert.equal(await original.locator(".cfx-surface-row").count(), count);
  await ui.getByRole("list", { name: "Boundary group colours", exact: true }).waitFor();
  const first = reports.at(-1).patches.find(p => p.kind === "wall");
  await ui.getByRole("button", { name: "Add boundary group", exact: true }).click();
  assert.equal(await ui.getByRole("button", { name: "Hide Edit boundary group", exact: true }).count(), 0);
  const target = ui.getByRole("region", { name: "Boundary group Group", exact: true });
  const sourceRow = original.locator(".cfx-reorder-item").filter({ has: page.getByRole("button", { name: `Select surface ${first.id}`, exact: true }) });
  await sourceRow.getByRole("button", { name: /^Reorder / }).dragTo(target.getByRole("list", { name: "Group surfaces", exact: true }), { targetPosition: { x: 60, y: 20 } });
  await eventually(saved, p => p.cfdScenarios[0].boundaries.collections.find(g => g.name === "Group")?.patchIds.includes(first.id));
  await cfdWindow(ui, "Simulations");
  await ui.getByRole("button", { name: "Undo", exact: true }).click();
  await eventually(saved, p => !p.cfdScenarios[0].boundaries.collections.find(g => g.name === "Group")?.patchIds.includes(first.id));
  await ui.getByRole("button", { name: "Redo", exact: true }).click();
  await eventually(saved, p => p.cfdScenarios[0].boundaries.collections.find(g => g.name === "Group")?.patchIds.includes(first.id));
  await cfdWindow(ui, "Boundaries");
  await ui.getByRole("button", { name: "Actions for boundary group Group", exact: true }).click();
  await ui.getByRole("button", { name: "Edit boundary group Group", exact: true }).click();
  const form = ui.getByRole("region", { name: "Boundary group conditions", exact: true });
  await form.getByRole("checkbox", { name: "Use group conditions", exact: true }).check();
  await form.getByRole("combobox", { name: "Boundary thermal condition", exact: true }).selectOption("temperature");
  const temperature = form.getByRole("spinbutton", { name: "Boundary temperature (K)", exact: true });
  await temperature.fill("300"); await temperature.press("Enter");
  await ui.getByRole("button", { name: "Hide Edit boundary group", exact: true }).click();
  await eventually(() => reports.at(-1), r => r.patches.find(p => p.id === first.id).boundary.thermal.value === 300);
  await ready(ui);
  const groups = JSON.parse(await ui.locator(".cfx-viewport").getAttribute("data-boundary-groups"));
  assert.equal(groups.length, 2); assert.notEqual(groups[0].colour, groups[1].colour);
  assert.ok(groups[1].patchIds.includes(first.id));
  assert.equal(await original.locator(".cfx-surface-row").count(), count - 1);
  assert.match(reports.at(-1).patches.find(p => p.id === first.id).boundaryOrigin, /boundary group/);
  await screenshot(page, "boundary-groups");
});

test("phase navigation integrates Thermal in Bounds and residual monitoring in Solver, with compact adaptive fields", async t => {
  const { page, ui } = await open(t);
  const tabs = ui.getByRole("tablist", { name: "Climoptix setup", exact: true });
  assert.deepEqual(await tabs.getByRole("tab").allTextContents(), ["Simulations", "Domain", "Objects", "Bounds", "Physics", "Solver", "Export", "Results"]);
  await cfdWindow(ui, "Domain");
  const floor = await ui.getByRole("combobox", { name: "Seed floor", exact: true }).boundingBox();
  const room = await ui.getByRole("combobox", { name: "Seed room", exact: true }).boundingBox();
  assert.ok(Math.abs(floor.y - room.y) < 1);
  await cfdWindow(ui, "Physics");
  const fields = ui.locator(".cfx-physics-primary select");
  const positions = await fields.evaluateAll(nodes => nodes.map(n => n.getBoundingClientRect().y));
  assert.ok(Math.max(...positions) - Math.min(...positions) < 1);
  const columns = await ui.locator(".cfx-physics-panel > details").filter({ has: page.locator("summary").getByText("Fluid properties", { exact: true }) }).locator(":scope > .cfx-grid").evaluate(node => getComputedStyle(node).gridTemplateColumns.split(" ").length);
  assert.equal(columns, 3);
  await cfdWindow(ui, "Boundaries");
  await ui.getByRole("tab", { name: "Thermal", exact: true }).click();
  await ui.getByRole("region", { name: "Thermal envelope setup", exact: true }).waitFor();
  await cfdWindow(ui, "Solver");
  await ui.getByRole("tab", { name: "Monitor", exact: true }).click();
  const monitor = ui.getByRole("region", { name: "Convergence monitor", exact: true });
  await monitor.getByLabel("Import solver log", { exact: true }).setInputFiles({ name: "solver.log", mimeType: "text/plain", buffer: Buffer.from("Time = 1\nsmoothSolver: Solving for Ux, Initial residual = 0.2, Final residual = 0.001, No Iterations 2\nTime = 2\nsmoothSolver: Solving for Ux, Initial residual = 0.02, Final residual = 0.0001, No Iterations 2") });
  await monitor.getByRole("img", { name: "Residual graph for Ux", exact: true }).waitFor();
  assert.ok((await monitor.getByRole("img", { name: "Residual graph for Ux", exact: true }).boundingBox()).height <= 321);
  await screenshot(page, "solver-monitor");
  await page.setViewportSize({ width: 390, height: 900 }); await page.emulateMedia({ colorScheme: "dark" });
  const phase = ui.getByRole("combobox", { name: "CFD phase", exact: true });
  assert.equal(await phase.locator("option").count(), 8);
  for (const id of ["studies", "domain", "equipment", "boundaries", "physics", "mesh", "review"]) {
    await phase.selectOption(id);
    const panel = ui.locator(`#cfx-setup-panel-${id}`);
    assert.equal(await panel.evaluate(n => n.scrollWidth > n.clientWidth + 2), false, `${id} overflow`);
  }
  await phase.selectOption("boundaries"); await ui.getByRole("tab", { name: "Thermal", exact: true }).click();
  assert.ok(await ui.getByRole("combobox", { name: "Thermal step", exact: true }).isVisible());
  await screenshot(page, "mobile-thermal");
});
