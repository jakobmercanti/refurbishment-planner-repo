import assert from 'node:assert/strict';
import test, { before, after } from 'node:test';
import { cfdProject, realPreparation } from '../climoptixFixtures';
import { ventSchema } from '../../lib/climoptixDocument';
import { realThermal } from '../thermalFixtures';
import { cfdWindow, eventually, startBrowserHarness } from './harness.mjs';

let harness;
before(async () => { harness = await startBrowserHarness({ climoptixEnabled: true }); });
after(async () => { await harness?.close(); });

test("compact CFD diagnostics highlight a vent and thermal surface without changing tabs", async t => {
  const project = cfdProject();
  const scenario = project.cfdScenarios[0];
  const report = realPreparation({ project, scenario, clientRevision: "a".repeat(64) });
  const host = report.patches.find(patch => patch.kind === "wall" && patch.hostable && patch.host);
  assert.ok(host);
  scenario.vents = [ventSchema.parse({ id: "test-vent-id", name: "Test supply", role: "supply", host: { patchId: host.id } })];
  const session = await harness.session(project, { viewport: { width: 1700, height: 1000 } });
  t.after(() => session.close());
  await session.context.route("**/climoptix/prepare", async route => {
    const report = realPreparation(route.request().postDataJSON());
    const floor = report.patches.find(patch => patch.kind === "floor");
    assert.ok(floor);
    report.diagnostics.unshift(
      { severity: "warning", code: "test-vent", message: "Check the supply clearance.", repair: "Move it away from the corner.", group: "vents", objectId: "test-vent-id" },
      { severity: "warning", code: "test-floor", message: "Check the floor U-value.", repair: "Review floor construction.", group: "boundaries", objectId: `${floor.id}:thermal:ground:floor` },
    );
    await route.fulfill({ json: report });
  });
  const { page } = session, ui = page.locator(".cfx-workspace"), viewport = ui.locator(".cfx-viewport");
  await page.getByRole("combobox", { name: "Workspace", exact: true }).selectOption("CLIMOPTIX");
  await eventually(() => ui.getAttribute("data-preparation-state"), state => state === "checked");
  const status = ui.getByLabel("Simulation readiness", { exact: true });
  assert.ok((await status.boundingBox()).width < 630);
  await status.getByRole("button", { name: "Review issues", exact: true }).click();
  const warnings = ui.getByRole("tab", { name: "Warnings & checks", exact: true });
  const vent = ui.locator(".cfx-diagnostic-row").filter({ hasText: "Check the supply clearance." });
  const floor = ui.locator(".cfx-diagnostic-row").filter({ hasText: "Check the floor U-value." });
  assert.ok((await vent.boundingBox()).height < 100);
  assert.match(await vent.innerText(), /inlet_1/);
  assert.doesNotMatch(await vent.innerText(), /test-vent-id|Move it away from the corner/);
  await vent.hover();
  await eventually(() => viewport.getAttribute("data-diagnostic-highlight"), value => value === "Test supply");
  await floor.hover();
  await eventually(() => viewport.getAttribute("data-diagnostic-highlight"), value => value !== null && value !== "Test supply");
  assert.equal(await warnings.getAttribute("aria-selected"), "true");
  await warnings.hover();
  await eventually(() => viewport.getAttribute("data-diagnostic-highlight"), value => value === null);
  await vent.getByRole("button", { name: "Inspect inlet_1", exact: true }).focus();
  await eventually(() => viewport.getAttribute("data-diagnostic-highlight"), value => value === "Test supply");
  await warnings.focus();
  await eventually(() => viewport.getAttribute("data-diagnostic-highlight"), value => value === null);
  await floor.getByRole("button", { name: /^Inspect / }).click();
  await ui.getByRole("tab", { name: "Bounds", exact: true }).waitFor();
  await page.getByRole("dialog", { name: "Edit boundary surface", exact: true }).waitFor();
});

test("clicking a measured CFD face opens its boundary editor", async t => {
  const { page, close } = await harness.session(cfdProject(), { viewport: { width: 1700, height: 1000 } });
  t.after(close);
  await page.getByRole("combobox", { name: "Workspace", exact: true }).selectOption("CLIMOPTIX");
  const ui = page.locator(".cfx-workspace");
  await eventually(() => ui.getAttribute("data-preparation-state"), state => state === "checked");
  await ui.getByRole("button", { name: "Hide Simulation setup", exact: true }).click();
  const canvas = ui.locator(".cfx-viewport canvas");
  await canvas.waitFor();
  const box = await canvas.boundingBox();
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  const editor = page.getByRole("dialog", { name: "Edit boundary surface", exact: true });
  await editor.waitFor();
  assert.ok(await editor.locator("select").count() > 0);
});

test('shared invalid-input feedback stays singular when returning to Thermal and links to issues', async t => {
  const session = await harness.session(cfdProject()); t.after(() => session.close());
  const { page, saved } = session;
  let thermalResponses = 0;
  await session.context.route('**/climoptix/thermal-envelope', async route => {
    await route.fulfill({ json: realThermal(route.request().postDataJSON(), false) }); thermalResponses++;
  });
  await page.getByRole('combobox', { name: 'Workspace', exact: true }).selectOption('CLIMOPTIX');
  const ui = page.locator('.cfx-workspace');
  await eventually(() => ui.getAttribute('data-preparation-state'), state => state === 'checked');
  await cfdWindow(ui, 'Thermal Envelope & Solar Conditions');
  await ui.getByRole('region', { name: 'Thermal envelope setup', exact: true }).waitFor();
  assert.ok(await ui.getByRole('tab', { name: 'Conditions', exact: true }).isVisible(), 'Boundary navigation remains available while the independent thermal editor is open');
  const thermalTabs = ui.getByRole("tablist", { name: "Boundary setup", exact: true }).filter({ visible: true });
  const [conditions, thermal] = await Promise.all((await thermalTabs.getByRole("tab").all()).map(tab => tab.boundingBox()));
  assert.equal(conditions.width, thermal.width);
  assert.ok(conditions.width > 120);
  await eventually(() => thermalResponses, count => count > 0);
  await cfdWindow(ui, 'Physics');
  const density = ui.getByRole('spinbutton', { name: 'Air density (kg/m³)', exact: true });
  await density.fill('1000'); await density.press('Enter');
  const invalid = ui.getByRole('alert').filter({ hasText: 'Changes not applied' });
  await invalid.waitFor(); assert.equal(await invalid.count(), 1);
  await cfdWindow(ui, 'Thermal Envelope & Solar Conditions');
  await invalid.waitFor(); assert.equal(await invalid.count(), 1);
  assert.equal((await saved()).cfdScenarios[0].physics.densityKgM3, 1.204);
  await ui.getByRole('button', { name: 'Review issues', exact: true }).click();
  const warnings = ui.getByRole('tab', { name: 'Warnings & checks', exact: true });
  assert.equal(await warnings.getAttribute('aria-selected'), 'true');
  await ui.getByRole('button', { name: 'Keep saved values', exact: true }).click();
  assert.equal(await ui.getByRole('alert').filter({ hasText: 'Changes not applied' }).count(), 0);
});
