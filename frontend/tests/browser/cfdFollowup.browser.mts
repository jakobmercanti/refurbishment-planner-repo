import assert from 'node:assert/strict';
import test,{before,after} from 'node:test';
import {cfdProject,realPreparation} from '../climoptixFixtures';
import {ventSchema} from '../../lib/climoptixDocument';
import {thermalProject,realThermal} from '../thermalFixtures';
import {thermalGainSchema} from '../../lib/thermalDocument';
import {cfdWindow,eventually,menu,startBrowserHarness} from './harness.mjs';

let harness;
before(async()=>{harness=await startBrowserHarness({climoptixEnabled:true});});
after(async()=>{await harness?.close();});
const button=(scope,name)=>scope.getByRole('button',{name,exact:true});
async function open(t,project=cfdProject(false),inspect=false){
  const s=await harness.session(project);t.after(()=>s.close());
  if(inspect){await s.context.addInitScript(()=>{
    window.__followupStores=[];window.__REACT_DEVTOOLS_GLOBAL_HOOK__={supportsFiber:true,inject:()=>1,onCommitFiberUnmount(){},onCommitFiberRoot(_,root){const store=root.containerInfo;if(typeof store?.getState==='function'&&!window.__followupStores.includes(store))window.__followupStores.push(store);}};
    window.__followupScene=()=>window.__followupStores.map(store=>store.getState()).find(s=>s.gl?.domElement?.closest('.cfx-viewport'));
  });await s.page.reload();}
  await s.page.getByRole('combobox',{name:'Workspace',exact:true}).selectOption('CLIMOPTIX');
  const ui=s.page.locator('.cfx-workspace');await cfdWindow(ui,'Solver');
  await eventually(()=>ui.getAttribute('data-preparation-state'),state=>state==='checked');
  return {...s,ui};
}
const scrolls=control=>control.evaluate(node=>{const values=[];for(let el=node.parentElement;el;el=el.parentElement)values.push({name:el.className,top:el.scrollTop,left:el.scrollLeft});return values;});

test('checkbox changes retain the current nested window scroll position, including delayed preparation updates',async t=>{
  const p=cfdProject(false);p.cfdScenarios[0].outputs.probesMm=Array.from({length:12},(_,i)=>[1000+i*50,1000,1200]);
  const {page,ui}=await open(t,p);await ui.getByRole('tab',{name:'Post-processing',exact:true}).click();
  for(const name of ['YZ slices (normal X)','Velocity U']){
    const control=ui.getByRole('checkbox',{name,exact:true});
    await control.evaluate(node=>node.scrollIntoView({block:'center'}));
    const before=await scrolls(control);assert.ok(before.some(v=>v.top>100),JSON.stringify(before));
    await control.click();await eventually(()=>ui.getAttribute('data-preparation-state'),state=>state==='checked');
    await page.waitForTimeout(250);
    const after=await scrolls(control);assert.deepEqual(after,before);
  }
  const count=ui.getByRole('spinbutton',{name:'X plane count',exact:true});await count.evaluate(n=>n.scrollIntoView({block:'center'}));
  const before=await scrolls(count);await count.fill('11');await count.press('Enter');await page.waitForTimeout(500);assert.deepEqual(await scrolls(count),before);
});

