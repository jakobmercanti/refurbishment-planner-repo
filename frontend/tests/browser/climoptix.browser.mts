import { cfdWindow } from "./harness.mjs";
import assert from "node:assert/strict";
import test, { before, after } from "node:test";
import { readFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { unzipSync, strFromU8 } from "fflate";
import {
  cfdProject,
  realPreparation,
  realExampleProjects,
} from "../climoptixFixtures";
import { eventually, startBrowserHarness } from "./harness.mjs";

let harness;
before(async () => {
  harness = await startBrowserHarness();
});
after(async () => {
  await harness?.close();
});
async function open(page) {
  await page
    .getByRole("combobox", { name: "Workspace", exact: true })
    .selectOption("CLIMOPTIX");
  return page.getByRole("region", {
    name: "Climoptix CFD workspace",
    exact: true,
  });
}
async function connect(context, handler) {
  await context.route("**/climoptix/prepare", async (route) => {
    const request = route.request().postDataJSON();
    const report = realPreparation(request);
    if (handler) await handler(route, report);
    else
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(report),
      });
  });
}
async function validate(ui) {
  await ui
    .getByRole("button", { name: "Validate & refresh", exact: true })
    .click();
  await eventually(
    () => ui.locator(".cfx-state").innerText(),
    (text) => text === "Validated",
  );
}

test("Climoptix shares the building, prepares real connected surfaces and saves devices, BCs, physics and mesh intent", async (t) => {
  const s = await harness.session(cfdProject());
  t.after(() => s.close());
  const { page, context } = s;
  await connect(context);
  const ui = await open(page);
  await validate(ui);
  await cfdWindow(ui, "Domain");
  assert.match(
    await ui
      .getByRole("region", { name: "Domain settings", exact: true })
      .innerText(),
    /Connected rooms/,
  );
  const saved = await eventually(
    s.saved,
    (p) => p.cfdScenarios?.[0].validation?.errors === 0,
  );
  const source = JSON.stringify(saved.rooms);
  await cfdWindow(ui, "Equipment");
  await ui.getByRole("button", { name: "+ Supply", exact: true }).click();
  await ui.getByRole("button", { name: "+ Extract", exact: true }).click();
  await ui
    .getByRole("spinbutton", { name: "Host U (0–1)", exact: true })
    .fill("0.75");
  await ui
    .getByRole("combobox", { name: "Flow display unit", exact: true })
    .selectOption("m³/h");
  assert.equal(
    await ui
      .getByRole("spinbutton", { name: "Volume flow (m³/h)", exact: true })
      .inputValue(),
    "180",
  );
  await validate(ui);
  await cfdWindow(ui, "Boundaries");
  await ui.locator("summary", { hasText: "Group presets" }).click();
  await ui
    .getByRole("combobox", { name: "Boundary thermal condition", exact: true })
    .selectOption("temperature");
  await ui
    .getByRole("spinbutton", { name: "Boundary temperature (K)", exact: true })
    .fill("295.15");
  await cfdWindow(ui, "Physics");
  await ui
    .getByRole("combobox", { name: "Physics preset", exact: true })
    .selectOption("co2");
  await cfdWindow(ui, "Simulation");
  await ui
    .getByRole("combobox", { name: "Mesh intent preset", exact: true })
    .selectOption("Draft");
  await validate(ui);
  await cfdWindow(ui, "Review & export");
  const exporting = page.waitForEvent("download");
  await ui
    .getByRole("button", { name: "Export preparation ZIP", exact: true })
    .click();
  const download = await exporting,
    entries = unzipSync(new Uint8Array(await readFile(await download.path()))),
    manifest = JSON.parse(strFromU8(entries["preparation.json"]));
  assert.equal(manifest.caseGenerated, false);
  assert.equal(manifest.surface.closed, true);
  assert.equal(manifest.provider.canRun, false);
  assert.equal(manifest.domain.includedRoomIds.length, 2);
  assert.ok(entries["boundary-metres.stl"]);
  const stored = await eventually(
    s.saved,
    (p) =>
      p.cfdScenarios[0].vents.length === 2 &&
      p.cfdScenarios[0].physics.co2 &&
      p.cfdScenarios[0].mesh.preset === "Draft",
  );
  assert.equal(JSON.stringify(stored.rooms), source);
  assert.equal(
    stored.cfdScenarios[0].boundaries.groups.wall.thermal.value,
    295.15,
  );
  await page
    .getByRole("combobox", { name: "Workspace", exact: true })
    .selectOption("FLOORPLAN");
  await open(page);
  assert.equal(
    await ui
      .getByRole("region", { name: "Review & export settings", exact: true })
      .isVisible(),
    true,
  );
  await cfdWindow(ui, "Simulation");
  await ui.getByRole("tab", { name: "Run", exact: true }).click();
  assert.match(await ui.innerText(), /No residual samples/);
  assert.equal(
    await ui
      .getByRole("button", { name: "Run solver", exact: true })
      .isDisabled(),
    true,
  );
  if (process.env.BROWSER_ARTIFACTS)
    await page.screenshot({
      path: `${process.env.BROWSER_ARTIFACTS}/climoptix-desktop.png`,
    });
});

