import assert from "node:assert/strict";
import test, { before, after } from "node:test";
import { cfdProject } from "../climoptixFixtures";
import { cfdWindow, eventually, startBrowserHarness } from "./harness.mjs";

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

test("public Climoptix is discoverable but signed-out users must verify an account before compute access", async t => {
  const s = await harness.session(cfdProject()); t.after(() => s.close());
  const {page} = s;
  assert.deepEqual(await workspace(page).locator("option").allTextContents(), ["Floorplan", "PlannerBuild", "Climoptix CFD · free"]);
  assert.equal(await page.locator(".climoptix-screen").count(), 0);
  await workspace(page).selectOption("CLIMOPTIX");
  await page.getByRole("dialog", {name:"Account & plans"}).waitFor();
  assert.match(await page.getByRole("status").allTextContents().then(text=>text.join(" ")), /five completed simulations/);
  assert.equal(await page.locator(".climoptix-screen").count(), 0);
  assert.equal(harness.requests.some(r => r.path.endsWith("/climoptix/worker/capabilities")), false);
});

test("a denied account cannot force access, regardless of browser email", async t => {
  const s = await harness.session(cfdProject()); t.after(() => s.close());
  let checks = 0;
  await s.context.route("**/commercial/summary", route => route.fulfill({json:{plan:"free"}}));
  await s.context.route("**/climoptix/worker/capabilities", route => {
    checks++; assert.equal(route.request().headers().authorization, "Bearer test-denied");
    return route.fulfill({status:403, json:{detail:"Account not enabled"}});
  });
  await account(s.page, "test-denied");
  await eventually(() => checks, n => n > 0);
  assert.equal(await privateOption(s.page).textContent(), "Climoptix CFD · free");
  assert.equal(await s.page.locator(".climoptix-screen").count(), 0);
});

test("any verified free account can open setup without a ready solver; logout unmounts it and preserves studies", async t => {
  const s = await harness.session(cfdProject()); t.after(() => s.close());
  await s.context.route("**/commercial/summary", route => route.fulfill({json:{plan:"free"}}));
  await s.context.route("**/climoptix/worker/capabilities", route => route.fulfill({json:capabilities}));
  const before = JSON.stringify((await s.saved()).cfdScenarios);
  await account(s.page, "test-enabled");
  await eventually(() => privateOption(s.page).textContent(), text => text === "Climoptix CFD");
  await workspace(s.page).selectOption("CLIMOPTIX");
  await s.page.getByRole("region", {name:"Climoptix CFD workspace", exact:true}).waitFor();
  await account(s.page, null);
  assert.equal(await privateOption(s.page).textContent(), "Climoptix CFD · free");
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
  assert.equal(await privateOption(s.page).textContent(), "Climoptix CFD · free");
  response = {status:200, json:{...capabilities, namespace:"22222222-2222-4222-8222-222222222222"}};
  await s.page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await eventually(() => checks, n => n === 2);
  assert.equal(await privateOption(s.page).textContent(), "Climoptix CFD · free");
  response = {status:200, json:capabilities};
  await s.page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await eventually(() => privateOption(s.page).textContent(), text => text === "Climoptix CFD");
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
  assert.equal(await privateOption(s.page).textContent(), "Climoptix CFD · free");
  assert.equal(await workspace(s.page).inputValue(), "FLOORPLAN");
});

test("exhausted free allowance blocks new runs but keeps the public workbench and results available", async t => {
  const s = await harness.session(cfdProject()); t.after(() => s.close());
  await s.context.route("**/climoptix/worker/capabilities", route => route.fulfill({json:{...capabilities,mesh:true,
    reason:"Free tier: all five completed simulations have been used. Setup and existing results remain available.",
    simulationQuota:{tier:"free",period:"lifetime",limit:5,completed:5,remaining:0}}}));
  await s.context.route("**/climoptix/worker/jobs?*", route=>route.fulfill({json:[]}));
  await account(s.page,"exhausted-public-account");
  await eventually(() => privateOption(s.page).textContent(), text=>text === "Climoptix CFD");
  await workspace(s.page).selectOption("CLIMOPTIX");
  const ui=s.page.locator(".cfx-workspace");
  await cfdWindow(ui,"Simulations");
  assert.equal(await ui.getByRole("button",{name:"Run Office airflow",exact:true}).isDisabled(),true);
  assert.equal(await ui.getByRole("button",{name:"Mesh Office airflow",exact:true}).isEnabled(),true);
  await cfdWindow(ui,"Solver");
  await ui.getByRole("tab",{name:"Run",exact:true}).click();
  assert.match(await ui.getByLabel("Free simulation allowance").textContent(),/5 of 5 completed simulations used/);
  assert.equal(await ui.getByRole("button",{name:"Run solver",exact:true}).isDisabled(),true);
  await cfdWindow(ui,"Imported results");
  assert.equal(await workspace(s.page).inputValue(),"CLIMOPTIX");
});

test("a quota race rejected with 429 is not retained as an unknown dispatched simulation", async t => {
  const s=await harness.session(cfdProject()); t.after(()=>s.close());
  await s.context.route("**/climoptix/worker/capabilities",route=>route.fulfill({json:{...capabilities,mesh:true,run:true,
    simulationQuota:{tier:"free",period:"lifetime",limit:5,completed:4,remaining:1}}}));
  await s.context.route("**/climoptix/worker/jobs?*",route=>route.fulfill({json:[]}));
  let submissions=0;
  await s.context.route("**/climoptix/worker/jobs",route=>{
    submissions++; return route.fulfill({status:429,json:{detail:"Free tier limit reached: five completed simulations per account (lifetime)."}});
  });
  await account(s.page,"quota-race-account");
  await eventually(()=>privateOption(s.page).textContent(),text=>text==="Climoptix CFD");
  await workspace(s.page).selectOption("CLIMOPTIX");
  const ui=s.page.locator(".cfx-workspace"); await cfdWindow(ui,"Simulations");
  await ui.getByRole("button",{name:"Run Office airflow",exact:true}).click();
  await eventually(()=>submissions,count=>count===1);
  await eventually(()=>ui.locator('.cfx-error').allTextContents(),messages=>messages.some(message=>message.includes("Free tier limit reached")));
  assert.equal(await ui.getByText("Submission status unknown",{exact:true}).count(),0);
  assert.equal(await ui.getByRole("button",{name:"Mesh Office airflow",exact:true}).isEnabled(),true);
});
