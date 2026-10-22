import { cfdWindow } from "./harness.mjs";
import assert from "node:assert/strict";
import test, { before, after } from "node:test";
import { cfdProject, realPreparation } from "../climoptixFixtures";
import { duplicateCFDScenario } from "../../lib/climoptixDocument";
import { zipSync, strToU8 } from "fflate";
import { readFile } from "node:fs/promises";
import { eventually, menu, startBrowserHarness } from "./harness.mjs";

let harness;
before(async () => {
  harness = await startBrowserHarness();
});
after(async () => {
  await harness?.close();
});

async function open(t, project = cfdProject()) {
  const session = await harness.session(project);
  t.after(() => session.close());
  await session.context.route("**/climoptix/prepare", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(realPreparation(route.request().postDataJSON())),
    }),
  );
  await session.page
    .getByRole("combobox", { name: "Workspace", exact: true })
    .selectOption("CLIMOPTIX");
  const ui = session.page.getByRole("region", {
    name: "Climoptix CFD workspace",
    exact: true,
  });
  return { ...session, ui };
}

test("a delayed study import rechecks the project capacity after the file is read", async (t) => {
  const project = cfdProject(false),
    original = project.cfdScenarios![0];
  project.cfdScenarios = Array.from({ length: 99 }, (_, i) => ({
    ...duplicateCFDScenario(original),
    name: `Study ${i + 1}`,
  }));
  const { page, ui, saved } = await open(t, project);
  await cfdWindow(ui, "Review & export");
  await page.evaluate(() => {
    const original = File.prototype.text;
    File.prototype.text = function () {
      if (this.name !== "slow-study.json") return original.call(this);
      return new Promise<string>((resolve) => {
        window.__releaseStudy = async () => resolve(await original.call(this));
      });
    };
  });
  await ui.getByLabel("Import CFD scenario", { exact: true }).setInputFiles({
    name: "slow-study.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(original)),
  });
  await eventually(
    () => page.evaluate(() => typeof window.__releaseStudy),
    (v) => v === "function",
  );
  await cfdWindow(ui, "Studies");
  await ui.getByRole("button", { name: "New study", exact: true }).click();
  await eventually(saved, (p) => p.cfdScenarios.length === 100);
  await page.evaluate(() => window.__releaseStudy());
  await ui
    .getByRole("alert")
    .filter({ hasText: /100 studies/ })
    .waitFor();
  assert.equal((await saved()).cfdScenarios.length, 100);
});

test("a settings export is cancelled when a different project replaces its workbench", async (t) => {
  const { page, context, ui, saved } = await open(t);
  await ui
    .getByRole("button", { name: "Validate & refresh", exact: true })
    .click();
  await eventually(
    () => ui.locator(".cfx-state").innerText(),
    (v) => v === "Validated",
  );
  await cfdWindow(ui, "Simulation");
  await ui.getByRole("tab", { name: "Run", exact: true }).click();
  let held, requested;
  const arrived = new Promise<void>((resolve) => {
    requested = resolve;
  });
  await context.route("**/climoptix/openfoam-settings", (route) => {
    held = route;
    requested();
  });
  const downloads: string[] = [];
  page.on("download", (download) =>
    downloads.push(download.suggestedFilename()),
  );
  await ui
    .getByRole("button", { name: "Export OpenFOAM settings", exact: true })
    .click();
  await arrived;
  const replacement = cfdProject(false);
  await page.getByLabel("Open project file", { exact: true }).setInputFiles({
    name: "replacement.floorplan3d",
    mimeType: "application/zip",
    buffer: Buffer.from(
      zipSync({
        "manifest.json": strToU8(
          JSON.stringify({
            packageVersion: 1,
            builtinCatalogueVersion: 1,
            project: replacement,
          }),
        ),
      }),
    ),
  });
  await eventually(saved, (p) => p.projectId === replacement.projectId);
  const finished = new Promise<void>((resolve) => {
    const done = (request) => {
      if (request.url().endsWith("/climoptix/openfoam-settings")) resolve();
    };
    page.on("requestfinished", done);
    page.on("requestfailed", done);
  });
  await held.fulfill({
    status: 200,
    contentType: "application/zip",
    body: Buffer.from("external settings test"),
  });
  // The request may already have been aborted by unmount. Allow its queued
  // continuation to settle, without relying on a network/timing sleep.
  await Promise.race([
    finished,
    page.evaluate(() => new Promise(requestAnimationFrame)),
  ]);
  await page.evaluate(() => new Promise(requestAnimationFrame));
  assert.deepEqual(
    downloads,
    [],
    "An old project must not start a late download after it is replaced",
  );
});