test("study duplication, archive, delete confirmation, undo and portable JSON import are independent", async (t) => {
  const s = await harness.session(cfdProject(false));
  t.after(() => s.close());
  const { page, context } = s;
  await connect(context);
  const ui = await open(page);
  await validate(ui);
  await cfdWindow(ui, "Studies");
  await ui.getByRole("button", { name: "Duplicate", exact: true }).click();
  await eventually(s.saved, (p) => p.cfdScenarios.length === 2);
  await ui
    .getByRole("textbox", { name: "Study name", exact: true })
    .fill("Winter study");
  await eventually(s.saved, (p) =>
    p.cfdScenarios.some((s) => s.name === "Winter study"),
  );
  await cfdWindow(ui, "Studies");
  await ui.getByRole("button", { name: "Archive", exact: true }).click();
  await eventually(s.saved, (p) =>
    p.cfdScenarios.some((s) => s.name === "Winter study" && s.archived),
  );
  assert.equal(
    await ui
      .getByRole("combobox", { name: "CFD scenario", exact: true })
      .locator("option")
      .count(),
    1,
  );
  await ui.getByRole("checkbox", { name: "Archived", exact: true }).check();
  const stored = await s.saved();
  await ui
    .getByRole("combobox", { name: "CFD scenario", exact: true })
    .selectOption(stored.cfdScenarios[1].id);
  await cfdWindow(ui, "Studies");
  await ui.locator(".cfx-study-row.selected").getByRole("button", { name: /^Delete / }).click();
  const dialog = page.getByRole("dialog", {
    name: "Delete CFD scenario",
    exact: true,
  });
  await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
  assert.equal((await s.saved()).cfdScenarios.length, 2);
  await cfdWindow(ui, "Studies");
  await ui.locator(".cfx-study-row.selected").getByRole("button", { name: /^Delete / }).click();
  await dialog
    .getByRole("button", { name: "Delete study", exact: true })
    .click();
  await eventually(s.saved, (p) => p.cfdScenarios.length === 1);
  await cfdWindow(ui, "Studies");
  await ui.getByRole("button", { name: "Undo", exact: true }).click();
  await eventually(s.saved, (p) => p.cfdScenarios.length === 2);
  await cfdWindow(ui, "Review & export");
  await ui.getByLabel("Import CFD scenario", { exact: true }).setInputFiles({
    name: "study.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(stored.cfdScenarios[0])),
  });
  const imported = await eventually(
    s.saved,
    (p) => p.cfdScenarios.length === 3,
  );
  assert.equal(imported.cfdScenarios[2].validation, null);
  assert.notEqual(imported.cfdScenarios[2].id, stored.cfdScenarios[0].id);
});

