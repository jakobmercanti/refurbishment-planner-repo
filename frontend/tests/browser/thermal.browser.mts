import { cfdWindow } from "./harness.mjs";
import assert from "node:assert/strict";
import test, { before, after } from "node:test";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { thermalProject, realThermal } from "../thermalFixtures";
import { realPreparation } from "../climoptixFixtures";
import { duplicateCFDScenario } from "../../lib/climoptixDocument";
import { eventually, menu, startBrowserHarness } from "./harness.mjs";

let harness;
before(async () => {
  harness = await startBrowserHarness();
});
after(async () => {
  await harness?.close();
});

async function connect(context) {
  await context.route("**/climoptix/prepare", async (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(realPreparation(route.request().postDataJSON())),
    }),
  );
  await context.route("**/climoptix/thermal-*", async (route) => {
    const calculate = route.request().url().endsWith("thermal-preview");
    if (route.request().url().endsWith("thermal-epw"))
      return route.fulfill({
        status: 422,
        contentType: "application/json",
        body: JSON.stringify({ detail: "Expected an EPW LOCATION header." }),
      });
    const report = realThermal(route.request().postDataJSON(), calculate);
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(report),
    });
  });
}
async function open(session) {
  await connect(session.context);
  await session.page
    .getByRole("combobox", { name: "Workspace", exact: true })
    .selectOption("CLIMOPTIX");
  await cfdWindow(session.page, "Boundaries");
  await session.page
    .getByRole("button", {
      name: "Thermal Envelope & Solar Conditions",
      exact: true,
    })
    .click();
  const ui = session.page.getByRole("region", {
    name: "Thermal envelope setup",
    exact: true,
  });
  await ui
    .getByRole("button", { name: "Calculate & preview", exact: true })
    .waitFor();
  await eventually(
    () =>
      ui
        .getByRole("list", { name: "Thermal surfaces" })
        .getByRole("button")
        .count(),
    (n) => n > 5,
  );
  return ui;
}
const step = async (ui, name) =>
  ui
    .getByRole("navigation", { name: "Thermal setup steps" })
    .getByRole("button", { name: new RegExp(name) })
    .click();
async function calculate(ui) {
  await ui
    .getByRole("button", { name: "Calculate & preview", exact: true })
    .click();
  await eventually(
    () =>
      ui
        .getByRole("button", { name: "Apply to CFD boundaries", exact: true })
        .isEnabled(),
    Boolean,
  );
}
async function layoutMatrix(ui, page, theme, style = "default") {
  for (const [width, height] of [
    [1440, 1000],
    [900, 1000],
    [390, 844],
  ]) {
    await page.setViewportSize({ width, height });
    for (const [index, name] of [
      "Envelope & insulation",
      "Location & sun",
      "Weather / scenario",
      "Gains & ventilation",
      "Modelling & advanced",
      "Review & apply",
    ].entries()) {
      await step(ui, name);
      const contrast = await ui
        .locator(".thermal-steps button.active")
        .evaluate((button) => {
          const style = getComputedStyle(button);
          const luminance = (value) => {
            const rgb = value
              .match(/[\d.]+/g)
              .slice(0, 3)
              .map(Number)
              .map((c) => c / 255)
              .map((c) =>
                c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4,
              );
            return 0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2];
          };
          const a = luminance(style.color),
            b = luminance(style.backgroundColor);
          return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
        });
      assert.ok(
        contrast >= 4.5,
        `Active step contrast ${contrast} at ${width}px`,
      );
      const footer = await ui.locator(".thermal-footer").boundingBox();
      assert.ok(
        footer &&
          footer.x >= -1 &&
          footer.x + footer.width <= width + 1 &&
          footer.y + footer.height <= height + 1,
        JSON.stringify({ width, name, footer }),
      );
      assert.equal(
        await ui.evaluate((e) => e.scrollWidth <= e.clientWidth + 2),
        true,
      );
      for (const group of await ui
        .locator(".thermal-footer > .cfx-actions")
        .all()) {
        const heights = await group
          .locator("button")
          .evaluateAll((buttons) =>
            buttons.map((b) => b.getBoundingClientRect().height),
          );
        assert.ok(
          Math.max(...heights) - Math.min(...heights) < 1,
          `Footer buttons align at ${width}px`,
        );
      }
      const colours = await ui
        .locator(".thermal-footer")
        .evaluate((footer) => ({
          primary: getComputedStyle(footer.querySelector(".cfx-primary"))
            .backgroundColor,
          secondary: getComputedStyle(
            footer.querySelector(".cfx-actions button"),
          ).backgroundColor,
        }));
      assert.notEqual(
        colours.primary,
        colours.secondary,
        "Primary actions must retain the shared primary palette",
      );
      if (process.env.BROWSER_ARTIFACTS && (width === 1440 || width === 390))
        await page.screenshot({
          path: path.join(
            process.env.BROWSER_ARTIFACTS,
            `thermal-audit-${style}-${theme}-${width}-step${index + 1}.png`,
          ),
          animations: "disabled",
        });
    }
    if (process.env.BROWSER_ARTIFACTS)
      await page.screenshot({
        path: path.join(
          process.env.BROWSER_ARTIFACTS,
          `thermal-${style}-${theme}-${width}.png`,
        ),
        fullPage: true,
      });
  }
}

