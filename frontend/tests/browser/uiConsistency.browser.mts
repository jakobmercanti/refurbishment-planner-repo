import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { newProject, parseProject } from "../../lib/projectDocument";
import { defaultBuilding } from "../../lib/buildingDocument";
import { DEFAULT_ELECTRICAL_CONNECTION, DEFAULT_ELECTRICAL_LAYOUT } from "../../lib/electricalLayout";
import { eventually, menu, startBrowserHarness } from "./harness.mjs";

let harness;
before(async () => { harness = await startBrowserHarness(); await mkdir("../.local-logs/ui-nov01-qa", { recursive: true }); });
after(async () => { await harness?.close(); });
function fixture() {
  const project = newProject();
  const measure = (value: number) => ({ value, uncertainty_mm: 0, verified: true, source_type: "USER_MEASURED" });
  const vertices = [{ x: 0, y: 0 }, { x: 6400, y: 0 }, { x: 6400, y: 4200 }, { x: 0, y: 4200 }];
  const obstacles = ["board", "a", "b", "c"].map((id, i) => ({ id, name: id === "board" ? "Consumer unit" : `Socket ${id}`, representation_key: id === "board" ? "electrical-board-compact" : "electrical-socket-double", fixture_kind: "FURNITURE", base_z_mm: 400, verified: true, center: { x: 800 + i * 1300, y: 200 }, rotation_deg: 0, dimensions: { width: measure(100), depth: measure(50), height: measure(100) } }));
  project.rooms = [{ id: "room-a", source_floorplan_room_id: "outline-a", name: "Studio", version: 1, vertices, wall_height: measure(2400), wall_thickness: measure(50), wall_thickness_overrides_mm: {}, person_mockup: null, openings: [], obstacles }];
  project.floorplan = { walls: [{ id: "wall-a", points: [...vertices, vertices[0]] }], rooms: [{ id: "outline-a", sourceWallId: "wall-a", sourceWallIds: ["wall-a"], colourIndex: 0, name: "Studio", vertices }], roomFinishes: {}, openings: [], measurements: [], annotations: [], dimensionOffsets: {}, hiddenDimensions: [], canvasSize: { width: 1100, height: 700 }, selectedRoomId: "outline-a", wallHeight: 2400, wallThickness: 50, squaredWalls: true, snapEnabled: true, snapSize: 50, viewSettings: { zoom: 1, pan: { x: 0, y: 0 }, showRoomNames: true, showMeasurements: true, showWallThickness: true, showAnnotations: true, showGrid: true } };
  project.electricalLayout = { ...DEFAULT_ELECTRICAL_LAYOUT, circuits: [{ id: "sockets", name: "Sockets", color: "#287fb8", socketTopology: "RING", consumerUnitId: "board", socketIds: ["a", "b", "c"] }] };
  project.building = defaultBuilding(project);
  return parseProject(project);
}

test("floating Export uses the floorplan dialog and is restricted to Floorplan 2D", async t => {
  const session = await harness.session(fixture()); t.after(() => session.close()); const { page } = session;
  await page.getByRole("button", { name: "Export floorplan", exact: true }).click();
  await page.locator(".floorplan-export-dialog").waitFor();
  await page.locator(".floorplan-export-dialog").getByRole("button", { name: "Cancel", exact: true }).click();
  await page.getByRole("button", { name: "3D", exact: true }).click();
  await page.waitForFunction(() => !document.querySelector(".floorplan-export-shortcut"));
  await page.getByRole("button", { name: "2D", exact: true }).click();
  await page.getByRole("button", { name: "Export floorplan", exact: true }).waitFor();
});

