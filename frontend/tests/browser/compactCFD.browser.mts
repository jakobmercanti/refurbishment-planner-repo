import assert from "node:assert/strict";
import test, { before, after } from "node:test";
import { readFile } from "node:fs/promises";
import { cfdProject } from "../climoptixFixtures";
import { cfdWindow, eventually, menu, startBrowserHarness } from "./harness.mjs";

let harness;
before(async () => { harness = await startBrowserHarness(); });
after(async () => { await harness?.close(); });
const frame = page => page.locator(".cfx-setup-window");
const button = (scope, name) => scope.getByRole("button", { name, exact: true });
async function open(t, options = {}, withObject = false) {
  const project = cfdProject();
  if (withObject) {
    const measure = value => ({ value, verified: true, uncertainty_mm: 0, source_type: "USER_MEASURED" });
    project.rooms[0].obstacles = [{ id: "measured-table", name: "Measured table", fixture_kind: "FURNITURE", representation_key: "furniture-table-rectangular",
      center: { x: 1800, y: 1800 }, rotation_deg: 0, base_z_mm: 0, verified: true, dimensions: { width: measure(400), depth: measure(400), height: measure(600) } }];
  }
  const session = await harness.session(project, options); t.after(() => session.close());
  await session.page.getByRole("combobox", { name: "Workspace", exact: true }).selectOption("CLIMOPTIX");
  const ui = session.page.getByRole("region", { name: "Climoptix CFD workspace", exact: true });
  await cfdWindow(ui, "Simulations");
  try { await eventually(() => ui.getAttribute("data-preparation-state"), state => state === "checked"); }
  catch (error) { await capture(session.page, "startup-failure"); throw new Error(`${error.message} · ${await ui.innerText()}`); }
  return { ...session, ui };
}
async function layout(page, name) {
  await button(frame(page), "Window layout for Simulation setup").click();
  await page.getByRole("menuitem", { name, exact: true }).click();
}
async function preferences(page, apply) {
  await menu(page, "Settings", "Preferences…");
  const dialog = page.getByRole("dialog", { name: "Preferences", exact: true });
  await apply(dialog);
  await button(dialog, "Close settings").click();
}
async function capture(page, name) {
  if (process.env.BROWSER_ARTIFACTS) await page.screenshot({ path: `${process.env.BROWSER_ARTIFACTS}/compact-cfd-${name}.png` });
}
const sourceGeometry = p => JSON.parse(JSON.stringify(p.rooms.map(r => ({ id: r.id, vertices: r.vertices, obstacles: r.obstacles, height: r.wall_height, openings: r.openings }))));