test("thermal workflow calculates real balance, saves immutable Apply, exports JSON/CSV and reloads without modifying flow/scalar BCs", async (t) => {
  const p = thermalProject(),
    s = await harness.session(p);
  t.after(() => s.close());
  const ui = await open(s);
  await calculate(ui);
  assert.match(await ui.innerText(), /20 °C/);
  assert.match(await ui.innerText(), /Contract ready/);
  await ui
    .getByRole("button", { name: "Apply to CFD boundaries", exact: true })
    .click();
  const saved = await eventually(
    s.saved,
    (p) => p.cfdScenarios?.[0].thermalSnapshots?.length === 1,
  );
  assert.deepEqual(
    saved.cfdScenarios[0].boundaries,
    p.cfdScenarios[0].boundaries,
  );
  const packageJson = s.page.waitForEvent("download");
  await ui
    .getByRole("button", { name: "Export thermal JSON", exact: true })
    .click();
  const file = await packageJson;
  const contract = JSON.parse(await readFile(await file.path(), "utf8"));
  assert.equal(contract.executed, false);
  assert.equal(contract.runnable, false);
  assert.equal(contract.preview.modelFidelity, "lumped_steady_screening");
  const csvDownload = s.page.waitForEvent("download");
  await ui
    .getByRole("button", { name: "Export surface CSV", exact: true })
    .click();
  assert.match(
    await readFile(await (await csvDownload).path(), "utf8"),
    /"absorbedWm2"/,
  );
  await step(ui, "Location & sun");
  await ui
    .getByRole("spinbutton", {
      name: "Plan north bearing (° clockwise)",
      exact: true,
    })
    .fill("45");
  await ui
    .getByRole("spinbutton", {
      name: "Plan north bearing (° clockwise)",
      exact: true,
    })
    .press("Enter");
  assert.equal(
    await ui
      .getByRole("button", { name: "Apply to CFD boundaries", exact: true })
      .isDisabled(),
    true,
  );
  await eventually(
    s.saved,
    (p) => p.cfdScenarios?.[0].thermalEnvelope?.northDeg === 45,
  );
  await s.page.reload();
  await s.page
    .getByRole("combobox", { name: "Workspace", exact: true })
    .selectOption("CLIMOPTIX");
  await cfdWindow(s.page, "Boundaries");
  await s.page
    .getByRole("button", {
      name: "Thermal Envelope & Solar Conditions",
      exact: true,
    })
    .click();
  const restored = s.page.getByRole("region", {
    name: "Thermal envelope setup",
    exact: true,
  });
  await step(restored, "Location & sun");
  assert.equal(
    await restored
      .getByRole("spinbutton", {
        name: "Plan north bearing (° clockwise)",
        exact: true,
      })
      .inputValue(),
    "45",
  );
  assert.equal(
    (await s.saved()).cfdScenarios[0].thermalSnapshots[0].package.scenario
      .northDeg,
    0,
  );
});