test("control tooltips explain the hovered field and the floorplan controls stay aligned", async t => {
  const session = await harness.session(fixture());
  t.after(() => session.close());
  const { page } = session;
  const build = page.locator(".full-plan-build-toolbar");
  const annotate = build.getByRole("button", { name: "Annotate", exact: true });
  const view = page.getByRole("button", { name: /^Room names:/ });
  const style = locator => locator.evaluate(el => ({ radius: getComputedStyle(el).borderTopLeftRadius, weight: getComputedStyle(el).fontWeight }));
  assert.equal((await style(annotate)).radius, (await style(view)).radius);
  assert.equal((await style(view)).weight, "500");
  await annotate.hover();
  const tooltip = page.getByRole("tooltip");
  await tooltip.waitFor();
  assert.match(await tooltip.textContent(), /add text, symbols and leaders/);
  await build.getByRole("button", { name: "Overall properties", exact: true }).click();
  const thickness = build.getByLabel(/^Default thickness/), grid = build.getByLabel(/^Grid size/);
  assert.ok(Math.abs((await thickness.boundingBox()).y - (await grid.boundingBox()).y) < 1);
  await grid.hover();
  await tooltip.waitFor();
  assert.match(await tooltip.textContent(), /Distance between snap points/);
  await page.keyboard.press("Escape");
  await tooltip.waitFor({ state: "hidden" });
  await page.getByRole("button", { name: "Manage floors and building", exact: true }).click();
  const manager = page.locator(".building-properties-window");
  const [roofEdit, floorEdit, roofDelete, floorDelete] = await Promise.all(
    ["Edit roof", "Edit Ground Floor", "Delete roof", "Delete Ground Floor"].map(name => manager.getByRole("button", { name, exact: true }).boundingBox()),
  );
  assert.equal(roofEdit.x, floorEdit.x);
  assert.equal(roofDelete.x, floorDelete.x);
  await manager.getByRole("button", { name: "+ Floor", exact: true }).click();
  const editor = page.locator(".building-floor-editor-window");
  const clear = editor.getByLabel("Clear height below slab", { exact: true });
  const slab = editor.getByRole("spinbutton", { name: "Floor slab thickness", exact: true });
  assert.equal((await clear.boundingBox()).y, (await slab.boundingBox()).y);
  await slab.fill("300");
  await slab.press("Enter");
  assert.match(await clear.inputValue(), /2300/);
});

test("circuit labels avoid socket symbols and editing exits on Done or Escape", async t => {
  const project = fixture();
  const socket = project.rooms[0].obstacles.find(item => item.id === "a");
  project.electricalLayout.connections = [{
    ...DEFAULT_ELECTRICAL_CONNECTION, id: "route-a", fromId: "board", toId: "a", circuitId: "sockets",
    waypoints: [], label: "Kitchen sockets", labelPosition: socket.center,
  }];
  project.building = defaultBuilding(project);
  const session = await harness.session(parseProject(project));
  t.after(() => session.close());
  const { page } = session;
  await menu(page, "Tools", "Electrical Layout module…");
  const panel = page.locator(".electrical-layout-window");
  await panel.locator("summary").filter({ hasText: /^Display$/ }).click();
  const [symbols, routes] = await Promise.all(["Electrical symbols", "Connections"].map(name => panel.getByRole("checkbox", { name, exact: true }).boundingBox()));
  assert.equal(symbols.y, routes.y);
  assert.ok(symbols.x < routes.x);
  await panel.getByRole("checkbox", { name: "Circuit labels", exact: true }).check();
  const label = page.locator(".electrical-draggable-label").filter({ hasText: "Kitchen sockets" });
  const plate = page.getByRole("button", { name: "Electrical fitting: Socket a, connected", exact: true }).locator(".electrical-fixture-backplate");
  for (const zoom of [false, true]) {
    if (zoom) await page.getByRole("button", { name: "Zoom in", exact: true }).click();
    const [a, b] = await Promise.all([label.boundingBox(), plate.boundingBox()]);
    assert.ok(a && b && (a.y + a.height < b.y || b.y + b.height < a.y));
  }
  await panel.locator("summary").filter({ hasText: /^Circuits \(1\)$/ }).click();
  await panel.locator("summary").filter({ hasText: /^Connections \(1\)$/ }).click();
  const row = panel.locator(".electrical-connection-row");
  const edit = row.getByRole("button", { name: /^Edit connection/ });
  const done = row.getByRole("button", { name: /^Done editing connection/ });
  await edit.click();
  await panel.getByLabel("Optional label", { exact: true }).fill("Kitchen ring");
  await done.click();
  await edit.waitFor();
  await eventually(session.saved, value => value.electricalLayout.connections[0].label === "Kitchen ring");
  await edit.click();
  await page.keyboard.press("Escape");
  await edit.waitFor();
  assert.equal(await row.getByRole("button", { name: /^Select connection/ }).getAttribute("aria-pressed"), "false");
});

