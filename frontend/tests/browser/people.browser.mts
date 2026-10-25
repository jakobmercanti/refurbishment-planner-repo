import assert from "node:assert/strict";
import test, { before, after } from "node:test";
import { newProject, parseProject } from "../../lib/projectDocument";
import { defaultBuilding } from "../../lib/buildingDocument";
import { PERSON_MODELS, STATURE_PRESETS, personDimensions } from "../../lib/people";
import { eventually, menu, startBrowserHarness } from "./harness.mjs";

let harness;
before(async()=>{harness=await startBrowserHarness();});
after(async()=>{await harness?.close();});
const m=value=>({value,uncertainty_mm:0,verified:false,source_type:"USER_MEASURED"});
const record=(id,key,category_id,category_name,name,width_mm,depth_mm,height_mm,subcategory="QA")=>({id,representation_key:key,category_id,category_name,name,width_mm,depth_mm,height_mm,subcategory,fixture_kind:"FURNITURE",color_hex:"#426A83",supplier:"Renovation Fit",sku:id,is_default:true,supplier_editable:true,active:true,plan_shape:"RECTANGLE",plan_symbol_url:`/fixture-symbols/${key}.svg`,images:[],description:"Generic nominal occupant; stature and posed envelope are distinct.",created_at:"2026-10-20T00:00:00Z",updated_at:"2026-10-20T00:00:00Z"});
const people=PERSON_MODELS.flatMap(model=>STATURE_PRESETS.map(stature=>{
  const size=personDimensions({posture:model.posture,stature_mm:stature,seat_height_mm:.245*stature});
  return {...record(`generic-${model.key}-${stature}`,model.key,"people","People",`${model.label} person · ${stature} mm stature`,size.width,size.depth,size.height,model.label),cfd_proxy:{version:1,profile:model.key}};
}));
const furnishings=[record("qa-chair","furniture-chair-modern","living-chairs","Chairs","QA chair",600,550,850),record("qa-bed","furniture-bed-king","bedroom-beds","Beds","QA bed",1600,2100,900),record("qa-sofa","furniture-sofa-3","living-sofas","Sofas","QA sofa",2100,900,850)];
const all=[...people,...furnishings];
const categories=[...new Map(all.map(item=>[item.category_id,{id:item.category_id,name:item.category_name,description:"Regression catalogue",item_count:all.filter(other=>other.category_id===item.category_id).length,default_side_clearance_mm:0,default_front_clearance_mm:0}])).values()];
function fixture(){
  const p=newProject(),vertices=[{x:0,y:0},{x:6000,y:0},{x:6000,y:6000},{x:0,y:6000}];
  const obstacles=furnishings.map((item,i)=>({id:item.id,name:item.name,model_id:item.id,fixture_kind:"FURNITURE",representation_key:item.representation_key,plan_symbol_url:item.plan_symbol_url,kind:"BOX",center:i===0?{x:1500,y:3500}:i===1?{x:3500,y:3500}:{x:3500,y:1500},rotation_deg:0,base_z_mm:0,verified:false,dimensions:{width:m(item.width_mm),depth:m(item.depth_mm),height:m(item.height_mm)}}));
  p.rooms=[{id:"people-room",source_floorplan_room_id:"people-outline",name:"People QA",version:1,vertices,wall_height:m(2600),wall_thickness:m(100),openings:[],obstacles}];
  p.floorplan={walls:[{id:"outer",points:[...vertices,vertices[0]]}],rooms:[{id:"people-outline",sourceWallId:"outer",sourceWallIds:["outer"],name:"People QA",vertices,colourIndex:0}],roomFinishes:{},openings:[],measurements:[],annotations:[],dimensionOffsets:{},hiddenDimensions:[],canvasSize:{width:1100,height:700},selectedRoomId:"people-outline",wallHeight:2600,wallThickness:100,squaredWalls:true,snapEnabled:true,snapSize:50,viewSettings:{zoom:1,pan:{x:0,y:0},showRoomNames:true,showMeasurements:true,showWallThickness:true,showAnnotations:true,showGrid:true}};
  p.building=defaultBuilding(p);return parseProject(p);
}
async function session(){
  const s=await harness.session(fixture()),{page}=s;
  await page.route(/\/catalog\/items(?:\?.*)?$/,route=>{
    const q=new URL(route.request().url()).searchParams;
    return route.fulfill({json:all.filter(item=>(!q.get("category_id")||q.get("category_id")===item.category_id)&&(!q.get("subcategory")||q.get("subcategory")===item.subcategory)&&(!q.get("search")||item.name.includes(q.get("search"))))});
  });
  await page.route("**/catalog/categories",route=>route.fulfill({json:categories}));
  await page.reload();await page.getByRole("combobox",{name:"Selected floor",exact:true}).waitFor();return s;
}
const addWindow=(page,title="Add to plan")=>page.locator('.floating-toolbar').filter({has:page.locator('.floating-toolbar-titlebar',{hasText:title})}).filter({visible:true});
async function inspectBuilding3D(page,stem){
  await page.getByRole("button",{name:"3D",exact:true}).click();await page.locator('.viewer-shell > .stable-canvas-host canvas').waitFor();
  await page.getByRole("button",{name:"Show",exact:true}).click();await page.getByText("Wall display",{exact:true}).click();
  await page.getByRole("menuitemradio",{name:"Invisible walls",exact:true}).click();await page.keyboard.press("Escape");
  const editor=addWindow(page,"Add elements");await editor.getByRole("combobox",{name:"Add to plan",exact:true}).selectOption("PEOPLE");
  await editor.getByRole("combobox",{name:"Posture",exact:true}).selectOption("SEATED");
  const supports=await editor.getByRole("combobox",{name:"Supporting furniture",exact:true}).locator('option').allTextContents();
  assert.ok(supports.includes("QA chair")&&supports.includes("QA bed"),"The 3D People editor must offer the current room's furniture");
  if(process.env.BROWSER_ARTIFACTS)await page.screenshot({path:`${process.env.BROWSER_ARTIFACTS}/${stem}.png`});
  await page.getByRole("button",{name:"2D",exact:true}).click();await addWindow(page).getByRole("combobox",{name:"Add to plan",exact:true}).selectOption("PEOPLE");
}