test("delete confirmation uses the shared window styling and keeps cancellation keyboard-safe", async (t) => {
  const { page, ui, saved } = await open(t);
  await cfdWindow(ui, "Studies");
  await ui.locator(".cfx-study-row.selected").getByRole("button", { name: /^Delete / }).click();
  const dialog = page.getByRole("dialog", {
    name: "Delete CFD scenario",
    exact: true,
  });
  await dialog.waitFor();
  if (process.env.BROWSER_ARTIFACTS)
    await page.screenshot({
      path: `${process.env.BROWSER_ARTIFACTS}/cfd-pass2-delete.png`,
      animations: "disabled",
    });
  assert.equal(await dialog.locator(".popup-titlebar").count(), 1);
  assert.equal(
    await dialog
      .getByRole("button", { name: "Cancel", exact: true })
      .evaluate((el) => el === document.activeElement),
    true,
  );
  await dialog
    .getByRole("button", { name: "Help for Delete CFD study", exact: true })
    .click();
  const deleteHelp = page.getByRole("article", {
    name: "Help for Delete CFD study",
    exact: true,
  });
  await deleteHelp.waitFor();
  assert.match(
    await deleteHelp.innerText(),
    /shared building, assets and other studies are unchanged/,
  );
  await page.keyboard.press("Escape");
  await deleteHelp.waitFor({ state: "hidden" });
  assert.equal(
    await dialog.isVisible(),
    true,
    "Closing help must not close the underlying native confirmation",
  );
  await page.keyboard.press("Escape");
  await dialog.waitFor({ state: "hidden" });
  assert.equal((await saved()).cfdScenarios.length, 1);
  assert.equal(
    await ui
      .locator(".cfx-study-row.selected").getByRole("button", { name: /^Delete / })
      .evaluate((el) => el === document.activeElement),
    true,
  );
  await cfdWindow(ui, "Studies");
  await ui.locator(".cfx-study-row.selected").getByRole("button", { name: /^Delete / }).click();
  await dialog
    .getByRole("button", { name: "Delete study", exact: true })
    .click();
  await eventually(saved, (p) => p.cfdScenarios.length === 0);
  assert.equal(
    await ui
      .getByRole("button", { name: "New study", exact: true })
      .evaluate((el) => el === document.activeElement),
    true,
  );
  await cfdWindow(ui, "Studies");
  await ui.getByRole("button", { name: "Undo", exact: true }).click();
  await eventually(saved, (p) => p.cfdScenarios.length === 1);
});

test("boundary search finds the room and surface names displayed to the user", async (t) => {
  const { ui } = await open(t);
  await ui
    .getByRole("button", { name: "Validate & refresh", exact: true })
    .click();
  await eventually(
    () => ui.locator(".cfx-state").innerText(),
    (v) => v === "Validated",
  );
  await cfdWindow(ui, "Boundaries");
  const search = ui.getByRole("searchbox", {
    name: "Find a CFD patch",
    exact: true,
  });
  await search.fill("Living room");
  assert.ok((await ui.locator(".cfx-patch-list button").count()) > 0);
  for (const row of await ui.locator(".cfx-patch-list button").all())
    assert.match(await row.innerText(), /Living room/);
  await search.fill("Wall 1");
  assert.ok((await ui.locator(".cfx-patch-list button").count()) > 0);
  await search.fill("no-such-room");
  await ui
    .getByRole("status")
    .filter({ hasText: /No matching patches/ })
    .waitFor();
});

