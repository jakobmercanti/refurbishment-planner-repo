import assert from "node:assert/strict";
import test,{before,after} from "node:test";
import { createHash } from "node:crypto";
import { BALUSTRADE_STYLES } from "../../lib/balustrades";
import { roofProject } from "../roofBalustradeFixtures";
import { eventually,menu,startBrowserHarness } from "./harness.mjs";

let harness;
before(async()=>{harness=await startBrowserHarness();});
after(async()=>{await harness?.close();});
async function openManager(page){if(!await page.locator('.building-properties-window').isVisible())await page.getByRole('button',{name:'Manage floors and building',exact:true}).click();return page.locator('.building-properties-window');}
async function openRoof(page){const manager=await openManager(page);await manager.getByRole('button',{name:'Edit roof',exact:true}).click();return page.locator('.building-roof-window');}
async function openOpening(page){const manager=await openManager(page);await manager.getByRole('button',{name:'Edit Upper floor',exact:true}).click();const editor=page.locator('.building-floor-editor-window');await editor.getByRole('button',{name:/Stairwell ·/}).click();return editor;}

test('room-specific roofs are optional, independently editable, previewed together, saved and cancellable',async t=>{
  const s=await harness.session(roofProject(true));t.after(()=>s.close());const{page}=s;
  let roof=await openRoof(page);assert.equal(await roof.getByRole('checkbox',{name:'Different roofs by room',exact:true}).isChecked(),false);
  assert.equal(await roof.getByRole('combobox',{name:'Roof room',exact:true}).count(),0);
  await roof.getByRole('checkbox',{name:'Different roofs by room',exact:true}).check();
  const rooms=(await s.saved()).rooms,first=rooms.find(room=>room.name==='Living room'),second=rooms.find(room=>room.name==='Study');assert.ok(first&&second);
  await roof.getByRole('combobox',{name:'Roof room',exact:true}).selectOption(first.id);
  assert.equal(await roof.getByRole('combobox',{name:'Roof profile',exact:true}).isDisabled(),true);
  await roof.getByRole('checkbox',{name:'Use a different roof for this room',exact:true}).check();
  await roof.getByRole('combobox',{name:'Roof profile',exact:true}).selectOption('GABLE');
  await roof.getByRole('spinbutton',{name:'Ridge height',exact:true}).fill('3600');await page.keyboard.press('Tab');
  await roof.getByRole('combobox',{name:'Roof material',exact:true}).selectOption('CLAY_TILES');
  await roof.getByRole('combobox',{name:'Roof orientation',exact:true}).selectOption('CUSTOM');
  await roof.getByRole('spinbutton',{name:'Custom roof angle',exact:true}).fill('33.75');
  await roof.getByRole('combobox',{name:'Roof room',exact:true}).selectOption(second.id);
  await roof.getByRole('checkbox',{name:'Use a different roof for this room',exact:true}).check();
  await roof.getByRole('combobox',{name:'Roof profile',exact:true}).selectOption('MONO');
  await roof.getByRole('spinbutton',{name:'High height',exact:true}).fill('4200');await page.keyboard.press('Tab');
  await roof.getByRole('combobox',{name:'Roof material',exact:true}).selectOption('METAL');
  await roof.getByRole('combobox',{name:'Roof room',exact:true}).selectOption(first.id);
  assert.equal(await roof.getByRole('combobox',{name:'Roof profile',exact:true}).inputValue(),'GABLE');
  assert.equal(await roof.getByRole('combobox',{name:'Roof material',exact:true}).inputValue(),'CLAY_TILES');
  assert.equal(await roof.getByRole('spinbutton',{name:'Custom roof angle',exact:true}).inputValue(),'33.75');
  await roof.getByRole('slider',{name:'Roof preview zoom',exact:true}).fill('1.6');
  await roof.getByRole('button',{name:'Fit',exact:true}).click();assert.equal(await roof.getByRole('slider',{name:'Roof preview zoom',exact:true}).inputValue(),'1');
  if(process.env.BROWSER_ARTIFACTS)await roof.screenshot({path:`${process.env.BROWSER_ARTIFACTS}/combined-roof-editor.png`});
  await roof.getByRole('button',{name:'Apply roof & ceiling',exact:true}).click();
  await eventually(s.saved,p=>p.building.roof.roomRoofsEnabled&&p.building.roof.roomOverrides?.length===2);
  await page.reload();roof=await openRoof(page);await roof.getByRole('combobox',{name:'Roof room',exact:true}).selectOption(second.id);
  assert.equal(await roof.getByRole('spinbutton',{name:'High height',exact:true}).inputValue(),'4200');
  await roof.getByRole('checkbox',{name:'Different roofs by room',exact:true}).uncheck();
  await roof.getByRole('button',{name:'Apply roof & ceiling',exact:true}).click();
  const saved=await eventually(s.saved,p=>p.building.roof.roomRoofsEnabled===false);assert.equal(saved.building.roof.roomOverrides.length,2);
  roof=await openRoof(page);await roof.getByRole('checkbox',{name:'Different roofs by room',exact:true}).check();
  await roof.getByRole('button',{name:'Cancel',exact:true}).click();assert.equal((await s.saved()).building.roof.roomRoofsEnabled,false);
});

