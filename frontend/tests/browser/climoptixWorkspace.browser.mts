import assert from "node:assert/strict";
import test, { before, after } from "node:test";
import { cfdProject } from "../climoptixFixtures";
import { cfdWindow, eventually, startBrowserHarness } from "./harness.mjs";

let harness;
before(async () => {
  harness = await startBrowserHarness();
});
after(async () => {
  await harness?.close();
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
    .getByRole("menuitem", { name: "Hide all windows", exact: true })
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
    assert.equal(
      await selector
        .locator("optgroup[label='Connected air volumes'] option")
        .count(),
      passage ? 1 : 2,
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

test("native floating panels move, resize, overlap and reopen from both menus in light and dark modes", async (t) => {
  const { page, ui } = await open(t);
  const studies = await page
    .getByLabel("Move Studies", { exact: true })
    .boundingBox();
  const domain = await page
    .getByLabel("Move Domain", { exact: true })
    .boundingBox();
  assert.ok(
    domain.x > studies.x + studies.width,
    "Inactive workbench mounting must not stack native windows at the origin",
  );
  await hideAll(page);
  await cfdWindow(ui, "Equipment");
  const panel = ui
    .locator(".floating-toolbar")
    .filter({ has: page.getByLabel("Move Equipment", { exact: true }) });
  const before = await panel.boundingBox(),
    title = await page
      .getByLabel("Move Equipment", { exact: true })
      .boundingBox();
  const workspace = await ui.boundingBox();
  await page.mouse.move(title.x + 90, title.y + 24);
  await page.mouse.down();
  await page.mouse.move(workspace.x + 100, workspace.y + 34, { steps: 8 });
  await page.mouse.up();
  const moved = await panel.boundingBox();
  assert.ok(
    moved.y <= workspace.y + 18,
    `Window should move directly below main menu: ${JSON.stringify(moved)}`,
  );
  assert.ok(moved.x < before.x);
  const edge = await page
    .getByRole("button", {
      name: "Resize Equipment from the right edge",
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
  assert.ok((await panel.boundingBox()).width > moved.width + 80);
  await page
    .getByRole("button", { name: "Hide Equipment", exact: true })
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
    .getByRole("menuitemcheckbox", { name: "Simulation", exact: true })
    .click();
  assert.ok(
    await page.getByLabel("Move Simulation", { exact: true }).isVisible(),
  );
  await page.getByRole("button", { name: "Toolbar", exact: true }).click();
  await page
    .getByRole("menuitemcheckbox", { name: "Convergence monitor", exact: true })
    .click();
  assert.ok(
    await page.getByLabel("Move CFD convergence", { exact: true }).isVisible(),
  );
  assert.ok(
    await page.getByLabel("Move Simulation", { exact: true }).isVisible(),
  );
  await hideAll(page);
  await page.getByRole("button", { name: "Toolbar", exact: true }).click();
  await page.keyboard.press("End");
  await page.keyboard.press("Home");
  await page.keyboard.press("ArrowDown");
  assert.equal(
    await page.evaluate(() => document.activeElement?.getAttribute("role")),
    "menuitemcheckbox",
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
    const simulation = page.getByLabel("Move Simulation", { exact: true });
    const box = await simulation.boundingBox();
    assert.ok(box.x >= 0 && box.x + box.width <= size.width + 1);
    await ui.getByRole("tab", { name: "Run", exact: true }).click();
    assert.ok(
      await ui
        .getByRole("spinbutton", { name: "CPU cores", exact: true })
        .isVisible(),
    );
    if (process.env.BROWSER_ARTIFACTS)
      await page.screenshot({
        path: `${process.env.BROWSER_ARTIFACTS}/cfd-floating-${size.width}.png`,
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
      .getByRole("menuitemcheckbox", { name: "Domain", exact: true })
      .isDisabled(),
  );
  await page.keyboard.press("Escape");
  await cfdWindow(ui, "Studies");
  await ui
    .getByRole("button", { name: "Create first study", exact: true })
    .click();
  assert.ok(await page.getByLabel("Move Domain", { exact: true }).isVisible());
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
    .getByText("Geometry service temporarily unavailable", { exact: true })
    .waitFor();
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
