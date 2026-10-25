import assert from "node:assert/strict";
import test, { before, after } from "node:test";
import { newProject, parseProject } from "../../lib/projectDocument";
import { defaultBuilding } from "../../lib/buildingDocument";
import { DOOR_MODELS } from "../../lib/doorModels";
import { eventually, menu, startBrowserHarness } from "./harness.mjs";

let harness;
before(async()=>{harness=await startBrowserHarness();});
after(async()=>{await harness?.close();});
const models=DOOR_MODELS.filter(m=>m.operation==="OPENING");
const catalogue=models.map(m=>({id:"generic-"+m.key,category_id:m.family,category_name:m.familyName,fixture_kind:"DOOR",name:"Default "+m.name.toLowerCase(),subcategory:m.name,representation_key:m.key,width_mm:m.width,depth_mm:m.depth,height_mm:m.height,color_hex:"#F4F3EE",supplier:"Renovation Fit",sku:"GENERIC-"+m.key.toUpperCase(),is_default:true,supplier_editable:true,active:true,plan_shape:"RECTANGLE",plan_symbol_url:`/fixture-symbols/${m.key}.svg`,description:"Doorless room-to-room opening.",images:[],created_at:"2026-10-19T00:00:00Z",updated_at:"2026-10-19T00:00:00Z"}));
function fixture(){
  const p=newProject(),m=value=>({value,uncertainty_mm:0,verified:true,source_type:"USER_MEASURED"});
  const a=[{x:0,y:0},{x:4000,y:0},{x:4000,y:3600},{x:0,y:3600}],b=[{x:4000,y:0},{x:8000,y:0},{x:8000,y:3600},{x:4000,y:3600}],outer=[{x:0,y:0},{x:8000,y:0},{x:8000,y:3600},{x:0,y:3600},{x:0,y:0}];
  p.rooms=[a,b].map((vertices,i)=>({id:"passage-room-"+i,source_floorplan_room_id:"passage-outline-"+i,name:i?"Dining room":"Living room",version:1,vertices,wall_height:m(2600),wall_thickness:m(150),wall_thickness_overrides_mm:{},openings:[],obstacles:[]}));
  p.floorplan={walls:[{id:"outer",points:outer},{id:"partition",points:[{x:4000,y:0},{x:4000,y:3600}]}],rooms:p.rooms.map((r,i)=>({id:r.source_floorplan_room_id,sourceWallId:"outer",sourceWallIds:["outer","partition"],name:r.name,vertices:r.vertices,colourIndex:i})),roomFinishes:{},openings:[],measurements:[],annotations:[],dimensionOffsets:{},hiddenDimensions:[],canvasSize:{width:1100,height:700},selectedRoomId:"passage-outline-0",wallHeight:2600,wallThickness:150,squaredWalls:true,snapEnabled:true,snapSize:50,viewSettings:{zoom:1,pan:{x:0,y:0},showRoomNames:true,showMeasurements:true,showWallThickness:true,showAnnotations:true,showGrid:true}};
  p.building=defaultBuilding(p);return parseProject(p);
}
async function session(){
  const s=await harness.session(fixture());
  await s.page.route(/\/catalog\/items(?:\?.*)?$/,route=>{
    const query=new URL(route.request().url()).searchParams;
    return route.fulfill({json:catalogue.filter(item=>(!query.get("category_id")||item.category_id===query.get("category_id"))&&(!query.get("subcategory")||item.subcategory===query.get("subcategory")))});
  });
  await s.page.route("**/catalog/categories",route=>route.fulfill({json:[{id:"doors",name:"Internal doors",description:"Doors",item_count:0,default_side_clearance_mm:0,default_front_clearance_mm:0},{id:"doors-openings",name:"Openings",description:"Doorless openings",item_count:6,default_side_clearance_mm:0,default_front_clearance_mm:0}]}));
  await s.page.reload();await s.page.getByRole("combobox",{name:"Selected floor",exact:true}).waitFor();return s;
}
const addWindow=page=>page.locator('.floating-toolbar').filter({has:page.locator('.floating-toolbar-titlebar',{hasText:"Add to plan"})}).filter({visible:true});
async function choose(page,model,initial=false){
  const add=addWindow(page);
  if(initial)await add.getByRole("combobox",{name:"Add to plan",exact:true}).selectOption("DOOR");
  const expand=add.getByRole("button",{name:"Expand door selector",exact:true});if(await expand.isVisible())await expand.click();
  if(initial){await add.getByRole("button",{name:/^Category/}).click();await add.getByRole("option",{name:"Openings",exact:true}).click();}
  else await add.getByRole("button",{name:/^Object/}).click();
  await add.getByRole("option",{name:model.name,exact:true}).click();
  await add.locator(`[data-passage-profile="${model.profile}"]`).waitFor();
  return add;
}
async function partitionPoint(page){
  return page.locator('.full-plan-svg, svg[aria-label="Interactive complete building floorplan"]').first().evaluate(svg=>{
    const box=svg.getBoundingClientRect(),matrix=svg.getScreenCTM();
    const walls=[...svg.querySelectorAll('.wall-interaction-line')].map(line=>{
      const a=new DOMPoint(Number(line.getAttribute("x1")),Number(line.getAttribute("y1"))).matrixTransform(matrix),b=new DOMPoint(Number(line.getAttribute("x2")),Number(line.getAttribute("y2"))).matrixTransform(matrix);
      return {x:(a.x+b.x)/2,y:(a.y+b.y)/2,vertical:Math.abs(a.x-b.x)<1,length:Math.abs(a.y-b.y)};
    }).filter(line=>line.vertical&&line.length>60).sort((a,b)=>Math.abs(a.x-(box.x+box.width/2))-Math.abs(b.x-(box.x+box.width/2)));
    if(!walls.length)throw Error("The shared partition is missing");return {x:walls[0].x,y:walls[0].y};
  });
}