test("late validation cannot bless a changed study; unavailable service can be retried without losing data", async (t) => {
  const s = await harness.session(cfdProject());
  t.after(() => s.close());
  const { page, context } = s;
  let release,
    arrived = false,
    failedOnce = false;
  await context.route("**/climoptix/prepare", async (route) => {
    if (!failedOnce) {
      failedOnce = true;
      await route.fulfill({
        status: 503,
        contentType: "application/json",
        body: '{"detail":"Preparation temporarily unavailable"}',
      });
      return;
    }
    const value = realPreparation(route.request().postDataJSON());
    arrived = true;
    await new Promise((resolve) => {
      release = resolve;
    });
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(value),
    });
  });
  const ui = await open(page);
  await ui
    .getByRole("button", { name: "Validate & refresh", exact: true })
    .click();
  await ui
    .getByRole("alert")
    .filter({ hasText: "temporarily unavailable" })
    .waitFor();
  assert.equal(
    await ui
      .getByRole("button", { name: "Validate & refresh", exact: true })
      .isEnabled(),
    true,
  );
  await ui
    .getByRole("button", { name: "Validate & refresh", exact: true })
    .click();
  await eventually(
    () => arrived,
    (v) => v,
  );
  await cfdWindow(ui, "Physics");
  await ui
    .getByRole("combobox", { name: "Physics preset", exact: true })
    .selectOption("co2");
  release();
  await ui.getByText(/older response was not applied/).waitFor();
  const stored = await eventually(
    s.saved,
    (p) => p.cfdScenarios[0].physics.co2,
  );
  assert.equal(stored.cfdScenarios[0].validation, null);
});

test("CFD help, dark mode and narrow-screen controls remain accessible and aligned", async (t) => {
  const s = await harness.session(cfdProject());
  t.after(() => s.close());
  const { page, context } = s;
  await connect(context);
  const ui = await open(page);
  await validate(ui);
  await ui
    .getByRole("button", { name: "Help for Climoptix CFD", exact: true })
    .click();
  await page.locator(".window-help-content").waitFor();
  assert.match(
    await page.locator(".window-help-content").innerText(),
    /Doors and windows stop/,
  );
  await page.keyboard.press("Escape");
  await page.emulateMedia({ colorScheme: "dark" });
  await eventually(
    () => page.locator("html").getAttribute("data-theme"),
    (v) => v === "dark",
  );
  const colours = await ui.evaluate((el) => ({
    background: getComputedStyle(el).backgroundColor,
    ink: getComputedStyle(el).color,
  }));
  assert.notEqual(colours.background, colours.ink);
  const contrast = await ui
    .locator(".cfx-primary")
    .first()
    .evaluate((el) => {
      const luminance = (text) => {
        const values = text
          .match(/[\d.]+/g)
          .slice(0, 3)
          .map(Number)
          .map((c) => c / 255)
          .map((c) =>
            c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4,
          );
        return values[0] * 0.2126 + values[1] * 0.7152 + values[2] * 0.0722;
      };
      const css = getComputedStyle(el),
        a = luminance(css.backgroundColor),
        b = luminance(css.color);
      return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
    });
  assert.ok(contrast >= 4.5, `Dark selected tab contrast ${contrast}`);
  await page.waitForTimeout(350); // Allow the documented fit animation to settle.
  if (process.env.BROWSER_ARTIFACTS)
    await page.screenshot({
      path: `${process.env.BROWSER_ARTIFACTS}/climoptix-dark.png`,
    });
  await page.setViewportSize({ width: 390, height: 844 });
  assert.ok(await ui.locator("canvas").isVisible());
  assert.ok(
    await ui
      .getByRole("combobox", { name: "CFD view scope", exact: true })
      .isVisible(),
  );
  assert.ok(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  );
  await cfdWindow(ui, "Equipment");
  await ui
    .getByRole("button", { name: "+ Supply", exact: true })
    .scrollIntoViewIfNeeded();
  await ui.getByRole("button", { name: "+ Supply", exact: true }).click();
  await cfdWindow(ui, "Studies");
  for (const button of await ui.locator(".cfx-study-tools > button").all()) {
    const box = await button.boundingBox();
    assert.ok(box.height >= 39);
  }
  if (process.env.BROWSER_ARTIFACTS)
    await page.screenshot({
      path: `${process.env.BROWSER_ARTIFACTS}/climoptix-mobile.png`,
    });
});

