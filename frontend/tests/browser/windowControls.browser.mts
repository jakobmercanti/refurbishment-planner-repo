import assert from "node:assert/strict";
import test, { before, after } from "node:test";
import { cfdProject } from "../climoptixFixtures";
import { cfdWindow, eventually, menu, startBrowserHarness } from "./harness.mjs";

let harness;
before(async () => { harness = await startBrowserHarness({ climoptixEnabled: true }); });
after(async () => { await harness?.close(); });
const panel = (page, title) => page.locator(".floating-toolbar").filter({ has: page.getByLabel(`Move ${title}`, { exact: true }) }).filter({ visible: true });
const roomGeometry = rooms => rooms.map(room => ({ id: room.id, vertices: room.vertices, height: room.wall_height, thickness: room.wall_thickness, obstacles: room.obstacles, openings: room.openings.map(opening => ({ id: opening.id, wall: opening.parent_wall_id, kind: opening.kind, offset: opening.offset_mm, width: opening.width, height: opening.height, sill: opening.sill_height_mm })) }));
async function open(t, options = {}) {
  const session = await harness.session(cfdProject(), options);
  t.after(() => session.close());
  return session;
}
async function layout(page, title, action) {
  const window = panel(page, title);
  await window.getByLabel(`Move ${title}`, { exact: true }).click({ position: { x: 70, y: 20 } });
  await window.getByRole("button", { name: `Window layout for ${title}`, exact: true }).click();
  await page.getByRole("menu", { name: `${title} window layout`, exact: true }).getByRole("menuitem", { name: action, exact: true }).click();
  return window;
}
async function capture(page, name) {
  if (process.env.BROWSER_ARTIFACTS) await page.screenshot({ path: `${process.env.BROWSER_ARTIFACTS}/window-controls-${name}.png` });
}
async function backgroundPoint(page) {
  const point = await page.evaluate(() => {
    const svg = document.querySelector(".floor-canvas"), box = svg.getBoundingClientRect();
    for (let y = Math.max(box.top + 25, 25); y < Math.min(box.bottom - 20, innerHeight - 20); y += 28) {
      for (let x = Math.max(box.left + 25, 25); x < Math.min(box.right - 20, innerWidth - 20); x += 28) {
        const target = document.elementFromPoint(x, y);
        if (target instanceof SVGElement && svg.contains(target) && !target.closest("[data-energy-interactive]")) return { x, y };
      }
    }
    return null;
  });
  assert.ok(point, "an unobstructed blank part of the plan is reachable");
  return point;
}

test("CFD maximise and restore preserve parameters, floating geometry and attached state", async t => {
  const { page, saved } = await open(t);
  await page.getByRole("combobox", { name: "Workspace", exact: true }).selectOption("CLIMOPTIX");
  const ui = page.locator(".cfx-workspace");
  await cfdWindow(ui, "Simulation");
  await ui.getByRole("tab", { name: "Run", exact: true }).click();
  const cpu = ui.getByRole("spinbutton", { name: "CPU cores", exact: true });
  await cpu.fill("7"); await cpu.press("Enter");
  const before = await panel(page, "Simulation setup").boundingBox();
  const window = await layout(page, "Simulation setup", "Maximise window");
  await eventually(() => window.boundingBox(), box => Math.abs(box.x) < 1 && Math.abs(box.y) < 1 && Math.abs(box.width - 1440) < 2 && Math.abs(box.height - 1000) < 2);
  assert.equal(await page.locator(".topbar").isVisible(), false);
  assert.equal(await cpu.inputValue(), "7");
  await capture(page, "cfd-maximised");
  await layout(page, "Simulation setup", "Restore window");
  await eventually(() => window.boundingBox(), box => Math.abs(box.width - before.width) < 2 && Math.abs(box.x - before.x) < 2 && Math.abs(box.y - before.y) < 2);
  await layout(page, "Simulation setup", "Dock left");
  const docked = await window.boundingBox();
  await cfdWindow(ui, "View properties");
  const view = await layout(page, "View properties", "Dock right");
  await layout(page, "Simulation setup", "Maximise window");
  await eventually(() => window.getAttribute("data-edge-docked"), value => value === null);
  const max = await window.boundingBox();
  assert.ok(Math.abs(max.width - 1440) < 2, "maximisation fills the viewport, including occupied rails");
  assert.equal(await view.isVisible(), false, "other docked windows are temporarily hidden");
  await layout(page, "Simulation setup", "Restore window");
  await eventually(() => window.getAttribute("data-edge-docked"), value => value === "LEFT");
  assert.equal(await view.isVisible(), true);
  assert.equal(await page.locator(".topbar").isVisible(), true);
  assert.ok(Math.abs((await window.boundingBox()).width - docked.width) < 2);
  await eventually(saved, project => project.cfdScenarios[0].resources.cpu === 7);
});

