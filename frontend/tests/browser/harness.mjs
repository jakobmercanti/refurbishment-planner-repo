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

export async function startBrowserHarness() {
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
    async session(project) {
      const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
      await context.route("**/*", route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort());
      await context.addInitScript("window.__name = value => value; window.showSaveFilePicker = undefined; window.showOpenFilePicker = undefined;");
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