test("People is a top-level Add elements mode and every stature/posture can be selected with editable display styles",async t=>{
  const s=await session();t.after(()=>s.close());const{page}=s,add=addWindow(page);
  await add.getByRole("combobox",{name:"Add to plan",exact:true}).selectOption("PEOPLE");
  await add.getByRole("combobox",{name:"Posture",exact:true}).waitFor();
  assert.equal(await add.getByRole("combobox",{name:"Posture",exact:true}).inputValue(),"STANDING");
  assert.equal(await add.getByRole("combobox",{name:"Stature preset",exact:true}).inputValue(),"1800");
  for(const item of people){
    await add.getByRole("button",{name:"Expand fittings selector",exact:true}).click();
    await add.getByRole("button",{name:/^Object/}).click();
    await add.getByRole("option",{name:item.name,exact:true}).click();
    assert.equal(await add.getByRole("combobox",{name:"Posture",exact:true}).inputValue(),PERSON_MODELS.find(m=>m.key===item.representation_key).posture);
    assert.equal(await add.getByRole("combobox",{name:"Stature preset",exact:true}).inputValue(),item.id.split("-").at(-1));
    for(const style of ["SMART","MANNEQUIN","CASUAL"]){await add.getByRole("combobox",{name:"Display style",exact:true}).selectOption(style);assert.equal(await add.getByRole("combobox",{name:"Display style",exact:true}).inputValue(),style);}
    assert.ok(await add.locator('.fixture-preview canvas').isVisible());
  }
  await add.getByRole("button",{name:"Help for People & furniture",exact:true}).click();
  const help=page.locator('.window-help-content[aria-label="Help for People & furniture"]');await help.waitFor();assert.match(await help.innerText(),/nominal|generic|ergonomic/i);await page.keyboard.press("Escape");
});