test("thermal source-editor round trip retains surface/study, updates layers and invalidates prior result; overrides reset", async (t) => {
  const s = await harness.session(thermalProject());
  t.after(() => s.close());
  const ui = await open(s);
  const row = ui
    .getByRole("list", { name: "Thermal surfaces" })
    .getByRole("button")
    .filter({ hasText: "Wall 1" })
    .first();
  await row.click();
  await ui
    .getByRole("button", { name: "Edit in Insulation", exact: true })
    .click();
  const editor = s.page.getByRole("region", {
    name: "Energy & Insulation controls",
    exact: true,
  });
  await editor.waitFor({ state: "visible" });
  assert.match(await editor.innerText(), /Analytical wall|Living room/);
  await editor.getByRole("button", { name: /Define wall layers/ }).click();
  const layers = s.page.getByRole("dialog", { name: /Define wall layers/ });
  // Existing editor remains authoritative: Cancel must not mutate the construction.
  await layers.getByRole("button", { name: "Cancel", exact: true }).click();
  await editor.getByRole("button", { name: /Define wall layers/ }).click();
  await layers
    .getByRole("button", { name: "Edit layer 1", exact: true })
    .click();
  await layers
    .getByRole("spinbutton", { name: "Layer 1 thickness mm", exact: true })
    .fill("120");
  await layers
    .getByRole("spinbutton", { name: "Layer 1 thickness mm", exact: true })
    .press("Enter");
  await layers.getByRole("button", { name: "Done", exact: true }).click();
  await eventually(s.saved, (p) =>
    p.energyLayout.assemblies.some((a) =>
      a.layers.some((l) => l.thicknessMm === 120),
    ),
  );
  await s.page
    .getByRole("button", { name: "Return to Climoptix", exact: true })
    .click();
  await ui.waitFor({ state: "visible" });
  await eventually(
    () =>
      ui
        .getByRole("button", { name: "Refresh envelope", exact: true })
        .isEnabled(),
    Boolean,
  );
  await row.click();
  assert.match(
    await ui
      .getByRole("region", { name: "Thermal surface inspector", exact: true })
      .innerText(),
    /120 mm/,
  );
  await ui
    .locator("summary", { hasText: "Advanced · surface override" })
    .click();
  await ui
    .getByRole("spinbutton", {
      name: "Overall / construction U (W/m²K)",
      exact: true,
    })
    .fill("0.5");
  await ui
    .getByRole("spinbutton", {
      name: "Overall / construction U (W/m²K)",
      exact: true,
    })
    .press("Enter");
  await ui
    .getByRole("combobox", { name: "Entered U includes films", exact: true })
    .selectOption("true");
  await ui
    .getByRole("textbox", { name: "Override reason / source", exact: true })
    .fill("Manual measured overall U");
  await ui
    .getByRole("button", { name: "Reset to Insulation", exact: true })
    .click();
  await eventually(
    s.saved,
    (p) =>
      Object.keys(p.cfdScenarios?.[0].thermalEnvelope?.overrides ?? {})
        .length === 0,
  );
});

test("audit: door performance edits use the source Openings tab and reconcile back into the same study", async (t) => {
  const p = thermalProject(false),
    s = await harness.session(p);
  t.after(() => s.close());
  const ui = await open(s);
  await ui
    .getByRole("list", { name: "Thermal surfaces" })
    .getByRole("button")
    .filter({ hasText: "Door ·" })
    .first()
    .click();
  await ui
    .getByRole("button", { name: "Edit in Insulation", exact: true })
    .click();
  const editor = s.page.getByRole("region", {
    name: "Energy & Insulation controls",
    exact: true,
  });
  await editor.waitFor();
  assert.equal(
    await editor
      .getByRole("tab", { name: "Openings", exact: true })
      .getAttribute("aria-selected"),
    "true",
  );
  assert.equal(
    await editor.getByRole("button", { name: /Define .* layers/ }).count(),
    0,
    "A door's complete system U must not use the wall layer editor",
  );
  const uValue = editor.getByRole("spinbutton", {
    name: "Opening overall U W/m²K",
    exact: true,
  });
  await uValue.fill("2.1");
  await uValue.press("Enter");
  await eventually(s.saved, (project) =>
    project.energyLayout.existingAssignments.some(
      (a) =>
        a.elementId.endsWith("|opening:shared-aperture") && a.uValue === 2.1,
    ),
  );
  await s.page
    .getByRole("button", { name: "Return to Climoptix", exact: true })
    .click();
  await eventually(
    () =>
      ui
        .getByRole("region", { name: "Thermal surface inspector", exact: true })
        .innerText(),
    (text) => /Original source U: 2.1/.test(text),
  );
  // The source editor hydrates optional finish metadata. Assert authoritative
  // dimensions/topology and the representation ID, not empty colour defaults.
  const geometry = (project) =>
    project.rooms.map((r) => ({
      vertices: r.vertices,
      openings: r.openings.map(({ metadata, ...opening }) => ({
        ...opening,
        representationKey: metadata?.representation_key,
      })),
    }));
  assert.deepEqual(geometry(await s.saved()), geometry(p));
  assert.equal((await s.saved()).cfdScenarios[0].id, p.cfdScenarios[0].id);
});

