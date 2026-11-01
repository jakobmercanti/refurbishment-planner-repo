import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { newProject, parseProject } from "../../lib/projectDocument";
import { defaultBuilding } from "../../lib/buildingDocument";
import { newHeatingProject } from "../../lib/heatingDocument";
import { newEnergyProject } from "../../lib/energyDocument";
import { newHeatingRadiator } from "../../lib/heatingDesign";
import { snapRadiatorToWall } from "../../lib/heatingCalculations";
import { elementFromRadiator } from "../../lib/heatingElements";
import { eventually, menu, startBrowserHarness } from "./harness.mjs";

let harness;
before(async () => { harness = await startBrowserHarness(); await mkdir("../.local-logs/heating-nov01-qa", { recursive: true }); });
after(async () => { await harness?.close(); });
function fixture() {
  const p = newProject();
  const measure = (value: number) => ({ value, uncertainty_mm: 0, verified: true, source_type: "USER_MEASURED" });
  const vertices = [{x:0,y:0},{x:3050,y:0},{x:3050,y:2079},{x:0,y:2079}];
  const room = { id:"room-a", source_floorplan_room_id:"outline-a", name:"Room 1", version:1, vertices, wall_height:measure(2400),wall_thickness:measure(100),wall_thickness_overrides_mm:{},person_mockup:null,openings:[],obstacles:[] };
  room.obstacles = [elementFromRadiator(snapRadiatorToWall(newHeatingRadiator(room),room,{x:3050,y:1000}))];
  p.name="Heating audit"; p.rooms=[room];
  p.floorplan={walls:[{id:"wall-a",points:[...vertices,vertices[0]]}],rooms:[{id:"outline-a",sourceWallId:"wall-a",sourceWallIds:["wall-a"],colourIndex:0,name:"Room 1",vertices}],roomFinishes:{},openings:[],measurements:[],annotations:[],dimensionOffsets:{},hiddenDimensions:[],canvasSize:{width:1100,height:700},selectedRoomId:"outline-a",wallHeight:2400,wallThickness:100,squaredWalls:true,snapEnabled:true,snapSize:50,viewSettings:{zoom:1,pan:{x:0,y:0},showRoomNames:true,showMeasurements:true,showWallThickness:true,showAnnotations:true,showGrid:true}};
  p.heatingLayout=newHeatingProject();p.energyLayout=newEnergyProject();p.building=defaultBuilding(p);
  return parseProject(p);
}
async function heating(session) { await menu(session.page,"Tools","Heating Layout"); return session.page.locator(".heating-layout-window"); }
async function equalWidths(locator) {
  const boxes=await locator.evaluateAll(els=>els.map(e=>e.getBoundingClientRect().width));
  assert.ok(boxes.length>=2 && Math.max(...boxes)-Math.min(...boxes)<2,JSON.stringify(boxes));
}

test("room setup shares actual Insulation U-values and paints the same heat-loss labels",async t=>{
  const session=await harness.session(fixture());t.after(()=>session.close());const {page}=session, panel=await heating(session);
  const actions=panel.getByRole("group",{name:"Room setup settings",exact:true});
  await equalWidths(actions.locator(":scope > button"));
  const boxes=await actions.locator(":scope > button").evaluateAll(els=>els.map(e=>({x:e.getBoundingClientRect().x,y:e.getBoundingClientRect().y})));
  assert.equal(boxes.length,4);assert.equal(boxes[0].y,boxes[1].y);assert.equal(boxes[2].y,boxes[3].y);assert.ok(boxes[2].y>boxes[0].y);
  assert.equal(await panel.locator('label[data-no-menu-help] .service-menu-help').count(),0);
  await panel.getByRole("button",{name:"Building assumptions…",exact:true}).click();
  const settings=page.locator('.floating-toolbar').filter({has:page.getByText("Heating — Building assumptions",{exact:true})});
  await settings.locator(".heating-shared-u-values > summary").click();
  const field=settings.getByRole("spinbutton",{name:/shared U-value/}).first();
  await field.fill("0.123");await field.press("Tab");
  await eventually(session.saved,p=>p?.energyLayout?.existingAssignments?.some(a=>a.uValue===.123));
  await settings.getByRole("button",{name:"Done",exact:true}).click();
  await panel.getByRole("button",{name:"Show heat-loss surfaces",exact:true}).click();
  const layer=page.locator('[data-energy-layer][aria-hidden="true"]');
  await layer.waitFor();assert.match(await layer.textContent(),/U 0.123/);assert.match(await layer.textContent(),/ W/);
  assert.equal(await layer.locator('[data-energy-room-card]').count(),1);
  await page.screenshot({path:"../.local-logs/heating-nov01-qa/shared-u.png"});
  await panel.locator('summary').filter({hasText:/^Room setup/}).click();
  assert.equal(await panel.getByRole("button",{name:"Hide heat-loss surfaces",exact:true}).isVisible(),false);
  assert.equal(await panel.getByText(/^Design updates/).count(),0);
});

