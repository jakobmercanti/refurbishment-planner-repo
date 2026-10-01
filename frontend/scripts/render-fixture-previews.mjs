// Set PLAYWRIGHT_MODULE to an installed Playwright module path if not local.
import { createRequire } from "node:module";
import { mkdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
const origin = process.env.PREVIEW_ORIGIN || "http://localhost:3000";
async function catalogueItems() {
  if (process.env.PREVIEW_KEY_PREFIX === "electrical-") {
    const assets = JSON.parse(await readFile(new URL("../lib/electricalAssets.json", import.meta.url), "utf8"));
    return assets.map(asset => ({ is_default:true, representation_key:asset.key, width_mm:asset.width, depth_mm:asset.depth, height_mm:asset.height, color_hex:asset.colour }));
  }
  const response = await fetch(`${origin}/engineering-api/catalog/items`);
  if (!response.ok) throw new Error(`Catalogue returned ${response.status}`);
  return response.json();
}
const items = await catalogueItems();
const output = resolve("public/fixture-previews");
await mkdir(output, {recursive:true});
const browser = await chromium.launch({headless:true, channel:process.env.PREVIEW_BROWSER || undefined, args:["--enable-webgl","--use-angle=swiftshader","--enable-unsafe-swiftshader"]});
try {
  const page = await browser.newPage({viewport:{width:640,height:640},deviceScaleFactor:1});
  page.on("pageerror", error => { throw error; });
  for (const item of items.filter(item => item.is_default && item.representation_key && (!process.env.PREVIEW_KEY_PREFIX || item.representation_key.startsWith(process.env.PREVIEW_KEY_PREFIX)))) {
    const query = new URLSearchParams({key:item.representation_key,width:String(item.width_mm),depth:String(item.depth_mm),height:String(item.height_mm),colour:item.color_hex});
    await page.goto(`${origin}/fixture-studio?${query}`,{waitUntil:"networkidle"});
    await page.locator("canvas").waitFor();
    await page.addStyleTag({content:"nextjs-portal { display: none !important; }"});
    await page.waitForTimeout(800);
    await page.locator("canvas").screenshot({path:resolve(output,`${item.representation_key}.png`)});
    console.log(item.representation_key);
  }
} finally { await browser.close(); }
