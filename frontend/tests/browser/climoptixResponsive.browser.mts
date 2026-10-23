import assert from "node:assert/strict";
import test, { before, after } from "node:test";
import { cfdProject, realPreparation } from "../climoptixFixtures";
import { realThermal } from "../thermalFixtures";
import { eventually, startBrowserHarness } from "./harness.mjs";

let harness;
before(async () => {
  harness = await startBrowserHarness();
});
after(async () => {
  await harness?.close();
});

async function open(t, options = {}) {
  const session = await harness.session(cfdProject(), options);
  t.after(() => session.close());
  await session.context.route("**/climoptix/prepare", (route) =>
    route.fulfill({
      contentType: "application/json",
      body: JSON.stringify(realPreparation(route.request().postDataJSON())),
    }),
  );
  await session.context.route("**/climoptix/thermal-envelope", (route) =>
    route.fulfill({
      contentType: "application/json",
      body: JSON.stringify(realThermal(route.request().postDataJSON(), false)),
    }),
  );
  await session.page
    .getByRole("combobox", { name: "Workspace", exact: true })
    .selectOption("CLIMOPTIX");
  const ui = session.page.getByRole("region", {
    name: "Climoptix CFD workspace",
    exact: true,
  });
  await ui.getByLabel("Move Simulation setup", { exact: true }).waitFor();
  return { ...session, ui };
}

test("mobile and tablet use a single phase selector; every available phase remains usable in both themes", async (t) => {
  const { page, ui, saved } = await open(t);
  const phase = ui.getByRole("combobox", { name: "CFD phase", exact: true });
  for (const theme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme: theme });
    for (const width of [390, 768, 1024]) {
      await page.setViewportSize({ width, height: 900 });
      await phase.waitFor();
      assert.equal(
        await ui
          .getByRole("tablist", { name: "Climoptix setup", exact: true })
          .count(),
        0,
      );
      const header = await ui.locator(".cfx-setup-heading").boundingBox();
      assert.ok(
        header.height < 100,
        "Study and phase share one compact header",
      );
      assert.equal(
        await phase.locator('option[value="mesh"]').textContent(),
        "Solver",
      );
      assert.equal(
        await phase.locator('option[value="boundaries"]').textContent(),
        "Bounds",
      );
      const resultOption = phase.locator('option[value="results"]');
      assert.ok(
        await resultOption.evaluate((option) => option.disabled),
        await resultOption.evaluate((option) => option.outerHTML),
      );
      for (const id of [
        "studies",
        "domain",
        "equipment",
        "boundaries",
        "physics",
        "mesh",
        "review",
      ]) {
        await phase.selectOption(id);
        assert.equal(await phase.inputValue(), id);
        const panel = ui.locator(`#cfx-setup-panel-${id}`);
        await panel.waitFor();
        assert.equal(
          await panel.evaluate((n) => n.scrollWidth > n.clientWidth + 2),
          false,
          `${id} horizontal overflow at ${width}px`,
        );
        const box = await panel.boundingBox();
        assert.ok(
          box.height > 350,
          `${id} should use the available window height: ${JSON.stringify(box)}`,
        );
        assert.equal(await ui.locator(".floating-toolbar").count(), 1);
        if (id === "studies") {
          const row = panel.locator(".cfx-study-row").first();
          const name = await row.locator("strong").boundingBox();
          const status = await row.locator(".cfx-study-name small").boundingBox();
          assert.ok(Math.abs(name.y + name.height / 2 - status.y - status.height / 2) < 2,
            "Name and status stay inline on compact screens");
          const actions = await row.locator(".cfx-study-actions > button").evaluateAll((buttons) =>
            buttons.map((button) => ({ y: button.getBoundingClientRect().y, height: button.getBoundingClientRect().height })));
          assert.ok(Math.max(...actions.map((b) => b.y)) - Math.min(...actions.map((b) => b.y)) < 1,
            "Per-study actions share a row on mobile and tablet");
          assert.ok(actions.every((b) => b.height >= 36 && b.height <= 44));
          if (process.env.BROWSER_ARTIFACTS)
            await page.screenshot({ path: `${process.env.BROWSER_ARTIFACTS}/cfd-studies-${theme}-${width}.png` });
        }
      }
      await phase.selectOption("mesh");
      await ui.getByRole("tab", { name: "Run", exact: true }).click();
      assert.ok(
        await ui
          .getByRole("button", { name: "Run solver", exact: true })
          .isDisabled(),
      );
      assert.equal(
        await ui.locator(".cfx-notice:visible").count(),
        0,
        "The run form has compact connection status, not an instructional banner",
      );
      const cpu = ui.getByRole("spinbutton", {
        name: "CPU cores",
        exact: true,
      });
      await cpu.fill("8");
      await cpu.press("Enter");
      await eventually(saved, (p) => p.cfdScenarios[0].resources.cpu === 8);
      if (process.env.BROWSER_ARTIFACTS)
        await page.screenshot({
          path: `${process.env.BROWSER_ARTIFACTS}/cfd-compact-${theme}-${width}.png`,
        });
    }
  }
  await page.setViewportSize({ width: 1440, height: 1000 });
  await eventually(
    () => phase.isVisible(),
    (visible) => !visible,
  );
  const tabs = ui.getByRole("tablist", {
    name: "Climoptix setup",
    exact: true,
  });
  assert.equal(await tabs.getByRole("tab").count(), 8);
  assert.equal(
    await tabs
      .getByRole("tab", { name: "Solver", exact: true })
      .getAttribute("aria-selected"),
    "true",
  );
  assert.equal(
    await ui
      .getByRole("spinbutton", { name: "CPU cores", exact: true })
      .inputValue(),
    "8",
  );
  const widths = await tabs
    .getByRole("tab")
    .evaluateAll((nodes) => nodes.map((n) => n.getBoundingClientRect().width));
  assert.ok(Math.max(...widths) - Math.min(...widths) < 1);
  await tabs.getByRole("tab", { name: "Solver", exact: true }).press("Home");
  assert.equal(
    await tabs
      .getByRole("tab", { name: "Simulations", exact: true })
      .getAttribute("aria-selected"),
    "true",
  );
  await tabs.getByRole("tab", { name: "Bounds", exact: true }).click();
  await ui.getByRole("tab", { name: "Thermal", exact: true }).click();
  assert.equal(
    await ui
      .getByRole("combobox", { name: "Thermal step", exact: true })
      .isVisible(),
    false,
  );
  assert.ok(
    await ui
      .getByRole("navigation", { name: "Thermal setup steps", exact: true })
      .isVisible(),
  );
});

