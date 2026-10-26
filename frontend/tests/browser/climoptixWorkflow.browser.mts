import { cfdWindow, cfdRefresh } from "./harness.mjs";
import assert from "node:assert/strict";
import test, { before, after } from "node:test";
import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { unzipSync, strFromU8 } from "fflate";
import { cfdProject, realPreparation } from "../climoptixFixtures";
import { eventually, startBrowserHarness } from "./harness.mjs";

let harness;
before(async () => {
  harness = await startBrowserHarness({ climoptixEnabled: true });
});
after(async () => {
  await harness?.close();
});

function blueResultPixels(png) {
  const root = fileURLToPath(new URL("../../../", import.meta.url));
  const result = spawnSync(
    path.join(
      root,
      ".venv",
      process.platform === "win32" ? "Scripts/python.exe" : "bin/python",
    ),
    [
      "-c",
      "import sys,io; from PIL import Image; im=Image.open(io.BytesIO(sys.stdin.buffer.read())).convert('RGB'); print(sum(1 for r,g,b in im.getdata() if b>120 and r<100 and g<150))",
    ],
    { input: png, encoding: "utf8", timeout: 15000 },
  );
  assert.equal(result.status, 0, result.stderr);
  return Number(result.stdout.trim());
}

function auditSlice(points = "0 0 0 1 0 0 1 1 0 0 1 0", extra = "") {
  return `<VTKFile type="PolyData" version="0.1" byte_order="LittleEndian"><PolyData><Piece NumberOfPoints="4" NumberOfVerts="0" NumberOfLines="0" NumberOfStrips="0" NumberOfPolys="1"><PointData Scalars="T"><DataArray type="Float32" Name="T" format="ascii">290 290 290 290</DataArray>${extra}</PointData><Points><DataArray type="Float64" NumberOfComponents="3" format="ascii">${points}</DataArray></Points><Polys><DataArray type="Int32" Name="connectivity" format="ascii">0 1 2 3</DataArray><DataArray type="Int32" Name="offsets" format="ascii">4</DataArray></Polys></Piece></PolyData></VTKFile>`;
}

test("XML counts and connectivity are checked before allocation, and unsupported metadata is not decoded", async (t) => {
  const { ui } = await setup(t);
  await ui.getByRole("tab", { name: "Post-processing", exact: true }).click();
  const valid = auditSlice();
  const open = async (text) =>
    ui.getByLabel("Open VTK result", { exact: true }).setInputFiles({
      name: "checked.vtp",
      mimeType: "application/xml",
      buffer: Buffer.from(text),
    });
  for (const [text, expected] of [
    [
      valid.replace(
        'Name="offsets" format="ascii">4',
        'Name="offsets" format="ascii">2500001',
      ),
      /connectivity limit/,
    ],
    [
      valid.replace(
        'Name="connectivity" format="ascii">0 1 2 3',
        'Name="connectivity" format="ascii">0 1 2 99',
      ),
      /missing point/,
    ],
    [
      valid.replace(
        ">0 0 0 1 0 0 1 1 0 0 1 0</DataArray>",
        ">0 0 0 1 0 0 1 1 0</DataArray>",
      ),
      /value count/,
    ],
  ]) {
    await open(text);
    const result = ui.getByRole("region", {
      name: "VTK results viewer",
      exact: true,
    });
    await result.getByRole("alert").filter({ hasText: expected }).waitFor();
    assert.equal(await result.locator("canvas").count(), 0);
    await result
      .getByRole("button", { name: "Back to geometry", exact: true })
      .click();
  }
  const withMetadata = valid.replace(
    "<Piece ",
    '<FieldData><Array type="String" Name="Notes" NumberOfTuples="1" format="ascii">0</Array><DataArray type="Float64" Name="Unused" NumberOfTuples="900000000" format="ascii">1</DataArray></FieldData><Piece ',
  );
  await open(withMetadata);
  const result = ui.getByRole("region", {
    name: "VTK results viewer",
    exact: true,
  });
  await result.getByText("4 points · 1 cell", { exact: true }).waitFor();
  assert.match(
    await result
      .getByRole("status", { name: "VTK field warnings", exact: true })
      .innerText(),
    /FieldData metadata/,
  );
  await result
    .getByRole("button", { name: "Back to geometry", exact: true })
    .click();
  await open(
    valid
      .replace('type="Float32" Name="T"', 'type="Int64" Name="T"')
      .replace(
        ">290 290 290 290</DataArray>",
        ">3000000000 3000000000 3000000000 3000000000</DataArray>",
      ),
  );
  await result.getByText("4 points · 1 cell", { exact: true }).waitFor();
  assert.match(await result.locator("footer").innerText(), /3\.0000e\+9/);
});

