import assert from "node:assert/strict";
import test, { before, after } from "node:test";
import { readFile } from "node:fs/promises";
import { newProject } from "../../lib/projectDocument";
import { defaultBuilding } from "../../lib/buildingDocument";
import { eventually, menu, startBrowserHarness } from "./harness.mjs";

let harness, realMeshes;
before(async()=>{
  harness=await startBrowserHarness();
  if(process.env.CFD_BROWSER_FIXTURES)realMeshes=JSON.parse(await readFile(process.env.CFD_BROWSER_FIXTURES,"utf8"));
});
after(async()=>{await harness?.close();});
const definitions=[
  ["balustrade-open","balustrades","Balustrades","FURNITURE","balustrade-vertical",1000,100,1100],
  ["balustrade-rails","balustrades","Balustrades","FURNITURE","balustrade-horizontal",1000,100,1100],
  ["balustrade-glass","balustrades","Balustrades","FURNITURE","balustrade-glass",1000,100,1100],
  ["balustrade-solid","balustrades","Balustrades","FURNITURE","balustrade-solid",1000,150,1100],
  ["people-standing","people","People","FURNITURE","people-standing",522,360,1800],
  ["people-seated","people","People","FURNITURE","people-seated",558,900,1377],
  ["people-lying","people","People","FURNITURE","people-lying",540,1800,324],
  ["block","kitchen-fridges","Fridges","FURNITURE","furniture-kitchen-fridge-single",600,650,1900],
  ["table","living-tables","Tables","FURNITURE","furniture-table-coffee",1400,800,750],
  ["chair","living-chairs","Chairs","FURNITURE","furniture-chair-modern",500,550,900],
  ["chair-open","living-chairs","Chairs","FURNITURE","furniture-chair-classic",480,520,900],
  ["stool","living-chairs","Chairs","FURNITURE","furniture-chair-stool",450,450,700],
  ["sofa","living-sofas","Sofas","FURNITURE","furniture-sofa-3",2100,900,850],
  ["sofa-left","living-sofas","Sofas","FURNITURE","furniture-sofa-corner-left-3",2400,1600,850],
  ["sofa-right","living-sofas","Sofas","FURNITURE","furniture-sofa-corner-right-3",2400,1600,850],
  ["armchair","living-armchairs","Armchairs","FURNITURE","furniture-armchair-scandi",740,820,820],
  ["bed","bedroom-beds","Beds","FURNITURE","furniture-bed-double",1600,2000,1000],
  ["basin","basins","Basins","BASIN","basin-wall-mounted",600,450,450],
  ["basin-corner","basins","Basins","BASIN","basin-corner",450,450,850],
  ["pedestal-basin","basins","Basins","BASIN","basin-pedestal",600,500,850],
  ["toilet","toilets","Toilets","TOILET","toilet-close-coupled",400,650,800],
  ["toilet-low","toilets","Toilets","TOILET","toilet-freestanding",400,550,420],
  ["toilet-wall","toilets","Toilets","TOILET","toilet-wall-mounted",360,540,420],
  ["bath","baths","Baths","FURNITURE","furniture-bath-alcove",1700,700,560],
  ["bath-oval","baths","Baths","FURNITURE","furniture-bath-oval",1700,800,600],
  ["bath-raised","baths","Baths","FURNITURE","furniture-bath-slipper",1700,750,750],
  ["bath-corner","baths","Baths","FURNITURE","furniture-bath-corner",1400,1400,600],
  ["shower-alcove","showers","Shower enclosures","SHOWER","shower-alcove",900,900,2000],
  ["shower-corner","showers","Shower enclosures","SHOWER","shower-corner",900,900,2000],
  ["shower-screen","showers","Shower enclosures","SHOWER","shower-walk-in",1200,900,2000],
  ["shower-wet-room","showers","Shower enclosures","SHOWER","shower-wet-room",1200,900,2000],
  ["shower-enclosed","showers","Shower enclosures","SHOWER","shower-freestanding",1000,1000,2100],
  ["shower-quadrant","showers","Shower enclosures","SHOWER","shower-quadrant",900,900,2000],
];
const objects=definitions.map(([profile,category_id,category_name,fixture_kind,representation_key,width_mm,depth_mm,height_mm])=>({
  id:`qa-${profile}`,name:`QA ${profile}`,category_id,category_name,fixture_kind,representation_key,width_mm,depth_mm,height_mm,
  color_hex:"#BCC9C6",subcategory:"QA",supplier:"Regression fixture",sku:`CFD-${profile}`,is_default:true,supplier_editable:false,active:true,
  description:"Representative generic catalogue fixture.",plan_shape:"RECTANGLE",plan_symbol_url:`/fixture-symbols/${representation_key}.svg`,images:[],
  cfd_proxy:{version:1,profile},created_at:"2026-10-20T00:00:00Z",updated_at:"2026-10-20T00:00:00Z",
}));
const excluded=[
  {...objects[0],id:"qa-door",name:"QA door",category_id:"doors",category_name:"Internal doors",fixture_kind:"DOOR",representation_key:"door-single",cfd_proxy:null,width_mm:900,depth_mm:45,height_mm:2100},
  {...objects[0],id:"qa-electric",name:"QA socket",category_id:"electric",category_name:"Electrical",fixture_kind:"FURNITURE",representation_key:"electrical-socket-single",cfd_proxy:null,width_mm:86,depth_mm:20,height_mm:86},
];
const all=[...objects,...excluded];
const categories=[...new Map(all.map(item=>[item.category_id,{id:item.category_id,name:item.category_name,description:"QA catalogue",item_count:all.filter(i=>i.category_id===item.category_id).length,default_side_clearance_mm:0,default_front_clearance_mm:0}])).values()];
function fallbackMesh(item){
  // Transport fixture only. Actual profile geometry is independently tested by pytest.
  const w=item.width_mm,d=item.depth_mm,h=item.height_mm;
  return {version:1,units:"mm",profile:item.cfd_proxy.profile,label:`${item.cfd_proxy.profile} approximation`,dimensions_mm:[w,d,h],
    vertices_mm:[[0,0,0],[w,0,0],[w,d,0],[0,d,0],[0,0,h],[w,0,h],[w,d,h],[0,d,h]],
    triangles:[[0,2,1],[0,3,2],[4,5,6],[4,6,7],[0,1,5],[0,5,4],[1,2,6],[1,6,5],[2,3,7],[2,7,6],[3,0,4],[3,4,7]],
    assumptions:["Generic obstruction; review dimensions and mesh settings."]};
}
async function session({invalid=false}={}){
  const project=newProject();project.building=defaultBuilding(project);
  const s=await harness.session(project),{page}=s;
  await page.route(/\/catalog\/items(?:\?.*)?$/,route=>{
    const q=new URL(route.request().url()).searchParams;
    return route.fulfill({json:all.filter(i=>(!q.get("category_id")||i.category_id===q.get("category_id"))&&(!q.get("search")||i.name.includes(q.get("search"))))});
  });
  await page.route("**/catalog/categories",route=>route.fulfill({json:categories}));
  await page.route("**/catalog/materials",route=>route.fulfill({json:[]}));
  await page.route(/\/catalog\/items\/[^/]+\/cfd$/,route=>{
    const item=all.find(i=>route.request().url().endsWith(`/items/${i.id}/cfd`));
    if(realMeshes)assert.ok(realMeshes[item.cfd_proxy.profile],`Missing real CFD fixture: ${item.cfd_proxy.profile}`);
    return route.fulfill({json:invalid?{units:"m"}:realMeshes?.[item.cfd_proxy.profile]??fallbackMesh(item)});
  });
  await page.reload();await page.getByRole("combobox",{name:"Workspace",exact:true}).waitFor();
  await menu(page,"Library","Object catalogue…");return s;
}
async function openAsset(page,item){
  const browser=page.locator('.catalogue-modal');
  const group=item.category_id.startsWith("living-")?"Living Room":item.category_id.startsWith("bedroom-")?"Bedroom":item.category_id.startsWith("kitchen-")?"Kitchen":null;
  if(group){const button=browser.getByRole("button",{name:new RegExp(`^${group}[ +−]*$`)});if(await button.getAttribute("aria-expanded")==="false")await button.click();}
  if(item.category_id==="doors"){
    const doors=browser.getByRole("button",{name:/^Doors[ +−]*$/});if(await doors.getAttribute("aria-expanded")==="false")await doors.click();
  }
  await browser.locator('.catalogue-navigation, .catalogue-sidebar, nav').getByRole("button",{name:new RegExp(`^${item.category_name}`)}).first().click();
  await browser.getByRole("button",{name:`View details for ${item.name}`,exact:true}).click();
  const dialog=page.locator('.catalogue-object-dialog');await dialog.locator('.fixture-preview canvas').waitFor();return dialog;
}

