import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { newProject, parseProject } from "../../lib/projectDocument";
import { defaultBuilding } from "../../lib/buildingDocument";
import { newHeatingProject } from "../../lib/heatingDocument";
import { newAssembly, newEnergyProject } from "../../lib/energyDocument";
import { createRoomUFH, heatingResults, newHeatingRadiator } from "../../lib/heatingDesign";
import { energyElements, withEnergyFabric } from "../../lib/energyCalculations";
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
async function clearOtherWindows(page) {
  const windows=page.locator('.floating-toolbar:not(.heating-layout-window) .floating-toolbar-close:visible');
  while(await windows.count())await windows.first().click();
}
async function segmentPoint(line, fraction=.5) {
  return line.evaluate((el,t)=>{
    const a=el.points.getItem(0),b=el.points.getItem(1),point=el.ownerSVGElement.createSVGPoint();
    point.x=a.x+(b.x-a.x)*t;point.y=a.y+(b.y-a.y)*t;const p=point.matrixTransform(el.getScreenCTM());return {x:p.x,y:p.y};
  },fraction);
}

test("temperature, comparison and results question marks open specific help without toggling sections",async t=>{
 const session=await harness.session(fixture());t.after(()=>session.close());const {page}=session,panel=await heating(session);
 const before=JSON.stringify((await eventually(session.saved,p=>p.heatingLayout?.enabled)).heatingLayout);
 for(const [tab,section,heading] of [['System','Heating system temperatures','Set the water temperatures'],['System','Compare system temperatures','Compare without changing the design'],['Results','Heating results','Heat required and heat available']]){
  await panel.getByRole('tab',{name:tab,exact:true}).click();
  const button=panel.getByRole('button',{name:'Help for '+section,exact:true});await button.waitFor();
  const open=await button.evaluate(el=>el.closest('details').open);await button.click();
  const help=page.locator('.window-help-host .floating-toolbar-content');await help.getByRole('heading',{name:heading,exact:true}).waitFor();
  await page.keyboard.press('Escape');assert.equal(await button.evaluate(el=>el.closest('details').open),open);
 }
 assert.equal(JSON.stringify((await session.saved()).heatingLayout),before);
 await page.screenshot({path:'../.local-logs/heating-nov01-qa/section-help-buttons.png'});
});

test("manifold symbol and help explain supply, return and actual loop usage",async t=>{
 const project=fixture();project.heatingLayout=createRoomUFH(project.rooms[0],project.heatingLayout!).heating;
 const session=await harness.session(parseProject(project));t.after(()=>session.close());const {page}=session,panel=await heating(session);
 const manifold=page.getByRole('button',{name:'Heating manifold: Room 1 manifold',exact:true});
 await manifold.locator('text').getByText('Room 1 manifold · 1/12 loops',{exact:true}).waitFor();
 const strokes=await manifold.locator('path').evaluateAll(paths=>paths.map(p=>p.getAttribute('stroke')));assert.deepEqual(strokes,['#c74b1d','#277ab5']);
 await panel.locator('.floating-toolbar-titlebar').getByRole('button',{name:'Help for Heating Layout',exact:true}).click();
 const help=page.locator('.window-help-host .floating-toolbar-content');await help.getByRole('heading',{name:'What is a manifold?',exact:true}).waitFor();
 assert.match(await help.innerText(),/one loop is connected out of twelve/);await page.keyboard.press('Escape');
 await clearOtherWindows(page);await panel.getByRole('button',{name:'Minimise Heating Layout',exact:true}).click();
 await manifold.focus();await manifold.press('Enter');await page.getByRole('button',{name:'Restore Heating Layout',exact:true}).click();
 const edit=panel.locator('details').filter({has:page.getByRole('spinbutton',{name:'Loop connection capacity',exact:true})});
 await edit.getByText('1 of 12 loop connections used.',{exact:false}).waitFor();
 await edit.getByRole('button',{name:'Help for Edit manifold',exact:true}).click();
 await help.getByRole('heading',{name:'Place and connect it',exact:true}).waitFor();
 await page.screenshot({path:'../.local-logs/heating-nov01-qa/manifold-help.png'});
});

