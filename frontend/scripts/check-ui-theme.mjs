import { createRequire } from 'node:module';
import { mkdir } from 'node:fs/promises';
import assert from 'node:assert/strict';
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const origin = process.env.PREVIEW_ORIGIN || 'http://localhost:3000';
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
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
  await page.screenshot({ path: '../output/theme-check/Default.png' });
  console.log('Modern applies, survives reload, and Default restores successfully.');
} finally {
  if (previous) await page.evaluate(async (style) => { await fetch('/engineering-api/settings', { method: 'PUT', headers: {'Content-Type':'application/json'}, body: JSON.stringify({ui:{style}}) }); }, previous.style);
  await browser.close();
}