test("seated/lying people align to picked furniture, persist, follow furniture edits and detach on deletion",async t=>{
  const s=await session();t.after(()=>s.close());const{page}=s,add=addWindow(page);
  await add.getByRole("combobox",{name:"Add to plan",exact:true}).selectOption("PEOPLE");
  await add.getByRole("combobox",{name:"Posture",exact:true}).selectOption("SEATED");
  await add.getByRole("combobox",{name:"Display style",exact:true}).selectOption("SMART");
  await add.getByRole("combobox",{name:"Supporting furniture",exact:true}).selectOption("qa-chair");
  await add.getByRole("button",{name:"Align to furniture",exact:true}).click();
  await add.getByRole("button",{name:"Add person on furniture",exact:true}).click();
  let saved=await eventually(s.saved,p=>p.rooms[0].obstacles.some(item=>item.person_spec?.support?.obstacle_id==="qa-chair"));
  const id=saved.rooms[0].obstacles.find(item=>item.person_spec).id;
  assert.equal(await page.locator('.placement-preview').count(),0,"A furniture-aligned person must not enter free placement");
  assert.equal(saved.rooms[0].obstacles.find(item=>item.id===id).person_spec.style,"SMART");
  await inspectBuilding3D(page,"people-seated-on-chair-3d");
  await add.locator(`[data-element-id="${id}"]`).getByRole("button",{name:"Edit",exact:true}).click();
  await add.getByRole("combobox",{name:"Stature preset",exact:true}).selectOption("1950");
  saved=await eventually(s.saved,p=>p.rooms[0].obstacles.find(item=>item.id===id)?.person_spec?.stature_mm===1950);
  assert.equal(saved.rooms[0].obstacles.find(item=>item.id===id).person_spec.support.obstacle_id,"qa-chair");
  await add.getByRole("combobox",{name:"Posture",exact:true}).selectOption("LYING");
  await add.getByRole("combobox",{name:"Supporting furniture",exact:true}).selectOption("qa-bed");
  await add.getByRole("button",{name:"Align to furniture",exact:true}).click();assert.match(await add.getByRole("alert").innerText(),/too long/);
  await add.getByRole("combobox",{name:"Stature preset",exact:true}).selectOption("1800");
  await add.getByRole("button",{name:"Align to furniture",exact:true}).click();
  saved=await eventually(s.saved,p=>p.rooms[0].obstacles.find(item=>item.id===id)?.person_spec?.support?.obstacle_id==="qa-bed");
  assert.equal(saved.rooms[0].obstacles.find(item=>item.id===id).base_z_mm,558);
  await inspectBuilding3D(page,"people-lying-on-bed-3d");
  await page.reload();await page.getByRole("combobox",{name:"Selected floor",exact:true}).waitFor();
  assert.equal((await s.saved()).rooms[0].obstacles.find(item=>item.id===id).person_spec.support.obstacle_id,"qa-bed");
  const afterReload=addWindow(page);
  await afterReload.getByRole("combobox",{name:"Add to plan",exact:true}).selectOption("FURNITURE");
  await afterReload.locator('[data-element-id="qa-bed"]').getByRole("button",{name:"Edit",exact:true}).click();
  const position=afterReload.getByRole("button",{name:/^Position/});if(await position.getAttribute("aria-expanded")==="false")await position.click();
  await afterReload.getByLabel("X mm",{exact:true}).fill("4000");await afterReload.getByLabel("X mm",{exact:true}).press("Tab");
  saved=await eventually(s.saved,p=>p.rooms[0].obstacles.find(item=>item.id==="qa-bed")?.center.x===4000&&p.rooms[0].obstacles.find(item=>item.id===id)?.center.x===4000);
  const beforeDelete=saved.rooms[0].obstacles.find(item=>item.id===id).center;
  await afterReload.getByRole("button",{name:"Remove QA bed",exact:true}).click();
  saved=await eventually(s.saved,p=>!p.rooms[0].obstacles.some(item=>item.id==="qa-bed"));
  assert.equal(saved.rooms[0].obstacles.find(item=>item.id===id).person_spec.support,undefined);assert.deepEqual(saved.rooms[0].obstacles.find(item=>item.id===id).center,beforeDelete);
  if(process.env.BROWSER_ARTIFACTS)await page.screenshot({path:`${process.env.BROWSER_ARTIFACTS}/people-furniture-workflow.png`});
});