test('the shared scroll fix also covers independent thermal source checkboxes and the Preferences modal',async t=>{
  const p=thermalProject(false);p.cfdScenarios[0].thermalEnvelope.gains=Array.from({length:14},(_,i)=>thermalGainSchema.parse({id:`gain-${i}`,name:`Source ${i}`,roomId:'room-0',powerW:20}));
  const s=await open(t,p);
  await s.context.route('**/climoptix/thermal-*',route=>route.fulfill({json:realThermal(route.request().postDataJSON(),route.request().url().endsWith('thermal-preview'))}));
  await cfdWindow(s.ui,'Boundaries');await s.ui.getByRole('tab',{name:'Thermal',exact:true}).click();
  const thermal=s.ui.getByRole('region',{name:'Thermal envelope setup',exact:true});
  const step=thermal.getByRole('combobox',{name:'Thermal step',exact:true});
  if(await step.isVisible())await step.selectOption('3');else await thermal.getByRole('navigation',{name:'Thermal setup steps',exact:true}).getByRole('button',{name:/Gains & ventilation/}).click();
  const source=thermal.getByRole('checkbox',{name:'Source enabled',exact:true}).last();await source.evaluate(n=>n.scrollIntoView({block:'center'}));
  const before=await thermal.locator('.thermal-scroll').evaluate(n=>n.scrollTop);assert.ok(before>100);
  await source.click();await s.page.waitForTimeout(750);const after=await thermal.locator('.thermal-scroll').evaluate(n=>n.scrollTop);assert.ok(Math.abs(after-before)<120,JSON.stringify({before,after}));
  await button(s.page,'Hide Insulation boundary import & thermal envelope').click();
  await s.page.setViewportSize({width:900,height:600});await menu(s.page,'Settings','Preferences…');
  const preferences=s.page.getByRole('dialog',{name:'Preferences',exact:true}),confirm=preferences.getByRole('checkbox',{name:/Confirm before opening/});
  await confirm.evaluate(n=>n.scrollIntoView({block:'center'}));const initial=await preferences.evaluate(n=>n.scrollTop);
  await confirm.click();assert.equal(await preferences.evaluate(n=>n.scrollTop),initial);
});

test('Preferences dropdowns share the density button column and smaller bold type',async t=>{
  const {page}=await open(t);await menu(page,'Settings','Preferences…');
  const dialog=page.getByRole('dialog',{name:'Preferences',exact:true});
  for(const width of [1440,390]){
    await page.setViewportSize({width,height:1000});
    const column=await button(dialog,'Compact').boundingBox();
    const dropdowns=await dialog.locator('select').evaluateAll(nodes=>nodes.map(node=>{const b=node.getBoundingClientRect(),s=getComputedStyle(node);return{x:b.x,width:b.width,font:parseFloat(s.fontSize),weight:Number(s.fontWeight),radius:s.borderRadius,background:s.backgroundColor,border:s.borderColor};}));
    assert.equal(dropdowns.length,4);
    for(const field of dropdowns){assert.ok(Math.abs(field.x-column.x)<2,JSON.stringify({column,field}));assert.ok(Math.abs(field.width-dropdowns[0].width)<2);assert.equal(field.font,12);assert.ok(field.weight>=600);assert.equal(field.radius,dropdowns[0].radius);assert.equal(field.background,dropdowns[0].background);assert.equal(field.border,dropdowns[0].border);}
    assert.ok(dropdowns[0].width<column.width-30);
    if(process.env.BROWSER_ARTIFACTS)await page.screenshot({path:`${process.env.BROWSER_ARTIFACTS}/followup-preferences-${width}.png`});
  }
});

test('View properties uses two checkbox columns and 2D walls are presentation only',async t=>{
  const {page,ui,saved}=await open(t,cfdProject(false),true);
  // Checked DOM state can precede the IndexedDB save of its validation stamp.
  // Compare the fully saved baseline, keeping the whole-scenario assertion below.
  const before=await eventually(saved,project=>!!project.cfdScenarios[0].validation);
  await cfdWindow(ui,'View properties');
  const controls=ui.getByLabel('CFD view properties',{exact:true});
  const columns=await controls.locator('.cfx-view-checks > label').evaluateAll(nodes=>nodes.map(node=>node.getBoundingClientRect().x));
  assert.equal(columns.length,5);assert.equal(new Set(columns).size,2);
  await controls.getByRole('checkbox',{name:'2D wall outlines',exact:true}).check();
  await eventually(()=>page.evaluate(()=>{const s=window.__followupScene();let count=0;s?.scene.traverse(node=>{if(node.name.startsWith('wall-outline:')&&node.visible)count++;});return count;}),count=>count>0);
  await button(page,'Minimise Simulation setup').click();
  if(process.env.BROWSER_ARTIFACTS)await page.screenshot({path:`${process.env.BROWSER_ARTIFACTS}/followup-wall-outlines.png`});
  await controls.getByRole('checkbox',{name:'2D wall outlines',exact:true}).uncheck();
  await button(page,'Restore Simulation setup').click();
  await eventually(()=>page.evaluate(()=>{const s=window.__followupScene();let count=0;s?.scene.traverse(node=>{if(node.name.startsWith('wall-outline:'))count++;});return count;}),count=>count===0);
  assert.deepEqual((await saved()).rooms,before.rooms);assert.deepEqual((await saved()).cfdScenarios,before.cfdScenarios);
});