test("shared U focus is read-only and edits preserve inherited boundary and adjacent temperature",async t=>{
  const project=fixture(),energy=project.energyLayout!,room=project.rooms[0],assembly=newAssembly();
  energy.assemblies=[assembly];const element=energyElements([room],project.heatingLayout!,energy).find(e=>e.category==='wall')!;
  energy.existingAssignments=[{elementId:element.elementId,assemblyId:assembly.assemblyId,uValue:null,boundary:'Unheated',adjacentTemperatureC:12,geometrySignature:element.geometrySignature}];
  energy.scenarios=[{scenarioId:'upgrade',name:'Upgrade',assignments:[]}];energy.activeScenarioId='upgrade';
  const session=await harness.session(parseProject(project));t.after(()=>session.close());const {page}=session,panel=await heating(session);
  const before=JSON.stringify((await session.saved()).energyLayout);
  await panel.getByRole('button',{name:'Building assumptions…',exact:true}).click();
  const settings=page.locator('.floating-toolbar').filter({has:page.getByText('Heating — Building assumptions',{exact:true})});
  await settings.locator('.heating-shared-u-values > summary').click();
  const field=settings.getByRole('spinbutton',{name:/Wall 1.*shared U-value/}).first();
  await field.focus();await field.press('Tab');assert.equal(JSON.stringify((await session.saved()).energyLayout),before);
  await field.fill(await field.inputValue());await field.press('Tab');assert.equal(JSON.stringify((await session.saved()).energyLayout),before);
  await field.fill('0.123');await field.press('Tab');
  const saved=await eventually(session.saved,p=>p?.energyLayout?.scenarios[0]?.assignments[0]?.uValue===.123);
  const changed=saved.energyLayout.scenarios[0].assignments[0];
  assert.equal(changed.assemblyId,null);assert.equal(changed.boundary,'Unheated');assert.equal(changed.adjacentTemperatureC,12);
  assert.deepEqual(saved.energyLayout.existingAssignments,energy.existingAssignments);
  const loss=heatingResults(saved.rooms,withEnergyFabric(saved.heatingLayout,saved.energyLayout,saved.rooms)).rooms[0].demand.surfaces.find(s=>s.uValue===.123)!;
  assert.equal(loss.adjacentTemperatureC,12);assert.ok(Math.abs(loss.lossW-loss.areaM2*.123*(20-12))<1e-8);
});

test("UFH generation permits one job, refuses stale edits and recovers after send failure",async t=>{
  const session=await harness.session(fixture());t.after(()=>session.close());const {page}=session,panel=await heating(session);
  await page.evaluate(()=>{
    const Native=window.Worker;window.__ufhJobs=0;window.__ufhThrow=false;
    window.Worker=class extends Native {
      heating=false;ended=false;
      postMessage(data,options){if(data?.heating){this.heating=true;window.__ufhJobs++;if(window.__ufhThrow){window.__ufhThrow=false;throw new DOMException('Audit send failure','DataCloneError');}}super.postMessage(data,options);}
      set onmessage(handler){super.onmessage=handler ? e=>{if(this.heating)setTimeout(()=>{if(!this.ended)handler.call(this,e);},700);else handler.call(this,e);} : null;}
      get onmessage(){return super.onmessage;}
      terminate(){this.ended=true;super.terminate();}
    };
  });
  await panel.getByRole('tab',{name:'Underfloor',exact:true}).click();await panel.getByRole('button',{name:'Create room UFH',exact:true}).click();
  const before=await eventually(session.saved,p=>p?.heatingLayout?.ufhCircuits?.length>0);
  await panel.getByRole('button',{name:'Apply spacing and circuit count',exact:true}).click();
  assert.ok(await panel.getByRole('button',{name:'Generating UFH…',exact:true}).isDisabled());
  assert.equal(await page.evaluate(()=>window.__ufhJobs),1);
  await panel.getByRole('spinbutton',{name:'Tube spacing mm',exact:true}).fill('100');
  await panel.getByRole('spinbutton',{name:'Tube spacing mm',exact:true}).press('Tab');
  await panel.getByRole('alert').filter({hasText:'Inputs or room geometry changed'}).waitFor();
  assert.deepEqual((await session.saved()).heatingLayout.ufhCircuits,before.heatingLayout.ufhCircuits);
  await page.evaluate(()=>{window.__ufhThrow=true;});
  await panel.getByRole('button',{name:'Apply spacing and circuit count',exact:true}).click();
  await panel.getByRole('alert').filter({hasText:'Audit send failure'}).waitFor();
  assert.ok(await panel.getByRole('button',{name:'Apply spacing and circuit count',exact:true}).isEnabled());
  await panel.getByRole('button',{name:'Apply spacing and circuit count',exact:true}).click();
  await eventually(session.saved,p=>p?.heatingLayout?.ufhCircuits?.every(c=>c.spacingMm===100));
  assert.equal(await page.evaluate(()=>window.__ufhJobs),3);
  await panel.getByRole('button',{name:/^Room 1-01 ·/}).click();
  await panel.getByRole('button',{name:'UFH circuit route controls…',exact:true}).click();
  const controls=page.locator('.floating-toolbar').filter({has:page.getByText('Heating — UFH circuit route controls',{exact:true})});
  await controls.getByRole('checkbox',{name:'Lock circuit',exact:true}).check();await controls.getByRole('button',{name:'Done',exact:true}).click();
  await panel.getByRole('button',{name:'Apply spacing and circuit count',exact:true}).click();
  await panel.getByRole('alert').filter({hasText:'locked circuits'}).waitFor();
});