test("numeric drafts apply only when committed, reject invalid settings clearly, and Custom preserves values", async (t) => {
  const s = await harness.session(cfdProject());
  t.after(() => s.close());
  const { page, context } = s;
  await connect(context);
  const ui = await open(page);
  await cfdWindow(ui, "Physics");
  const physics = ui.getByRole("combobox", {
    name: "Physics preset",
    exact: true,
  });
  await physics.selectOption("co2");
  await physics.selectOption("custom");
  const stored = await eventually(
    s.saved,
    (p) => p.cfdScenarios[0].physics.preset === "custom",
  );
  assert.equal(stored.cfdScenarios[0].physics.co2, true);
  const density = ui.getByRole("spinbutton", {
    name: "Air density (kg/m³)",
    exact: true,
  });
  await density.fill("1000");
  assert.equal((await s.saved()).cfdScenarios[0].physics.densityKgM3, 1.204);
  await density.press("Enter");
  await ui
    .getByRole("alert")
    .filter({ hasText: "Changes not applied" })
    .waitFor();
  assert.equal(await density.inputValue(), "1.204");
  const viscosity = ui.getByRole("spinbutton", {
    name: "Dynamic viscosity (Pa·s)",
    exact: true,
  });
  await viscosity.fill("1.85e-5");
  await viscosity.press("Enter");
  await eventually(
    s.saved,
    (p) => p.cfdScenarios[0].physics.dynamicViscosityPaS === 1.85e-5,
  );
  assert.equal(
    await ui
      .getByRole("alert")
      .filter({ hasText: "Changes not applied" })
      .count(),
    0,
  );
  await cfdWindow(ui, "Simulation");
  const mesh = ui.getByRole("combobox", {
    name: "Mesh intent preset",
    exact: true,
  });
  await mesh.selectOption("Draft");
  await mesh.selectOption("Custom");
  const after = await eventually(
    s.saved,
    (p) => p.cfdScenarios[0].mesh.preset === "Custom",
  );
  assert.equal(after.cfdScenarios[0].mesh.baseCellMm, 400);
});

function goldPixel(png, obscured = []) {
  const root = fileURLToPath(new URL("../../../", import.meta.url));
  const python = path.join(
    root,
    ".venv",
    process.platform === "win32" ? "Scripts/python.exe" : "bin/python",
  );
  const value = spawnSync(
    python,
    [
      "-c",
      [
        "import sys,io,json",
        "from PIL import Image",
        "im=Image.open(io.BytesIO(sys.stdin.buffer.read())).convert('RGB')",
        "obscured=json.loads(sys.argv[1])",
        "points=[(x,y) for y in range(im.height) for x in range(im.width) if not any(a<=x<=a+w and b<=y<=b+h for a,b,w,h in obscured) and (lambda r,g,b: r>180 and g>130 and r>b*1.55 and g>b*1.35)(*im.getpixel((x,y)))]",
        "print(json.dumps([sum(x for x,y in points)/len(points),sum(y for x,y in points)/len(points)] if points else None))",
      ].join("; "),
      JSON.stringify(obscured),
    ],
    { input: png, encoding: "utf8", timeout: 15000 },
  );
  assert.equal(value.status, 0, value.stderr);
  return JSON.parse(value.stdout);
}

