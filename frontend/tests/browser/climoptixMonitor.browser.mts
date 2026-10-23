import { cfdWindow } from "./harness.mjs";
import assert from "node:assert/strict";
import test, { before, after } from "node:test";
import { cfdProject, realPreparation } from "../climoptixFixtures";
import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { duplicateCFDScenario } from "../../lib/climoptixDocument";
import { eventually, startBrowserHarness } from "./harness.mjs";

let harness;
before(async () => {
  harness = await startBrowserHarness();
});
after(async () => {
  await harness?.close();
});

async function setup(t, project = cfdProject()) {
  const session = await harness.session(project);
  t.after(() => session.close());
  await session.context.route("**/climoptix/prepare", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(realPreparation(route.request().postDataJSON())),
    }),
  );
  const { page } = session;
  await page
    .getByRole("combobox", { name: "Workspace", exact: true })
    .selectOption("CLIMOPTIX");
  const ui = page.getByRole("region", {
    name: "Climoptix CFD workspace",
    exact: true,
  });
  return { ...session, ui };
}

const solverLog = {
  name: "convergence.log",
  mimeType: "text/plain",
  buffer: Buffer.from(
    "Time = 1\nsmoothSolver: Solving for Ux, Initial residual = 0.2, Final residual = 0.001\nGAMG: Solving for p, Initial residual = 0.1, Final residual = 0.0001\nTime = 2\nsmoothSolver: Solving for Ux, Initial residual = 0.02, Final residual = 0.0001",
  ),
};

test("convergence history survives changing phases and its guidance is available through contextual help", async (t) => {
  const { page, ui } = await setup(t);
  await cfdWindow(ui, "Simulation");
  await ui.getByRole("tab", { name: "Run", exact: true }).click();
  await ui
    .getByLabel("Import solver log", { exact: true })
    .setInputFiles(solverLog);
  await ui
    .getByRole("img", { name: "Residual graph for Ux, p", exact: true })
    .waitFor();
  await cfdWindow(ui, "Domain");
  await cfdWindow(ui, "Simulation");
  assert.equal(
    await ui
      .getByRole("img", { name: "Residual graph for Ux, p", exact: true })
      .count(),
    1,
    "Leaving the phase must not throw away the imported history",
  );
  await cfdWindow(ui, "Domain");
  await cfdWindow(ui, "Studies");
  await ui.getByRole("button", { name: "Convergence", exact: true }).click();
  const monitor = page.getByRole("region", {
    name: "Convergence monitor",
    exact: true,
  });
  await monitor
    .getByRole("img", { name: "Residual graph for Ux, p", exact: true })
    .waitFor();
  assert.match(
    await monitor.innerText(),
    /External log · unverified · session only/,
  );
  await ui
    .getByRole("button", { name: "Help for Climoptix CFD", exact: true })
    .click();
  const help = page.getByRole("article", {
    name: "Help for Climoptix CFD",
    exact: true,
  });
  assert.match(await help.innerText(), /not live or verified results/);
  assert.match(await help.innerText(), /session-only/);
  await page.keyboard.press("Escape");
  await page
    .getByRole("button", { name: "Hide Simulation setup", exact: true })
    .click();
  await cfdWindow(ui, "Studies");
  await ui.getByRole("button", { name: "Convergence", exact: true }).click();
  await monitor
    .getByRole("img", { name: "Residual graph for Ux, p", exact: true })
    .waitFor();
  await page
    .getByRole("button", { name: "Hide Simulation setup", exact: true })
    .press("Escape");
  assert.equal(await monitor.isVisible(), false);
  await cfdWindow(ui, "Studies");
});

