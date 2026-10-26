import assert from 'node:assert/strict';
import test, { before, after } from 'node:test';
import { cfdProject } from '../climoptixFixtures';
import { realThermal } from '../thermalFixtures';
import { cfdWindow, eventually, startBrowserHarness } from './harness.mjs';

let harness;
before(async () => { harness = await startBrowserHarness({ climoptixEnabled: true }); });
after(async () => { await harness?.close(); });

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