test("compact windows shrink without clipped actions and keep resize targets", async t => {
  const session = await harness.session(fixture()); t.after(() => session.close()); const { page } = session;
  const panel = page.locator(".full-plan-build-toolbar");
  const before = await panel.boundingBox(); assert.ok(before);
  const railWidth = await panel.locator(".floating-toolbar-resize-right").evaluate(el => el.getBoundingClientRect().width);
  await menu(page, "Settings", "Preferences…"); const preferences = page.locator(".settings-dialog");
  const dialogBefore = await preferences.boundingBox();
  await preferences.getByRole("button", { name: "Compact", exact: true }).click();
  const dialogCompact = await preferences.boundingBox(); assert.ok(dialogBefore && dialogCompact && dialogCompact.width < dialogBefore.width - 20);
  await preferences.getByRole("button", { name: "Done", exact: true }).click();
  await page.waitForFunction(() => document.documentElement.dataset.density === "compact");
  const compact = await panel.boundingBox(); assert.ok(compact && compact.width < before.width - 20);
  assert.equal(await panel.locator(".floating-toolbar-resize-right").evaluate(el => el.getBoundingClientRect().width), railWidth);
  assert.deepEqual(await panel.locator(".floating-toolbar-content button:visible").evaluateAll(buttons => buttons.filter(b => b.scrollWidth > b.clientWidth + 1 || b.scrollHeight > b.clientHeight + 1).map(b => b.textContent)), []);
  await panel.getByRole('button',{name:'Window layout for Build floorplan',exact:true}).click();
  await page.getByRole('menuitem',{name:'Dock left',exact:true}).click();
  await eventually(()=>panel.getAttribute('data-edge-docked'),side=>side==='LEFT');
  assert.ok(Math.abs((await panel.boundingBox()).width-compact.width)<2,'Docking must retain the compact width');
  await panel.getByRole('button',{name:'Window layout for Build floorplan',exact:true}).click();
  await page.getByRole('menuitem',{name:'Float window',exact:true}).click();
  await eventually(()=>panel.getAttribute('data-edge-docked'),side=>!side);
  assert.ok(Math.abs((await panel.boundingBox()).width-compact.width)<2);
  const rail = await panel.locator(".floating-toolbar-resize-right").boundingBox(); assert.ok(rail);
  await page.mouse.move(rail.x + rail.width / 2, rail.y + 15); await page.mouse.down(); await page.mouse.move(rail.x + rail.width / 2 + 60, rail.y + 15, { steps: 8 }); await page.mouse.up();
  const resized = await panel.boundingBox(); assert.ok(resized && Math.abs(resized.width - compact.width - 60) < 3);
  await page.screenshot({ path: "../.local-logs/ui-nov01-qa/compact.png" });
});

test("circuit row actions stay equal and single-line when the window shrinks", async t => {
  const project = fixture();
  project.electricalLayout!.circuits.push({ id: "lighting", name: "Lighting with a long circuit label", color: "#282fb8" });
  const session = await harness.session(parseProject(project));
  t.after(() => session.close());
  const { page } = session;
  await menu(page, "Tools", "Electrical Layout module…");
  const panel = page.locator(".electrical-layout-window");
  await panel.locator("summary").filter({ hasText: "Circuits (2)" }).click();
  const row = panel.locator(".electrical-circuit-row").last();
  const sizes = () => row.locator("button").evaluateAll(buttons => buttons.map(button => {
    const bounds = button.getBoundingClientRect();
    const text = document.createRange();
    text.selectNodeContents(button);
    return { width: bounds.width, font: getComputedStyle(button).font, lines: text.getClientRects().length };
  }));
  const before = await sizes();
  const rail = await panel.locator(".floating-toolbar-resize-right").boundingBox();
  assert.ok(rail);
  await page.mouse.move(rail.x + rail.width / 2, rail.y + 24);
  await page.mouse.down();
  await page.mouse.move(rail.x + rail.width / 2 - 110, rail.y + 24, { steps: 6 });
  await page.mouse.up();
  const after = await sizes();
  assert.ok(after[0].width < before[0].width - 50);
  assert.equal(after[1].width, before[1].width);
  assert.equal(after[1].width, after[2].width);
  assert.equal(after[1].font, after[2].font);
  assert.deepEqual(after.slice(1).map(button => button.lines), [1, 1]);
});