test("3D refinements use distinct level colours, a matching legend and a working visibility shortcut", async (t) => {
  const { page, ui, saved } = await setup(t);
  await ui
    .getByRole("button", { name: "Validate & refresh", exact: true })
    .click();
  await eventually(
    () => ui.locator(".cfx-state").innerText(),
    (value) => value === "Validated",
  );
  await cfdWindow(ui, "Simulation");
  const editNumber = async (name, value) => {
    const input = ui.getByRole("spinbutton", { name, exact: true });
    await input.fill(String(value));
    await input.press("Enter");
  };
  await ui
    .getByRole("button", { name: "Add refinement region", exact: true })
    .click();
  await ui
    .getByRole("textbox", { name: "Refinement name", exact: true })
    .fill("Low level");
  await editNumber("Refinement centre X (mm)", 1600);
  await ui.getByRole("button", { name: "Done", exact: true }).click();
  await ui
    .getByRole("button", { name: "Add refinement region", exact: true })
    .click();
  await ui
    .getByRole("textbox", { name: "Refinement name", exact: true })
    .fill("High level");
  await editNumber("Refinement centre X (mm)", 3200);
  await ui
    .getByRole("combobox", { name: "Refinement level", exact: true })
    .selectOption("5");
  await ui.getByRole("button", { name: "Done", exact: true }).click();
  await ui
    .getByRole("button", { name: "View refinements in 3D", exact: true })
    .click();

  const viewer = ui.getByRole("region", {
    name: "Climoptix geometry viewer",
    exact: true,
  });
  const canvas = viewer.locator("canvas");
  await canvas.waitFor();
  await viewer.getByRole("button", { name: "Fit", exact: true }).click();
  const legend = viewer.getByRole("list", {
    name: "Refinement colour legend",
    exact: true,
  });
  assert.match(await legend.innerText(), /Level 2 · 50 mm/);
  assert.match(await legend.innerText(), /Level 5 · 6.25 mm/);
  const names = await legend
    .locator("i")
    .evaluateAll((elements) =>
      elements.map((e) => getComputedStyle(e).backgroundColor),
    );
  assert.equal(new Set(names).size, 2);
  await cfdWindow(ui, "Simulation");
  assert.deepEqual(
    names,
    await ui
      .locator(".cfx-level-swatch")
      .evaluateAll((elements) =>
        elements.map((e) => getComputedStyle(e).backgroundColor),
      ),
  );
  const pixelCounts = async () => {
    const canvasBounds = await canvas.boundingBox();
    const obscured = await ui
      .locator(
        ".floating-toolbar, .cfx-view-selector, .cfx-stale, .cfx-setup-footer, .cfx-viewer > footer",
      )
      .evaluateAll(
        (items, bounds) =>
          items.map((el) => {
            const b = el.getBoundingClientRect();
            return [b.x - bounds.x, b.y - bounds.y, b.width, b.height];
          }),
        canvasBounds,
      );
    const root = fileURLToPath(new URL("../../../", import.meta.url));
    const result = spawnSync(
      path.join(
        root,
        ".venv",
        process.platform === "win32" ? "Scripts/python.exe" : "bin/python",
      ),
      [
        "-c",
        "import io,sys,json; from PIL import Image; im=Image.open(io.BytesIO(sys.stdin.buffer.read())).convert('RGB'); masks=json.loads(sys.argv[1]); p=[im.getpixel((x,y)) for y in range(im.height) for x in range(im.width) if not any(a<=x<=a+w and b<=y<=b+h for a,b,w,h in masks)]; print(json.dumps([sum(g>120 and abs(g-b)<15 and r<g*.5 for r,g,b in p),sum(r>180 and 70<g<165 and b<80 for r,g,b in p)]))",
        JSON.stringify(obscured),
      ],
      { input: await canvas.screenshot(), encoding: "utf8", timeout: 15000 },
    );
    assert.equal(result.status, 0, result.stderr);
    return JSON.parse(result.stdout);
  };
  // A full-size canvas lies under the tools. Clear the centre before inspecting
  // wireframe pixels, then keep only the right-hand view controls open.
  await page.getByRole("button", { name: "Toolbar", exact: true }).click();
  await page
    .getByRole("menuitem", { name: "Hide setup window", exact: true })
    .click();
  await cfdWindow(ui, "View properties");
  const window = ui.locator(".cfx-setup-window");
  const box = await window.boundingBox();
  const edge = await window
    .locator(".floating-toolbar-resize-right")
    .boundingBox();
  await page.mouse.move(edge.x + 2, edge.y + edge.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + 320, edge.y + edge.height / 2, { steps: 10 });
  await page.mouse.up();
  const visible = await eventually(
    pixelCounts,
    (values) => values.every((value) => value > 10),
    "Both refinement colours must be rendered in the actual 3D canvas",
  );
  await eventually(
    saved,
    (p) => p.cfdScenarios[0].mesh.refinements.length === 2,
  );
  const before = JSON.stringify((await saved()).cfdScenarios[0]);
  await ui
    .getByRole("checkbox", { name: "Refinement intent", exact: true })
    .uncheck();
  const hidden = await pixelCounts();
  assert.ok(
    hidden.every((count, i) => count < visible[i] / 2),
    `${visible} -> ${hidden}`,
  );
  assert.equal(await legend.count(), 0);
  await cfdWindow(ui, "Simulation");
  await ui
    .getByRole("button", { name: "View refinements in 3D", exact: true })
    .click();
  await cfdWindow(ui, "View properties");
  assert.equal(
    await ui
      .getByRole("checkbox", { name: "Refinement intent", exact: true })
      .isChecked(),
    true,
  );
  await legend.waitFor();
  assert.equal(
    JSON.stringify((await saved()).cfdScenarios[0]),
    before,
    "View-only controls must not change the mesh recipe",
  );
  if (process.env.BROWSER_ARTIFACTS)
    await page.screenshot({
      path: `${process.env.BROWSER_ARTIFACTS}/cfd-refinement-levels.png`,
    });
});