async function assertFitContrast(dialog){
  const contrast=await dialog.getByRole("button",{name:"Fit",exact:true}).evaluate(element=>{
    const style=getComputedStyle(element),luminance=colour=>{
      const channels=colour.match(/[\d.]+/g).slice(0,3).map(Number).map(v=>v/255).map(v=>v<=.04045?v/12.92:((v+.055)/1.055)**2.4);
      return channels[0]*.2126+channels[1]*.7152+channels[2]*.0722;
    };
    const a=luminance(style.color),b=luminance(style.backgroundColor);return (Math.max(a,b)+.05)/(Math.min(a,b)+.05);
  });assert.ok(contrast>=4.5,`Fit must remain legible on the neutral preview stage: ${contrast}`);
}

test("large catalogue dialog keeps information left and orbit/zoom/CFD controls right; every profile renders",async t=>{
  const s=await session();t.after(()=>s.close());const{page}=s;
  for(const item of objects){
    const dialog=await openAsset(page,item);
    const left=await dialog.locator('.catalogue-object-properties').boundingBox(),right=await dialog.locator('.catalogue-asset-preview').boundingBox(),box=await dialog.boundingBox();
    assert.ok(box.width>1100&&right.x>left.x+left.width&&right.width>450);
    assert.ok(left.x>=box.x&&right.x+right.width<=box.x+box.width,"Neither column may be clipped by the parent catalogue");
    const slider=dialog.getByRole("slider",{name:"Preview zoom",exact:true});
    await slider.fill("1.7");assert.equal(await slider.inputValue(),"1.7");
    await dialog.getByRole("button",{name:"Fit",exact:true}).click();assert.equal(await slider.inputValue(),"1");
    await assertFitContrast(dialog);
    await dialog.getByRole("button",{name:"CFD shape",exact:true}).click();
    await dialog.locator('.catalogue-cfd-info').waitFor();await dialog.locator('.fixture-preview canvas').waitFor();
    assert.equal(await dialog.getByRole("button",{name:"CFD shape",exact:true}).getAttribute("aria-pressed"),"true");
    assert.match(await dialog.locator('.catalogue-cfd-info').innerText(),/triangles/);
    assert.match(await dialog.locator('.catalogue-cfd-info').innerText(),/origin; it is not exported/);
    if(realMeshes){
      const mesh=realMeshes[item.cfd_proxy.profile];
      assert.match(await dialog.locator('.catalogue-cfd-info').innerText(),/Geometry revision 2/);
      if(Math.min(...mesh.vertices_mm.map(point=>point[2]))>0)
        assert.match(await dialog.locator('.catalogue-cfd-info').innerText(),/Underside:.*mm above origin. Check mounting height/);
    }
    assert.ok((await dialog.getByRole("link",{name:"Download CFD STL (mm)",exact:true}).getAttribute("href")).endsWith(`/${item.id}/cfd.stl`));
    // Repeated clicks must not strand the current mesh in a loading state.
    await dialog.getByRole("button",{name:"CFD shape",exact:true}).click();assert.ok(await dialog.locator('.fixture-preview canvas').isVisible());
    if(item.id==="qa-table"){
      const canvas=dialog.locator('.fixture-preview canvas'),before=await canvas.screenshot(),box=await canvas.boundingBox();
      await page.mouse.move(box.x+box.width*.45,box.y+box.height*.5);await page.mouse.down();
      await page.mouse.move(box.x+box.width*.7,box.y+box.height*.6,{steps:12});await page.mouse.up();
      assert.notDeepEqual(await canvas.screenshot(),before,"Orbit must alter the displayed geometry");
      await page.mouse.wheel(0,-240);await eventually(()=>dialog.getByRole("slider",{name:"Preview zoom",exact:true}).inputValue(),value=>Number(value)>1);
      await dialog.getByRole("button",{name:"Fit",exact:true}).click();
    }
    if(process.env.BROWSER_ARTIFACTS)await dialog.screenshot({path:`${process.env.BROWSER_ARTIFACTS}/catalogue-cfd-${item.cfd_proxy.profile}.png`});
    await dialog.getByRole("button",{name:"Asset",exact:true}).click();await dialog.locator('.fixture-preview canvas').waitFor();
    assert.equal(await dialog.locator('.catalogue-cfd-info').count(),0);
    await dialog.getByRole("button",{name:"Close catalogue entry details",exact:true}).click();
  }
});

