import assert from "node:assert/strict";
import test, { before, after } from "node:test";
import { cfdProject } from "../climoptixFixtures";
import { eventually, startBrowserHarness } from "./harness.mjs";

let harness;
before(async () => { harness = await startBrowserHarness(); });
after(async () => { await harness?.close(); });
const owner = "11111111-1111-4111-8111-111111111111";
const capabilities = {connected:true, mesh:false, run:false, reason:"Solver temporarily unavailable", namespace:owner,
  limits:{cpu:2,memoryGb:4,wallTimeMinutes:15,storageGb:1,retentionDays:3,maxCells:500000,concurrentJobs:1}};
const workspace = page => page.getByRole("combobox", {name:"Workspace", exact:true});
const privateOption = page => workspace(page).locator('option[value="CLIMOPTIX"]');

async function account(page, token: string | null, id = owner) {
  await page.evaluate(({token,id}) => {
    if (token) sessionStorage.setItem("freefloorplan3d:commercial-session:v1", JSON.stringify({
      access_token:token, refresh_token:"test-refresh", expires_at:Math.floor(Date.now()/1000)+3600,
      user:{id, email:"enabled@example.invalid"},
    }));
    else sessionStorage.removeItem("freefloorplan3d:commercial-session:v1");
    window.dispatchEvent(new Event("freefloorplan3d:auth-session-changed"));
  }, {token,id});
}

test("signed-out users cannot see or force open the private workspace", async t => {
  const s = await harness.session(cfdProject()); t.after(() => s.close());
  const {page} = s;
  assert.deepEqual(await workspace(page).locator("option").allTextContents(), ["Floorplan", "PlannerBuild"]);
  assert.equal(await page.locator(".climoptix-screen").count(), 0);
  // A forged menu entry must not bypass the workspace change guard.
  await workspace(page).evaluate(select => {
    select.add(new Option("forged", "CLIMOPTIX")); select.value = "CLIMOPTIX";
    select.dispatchEvent(new Event("change", {bubbles:true}));
  });
  assert.equal(await page.locator(".climoptix-screen").count(), 0);
  assert.equal(harness.requests.some(r => r.path.endsWith("/climoptix/worker/capabilities")), false);
});

test("a signed-in free account is hidden when the server denies access, regardless of browser email", async t => {
  const s = await harness.session(cfdProject()); t.after(() => s.close());
  let checks = 0;
  await s.context.route("**/commercial/summary", route => route.fulfill({json:{plan:"free"}}));
  await s.context.route("**/climoptix/worker/capabilities", route => {
    checks++; assert.equal(route.request().headers().authorization, "Bearer test-denied");
    return route.fulfill({status:403, json:{detail:"Account not enabled"}});
  });
  await account(s.page, "test-denied");
  await eventually(() => checks, n => n > 0);
  assert.equal(await privateOption(s.page).count(), 0);
  assert.equal(await s.page.locator(".climoptix-screen").count(), 0);
});

test("an enabled free account can open setup without a ready solver; logout unmounts it and preserves studies", async t => {
  const s = await harness.session(cfdProject()); t.after(() => s.close());
  await s.context.route("**/commercial/summary", route => route.fulfill({json:{plan:"free"}}));
  await s.context.route("**/climoptix/worker/capabilities", route => route.fulfill({json:capabilities}));
  const before = JSON.stringify((await s.saved()).cfdScenarios);
  await account(s.page, "test-enabled");
  await eventually(() => privateOption(s.page).count(), n => n === 1);
  await workspace(s.page).selectOption("CLIMOPTIX");
  await s.page.getByRole("region", {name:"Climoptix CFD workspace", exact:true}).waitFor();
  await account(s.page, null);
  assert.equal(await privateOption(s.page).count(), 0);
  assert.equal(await workspace(s.page).inputValue(), "FLOORPLAN");
  assert.equal(await s.page.locator(".climoptix-screen").count(), 0);
  assert.equal(await s.page.getByRole("button", {name:"Return to Climoptix", exact:true}).count(), 0);
  const after = (await s.saved()).cfdScenarios;
  // Automatic preparation may update validation metadata, never editable data.
  for (const study of after) delete study.validation;
  const previous = JSON.parse(before); for (const study of previous) delete study.validation;
  assert.deepEqual(after, previous);
});

test("access fails closed on outages and wrong namespaces, then rechecks on focus", async t => {
  const s = await harness.session(cfdProject()); t.after(() => s.close());
  let response = {status:503, json:{detail:"Unavailable"}}, checks = 0;
  await s.context.route("**/climoptix/worker/capabilities", route => { checks++; return route.fulfill(response); });
  await account(s.page, "test-enabled");
  await eventually(() => checks, n => n === 1);
  assert.equal(await privateOption(s.page).count(), 0);
  response = {status:200, json:{...capabilities, namespace:"22222222-2222-4222-8222-222222222222"}};
  await s.page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await eventually(() => checks, n => n === 2);
  assert.equal(await privateOption(s.page).count(), 0);
  response = {status:200, json:capabilities};
  await s.page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await eventually(() => privateOption(s.page).count(), n => n === 1);
});

test("a delayed allow response cannot restore access after logout", async t => {
  const s = await harness.session(cfdProject()); t.after(() => s.close());
  let release: () => void;
  let requested = false;
  const held = new Promise<void>(resolve => { release = resolve; });
  await s.context.route("**/climoptix/worker/capabilities", async route => {
    requested = true; await held;
    await route.fulfill({json:capabilities}).catch(() => {}); // aborted by logout
  });
  await account(s.page, "test-enabled");
  await eventually(() => requested, Boolean);
  await account(s.page, null); release!();
  await s.page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  assert.equal(await privateOption(s.page).count(), 0);
  assert.equal(await workspace(s.page).inputValue(), "FLOORPLAN");
});