test("thermal UI audit covers all steps, help, keyboard, resizing and light/dark desktop/tablet/mobile", async (t) => {
  const s = await harness.session(thermalProject());
  t.after(() => s.close());
  const ui = await open(s);
  await calculate(ui);
  for (const theme of ["light", "dark"]) {
    await menu(s.page, "Settings", "Preferences…");
    const preferences = s.page.getByRole("dialog", {
      name: "Preferences",
      exact: true,
    });
    await preferences
      .getByRole("button", {
        name: theme === "dark" ? "Dark" : "Light",
        exact: true,
      })
      .click();
    await preferences
      .getByRole("button", { name: "Close settings", exact: true })
      .click();
    assert.equal(
      await s.page.locator("html").getAttribute("data-theme"),
      theme,
    );
    await layoutMatrix(ui, s.page, theme);
  }
  await ui
    .getByRole("button", {
      name: "Help for Thermal envelope help",
      exact: true,
    })
    .click();
  assert.match(
    await s.page
      .getByRole("article", {
        name: "Help for Thermal envelope help",
        exact: true,
      })
      .innerText(),
    /Screening, not CFD|One construction source/,
  );
  await s.page.keyboard.press("Escape");
  await step(ui, "Weather / scenario");
  await ui.locator("summary", { hasText: "Import an hourly EPW file" }).click();
  await ui.locator('input[type="file"]').setInputFiles({
    name: "bad.epw",
    mimeType: "text/plain",
    buffer: Buffer.from("invalid"),
  });
  await ui.getByRole("alert").filter({ hasText: "LOCATION" }).waitFor();
});

test("modern thermal window uses actual configured design tokens, can drag/resize, and supports both themes", async (t) => {
  const defaults = JSON.parse(
    await readFile(
      new URL("../../../data/ui_theme_defaults.json", import.meta.url),
      "utf8",
    ),
  );
  const s = await harness.session(thermalProject());
  t.after(() => s.close());
  await s.context.route("**/engineering-api/settings", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ ui: { ...defaults, style: "MODERN" } }),
    }),
  );
  await s.page.reload();
  const ui = await open(s);
  await calculate(ui);
  await eventually(
    () => s.page.locator("body").getAttribute("data-ui-style"),
    (style) => style === "modern",
  );
  const window = s.page.locator(".cfx-setup-window"),
    before = await window.boundingBox(),
    header = await window.locator(".floating-toolbar-titlebar").boundingBox();
  await s.page.mouse.move(header.x + 120, header.y + header.height / 2);
  await s.page.mouse.down();
  await s.page.mouse.move(header.x + 180, header.y + header.height / 2 + 20, {
    steps: 8,
  });
  await s.page.mouse.up();
  const moved = await window.boundingBox();
  assert.ok(moved.x >= before.x + 40);
  const edge = await window
    .locator(".floating-toolbar-resize-right")
    .boundingBox();
  await s.page.mouse.move(edge.x + edge.width / 2, edge.y + edge.height / 2);
  await s.page.mouse.down();
  await s.page.mouse.move(edge.x - 140, edge.y + edge.height / 2, { steps: 8 });
  await s.page.mouse.up();
  assert.ok((await window.boundingBox()).width < moved.width - 80);
  for (const theme of ["light", "dark"]) {
    await menu(s.page, "Settings", "Preferences…");
    const preferences = s.page.getByRole("dialog", {
      name: "Preferences",
      exact: true,
    });
    await preferences
      .getByRole("button", {
        name: theme === "dark" ? "Dark" : "Light",
        exact: true,
      })
      .click();
    await preferences
      .getByRole("button", { name: "Close settings", exact: true })
      .click();
    assert.equal(
      await s.page.locator("html").getAttribute("data-theme"),
      theme,
    );
    await layoutMatrix(ui, s.page, theme, "modern");
  }
});