test("catalogue provides large detailed People previews with three visibly distinct styles in every posture",async t=>{
  const s=await session();t.after(()=>s.close());const{page}=s;
  await menu(page,"Library","Object catalogue…");const browser=page.locator('.catalogue-modal');
  await browser.getByRole("button",{name:/^People[ +−]*$/}).click();
  assert.equal(await browser.locator('.catalogue-grid article').count(),18);
  for(const model of PERSON_MODELS){
    const item=people.find(item=>item.representation_key===model.key&&item.id.endsWith("1800"));
    await browser.getByRole("button",{name:`View details for ${item.name}`,exact:true}).click();
    const dialog=page.locator('.catalogue-object-dialog'),canvas=dialog.locator('.fixture-preview canvas');await canvas.waitFor();
    assert.match(await dialog.locator('.catalogue-asset-preview header').innerText(),/Asset model/);
    const shots=[];
    for(const style of ["CASUAL","SMART","MANNEQUIN"]){
      await dialog.getByRole("combobox",{name:"Display style",exact:true}).selectOption(style);
      await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
      shots.push(await canvas.screenshot());
      if(process.env.BROWSER_ARTIFACTS)await dialog.screenshot({path:`${process.env.BROWSER_ARTIFACTS}/people-${model.posture.toLowerCase()}-${style.toLowerCase()}.png`});
      if(style==="CASUAL"&&process.env.GENERATE_PEOPLE_PREVIEWS)await canvas.screenshot({path:`${process.env.GENERATE_PEOPLE_PREVIEWS}/${model.key}.png`});
    }
    assert.notDeepEqual(shots[0],shots[2],"Mannequin must actually change the geometry/material appearance");
    await dialog.getByRole("button",{name:"Close catalogue entry details",exact:true}).click();
  }
});

test("People controls remain aligned and usable in light/dark themes and a narrow viewport",async t=>{
  const s=await session();t.after(()=>s.close());const{page}=s,add=addWindow(page);
  await add.getByRole("combobox",{name:"Add to plan",exact:true}).selectOption("PEOPLE");
  for(const theme of ["light","dark"])for(const width of [1440,390]){
    await page.setViewportSize({width,height:900});await page.evaluate(theme=>document.documentElement.dataset.theme=theme,theme);
    if(width<600){const launcher=page.getByRole("navigation",{name:"Workspace tools",exact:true}).getByRole("button",{name:"Elements",exact:true});if(await launcher.getAttribute("aria-pressed")!=="true")await launcher.click();}
    const controls=add.locator('.people-placement-controls');await controls.scrollIntoViewIfNeeded();
    assert.equal(await controls.getByRole("combobox",{name:"Posture",exact:true}).inputValue(),"STANDING");
    const overflow=await controls.evaluate(element=>element.scrollWidth-element.clientWidth);assert.ok(overflow<=1);
    const height=controls.getByLabel("Standing stature mm",{exact:true});await height.fill("1700");await height.press("Tab");
    assert.equal(await controls.getByRole("combobox",{name:"Stature preset",exact:true}).inputValue(),"");
    await controls.getByRole("combobox",{name:"Stature preset",exact:true}).selectOption("1800");
    const fields=await controls.locator('.fixture-fields > label').evaluateAll(labels=>labels.map(label=>{const b=label.getBoundingClientRect();return{x:b.x,y:b.y,width:b.width};}));
    if(width>1000)assert.ok(Math.abs(fields[0].width-fields[1].width)<1);
    else assert.ok(Math.abs(fields[0].x-fields[1].x)<1);
    if(process.env.BROWSER_ARTIFACTS)await add.screenshot({path:`${process.env.BROWSER_ARTIFACTS}/people-controls-${theme}-${width}.png`});
  }
});
