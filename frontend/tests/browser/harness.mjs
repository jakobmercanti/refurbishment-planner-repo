import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import path from "node:path";

export async function eventually(read, condition, message = "Expected state was not reached") {
  const deadline = Date.now() + 12000;
  let value;
  do {
    value = await read();
    if (condition(value)) return value;
    await new Promise(resolve => setTimeout(resolve, 50));
  } while (Date.now() < deadline);
  assert.fail(message + ": " + JSON.stringify(value));
}

export async function readProject(page) {
  return page.evaluate(async () => {
    const db = await new Promise((resolve, reject) => {
      const request = indexedDB.open("freefloorplan3d", 2);
      request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
    });
    try {
      if (!db.objectStoreNames.contains("meta")) return null;
      const get = (store, key) => new Promise((resolve, reject) => {
        const request = db.transaction(store).objectStore(store).get(key);
        request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
      });
      const id = await get("meta", "current");
      return id ? await get("projects", id) : null;
    } finally { db.close(); }
  });
}

export async function startBrowserHarness({ climoptixEnabled = false } = {}) {
  const require = createRequire(import.meta.url);
  const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
  const output = fileURLToPath(new URL("../../out/", import.meta.url));
  await readFile(path.join(output, "index.html")); // Fail clearly if the production export is missing.
  const events = [], requests = [];
  const server = createServer(async (request, response) => {
    try {
      const url = new URL(request.url, "http://localhost");
      requests.push({ method: request.method, path: url.pathname });
      if (url.pathname === "/planner/engineering-api/analytics/event") {
        let body = ""; for await (const part of request) body += part;
        events.push(JSON.parse(body)); response.writeHead(204); response.end(); return;
      }
      const filePath = url.pathname.replace(/^\/planner(?=\/|$)/, "") || "/";
      if (filePath.startsWith("/engineering-api/")) {
        const catalogue = filePath === "/engineering-api/catalog/items";
        response.writeHead(catalogue ? 200 : 401, { "content-type": "application/json" });
        response.end(catalogue ? "[]" : '{"detail":"Sign in"}'); return;
      }
      const file = path.resolve(output, "." + decodeURIComponent(filePath.endsWith("/") ? filePath + "index.html" : filePath));
      if (!file.startsWith(output)) throw new Error("Outside preview root");
      const content = await readFile(file);
      response.writeHead(200, { "content-type": ({ ".html": "text/html", ".js": "application/javascript", ".css": "text/css", ".json": "application/json", ".svg": "image/svg+xml", ".png": "image/png", ".woff": "font/woff", ".woff2": "font/woff2" })[path.extname(file)] || "application/octet-stream" });
      response.end(content);
    } catch { response.writeHead(404); response.end(); }
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  let browser;
  try {
    browser = await chromium.launch({ channel: process.env.BROWSER_CHANNEL || "chrome", headless: true, args: ["--enable-unsafe-swiftshader"] });
  } catch (error) { await new Promise(resolve => server.close(resolve)); throw error; }
  return {
    origin, events, requests,
    async session(project, options = {}) {
      const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, ...options });
      await context.route("**/*", route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort());
      await context.route("**/climoptix/prepare", async route => {
        const { realPreparation } = await import("../climoptixFixtures.ts");
        try { await route.fulfill({ contentType: "application/json", body: JSON.stringify(realPreparation(route.request().postDataJSON())) }); }
        catch (error) { await route.fulfill({ status: 422, contentType: "application/json", body: JSON.stringify({ detail: String(error) }) }); }
      });
      await context.route("**/climoptix/geometry", async route => {
        const { realScene } = await import("../climoptixFixtures.ts");
        try {
          await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(realScene(route.request().postDataJSON().project)) });
        } catch (error) {
          await route.fulfill({ status: 422, contentType: "application/json", body: JSON.stringify({ detail: String(error) }) });
        }
      });
      await context.addInitScript("window.__name = value => value; window.showSaveFilePicker = undefined; window.showOpenFilePicker = undefined;");
      // CFD regression fixtures explicitly opt into a mocked enabled account.
      // Other browser tests remain signed out; production has no test bypass.
      if (climoptixEnabled) {
        await context.addInitScript(`sessionStorage.setItem('freefloorplan3d:commercial-session:v1', JSON.stringify({access_token:'test-access',refresh_token:'test-refresh',expires_at:Math.floor(Date.now()/1000)+3600,user:{id:'11111111-1111-4111-8111-111111111111'}}));`);
        await context.route("**/climoptix/worker/capabilities", route => route.fulfill({contentType:"application/json", body:JSON.stringify({
          connected:true, mesh:false, run:false, reason:"Test fixture: execution unavailable", namespace:"11111111-1111-4111-8111-111111111111",
          limits:{cpu:2,memoryGb:4,wallTimeMinutes:15,storageGb:1,retentionDays:3,maxCells:500000,concurrentJobs:1},
        })}));
      }
      const page = await context.newPage(), errors = [];
      page.setDefaultTimeout(12000); page.on("pageerror", error => errors.push(error.message));
      if (project) {
        await page.goto(origin + "/planner/");
        await page.getByRole("combobox", { name: "Workspace", exact: true }).waitFor();
        await eventually(() => readProject(page), value => !!value?.projectId);
        await page.goto(origin + "/planner/404.html");
        await page.evaluate(async value => {
          const db = await new Promise(resolve => { const request = indexedDB.open("freefloorplan3d", 2); request.onsuccess = () => resolve(request.result); });
          await new Promise((resolve, reject) => {
            const transaction = db.transaction(["projects", "meta"], "readwrite");
            transaction.objectStore("projects").put(value, value.projectId); transaction.objectStore("meta").put(value.projectId, "current");
            transaction.oncomplete = resolve; transaction.onerror = () => reject(transaction.error);
          }); db.close();
        }, project);
        await page.goto(origin + "/planner/");
        await page.getByRole("combobox", { name: "Selected floor", exact: true }).waitFor();
      }
      return { page, context, saved: () => readProject(page), async close() { await context.close(); assert.deepEqual(errors, []); } };
    },
    async close() { try { await browser.close(); } finally { await new Promise(resolve => server.close(resolve)); } },
  };
}

