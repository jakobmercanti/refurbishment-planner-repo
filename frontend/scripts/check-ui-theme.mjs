import { createRequire } from 'node:module';
import { mkdir } from 'node:fs/promises';
import assert from 'node:assert/strict';
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const origin = process.env.PREVIEW_ORIGIN || 'http://localhost:3000';
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
const installPaletteFixture = async () => {
  await page.evaluate(() => {
    document.querySelector('#theme-palette-fixture')?.remove();
    document.body.insertAdjacentHTML('beforeend', `
      <section id="theme-palette-fixture" class="full-plan-page">
        <div class="editor-intro"><h1>Draw the complete floorplan</h1></div>
        <svg aria-hidden="true">
          <path class="wall-body" d="M0 0h10" />
          <text class="wall-label" x="0" y="0">2500 mm</text>
          <circle class="vertex-handle" cx="0" cy="0" r="5" />
          <text class="vertex-label" x="0" y="0">1</text>
          <g class="wall-dimension"><path class="dimension-line" d="M0 10h10" /></g>
        </svg>
      </section>
    `);
  });
};
let previous;
try {
  await page.goto(origin);
  previous = await page.evaluate(async () => (await (await fetch('/engineering-api/settings')).json()).ui);
  assert.ok(previous?.themes.MODERN);
  await page.getByRole('button', { name: 'Tools', exact: true }).click();
  await page.getByRole('button', { name: 'Object catalogue manager…', exact: true }).click();
  await page.getByRole('tab', { name: 'UI style', exact: true }).click();
  await page.getByLabel('Interface style', { exact: true }).selectOption('MODERN');
  await page.waitForFunction(() => document.body.dataset.uiStyle === 'modern');
  assert.equal(await page.evaluate(() => getComputedStyle(document.body).getPropertyValue('--accent').trim()), '#0877e8');
  await installPaletteFixture();
  const modernPalette = await page.locator('#theme-palette-fixture .wall-body').evaluate((element) => {
    const wall = getComputedStyle(element);
    const root = element.closest('.full-plan-page');
    const label = getComputedStyle(root?.querySelector('.wall-label'));
    const corner = getComputedStyle(root?.querySelector('.vertex-handle'));
    const dimension = getComputedStyle(root?.querySelector('.dimension-line'));
    const title = getComputedStyle(root?.querySelector('.editor-intro h1'));
    return { wall: wall.stroke, label: label.fill, corner: corner.stroke, dimension: dimension.stroke, title: title.color };
  });
  assert.deepEqual(modernPalette, { wall: 'rgb(6, 23, 55)', label: 'rgb(6, 23, 55)', corner: 'rgb(6, 23, 55)', dimension: 'rgb(6, 23, 55)', title: 'rgb(6, 23, 55)' });
  await page.mouse.move(10, 10);
  assert.equal(await page.getByRole('tab', { name: 'UI style', exact: true }).evaluate((el) => getComputedStyle(el).backgroundColor), 'rgb(6, 23, 55)');
  await mkdir('../output/theme-check', { recursive: true });
  await page.screenshot({ path: '../output/theme-check/Modern.png' });
  await page.reload();
  await page.waitForFunction(() => document.body.dataset.uiStyle === 'modern');
  await page.getByRole('button', { name: 'Tools', exact: true }).click();
  await page.getByRole('button', { name: 'Object catalogue manager…', exact: true }).click();
  await page.getByRole('tab', { name: 'UI style', exact: true }).click();
  await page.getByLabel('Interface style', { exact: true }).selectOption('DEFAULT');
  await page.waitForFunction(() => document.body.dataset.uiStyle === 'default');
  await installPaletteFixture();
  const defaultPalette = await page.locator('#theme-palette-fixture .wall-body').evaluate((element) => {
    const wall = getComputedStyle(element);
    const root = element.closest('.full-plan-page');
    const label = getComputedStyle(root?.querySelector('.wall-label'));
    const corner = getComputedStyle(root?.querySelector('.vertex-handle'));
    const dimension = getComputedStyle(root?.querySelector('.dimension-line'));
    const title = getComputedStyle(root?.querySelector('.editor-intro h1'));
    return { wall: wall.stroke, label: label.fill, corner: corner.stroke, dimension: dimension.stroke, title: title.color };
  });
  assert.deepEqual(defaultPalette, { wall: 'rgb(24, 61, 52)', label: 'rgb(68, 81, 75)', corner: 'rgb(24, 61, 52)', dimension: 'rgb(104, 117, 111)', title: 'rgb(23, 33, 29)' });
  await page.screenshot({ path: '../output/theme-check/Default.png' });
  console.log('Modern applies, survives reload, and Default restores successfully.');
} finally {
  if (previous) await page.evaluate(async (style) => { await fetch('/engineering-api/settings', { method: 'PUT', headers: {'Content-Type':'application/json'}, body: JSON.stringify({ui:{style}}) }); }, previous.style);
  await browser.close();
}
