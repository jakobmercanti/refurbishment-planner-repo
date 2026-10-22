import assert from "node:assert/strict";
import test, { before, after } from "node:test";
import { cfdProject } from "../climoptixFixtures";
import { duplicateCFDScenario } from "../../lib/climoptixDocument";
import { cfdWindow, eventually, startBrowserHarness } from "./harness.mjs";

let harness;
before(async () => {
  harness = await startBrowserHarness();
});
after(async () => {
  await harness?.close();
});

test("building is immediately rendered from the shared project even when geometry returns 404", async (t) => {
  const session = await harness.session(cfdProject());
  t.after(() => session.close());
  await session.context.route("**/climoptix/geometry", (route) =>
    route.fulfill({
      status: 404,
      contentType: "application/json",
      body: '{"detail":"Not Found"}',
    }),
  );
  await session.page
    .getByRole("combobox", { name: "Workspace", exact: true })
    .selectOption("CLIMOPTIX");
  const ui = session.page.getByRole("region", {
    name: "Climoptix CFD workspace",
    exact: true,
  });
  await ui.locator("canvas").waitFor();
  await ui
    .getByText(
      "Building shown from your project · connectivity service unavailable",
      { exact: true },
    )
    .waitFor();
  assert.equal(
    await ui.locator(".cfx-viewport").getAttribute("data-geometry-source"),
    "project-display",
  );
  const selector = ui.getByRole("combobox", {
    name: "CFD view scope",
    exact: true,
  });
  assert.equal(
    await selector
      .locator("optgroup[label='Connected air volumes'] option")
      .count(),
    0,
    "An offline display must never invent validated air volumes",
  );
  await selector.selectOption({ label: "Ground Floor · Living room" });
  assert.equal(
    await ui.locator(".cfx-viewport").getAttribute("data-visible-rooms"),
    "room-0",
  );
  await selector.selectOption("building");
  await hideAll(session.page);
  if (process.env.BROWSER_ARTIFACTS)
    await session.page.screenshot({
      path: `${process.env.BROWSER_ARTIFACTS}/cfd-immediate-building-404.png`,
    });
});

test("simulation groups persist drag order, selected settings and batch selection without inventing worker jobs", async (t) => {
  const project = cfdProject(),
    first = project.cfdScenarios![0];
  first.name = "Summer baseline";
  first.group = "Summer";
  const second = duplicateCFDScenario(first),
    third = duplicateCFDScenario(first);
  second.name = "Summer high flow";
  third.name = "Winter baseline";
  third.group = "Winter";
  second.mesh.baseCellMm = 300;
  project.cfdScenarios = [first, second, third];
  const { ui, page, saved } = await open(t, project);
  const originalRooms = JSON.stringify((await saved()).rooms);
  await ui
    .getByRole("checkbox", { name: "Queue Summer baseline", exact: true })
    .check();
  await ui
    .getByRole("checkbox", { name: "Queue Winter baseline", exact: true })
    .check();
  const batch = ui.getByLabel("Simulation submissions", { exact: true });
  assert.match(await batch.innerText(), /2 selected/);
  assert.ok(
    await batch.getByRole("button", { name: "Mesh", exact: true }).isDisabled(),
  );
  assert.ok(
    await batch.getByRole("button", { name: "Run", exact: true }).isDisabled(),
  );
  assert.equal(
    await ui
      .getByRole("progressbar", {
        name: "Summer baseline phase progress",
        exact: true,
      })
      .getAttribute("aria-valuenow"),
    null,
  );
  await ui
    .getByRole("button", { name: "Reorder Summer high flow", exact: true })
    .press("ArrowUp");
  await eventually(saved, (p) => p.cfdScenarios?.[0].id === second.id);
  const summer = ui.getByRole("list", {
    name: "Summer simulations",
    exact: true,
  });
  const winter = ui.getByRole("list", {
    name: "Winter simulations",
    exact: true,
  });
  const target = winter.locator("[data-item-id]").first();
  await summer
    .getByRole("button", { name: "Reorder Summer baseline", exact: true })
    .dragTo(target, { targetPosition: { x: 40, y: 5 } });
  await eventually(
    saved,
    (p) => p.cfdScenarios?.find((s) => s.id === first.id)?.group === "Winter",
  );
  await ui
    .getByRole("button", { name: "Select Summer high flow", exact: true })
    .click();
  await cfdWindow(ui, "Simulation");
  assert.equal(
    await ui
      .getByRole("spinbutton", { name: "Base Cell (mm)", exact: true })
      .inputValue(),
    "300",
  );
  await ui
    .getByRole("combobox", { name: "CFD scenario", exact: true })
    .selectOption(first.id);
  assert.equal(
    await ui
      .getByRole("spinbutton", { name: "Base Cell (mm)", exact: true })
      .inputValue(),
    "200",
  );
  await cfdWindow(ui, "Studies");
  await ui
    .getByRole("textbox", { name: "Simulation group", exact: true })
    .fill("Autumn");
  await eventually(saved, (p) =>
    p.cfdScenarios?.some((s) => s.id === first.id && s.group === "Autumn"),
  );
  await ui
    .getByRole("button", { name: "Delete Winter baseline", exact: true })
    .click();
  await page
    .getByRole("dialog", { name: "Delete CFD scenario", exact: true })
    .getByRole("button", { name: "Delete study", exact: true })
    .click();
  await eventually(saved, (p) => p.cfdScenarios?.length === 2);
  assert.equal(
    await ui
      .getByRole("combobox", { name: "CFD scenario", exact: true })
      .inputValue(),
    first.id,
    "Deleting a different row must not change the active simulation",
  );
  await page.reload();
  await page
    .getByRole("combobox", { name: "Workspace", exact: true })
    .selectOption("CLIMOPTIX");
  await ui
    .getByRole("region", { name: "Simulation group Autumn", exact: true })
    .waitFor();
  assert.equal(JSON.stringify((await saved()).rooms), originalRooms);
  assert.equal(await ui.locator(".floating-toolbar").count(), 1);
});