test("the convergence window keeps study histories separate and supports shared help, dragging, resizing and mobile dark mode", async (t) => {
  const project = cfdProject();
  const copy = duplicateCFDScenario(project.cfdScenarios![0]);
  copy.name = "Other study";
  project.cfdScenarios!.push(copy);
  const { page, ui } = await setup(t, project);
  await cfdWindow(ui, "Studies");
  await ui.getByRole("button", { name: "Convergence", exact: true }).click();
  const monitor = ui.getByRole("region", {
    name: "Convergence monitor",
    exact: true,
  });
  const window = ui.locator(".cfx-setup-window");
  await monitor
    .getByLabel("Import solver log", { exact: true })
    .setInputFiles(solverLog);
  const graph = monitor.getByRole("img", {
    name: "Residual graph for Ux, p",
    exact: true,
  });
  await graph.waitFor();
  assert.equal(
    await graph.locator("circle").count(),
    2,
    "A field with just one residual must remain visible as a point",
  );
  const chooser = ui.getByRole("combobox", {
    name: "CFD scenario",
    exact: true,
  });
  await chooser.selectOption(copy.id);
  assert.equal(await graph.count(), 0);
  assert.match(await monitor.innerText(), /Other study/);
  await chooser.selectOption(project.cfdScenarios![0].id);
  await graph.waitFor();
  const original = await window.boundingBox();
  const title = window.locator(".floating-toolbar-titlebar");
  const header = await title.boundingBox();
  await page.mouse.move(header.x + 150, header.y + 22);
  await page.mouse.down();
  await page.mouse.move(header.x + 250, header.y + 62, { steps: 5 });
  await page.mouse.up();
  const moved = await window.boundingBox();
  assert.ok(moved.x > original.x + 50 && moved.y > original.y + 20);
  const right = await window
    .getByRole("button", {
      name: "Resize Simulation setup from the right edge",
      exact: true,
    })
    .boundingBox();
  await page.mouse.move(right.x + right.width / 2, right.y + right.height / 2);
  await page.mouse.down();
  await page.mouse.move(
    right.x + right.width / 2 + 90,
    right.y + right.height / 2,
    { steps: 5 },
  );
  await page.mouse.up();
  assert.ok((await window.boundingBox()).width > moved.width + 50);
  assert.ok(
    (
      await window
        .getByRole("button", {
          name: "Resize Simulation setup from the top edge",
          exact: true,
        })
        .boundingBox()
    ).height <= 14,
    "Shared resize handles must not inherit content-button height",
  );
  await window
    .getByRole("button", { name: "Help for Climoptix CFD", exact: true })
    .click();
  const help = page.getByRole("article", {
    name: "Help for Climoptix CFD",
    exact: true,
  });
  await help
    .getByRole("heading", {
      name: "No simulated results",
      exact: true,
    })
    .waitFor();
  await page.keyboard.press("Escape");
  assert.equal(await monitor.isVisible(), true);
  await page.emulateMedia({ colorScheme: "dark" });
  await eventually(
    () => page.locator("html").getAttribute("data-theme"),
    (value) => value === "dark",
  );
  await page.setViewportSize({ width: 390, height: 844 });
  await eventually(
    () => window.boundingBox(),
    (box) => box.x >= 0 && box.x + box.width <= 391,
  );
  await eventually(
    () => window.boundingBox(),
    (box) => box.y < 180 && box.height > 500,
    "The mobile convergence monitor must have enough room for its chart",
  );
  await graph.scrollIntoViewIfNeeded();
  const graphBox = await graph.boundingBox();
  assert.ok(graphBox.y >= 0 && graphBox.y + graphBox.height <= 845);
  const overflow = await window
    .locator(".floating-toolbar-content")
    .evaluate((element) => element.scrollWidth > element.clientWidth + 1);
  assert.equal(overflow, false);
  if (process.env.BROWSER_ARTIFACTS)
    await page.screenshot({
      path: `${process.env.BROWSER_ARTIFACTS}/cfd-convergence-mobile-dark.png`,
    });
  const themes = JSON.parse(
    await readFile(
      new URL("../../../data/ui_theme_defaults.json", import.meta.url),
      "utf8",
    ),
  ).themes;
  for (const style of ["DEFAULT", "MODERN"]) {
    await page.evaluate(
      ({ style, theme }) => {
        document.body.dataset.uiStyle = style.toLowerCase();
        const root = document.documentElement;
        for (const [name, value] of Object.entries(theme.colours))
          root.style.setProperty(`--configured-${name}`, value as string);
        for (const [name, value] of Object.entries(theme.buttons))
          root.style.setProperty(
            `--configured-ui-button-${name}`,
            value as string,
          );
        for (const [name, value] of Object.entries(theme.windows))
          root.style.setProperty(
            `--configured-ui-window-${name}`,
            value as string,
          );
        root.style.setProperty("--font-sans", theme.typography.sans);
        root.style.setProperty("--font-mono", theme.typography.controls);
      },
      { style, theme: themes[style] },
    );
    for (const theme of ["light", "dark"] as const) {
      await page.emulateMedia({ colorScheme: theme });
      await eventually(
        () => page.locator("html").getAttribute("data-theme"),
        (value) => value === theme,
      );
      for (const width of [1440, 390]) {
        await page.setViewportSize({
          width,
          height: width === 390 ? 844 : 1000,
        });
        await graph.scrollIntoViewIfNeeded();
        const bounds = await window.boundingBox();
        assert.ok(bounds.x >= 0 && bounds.x + bounds.width <= width + 1);
        assert.equal(
          await window
            .locator(".floating-toolbar-content")
            .evaluate(
              (element) => element.scrollWidth > element.clientWidth + 1,
            ),
          false,
        );
        if (process.env.BROWSER_ARTIFACTS)
          await page.screenshot({
            path: `${process.env.BROWSER_ARTIFACTS}/cfd-monitor-${style.toLowerCase()}-${theme}-${width}.png`,
          });
      }
    }
  }
});

