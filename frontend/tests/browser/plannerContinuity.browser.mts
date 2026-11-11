import assert from "node:assert/strict";
import test, { after, before } from "node:test";
import { hvacProject } from "../hvacFixtures";
import { roofProject } from "../roofBalustradeFixtures";
import { newProject } from "../../lib/projectDocument";
import { eventually, menu, readProject, startBrowserHarness, writeProject } from "./harness.mjs";

let harness;
before(async () => { harness = await startBrowserHarness(); });
after(async () => { await harness?.close(); });

const account = "11111111-1111-4111-8111-111111111111";
async function signInFromPlanner(page, context) {
  await context.route("**/planner/auth-api/token?grant_type=password", route => route.fulfill({ json: {
    access_token: "mock-access", refresh_token: "mock-refresh", expires_in: 3600,
    user: { id: account, email: "draft@example.invalid" },
  } }));
  await context.route("**/commercial/summary", route => route.fulfill({ json: { plan: "free" } }));
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Account & plans" });
  await dialog.getByLabel("Email", { exact: true }).fill("draft@example.invalid");
  await dialog.getByLabel("Password", { exact: true }).fill("not-a-real-password");
  await Promise.all([page.waitForNavigation({ waitUntil: "domcontentloaded" }),
    dialog.getByRole("button", { name: "Sign in", exact: true }).click()]);
}

test("signing in from the planner carries the guest draft and retains existing account work", async t => {
  const draft = hvacProject(), previous = roofProject();
  draft.updatedAt = new Date(Date.parse(draft.createdAt) + 1000).toISOString();
  const session = await harness.session(draft);
  t.after(() => session.close());
  const { page, context } = session;
  const other = "22222222-2222-4222-8222-222222222222";
  await writeProject(page, previous, account);
  await context.route("**/planner/auth-api/logout", route => route.fulfill({ status: 204 }));

  const roomName = page.locator('.room-name-editor input[aria-label="Name Living room"]');
  await roomName.fill("Guest project room");
  await signInFromPlanner(page, context);
  const carried = await eventually(session.saved, p => p?.rooms.some(room => room.name === "Guest project room") &&
    p.projectId === draft.projectId && p.hvac?.activeScenarioId === "operation-1");
  assert.equal(carried.floorplan.openings[0].id, "shared-aperture");
  assert.equal(await readProject(page, other), null);
  const projectIds = await page.evaluate(async id => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open("freefloorplan3d:account:" + id, 2);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    try { return await new Promise<IDBValidKey[]>((resolve, reject) => {
      const request = db.transaction("projects").objectStore("projects").getAllKeys();
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    }); } finally { db.close(); }
  }, account);
  assert.ok(projectIds.includes(previous.projectId));
  assert.equal((await readProject(page, null)).projectId, draft.projectId);
  await page.getByRole("button", { name: /^Signed in/ }).click();
  await page.getByRole("dialog", { name: "Account & plans" }).getByRole("button", { name: "Sign out", exact: true }).click();
  await eventually(session.saved, p => p?.projectId === draft.projectId);
  await page.getByRole("button", { name: "Sign in", exact: true }).waitFor();
});

test("an empty guest canvas keeps the existing account project active", async t => {
  const session = await harness.session(newProject());
  t.after(() => session.close());
  const previous = roofProject();
  await writeProject(session.page, previous, account);
  // Wait for the empty editor's initial canvas save to exercise the real entry path.
  await eventually(session.saved, p => p?.floorplan && p.floorplan.walls.length === 0);
  await signInFromPlanner(session.page, session.context);
  await eventually(session.saved, p => p?.projectId === previous.projectId);
});

