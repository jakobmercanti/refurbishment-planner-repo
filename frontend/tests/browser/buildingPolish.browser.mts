import assert from "node:assert/strict";
import test, { before, after } from "node:test";
import { readFile } from "node:fs/promises";
import { newProject, parseProject } from "../../lib/projectDocument";
import { defaultBuilding, duplicateFloor, projectFloors, selectFloor } from "../../lib/buildingDocument";
import { ROOF_MATERIALS } from "../../lib/roofAppearance";
import { eventually, startBrowserHarness } from "./harness.mjs";

let harness, palettes;
before(async () => { palettes=JSON.parse(await readFile(new URL("../../../data/ui_theme_defaults.json",import.meta.url),"utf8")).themes; harness = await startBrowserHarness(); });
after(async () => { await harness?.close(); });

function fixture() {
  let project = newProject();
  const measure = (value: number) => ({ value, uncertainty_mm: 0, verified: true, source_type: "USER_MEASURED" });
  const vertices = [{ x: 0, y: 0 }, { x: 6400, y: 0 }, { x: 6400, y: 4200 }, { x: 0, y: 4200 }];
  project.rooms = [{ id: "room-polish", source_floorplan_room_id: "outline-polish", name: "Living room", version: 1, vertices, wall_height: measure(2400), wall_thickness: measure(100), wall_thickness_overrides_mm: {}, person_mockup: null, openings: [], obstacles: [] }];
  project.floorplan = { walls: [{ id: "wall-polish", points: [...vertices, vertices[0]] }], rooms: [{ id: "outline-polish", sourceWallId: "wall-polish", sourceWallIds: ["wall-polish"], colourIndex: 0, name: "Living room", vertices }], roomFinishes: {}, openings: [], measurements: [], annotations: [], dimensionOffsets: {}, hiddenDimensions: [], canvasSize: { width: 1100, height: 700 }, selectedRoomId: "outline-polish", wallHeight: 2400, wallThickness: 100, squaredWalls: true, snapEnabled: true, snapSize: 50, viewSettings: { zoom: 1, pan: { x: 0, y: 0 }, showRoomNames: true, showMeasurements: true, showWallThickness: true, showAnnotations: true, showGrid: true } };
  project.building = defaultBuilding(project);
  project = duplicateFloor(project, "floor-ground");
  project.building!.floors[1].name = "Loft";
  project.building!.roof = { ...project.building!.roof, type: "MONO", orientationDeg: 45 };
  return parseProject(selectFloor(project, "floor-ground"));
}

const wire = value => JSON.parse(JSON.stringify(value));
const geometry = project => wire(projectFloors(project).map(floor => floor.content));
async function openRoof(page) {
  if(!await page.locator(".building-properties-window").count())await page.getByRole("button", { name: "Manage floors and building", exact: true }).click();
  await page.getByRole("button", { name: "Edit roof", exact: true }).click();
  const roof = page.locator(".building-roof-window"); await roof.waitFor(); return roof;
}

test("large roof window can move vertically on a short desktop and still reach Apply", async t => {
  const session = await harness.session(fixture()); t.after(() => session.close()); const { page } = session;
  const before = geometry(await session.saved());
  for(const viewport of [{width:1440,height:820},{width:1280,height:720}]) {
  await page.setViewportSize(viewport);
  const roof = await openRoof(page), box = await roof.boundingBox();
  const initialApply = await roof.getByRole("button", { name: "Apply roof & ceiling", exact: true }).boundingBox();
  assert.ok(initialApply.y + initialApply.height <= box.y + box.height, "Apply must be visible without scrolling the desktop fields");
  const title = await roof.locator(".floating-toolbar-titlebar").boundingBox();
  await page.mouse.move(title.x + 240, title.y + title.height / 2);
  await page.mouse.down(); await page.mouse.move(title.x + 240 + (viewport.width===1280?-30:45), title.y + title.height / 2 + 75, { steps: 12 }); await page.mouse.up();
  const moved = await roof.boundingBox();
  assert.ok(moved.y > box.y + 40, `Roof must move down, not remain pinned: ${JSON.stringify({ box, moved })}`);
  assert.ok(Math.abs(moved.x-box.x)>25, "The roof window must also move horizontally on smaller laptops");
  assert.ok(moved.width >= 1200, "The editor should open wider than its old 1120 px default");
  assert.ok(moved.y + moved.height <= viewport.height+1, "Moving must keep the bottom scrollable inside the viewport");
  const apply = roof.getByRole("button", { name: "Apply roof & ceiling", exact: true }); await apply.scrollIntoViewIfNeeded();
  assert.ok(await apply.isVisible()); await roof.getByRole("button", { name: "Cancel", exact: true }).click();
  }
  assert.deepEqual(geometry(await session.saved()), before);
});

