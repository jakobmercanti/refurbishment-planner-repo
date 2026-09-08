// Visual regression smoke check; set PLAYWRIGHT_MODULE when Playwright is external.
import { createRequire } from 'node:module';
import { mkdir } from 'node:fs/promises';
import assert from 'node:assert/strict';
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const browser = await chromium.launch({ headless: true, channel: 'chrome' });
try {
  const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
  await page.goto('http://localhost:3000/');
  await page.getByRole('button', { name: 'View', exact: true }).waitFor();
  await page.getByRole('button', { name: 'Rectangle', exact: true }).click();
  await page.getByRole('dialog', { name: 'Start a new outline?' }).getByRole('button', { name: 'Ok', exact: true }).click();
  await page.locator('svg.floor-canvas .styled-room-floors > g').first().waitFor({ state: 'attached' });
  await page.locator('.room-name-editor input').first().click();
  await page.getByRole('tab', { name: 'Elements', exact: true }).click();
  await page.getByRole('button', { name: 'Add element', exact: true }).click();
  await page.locator('svg.floor-canvas .symbol-modern').first().waitFor({ state: 'attached' });
  await mkdir('../output/style-check', { recursive: true });
  for (const style of ['Modern', 'Creative', 'Traditional']) {
    await page.getByRole('button', { name: 'View', exact: true }).click();
    await page.getByRole('button', { name: `${style} style` }).click();
    const live = page.locator('svg.floor-canvas').first();
    const visible = await live.locator('.styled-room-floors').evaluate((el) => getComputedStyle(el).display);
    assert.equal(visible === 'none', style === 'Traditional');
    const symbolClass = style === 'Traditional' ? 'symbol-default' : `symbol-${style.toLowerCase()}`;
    assert.equal(await live.locator(`.${symbolClass}`).first().evaluate((el) => getComputedStyle(el).display), 'inline');
    await page.getByRole('button', { name: 'Tools', exact: true }).click();
    await page.getByRole('button', { name: 'Export floorplan…', exact: true }).click();
    const preview = page.locator('.export-svg-preview');
    await preview.locator('svg').waitFor();
    assert.equal(await preview.locator(`.${symbolClass}`).count(), 1);
    assert.equal(await preview.locator('.symbol-default,.symbol-modern,.symbol-creative').count(), 1);
    const artwork = await browser.newPage({ viewport: { width: 1200, height: 820 } });
    await artwork.setContent(`<style>body{margin:0}svg{width:1200px;height:820px}</style>${await preview.innerHTML()}`);
    await artwork.screenshot({ path: `../output/style-check/${style}.png` });
    await artwork.close();
    console.log(style, await preview.locator('.styled-room-floors').count(), await preview.locator('.creative-garden').count());
    if (style === 'Creative') {
      await page.getByLabel('Drawing style').selectOption('TRADITIONAL');
      assert.equal(await preview.locator('.creative-garden,.styled-room-floors').count(), 0);
      await page.getByLabel('Drawing style').selectOption('CURRENT');
    }
    await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  }
} finally { await browser.close(); }