test("default UFH is usable, bend handles drag and circuit count regenerates without resizing radiators",async t=>{
  const session=await harness.session(fixture());t.after(()=>session.close());const {page}=session,panel=await heating(session);
  await panel.getByRole("tab",{name:"Underfloor",exact:true}).click();
  await panel.getByRole("button",{name:"Create room UFH",exact:true}).click();
  const initial=await eventually(session.saved,p=>p?.heatingLayout?.ufhCircuits?.length>0);
  const before=initial.heatingLayout.ufhCircuits[0].pathMm;
  assert.equal(initial.heatingLayout.ufhZones[0].designFlowC,40);
  assert.match(await panel.textContent(),/Manifold design 40\/30°C/);
  assert.doesNotMatch(await panel.textContent(),/no complete rating grid|surface-temperature data missing|Output flow not set/);
  await panel.getByRole("button",{name:/^Room 1-01 ·/}).click();
  const handles=page.locator('[data-ufh-handle="position"]');await handles.first().waitFor();
  assert.equal(await handles.count(),await page.locator('[data-ufh-handle="radius"]').count());
  assert.ok(await handles.count()<before.length/4);
  // Header minimise exposes the plan without changing its coordinates.
  await panel.getByRole("button",{name:"Minimise Heating Layout",exact:true}).click();
  const otherWindows=page.locator('.floating-toolbar:not(.heating-layout-window) .floating-toolbar-close:visible');
  while(await otherWindows.count()) await otherWindows.first().click();
  const handle=handles.first(), box=await handle.boundingBox();assert.ok(box);
  await page.mouse.move(box.x+box.width/2,box.y+box.height/2);await page.mouse.down();await page.mouse.move(box.x+box.width/2-12,box.y+box.height/2,{steps:8});await page.mouse.up();
  const changed=await eventually(session.saved,p=>JSON.stringify(p?.heatingLayout?.ufhCircuits[0]?.pathMm)!==JSON.stringify(before));
  assert.ok(changed.heatingLayout.ufhCircuits[0].manuallyEdited);
  await page.getByRole("button",{name:"Restore Heating Layout",exact:true}).click();
  const count=panel.getByRole("spinbutton",{name:"Requested circuit count",exact:true});await count.fill("2");await count.press("Tab");
  const radiators=JSON.stringify((await session.saved()).heatingLayout.radiators);
  await panel.getByRole("button",{name:"Apply spacing and circuit count",exact:true}).click();
  const regenerated=await eventually(session.saved,p=>p?.heatingLayout?.ufhCircuits?.length===2);
  assert.equal(JSON.stringify(regenerated.heatingLayout.radiators),radiators);
  const spacing=panel.getByRole("spinbutton",{name:"Tube spacing mm",exact:true});await spacing.fill("100");await spacing.press("Tab");
  await panel.getByRole("button",{name:"Apply spacing and circuit count",exact:true}).click();
  await eventually(session.saved,p=>p?.heatingLayout?.ufhCircuits?.every(c=>c.spacingMm===100));
  const runs=panel.getByRole("spinbutton",{name:"Parallel tube runs",exact:true});await runs.fill("14");await runs.press("Tab");
  await panel.getByRole("button",{name:"Apply spacing and circuit count",exact:true}).click();
  await eventually(session.saved,p=>p?.heatingLayout?.ufhZones[0]?.runCountTarget===14 && p.heatingLayout.ufhCircuits.every(c=>c.spacingMm===p.heatingLayout.ufhZones[0].spacingMm));
  const importButton=panel.getByRole("button",{name:"Import UFH performance JSON",exact:true});
  const importBox=await importButton.boundingBox();assert.ok(importBox);
  assert.ok(importBox.width>400);
  await page.screenshot({path:"../.local-logs/heating-nov01-qa/ufh.png"});
  await panel.getByRole("button",{name:"Help for Underfloor heating setup",exact:true}).click();
  await page.getByText("What is a manifold?",{exact:true}).waitFor();
});