test("wall and opening dimensions clear a projecting bay before and after moving to another wall", async t => {
  const project = roofProject();
  project.floorplan!.openings = [{
    id: "bay-window", kind: "WINDOW", wallId: "wall-0", segmentIndex: 3,
    offset: 1600, width: 2400, height: 1250, sill: 900,
    hingeSide: "START", doorType: "SINGLE", opensInward: true,
    representationKey: "window-bay", windowDepthMm: 1200,
  }];
  const session = await harness.session(project);
  t.after(() => session.close());
  const { page } = session;
  const symbol = page.locator(".window-symbol").first();
  const gap = symbol.locator(".opening-gap");
  await gap.waitFor({ state: "attached" });
  async function check(horizontal: boolean) {
    const boxes = await symbol.evaluate((window, horizontal) => {
      const gap = window.querySelector(".opening-gap").getBoundingClientRect();
      const frame = window.querySelector(".window-projecting-frame").getBoundingClientRect();
      const middle = horizontal ? gap.x + gap.width / 2 : gap.y + gap.height / 2;
      const anchor = horizontal ? gap.y : gap.x;
      const low = horizontal ? frame.top : frame.left, high = horizontal ? frame.bottom : frame.right;
      const sign = anchor - low > high - anchor ? -1 : 1;
      const projection = Math.max(anchor - low, high - anchor);
      const lines = [...window.ownerSVGElement.querySelectorAll(".wall-dimension .dimension-line, .window-dimension .dimension-line")];
      const distances = lines.map(line => line.getBoundingClientRect()).filter(rect => horizontal
        ? rect.width > 30 && rect.height < 1 && rect.left <= middle && rect.right >= middle
        : rect.height > 30 && rect.width < 1 && rect.top <= middle && rect.bottom >= middle)
        .map(rect => ((horizontal ? rect.y : rect.x) - anchor) * sign).filter(distance => distance > 3);
      return { projection, closest: Math.min(...distances) };
    }, horizontal);
    assert.ok(boxes.projection > 10 && Number.isFinite(boxes.closest) && boxes.closest > boxes.projection + 4, JSON.stringify(boxes));
  }
  const original = await gap.boundingBox();
  await page.mouse.click(original.x + original.width / 2, original.y + original.height / 2);
  await page.locator(".window-dimension").waitFor();
  await check(false);
  const room = await page.locator(".full-room-highlight polygon").first().boundingBox();
  await page.mouse.move(original.x + original.width / 2, original.y + original.height / 2);
  await page.mouse.down();
  await page.mouse.move(room.x + room.width / 2, room.y + room.height, { steps: 12 });
  await page.mouse.up();
  await eventually(session.saved, p => p?.floorplan.openings[0]?.segmentIndex === 0);
  await check(true);
});

test("the ventilation card drags and saves a position independent of heating", async t => {
  const session = await harness.session(hvacProject());
  t.after(() => session.close());
  const { page } = session;
  await menu(page, "Tools", "Heating & ventilation");
  const panel = page.locator(".heating-layout-window");
  await panel.getByRole("tab", { name: "Ventilation", exact: true }).click();
  await panel.getByRole("button", { name: "Minimise Heating Layout", exact: true }).click();
  const card = page.getByRole("button", { name: "Move ventilation summary: Study", exact: true });
  await card.waitFor();
  const original = await card.boundingBox();
  assert.ok(original);
  const hit = await card.evaluate(element => {
    const rect = element.getBoundingClientRect();
    const target = document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2);
    return element.contains(target) ? null : target?.closest(".floating-toolbar")?.getAttribute("aria-label") ?? target?.outerHTML.slice(0, 190);
  });
  assert.equal(hit, null, "The ventilation card must receive the pointer at its centre");
  await page.mouse.move(original.x + original.width / 2, original.y + original.height / 2);
  await page.mouse.down();
  await page.mouse.move(original.x + original.width / 2 + 48, original.y + original.height / 2 + 35, { steps: 8 });
  await page.mouse.up();
  const position = await eventually(session.saved, p => p?.heatingLayout?.ventilationIndicatorPositions?.["room-1"]);
  assert.equal(position.heatingLayout.roomIndicatorPositions?.["room-1"], undefined);
  assert.ok((await card.boundingBox()).x > original.x + 35);
  await card.press("ArrowRight");
  await eventually(session.saved, p => p?.heatingLayout?.ventilationIndicatorPositions?.["room-1"]?.x ===
    position.heatingLayout.ventilationIndicatorPositions["room-1"].x + 50);
});
