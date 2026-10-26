import assert from 'node:assert/strict';
import test,{before,after} from 'node:test';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {cfdProject,realDefaultSetup} from '../climoptixFixtures';
import {cfdWindow,eventually,startBrowserHarness} from './harness.mjs';

let harness;
before(async()=>{harness=await startBrowserHarness({climoptixEnabled:true});});
after(async()=>{await harness?.close();});
const button=(s,name)=>s.getByRole('button',{name,exact:true});
function realReadiness(body){
  const root=fileURLToPath(new URL('../../../',import.meta.url));
  const result=spawnSync(path.join(root,'.venv','Scripts/python.exe'),['-X','utf8','-c',
    "import json,sys; from backend.app.climoptix_api import AdjointPreparationRequest,adjoint_preparation; print(json.dumps(adjoint_preparation(AdjointPreparationRequest.model_validate(json.load(sys.stdin)))))"],
    {cwd:root,input:JSON.stringify(body),encoding:'utf8',timeout:25000,maxBuffer:4*1024*1024});
  if(result.status!==0)throw new Error(result.stderr||'Authoritative readiness failed');return JSON.parse(result.stdout);
}
async function open(t,withVents=true){
  const project=cfdProject(false);if(withVents)project.cfdScenarios[0]=realDefaultSetup({project,scenario:project.cfdScenarios[0],clientRevision:'a'.repeat(64)});
  const s=await harness.session(project);t.after(()=>s.close());
  await s.context.route('**/climoptix/optimisation/prepare',async route=>{try{await route.fulfill({json:realReadiness(route.request().postDataJSON())});}catch(e){await route.fulfill({status:422,json:{detail:String(e)}});}});
  await s.page.getByRole('combobox',{name:'Workspace',exact:true}).selectOption('CLIMOPTIX');
  const ui=s.page.locator('.cfx-workspace');await cfdWindow(ui,'Adjoint Optimisation');
  await eventually(()=>ui.getAttribute('data-preparation-state'),v=>v==='checked');
  const panel=ui.getByRole('region',{name:'Adjoint optimisation preparation',exact:true});
  return{...s,ui,panel};
}
async function capture(panel){await button(panel,'Use current CFD setup').click();await panel.getByLabel('Saved optimisation configuration',{exact:true}).waitFor();}
async function movable(panel,index=0){const port=panel.locator('.cfx-adjoint-port').nth(index);await port.locator('summary').click();await port.getByRole('checkbox',{name:'Move this port',exact:true}).check();return port;}
async function screenshot(page,name){if(process.env.BROWSER_ARTIFACTS)await page.screenshot({path:`${process.env.BROWSER_ARTIFACTS}/adjoint-${name}.png`});}