test("heating routes can be reshaped while drawing and after saving",async t=>{
  const session=await harness.session(fixture());t.after(()=>session.close());const {page}=session,panel=await heating(session);
  await panel.getByRole("tab",{name:"System",exact:true}).click();
  await panel.locator("summary").filter({hasText:/^Heating pipes & connections/}).click();
  const draw=panel.getByRole("button",{name:"Draw heating pipe",exact:true});
  await equalWidths(draw.locator('..').locator(':scope > button'));
  await draw.click();await panel.getByRole("button",{name:"Minimise Heating Layout",exact:true}).click();
  for(const [x,y] of [[600,350],[1000,350],[1000,650],[1100,650]])await page.mouse.click(x,y);
  const draft=page.locator('[data-editable-heating-path="Draft heating pipe"]');await draft.waitFor();
  const first=draft.locator('[data-heating-route-corner="1"]'),box=await first.boundingBox();assert.ok(box);
  await page.mouse.move(box.x+box.width/2,box.y+box.height/2);await page.mouse.down();await page.mouse.move(box.x-30,box.y+30,{steps:6});await page.mouse.up();
  assert.equal((await session.saved()).heatingLayout.pipes.length,0);
  await page.getByRole("button",{name:"Restore Heating Layout",exact:true}).click();
  await panel.getByRole("button",{name:"Finish pipe",exact:true}).click();
  const saved=await eventually(session.saved,p=>p?.heatingLayout?.pipes?.length===1),path=saved.heatingLayout.pipes[0].pathMm;
  assert.ok(path.slice(1).every((p,i)=>p.x===path[i].x||p.y===path[i].y));
  await panel.getByRole("button",{name:"Minimise Heating Layout",exact:true}).click();
  const route=page.locator('.heating-pipe [data-editable-heating-path]');
  const point=route.locator('[data-heating-route-corner]').first();const at=await point.boundingBox();assert.ok(at);
  await page.mouse.move(at.x+at.width/2,at.y+at.height/2);await page.mouse.down();await page.mouse.move(at.x+24,at.y+14,{steps:6});await page.mouse.up();
  await eventually(session.saved,p=>JSON.stringify(p?.heatingLayout?.pipes[0]?.pathMm)!==JSON.stringify(path));
  await point.click({button:"right"});await page.getByRole('button',{name:'Delete corner',exact:true}).click();
  await page.screenshot({path:"../.local-logs/heating-nov01-qa/pipe.png"});
});

test("report export opens options and preview before any download, with collapsible equal-width exports",async t=>{
  const session=await harness.session(fixture());t.after(()=>session.close());const {page}=session,panel=await heating(session);
  const downloads=[];page.on('download',d=>downloads.push(d));
  await panel.getByRole('tab',{name:'Results',exact:true}).click();
  await panel.locator('summary').filter({hasText:/^Export and files/}).click();
  const exportButton=panel.getByRole('button',{name:'Export Heating Plan PDF',exact:true});
  await equalWidths(exportButton.locator('..').locator(':scope > button'));
  await exportButton.click();
  const preview=page.locator('.report-export-preview');await eventually(async()=>({ready:await preview.locator('.report-pdf-preview').getAttribute('aria-busy'),text:await preview.innerText()}),value=>value.ready==='false');assert.equal(downloads.length,0);
  await preview.getByRole('textbox',{name:'Report title',exact:true}).fill('Reviewed heating design');
  await preview.getByRole('checkbox',{name:'Include calculation details',exact:true}).uncheck();
  await eventually(()=>preview.getByRole('button',{name:'Download PDF',exact:true}).isEnabled(),Boolean);
  await preview.getByRole('textbox',{name:'File name',exact:true}).fill('reviewed-heating');
  const downloaded=page.waitForEvent('download');await preview.getByRole('button',{name:'Download PDF',exact:true}).click();
  assert.equal((await downloaded).suggestedFilename(),'reviewed-heating.pdf');
  await preview.getByRole('button',{name:'Cancel',exact:true}).click();
  await panel.getByRole('button',{name:'Hide Heating Layout',exact:true}).click();
  await menu(page,'Tools','Energy & Insulation');const energy=page.locator('.energy-layout-window');
  await energy.getByRole('tab',{name:'Results',exact:true}).click();
  await energy.getByRole('button',{name:'Export Energy Report PDF',exact:true}).click();
  await eventually(async()=>({ready:await preview.locator('.report-pdf-preview').getAttribute('aria-busy'),text:await preview.innerText()}),value=>value.ready==='false');assert.equal(downloads.length,1);
  await preview.getByRole('button',{name:'Next page',exact:true}).click();
  await eventually(async()=>({ready:await preview.locator('.report-pdf-preview').getAttribute('aria-busy'),page:await preview.locator('canvas').getAttribute('aria-label')}),value=>value.ready==='false' && /page 2 of/.test(value.page));
  await preview.getByRole('button',{name:'Previous page',exact:true}).click();
  await eventually(async()=>({ready:await preview.locator('.report-pdf-preview').getAttribute('aria-busy'),page:await preview.locator('canvas').getAttribute('aria-label')}),value=>value.ready==='false' && /page 1 of/.test(value.page));
  await page.screenshot({path:"../.local-logs/heating-nov01-qa/pdf-preview.png"});
  await preview.getByRole('button',{name:'Cancel',exact:true}).click();
  assert.equal(downloads.length,1);
});