test("convergence reads are study-scoped, cancellable before completion and bounded to three session histories", async (t) => {
  const project = cfdProject();
  const first = project.cfdScenarios![0];
  project.cfdScenarios = [
    first,
    ...Array.from({ length: 3 }, (_, i) => ({
      ...duplicateCFDScenario(first),
      name: `Study ${i + 2}`,
    })),
  ];
  project.cfdScenarios.forEach((study, i) => {
    study.id = ["900", "8", "100", "1"][i];
  });
  const { page, ui, saved } = await setup(t, project);
  await cfdWindow(ui, "Studies");
  await ui.getByRole("button", { name: "Convergence", exact: true }).click();
  const monitor = ui.getByRole("region", {
    name: "Convergence monitor",
    exact: true,
  });
  const input = monitor.getByLabel("Import solver log", { exact: true });
  const chooser = ui.getByRole("combobox", {
    name: "CFD scenario",
    exact: true,
  });
  const source = JSON.stringify((await saved()).cfdScenarios);
  await page.evaluate(() => {
    const original = File.prototype.text;
    File.prototype.text = function () {
      if (this.name !== "held.log") return original.call(this);
      return new Promise<string>((resolve) => {
        window.__releaseMonitorLog = () =>
          resolve(
            "Time = 1\nSolving for Uheld, Initial residual = 0.2, Final residual = 0.001",
          );
      });
    };
  });
  const held = {
    name: "held.log",
    mimeType: "text/plain",
    buffer: Buffer.from("delayed"),
  };
  await input.setInputFiles(held);
  await page.waitForFunction(
    () => typeof window.__releaseMonitorLog === "function",
  );
  await monitor.getByRole("button", { name: "Clear log", exact: true }).click();
  await page.evaluate(() => window.__releaseMonitorLog());
  assert.equal(
    await monitor.getByRole("img", { name: /Residual graph/ }).count(),
    0,
  );
  await input.setInputFiles(held);
  await chooser.selectOption(project.cfdScenarios[1].id);
  await input.setInputFiles(solverLog);
  await monitor
    .getByRole("img", { name: "Residual graph for Ux, p", exact: true })
    .waitFor();
  await page.evaluate(() => window.__releaseMonitorLog());
  await chooser.selectOption(first.id);
  await monitor
    .getByRole("img", { name: "Residual graph for Uheld", exact: true })
    .waitFor();
  for (const study of project.cfdScenarios.slice(2)) {
    await chooser.selectOption(study.id);
    await input.setInputFiles(solverLog);
    await monitor
      .getByRole("img", { name: "Residual graph for Ux, p", exact: true })
      .waitFor();
  }
  await chooser.selectOption(first.id);
  assert.equal(
    await monitor
      .getByRole("img", { name: "Residual graph for Uheld", exact: true })
      .count(),
    0,
  );
  assert.equal(
    JSON.stringify((await saved()).cfdScenarios),
    source,
    "External histories must not mark a study as run or mutate project data",
  );
  await page
    .getByRole("button", { name: "Hide Simulation setup", exact: true })
    .click();
  await cfdWindow(ui, "Studies");
  await chooser.selectOption(project.cfdScenarios[3].id);
  await ui.getByRole("button", { name: "Convergence", exact: true }).click();
  await monitor
    .getByRole("img", { name: "Residual graph for Ux, p", exact: true })
    .waitFor();
});