test("vents can be picked and dragged in the full-size 3D viewer without changing source geometry", async (t) => {
  const s = await harness.session(cfdProject());
  t.after(() => s.close());
  const { page, context } = s;
  await connect(context);
  const ui = await open(page);
  await validate(ui);
  const source = JSON.stringify((await s.saved()).rooms);
  await cfdWindow(ui, "Equipment");
  await ui.getByRole("button", { name: "+ Supply", exact: true }).click();
  const host = ui.getByRole("combobox", {
    name: "Vent host face",
    exact: true,
  });
  const ceiling = await host
    .locator("option")
    .filter({ hasText: "Ceiling" })
    .first()
    .getAttribute("value");
  await host.selectOption(ceiling);
  const width = ui.getByRole("spinbutton", {
    name: "Vent width (mm)",
    exact: true,
  });
  await width.fill("700");
  await width.press("Enter");
  const before = {
    host: {
      u: Number(
        await ui
          .getByRole("spinbutton", { name: "Host U (0–1)", exact: true })
          .inputValue(),
      ),
      v: Number(
        await ui
          .getByRole("spinbutton", { name: "Host V (0–1)", exact: true })
          .inputValue(),
      ),
    },
  };
  await page.getByRole("button", { name: "Hide Simulation setup", exact: true }).click();
  await ui.getByRole("button", { name: "Fit", exact: true }).click();
  const canvas = ui.locator("canvas");
  await canvas.waitFor();
  await page.waitForTimeout(650);
  const canvasBounds = await canvas.boundingBox();
  const obscured = await ui
    .locator(
      ".floating-toolbar, .cfx-view-selector, .cfx-stale, .cfx-setup-footer, .cfx-viewer > footer",
    )
    .evaluateAll(
      (items, canvasBounds) =>
        items.map((el) => {
          const b = el.getBoundingClientRect();
          return [
            b.x - canvasBounds.x,
            b.y - canvasBounds.y,
            b.width,
            b.height,
          ];
        }),
      canvasBounds,
    );
  const pixel = goldPixel(await canvas.screenshot(), obscured);
  if (!pixel && process.env.BROWSER_ARTIFACTS)
    await canvas.screenshot({
      path: `${process.env.BROWSER_ARTIFACTS}/climoptix-vent-missing.png`,
    });
  assert.ok(
    pixel,
    "Selected intent vent must be visible in the actual 3D render",
  );
  const canvasBox = await canvas.boundingBox();
  const x = canvasBox.x + pixel[0],
    y = canvasBox.y + pixel[1];
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + 25, y + 12, { steps: 8 });
  await page.mouse.up();
  const dragged = await eventually(
    s.saved,
    (p) =>
      Math.abs(p.cfdScenarios[0].vents[0].host.u - before.host.u) > 0.001 ||
      Math.abs(p.cfdScenarios[0].vents[0].host.v - before.host.v) > 0.001,
  );
  assert.equal(JSON.stringify(dragged.rooms), source);
  assert.ok(await ui.getByText(/Study setup changed/).isVisible());
  if (process.env.BROWSER_ARTIFACTS)
    await ui.screenshot({
      path: `${process.env.BROWSER_ARTIFACTS}/climoptix-vent-drag.png`,
    });
});

