import assert from 'node:assert/strict';
import test, { before, after } from 'node:test';
import { cfdProject, realPreparation, realDefaultSetup } from '../climoptixFixtures';
import { boundarySchema } from '../../lib/climoptixDocument';
import { cfdWindow, eventually, startBrowserHarness } from './harness.mjs';

let harness;
before(async()=>{harness=await startBrowserHarness({climoptixEnabled:true});});
after(async()=>{await harness?.close();});
const button=(scope,name)=>scope.getByRole('button',{name,exact:true});
async function open(t,width=1440) {
  const p=cfdProject(false); p.cfdScenarios[0].boundaries.groups.floor=boundarySchema.parse({flow:{type:'volumeFlow'},thermal:{type:'temperature',value:300}});
  const s=await harness.session(p,{viewport:{width,height:1000}}); t.after(()=>s.close());
  await s.page.getByRole('combobox',{name:'Workspace',exact:true}).selectOption('CLIMOPTIX');
  const ui=s.page.locator('.cfx-workspace'); await cfdWindow(ui,'Simulations');
  await eventually(()=>ui.getAttribute('data-preparation-state'),v=>v==='checked');
  return {...s,ui};
}
test('reset confirms, backs up and restores a valid worker-ready case without changing rooms; new simulations inherit it',async t=>{
  const {page,ui,saved}=await open(t);
  const original=await saved(), rooms=structuredClone(original.rooms);
  await button(ui,'Restore default').click(); await button(page.getByRole('dialog',{name:'Restore the default workbench?',exact:true}),'Cancel').click();
  assert.deepEqual((await saved()).cfdScenarios[0].boundaries,original.cfdScenarios[0].boundaries);
  await button(ui,'Restore default').click(); await button(page.getByRole('dialog',{name:'Restore the default workbench?',exact:true}),'Restore default').click();
  const reset=await eventually(saved,p=>p.cfdScenarios[0].vents.length===2&&p.cfdScenarios[0].validation?.errors===0);
  assert.deepEqual(reset.rooms,rooms); assert.equal(reset.cfdScenarios[0].resources.cpu,1); assert.equal(reset.cfdScenarios[0].physics.turbulence,'laminar');
  assert.equal(reset.cfdScenarios[0].outputs.probesMm.length,1);
  const backup=await page.evaluate(ids=>JSON.parse(localStorage.getItem(`climoptix:before-restore:${ids[0]}`)),[reset.projectId,reset.cfdScenarios[0].id]);
  assert.deepEqual(backup.scenarios[0].boundaries,original.cfdScenarios[0].boundaries);
  await button(ui,'New simulation').click();
  const added=await eventually(saved,p=>p.cfdScenarios.length===2);
  const report=realPreparation({project:added,scenario:added.cfdScenarios[1],clientRevision:'a'.repeat(64)});
  assert.equal(report.validation.errors,0); assert.equal(added.cfdScenarios[1].vents.length,2);
  if(process.env.BROWSER_ARTIFACTS)await page.screenshot({path:`${process.env.BROWSER_ARTIFACTS}/default-simulations.png`});
});