test("thermal missing-data, invalid-input and service-error states never fabricate results or discard settings", async (t) => {
  const p = thermalProject();
  delete p.energyLayout;
  const s = await harness.session(p);
  t.after(() => s.close());
  const ui = await open(s);
  assert.match(
    await ui.getByRole("list", { name: "Thermal surfaces" }).innerText(),
    /incomplete/,
  );
  await ui
    .getByRole("button", { name: "Calculate & preview", exact: true })
    .click();
  await eventually(
    () => ui.innerText(),
    (text) => text.includes("no Heating fallback is permitted"),
  );
  assert.equal(
    await ui
      .getByRole("button", { name: "Apply to CFD boundaries", exact: true })
      .isDisabled(),
    true,
  );
  await step(ui, "Gains & ventilation");
  await ui
    .getByRole("button", { name: "+ Internal gain", exact: true })
    .click();
  await ui.getByRole("spinbutton", { name: "Count", exact: true }).fill("1.5");
  await ui
    .getByRole("spinbutton", { name: "Count", exact: true })
    .press("Enter");
  await ui.getByRole("alert").filter({ hasText: "whole number" }).waitFor();
  await ui.getByRole("spinbutton", { name: "Count", exact: true }).fill("2");
  await ui
    .getByRole("spinbutton", { name: "Count", exact: true })
    .press("Enter");
  await eventually(
    s.saved,
    (p) => p.cfdScenarios[0].thermalEnvelope.gains[0]?.count === 2,
  );
  await s.context.route("**/climoptix/thermal-preview", (route) =>
    route.fulfill({
      status: 503,
      contentType: "application/json",
      body: JSON.stringify({
        detail: "Thermal dependencies are unavailable on this service.",
      }),
    }),
  );
  await ui
    .getByRole("button", { name: "Calculate & preview", exact: true })
    .click();
  await ui
    .getByRole("alert")
    .filter({ hasText: "dependencies are unavailable" })
    .waitFor();
  assert.equal(
    (await s.saved()).cfdScenarios[0].thermalEnvelope.gains[0].count,
    2,
  );
});

test("audit: invalid numeric drafts cannot be calculated or silently lost when navigating", async (t) => {
  const s = await harness.session(thermalProject());
  t.after(() => s.close());
  const ui = await open(s);
  await step(ui, "Gains & ventilation");
  await ui
    .getByRole("button", { name: "+ Internal gain", exact: true })
    .click();
  const count = ui.getByRole("spinbutton", { name: "Count", exact: true });
  await count.fill("1.5");
  await count.press("Enter");
  let calculations = 0;
  s.page.on("request", (request) => {
    if (request.url().endsWith("/thermal-preview")) calculations++;
  });
  await ui
    .getByRole("button", { name: "Calculate & preview", exact: true })
    .click();
  assert.equal(
    calculations,
    0,
    "A visibly invalid value must not calculate its previous saved value",
  );
  await ui.getByRole("button", { name: "Next", exact: true }).click();
  assert.equal(
    await count.isVisible(),
    true,
    "Invalid drafts must not disappear on step navigation",
  );
  await count.press("Escape");
  assert.equal(await count.inputValue(), "1");
  await ui.getByRole("button", { name: "Next", exact: true }).click();
  assert.equal(
    await ui
      .getByRole("heading", {
        name: "Transparent modelling assumptions",
        exact: true,
      })
      .isVisible(),
    true,
  );
  await step(ui, "Envelope & insulation");
  await ui
    .getByRole("list", { name: "Thermal surfaces" })
    .getByRole("button")
    .filter({ hasText: "Wall 1" })
    .first()
    .click();
  const details = ui
    .locator("details")
    .filter({ hasText: "Advanced · surface override" });
  await details.locator("summary").click();
  const uValue = ui.getByRole("spinbutton", {
    name: "Overall / construction U (W/m²K)",
    exact: true,
  });
  await uValue.fill("0");
  await uValue.press("Enter");
  await details.locator("summary").click();
  await ui
    .getByRole("button", { name: "Calculate & preview", exact: true })
    .click();
  assert.equal(
    await details.evaluate((e) => e.open),
    true,
    "Invalid fields inside closed details must be revealed",
  );
  assert.equal(
    await uValue.evaluate((e) => e === document.activeElement),
    true,
  );
  assert.equal(calculations, 0);
});