test("socket ring generation persists, individual plan testing works, broken returns fail", async t => {
  const session = await harness.session(fixture()); t.after(() => session.close()); const { page } = session;
  await menu(page, "Tools", "Electrical Layout module…");
  const panel = page.locator(".electrical-layout-window");
  await panel.locator("summary").filter({ hasText: "Circuits (1)" }).click();
  assert.equal(await panel.getByLabel("Circuit type", { exact: true }).count(), 0);
  await panel.getByRole("button", { name: /^Edit circuit / }).click();
  const editor = page.getByRole("dialog", { name: /^Edit circuit/ });
  await editor.getByLabel("Notes", { exact: true }).fill("Kitchen outlets");
  await editor.getByRole("button", { name: "Save and create socket routes", exact: true }).click();
  await editor.waitFor({ state: "hidden", timeout: 3000 }).catch(async () => assert.fail(await editor.innerText()));
  await eventually(session.saved, value => value?.electricalLayout?.connections.length === 4);
  await panel.getByRole("button", { name: "Check layout", exact: true }).click();
  const tester = page.locator(".electrical-lighting-test-window");
  await tester.getByRole("button", { name: /^Socket a/ }).click();
  assert.equal(await tester.getByRole("button", { name: /^Socket a/ }).getAttribute("aria-pressed"), "true");
  const planSocket = page.getByRole("button", { name: "Electrical fitting: Socket b, connected", exact: true });
  await planSocket.focus(); await planSocket.press("Enter");
  assert.equal(await tester.getByRole("button", { name: /^Socket b/ }).getAttribute("aria-pressed"), "true");
  assert.equal(await tester.locator(".socket-test-list button").filter({ hasText: "Closed ring connected" }).count(), 3);
  await page.screenshot({ path: "../.local-logs/ui-nov01-qa/socket-ring.png" });
  await tester.getByRole("button", { name: "Hide Electrical layout test", exact: true }).click();
  const saved = await session.saved(); const connection = saved.electricalLayout.connections.at(-1);
  assert.equal(saved.electricalLayout.circuits[0].description, "Kitchen outlets");
  await panel.locator("summary").filter({ hasText: "Connections (4)" }).click();
  const row = panel.locator(".electrical-connection-row").last();
  await row.getByRole("button", { name: /^Delete connection/ }).click();
  await eventually(session.saved, value => value?.electricalLayout?.connections.length === 3 && !value.electricalLayout.connections.some(e => e.id === connection.id));
  await panel.getByRole("button", { name: "Check layout", exact: true }).click();
  assert.equal(await tester.locator(".socket-test-list button").filter({ hasText: "Ring incomplete" }).count(), 3);
});

test("missing socket references can be removed and a replacement consumer unit restores a radial",async t=>{
  const project=fixture();project.electricalLayout!.circuits[0]={...project.electricalLayout!.circuits[0],socketTopology:'RADIAL',consumerUnitId:'missing-board',socketIds:['a','missing-socket']};
  const session=await harness.session(parseProject(project));t.after(()=>session.close());const {page}=session;
  await menu(page,'Tools','Electrical Layout module…');const panel=page.locator('.electrical-layout-window');
  await panel.locator('summary').filter({hasText:'Circuits (1)'}).click();
  await panel.getByRole('button',{name:/^Edit circuit /}).click();
  const editor=page.getByRole('dialog',{name:/^Edit circuit/});
  const board=editor.getByRole('combobox',{name:'Consumer unit',exact:true});
  assert.match(await board.locator('option:checked').textContent(),/Missing consumer unit/);
  await editor.getByRole('button',{name:'Remove missing socket from circuit',exact:true}).click();
  await board.selectOption('board');await editor.getByRole('button',{name:'Save and create socket routes',exact:true}).click();
  await editor.waitFor({ state: "hidden", timeout: 3000 }).catch(async () => assert.fail(await editor.innerText()));
  const saved=await eventually(session.saved,p=>p?.electricalLayout?.connections.length===1);
  assert.deepEqual(saved.electricalLayout.circuits[0].socketIds,['a']);
  assert.deepEqual([saved.electricalLayout.connections[0].fromId,saved.electricalLayout.connections[0].toId],['board','a']);
  await panel.getByRole('button',{name:'Check layout',exact:true}).click();
  const tester=page.locator('.electrical-lighting-test-window');await tester.getByRole('button',{name:/^Socket a/}).click();
  assert.match(await tester.getByRole('button',{name:/^Socket a/}).textContent(),/Radial connected/);
});