test('real pointer drags rehost both inlet and outlet across walls, floor and ceiling without cloning or changing rooms',async t=>{
  const project=cfdProject(false),scenario=project.cfdScenarios[0];
  const report=realPreparation({project,scenario,clientRevision:'a'.repeat(64)});
  const walls=report.patches.filter(p=>p.kind==='wall'&&p.host&&p.roomId==='room-0');
  const wall=walls[0],other=walls.find(p=>Math.abs(p.host.normal.reduce((sum,n,i)=>sum+n*wall.host.normal[i],0))<.1);
  const floor=report.patches.find(p=>p.kind==='floor'&&p.host&&p.roomId===wall.roomId),roof=report.patches.find(p=>p.kind==='ceiling'&&p.host&&p.roomId===wall.roomId);
  assert.ok(other&&floor&&roof);
  scenario.vents=['supply','extract'].map((role,index)=>ventSchema.parse({id:`drag-${role}`,name:`Drag ${role}`,role,widthMm:200,heightMm:200,host:{patchId:wall.id,u:index?.65:.35,v:.5}}));
  const {page,ui,saved}=await open(t,project,true),originalRooms=structuredClone((await saved()).rooms);
  await cfdWindow(ui,'View properties');await ui.getByRole('checkbox',{name:'Ceilings',exact:true}).check();
  await button(page,'Hide View properties').click();await button(page,'Minimise Simulation setup').click();
  const center=(host,u)=>host.originMm.map((p,i)=>p+host.uAxis[i]*host.widthMm*u+host.vAxis[i]*host.heightMm*.5);
  for(const [index,initial] of scenario.vents.entries())for(const target of [other,floor,wall,roof]){
    const vent=(await saved()).cfdScenarios[0].vents.find(v=>v.id===initial.id),source=report.patches.find(p=>p.id===vent.host.patchId);
    const start=center(source.host,vent.host.u),end=center(target.host,index?.65:.35);
    await page.evaluate(({start,end,n1,n2})=>{
      const s=window.__followupScene(),middle=start.map((p,i)=>(p+end[i])/2000),eye=start.map((p,i)=>(p+end[i])/2000+8*(n1[i]+n2[i]));
      s.controls.target.set(middle[0],middle[2],-middle[1]);s.camera.position.set(eye[0],eye[2],-eye[1]);s.controls.update();s.camera.updateProjectionMatrix();s.invalidate();
    },{start,end,n1:source.host.normal,n2:target.host.normal});
    await page.waitForTimeout(300);
    const points=await page.evaluate(({id,end})=>{
      const s=window.__followupScene(),mesh=s.scene.getObjectByName(`vent:${id}`),bounds=s.gl.domElement.getBoundingClientRect();
      mesh.geometry.computeBoundingSphere();const p=mesh.geometry.boundingSphere.center.clone().applyMatrix4(mesh.matrixWorld),q=p.clone().set(end[0]/1000,end[2]/1000,-end[1]/1000);
      return [p,q].map(point=>{point.project(s.camera);return{x:bounds.x+(point.x+1)*bounds.width/2,y:bounds.y+(1-point.y)*bounds.height/2};});
    },{id:vent.id,end});
    await page.mouse.move(points[0].x,points[0].y);await page.mouse.down();await page.mouse.move(points[1].x,points[1].y,{steps:15});await page.mouse.up();
    await eventually(async()=>{const v=(await saved()).cfdScenarios[0].vents.find(v=>v.id===vent.id);return v.host.patchId;},id=>id===target.id,`${vent.role} must rehost to ${target.kind}`);
  }
  const final=await saved();assert.equal(final.cfdScenarios[0].vents.length,2);assert.deepEqual(final.rooms,originalRooms);
  for(const original of scenario.vents){const moved={...final.cfdScenarios[0].vents.find(vent=>vent.id===original.id),host:undefined};assert.deepEqual(moved,{...original,host:undefined},'Rehosting changes only the host coordinates, not flow, thermal or device properties');}
});