test("audit: gain names can be replaced naturally and blank drafts are explained without reverting typing", async (t) => {
  const s = await harness.session(thermalProject());
  t.after(() => s.close());
  const ui = await open(s);
  await step(ui, "Gains & ventilation");
  await ui
    .getByRole("button", { name: "+ Internal gain", exact: true })
    .click();
  const name = ui.getByRole("textbox", { name: "Gain name", exact: true });
  await name.focus();
  await name.press("ControlOrMeta+A");
  await name.press("Backspace");
  assert.equal(
    await name.inputValue(),
    "",
    "Clearing a name to replace it must not reinsert the old value",
  );
  await name.pressSequentially("Occupants");
  await name.press("Tab");
  await eventually(
    s.saved,
    (p) => p.cfdScenarios[0].thermalEnvelope.gains[0]?.name === "Occupants",
  );
  await name.fill("");
  await name.press("Enter");
  await ui.getByRole("alert").filter({ hasText: "Enter a name" }).waitFor();
  await ui.getByRole("button", { name: "Next", exact: true }).click();
  assert.equal(await name.isVisible(), true);
  if (process.env.BROWSER_ARTIFACTS)
    await s.page.screenshot({
      path: path.join(
        process.env.BROWSER_ARTIFACTS,
        "thermal-audit-gain-name-error.png",
      ),
      animations: "disabled",
    });
  await name.press("Escape");
  assert.equal(await name.inputValue(), "Occupants");
});

test("audit: uncalculated totals stay unavailable and north bearing stays explicit in the 3D-only workbench", async (t) => {
  const s = await harness.session(thermalProject());
  t.after(() => s.close());
  const ui = await open(s);
  const search = ui.getByRole("searchbox", {
    name: "Find envelope surface",
    exact: true,
  });
  await search.fill("Wall 1");
  const surfaces = ui
    .getByRole("list", { name: "Thermal surfaces" })
    .getByRole("button");
  assert.ok(
    (await surfaces.count()) > 0,
    "Search must match the visible 1-based wall label",
  );
  for (const row of await surfaces.all())
    assert.match(await row.innerText(), /Wall 1/);
  await search.fill("");
  assert.doesNotMatch(
    await surfaces.first().innerText(),
    /Opening reveal/,
    "Useful envelope faces precede inapplicable reveals",
  );
  await step(ui, "Review & apply");
  assert.equal(
    await ui
      .locator(".thermal-summary strong")
      .filter({ hasText: "Not available" })
      .count(),
    3,
  );
  assert.doesNotMatch(
    await ui.locator(".thermal-summary").innerText(),
    /0 W\/K/,
  );
  await step(ui, "Location & sun");
  const bearing = ui.getByRole("spinbutton", {
    name: "Plan north bearing (° clockwise)",
    exact: true,
  });
  await bearing.fill("45");
  await bearing.press("Enter");
  const arrows = [ui.locator(".thermal-compass > span")];
  for (const arrow of arrows) {
    assert.equal((await arrow.innerText()).trim(), "↓ N");
    assert.equal(
      await arrow.evaluate((e) => e.style.transform),
      "rotate(45deg)",
    );
  }
});

test("audit: a failed calculation in one study cannot show an error in another study", async (t) => {
  const p = thermalProject(),
    second = duplicateCFDScenario(p.cfdScenarios[0]);
  second.name = "Second thermal study";
  p.cfdScenarios.push(second);
  const s = await harness.session(p);
  t.after(() => s.close());
  const ui = await open(s);
  let held;
  await s.context.route("**/climoptix/thermal-preview", (route) => {
    held = route;
  });
  await ui
    .getByRole("button", { name: "Calculate & preview", exact: true })
    .click();
  await eventually(() => !!held, Boolean);
  // The active-study selector now stays in the shared setup header; keep Thermal visible.
  await s.page
    .getByRole("combobox", { name: "CFD scenario", exact: true })
    .selectOption(second.id);
  assert.equal(
    await ui
      .getByRole("button", { name: "Calculate & preview", exact: true })
      .isEnabled(),
    true,
    "A request in another study must not disable this study's actions",
  );
  await held.fulfill({
    status: 503,
    contentType: "application/json",
    body: JSON.stringify({ detail: "First study calculation failed." }),
  });
  await s.page.waitForLoadState("networkidle");
  assert.doesNotMatch(await ui.innerText(), /First study calculation failed/);
  assert.match(
    await ui.getByRole("heading", { level: 2 }).innerText(),
    /Second thermal study/,
  );
});