test("service windows use one main guide and one contextual guide per main section", async t => {
  const session = await harness.session(fixture()); t.after(() => session.close()); const { page } = session;
  for (const [entry, selector] of [["Electrical Layout module…", ".electrical-layout-window"], ["Heating & ventilation", ".heating-layout-window"], ["Energy & Insulation", ".energy-layout-window"]]) {
    await menu(page, "Tools", entry); const panel = page.locator(selector);
    await panel.locator(".floating-toolbar-titlebar .window-help-button").click();
    const help = page.locator(".window-help-host .floating-toolbar-content"); await help.waitFor();
    const main = (await help.locator("p").allTextContents()).join("\n"); await page.keyboard.press("Escape");
    const buttons = panel.locator(".menu-section-help:visible");
    assert.ok(await buttons.count() > 0, entry);
    assert.equal(await panel.locator(".floating-toolbar-content .window-help-button:visible").count(), await buttons.count());
    for (let i = 0; i < await buttons.count(); i++) {
      const button = buttons.nth(i), summary = button.locator(".."), section = summary.locator("..");
      const open = await section.evaluate(el => el.open);
      assert.equal(await summary.locator(":scope > .menu-section-help").count(), 1);
      assert.equal(await section.locator(":scope details .menu-section-help").count(), 0);
      await button.click(); await help.waitFor(); const body = (await help.locator("p").allTextContents()).join("\n");
      assert.ok(body && body !== main, `${entry}: repeated main help`);
      await page.keyboard.press("Escape"); assert.equal(await section.evaluate(el => el.open), open);
    }
    await panel.locator(".floating-toolbar-close").click();
  }
});

test("opening controls use one outlined chevron and keep content gutters clear of resize rails", async t => {
  const session = await harness.session(fixture()); t.after(() => session.close()); const { page } = session;
  const selector = page.getByRole("combobox", { name: "Add to plan", exact: true });
  await selector.selectOption("WINDOW");
  const panel = page.locator(".floating-toolbar").filter({ has: selector });
  assert.ok(await selector.evaluate(el => parseFloat(getComputedStyle(el).paddingRight)) >= 30);
  assert.ok(await selector.evaluate(el => getComputedStyle(el).backgroundImage.includes("data:image/svg+xml")));
  const arrows = panel.locator(".fixture-colours-toggle > span[aria-hidden], .fixture-section-toggle > span[aria-hidden], .fixture-cascading-collapsed > button");
  assert.ok(await arrows.count() >= 2);
  assert.ok((await arrows.evaluateAll(elements => elements.map(el => getComputedStyle(el, el.tagName === "BUTTON" ? "::after" : null).maskImage))).every(mask => mask.includes("data:image/svg+xml")));
  const primarySize=await selector.evaluate(el=>parseFloat(getComputedStyle(el).backgroundSize));
  const secondarySizes=await arrows.evaluateAll(elements=>elements.map(el=>parseFloat(getComputedStyle(el,el.tagName==='BUTTON'?'::after':null).width)));
  assert.equal(primarySize,16);assert.ok(secondarySizes.every(size=>size===12));
  assert.ok(await panel.locator('.fixture-cascading-collapsed > button, .fixture-cascading-trigger').first().evaluate(el=>el.getBoundingClientRect().width>=24));
  const gutters = await panel.locator(".floating-toolbar-content").evaluate(el => { const s = getComputedStyle(el); return [parseFloat(s.paddingLeft), parseFloat(s.paddingRight), parseFloat(s.marginLeft), parseFloat(s.marginRight)]; });
  assert.ok(gutters.every(v => v <= 5));
  await page.screenshot({ path: "../.local-logs/ui-nov01-qa/chevrons-and-gutters.png" });
});

test("small-screen Export and Floor controls do not overlap", async t => {
  const session = await harness.session(fixture(), { viewport: { width: 390, height: 844 } }); t.after(() => session.close()); const { page } = session;
  const shortcut = await page.locator(".floorplan-export-shortcut").boundingBox(), floor = await page.locator(".building-floor-bar").boundingBox();
  assert.ok(shortcut && floor && shortcut.x + shortcut.width + 4 <= floor.x);
  assert.ok(await page.locator(".building-floor-bar").evaluate(el => parseFloat(getComputedStyle(el).paddingLeft)) >= 10);
  await page.screenshot({ path: "../.local-logs/ui-nov01-qa/mobile-toolbar.png" });
});