test("roof settings have compact heights, aligned help, four directions plus custom and nine finishes", async t => {
  const session = await harness.session(fixture()); t.after(() => session.close()); const { page } = session;
  const before = geometry(await session.saved()), roof = await openRoof(page);
  assert.equal(await roof.getByRole("button", { name: "Preview exterior in 3D", exact: true }).count(), 0);
  const orientation = roof.getByRole("combobox", { name: "Roof orientation", exact: true });
  assert.deepEqual(await orientation.locator("option").evaluateAll(options => options.map(option => option.value)), ["0", "90", "180", "270", "CUSTOM"]);
  const angle = roof.getByRole("spinbutton", { name: "Custom roof angle", exact: true });
  assert.equal(await angle.inputValue(), "45", "A saved diagonal direction must not be rounded to a preset");
  const heights = await Promise.all(["Low height", "High height", "Thickness"].map(name => roof.getByRole("spinbutton", { name, exact: true }).boundingBox()));
  assert.ok(heights.every(box => Math.abs(box.y - heights[0].y) < 1), "All three dimensions belong on one row");
  await orientation.selectOption("90"); assert.equal(await angle.count(), 0);
  await orientation.selectOption("CUSTOM"); await angle.fill("0"); assert.ok(await angle.isVisible(), "Custom remains selected even for a preset angle");
  await angle.fill("361"); assert.equal(await roof.getByRole("button", { name: "Apply roof & ceiling", exact: true }).isDisabled(), true);
  assert.match(await roof.getByRole("alert").innerText(), /Enter a roof angle from 0° to 360°/);
  await angle.fill(""); assert.equal(await roof.getByRole("button", { name: "Apply roof & ceiling", exact: true }).isDisabled(), true);
  await roof.getByRole("combobox", { name: "Roof profile", exact: true }).selectOption("FLAT");
  assert.equal(await roof.getByRole("button", { name: "Apply roof & ceiling", exact: true }).isDisabled(), false, "A hidden, unused direction must not block a flat roof");
  await roof.getByRole("combobox", { name: "Roof profile", exact: true }).selectOption("MONO");
  assert.equal(await roof.getByRole("button", { name: "Apply roof & ceiling", exact: true }).isDisabled(), true);
  await angle.fill("37.5");
  const material = roof.getByRole("combobox", { name: "Roof material", exact: true });
  assert.equal(await material.locator("option").count(), 9);
  for (const preset of ROOF_MATERIALS) {
    await material.selectOption(preset.id); assert.equal(await roof.getByLabel("Roof colour", { exact: true }).inputValue(), preset.colour);
    assert.ok(await roof.locator(".building-roof-preview canvas").isVisible());
  }
  await material.selectOption("TIMBER_SHINGLES");
  const help = await roof.locator(".building-roof-form .window-help-button").evaluateAll(buttons => buttons.map(button => { const box = button.getBoundingClientRect(), style = getComputedStyle(button); return { right: box.right, width: box.width, height: box.height, background: style.backgroundColor, radius: style.borderRadius }; }));
  assert.ok(help.length >= 4); assert.ok(help.every(button => Math.abs(button.right - help[0].right) < 1), JSON.stringify(help));
  assert.equal(new Set(help.map(button => `${button.width}/${button.height}/${button.background}/${button.radius}`)).size, 1);
  await roof.getByRole("button", { name: "Help for Roof materials & colour", exact: true }).click();
  await page.locator(".window-help-host").waitFor(); assert.match(await page.locator(".window-help-content").innerText(), /shingles|membrane/i);
  await page.keyboard.press("Tab"); assert.ok(await page.evaluate(() => !!document.activeElement?.closest(".window-help-host")));
  await page.keyboard.press("Escape"); assert.ok(await roof.isVisible());
  if(process.env.BROWSER_ARTIFACTS)await page.screenshot({path:process.env.BROWSER_ARTIFACTS+"/roof-polish-editor.png"});
  await roof.getByRole("button", { name: "Apply roof & ceiling", exact: true }).click();
  await eventually(session.saved, value => value.building.roof.orientationDeg === 37.5 && value.building.roof.finish.material === "TIMBER_SHINGLES");
  assert.deepEqual(geometry(await session.saved()), before);
  await page.reload(); await openRoof(page); assert.equal(await page.getByRole("spinbutton", { name: "Custom roof angle", exact: true }).inputValue(), "37.5");
  await page.getByRole("combobox", { name: "Roof orientation", exact: true }).selectOption("180");
  await page.locator(".building-roof-window").getByRole("button", { name: "Cancel", exact: true }).click();
  assert.equal((await session.saved()).building.roof.orientationDeg, 37.5, "Cancel must not save a direction draft");
});