test("selecting another room's UFH opens its controls and lead drags keep both anchors",async t=>{
  const project=fixture(),a=project.rooms[0],b={...structuredClone(a),id:'room-b',source_floorplan_room_id:'outline-b',name:'Room 2',obstacles:[],vertices:a.vertices.map(p=>({x:p.x+4000,y:p.y}))};
  project.rooms.push(b);project.floorplan!.walls.push({id:'wall-b',points:[...b.vertices,b.vertices[0]]});
  project.floorplan!.rooms.push({...project.floorplan!.rooms[0],id:'outline-b',sourceWallId:'wall-b',sourceWallIds:['wall-b'],name:'Room 2',vertices:b.vertices});
  project.heatingLayout=createRoomUFH(b,createRoomUFH(a,project.heatingLayout!).heating).heating;project.building=defaultBuilding(project);
  const session=await harness.session(parseProject(project));t.after(()=>session.close());const {page}=session,panel=await heating(session);
  await page.getByRole('button',{name:'Fit',exact:true}).click();
  await clearOtherWindows(page);await panel.getByRole('button',{name:'Minimise Heating Layout',exact:true}).click();
  const circuit=page.locator('[data-plan-info^="Room 2-01"]');
  const body=circuit.locator(':scope > g').nth(0),supply=circuit.locator(':scope > g').nth(1);
  const at=await segmentPoint(body.locator('polyline').nth(1),.05);
  await page.screenshot({path:'../.local-logs/heating-nov01-qa/reaudit-two-rooms.png'});
  assert.match(await page.evaluate(p=>document.elementFromPoint(p.x,p.y)?.closest('[data-plan-info]')?.getAttribute('data-plan-info')??'No circuit at '+JSON.stringify(p)+' '+document.elementFromPoint(p.x,p.y)?.outerHTML.slice(0,400),at),/^Room 2-01/);
  await page.mouse.click(at.x,at.y);
  await page.getByRole('button',{name:'Restore Heating Layout',exact:true}).click();
  assert.equal(await panel.getByRole('combobox',{name:'Selected room',exact:true}).inputValue(),'room-b');
  await panel.getByRole('button',{name:'Minimise Heating Layout',exact:true}).click();
  const before=(await session.saved()).heatingLayout.ufhCircuits.find(c=>c.name==='Room 2-01');
  assert.equal(await supply.locator('circle').count(),before.supplyPathMm.length-1);
  const lead=await segmentPoint(supply.locator('polyline').nth(1),.95);
  await page.keyboard.down('Shift');await page.mouse.move(lead.x,lead.y);await page.mouse.down();await page.mouse.move(lead.x+20,lead.y+15,{steps:8});await page.mouse.up();await page.keyboard.up('Shift');
  const saved=await eventually(session.saved,p=>JSON.stringify(p?.heatingLayout?.ufhCircuits.find(c=>c.circuitId===before.circuitId)?.supplyPathMm)!==JSON.stringify(before.supplyPathMm));
  const after=saved.heatingLayout.ufhCircuits.find(c=>c.circuitId===before.circuitId);
  assert.deepEqual(after.supplyPathMm[0],before.supplyPathMm[0]);assert.deepEqual(after.supplyPathMm.at(-1),before.pathMm[0]);assert.deepEqual(after.pathMm,before.pathMm);
});

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
  const applyBox=await panel.getByRole("button",{name:"Apply spacing and circuit count",exact:true}).boundingBox(); assert.ok(Math.abs(importBox.width-applyBox.width)<2);
  await page.screenshot({path:"../.local-logs/heating-nov01-qa/ufh.png"});
  await panel.locator(".window-header-actions").getByRole("button",{name:"Help for Heating Layout",exact:true}).click();
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