test("selected/collapsible simulation groups accept protected cross-group transfers; Clear all confirms and Undo restores", async t => {
  const { page, ui, saved } = await open(t, { viewport: { width: 1900, height: 1000 } });
  const source = sourceGeometry(await saved());
  await layout(page, "Maximise window");
  assert.ok(await frame(page).locator(".floating-toolbar-titlebar").getByRole("combobox", { name: "CFD scenario" }).isVisible());
  assert.equal(await frame(page).locator(".cfx-setup-heading").boundingBox().then(b => b.height), 0);
  await button(ui, "Add group").click();
  await button(ui, "New simulation").click();
  await eventually(saved, p => p.cfdScenarios.length === 2 && p.cfdScenarios[1].group === "Group");
  const group = ui.getByRole("region", { name: "Simulation group Group", exact: true });
  assert.ok((await group.getAttribute("class")).includes("selected-group"));
  await button(group, "Collapse group Group").click();
  assert.equal(await button(ui, "Select Simulation 2").count(), 0);
  await ui.getByRole("button", { name: "Reorder Office airflow", exact: true }).dragTo(group.locator(".cfx-list-header"));
  await eventually(saved, p => p.cfdScenarios.every(s => s.group === "Group"));
  await button(group, "Expand group Group").click();
  const ids = (await saved()).cfdScenarios.map(s => s.id);
  await ui.getByRole("button", { name: "Reorder Office airflow", exact: true }).focus();
  await page.keyboard.press("ArrowUp");
  await eventually(saved, p => p.cfdScenarios[0].id === ids[1]);
  const before = await group.locator(".cfx-study-row").first().boundingBox();
  await preferences(page, dialog => button(dialog, "Compact").click());
  const after = await group.locator(".cfx-study-row").first().boundingBox();
  assert.ok(after.height < before.height - 8, `Compact must reduce actual rows: ${before.height} -> ${after.height}`);
  await capture(page, "maximised-compact");
  await layout(page, "Dock left"); await capture(page, "docked-compact");
  const imported = (await saved()).cfdScenarios[0];
  await cfdWindow(ui, "Review & export");
  await ui.getByRole("tab", { name: "Import / export", exact: true }).click();
  await page.evaluate(() => {
    const original = File.prototype.text;
    File.prototype.text = function () {
      if (this.name !== "clear-probe.json") return original.call(this);
      return new Promise(resolve => { window.releaseCompactImport = async () => resolve(await original.call(this)); });
    };
  });
  await ui.getByLabel("Import CFD scenario", { exact: true }).setInputFiles({ name: "clear-probe.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(imported)) });
  await cfdWindow(ui, "Simulations");
  await button(ui, "Clear all").click();
  const confirm = page.getByRole("dialog", { name: "Clear all simulations", exact: true });
  await confirm.locator(".popup-content").click({ button: "right" });
  assert.equal(await page.locator(".cfx-context-menu:visible").count(), 0, "Modal text is not a viewer background");
  await button(confirm, "Cancel").click(); assert.equal((await saved()).cfdScenarios.length, 2);
  await button(ui, "Clear all").click(); await button(confirm, "Delete all simulations").click();
  await eventually(saved, p => p.cfdScenarios.length === 0);
  await page.evaluate(async () => { await window.releaseCompactImport(); await new Promise(requestAnimationFrame); });
  assert.equal(await ui.locator(".cfx-study-row").count(), 0, "A pending import must not resurrect a simulation after Clear all");
  const create = await button(ui, "Create first simulation").boundingBox(), load = await ui.locator(".cfx-welcome .cfx-file").boundingBox();
  assert.ok(Math.abs(create.y - load.y) < 2, "Empty state actions share a row when there is room");
  await button(ui, "Undo").click(); await eventually(saved, p => p.cfdScenarios.length === 2);
  assert.deepEqual(sourceGeometry(await saved()), source);
});

test("mesh/physics columns follow window width and all phase content remains reachable without horizontal overflow", async t => {
  const { page, ui } = await open(t, { viewport: { width: 1900, height: 1000 } });
  await layout(page, "Maximise window");
  for (const density of ["Comfortable", "Compact"]) {
    await preferences(page, dialog => button(dialog, density).click());
    for (const [width, columns] of [[1900, 4], [1050, 3], [760, 2], [390, 1]]) {
      await page.setViewportSize({ width, height: 1000 });
      await cfdWindow(ui, "Domain");
      const grid = ui.locator(".cfx-adaptive-grid");
      await eventually(() => grid.evaluate(el => getComputedStyle(el).gridTemplateColumns.split(" ").length), n => n === columns);
      for (const phase of ["Domain", "Physics", "Simulations", "Equipment", "Boundaries", "Solver", "Review & export"]) {
        await cfdWindow(ui, phase);
        const overflow = await frame(page).locator(".cfx-setup-panel:visible").evaluate(el => el.scrollWidth - el.clientWidth);
        assert.ok(overflow < 3, `${density}/${width}/${phase} overflows by ${overflow}px`);
        if (phase === "Physics") {
          const vectorColumns = await ui.locator(".cfx-physics-fields .cfx-three").first().evaluate(el => getComputedStyle(el).gridTemplateColumns.split(" ").length);
          assert.equal(vectorColumns, 3, "Related X/Y/Z vector components keep their own three-column group");
          if (width === 1900) await capture(page, `${density.toLowerCase()}-physics-vectors`);
        }
      }
      await capture(page, `${density.toLowerCase()}-${width}`);
    }
    await page.setViewportSize({ width: 1900, height: 1000 });
  }
});

test("objects, boundary groups, refinements and review tabs use compact independent editing and preserve shared geometry", async t => {
  const { page, ui, saved } = await open(t, { viewport: { width: 1900, height: 1000 } }, true);
  const source = sourceGeometry(await saved());
  await layout(page, "Maximise window");
  await cfdWindow(ui, "Equipment");
  const heading = await ui.getByRole("heading", { name: "Objects & occupants", exact: true }).boundingBox();
  const sourceButton = await button(ui, "Edit source building & assets").boundingBox();
  assert.ok(Math.abs(heading.y + heading.height / 2 - sourceButton.y - sourceButton.height / 2) < 3);
  await button(ui, "Add object group").click();
  const target = ui.getByRole("region", { name: "Object group Group", exact: true });
  await button(target, "Collapse object group Group").click();
  await button(ui, "Reorder Measured table").dragTo(target.locator(".cfx-list-header"));
  await eventually(saved, p => p.cfdScenarios[0].objectGroups?.some(g => g.name === "Group" && g.memberIds.includes("object:measured-table")));
  await button(target, "Expand object group Group").click();
  await button(ui, "Duplicate Measured table").click();
  await eventually(saved, p => p.cfdScenarios[0].objectCopies?.length === 1);
  const objectEditor = page.locator(".floating-toolbar").filter({ has: page.getByLabel("Move Edit CFD object", { exact: true }) });
  await objectEditor.waitFor();
  assert.ok(await objectEditor.isVisible());
  assert.equal(await objectEditor.evaluate(el => el.parentElement.classList.contains("cfx-workspace")), true, "Edit windows must be outside clipped scroll panels");
  await button(objectEditor, "Hide Edit CFD object").click();
  await button(ui, "Delete Measured table").click();
  await eventually(saved, p => p.cfdScenarios[0].hiddenObjectIds?.includes("measured-table"));
  await cfdWindow(ui, "Boundaries");
  const nav = await ui.getByRole("tablist", { name: "Boundary setup", exact: true }).boundingBox();
  const add = await button(ui, "Add boundary group").boundingBox(), find = await ui.getByRole("searchbox", { name: "Find a CFD patch" }).boundingBox();
  assert.ok(Math.abs(nav.y - add.y) < 3 && Math.abs(add.y - find.y) < 3);
  await button(ui, "Add boundary group").click();
  await button(ui, "Hide Edit boundary group").click();
  await button(ui, "Duplicate boundary group Group").click();
  await button(ui, "Hide Edit boundary group").click();
  await eventually(saved, p => p.cfdScenarios[0].boundaries.collections.length === 3);
  const groups = (await saved()).cfdScenarios[0].boundaries.collections;
  assert.equal(new Set(groups.flatMap(g => g.patchIds)).size, groups.flatMap(g => g.patchIds).length);
  await capture(page, "bounds");
  await cfdWindow(ui, "Solver");
  await button(ui, "Add refinement region").click(); await button(ui, "Hide Edit refinement").click();
  const row = ui.locator(".cfx-refinement-row");
  assert.ok((await row.boundingBox()).height < 60);
  await capture(page, "refinements");
  await cfdWindow(ui, "Review & export");
  assert.ok(await ui.getByRole("tab", { name: "Simulation review", exact: true }).isVisible());
  await ui.getByRole("tab", { name: /^Warnings & checks/ }).click();
  assert.ok(await ui.getByRole("combobox", { name: "CFD diagnostic severity", exact: true }).isVisible());
  await ui.getByRole("tab", { name: "Import / export", exact: true }).click();
  assert.ok(await button(ui, "Export simulation JSON").isVisible());
  assert.equal(await ui.getByRole("textbox", { name: "Simulation notes" }).isVisible(), false);
  await capture(page, "transfer");
  assert.deepEqual(sourceGeometry(await saved()), source);
});

test("three persisted mouse presets separate right click from right drag in CFD and Floorplan viewers", async t => {
  const { page, ui, saved } = await open(t);
  const source = sourceGeometry(await saved());
  await button(ui, "Hide Simulation setup").click();
  for (const preset of ["STANDARD", "CAD", "BLENDER"]) {
    await preferences(page, dialog => dialog.getByRole("combobox", { name: "3D navigation", exact: true }).selectOption(preset));
    assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem("freefloorplan3d:appearance-preferences:v1")).navigation), preset);
    for (const workspace of ["CLIMOPTIX", "FLOORPLAN"]) {
      await page.getByRole("combobox", { name: "Workspace", exact: true }).selectOption(workspace);
      if (workspace === "FLOORPLAN") await button(page, "3D").click();
      const canvas = workspace === "CLIMOPTIX" ? ui.locator("canvas") : page.locator(".analysis-workspace:visible .stable-canvas-host canvas");
      await canvas.waitFor();
      const box = await canvas.boundingBox(), x = box.x + box.width * 0.55, y = box.y + box.height * 0.7;
      await page.waitForTimeout(350); // Settle fitting before testing the middle-button mapping.
      const beforeMiddle = await canvas.screenshot();
      await page.mouse.move(x, y); await page.mouse.down({ button: "middle" });
      await page.mouse.move(x + 60, y + 40, { steps: 10 }); await page.mouse.up({ button: "middle" });
      assert.notDeepEqual(await canvas.screenshot(), beforeMiddle, `${workspace}/${preset}: middle drag must ${preset === "BLENDER" ? "orbit" : "zoom"} the camera`);
      if (workspace === "FLOORPLAN") {
        await button(page, "Perspective").click(); await page.waitForTimeout(350);
        const perspective = await canvas.screenshot();
        await page.mouse.move(x, y); await page.mouse.down({ button: "middle" });
        await page.mouse.move(x + 60, y + 40, { steps: 10 }); await page.mouse.up({ button: "middle" });
        assert.notDeepEqual(await canvas.screenshot(), perspective, `${preset}: middle mapping must also work in perspective`);
        await button(page, "Parallel").click(); await page.waitForTimeout(350);
      }
      const before = await canvas.screenshot();
      await page.mouse.move(x, y); await page.mouse.down({ button: "right" });
      await page.mouse.move(x + 70, y + 35, { steps: 10 }); await page.mouse.up({ button: "right" });
      assert.equal(await page.getByRole("menu", { name: "Climoptix windows", exact: true }).count(), 0, "Dragging must not open the menu");
      assert.equal(await page.locator(".toolbar-context-menu:visible").count(), 0);
      assert.notDeepEqual(await canvas.screenshot(), before, `${workspace}/${preset}: right drag must change the rendered camera`);
      await page.mouse.click(x, y, { button: "right" });
      await eventually(() => page.locator(workspace === "CLIMOPTIX" ? ".cfx-context-menu:visible" : ".toolbar-context-menu:visible").count(), n => n === 1);
      await page.keyboard.press("Escape");
    }
  }
  assert.deepEqual(sourceGeometry(await saved()), source);
});