test("legacy VTK never wraps integer result values and accepts standard whitespace and empty cell blocks", async (t) => {
  const { ui } = await open(t);
  await cfdWindow(ui, "Simulation");
  await ui.getByRole("tab", { name: "Post-processing", exact: true }).click();
  const legacy =
    "# vtk DataFile Version 3.0\nSlice\nASCII\nDATASET POLYDATA\nPOINTS 4 float\n0 0 0 1 0 0 1 1 0 0 1 0\nPOLYGONS 1 5\n4 0 1 2 3\nPOINT_DATA 4\nSCALARS label long 1\nLOOKUP_TABLE default\n3000000000 3000000000 3000000000 3000000000";
  const load = (text) =>
    ui.getByLabel("Open VTK result", { exact: true }).setInputFiles({
      name: "legacy.vtk",
      mimeType: "text/plain",
      buffer: Buffer.from(text),
    });
  await load(legacy);
  const result = ui.getByRole("region", {
    name: "VTK results viewer",
    exact: true,
  });
  await eventually(
    () => result.innerText(),
    (text) => /File not loaded|4 points/.test(text),
  );
  assert.match(await result.innerText(), /integer.*range/i);
  assert.equal(await result.locator("canvas").count(), 0);
  await result
    .getByRole("button", { name: "Back to geometry", exact: true })
    .click();
  await load(
    legacy
      .replace("SCALARS label long", "SCALARS label double")
      .replace("POLYGONS 1 5", "VERTICES 0 0\nLINES 0 0\nPOLYGONS 1 5")
      .replaceAll(" ", "\t"),
  );
  await result.getByText("4 points · 1 cell", { exact: true }).waitFor();
  assert.match(await result.locator("footer").innerText(), /3\.0000e\+9/);
});