test("floor selector matches the roof-first manager order before and after reorder", async t => {
  const session = await harness.session(fixture()); t.after(() => session.close()); const { page } = session;
  await page.getByRole("button", { name: "Manage floors and building", exact: true }).click();
  const selector = page.getByRole("combobox", { name: "Selected floor", exact: true });
  const order = () => page.locator(".building-level-list [data-floor-id]").evaluateAll(rows => rows.map(row => row.dataset.floorId));
  const choices = () => selector.locator("option").evaluateAll(options => options.map(option => option.value).filter(value => value !== "__whole-building__"));
  assert.deepEqual(await choices(), await order());
  await page.getByRole("button", { name: "Move Ground Floor", exact: true }).focus(); await page.keyboard.press("ArrowUp");
  await eventually(order, values => values[0] === "floor-ground"); assert.deepEqual(await choices(), await order());
  await eventually(session.saved, value => value.building.floors[0].name === "Loft");
  assert.deepEqual((await session.saved()).building.floors.map(floor => floor.name), ["Loft", "Ground Floor"]);
  await page.getByRole("button", { name: "3D", exact: true }).click();
  assert.equal(await selector.locator("option").first().innerText(), "Whole building"); assert.deepEqual(await choices(), await order());
});

test("3D wall modes form one keyboard-accessible exclusive submenu, independent of floors and roof", async t => {
  const session = await harness.session(fixture()); t.after(() => session.close()); const { page } = session;
  const before = geometry(await session.saved()); await page.getByRole("button", { name: "3D", exact: true }).click();
  for (const name of ["Transparent walls", "2D cutaway walls", "3D cutaway walls", "Invisible walls", "Solid walls"]) {
    await page.getByRole("button", { name: "Show", exact: true }).click();
    const view = page.locator(".software-show-menu");
    const walls = view.locator(".software-wall-setting"); assert.equal(await walls.evaluate(element => element.open), false);
    await walls.locator("summary").click(); const modes = walls.getByRole("menuitemradio"); assert.equal(await modes.count(), 5);
    assert.equal(await walls.locator('[role="menuitemradio"][aria-checked="true"]').count(), 1);
    assert.ok(!await walls.getByRole("button", { name: /Show all floors|Show roof/ }).count());
    await modes.first().focus(); await page.keyboard.press("End"); assert.equal(await modes.last().evaluate(element => element === document.activeElement), true);
    await page.keyboard.press("Home"); assert.equal(await modes.first().evaluate(element => element === document.activeElement), true);
    await walls.getByRole("menuitemradio", { name, exact: true }).click();
    await page.getByRole("button", { name: "Show", exact: true }).click();
    const reopened = page.locator(".software-show-menu");
    await reopened.locator(".software-wall-setting > summary").click();
    assert.equal(await reopened.getByRole("menuitemradio", { name, exact: true }).getAttribute("aria-checked"), "true");
    assert.equal(await reopened.getByRole("button", { name: "Show all floors", exact: true }).count(), 1);
    if(process.env.BROWSER_ARTIFACTS&&name==="Solid walls")await page.screenshot({path:process.env.BROWSER_ARTIFACTS+"/roof-polish-wall-menu.png"});
    await page.keyboard.press("Escape"); assert.equal(await reopened.locator(".software-wall-setting").evaluate(element => element.open), false);
    await page.keyboard.press("Escape");
  }
  assert.deepEqual(geometry(await session.saved()), before);
});