test("repeated refinement copies have distinct names and independent dimensions", async (t) => {
  const { ui, saved } = await setup(t);
  await cfdWindow(ui, "Simulation");
  await ui
    .getByRole("button", { name: "Add refinement region", exact: true })
    .click();
  await ui
    .getByRole("textbox", { name: "Refinement name", exact: true })
    .fill("Occupied zone");
  await ui.getByRole("button", { name: "Done", exact: true }).click();
  await ui
    .getByRole("button", { name: "Duplicate Occupied zone", exact: true })
    .click();
  await ui
    .getByRole("button", { name: "Duplicate Occupied zone", exact: true })
    .click();
  const project = await eventually(
    saved,
    (p) => p.cfdScenarios[0].mesh.refinements.length === 3,
  );
  assert.deepEqual(
    project.cfdScenarios[0].mesh.refinements.map((r) => r.name),
    ["Occupied zone", "Occupied zone copy", "Occupied zone copy 2"],
  );
  const size = ui.getByRole("spinbutton", {
    name: "Refinement size X (mm)",
    exact: true,
  });
  await ui
    .getByRole("button", { name: "Edit Occupied zone copy 2", exact: true })
    .click();
  await size.fill("1600");
  await size.press("Enter");
  const edited = await eventually(
    saved,
    (p) => p.cfdScenarios[0].mesh.refinements[2].sizeMm[0] === 1600,
  );
  assert.equal(edited.cfdScenarios[0].mesh.refinements[0].sizeMm[0], 1000);
  await ui.getByRole("button", { name: "Done", exact: true }).click();
  await ui
    .getByRole("button", { name: "Delete Occupied zone copy 2", exact: true })
    .click();
  assert.equal(await ui.locator(".cfx-refinement-row").count(), 2);
  await ui
    .getByRole("button", { name: "Edit Occupied zone copy", exact: true })
    .click();
  assert.equal(
    await ui
      .getByRole("textbox", { name: "Refinement name", exact: true })
      .inputValue(),
    "Occupied zone copy",
  );
  await ui.getByRole("button", { name: "Done", exact: true }).click();
  await cfdWindow(ui, "Studies");
  await ui.getByRole("button", { name: "Undo", exact: true }).click();
  await cfdWindow(ui, "Simulation");
  assert.equal(await ui.locator(".cfx-refinement-row").count(), 3);
  await ui
    .getByRole("button", { name: "Edit Occupied zone", exact: true })
    .click();
  const longName = "🔵".repeat(60);
  await ui
    .getByRole("textbox", { name: "Refinement name", exact: true })
    .fill(longName);
  await ui.getByRole("button", { name: "Done", exact: true }).click();
  for (let i = 0; i < 2; i++)
    await ui
      .getByRole("button", { name: `Duplicate ${longName}`, exact: true })
      .click();
  const copies = await eventually(
    saved,
    (p) => p.cfdScenarios[0].mesh.refinements.length === 5,
  );
  const names = copies.cfdScenarios[0].mesh.refinements.map(
    (region) => region.name,
  );
  assert.equal(new Set(names).size, 5);
  for (const name of names) {
    assert.ok(name.length <= 120);
    assert.equal(
      new TextDecoder().decode(new TextEncoder().encode(name)),
      name,
      "Truncating a copied name must not split a Unicode character",
    );
  }
});