test('opening checkbox offers five styles, persists their properties and shows guards in 2D and 3D',async t=>{
  const s=await harness.session(roofProject(true));t.after(()=>s.close());const{page}=s;
  let editor=await openOpening(page);
  await editor.getByRole('checkbox',{name:'Add balustrade',exact:true}).check();
  assert.equal(await editor.getByRole('combobox',{name:'Balustrade style',exact:true}).locator('option').count(),5);
  for(const style of BALUSTRADE_STYLES){
    await editor.getByRole('combobox',{name:'Balustrade style',exact:true}).selectOption(style.id);
    await editor.getByRole('button',{name:'Apply opening',exact:true}).click();
    const saved=await eventually(s.saved,p=>p.building.floors.at(-1).openings[0].balustrade?.style===style.id);
    assert.equal(saved.building.floors.at(-1).openings[0].balustrade.heightMm,1100);
    assert.equal(saved.building.floors.at(-1).openings[0].balustrade.colour,style.colour);
    assert.ok(await page.locator('.floor-opening-balustrade').count()>0);
  }
  await editor.getByRole('spinbutton',{name:'Balustrade height',exact:true}).fill('1200');await page.keyboard.press('Tab');
  await editor.getByRole('button',{name:'Apply opening',exact:true}).click();await eventually(s.saved,p=>p.building.floors.at(-1).openings[0].balustrade.heightMm===1200);
  await editor.getByRole('button',{name:'Help for Opening balustrade',exact:true}).click();await page.locator('.window-help-content').waitFor();assert.match(await page.locator('.window-help-content').innerText(),/not.*certif|calibrat/i);await page.keyboard.press('Escape');
  await editor.getByRole('button',{name:'Hide Floor properties',exact:true}).click();await page.locator('.building-properties-window').getByRole('button',{name:'Hide Floors & building',exact:true}).click();
  await page.getByRole('button',{name:'3D',exact:true}).click();await page.locator('.viewer-shell > .stable-canvas-host canvas').waitFor();
  await page.getByRole('button',{name:'Show',exact:true}).click();await page.getByText('Wall display',{exact:true}).click();await page.getByRole('menuitemradio',{name:'Invisible walls',exact:true}).click();await page.keyboard.press('Escape');
  if(process.env.BROWSER_ARTIFACTS)await page.screenshot({path:`${process.env.BROWSER_ARTIFACTS}/opening-balustrade-building.png`});
  const add=page.locator('.floating-toolbar').filter({has:page.locator('.floating-toolbar-titlebar',{hasText:'Add elements'})}).filter({visible:true});
  await add.getByRole('combobox',{name:'Add to plan',exact:true}).selectOption('BALUSTRADES');
  await page.getByRole('button',{name:'2D',exact:true}).click();await page.reload();editor=await openOpening(page);
  assert.equal(await editor.getByRole('checkbox',{name:'Add balustrade',exact:true}).isChecked(),true);
  assert.equal(await editor.getByRole('spinbutton',{name:'Balustrade height',exact:true}).inputValue(),'1200');
  await editor.getByRole('checkbox',{name:'Add balustrade',exact:true}).uncheck();await editor.getByRole('button',{name:'Apply opening',exact:true}).click();
  await eventually(s.saved,p=>p.building.floors.at(-1).openings[0].balustrade.enabled===false);assert.equal(await page.locator('.floor-opening-balustrade').count(),0);
});