test("refinements have independent floating editors and layer-style keyboard and drag reordering", async (t) => {
  const { ui, saved } = await open(t);
  await cfdWindow(ui, "Simulation");
  for (let i = 1; i <= 3; i++) {
    await ui
      .getByRole("button", { name: "Add refinement region", exact: true })
      .click();
    const editor = ui.getByRole("region", {
      name: "Refinement editor",
      exact: true,
    });
    await editor
      .getByRole("textbox", { name: "Refinement name", exact: true })
      .fill(`Zone ${i}`);
    await editor
      .getByRole("combobox", { name: "Refinement level", exact: true })
      .selectOption(String(i + 1));
    await editor.getByRole("button", { name: "Done", exact: true }).click();
  }
  assert.equal(
    await ui.getByRole("button", { name: /Move Zone .* up/ }).count(),
    0,
  );
  await ui
    .getByRole("button", { name: "Reorder Zone 3", exact: true })
    .press("ArrowUp");
  await eventually(
    saved,
    (p) =>
      p.cfdScenarios?.[0].mesh.refinements.map((r) => r.name).join() ===
      "Zone 1,Zone 3,Zone 2",
  );
  const list = ui.getByRole("list", {
    name: "Refinement regions",
    exact: true,
  });
  await list
    .getByRole("button", { name: "Reorder Zone 2", exact: true })
    .dragTo(list.locator("[data-item-id]").first(), {
      targetPosition: { x: 40, y: 5 },
    });
  await eventually(
    saved,
    (p) => p.cfdScenarios?.[0].mesh.refinements[0].name === "Zone 2",
  );
  await ui.getByRole("button", { name: "Edit Zone 2", exact: true }).click();
  const editor = ui.getByRole("region", {
    name: "Refinement editor",
    exact: true,
  });
  const size = editor.getByRole("spinbutton", {
    name: "Refinement size X (mm)",
    exact: true,
  });
  await size.fill("1700");
  await size.press("Enter");
  await editor.getByRole("button", { name: "Done", exact: true }).click();
  const project = await eventually(
    saved,
    (p) => p.cfdScenarios?.[0].mesh.refinements[0].sizeMm[0] === 1700,
  );
  assert.equal(project.cfdScenarios[0].mesh.refinements[1].sizeMm[0], 1000);
  await ui
    .getByRole("button", { name: "Duplicate Zone 2", exact: true })
    .click();
  await ui
    .getByRole("button", { name: "Delete Zone 2 copy", exact: true })
    .click();
  assert.equal(await ui.locator(".cfx-refinement-row").count(), 3);
  assert.equal(await ui.locator(".floating-toolbar").count(), 1);
});

async function open(t, project = cfdProject()) {
  const s = await harness.session(project);
  t.after(() => s.close());
  await s.page
    .getByRole("combobox", { name: "Workspace", exact: true })
    .selectOption("CLIMOPTIX");
  const ui = s.page.getByRole("region", {
    name: "Climoptix CFD workspace",
    exact: true,
  });
  await ui.locator("canvas").waitFor();
  return { ...s, ui };
}
async function hideAll(page) {
  await page.getByRole("button", { name: "Toolbar", exact: true }).click();
  await page
    .getByRole("menuitem", { name: "Hide setup window", exact: true })
    .click();
}