test("audit: a delayed EPW import preserves newer edits on other steps", async (t) => {
  const s = await harness.session(thermalProject());
  t.after(() => s.close());
  const ui = await open(s);
  let finishImport;
  const imported = new Promise((resolve) => {
    finishImport = resolve;
  });
  let started = false;
  await s.context.route("**/climoptix/thermal-epw", async (route) => {
    started = true;
    await imported;
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        location: {
          ...thermalProject().cfdScenarios[0].thermalEnvelope.location,
          fixedUtcOffsetMinutes: 0,
        },
        source: "Offline EPW import fixture",
        rejectedRows: 0,
        timeConvention: "Hourly midpoint · local standard time",
        records: [
          {
            index: 0,
            localDateTime: "2026-06-21T00:30",
            temperatureC: 18,
            relativeHumidity: 0.5,
            windMS: 2,
            ghiWm2: 0,
            dniWm2: 0,
            dhiWm2: 0,
          },
        ],
      }),
    });
  });
  await step(ui, "Weather / scenario");
  await ui.locator("summary", { hasText: "Import an hourly EPW file" }).click();
  await ui.locator('input[type="file"]').setInputFiles({
    name: "offline.epw",
    mimeType: "text/plain",
    buffer: Buffer.from("Transport-only delayed import fixture"),
  });
  await eventually(() => started, Boolean);
  await step(ui, "Location & sun");
  const bearing = ui.getByRole("spinbutton", {
    name: "Plan north bearing (° clockwise)",
    exact: true,
  });
  await bearing.fill("70");
  await bearing.press("Enter");
  await eventually(
    s.saved,
    (p) => p.cfdScenarios[0].thermalEnvelope.northDeg === 70,
  );
  finishImport();
  const saved = await eventually(s.saved, (p) =>
    p.cfdScenarios[0].thermalEnvelope.weather.epwRecord.includes("00:30"),
  );
  assert.equal(
    saved.cfdScenarios[0].thermalEnvelope.northDeg,
    70,
    "An asynchronous upload must not restore an older study snapshot",
  );
  assert.equal(await bearing.inputValue(), "70");
});

test("audit: a narrow manually resized desktop window keeps all steps and actions usable", async (t) => {
  const s = await harness.session(thermalProject());
  t.after(() => s.close());
  const ui = await open(s);
  const window = s.page.locator(".cfx-setup-window");
  const bounds = await window.boundingBox();
  const edge = await window
    .locator(".floating-toolbar-resize-right")
    .boundingBox();
  await s.page.mouse.move(edge.x + edge.width / 2, edge.y + edge.height / 2);
  await s.page.mouse.down();
  await s.page.mouse.move(bounds.x + 450, edge.y + edge.height / 2, {
    steps: 12,
  });
  await s.page.mouse.up();
  assert.ok((await window.boundingBox()).width < 520);
  for (let index = 0; index < 6; index++) {
    await ui
      .getByRole("navigation", { name: "Thermal setup steps" })
      .getByRole("button")
      .nth(index)
      .click();
    assert.equal(
      await ui
        .locator(".thermal-scroll")
        .evaluate((e) => e.scrollWidth <= e.clientWidth + 2),
      true,
      `Step ${index + 1} must fit the resized window`,
    );
    const panel = await window.boundingBox();
    for (const action of ["Calculate & preview", "Apply to CFD boundaries"]) {
      const box = await ui
        .getByRole("button", { name: action, exact: true })
        .boundingBox();
      assert.ok(
        box.x >= panel.x && box.x + box.width <= panel.x + panel.width + 1,
        `${action} stays inside the window`,
      );
    }
    if (process.env.BROWSER_ARTIFACTS)
      await s.page.screenshot({
        path: path.join(
          process.env.BROWSER_ARTIFACTS,
          `thermal-audit-narrow-${index + 1}.png`,
        ),
      });
  }
});
