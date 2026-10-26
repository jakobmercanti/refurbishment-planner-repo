import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import test, { before, after } from "node:test";
import { cfdProject } from "../climoptixFixtures";
import { duplicateCFDScenario } from "../../lib/climoptixDocument";
import { parseProject } from "../../lib/projectDocument";
import { cfdWindow, eventually, startBrowserHarness } from "./harness.mjs";

let accounts, cfd;
const settings = JSON.parse(await readFile(fileURLToPath(new URL("../../../data/software_settings.json", import.meta.url)), "utf8"));
before(async () => { accounts = await startBrowserHarness(); cfd = await startBrowserHarness({climoptixEnabled:true}); });
after(async () => { await accounts?.close(); await cfd?.close(); });
const button = (ui, name) => ui.getByRole("button", {name, exact:true});
const rects = locator => locator.evaluateAll(nodes => nodes.map(node => { const r = node.getBoundingClientRect(); return {x:r.x,y:r.y,w:r.width,h:r.height}; }));
async function account(t, width = 1440) {
  const s = await accounts.session(undefined, {viewport:{width,height:1000}}); t.after(() => s.close());
  // Use the actual saved planner theme profile, without any account credentials.
  await s.context.route("**/engineering-api/settings", route => route.fulfill({json:settings}));
  await s.page.goto(accounts.origin + "/planner/account/");
  return s;
}
async function capture(page, name) {
  if (process.env.BROWSER_ARTIFACTS) await page.screenshot({path:`${process.env.BROWSER_ARTIFACTS}/${name}.png`,fullPage:true});
}
for (const width of [1440, 390]) test(`account and recovery actions follow the planner palette with equal separated buttons at ${width}px`, async t => {
  const {page, context} = await account(t, width);
  await page.getByRole("heading", {name:"Sign in",exact:true}).waitFor();
  await button(page,"Sign in").waitFor();
  await eventually(() => page.locator("body").getAttribute("data-ui-style"), s => s === "modern");
  const actions = page.locator(".account-utility-actions");
  const boxes = await rects(actions.locator("button"));
  assert.equal(boxes.length, 2); assert.ok(Math.abs(boxes[0].w-boxes[1].w)<1);
  assert.ok(Math.abs(boxes[0].y-boxes[1].y)<1); assert.ok(boxes[1].x-boxes[0].x-boxes[0].w>=6);
  assert.equal(await page.locator(".commercial-header .window-header-actions").count(), 0);
  assert.equal(await page.getByRole("link", {name:"Back to floorplan",exact:true}).getAttribute("href"), "/planner/");
  const plans = page.getByRole("link", {name:"Open plans and billing",exact:true});
  assert.equal(await plans.getAttribute("target"), "_blank"); assert.match(await plans.getAttribute("rel"), /noopener/);
  const popupEvent = context.waitForEvent("page"); await plans.click(); const popup = await popupEvent;
  await popup.waitForURL(accounts.origin + "/planner/plans/"); await popup.close();
  assert.equal(new URL(page.url()).pathname, "/planner/account/");
  const colours = await page.evaluate(() => ({actual:getComputedStyle(document.querySelector('.account-auth-tabs button[aria-pressed="true"]')).backgroundColor, expected:getComputedStyle(document.documentElement).getPropertyValue("--ui-button-activeBackground").trim()}));
  assert.equal(colours.actual, "rgb(6, 23, 55)"); assert.equal(colours.expected, "#061737");
  await capture(page, `account-${width}`);
  await button(page, "Forgot your password?").click();
  await page.getByRole("heading", {name:"Reset your password",exact:true}).waitFor();
  assert.equal(await plans.getAttribute("target"), "_blank");
  const recoveryUser = {id:"layout-test-user",email:"layout@example.invalid"};
  await context.route("**/planner/auth-api/user", route => route.fulfill({json:recoveryUser}));
  // A reset email opens a fresh document, rather than an in-page hash edit.
  await page.goto(accounts.origin + "/planner/404.html");
  await page.goto(accounts.origin + "/planner/account/#access_token=mock-layout&refresh_token=mock-refresh&expires_in=3600&type=recovery");
  await page.getByRole("heading", {name:"Set a new password",exact:true}).waitFor();
  const recovery = await rects(page.locator(".account-form-actions button"));
  assert.equal(recovery.length,2); assert.ok(Math.abs(recovery[0].w-recovery[1].w)<1); assert.equal(recovery[0].y,recovery[1].y);
  assert.equal(await plans.getAttribute("target"), "_blank");
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  await capture(page, `password-reset-${width}`);
  await page.emulateMedia({colorScheme:"dark"}); await page.reload();
  await page.getByRole("heading", {name:"Set a new password",exact:true}).waitFor();
  await eventually(() => page.locator("body").getAttribute("data-ui-style"), s => s === "modern");
  assert.equal(await page.locator(".account-form-actions .commercial-primary").evaluate(el => getComputedStyle(el).backgroundColor), "rgb(43, 95, 134)");
  await capture(page, `password-reset-dark-${width}`);
});