for (const passage of [true, false])
  test(`3D-only full workspace browses ${passage ? "a permanent passage volume" : "door-separated air volumes"} without editing the study`, async (t) => {
    const { page, ui, saved } = await open(t, cfdProject(passage));
    const before = JSON.stringify((await saved()).cfdScenarios);
    const selector = ui.getByRole("combobox", {
      name: "CFD view scope",
      exact: true,
    });
    assert.equal(
      await page.getByRole("group", { name: "Climoptix view" }).count(),
      0,
    );
    assert.equal(
      await ui.locator("svg[aria-label='CFD room plan']").count(),
      0,
    );
    await eventually(
      () =>
        selector
          .locator("optgroup[label='Connected air volumes'] option")
          .count(),
      (n) => n === (passage ? 1 : 2),
    );
    await selector.selectOption({ label: "Ground Floor · Living room" });
    assert.equal(
      await ui.locator(".cfx-viewport").getAttribute("data-visible-rooms"),
      "room-0",
    );
    await selector.selectOption(
      await selector
        .locator("optgroup[label='Connected air volumes'] option")
        .first()
        .getAttribute("value"),
    );
    assert.equal(
      (
        await ui.locator(".cfx-viewport").getAttribute("data-visible-rooms")
      ).split(",").length,
      passage ? 2 : 1,
    );
    await selector.selectOption("building");
    await hideAll(page);
    const workspace = await ui.boundingBox(),
      canvas = await ui.locator("canvas").boundingBox();
    assert.ok(
      Math.abs(workspace.width - canvas.width) < 2 &&
        Math.abs(workspace.height - canvas.height) < 2,
    );
    assert.equal(JSON.stringify((await saved()).cfdScenarios), before);
    if (process.env.BROWSER_ARTIFACTS)
      await page.screenshot({
        path: `${process.env.BROWSER_ARTIFACTS}/cfd-full-3d-${passage}.png`,
      });
  });