test('object, boundary, refinement and probe bulk clears require confirmation and keep the source building',async t=>{
  const {page,ui,saved}=await open(t);
  await button(ui,'Restore default').click(); await button(page.getByRole('dialog',{name:'Restore the default workbench?',exact:true}),'Restore default').click();
  await eventually(saved,p=>p.cfdScenarios[0].vents.length===2); const rooms=structuredClone((await saved()).rooms);
  await cfdWindow(ui,'Equipment'); const panel=ui.getByRole('region',{name:'Equipment settings',exact:true});
  await button(panel,'Clear all').click(); const confirm=page.getByRole('dialog',{name:'Clear all CFD objects?',exact:true});
  await button(confirm,'Cancel').click(); assert.equal((await saved()).cfdScenarios[0].vents.length,2);
  await button(panel,'Clear all').click(); await button(confirm,'Clear all').click();
  await eventually(saved,p=>p.cfdScenarios[0].vents.length===0);
  await button(panel,'Add object group').click();
  await eventually(saved,p=>p.cfdScenarios[0].objectGroups?.some(g=>g.name==='Group'));
  assert.ok(await button(panel,'Clear all').isEnabled(),'Empty custom groups must still be clearable');
  await button(panel,'Clear all').click(); await button(confirm,'Clear all').click();
  await eventually(saved,p=>p.cfdScenarios[0].objectGroups?.length===0);
  await cfdWindow(ui,'Boundaries'); const bounds=ui.getByRole('region',{name:'Boundaries settings',exact:true});
  await button(bounds,'Clear all').click(); await button(page.getByRole('dialog',{name:'Clear all boundary customizations?',exact:true}),'Clear all').click();
  await eventually(saved,p=>Object.keys(p.cfdScenarios[0].boundaries.groups).length===0);
  await cfdWindow(ui,'Solver'); await ui.getByRole('tab',{name:'Mesh',exact:true}).click();
  await button(ui.getByRole('tabpanel',{name:'Mesh',exact:true}),'Clear all').click();
  await button(page.getByRole('dialog',{name:'Clear all refinement regions?',exact:true}),'Clear all').click();
  await eventually(saved,p=>p.cfdScenarios[0].mesh.refinements.length===0); assert.deepEqual((await saved()).rooms,rooms);
  await cfdWindow(ui,'Solver');await ui.getByRole('tab',{name:'Post-processing',exact:true}).click();
  const probes=ui.getByRole('group',{name:'Probe positions (mm)',exact:true});
  await button(probes,'Clear all').click();
  const probeConfirm=page.getByRole('dialog',{name:'Clear all probes?',exact:true});
  await page.keyboard.press('Escape'); await probeConfirm.waitFor({state:'detached'});
  assert.equal((await saved()).cfdScenarios[0].outputs.probesMm.length,1);
  assert.ok(await button(probes,'Clear all').evaluate(n=>n===document.activeElement));
  await button(probes,'Clear all').click(); await button(probeConfirm,'Clear all').click();
  await eventually(saved,p=>p.cfdScenarios[0].outputs.probesMm.length===0);
});

test('temperature and dimensional preferences update CFD inputs while storage stays K and mm; placement Cancel rolls back',async t=>{
  const {page,ui,saved}=await open(t);
  await button(ui,'Restore default').click(); await button(page.getByRole('dialog',{name:'Restore the default workbench?',exact:true}),'Restore default').click();
  await eventually(saved,p=>p.cfdScenarios[0].vents.length===2);
  await page.getByRole('button',{name:'Settings',exact:true}).click();
  await page.getByRole('button',{name:'Preferences…',exact:true}).click();
  const settings=page.getByRole('dialog',{name:'Preferences',exact:true});
  await settings.getByLabel('Temperature units',{exact:true}).selectOption('C');
  await button(settings,'Centimetres').click(); await settings.getByLabel('CFD volume flow units',{exact:true}).selectOption('L/s');
  await button(settings,'Done').click(); await cfdWindow(ui,'Equipment'); await button(ui,'Edit Default inlet').click();
  const editor=ui.getByRole('region',{name:'Equipment editor',exact:true});
  const temp=editor.getByRole('spinbutton',{name:'Supply / inflow temperature (°C)',exact:true});
  assert.equal(await temp.inputValue(),'20'); await temp.fill('25'); await temp.press('Enter');
  const width=editor.getByRole('spinbutton',{name:'Vent width (cm)',exact:true}); await width.fill('60'); await width.press('Enter');
  const changed=await eventually(saved,p=>p.cfdScenarios[0].vents[0].temperatureK===298.15&&p.cfdScenarios[0].vents[0].widthMm===600);
  const before=structuredClone(changed.cfdScenarios[0].vents);
  await button(editor,'Place this vent on face…').click(); const placement=ui.getByRole('region',{name:'Vent placement editor',exact:true});
  const host=placement.getByRole('combobox',{name:'Vent host face',exact:true});
  await host.selectOption({index:1}); const u=placement.getByRole('spinbutton',{name:'Host U (0–1)',exact:true}); await u.fill('.4'); await u.press('Enter');
  await placement.getByRole('status').getByText(/Changes are a preview/).count();
  assert.ok(await placement.getByLabel('Live vent coordinates').isVisible());
  assert.equal(await ui.locator('.cfx-setup-window').isVisible(),false);
  assert.deepEqual((await saved()).cfdScenarios[0].vents,before);
  await button(ui.locator('.cfx-placement-editor'),'Cancel').click(); assert.deepEqual((await saved()).cfdScenarios[0].vents,before);
});