test("modern electrical selector stays clickable and changes the fitting; list has a top gutter", async t => {
  const project = fixture();
  project.rooms[0].obstacles[1].name = "Double socket with a long catalogue description";
  const session = await harness.session(project); t.after(() => session.close()); const { page, context } = session;
  await context.route("**/catalog/items", route => route.fulfill({ json: ["single", "double"].map((type, index) => ({ id: `switch-${type}`, category_id: "electric", category_name: "Electric", fixture_kind: "FURNITURE", subcategory: "Switches", name: `${index ? "Double" : "Single"} rocker switch`, supplier: "Default", sku: type, width_mm: 86, depth_mm: 12, height_mm: 86, color_hex: "#a6adb1", description: "", is_default: true, representation_key: `electrical-switch-${type}` })) }));
  await menu(page, "Tools", "Electrical Layout module…");
  await page.locator(".electrical-layout-window").getByRole("button", { name: "Add electrical fitting…", exact: true }).click();
  await page.evaluate(() => { document.body.dataset.uiStyle = "modern"; });
  const editor = page.locator(".element-add-editor:visible");
  const expand = editor.getByRole("button", { name: "Expand fittings selector", exact: true });
  assert.equal(await expand.evaluate(el => getComputedStyle(el).maskImage), "none");
  assert.match(await expand.evaluate(el => getComputedStyle(el, "::after").maskImage), /data:image\/svg\+xml/);
  await expand.click(); await editor.getByRole("button", { name: /^Object/ }).click();
  await editor.getByRole("option", { name: "Double rocker switch", exact: true }).click();
  await editor.locator(".fixture-cascading-collapsed").getByText("Double rocker switch", { exact: true }).waitFor();
  await editor.locator(".fixture-list article").first().scrollIntoViewIfNeeded();
  const header = await editor.getByRole("button", { name: "Elements list", exact: true }).boundingBox(), first = await editor.locator(".fixture-list article").first().boundingBox();
  assert.ok(header && first && first.y - header.y - header.height >= 7);
  for (const edit of await editor.locator(".fixture-list .edit-fixture").all()) {
    assert.equal(await edit.evaluate(button => { const text = document.createRange(); text.selectNodeContents(button); return text.getClientRects().length; }), 1);
  }
  await page.screenshot({ path: "../.local-logs/ui-nov01-qa/electrical-selector-modern.png" });
});

test("Heating adds and deletes shared construction scenarios inside the submenu", async t => {
  const session = await harness.session(fixture()); t.after(() => session.close()); const { page } = session;
  await menu(page, "Tools", "Heating & ventilation"); const panel = page.locator(".heating-layout-window");
  const addElement = panel.getByRole("button", { name: "Add element", exact: true }).first();
  assert.equal(await addElement.evaluate(el => el.scrollHeight > el.clientHeight + 1), false);
  assert.equal(await addElement.evaluate(el => { const range = document.createRange(); range.selectNodeContents(el); return range.getClientRects().length; }), 1);
  const section = panel.locator("details").filter({ has: page.getByText(/^Construction scenario ·/, { exact: false }) });
  await section.locator("summary").first().click();
  const remove = section.getByRole("button", { name: "Delete selected scenario", exact: true });
  assert.equal(await remove.isDisabled(), true);
  await section.getByRole("textbox", { name: "New scenario name", exact: true }).fill("Heating upgrade");
  await section.getByRole("button", { name: "Add scenario", exact: true }).click();
  const saved = await eventually(session.saved, value => value?.energyLayout?.scenarios.length === 1);
  assert.equal(saved.energyLayout.scenarios[0].name, "Heating upgrade");
  assert.equal(await remove.isDisabled(), false);
  page.once("dialog", dialog => dialog.dismiss()); await remove.click();
  assert.equal((await session.saved()).energyLayout.scenarios.length, 1);
  await page.screenshot({ path: "../.local-logs/ui-nov01-qa/heating-scenarios.png" });
  page.once("dialog", dialog => dialog.accept()); await remove.click();
  await eventually(session.saved, value => value?.energyLayout?.scenarios.length === 0 && value.energyLayout.activeScenarioId === null);
  assert.equal(await remove.isDisabled(), true);
  await section.getByRole("button", { name: "Add scenario", exact: true }).click();
  const automatic = await eventually(session.saved, value => value?.energyLayout?.scenarios[0]?.name === "Upgrade 1");
  await page.reload(); await menu(page, "Tools", "Heating & ventilation");
  await panel.locator("summary").filter({ hasText: "Construction scenario · Upgrade 1" }).click();
  assert.equal(await panel.getByRole("combobox", { name: "Load construction scenario", exact: true }).inputValue(), automatic.energyLayout.activeScenarioId);
});