export async function menu(page, heading, entry) {
  await page.getByRole("button", { name: heading, exact: true }).click();
  await page.getByRole("button", { name: entry, exact: typeof entry === "string" }).click();
}

/** Navigate a tab in the consolidated native floating setup window. */
export async function cfdWindow(ui, name) {
  const page = typeof ui.page === "function" ? ui.page() : ui;
  const aliases = { Studies: "Simulations", Simulation: "Solver", "Thermal Envelope & Solar Conditions": "Boundaries", "Convergence monitor": "Solver" };
  if (name === "View properties") {
    const control = page.locator(".cfx-view-selector").getByRole("button", { name, exact: true });
    if (await control.getAttribute("aria-expanded") !== "true") await control.click();
    await page.locator(".cfx-view-window").getByLabel("Move View properties", { exact: true }).click({ position: { x: 220, y: 20 } });
    return;
  }
  if (await page.locator(".cfx-setup-window[data-window-maximized]:visible").count()) {
    const phases = { Simulations: ["studies", "Simulations"], Domain: ["domain", "Domain"], Equipment: ["equipment", "Objects"], Boundaries: ["boundaries", "Bounds"], Physics: ["physics", "Physics"], Solver: ["mesh", "Solver"], "Review & export": ["review", "Export"], "Imported results": ["results", "Results"] };
    const [id, text] = phases[aliases[name] ?? name];
    const select = ui.getByRole("combobox", { name: "CFD phase", exact: true });
    if (await select.isVisible()) await select.selectOption(id);
    else await ui.getByRole("tablist", { name: "Climoptix setup", exact: true }).getByRole("tab", { name: text, exact: true }).click();
  } else {
    await page.getByRole("button", { name: "Toolbar", exact: true }).click();
    await page.getByRole("menu", { name: "Climoptix windows", exact: true }).getByRole("menuitem", { name: aliases[name] ?? name, exact: true }).click();
  }
  if (name === "Thermal Envelope & Solar Conditions") await ui.getByRole("tab", { name: "Thermal", exact: true }).click();
  if (name === "Convergence monitor") await ui.getByRole("tab", { name: "Monitor", exact: true }).click();
  const title = page.getByRole("region", { name: "Climoptix CFD workspace", exact: true }).getByLabel("Move Simulation setup", { exact: true });
  if (await title.isVisible()) await title.focus();
}

export async function cfdRefresh(ui, wait = true) {
  const page = typeof ui.page === "function" ? ui.page() : ui;
  await page.getByRole("button", { name: "Toolbar", exact: true }).click();
  const refresh = page.getByRole("menuitem", { name: "Refresh checks", exact: true });
  await eventually(() => refresh.isEnabled(), Boolean);
  const before = await ui.getAttribute("data-preparation-stamp");
  const response = wait ? page.waitForResponse(r => new URL(r.url()).pathname.endsWith("/climoptix/prepare")) : null;
  await refresh.click();
  if (response) {
    await response;
    await eventually(async () => ({ stamp: await ui.getAttribute("data-preparation-stamp"), state: await ui.getAttribute("data-preparation-state") }),
      value => value.stamp !== before || value.state === "error");
  }
}

// Automatic preflight updates validation stamps, not editable simulation data.
export const cfdSettings = project => JSON.stringify(project.cfdScenarios?.map(scenario => {
  const settings = { ...scenario }; delete settings.validation; return settings;
}));