test('combined roof controls stay usable in dark mode and on small screens',async t=>{
  const s=await harness.session(roofProject());t.after(()=>s.close());const{page}=s;const roof=await openRoof(page);
  await roof.getByRole('checkbox',{name:'Different roofs by room',exact:true}).check();
  for(const theme of ['light','dark'])for(const width of [1440,390]){
    await page.setViewportSize({width,height:900});await page.evaluate(theme=>document.documentElement.dataset.theme=theme,theme);
    const check=roof.getByRole('checkbox',{name:'Different roofs by room',exact:true});await check.scrollIntoViewIfNeeded();assert.ok(await check.isVisible());
    const field=roof.getByRole('combobox',{name:'Roof room',exact:true}),fieldBox=await field.boundingBox(),windowBox=await roof.boundingBox();assert.ok(fieldBox.x>=windowBox.x&&fieldBox.x+fieldBox.width<=windowBox.x+windowBox.width);
    await roof.getByRole('button',{name:'Help for Room roof definitions',exact:true}).click();assert.match(await page.locator('.window-help-content').innerText(),/Optional room roofs/);await page.keyboard.press('Escape');
    const apply=roof.getByRole('button',{name:'Apply roof & ceiling',exact:true});await apply.scrollIntoViewIfNeeded();assert.ok(await apply.isVisible());
    if(process.env.BROWSER_ARTIFACTS)await roof.screenshot({path:`${process.env.BROWSER_ARTIFACTS}/room-roof-${theme}-${width}.png`});
  }
});

test('all five detailed balustrade catalogue models render distinct assets with zoom controls',async t=>{
  const s=await harness.session(roofProject());t.after(()=>s.close());const{page}=s;
  const entries=BALUSTRADE_STYLES.map(style=>({id:`generic-${style.key}`,category_id:'balustrades',category_name:'Balustrades',fixture_kind:'FURNITURE',name:`${style.name} balustrade`,supplier:'Renovation Fit',sku:style.key,subcategory:style.name,representation_key:style.key,width_mm:1000,depth_mm:style.depthMm,height_mm:1100,color_hex:style.colour,active:true,is_default:true,supplier_editable:true,images:[],plan_shape:'RECTANGLE',plan_symbol_url:`/fixture-symbols/${style.key}.svg`,cfd_proxy:{version:1,profile:style.cfdProfile},description:'Generic balustrade section',created_at:'2026-10-20T00:00:00Z',updated_at:'2026-10-20T00:00:00Z'}));
  await page.route(/\/catalog\/items(?:\?.*)?$/,route=>route.fulfill({json:entries}));await page.route('**/catalog/categories',route=>route.fulfill({json:[{id:'balustrades',name:'Balustrades',description:'Guards',item_count:5,default_side_clearance_mm:0,default_front_clearance_mm:0}]}));
  await menu(page,'Library','Object catalogue…');const catalogue=page.locator('.catalogue-modal');await catalogue.getByRole('button',{name:/^Balustrades/}).first().click();
  const hashes=[];
  for(const item of entries){
    await catalogue.getByRole('button',{name:`View details for ${item.name}`,exact:true}).click();const dialog=page.locator('.catalogue-object-dialog');const canvas=dialog.locator('.fixture-preview canvas');await canvas.waitFor();
    assert.match(await dialog.locator('.catalogue-asset-preview').innerText(),/Asset model/);
    await dialog.getByRole('slider',{name:'Preview zoom',exact:true}).fill('1.4');await dialog.getByRole('button',{name:'Fit',exact:true}).click();
    const buffer=await canvas.screenshot();hashes.push(createHash('sha256').update(buffer).digest('hex'));
    assert.ok(await dialog.getByRole('button',{name:'CFD shape',exact:true}).isVisible());
    if(process.env.BROWSER_ARTIFACTS)await dialog.screenshot({path:`${process.env.BROWSER_ARTIFACTS}/${item.representation_key}-catalogue.png`});
    await dialog.getByRole('button',{name:'Close catalogue entry details',exact:true}).click();
  }
  assert.equal(new Set(hashes).size,5);
});