test("refinement regions are editable visual intent, patch isolation works, and reports remain portable", async (t) => {
  const s = await harness.session(realExampleProjects()["office-occupants"]);
  t.after(() => s.close());
  const { page, context } = s;
  await connect(context);
  const ui = await open(page);
  await validate(ui);
  await cfdWindow(ui, "Domain");
  assert.match(
    await ui
      .getByRole("region", { name: "Domain settings", exact: true })
      .innerText(),
    /Last checked bounds/,
  );
  await cfdWindow(ui, "Simulation");
  await ui
    .getByRole("button", { name: "Add refinement region", exact: true })
    .click();
  await ui
    .getByRole("textbox", { name: "Refinement name", exact: true })
    .fill("Desk zone");
  const shape = ui.getByRole("combobox", {
    name: "Refinement shape",
    exact: true,
  });
  await shape.selectOption("sphere");
  const diameter = ui.getByRole("spinbutton", {
    name: "Refinement diameter (mm)",
    exact: true,
  });
  await diameter.fill("800");
  await diameter.press("Enter");
  assert.ok(await ui.locator("canvas").isVisible());
  assert.match(
    await ui
      .getByRole("list", { name: "Refinement colour legend", exact: true })
      .innerText(),
    /Level/,
  );
  await eventually(
    s.saved,
    (p) =>
      !!p.cfdScenarios[0].mesh.refinements[0] &&
      p.cfdScenarios[0].mesh.refinements[0].sizeMm.every((n) => n === 800),
  );
  await shape.selectOption("object");
  await ui.getByRole("button", { name: "Done", exact: true }).click();
  await ui
    .getByRole("combobox", { name: "Mesh intent preset", exact: true })
    .selectOption("Fine");
  assert.equal(await ui.locator(".cfx-refinement-row").count(), 1);
  await ui.getByRole("button", { name: "Edit Desk zone", exact: true }).click();
  assert.ok(
    (
      await ui
        .getByRole("combobox", { name: "Refinement object", exact: true })
        .locator("option")
        .allTextContents()
    ).some((t) => /desk|chair|occupant/i.test(t)),
  );
  await ui.getByRole("button", { name: "Done", exact: true }).click();
  await validate(ui);
  const downloadEvent = page.waitForEvent("download");
  await cfdWindow(ui, "Review & export");
  await ui
    .getByRole("button", { name: "Download settings & preflight", exact: true })
    .click();
  const file = await downloadEvent;
  assert.match(
    await readFile(await file.path(), "utf8"),
    /MESH INTENT — NOT GENERATED CELLS/,
  );
  await cfdWindow(ui, "Boundaries");
  await ui
    .getByRole("list", { name: "CFD boundary patches", exact: true })
    .getByRole("button")
    .first()
    .click();
  const canvas = ui.locator("canvas");
  await canvas.waitFor();
  await page.waitForTimeout(350);
  const full = await canvas.screenshot();
  await cfdWindow(ui, "View properties");
  await ui
    .getByRole("checkbox", { name: "Isolate selection", exact: true })
    .check();
  await page.waitForTimeout(350);
  assert.notDeepEqual(await canvas.screenshot(), full);
  await ui
    .getByRole("checkbox", { name: "Isolate selection", exact: true })
    .uncheck();
  await page
    .getByRole("button", { name: "Hide Simulation setup", exact: true })
    .click();
  await cfdWindow(ui, "Boundaries");
  await ui
    .getByRole("searchbox", { name: "Find a CFD patch", exact: true })
    .fill("desk");
  await ui
    .getByRole("list", { name: "CFD boundary patches", exact: true })
    .getByRole("button")
    .first()
    .click();
  await cfdWindow(ui, "Equipment");
  assert.ok(
    await ui
      .locator("details[open]")
      .filter({ hasText: "Catalogue proxy: table" })
      .isVisible(),
    "Object patch selection opens the same source object's equipment inspector",
  );
  await ui
    .getByRole("button", { name: "Edit source building & assets", exact: true })
    .click();
  assert.equal(
    await page
      .getByRole("combobox", { name: "Workspace", exact: true })
      .inputValue(),
    "FLOORPLAN",
  );
  await open(page);
  assert.ok(
    await ui
      .getByRole("region", { name: "Equipment settings", exact: true })
      .isVisible(),
  );
  if (process.env.BROWSER_ARTIFACTS) {
    await page.waitForTimeout(350);
    await ui.screenshot({
      path: `${process.env.BROWSER_ARTIFACTS}/climoptix-office-inspection.png`,
    });
  }
});