test("Modern light/dark CFD stays compact and usable at wide and phone sizes", async t => {
  const { page, ui } = await open(t, { viewport: { width: 1900, height: 1000 } });
  const palettes = JSON.parse(await readFile(new URL("../../../data/ui_theme_defaults.json", import.meta.url), "utf8")).themes;
  await layout(page, "Maximise window");
  for (const theme of ["Light", "Dark"]) for (const density of ["Comfortable", "Compact"]) {
    await preferences(page, async dialog => { await button(dialog, theme).click(); await button(dialog, density).click(); });
    await page.evaluate(palette => {
      document.body.dataset.uiStyle = "modern";
      const root = document.documentElement;
      for (const [key, value] of Object.entries(palette.colours)) root.style.setProperty("--configured-" + key, value);
      for (const [key, value] of Object.entries(palette.buttons)) root.style.setProperty("--configured-ui-button-" + key, value);
      for (const [key, value] of Object.entries(palette.windows)) root.style.setProperty("--configured-ui-window-" + key, value);
      root.style.setProperty("--font-sans", palette.typography.sans); root.style.setProperty("--font-mono", palette.typography.controls);
    }, palettes.MODERN);
    for (const width of [1900, 390]) {
      await page.setViewportSize({ width, height: 1000 });
      for (const name of ["Simulations", "Domain", "Equipment", "Boundaries", "Physics", "Solver", "Review & export"]) {
        await cfdWindow(ui, name);
        assert.ok(await frame(page).locator(".cfx-setup-panel:visible").evaluate(el => el.scrollWidth <= el.clientWidth + 2), `${theme}/${density}/${width}/${name} overflow`);
      }
      await cfdWindow(ui, width > 500 ? "Physics" : "Simulations");
      await capture(page, `modern-${theme}-${density}-${width}`);
    }
    await page.setViewportSize({ width: 1900, height: 1000 });
  }
});