test("two minimized CFD windows have separate restore tabs and preserve their position and settings",async t=>{
  const {page,saved}=await open(t);
  await page.getByRole('combobox',{name:'Workspace',exact:true}).selectOption('CLIMOPTIX');
  const ui=page.locator('.cfx-workspace');await cfdWindow(ui,'Solver');
  await ui.getByRole('tab',{name:'Run',exact:true}).click();
  const cpu=ui.getByRole('spinbutton',{name:'CPU cores',exact:true});await cpu.fill('7');await cpu.press('Enter');
  const setup=page.locator('.cfx-setup-window'),setupBefore=await setup.boundingBox();
  await cfdWindow(ui,'View properties');
  const view=page.locator('.cfx-view-window'),viewBefore=await view.boundingBox();
  await page.getByRole('button',{name:'Minimise View properties',exact:true}).click();
  await page.getByRole('button',{name:'Minimise Simulation setup',exact:true}).click();
  assert.equal(await setup.isVisible(),false);assert.equal(await view.isVisible(),false);
  await page.waitForTimeout(250); // Let hidden-window resize observers run before restoring.
  const tasks=page.locator('.floating-window-task');assert.equal(await tasks.count(),2);
  const boxes=await tasks.evaluateAll(nodes=>nodes.map(node=>node.getBoundingClientRect().y));assert.ok(Math.abs(boxes[0]-boxes[1])>=34);
  await page.getByRole('button',{name:'Restore View properties',exact:true}).click();assert.equal(await setup.isVisible(),false);
  await page.getByRole('button',{name:'Restore Simulation setup',exact:true}).click();
  for(const [window,before] of [[setup,setupBefore],[view,viewBefore]] as const){
    const after=await window.boundingBox();for(const axis of ['x','y','width','height'])assert.ok(Math.abs(after[axis]-before[axis])<2,`${axis}: ${JSON.stringify({before,after})}`);
  }
  assert.equal(await cpu.inputValue(),'7');await eventually(saved,p=>p.cfdScenarios[0].resources.cpu===7);
});

test("docking reflows underlying tools and portalled help outside both rails, then restores their widths", async t => {
  const { page } = await open(t);
  const build = panel(page, "Build floorplan"), original = await build.boundingBox();
  await menu(page, "Tools", "Energy & Insulation");
  const energy = await layout(page, "Energy & Insulation", "Dock left");
  async function outsideRails(window) {
    await eventually(async () => ({ box: await window.boundingBox(), view: await page.locator(".full-plan-drawing").boundingBox() }), ({ box, view }) => box && box.x >= view.x + 7 && box.x + box.width <= view.x + view.width - 7);
    const header = window.locator(".floating-toolbar-titlebar");
    await header.click({ position: { x: 70, y: 20 } });
    assert.ok(await window.getByRole("button", { name: /^Hide / }).isVisible());
  }
  await outsideRails(build);
  const view = await layout(page, "View properties", "Dock right");
  await outsideRails(build);
  await energy.getByRole("button", { name: "Help for Energy & Insulation", exact: true }).click();
  const help = panel(page, "Help — Energy & Insulation");
  await outsideRails(help);
  const buildLayout = build.getByRole("button", { name: "Window layout for Build floorplan", exact: true });
  await buildLayout.focus();
  assert.ok(await buildLayout.evaluate(button => button.contains(document.elementFromPoint(button.getBoundingClientRect().x + 10, button.getBoundingClientRect().y + 10))), "keyboard focus raises an overlapped window");
  await help.getByRole("button", { name: "Hide Help — Energy & Insulation", exact: true }).focus();
  await capture(page, "both-rails");
  await help.getByRole("button", { name: "Hide Help — Energy & Insulation", exact: true }).click();
  await page.setViewportSize({ width: 1152, height: 800 });
  await outsideRails(build);
  await capture(page, "narrow-rails");
  await page.setViewportSize({ width: 1440, height: 1000 });
  await layout(page, "View properties", "Float window");
  await energy.getByRole("button", { name: "Hide Energy & Insulation", exact: true }).click();
  await eventually(() => build.boundingBox(), box => Math.abs(box.width - original.width) < 2);
  assert.equal(await view.getAttribute("data-edge-docked"), null);
});

test("empty-plan clicks clear insulation selection, while drags and middle-button navigation keep it", async t => {
  const { page, saved } = await open(t);
  await menu(page, "Tools", "Energy & Insulation");
  const energy = panel(page, "Energy & Insulation"), select = energy.getByRole("combobox", { name: "Select wall", exact: true });
  await select.selectOption({ index: 1 });
  const id = await select.inputValue();
  await eventually(() => page.locator('[data-energy-layer] line[stroke="#1b81ef"]').count(), count => count === 1);
  const before = roomGeometry((await saved()).rooms);
  let point = await backgroundPoint(page);
  await page.mouse.move(point.x, point.y); await page.mouse.down();
  await page.mouse.move(point.x + 24, point.y + 16, { steps: 5 }); await page.mouse.up();
  assert.equal(await select.inputValue(), id);
  point = await backgroundPoint(page);
  await page.mouse.move(point.x, point.y); await page.mouse.down({ button: "middle" });
  await page.mouse.move(point.x + 15, point.y + 15, { steps: 5 }); await page.mouse.up({ button: "middle" });
  assert.equal(await select.inputValue(), id);
  point = await backgroundPoint(page);
  await page.mouse.click(point.x, point.y);
  await eventually(() => select.inputValue(), value => value === "");
  assert.equal(await page.locator('[data-energy-layer] line[stroke="#1b81ef"]').count(), 0);
  assert.equal(await energy.getByRole("button", { name: /Define wall layers/ }).count(), 0);
  assert.deepEqual(roomGeometry((await saved()).rooms), before);
});