test("adding after a deletion keeps refinement names unique and deleting the last entry clears the editor", async (t) => {
  const project = cfdProject();
  project.cfdScenarios![0].mesh.refinements = Array.from(
    { length: 3 },
    (_, i) => ({
      id: `box-${i + 1}`,
      name: `Refinement ${i + 1}`,
      shape: "box",
      centerMm: [1000, 1000, 1000],
      sizeMm: [1000, 1000, 1000],
      objectId: null,
      level: 2,
      cellMm: 50,
    }),
  );
  const { ui, saved } = await setup(t, project);
  await cfdWindow(ui, "Simulation");
  await ui
    .getByRole("button", { name: "Delete Refinement 2", exact: true })
    .click();
  await ui
    .getByRole("button", { name: "Add refinement region", exact: true })
    .click();
  const next = await eventually(saved, (p) =>
    p.cfdScenarios[0].mesh.refinements.some(
      (region) => region.name === "Refinement 4",
    ),
  );
  assert.deepEqual(
    next.cfdScenarios[0].mesh.refinements.map((region) => region.name),
    ["Refinement 1", "Refinement 3", "Refinement 4"],
  );
  await ui.getByRole("button", { name: "Done", exact: true }).click();
  for (const name of ["Refinement 1", "Refinement 3", "Refinement 4"])
    await ui
      .getByRole("button", { name: `Delete ${name}`, exact: true })
      .click();
  assert.equal(await ui.locator(".cfx-refinement-row").count(), 0);
  assert.equal(
    await ui
      .getByRole("textbox", { name: "Refinement name", exact: true })
      .count(),
    0,
  );
  await ui.getByText("No local refinement regions.", { exact: true }).waitFor();
  assert.equal(
    await ui
      .getByRole("button", { name: "View refinements in 3D", exact: true })
      .isDisabled(),
    true,
  );
  await cfdWindow(ui, "Studies");
  await ui.getByRole("button", { name: "Undo", exact: true }).click();
  assert.equal(await ui.locator(".cfx-refinement-row").count(), 1);
});