async function setup(t) {
  const session = await harness.session(cfdProject());
  t.after(() => session.close());
  await session.context.route("**/climoptix/prepare", async (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(realPreparation(route.request().postDataJSON())),
    }),
  );
  const { page } = session;
  const workspace = page.getByRole("combobox", {
    name: "Workspace",
    exact: true,
  });
  assert.deepEqual(
    await workspace
      .locator("option")
      .evaluateAll((items) => items.map((o) => o.value)),
    ["FLOORPLAN", "PLANNERBUILD", "CLIMOPTIX"],
  );
  await workspace.selectOption("CLIMOPTIX");
  const ui = page.getByRole("region", {
    name: "Climoptix CFD workspace",
    exact: true,
  });
  await cfdRefresh(ui);
  await eventually(
    () => ui.locator(".cfx-state").innerText(),
    (v) => v === "Validated",
  );
  await cfdWindow(ui, "Simulation");
  return { ...session, ui, workspace };
}

test("independent workbench saves level-coloured cuboids, run settings and named planes and exports real Foamlib dictionaries", async (t) => {
  const { page, context, ui, saved, workspace } = await setup(t);
  await ui
    .getByRole("button", { name: "Add refinement region", exact: true })
    .click();
  await ui
    .getByRole("textbox", { name: "Refinement name", exact: true })
    .fill("Occupant zone");
  await ui
    .getByRole("combobox", { name: "Refinement level", exact: true })
    .selectOption("5");
  await ui
    .getByRole("spinbutton", { name: "Refinement size X (mm)", exact: true })
    .fill("1200");
  await ui
    .getByRole("spinbutton", { name: "Refinement size X (mm)", exact: true })
    .press("Enter");
  await ui.getByRole("button", { name: "Done", exact: true }).click();
  await ui
    .getByRole("button", { name: "Duplicate Occupant zone", exact: true })
    .click();
  assert.equal(await ui.locator(".cfx-refinement-row").count(), 2);
  await ui
    .getByRole("button", { name: "Delete Occupant zone copy", exact: true })
    .click();
  const swatch = await ui
    .locator(".cfx-refinement-row .cfx-level-swatch")
    .evaluate((e) => getComputedStyle(e).backgroundColor);
  const renderedLegend = await ui
    .getByRole("list", { name: "Refinement colour legend", exact: true })
    .locator("i")
    .evaluate((e) => getComputedStyle(e).backgroundColor);
  assert.equal(swatch, renderedLegend);
  assert.ok(await ui.locator("canvas").isVisible());
  await ui.getByRole("tab", { name: "Run", exact: true }).click();
  await ui
    .getByRole("spinbutton", { name: "CPU cores", exact: true })
    .fill("8");
  await ui
    .getByRole("combobox", { name: "Simulation type", exact: true })
    .selectOption("transient");
  assert.equal(
    await ui
      .getByRole("button", { name: "Run solver", exact: true })
      .isDisabled(),
    true,
  );
  await ui.getByRole("tab", { name: "Post-processing", exact: true }).click();
  await ui.getByRole("checkbox", { name: "YZ slices (normal X)", exact: true }).check();
  await ui
    .getByRole("spinbutton", { name: "X plane count", exact: true })
    .fill("2");
  await ui
    .getByRole("spinbutton", { name: "X plane count", exact: true })
    .press("Enter");
  await ui.locator("summary", { hasText: "Plane positions" }).click();
  await ui.getByText("slice_x_002", { exact: true }).waitFor();
  const stored = await eventually(
    saved,
    (p) =>
      p.cfdScenarios?.[0].postProcessing.x.count === 2 &&
      p.cfdScenarios[0].resources.cpu === 8,
  );
  assert.equal(stored.cfdScenarios[0].mesh.refinements[0].level, 5);
  assert.equal(stored.cfdScenarios[0].mesh.refinements[0].sizeMm[0], 1200);
  assert.equal(stored.cfdScenarios[0].physics.numerics.coupling, "PIMPLE");
  // Delay a real access check so an older PlannerBuild request finishes only
  // after the user has returned to Climoptix. No account traffic leaves the test.
  await page.evaluate(() =>
    sessionStorage.setItem(
      "freefloorplan3d:commercial-session:v1",
      JSON.stringify({
        access_token: "browser-test-token",
        refresh_token: "browser-test-refresh",
        expires_at: Math.floor(Date.now() / 1000) + 3600,
        user: { id: "browser-test-user" },
      }),
    ),
  );
  let heldSummary;
  let summarySeen;
  const requested = new Promise<void>((resolve) => {
    summarySeen = resolve;
  });
  await context.route("**/commercial/summary", (route) => {
    heldSummary = route;
    summarySeen();
  });
  await workspace.selectOption("PLANNERBUILD");
  await requested;
  await workspace.selectOption("FLOORPLAN");
  await workspace.selectOption("CLIMOPTIX");
  const responded = page.waitForResponse("**/commercial/summary");
  await heldSummary.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({ capabilities: { canUsePlannerBuild: true } }),
  });
  await responded;
  await page.evaluate(() => new Promise(requestAnimationFrame));
  assert.equal(await workspace.inputValue(), "CLIMOPTIX");
  assert.equal(
    await ui
      .getByRole("tab", { name: "Post-processing", exact: true })
      .getAttribute("aria-selected"),
    "true",
  );
  await cfdRefresh(ui);
  await eventually(
    () => ui.locator(".cfx-state").innerText(),
    (v) => v === "Validated",
  );
  await ui.getByRole("tab", { name: "Run", exact: true }).click();
  await context.route("**/climoptix/openfoam-settings", async (route) => {
    const root = fileURLToPath(new URL("../../../", import.meta.url));
    const result = spawnSync(
      path.join(
        root,
        ".venv",
        process.platform === "win32" ? "Scripts/python.exe" : "bin/python",
      ),
      [
        "-c",
        "import json,sys,base64; from geometry.climoptix_models import Scenario; from backend.app.climoptix_provider import PreparationOnlyProvider; from backend.app.climoptix_foamlib import settings_package; d=json.load(sys.stdin); s=Scenario.model_validate(d['scenario']); r=PreparationOnlyProvider().validate_scenario(d['project'],s,d['clientRevision']); print(base64.b64encode(settings_package(s,r)).decode())",
      ],
      {
        cwd: root,
        input: route.request().postData(),
        encoding: "utf8",
        timeout: 25000,
      },
    );
    if (result.status !== 0) throw new Error(result.stderr);
    await route.fulfill({
      status: 200,
      contentType: "application/zip",
      body: Buffer.from(result.stdout.trim(), "base64"),
    });
  });
  const download = page.waitForEvent("download").catch(async (e) => {
    throw new Error(
      `${e.message}\nCFD status: ${await ui.getAttribute("data-preparation-state")}\nWorkspace: ${await workspace.inputValue()}`,
    );
  });
  await ui
    .getByRole("button", { name: "Export OpenFOAM settings", exact: true })
    .click();
  const archive = unzipSync(await readFile(await (await download).path()));
  const manifest = JSON.parse(strFromU8(archive["manifest.json"]));
  assert.equal(manifest.runnable, false);
  assert.equal(manifest.resources.cpu, 8);
  assert.equal(manifest.samplingPlanes.length, 5);
  assert.match(
    strFromU8(archive["settings/system/snappyHexMeshDict"]),
    /refinement_001/,
  );
  assert.match(strFromU8(archive["settings/system/controlDict"]), /pimpleFoam/);
});