test("a narrow resized laptop window switches navigation without losing the selected phase", async (t) => {
  const { page, ui } = await open(t);
  const edge = ui.getByRole("button", {
    name: "Resize Simulation setup from the right edge",
    exact: true,
  });
  const resize = async (delta: number) => {
    const box = await edge.boundingBox();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(
      box.x + box.width / 2 + delta,
      box.y + box.height / 2,
      { steps: 8 },
    );
    await page.mouse.up();
  };
  await resize(-350);
  const select = ui.getByRole("combobox", { name: "CFD phase", exact: true });
  await select.waitFor();
  await select.selectOption("domain");
  await ui.getByRole("combobox", { name: "Seed room", exact: true }).waitFor();
  await resize(350);
  await eventually(
    () => select.isVisible(),
    (visible) => !visible,
  );
  assert.equal(
    await ui
      .getByRole("tab", { name: "Domain", exact: true })
      .getAttribute("aria-selected"),
    "true",
  );
});

test("landscape touch tablets use selectors; guidance is in contextual help and thermal navigation preserves invalid drafts", async (t) => {
  const { page, ui } = await open(t, {
    viewport: { width: 1280, height: 900 },
    hasTouch: true,
  });
  const phase = ui.getByRole("combobox", { name: "CFD phase", exact: true });
  await phase.waitFor();
  await phase.selectOption("domain");
  assert.doesNotMatch(await ui.innerText(), /Only permanent doorless passages/);
  await ui
    .getByRole("button", { name: "Help for Climoptix CFD", exact: true })
    .click();
  const help = page.getByRole("article", {
    name: "Help for Climoptix CFD",
    exact: true,
  });
  await help
    .getByRole("heading", { name: "Choose the simulation volume", exact: true })
    .waitFor();
  assert.match(await help.innerText(), /Doors and windows stop discovery/);
  await page.keyboard.press("Escape");
  await phase.selectOption("boundaries");
  await ui.getByRole("tab", { name: "Thermal", exact: true }).click();
  const thermal = ui.getByRole("region", {
    name: "Thermal envelope setup",
    exact: true,
  });
  const step = thermal.getByRole("combobox", {
    name: "Thermal step",
    exact: true,
  });
  await step.waitFor();
  await step.selectOption("1");
  const latitude = thermal.getByRole("spinbutton", {
    name: "Latitude (° north)",
    exact: true,
  });
  await latitude.fill("999");
  await step.selectOption("2");
  assert.equal(
    await step.inputValue(),
    "1",
    "An invalid draft must not be lost when choosing a step",
  );
  assert.ok(await latitude.isVisible());
  await latitude.fill("51.5");
  await latitude.press("Enter");
  await step.selectOption("2");
  assert.equal(await step.inputValue(), "2");
  const solar = thermal.getByRole("combobox", {
    name: "Solar forcing",
    exact: true,
  });
  await solar.selectOption("perSurface");
  assert.doesNotMatch(
    await thermal.innerText(),
    /Use Envelope → Advanced surface override/,
  );
  await thermal
    .getByRole("button", {
      name: "Help for Thermal envelope help",
      exact: true,
    })
    .click();
  const thermalHelp = page.getByRole("article", {
    name: "Help for Thermal envelope help",
    exact: true,
  });
  assert.match(
    await thermalHelp.innerText(),
    /Preset names are labels, not regulatory design conditions/,
  );
  assert.match(await thermalHelp.innerText(), /Advanced surface override/);
  await page.keyboard.press("Escape");
  await phase.selectOption("mesh");
  await ui
    .getByRole("button", {
      name: "Help for Mesh, Run & Post-processing",
      exact: true,
    })
    .click();
  const solverHelp = page.getByRole("article", {
    name: "Help for Mesh, Run & Post-processing",
    exact: true,
  });
  assert.match(await solverHelp.innerText(), /not a runnable case/);
  assert.match(await solverHelp.innerText(), /VTU volumes/);
  await page.keyboard.press("Escape");
  assert.equal(await ui.locator(".floating-toolbar").count(), 1);
});