for (const style of ["DEFAULT", "MODERN"])
  test(`complete ${style.toLowerCase()} CFD walkthrough stays bounded across themes, densities and viewport sizes`, async (t) => {
    const { page, ui } = await open(t);
    const palette = JSON.parse(
      await readFile(
        new URL("../../../data/ui_theme_defaults.json", import.meta.url),
        "utf8",
      ),
    ).themes[style];
    await page.evaluate(
      ({ style, theme }) => {
        document.body.dataset.uiStyle = style.toLowerCase();
        const root = document.documentElement;
        for (const [name, colour] of Object.entries(theme.colours))
          root.style.setProperty(`--configured-${name}`, colour as string);
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
      { style, theme: palette },
    );
    await ui
      .getByRole("button", { name: "Validate & refresh", exact: true })
      .click();
    await eventually(
      () => ui.locator(".cfx-state").innerText(),
      (v) => v === "Validated",
    );
    for (const theme of ["light", "dark"] as const) {
      await page.emulateMedia({ colorScheme: theme });
      await eventually(
        () => page.locator("html").getAttribute("data-theme"),
        (v) => v === theme,
      );
      for (const viewport of [
        { width: 1440, height: 1000 },
        { width: 1024, height: 768 },
        { width: 390, height: 844 },
      ]) {
        await page.setViewportSize(viewport);
        await menu(page, "Settings", "Preferences…");
        const preferences = page.getByRole("dialog", {
          name: "Preferences",
          exact: true,
        });
        await preferences
          .getByRole("button", {
            name: viewport.width === 1024 ? "Compact" : "Comfortable",
            exact: true,
          })
          .click();
        await preferences
          .getByRole("button", { name: "Close settings", exact: true })
          .click();
        for (const phase of [
          "Domain",
          "Equipment",
          "Boundaries",
          "Physics",
          "Simulation",
          "Review & export",
        ]) {
          await cfdWindow(ui, phase);
          const inspector = ui.getByRole("region", {
            name: `${phase} settings`,
            exact: true,
          });
          await inspector
            .getByRole("heading", { name: phase, exact: true })
            .scrollIntoViewIfNeeded();
          for (const summary of await inspector
            .locator("details > summary")
            .all()) {
            if (
              (await summary.isVisible()) &&
              !(await summary.evaluate(
                (el) => (el.parentElement as HTMLDetailsElement).open,
              ))
            )
              await summary.click();
          }
          if (phase === "Boundaries")
            await ui.locator(".cfx-patch-list button").first().click();
          if (phase === "Simulation")
            for (const title of ["Mesh", "Run", "Post-processing"]) {
              await ui.getByRole("tab", { name: title, exact: true }).click();
              assert.ok(
                await ui
                  .getByRole("tab", { name: title, exact: true })
                  .evaluate(
                    (el) => el.getAttribute("aria-selected") === "true",
                  ),
              );
            }
          if (phase === "Simulation") {
            await ui
              .getByRole("button", {
                name: "Help for Mesh, Run & Post-processing",
                exact: true,
              })
              .click();
            const help = page.getByRole("article", {
              name: "Help for Mesh, Run & Post-processing",
              exact: true,
            });
            await help.waitFor();
            assert.match(await help.innerText(), /Play stays unavailable/);
            await page.keyboard.press("Escape");
            await help.waitFor({ state: "hidden" });
          }
          assert.equal(
            await inspector.evaluate(
              (el) => el.scrollWidth <= el.clientWidth + 1,
            ),
            true,
            `${style} ${theme} ${viewport.width}: ${phase} inspector overflow`,
          );
          assert.equal(
            await page.evaluate(
              () => document.documentElement.scrollWidth <= innerWidth,
            ),
            true,
            `${style} ${theme} ${viewport.width}: page overflow`,
          );
        }
        await cfdWindow(ui, "Studies");
        await ui
          .getByRole("button", { name: "Help for Climoptix CFD", exact: true })
          .click();
        const help = page.getByRole("article", {
          name: "Help for Climoptix CFD",
          exact: true,
        });
        await help.waitFor();
        assert.match(
          await help.innerText(),
          /Preparation.*handoffs|Preparation.*runnable/,
        );
        await page.keyboard.press("Escape");
        await help.waitFor({ state: "hidden" });
        await cfdWindow(ui, "Simulation");
        await ui.getByRole("tab", { name: "Run", exact: true }).click();
        await ui
          .getByRole("combobox", { name: "Simulation type", exact: true })
          .selectOption("transient");
        const advanced = ui.locator("summary", {
          hasText: "Advanced numerics",
        });
        if (
          !(await advanced.evaluate(
            (el) => (el.parentElement as HTMLDetailsElement).open,
          ))
        )
          await advanced.click();
        await ui
          .getByRole("spinbutton", { name: "Residual Target", exact: true })
          .scrollIntoViewIfNeeded();
        const convection = await ui
          .getByRole("combobox", { name: "Convection", exact: true })
          .boundingBox();
        const corrections = await ui
          .getByRole("spinbutton", {
            name: "Non Orthogonal Corrections",
            exact: true,
          })
          .boundingBox();
        assert.ok(
          Math.abs(
            convection.y +
              convection.height -
              corrections.y -
              corrections.height,
          ) <= 1,
          `${style} ${theme} ${viewport.width}: adjacent input baselines must align when labels wrap`,
        );
        if (process.env.BROWSER_ARTIFACTS && viewport.width !== 1024)
          await page.screenshot({
            path: `${process.env.BROWSER_ARTIFACTS}/cfd-pass3-${style.toLowerCase()}-${theme}-${viewport.width}.png`,
            animations: "disabled",
          });
      }
    }
  });