test("Escape cancels pipe drags and locking a route dismisses its deletion menu",async t=>{
  const project=fixture();project.heatingLayout!.pipes=[{pipeId:'audit-pipe',name:'Audit pipe',kind:'Supply',diameterMm:15,locked:false,pathMm:[{x:400,y:700},{x:1400,y:700},{x:1400,y:1300},{x:2400,y:1300}]}];
  const session=await harness.session(parseProject(project));t.after(()=>session.close());const {page}=session,panel=await heating(session);
  await panel.getByRole('tab',{name:'System',exact:true}).click();await panel.locator('summary').filter({hasText:/^Heating pipes & connections/}).click();
  await panel.getByRole('button',{name:'Audit pipe · Supply',exact:true}).click();await clearOtherWindows(page);
  await panel.getByRole('button',{name:'Minimise Heating Layout',exact:true}).click();
  const path=page.locator('[data-editable-heating-path="Audit pipe"]'),corner=path.locator('[data-heating-route-corner]').first();
  const before=(await session.saved()).heatingLayout.pipes[0].pathMm,box=await corner.boundingBox();assert.ok(box);
  await page.mouse.move(box.x+box.width/2,box.y+box.height/2);await page.mouse.down();await page.mouse.move(box.x+30,box.y+20,{steps:5});
  await page.keyboard.press('Escape');await page.mouse.up();assert.deepEqual((await session.saved()).heatingLayout.pipes[0].pathMm,before);
  await corner.click({button:'right'});await page.getByRole('button',{name:'Delete corner',exact:true}).waitFor();
  await page.getByRole('button',{name:'Restore Heating Layout',exact:true}).click();
  await panel.getByRole('checkbox',{name:'Lock pipe',exact:true}).check();
  assert.equal(await page.getByRole('button',{name:'Delete corner',exact:true}).count(),0);
  assert.equal(await path.locator('[data-heating-route-corner]').count(),0);
  await panel.getByRole('checkbox',{name:'Lock pipe',exact:true}).uncheck();
  assert.equal(await page.getByRole('button',{name:'Delete corner',exact:true}).count(),0);
  await panel.getByRole('button',{name:'Minimise Heating Layout',exact:true}).click();
  const restored=await corner.boundingBox();assert.ok(restored);
  await page.mouse.move(restored.x+restored.width/2,restored.y+restored.height/2);await page.mouse.down();await page.mouse.move(restored.x+20,restored.y+15,{steps:5});await page.mouse.up();
  await eventually(session.saved,p=>JSON.stringify(p?.heatingLayout?.pipes[0].pathMm)!==JSON.stringify(before));
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
  await preview.getByRole('textbox',{name:'Report title',exact:true}).fill('Temporary title');
  assert.ok(await preview.getByRole('button',{name:'Download PDF',exact:true}).isDisabled());
  await preview.getByRole('textbox',{name:'Report title',exact:true}).fill('Heating Plan');
  assert.ok(await preview.getByRole('button',{name:'Download PDF',exact:true}).isDisabled());
  await eventually(()=>preview.getByRole('button',{name:'Download PDF',exact:true}).isEnabled(),Boolean);
  await preview.getByRole('textbox',{name:'Report title',exact:true}).fill('Reviewed heating design');
  await preview.getByRole('checkbox',{name:'Include calculation details',exact:true}).uncheck();
  await eventually(()=>preview.getByRole('button',{name:'Download PDF',exact:true}).isEnabled(),Boolean);
  await preview.getByRole('textbox',{name:'File name',exact:true}).fill('reviewed-heating');
  const downloaded=page.waitForEvent('download');await preview.getByRole('button',{name:'Download PDF',exact:true}).click();
  const file=await downloaded;assert.equal(file.suggestedFilename(),'reviewed-heating.pdf');assert.equal(await file.failure(),null);
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