test("ordinary sign-in returns to the unchanged saved floorplan, while explicit checkout retains its plan", async t => {
  const project = cfdProject(); const s = await accounts.session(project); t.after(() => s.close());
  const {page, context} = s;
  const hydrated = await eventually(s.saved, p => p.rooms.every(room => room.wall_thickness_overrides_mm && room.person_mockup === null));
  const before = structuredClone(parseProject(hydrated).rooms);
  await context.route("**/planner/auth-api/token?grant_type=password", route => route.fulfill({json:{access_token:"mock-ui",refresh_token:"mock-refresh",expires_in:3600,user:{id:"ui-user"}}}));
  const signIn = async () => {
    await page.getByLabel("Email",{exact:true}).fill("layout@example.invalid");
    await page.getByLabel("Password",{exact:true}).fill("Mock-Layout-Password"); await button(page,"Sign in").click();
  };
  await page.goto(accounts.origin + "/planner/account/"); await signIn();
  await page.waitForURL(accounts.origin + "/planner/");
  await page.getByRole("combobox",{name:"Workspace",exact:true}).waitFor();
  assert.equal((await s.saved()).projectId, project.projectId); assert.deepEqual(parseProject(await s.saved()).rooms, before);
  await page.evaluate(() => sessionStorage.removeItem("freefloorplan3d:commercial-session:v1"));
  await page.goto(accounts.origin + "/planner/account/?plan=pro"); await signIn();
  const billing = button(page,"Open plans and billing"); await billing.waitFor();
  assert.equal(await billing.locator("..").getAttribute("target"), "_blank");
  assert.equal(await page.locator('input[name="plan"]').inputValue(), "pro");
});