test("Compact reduces shared Floorplan controls and Gantt rows while keeping dependency arrows attached to row centres", async t => {
  const project = cfdProject();
  project.plannerBuild = { activities: [
    { activityId: "first", name: "First fix", startDate: "2026-10-01", endDate: "2026-10-03", colour: "#2563EB", progress: 0, type: "task", status: "not_started", dependencyIds: [], sortOrder: 0 },
    { activityId: "second", name: "Second fix", startDate: "2026-10-05", endDate: "2026-10-06", colour: "#EA580C", progress: 0, type: "task", status: "not_started", dependencyIds: ["first"], sortOrder: 1 },
  ] };
  const session = await harness.session(project); t.after(() => session.close()); const { page } = session;
  const input = page.locator(".floating-toolbar:visible .floating-toolbar-content").getByRole("button", { name: /^New / }).first();
  await input.waitFor(); const comfortable = await input.boundingBox();
  await preferences(page, dialog => button(dialog, "Compact").click());
  assert.ok((await input.boundingBox()).height < comfortable.height);
  await page.getByRole("combobox", { name: "Workspace", exact: true }).selectOption("PLANNERBUILD");
  await page.getByRole("combobox", { name: "PlannerBuild view", exact: true }).selectOption("GANTT");
  const row = page.locator('.pb-gantt-row[data-activity-id="first"]');
  await row.waitFor(); const compactHeight = (await row.boundingBox()).height;
  for (const density of ["Comfortable", "Compact"]) {
    await preferences(page, dialog => button(dialog, density).click());
    await eventually(() => page.locator(".pb-gantt-body").evaluate(body => {
      const bounds = body.getBoundingClientRect(), rows = [...body.querySelectorAll(".pb-gantt-row")].map(el => { const r = el.getBoundingClientRect(); return r.top - bounds.top + r.height / 2; });
      const d = body.querySelector(".pb-dependency-path")?.getAttribute("d") ?? "";
      const values = d.match(/-?[\d.]+/g)?.map(Number) ?? [];
      return { rows, from: values[1], to: values.at(-1) };
    }), value => value.rows.length === 2 && Math.abs(value.from - value.rows[0]) < 1 && Math.abs(value.to - value.rows[1]) < 1);
    if (density === "Comfortable") assert.ok((await row.boundingBox()).height > compactHeight);
  }
  await capture(page, "gantt-compact");
  assert.equal((await session.saved()).plannerBuild.activities[1].dependencyIds[0], "first");
});