test("real log records draw a graph and VTK point/cell fields render, zoom and download without ParaView", async (t) => {
  const { page, ui } = await setup(t);
  await ui.getByRole("tab", { name: "Monitor", exact: true }).click();
  await ui.getByLabel("Import solver log", { exact: true }).setInputFiles({
    name: "solver.log",
    mimeType: "text/plain",
    buffer: Buffer.from(
      "Time = 1\nsmoothSolver: Solving for Ux, Initial residual = 0.2, Final residual = 0.001, No Iterations 2\nTime = 2\nsmoothSolver: Solving for Ux, Initial residual = 0.02, Final residual = 0.0001, No Iterations 2",
    ),
  });
  await ui
    .getByRole("img", { name: "Residual graph for Ux", exact: true })
    .waitFor();
  await ui.getByRole("tab", { name: "Mesh", exact: true }).click();
  await ui.getByRole("tab", { name: "Monitor", exact: true }).click();
  assert.equal(
    await ui
      .getByRole("img", { name: "Residual graph for Ux", exact: true })
      .isVisible(),
    true,
  );
  await ui.getByRole("tab", { name: "Post-processing", exact: true }).click();
  const vtk = `<?xml version="1.0"?><VTKFile type="PolyData" version="0.1" byte_order="LittleEndian"><PolyData><Piece NumberOfPoints="4" NumberOfVerts="0" NumberOfLines="0" NumberOfStrips="0" NumberOfPolys="1"><PointData Scalars="T"><DataArray type="Float32" Name="T" format="ascii">290 292 294 296</DataArray><DataArray type="Float32" Name="U" NumberOfComponents="3" format="ascii">1 0 0 2 0 0 3 0 0 4 0 0</DataArray></PointData><CellData Scalars="p"><DataArray type="Float32" Name="p" format="ascii">2</DataArray></CellData><Points><DataArray type="Float32" NumberOfComponents="3" format="ascii">0 0 0 1 0 0 1 1 0 0 1 0</DataArray></Points><Polys><DataArray type="Int32" Name="connectivity" format="ascii">0 1 2 3</DataArray><DataArray type="Int32" Name="offsets" format="ascii">4</DataArray></Polys></Piece></PolyData></VTKFile>`;
  await ui.getByLabel("Open VTK result", { exact: true }).setInputFiles({
    name: "slice.vtp",
    mimeType: "application/xml",
    buffer: Buffer.from(vtk),
  });
  const result = ui.getByRole("region", {
    name: "VTK results viewer",
    exact: true,
  });
  await eventually(
    () => result.innerText(),
    (text) => /4 points · 1 cell|File not loaded/.test(text),
  );
  assert.match(await result.innerText(), /4 points · 1 cell/);
  await result.locator("canvas").waitFor();
  const before = await result.locator("canvas").screenshot();
  await result
    .getByRole("combobox", { name: "VTK result field", exact: true })
    .selectOption("point:U");
  await result
    .getByRole("button", { name: "Zoom VTK in", exact: true })
    .click();
  assert.notDeepEqual(await result.locator("canvas").screenshot(), before);
  await result
    .getByRole("combobox", { name: "VTK result field", exact: true })
    .selectOption("cell:p");
  await result.getByRole("button", { name: "Fit", exact: true }).click();
  const download = page.waitForEvent("download");
  await result
    .getByRole("button", { name: "Download full original data", exact: true })
    .click();
  assert.equal(await readFile(await (await download).path(), "utf8"), vtk);
  // Follow the application's real theme transition, including CSS variables.
  await page.emulateMedia({ colorScheme: "dark" });
  await eventually(
    () => page.locator("html").getAttribute("data-theme"),
    (v) => v === "dark",
  );
  if (process.env.BROWSER_ARTIFACTS)
    await page.screenshot({
      path: `${process.env.BROWSER_ARTIFACTS}/climoptix-workflow-vtk.png`,
      animations: "disabled",
    });
  await result
    .getByRole("button", { name: "Back to geometry", exact: true })
    .click();
  await ui.getByLabel("Open VTK result", { exact: true }).setInputFiles({
    name: "bad.vtp",
    mimeType: "application/xml",
    buffer: Buffer.from(
      vtk.replace('NumberOfPoints="4"', 'NumberOfPoints="999999999"'),
    ),
  });
  await ui.getByText(/VTK geometry exceeds/).waitFor();
  await result
    .getByRole("button", { name: "Back to geometry", exact: true })
    .click();
  const legacy =
    "# vtk DataFile Version 3.0\nExternal slice\nASCII\nDATASET POLYDATA\nPOINTS 4 float\n0 0 0 1 0 0 1 1 0 0 1 0\nPOLYGONS 1 5\n4 0 1 2 3\nPOINT_DATA 4\nSCALARS T float 1\nLOOKUP_TABLE default\n290 292 294 296";
  await ui.getByLabel("Open VTK result", { exact: true }).setInputFiles({
    name: "slice.vtk",
    mimeType: "text/plain",
    buffer: Buffer.from(legacy),
  });
  await eventually(
    () => result.innerText(),
    (text) => /4 points · 1 cell|File not loaded/.test(text),
  );
  assert.match(await result.innerText(), /4 points · 1 cell/);
  assert.ok(
    await result
      .getByRole("combobox", { name: "VTK result field", exact: true })
      .locator("option[value='point:T']")
      .count(),
  );
});

