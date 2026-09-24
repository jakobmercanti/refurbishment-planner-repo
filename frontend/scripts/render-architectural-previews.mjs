// Asset authoring only: render the shared production models, without running tests.
import { createRequire } from "node:module";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
const models = JSON.parse(await readFile(resolve("lib/staircaseModels.json"), "utf8"));
const doors = JSON.parse(await readFile(resolve("lib/doorModels.json"), "utf8"));
const windows = { "window-single-pane": [800, 100, 900], "window-double-pane": [800, 100, 900], "window-triple-pane": [800, 100, 900], "window-bay": [2400, 650, 1500], "window-bow": [3000, 700, 1500], "window-sash": [1000, 180, 1500], "window-casement": [1200, 160, 1200] };
const roomFixtures = {
  "furniture-bath-oval": [1700, 800, 600],
  "furniture-bath-slipper": [1700, 750, 750],
  "furniture-bath-alcove": [1700, 700, 560],
  "furniture-bath-corner": [1400, 1400, 600],
  "furniture-kitchen-cabinet-single": [600, 350, 720],
  "furniture-kitchen-cabinet-double": [1200, 350, 720],
  "furniture-kitchen-cabinet-glass-single": [600, 350, 720],
  "furniture-kitchen-cabinet-glass-double": [1200, 350, 720],
  "furniture-kitchen-cabinet-open": [600, 350, 720],
  "furniture-kitchen-cabinet-bridge": [900, 350, 360],
};
const entries = [...Object.entries(models).map(([key, m]) => [key, [m.width, m.depth, m.height]]), ...Object.entries(windows), ...doors.map(model => [model.key, [model.width, model.depth, model.height]]), ...Object.entries(roomFixtures)];
const browser = await chromium.launch({ headless: true, channel: process.env.PREVIEW_BROWSER || "msedge", args: ["--enable-webgl", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
try {
  const page = await browser.newPage({ viewport: { width: 640, height: 640 }, deviceScaleFactor: 2 });
  for (const [key, [width, depth, height]] of entries) {
    if (process.env.PREVIEW_KEYS && !process.env.PREVIEW_KEYS.split(",").includes(key)) continue;
    await page.setViewportSize(key in roomFixtures ? { width: 800, height: 560 } : { width: 640, height: 640 });
    const installed = process.env.PREVIEW_FRAME === "1" && key.startsWith("door-");
    await page.goto(`${process.env.PREVIEW_ORIGIN || "http://localhost:3000"}/fixture-studio?${new URLSearchParams({ key, width: String(width), depth: String(depth), height: String(height), ...(installed ? { frame: "1" } : {}) })}`, { waitUntil: "networkidle" });
    await page.locator("canvas").waitFor();
    await page.addStyleTag({ content: "nextjs-portal { display: none !important; }" });
    await page.waitForTimeout(1200);
    await page.locator("canvas").screenshot({ path: resolve("public/fixture-previews", `${key}${installed ? "-installed" : ""}.png`) });
    console.log(`Rendered ${key}`);
  }
} finally { await browser.close(); }