const caps = {connected:true,mesh:true,run:true,namespace:"11111111-1111-4111-8111-111111111111",reason:"OpenCFD v2312: steady isothermal SIMPLE; one serial job, max 4 GB / 15 minutes. Parallel execution is not enabled.",limits:{cpu:1,memoryGb:4,wallTimeMinutes:15,storageGb:1,retentionDays:3,maxCells:500000,concurrentJobs:1}};
test("compact simulation labels, separate boundary actions, full-width run controls and per-study diagnostics are connected", async t => {
  const project = cfdProject(); const broken = duplicateCFDScenario(project.cfdScenarios![0]); broken.name="Broken study"; broken.seed=null; project.cfdScenarios!.push(broken);
  const s = await cfd.session(project); t.after(() => s.close()); const {page,context} = s; let submissions=0;
  await context.route("**/engineering-api/settings", route => route.fulfill({json:settings}));
  await context.route("**/climoptix/worker/**", route => {
    if (route.request().method()==="POST") submissions++;
    return route.fulfill({json:route.request().url().endsWith("/capabilities")?caps:[]});
  });
  await page.reload();
  await page.getByRole("combobox",{name:"Workspace",exact:true}).selectOption("CLIMOPTIX");
  const ui = page.locator(".cfx-workspace");
  const add = ui.locator(".cfx-add-sim").first(); assert.equal(await add.innerText(),"+ sim");
  const heading = ui.locator('.cfx-study-group .cfx-list-header').first();
  assert.equal(await heading.locator('small').count(),0);
  assert.ok((await ui.locator('.cfx-study-row').first().boundingBox()).x > (await heading.boundingBox()).x+8);
  await cfdWindow(ui,'Domain');
  assert.ok((await ui.locator('.cfx-metrics').boundingBox()).height < 75);
  await cfdWindow(ui,'Physics');
  await button(ui,'Collapse all').click();
  assert.equal(await ui.locator('.cfx-physics-panel details[open]').count(),0);
  await cfdWindow(ui,'Simulations');
  await eventually(() => button(ui,"Run Broken study").isEnabled(),Boolean);
  await button(ui,"Run Broken study").click();
  await button(ui,"View issues for Broken study").click();
  await ui.getByRole("tab",{name:"Warnings & checks",exact:true}).waitFor();
  assert.equal(await ui.getByRole("tab",{name:"Warnings & checks",exact:true}).getAttribute("aria-selected"),"true");
  await eventually(() => ui.getAttribute("data-preparation-state"), v => v==="checked");
  assert.equal(await ui.getByLabel("CFD scenario",{exact:true}).inputValue(), broken.id);
  assert.ok(await ui.locator(".cfx-diagnostic.error").count()>0); assert.equal(submissions,0);
  await cfdWindow(ui,"Boundaries");
  const group = ui.getByRole("region",{name:"Boundary group Default surfaces",exact:true});
  assert.equal(await group.locator(".cfx-group-heading button").count(),3);
  await button(group,"Actions for boundary group Default surfaces").click();
  const actions = ui.getByRole("dialog",{name:"Actions — Default surfaces",exact:true});
  assert.equal(await actions.evaluate(el => !!el.closest(".cfx-setup-window")),false);
  assert.equal(await button(actions,"Delete boundary group Default surfaces").isEnabled(),false);
  await capture(page,"boundary-actions");
  await button(actions,"Hide Actions — Default surfaces").click();
  await cfdWindow(ui,"Solver"); await ui.getByRole("tab",{name:"Run",exact:true}).click();
  await button(ui,"Window layout for Simulation setup").click(); await page.getByRole("menuitem",{name:"Maximise window",exact:true}).click();
  const run = ui.locator(".cfx-run-panel > .cfx-panel-actions"); const buttons = await rects(run.locator("button")); const box = await run.boundingBox();
  assert.equal(buttons.length,4); assert.ok(Math.max(...buttons.map(b=>b.w))-Math.min(...buttons.map(b=>b.w))<1);
  assert.ok(Math.abs(buttons[0].x-box.x)<1); assert.ok(Math.abs(buttons[3].x+buttons[3].w-box.x-box.width)<1);
  const status = ui.getByRole("region",{name:"OpenFOAM connection",exact:true});
  const reason = await status.locator(".cfx-worker-controls > p").boundingBox(); const controls = await status.locator(".cfx-inline-toolbar").boundingBox();
  assert.ok(Math.abs(reason.y+reason.height/2-controls.y-controls.height/2)<2);
  await button(ui,"Collapse all").click(); assert.equal(await ui.locator(".cfx-run-panel details[open]").count(),0);
  await capture(page,"solver-controls");
  await page.setViewportSize({width:390,height:844});
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth<=innerWidth));
  const narrow = await rects(run.locator("button")); assert.ok(Math.max(...narrow.map(b=>b.w))-Math.min(...narrow.map(b=>b.w))<1);
});