test("simulation tabs remain usable on narrow screens and inactive navigation is readable in dark mode", async (t) => {
  const { page, ui } = await setup(t);
  await page.emulateMedia({ colorScheme: "dark" });
  await eventually(
    () => page.locator("html").getAttribute("data-theme"),
    (v) => v === "dark",
  );
  const readContrast = () => ui
    .locator('.cfx-simulation-tabs button[aria-selected="false"]')
    .first()
    .evaluate((el) => {
      const light = (css) => {
        const c = css
          .match(/[\d.]+/g)
          .slice(0, 3)
          .map(Number)
          .map((n) => n / 255)
          .map((n) =>
            n <= 0.04045 ? n / 12.92 : ((n + 0.055) / 1.055) ** 2.4,
          );
        return c[0] * 0.2126 + c[1] * 0.7152 + c[2] * 0.0722;
      };
      // Transparent tabs inherit the visible backgrounds behind them. Compare
      // against that composite, not transparent black or an active tab's panel.
      let background = [255, 255, 255];
      const ancestors = []; for (let node = el; node; node = node.parentElement) ancestors.push(node);
      for (const node of ancestors.reverse()) {
        const rgba = getComputedStyle(node).backgroundColor.match(/[\d.]+/g).map(Number);
        const alpha = rgba[3] ?? 1;
        background = background.map((value, axis) => rgba[axis] * alpha + value * (1 - alpha));
      }
      const a = light(getComputedStyle(el).color), b = light(`rgb(${background.join(",")})`);
      return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
    });
  // The theme attribute updates before the shared 120ms colour transition ends.
  const ratio = await eventually(readContrast, value => value >= 4.5, "Settled inactive navigation contrast must be at least 4.5:1");
  assert.ok(ratio >= 4.5, `Inactive navigation contrast ${ratio}`);
  await page.setViewportSize({ width: 390, height: 844 });
  for (const title of ["Mesh", "Run", "Post-processing"]) {
    await ui.getByRole("tab", { name: title, exact: true }).click();
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
      true,
    );
    for (const tab of await ui.getByRole("tab").all()) {
      const minimum = await tab.evaluate(el => parseFloat(getComputedStyle(el).minHeight));
      assert.ok(minimum >= 28 && (await tab.boundingBox()).height >= minimum - 1);
    }
  }
  await ui.getByRole("tab", { name: "Mesh", exact: true }).click();
  await ui
    .getByRole("button", { name: "Add refinement region", exact: true })
    .click();
  await ui.getByRole("button", { name: "Done", exact: true }).click();
  await ui
    .getByRole("button", { name: "Duplicate Refinement 1", exact: true })
    .click();
  await cfdWindow(ui, "Studies");
  await ui.getByRole("button", { name: "Undo", exact: true }).click();
  assert.equal(await ui.locator(".cfx-refinement-row").count(), 1);
  if (process.env.BROWSER_ARTIFACTS)
    await page.screenshot({
      path: `${process.env.BROWSER_ARTIFACTS}/climoptix-workflow-mobile.png`,
      animations: "disabled",
    });
});