test('a stale default response and a failed backup never replace the current settings',async t=>{
  const {page,context,ui,saved}=await open(t);
  let captured,release;
  const gate=new Promise(resolve=>{release=resolve;});
  await context.route('**/climoptix/default-setup',async route=>{
    captured=route.request().postDataJSON(); await gate;
    await route.fulfill({json:realDefaultSetup(captured)});
  });
  await button(ui,'Restore default').click(); await button(page.getByRole('dialog',{name:'Restore the default workbench?',exact:true}),'Restore default').click();
  await eventually(()=>!!captured,Boolean);
  await cfdWindow(ui,'Physics');
  const density=ui.getByRole('spinbutton',{name:'Air density (kg/m³)',exact:true}); await density.fill('1.3'); await density.press('Enter');
  await eventually(saved,p=>p.cfdScenarios[0].physics.densityKgM3===1.3); release();
  await ui.getByRole('alert').filter({hasText:'changed during reset'}).waitFor();
  assert.equal((await saved()).cfdScenarios[0].vents.length,0);
  await page.evaluate(()=>{
    const set=Storage.prototype.setItem;
    Storage.prototype.setItem=function(key,value){ if(key.startsWith('climoptix:before-restore:')) throw new DOMException('Quota exceeded','QuotaExceededError'); return set.call(this,key,value); };
  });
  await cfdWindow(ui,'Simulations'); await button(ui,'Restore default').click();
  await button(page.getByRole('dialog',{name:'Restore the default workbench?',exact:true}),'Restore default').click();
  await ui.getByRole('alert').filter({hasText:'backup could not be saved'}).waitFor();
  assert.equal((await saved()).cfdScenarios[0].physics.densityKgM3,1.3);
  assert.equal((await saved()).cfdScenarios[0].vents.length,0);
});

for (const width of [1440,390]) test(`hierarchical action columns and indentation stay polished at ${width}px`,async t=>{
  const {page,ui,saved}=await open(t,width);
  await button(ui,'Restore default').click(); await button(page.getByRole('dialog',{name:'Restore the default workbench?',exact:true}),'Restore default').click();
  await eventually(saved,p=>p.cfdScenarios[0].vents.length===2);
  const measure = async (group, actions) => {
    const rects = await group.locator(`.cfx-group-actions > button, ${actions} > button`).evaluateAll(nodes=>nodes.map(n=>{
      const r=n.getBoundingClientRect();return {x:r.x,y:r.y,w:r.width};
    }));
    assert.ok(rects.length>=6);
    for(const r of rects)assert.ok(Math.abs(r.w-rects[0].w)<1,JSON.stringify(rects));
    for(let i=3;i<rects.length;i++)assert.ok(Math.abs(rects[i].x-rects[i%3].x)<1,JSON.stringify(rects));
    const labels=await group.locator(`.cfx-group-actions > button, ${actions} > button`).evaluateAll(nodes=>nodes.map(n=>{
      const range=document.createRange();range.selectNodeContents(n); const css=getComputedStyle(n);
      return {text:n.textContent,width:range.getBoundingClientRect().width,available:n.clientWidth-parseFloat(css.paddingLeft)-parseFloat(css.paddingRight),font:css.font};
    }));
    assert.ok(labels.every(r=>r.width<=r.available+1),JSON.stringify(labels));
    const indent=await group.locator('.cfx-reorder-item > .cfx-grip').first().evaluate(n=>n.getBoundingClientRect().x-n.closest('.cfx-study-group').getBoundingClientRect().x);
    assert.ok(indent>=32,`Nested grip inset is only ${indent}px`);
  };
  await measure(ui.getByRole('region',{name:'Simulation group General',exact:true}),'.cfx-study-actions');
  await cfdWindow(ui,'Equipment'); await measure(ui.getByRole('region',{name:'Object group General',exact:true}),'.cfx-device-actions');
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  if(process.env.BROWSER_ARTIFACTS)await page.screenshot({path:`${process.env.BROWSER_ARTIFACTS}/object-rows-${width}.png`});
});