test("one native setup window contains equal-width tabs, moves and resizes, and reopens from both menus in light and dark modes", async (t) => {
  const { page, ui } = await open(t);
  const panel = ui.locator(".cfx-setup-window");
  assert.equal(await ui.locator(".floating-toolbar").count(), 1);
  await cfdWindow(ui, "Equipment");
  assert.equal(
    await ui
      .getByRole("tab", { name: "Objects", exact: true })
      .getAttribute("aria-selected"),
    "true",
  );
  const tabs = ui
    .getByRole("tablist", { name: "Climoptix setup" })
    .getByRole("tab");
  const widths = await tabs.evaluateAll((nodes) =>
    nodes.map((n) => n.getBoundingClientRect().width),
  );
  assert.ok(Math.max(...widths) - Math.min(...widths) < 1);
  const before = await panel.boundingBox();
  const title = await ui
    .getByLabel("Move Simulation setup", { exact: true })
    .boundingBox();
  const workspace = await ui.boundingBox();
  await page.mouse.move(title.x + 90, title.y + 24);
  await page.mouse.down();
  await page.mouse.move(workspace.x + 180, workspace.y + 34, { steps: 8 });
  await page.mouse.up();
  const moved = await panel.boundingBox();
  assert.ok(moved.y <= workspace.y + 18, JSON.stringify(moved));
  assert.ok(Math.abs(moved.x - before.x) > 5);
  const edge = await ui
    .getByRole("button", {
      name: "Resize Simulation setup from the right edge",
      exact: true,
    })
    .boundingBox();
  await page.mouse.move(edge.x + edge.width / 2, edge.y + edge.height / 2);
  await page.mouse.down();
  await page.mouse.move(
    edge.x + edge.width / 2 + 120,
    edge.y + edge.height / 2,
    { steps: 6 },
  );
  await page.mouse.up();
  assert.ok((await panel.boundingBox()).width > moved.width + 70);
  await ui
    .getByRole("button", { name: "Hide Simulation setup", exact: true })
    .click();
  const canvas = await ui.locator("canvas").boundingBox();
  await page.mouse.click(
    canvas.x + canvas.width - 30,
    canvas.y + canvas.height / 2,
    { button: "right" },
  );
  const context = page.getByRole("menu", {
    name: "Climoptix windows",
    exact: true,
  });
  await context
    .getByRole("menuitem", { name: "Simulation", exact: true })
    .click();
  assert.ok(await panel.isVisible());
  await cfdWindow(ui, "Convergence monitor");
  assert.equal(
    await ui
      .getByRole("tab", { name: "Monitor", exact: true })
      .getAttribute("aria-selected"),
    "true",
  );
  assert.equal(await ui.locator(".floating-toolbar").count(), 1);
  await hideAll(page);
  await page.getByRole("button", { name: "Toolbar", exact: true }).click();
  await page.keyboard.press("End");
  await page.keyboard.press("Home");
  await page.keyboard.press("ArrowDown");
  assert.equal(
    await page.evaluate(() => document.activeElement?.getAttribute("role")),
    "menuitem",
  );
  await page.keyboard.press("Escape");
  assert.equal(await context.count(), 0);
  await page.emulateMedia({ colorScheme: "dark" });
  await eventually(
    () => page.locator("html").getAttribute("data-theme"),
    (v) => v === "dark",
  );
  for (const size of [
    { width: 1440, height: 1000 },
    { width: 390, height: 844 },
  ]) {
    await page.setViewportSize(size);
    await cfdWindow(ui, "Simulation");
    const box = await panel.boundingBox();
    assert.ok(box.x >= 0 && box.x + box.width <= size.width + 1);
    await ui.getByRole("tab", { name: "Run", exact: true }).click();
    const cpu = ui.getByRole("spinbutton", { name: "CPU cores", exact: true });
    await cpu.scrollIntoViewIfNeeded();
    const cpuBox = await cpu.boundingBox();
    assert.ok(
      cpuBox.y >= 0 && cpuBox.y + cpuBox.height <= size.height,
      "The selected tab must have usable scrolling space",
    );
    assert.ok(
      (await ui.locator(".cfx-setup-panel:not([hidden])").boundingBox())
        .height > 200,
    );
    assert.equal(
      await panel.evaluate((n) => n.scrollWidth > n.clientWidth + 1),
      false,
    );
    const widths = await tabs.evaluateAll((nodes) =>
      nodes.map((n) => n.getBoundingClientRect().width),
    );
    assert.ok(Math.max(...widths) - Math.min(...widths) < 1);
    if (process.env.BROWSER_ARTIFACTS)
      await page.screenshot({
        path: `${process.env.BROWSER_ARTIFACTS}/cfd-tabbed-${size.width}.png`,
      });
    await hideAll(page);
  }
});

test("the building remains visible before the first study, and geometry failure is recoverable", async (t) => {
  const project = cfdProject();
  project.cfdScenarios = [];
  const { page, context, ui } = await open(t, project);
  assert.ok(
    await ui
      .getByRole("button", { name: "Create first study", exact: true })
      .isVisible(),
  );
  await hideAll(page);
  await page.getByRole("button", { name: "Toolbar", exact: true }).click();
  assert.ok(
    await page
      .getByRole("menuitem", { name: "Domain", exact: true })
      .isDisabled(),
  );
  await page.keyboard.press("Escape");
  await cfdWindow(ui, "Studies");
  await ui
    .getByRole("button", { name: "Create first study", exact: true })
    .click();
  assert.ok(
    await page.getByLabel("Move Simulation setup", { exact: true }).isVisible(),
  );
  await context.route("**/climoptix/geometry", (route) =>
    route.fulfill({
      status: 503,
      contentType: "application/json",
      body: JSON.stringify({
        detail: "Geometry service temporarily unavailable",
      }),
    }),
  );
  await page
    .getByRole("combobox", { name: "Workspace", exact: true })
    .selectOption("FLOORPLAN");
  await page
    .getByRole("combobox", { name: "Workspace", exact: true })
    .selectOption("CLIMOPTIX");
  await ui
    .getByText(
      "Building shown from your project · connectivity service unavailable",
      { exact: true },
    )
    .waitFor();
  assert.ok(await ui.locator("canvas").isVisible());
  assert.equal(
    await ui.locator(".cfx-viewport").getAttribute("data-geometry-source"),
    "project-display",
  );
  assert.equal(
    await ui.getByText("Building preview unavailable", { exact: true }).count(),
    0,
  );
  await context.unroute("**/climoptix/geometry");
  // Restore the same real geometry route supplied by the harness.
  const { realScene } = await import("../climoptixFixtures");
  await context.route("**/climoptix/geometry", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(realScene(route.request().postDataJSON().project)),
    }),
  );
  await hideAll(page);
  await ui.getByRole("button", { name: "Retry geometry", exact: true }).click();
  await ui.locator("canvas").waitFor();
});