test("imported X, Y and Z slices are visible immediately without having to orbit an edge-on view", async (t) => {
  const { ui } = await setup(t);
  await ui.getByRole("tab", { name: "Post-processing", exact: true }).click();
  for (const [axis, points] of [
    ["X", "0 0 0 0 1 0 0 1 1 0 0 1"],
    ["Y", "0 0 0 1 0 0 1 0 1 0 0 1"],
    ["Z", "0 0 0 1 0 0 1 1 0 0 1 0"],
  ]) {
    const text = auditSlice(points);
    await ui.getByLabel("Open VTK result", { exact: true }).setInputFiles({
      name: `${axis}.vtp`,
      mimeType: "application/xml",
      buffer: Buffer.from(text),
    });
    const result = ui.getByRole("region", {
      name: "VTK results viewer",
      exact: true,
    });
    await result.getByText("4 points · 1 cell", { exact: true }).waitFor();
    const canvas = result.locator("canvas");
    const png = await canvas.screenshot(
      process.env.BROWSER_ARTIFACTS
        ? {
            path: `${process.env.BROWSER_ARTIFACTS}/climoptix-audit-${axis}.png`,
          }
        : {},
    );
    const box = await canvas.boundingBox();
    assert.ok(
      blueResultPixels(png) > box.width * box.height * 0.02,
      `${axis} plane must show a visible coloured area`,
    );
    await result
      .getByRole("button", { name: "Back to geometry", exact: true })
      .click();
  }
});