test("new outline warning is concise, keeps the safe default and makes destructive scope clear", async t => {
  const session = await harness.session(fixture()); t.after(() => session.close()); const { page } = session;
  const before = geometry(await session.saved()); await page.getByRole("button", { name: "New outline", exact: true }).click();
  await page.getByRole("dialog", { name: "New outline", exact: true }).getByRole("button", { name: "OK", exact: true }).click();
  const warning = page.getByRole("dialog", { name: "Replace current building?", exact: true });
  assert.ok((await warning.locator(".building-reset-summary").innerText()).split(/\s+/).length < 30);
  assert.match(await warning.innerText(), /all floors|every floor/i); assert.match(await warning.innerText(), /Undo/); assert.match(await warning.innerText(), /backup/i);
  assert.ok(await warning.getByRole("button", { name: "Cancel", exact: true }).evaluate(element => element === document.activeElement));
  if(process.env.BROWSER_ARTIFACTS)await page.screenshot({path:process.env.BROWSER_ARTIFACTS+"/roof-polish-warning.png"});
  await page.keyboard.press("Escape"); assert.deepEqual(geometry(await session.saved()), before);
});

test("roof editor remains usable in both styles, themes, densities and desktop/mobile sizes", async t => {
  const session = await harness.session(fixture()); t.after(() => session.close()); const { page } = session;
  await openRoof(page);
  for (const style of ["DEFAULT", "MODERN"]) for (const theme of ["light", "dark"]) for (const density of ["comfortable", "compact"]) for (const viewport of [{ width: 1440, height: 900 }, { width: 1280, height: 720 }, { width: 390, height: 640 }, { width: 390, height: 520 }]) {
    await page.setViewportSize(viewport);
    await page.evaluate(({ style, theme, density, palette }) => {
      document.documentElement.dataset.theme = theme; document.documentElement.dataset.density = density;
      document.body.dataset.uiStyle = style.toLowerCase();
      const root=document.documentElement;
      for(const [key,value] of Object.entries(palette.colours))root.style.setProperty("--configured-"+key,value);
      for(const [key,value] of Object.entries(palette.buttons))root.style.setProperty("--configured-ui-button-"+key,value);
      for(const [key,value] of Object.entries(palette.windows))root.style.setProperty("--configured-ui-window-"+key,value);
      root.style.setProperty("--font-sans",palette.typography.sans);root.style.setProperty("--font-mono",palette.typography.controls);
    }, { style, theme, density, palette:palettes[style] });
    const roof = page.locator(".building-roof-window"), apply = roof.getByRole("button", { name: "Apply roof & ceiling", exact: true });
    const dimensions = await roof.locator(".building-roof-dimensions input").evaluateAll(inputs => inputs.map(input => { const box = input.getBoundingClientRect(); return { y:box.y, height:box.height }; }));
    assert.ok(dimensions.every(input => Math.abs(input.y-dimensions[0].y)<1&&Math.abs(input.height-dimensions[0].height)<1), JSON.stringify({style,theme,density,viewport,dimensions}));
    await apply.scrollIntoViewIfNeeded(); const box = await apply.boundingBox(), window = await roof.boundingBox();
    assert.ok(box.y >= 0 && box.y + box.height <= viewport.height + 1, JSON.stringify({ style, theme, density, viewport, box }));
    assert.ok(window.x >= 0 && window.x + window.width <= viewport.width + 1);
    const overflow = await roof.locator(".floating-toolbar-content").evaluate(element => element.scrollWidth - element.clientWidth);
    assert.ok(overflow <= 1, `No horizontal clipping: ${style}/${theme}/${density}/${viewport.width}: ${overflow}`);
    await roof.getByRole("button", { name: "Help for Roof & ceiling", exact: true }).click();
    const help = page.locator(".window-help-host"); await help.waitFor(); await page.keyboard.press("Escape");
    if(process.env.BROWSER_ARTIFACTS&&style==="MODERN"&&density==="comfortable")await page.screenshot({path:`${process.env.BROWSER_ARTIFACTS}/roof-polish-${theme}-${viewport.width}.png`});
  }
});