test('capture, authoritative region validation, selection, accepted-step settings, export and reopen never move baseline vents',async t=>{
  const {page,panel,saved,ui}=await open(t),before=await saved();
  await capture(panel);const port=await movable(panel);await port.getByRole('button',{name:/Select .* in viewer/}).click();
  assert.equal(await port.getByRole('button',{name:/Select .* in viewer/}).getAttribute('aria-pressed'),'true');
  const steps=panel.getByRole('spinbutton',{name:'Maximum accepted movement steps',exact:true});await steps.fill('5');await steps.press('Enter');
  await button(panel,'Validate setup').click();await eventually(()=>panel.innerText(),v=>v.includes('Configuration checks passed · adjoint unavailable'));
  assert.ok(await button(panel,'Run adjoint optimisation').isDisabled());
  const after=await saved();assert.deepEqual(after.rooms,before.rooms);assert.deepEqual(after.cfdScenarios[0].vents,before.cfdScenarios[0].vents);
  assert.equal(after.cfdScenarios[0].adjointStudies[0].strategy.maxAcceptedSteps,5);
  const download=page.waitForEvent('download');await button(panel,'Export configuration JSON').click();
  const file=await download,chunks=[];for await(const chunk of await file.createReadStream())chunks.push(chunk);const data=JSON.parse(Buffer.concat(chunks).toString('utf8'));
  assert.equal(data.execution,'unavailable');assert.deepEqual(data.iterations,[]);assert.equal(data.readiness.canRun,false);assert.equal(data.study.strategy.maxAcceptedSteps,5);
  await panel.locator('h2').scrollIntoViewIfNeeded();await screenshot(page,'desktop');
  for(const group of await panel.locator('.cfx-adjoint-actions').all()){
    const widths=await group.locator(':scope > button').evaluateAll(nodes=>nodes.map(n=>n.getBoundingClientRect().width));assert.ok(Math.max(...widths)-Math.min(...widths)<=1);
  }
  await port.scrollIntoViewIfNeeded();await screenshot(page,'regions-desktop');
  for(const [name,width,height] of [['tablet',800,1000],['mobile',390,900]]){await page.setViewportSize({width,height});await port.scrollIntoViewIfNeeded();assert.ok(await panel.evaluate(n=>n.scrollWidth<=n.clientWidth+2));await screenshot(page,`regions-${name}`);}
  await page.setViewportSize({width:1440,height:1000});
  await page.reload();await page.getByRole('combobox',{name:'Workspace',exact:true}).selectOption('CLIMOPTIX');await cfdWindow(ui,'Adjoint Optimisation');
  assert.equal(await panel.getByRole('spinbutton',{name:'Maximum accepted movement steps',exact:true}).inputValue(),'5');
  assert.ok(await button(panel,'Run adjoint optimisation').isDisabled());
});
test('infeasible footprints and unselected ports have clear repairs; invalid numeric input is not silently accepted',async t=>{
  const {panel}=await open(t);await capture(panel);await button(panel,'Validate setup').click();
  await eventually(()=>panel.innerText(),v=>v.includes('No inlet or outlet is selected for movement.'));
  const port=await movable(panel),minimum=port.getByRole('spinbutton',{name:'U minimum (mm)',exact:true});
  await minimum.fill('0');await minimum.press('Enter');await button(panel,'Validate setup').click();
  await eventually(()=>panel.innerText(),v=>v.includes('full swept footprint and clearance leave the support'));
  const steps=panel.getByRole('spinbutton',{name:'Maximum accepted movement steps',exact:true});await steps.fill('0');await steps.press('Enter');assert.ok(await panel.getByRole('alert').isVisible());assert.equal(await steps.inputValue(),'3');
  await button(panel,'Run adjoint optimisation').isDisabled().then(assert.ok);
});
test('empty configuration, clone/remove confirmation, keyboard escape and responsive layouts',async t=>{
  const {page,panel}=await open(t,false);assert.match(await panel.innerText(),/No saved optimisation configurations/);await capture(panel);
  await button(panel,'Validate setup').click();await eventually(()=>panel.innerText(),v=>v.includes('No inlet or outlet is selected'));
  await button(panel,'Clone configuration').click();assert.equal(await panel.getByLabel('Saved optimisation configuration',{exact:true}).locator('option').count(),2);
  await button(panel,'Remove configuration').click();await page.keyboard.press('Escape');assert.equal(await panel.getByLabel('Saved optimisation configuration',{exact:true}).locator('option').count(),2);
  await button(panel,'Remove configuration').click();await page.getByRole('dialog',{name:'Remove saved preparation?',exact:true}).getByRole('button',{name:'Remove configuration',exact:true}).click();assert.equal(await panel.getByLabel('Saved optimisation configuration',{exact:true}).locator('option').count(),1);
  for(const [name,width,height] of [['tablet',800,1000],['mobile',390,900]]){
    await page.setViewportSize({width,height});await panel.locator('h2').scrollIntoViewIfNeeded();assert.ok(await panel.evaluate(n=>n.scrollWidth<=n.clientWidth+2));await screenshot(page,name);
  }
  await page.evaluate(()=>document.documentElement.dataset.theme='dark');await screenshot(page,'mobile-dark');
});
test('physical setup edits invalidate saved baseline; service failures remain actionable and never start a solve',async t=>{
  const {context,panel,ui}=await open(t);await capture(panel);
  await context.route('**/climoptix/optimisation/prepare',route=>route.fulfill({status:503,json:{detail:'Preparation API not deployed; configuration retained'}}));
  await button(panel,'Validate setup').click();await eventually(()=>panel.getByRole('alert').innerText(),v=>v.includes('configuration retained'));
  await cfdWindow(ui,'Solver');await ui.getByRole('tab',{name:'Post-processing',exact:true}).click();
  await ui.getByRole('checkbox',{name:'YZ slices (normal X)',exact:true}).check();
  const count=ui.getByRole('spinbutton',{name:'X plane count',exact:true});await count.fill('2');await count.press('Enter');
  await cfdWindow(ui,'Adjoint Optimisation');await eventually(()=>panel.innerText(),v=>v.includes('Baseline changed or current checks are pending.'));
  assert.ok(await button(panel,'Run adjoint optimisation').isDisabled());
});

test('leaving a pending validation cancels it; reopening does not lock the tab or paint an obsolete readiness',async t=>{
  const {context,panel,ui}=await open(t);await capture(panel);await movable(panel);
  let release,began=false;const ready=new Promise<void>(resolve=>release=resolve);
  await context.route('**/climoptix/optimisation/prepare',async route=>{began=true;const data=realReadiness(route.request().postDataJSON());await ready;await route.fulfill({json:data}).catch(()=>{});},{times:1});
  await button(panel,'Validate setup').click();await eventually(()=>began,Boolean);
  await cfdWindow(ui,'Solver');await cfdWindow(ui,'Adjoint Optimisation');
  assert.ok(await button(panel,'Validate setup').isEnabled());release();
  assert.equal(await panel.getByText('Configuration checks passed · adjoint unavailable',{exact:true}).count(),0);
  await button(panel,'Validate setup').click();await eventually(()=>panel.innerText(),v=>v.includes('Configuration checks passed · adjoint unavailable'));
});

test('failed refresh clears an old readiness verdict and validation errors remain visible beside the form',async t=>{
  const {page,context,panel}=await open(t);await capture(panel);await movable(panel);
  await button(panel,'Validate setup').click();await eventually(()=>panel.innerText(),v=>v.includes('Configuration checks passed · adjoint unavailable'));
  await context.route('**/climoptix/optimisation/prepare',route=>route.fulfill({status:503,json:{detail:'Worker preparation unavailable; retry later'}}));
  await button(panel,'Validate setup').click();await eventually(()=>panel.getByRole('alert').innerText(),v=>v.includes('retry later'));
  assert.equal(await panel.getByText('Configuration checks passed · adjoint unavailable',{exact:true}).count(),0);
  const steps=panel.getByRole('spinbutton',{name:'Maximum accepted movement steps',exact:true});await steps.fill('0');await steps.press('Enter');
  const alert=panel.getByRole('alert');assert.match(await alert.innerText(),/Change not saved/);assert.ok(await alert.isVisible());
  const rect=await alert.boundingBox(),bounds=await panel.locator('..').boundingBox();assert.ok(rect.y>=bounds.y-1&&rect.y<bounds.y+bounds.height);
  await screenshot(page,'audit-validation-feedback');
});