test("catalogue asset viewer is bounded and operable in light/dark and narrow layouts; exclusions stay visual-only",async t=>{
  const s=await session();t.after(()=>s.close());const{page}=s;
  for(const item of excluded){const dialog=await openAsset(page,item);assert.equal(await dialog.getByRole("button",{name:"CFD shape",exact:true}).count(),0);await dialog.getByRole("button",{name:"Close catalogue entry details",exact:true}).click();}
  const dialog=await openAsset(page,objects.find(i=>i.id==="qa-shower-alcove"));
  for(const theme of ["light","dark"])for(const width of [1440,390]){
    await page.setViewportSize({width,height:900});await page.evaluate(theme=>document.documentElement.dataset.theme=theme,theme);
    const box=await dialog.boundingBox();assert.ok(box.x>=0&&box.x+box.width<=width+1&&box.y>=0&&box.y+box.height<=901,JSON.stringify({theme,width,box}));
    const slider=dialog.getByRole("slider",{name:"Preview zoom",exact:true});await slider.scrollIntoViewIfNeeded();await slider.fill("1.4");assert.equal(await slider.inputValue(),"1.4");
    await dialog.getByRole("button",{name:"Fit",exact:true}).click();assert.equal(await slider.inputValue(),"1");
    const layout=dialog.locator('.catalogue-object-layout'),scrollBefore=await layout.evaluate(e=>e.scrollTop),canvas=await dialog.locator('.fixture-preview canvas').boundingBox();
    await page.mouse.move(canvas.x+canvas.width*.45,canvas.y+canvas.height*.45);await page.mouse.wheel(0,240);
    await eventually(()=>slider.inputValue(),value=>Number(value)<1);
    await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
    assert.equal(await layout.evaluate(e=>e.scrollTop),scrollBefore,"Zooming must not also scroll the properties window");
    await dialog.getByRole("button",{name:"Fit",exact:true}).click();
    const overflow=await dialog.evaluate(e=>({width:e.scrollWidth,client:e.clientWidth}));assert.ok(overflow.width<=overflow.client+1);
    await assertFitContrast(dialog);
    if(process.env.BROWSER_ARTIFACTS)await dialog.screenshot({path:`${process.env.BROWSER_ARTIFACTS}/catalogue-viewer-${theme}-${width}.png`});
  }
  await dialog.getByRole("button",{name:"Close",exact:true}).focus();await page.keyboard.press("Tab");
  assert.ok(await dialog.evaluate(element=>element.contains(document.activeElement)),"Tab stays inside the portalled dialog");
  await page.keyboard.press("Escape");assert.equal(await dialog.count(),0);
});

test("invalid CFD data shows an error without misleading geometry and Asset mode remains usable",async t=>{
  const s=await session({invalid:true});t.after(()=>s.close());const{page}=s,dialog=await openAsset(page,objects[1]);
  await dialog.getByRole("button",{name:"CFD shape",exact:true}).click();await dialog.getByRole("alert").waitFor();
  assert.match(await dialog.getByRole("alert").innerText(),/invalid/);assert.equal(await dialog.locator('.fixture-preview canvas').count(),0);
  await dialog.getByRole("button",{name:"Asset",exact:true}).click();await dialog.locator('.fixture-preview canvas').waitFor();
});