test("instructional insulation content lives in contextual help, not the editing surface", async t => {
  const { page } = await open(t);
  await menu(page, "Tools", "Energy & Insulation");
  const energy = panel(page, "Energy & Insulation");
  await energy.getByRole("tab", { name: "Openings", exact: true }).click();
  assert.doesNotMatch(await energy.innerText(), /Planning assumptions & limitations|Dimensions come from the floorplan|Use the tested whole-element/);
  await energy.getByRole("button", { name: "Help for Select opening", exact: true }).click();
  const help = panel(page, "Help — Energy & Insulation — Select opening");
  await help.getByRole("heading", { name: "Planning assumptions & limitations", exact: true }).waitFor();
  assert.match(await help.innerText(), /whole-element U-value/);
  await help.getByRole("button", { name: /^Hide Help/ }).click();
  await energy.getByRole("button", { name: "Help for Energy & Insulation", exact: true }).click();
  assert.equal(await panel(page, "Help — Energy & Insulation").getByRole("link").count(), 4);
  await layout(page, "Help — Energy & Insulation", "Maximise window");
  await capture(page, "help-maximised");
});

test("mobile windows can maximise without docking, and modal windows maximise without losing modality", async t => {
  const { page } = await open(t, { hasTouch: true, viewport: { width: 390, height: 844 } });
  await page.getByRole("combobox", { name: "Workspace", exact: true }).selectOption("CLIMOPTIX");
  const window = await layout(page, "Simulation setup", "Maximise window");
  assert.equal(await window.getAttribute("data-window-maximized"), "true");
  const box = await window.boundingBox();
  await capture(page, "mobile-maximised");
  assert.ok(Math.abs(box.x) < 1 && Math.abs(box.y) < 1 && Math.abs(box.width - 390) < 2 && Math.abs(box.height - 844) < 2, JSON.stringify(box));
  assert.equal(await page.locator(".topbar").isVisible(), false);
  await page.setViewportSize({ width: 768, height: 900 });
  await layout(page, "Simulation setup", "Restore window");
  await page.setViewportSize({ width: 1440, height: 1000 });
  await menu(page, "Settings", "Preferences…");
  const dialog = page.getByRole("dialog", { name: "Preferences", exact: true });
  const original = await dialog.boundingBox();
  await dialog.getByRole("button", { name: "Maximise Preferences", exact: true }).click();
  await eventually(() => dialog.boundingBox(), value => Math.abs(value.width - 1440) < 2 && Math.abs(value.height - 1000) < 2);
  assert.equal(await dialog.getAttribute("aria-modal"), "true");
  await capture(page, "preferences-maximised");
  await page.keyboard.press("Escape");
  await eventually(() => dialog.getAttribute("data-window-maximized"), value => value === null);
  assert.ok(await dialog.isVisible(), "The first Escape restores a maximised dialog, retaining modality");
  assert.ok(Math.abs((await dialog.boundingBox()).width - original.width) < 2);
  await dialog.getByRole("button", { name: "Help for Preferences", exact: true }).click();
  const help = panel(page, "Help — Preferences");
  assert.ok(await help.evaluate(node => !!node.closest('[role=dialog][aria-modal=true]')), "modal help remains inside the parent dialog");
  await help.getByRole("button", { name: "Hide Help — Preferences", exact: true }).click();
  await dialog.getByRole("button", { name: "Done", exact: true }).click();
});

test("touch taps deselect insulation, but a real two-finger navigation gesture does not", async t => {
  const { page, context } = await open(t, { hasTouch: true, viewport: { width: 900, height: 1100 } });
  await menu(page, "Tools", "Energy & Insulation");
  const energy = panel(page, "Energy & Insulation"), select = energy.getByRole("combobox", { name: "Select wall", exact: true });
  await select.selectOption({ index: 1 });
  const selected = await select.inputValue(), point = await backgroundPoint(page);
  const cdp = await context.newCDPSession(page);
  const first = { x: point.x, y: point.y, id: 1 }, second = { x: point.x + 50, y: point.y + 40, id: 2 };
  await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [first] });
  await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [first, second] });
  await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ ...first, x: first.x + 8 }, { ...second, x: second.x + 35, y: second.y + 20 }] });
  await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  assert.equal(await select.inputValue(), selected);
  const empty = await backgroundPoint(page);
  await page.touchscreen.tap(empty.x, empty.y);
  await eventually(() => select.inputValue(), value => value === "");
});
