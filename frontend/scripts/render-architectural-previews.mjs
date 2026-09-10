// Asset authoring only: render the shared production models, without running tests.
import { createRequire } from "node:module";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
const models = JSON.parse(await readFile(resolve("lib/staircaseModels.json"), "utf8"));
const doors = JSON.parse(await readFile(resolve("lib/doorModels.json"), "utf8"));
const windows = { "window-single-pane": [800, 100, 900], "window-double-pane": [800, 100, 900], "window-triple-pane": [800, 100, 900], "window-bay": [2400, 650, 1500], "window-bow": [3000, 700, 1500], "window-sash": [1000, 180, 1500], "window-casement": [1200, 160, 1200] };
const entries = [...Object.entries(models).map(([key, m]) => [key, [m.width, m.depth, m.height]]), ...Object.entries(windows), ...doors.map(model => [model.key, [model.width, model.depth, model.height]])];
const browser = await chromium.launch({ headless: true, channel: process.env.PREVIEW_BROWSER || "msedge", args: ["--enable-webgl", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
try {
  const page = await browser.newPage({ viewport: { width: 640, height: 640 } });
  for (const [key, [width, depth, height]] of entries) {
    if (process.env.PREVIEW_KEYS && !process.env.PREVIEW_KEYS.split(",").includes(key)) continue;
    const installed = process.env.PREVIEW_FRAME === "1" && key.startsWith("door-");
    await page.goto(`${process.env.PREVIEW_ORIGIN || "http://localhost:3000"}/fixture-studio?${new URLSearchParams({ key, width: String(width), depth: String(depth), height: String(height), ...(installed ? { frame: "1" } : {}) })}`, { waitUntil: "networkidle" });
    await page.locator("canvas").waitFor();
    await page.addStyleTag({ content: "nextjs-portal { display: none !important; }" });
    await page.waitForTimeout(1200);
    await page.locator("canvas").screenshot({ path: resolve("public/fixture-previews", `${key}${installed ? "-installed" : ""}.png`) });
    console.log(`Rendered ${key}`);
  }
} finally { await browser.close(); }