test("Doors → Openings exposes all six wall-section previews in Add elements and the catalogue",async t=>{
  const s=await session();t.after(()=>s.close());const {page}=s;
  for(const [index,model] of models.entries()){
    const add=await choose(page,model,index===0);assert.ok(await add.locator('.fixture-preview canvas').isVisible());
    const position=add.getByRole("button",{name:/^Position/});if(await position.getAttribute("aria-expanded")==="false")await position.click();
    assert.equal(await add.getByRole("combobox",{name:"Hinge side",exact:true}).count(),0);
    assert.equal(await add.getByRole("combobox",{name:"Direction",exact:true}).count(),0);
    assert.equal(await add.getByRole("button",{name:"Add opening",exact:true}).count(),1);
    if(process.env.BROWSER_ARTIFACTS&&model.profile==="ROUND_ARCH"){await add.locator('.fixture-preview').scrollIntoViewIfNeeded();await add.locator('.fixture-preview').screenshot({path:process.env.BROWSER_ARTIFACTS+"/opening-live-arch.png"});}
  }
  await menu(page,"Library","Object catalogue…");const browser=page.locator('.catalogue-modal');
  await browser.getByRole("button",{name:/^Doors[ +−]*$/}).click();
  await browser.getByRole("button",{name:/^Openings/}).click();
  await eventually(()=>browser.locator('.catalogue-grid article').count(),count=>count===6);
  await browser.getByRole("button",{name:/^View details for Default round arch$/i}).click();
  await page.locator('.catalogue-detail-dialog .fixture-preview canvas').waitFor();
});

test("all six passages cut a shared room wall, render in 3D and survive reload; arch editing and Undo retain profiles",async()=>{
  for(const model of models){
    const s=await session();const {page}=s;
    try{
      const before=(await s.saved()).rooms.map(r=>r.vertices),add=await choose(page,model,true);
      await add.getByRole("button",{name:"Add opening",exact:true}).click();
      const at=await partitionPoint(page);await page.mouse.move(at.x,at.y);
      await eventually(()=>page.locator('.placement-preview text').textContent(),text=>text==="Click to place");await page.mouse.click(at.x,at.y);
      const placed=await eventually(s.saved,p=>p.floorplan.openings.length===1&&p.rooms.length===2&&p.rooms.every(r=>r.openings.length===1));
      assert.ok(placed.rooms.every(r=>r.openings[0].passage_profile===model.profile));
      assert.ok(placed.rooms.every(r=>r.openings[0].width.value===model.width&&r.openings[0].height.value===model.height));
      assert.deepEqual(placed.rooms.map(r=>r.vertices),before);
      assert.ok(await page.locator('.passage-opening-symbol').count()>0);
      await page.getByRole("button",{name:"3D",exact:true}).click();await page.locator('.viewer-shell > .stable-canvas-host canvas').waitFor();
      if(process.env.BROWSER_ARTIFACTS)await page.screenshot({path:`${process.env.BROWSER_ARTIFACTS}/opening-building-${model.key}.png`});
      await page.reload();await page.getByRole("combobox",{name:"Selected floor",exact:true}).waitFor();
      const restored=await s.saved();assert.ok(restored.rooms.every(r=>r.openings[0].passage_profile===model.profile));
      if(model.profile==="ROUND_ARCH"){
        const activeAdd=addWindow(page);await activeAdd.getByRole("combobox",{name:"Add to plan",exact:true}).selectOption("DOOR");
        await activeAdd.locator('.full-opening-list').getByRole("button",{name:"Edit",exact:true}).click();
        await choose(page,models.find(m=>m.profile==="CHAMFERED"));await activeAdd.getByRole("button",{name:"Update opening",exact:true}).click();
        await eventually(s.saved,p=>p.rooms.every(r=>r.openings[0].passage_profile==="CHAMFERED"));
        await page.keyboard.press("Control+z");await eventually(s.saved,p=>p.rooms.every(r=>r.openings[0].passage_profile==="ROUND_ARCH"));
        await activeAdd.getByRole("button",{name:"Remove opening",exact:true}).click();await eventually(s.saved,p=>p.rooms.every(r=>r.openings.length===0));
      }
    }finally{await s.close();}
  }
});