test("VTK warns about unusable result arrays and rejects coordinates beyond renderer precision", async (t) => {
  const { ui } = await setup(t);
  await ui.getByRole("tab", { name: "Post-processing", exact: true }).click();
  const text = auditSlice(
    undefined,
    '<DataArray type="Float64" Name="U" NumberOfComponents="3" format="ascii">1e308 0 0 1e308 0 0 1e308 0 0 1e308 0 0</DataArray><DataArray type="Float32" Name="Partial" format="ascii">1 2</DataArray>',
  );
  await ui.getByLabel("Open VTK result", { exact: true }).setInputFiles({
    name: "invalid-fields.vtp",
    mimeType: "application/xml",
    buffer: Buffer.from(text),
  });
  const result = ui.getByRole("region", {
    name: "VTK results viewer",
    exact: true,
  });
  await result.getByText("4 points · 1 cell", { exact: true }).waitFor();
  const warning = result.getByRole("status", {
    name: "VTK field warnings",
    exact: true,
  });
  assert.match(await warning.innerText(), /U .*WebGL numeric range/);
  assert.match(await warning.innerText(), /Partial .*value count/);
  const choices = result.getByRole("combobox", {
    name: "VTK result field",
    exact: true,
  });
  assert.equal(await choices.locator('option[value="point:U"]').count(), 0);
  assert.equal(await choices.locator('option[value="point:T"]').count(), 1);
  await result
    .getByRole("button", { name: "Back to geometry", exact: true })
    .click();
  await ui.getByLabel("Open VTK result", { exact: true }).setInputFiles({
    name: "huge-coordinates.vtp",
    mimeType: "application/xml",
    buffer: Buffer.from(auditSlice("1e308 0 0 1 0 0 1 1 0 0 1 0")),
  });
  await result
    .getByRole("alert")
    .filter({ hasText: "WebGL numeric range" })
    .waitFor();
  assert.equal(await result.locator("canvas").count(), 0);
});

test("a late solver-log read cannot replace a newer import or repopulate a cleared graph", async (t) => {
  const { page, ui } = await setup(t);
  await ui.getByRole("tab", { name: "Monitor", exact: true }).click();
  await page.evaluate(() => {
    const original = File.prototype.text;
    File.prototype.text = function () {
      if (this.name === "slow.log")
        return new Promise((resolve) => {
          window.__finishCFDRead = () =>
            resolve(
              "Time = 1\nsmoothSolver: Solving for Uslow, Initial residual = 0.2, Final residual = 0.001",
            );
        });
      return original.call(this);
    };
  });
  const input = ui.getByLabel("Import solver log", { exact: true });
  const slow = {
    name: "slow.log",
    mimeType: "text/plain",
    buffer: Buffer.from("delayed"),
  };
  await input.setInputFiles(slow);
  await page.waitForFunction(
    () => typeof window.__finishCFDRead === "function",
  );
  await input.setInputFiles({
    name: "fast.log",
    mimeType: "text/plain",
    buffer: Buffer.from(
      "Time = 1\nsmoothSolver: Solving for Ufast, Initial residual = 0.1, Final residual = 0.0001",
    ),
  });
  await ui
    .getByRole("img", { name: "Residual graph for Ufast", exact: true })
    .waitFor();
  await page.evaluate(() => window.__finishCFDRead());
  await page.evaluate(() => new Promise(requestAnimationFrame));
  assert.equal(
    await ui
      .getByRole("img", { name: "Residual graph for Ufast", exact: true })
      .count(),
    1,
  );
  await page.evaluate(() => {
    window.__finishCFDRead = null;
  });
  await input.setInputFiles(slow);
  await page.waitForFunction(
    () => typeof window.__finishCFDRead === "function",
  );
  await ui.getByRole("button", { name: "Clear log", exact: true }).click();
  await page.evaluate(() => window.__finishCFDRead());
  await page.evaluate(() => new Promise(requestAnimationFrame));
  assert.equal(
    await ui.getByRole("img", { name: /Residual graph for/ }).count(),
    0,
  );
});
