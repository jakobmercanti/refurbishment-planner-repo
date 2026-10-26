import assert from 'node:assert/strict';
import test,{before,after} from 'node:test';
import {createHash} from 'node:crypto';
import {cfdProject} from '../climoptixFixtures';
import {cfdWindow,eventually,startBrowserHarness} from './harness.mjs';

let harness;
before(async()=>{harness=await startBrowserHarness({climoptixEnabled:true});});
after(async()=>{await harness?.close();});
const button=(scope,name)=>scope.getByRole('button',{name,exact:true});
const vtk=(offset=0)=>`# vtk DataFile Version 3.0\nprobe plane\nASCII\nDATASET POLYDATA\nPOINTS 4 float\n0 0 0 1 0 0 1 1 0 0 1 0\nPOLYGONS 1 5\n4 0 1 2 3\nPOINT_DATA 4\nSCALARS p float 1\nLOOKUP_TABLE default\n${offset} ${offset+1} ${offset+3} ${offset+2}\nVECTORS U float\n1 0 3 2 0 3 2 2 3 1 2 3\nCELL_DATA 1\nSCALARS q float 1\nLOOKUP_TABLE default\n42\n`;
async function open(t,transport?,inspect=false,options={}){
  const s=await harness.session(cfdProject(false),options);t.after(()=>s.close());
  if(transport)await s.context.route('**/climoptix/worker/**',transport);
  if(inspect)await s.context.addInitScript(()=>{
    window.__pointStores=[];window.__REACT_DEVTOOLS_GLOBAL_HOOK__={supportsFiber:true,inject:()=>1,onCommitFiberUnmount(){},onCommitFiberRoot(_,root){const store=root.containerInfo;if(typeof store?.getState==='function'&&!window.__pointStores.includes(store))window.__pointStores.push(store);}};
    window.__pointScene=()=>window.__pointStores.map(store=>store.getState()).find(s=>s.gl?.domElement?.closest('.cfx-viewport'));
  });
  await s.page.reload();await s.page.getByRole('combobox',{name:'Workspace',exact:true}).selectOption('CLIMOPTIX');
  const ui=s.page.locator('.cfx-workspace');await cfdWindow(ui,'Solver');await eventually(()=>ui.getAttribute('data-preparation-state'),s=>s==='checked');
  return {...s,ui};
}
async function load(ui,name,text){await cfdWindow(ui,'Imported results');await ui.getByLabel('Import result layers',{exact:true}).setInputFiles({name,mimeType:'application/octet-stream',buffer:Buffer.from(text)});const viewer=ui.getByRole('region',{name:'VTK results viewer',exact:true});await viewer.getByRole('status').filter({hasText:/points.*cell/}).waitFor();return viewer;}
const reading=scope=>scope.getByRole('status',{name:'Picked result value',exact:true});
async function clickPlane(page,viewer,dx=0){const canvas=viewer.locator('.cfx-vtk-canvas'),b=await canvas.boundingBox();await page.mouse.click(b.x+b.width/2+dx,b.y+b.height/2);await eventually(()=>reading(viewer).getAttribute('data-probe-value'),value=>value!==null);return read(viewer);}
async function read(scope){const output=reading(scope),text=await output.innerText();return{value:Number(await output.getAttribute('data-probe-value')),position:['X','Y','Z'].map(axis=>Number(text.match(new RegExp(`${axis} ([-+0-9.eE]+)`))[1])),text};}
const linear=result=>assert.ok(Math.abs(result.value-(result.position[0]+2*result.position[1]+3*result.position[2]))<2e-5,JSON.stringify(result));

test('V/button point mode reads scalar, vector and cell data, replaces one readout, ignores drags/typing, and Esc exits without closing results',async t=>{
  const {page,ui,saved}=await open(t,undefined,false,{deviceScaleFactor:2}),before=await saved(),viewer=await load(ui,'probe.vtk',vtk());
  await button(viewer,'View Z').click();await button(viewer,'Fit').click();
  await viewer.locator('.cfx-vtk-canvas').focus();await page.keyboard.press('v');assert.ok(await button(viewer,'Exit point probe (Esc)').isVisible());
  const a=await clickPlane(page,viewer);linear(a);assert.match(a.text,/file units \(unverified\).*Interpolated point data/s);
  const b=await clickPlane(page,viewer,40);linear(b);assert.notEqual(b.value,a.value);assert.equal(await reading(viewer).count(),1);
  const fields=viewer.getByRole('combobox',{name:'VTK result field',exact:true});await fields.selectOption('point:U');assert.equal(await reading(viewer).getAttribute('data-probe-value'),null);
  await viewer.getByLabel('Vector component',{exact:true}).selectOption('0');const x=await clickPlane(page,viewer);assert.ok(Math.abs(x.value-(1+x.position[0]))<2e-5);assert.match(x.text,/U X =/);
  await viewer.getByLabel('Vector component',{exact:true}).selectOption('-1');const magnitude=await clickPlane(page,viewer);assert.ok(Math.abs(magnitude.value-Math.hypot(1+magnitude.position[0],2*magnitude.position[1],3))<2e-5);
  await fields.selectOption('cell:q');const cell=await clickPlane(page,viewer);assert.equal(cell.value,42);assert.match(cell.text,/Stored cell value/);
  const box=await viewer.locator('.cfx-vtk-canvas').boundingBox();await page.mouse.move(box.x+box.width/2,box.y+box.height/2);await page.mouse.down();await page.mouse.move(box.x+box.width/2+50,box.y+box.height/2+30,{steps:10});await page.mouse.up();assert.equal((await read(viewer)).text,cell.text);
  const empty=await viewer.locator('.cfx-vtk-canvas').boundingBox();await page.mouse.click(empty.x+8,empty.y+8);assert.equal(await reading(viewer).getAttribute('data-probe-value'),null);assert.match(await reading(viewer).innerText(),/No point on the active result plane/);await clickPlane(page,viewer);
  if(process.env.BROWSER_ARTIFACTS)await page.screenshot({path:`${process.env.BROWSER_ARTIFACTS}/point-probe-inspector.png`});
  await page.setViewportSize({width:390,height:900});
  await eventually(async()=>({canvas:await viewer.locator('.cfx-vtk-canvas').boundingBox(),output:await reading(viewer).boundingBox()}),({canvas,output})=>canvas&&output&&canvas.height>=140&&canvas.y+canvas.height<=900&&output.y>=0&&output.y+output.height<=900,'The active mobile probe and plane remain onscreen');
  if(process.env.BROWSER_ARTIFACTS)await page.screenshot({path:`${process.env.BROWSER_ARTIFACTS}/point-probe-mobile.png`});
  assert.equal(await viewer.evaluate(node=>getComputedStyle(node).overflowY),'auto');
  const download=button(viewer,'Download full original data');await download.scrollIntoViewIfNeeded();const downloadBox=await download.boundingBox(),inspectorBox=await ui.getByRole('dialog',{name:'Result plane inspector',exact:true}).boundingBox();assert.ok(downloadBox.y>=inspectorBox.y&&downloadBox.y+downloadBox.height<=inspectorBox.y+inspectorBox.height+1,'The active probe must not trap downloads below the mobile viewport');
  await page.keyboard.press('Escape');assert.equal(await reading(viewer).count(),0);assert.ok(await viewer.isVisible());
  await viewer.getByRole('spinbutton',{name:'Legend minimum',exact:true}).focus();await page.keyboard.press('v');assert.equal(await reading(viewer).count(),0);
  await button(viewer,'Probe point value (V)').click();await button(viewer,'Exit point probe (Esc)').click();assert.equal(await reading(viewer).count(),0);
  await button(page,'Hide Result plane inspector').click();await button(ui,'Probe selected plane (V)').click();await button(viewer,'Exit point probe (Esc)').waitFor();await page.keyboard.press('Escape');assert.equal(await reading(viewer).count(),0);
  await button(page,'Hide Result plane inspector').click();await button(ui,'Open plane inspector').click();await button(viewer,'Probe point value (V)').waitFor();assert.equal(await reading(viewer).count(),0);
  await button(page,'Hide Result plane inspector').click();await ui.getByLabel('Move Simulation setup',{exact:true}).focus();await page.keyboard.press('v');await button(viewer,'Exit point probe (Esc)').waitFor();await page.keyboard.press('Escape');assert.equal(await reading(viewer).count(),0);
  const after=await saved();assert.deepEqual(after.rooms,before.rooms);assert.deepEqual(after.cfdScenarios[0].outputs,before.cfdScenarios[0].outputs);
});

test('point probing follows moved volume planes, clears stale/hidden fields, and never reuses a reading from a replacement file',async t=>{
  const {page,ui}=await open(t),values=Array.from({length:27},(_,i)=>i%3+2*(Math.floor(i/3)%3)+3*Math.floor(i/9)).join(' ');
  const text=`<VTKFile type="ImageData" version="0.1" byte_order="LittleEndian"><ImageData WholeExtent="0 2 0 2 0 2" Origin="0 0 0" Spacing="1 1 1"><Piece Extent="0 2 0 2 0 2"><PointData Scalars="CO2"><DataArray type="Float32" Name="CO2" NumberOfComponents="1" format="ascii">${values}</DataArray></PointData><CellData/></Piece></ImageData></VTKFile>`;
  const viewer=await load(ui,'volume.vti',text);await button(viewer,'View Z').click();await button(viewer,'Fit').click();await button(viewer,'Probe point value (V)').click();linear(await clickPlane(page,viewer));
  await viewer.getByText('Planes & passive scalar isosurfaces',{exact:true}).click();await viewer.getByLabel('Slice normal',{exact:true}).selectOption('0');await viewer.getByLabel('Slice grid index',{exact:true}).fill('2');
  assert.equal(await reading(viewer).getAttribute('data-probe-value'),null);await button(viewer,'View X').click();await button(viewer,'Fit').click();const moved=await clickPlane(page,viewer);linear(moved);assert.ok(Math.abs(moved.position[0]-2)<1e-5);
  await viewer.getByRole('combobox',{name:'VTK result field',exact:true}).selectOption('');assert.ok(await button(viewer,'Probe point value (V)').isDisabled());assert.equal(await reading(viewer).count(),0);
  await viewer.getByRole('combobox',{name:'VTK result field',exact:true}).selectOption('point:CO2');
  await ui.getByLabel('Import result layers',{exact:true}).setInputFiles({name:'volume.vti',mimeType:'application/xml',buffer:Buffer.from(text.replace(values,Array(27).fill(100).join(' ')))});
  await viewer.getByRole('status').filter({hasText:/9 points.*4 cells/}).waitFor();await eventually(()=>button(viewer,'Exit point probe (Esc)').isVisible(),Boolean);
  assert.equal(await reading(viewer).getAttribute('data-probe-value'),null);await button(viewer,'View Z').click();await button(viewer,'Fit').click();assert.equal((await clickPlane(page,viewer)).value,100);
  await viewer.getByRole('checkbox',{name:'Show result volume.vti',exact:true}).uncheck();assert.equal(await reading(viewer).count(),0);assert.ok(await button(viewer,'Probe point value (V)').isDisabled());
});

test('verified building planes support V/point readout in native units without editing measured geometry or adding monitoring probes',async t=>{
  let job,sourceHash;
  const namespace='11111111-1111-4111-8111-111111111111',data=Buffer.from(vtk()),artifact={id:'slice-0',name:'probe.vtk',kind:'vtk',size:data.length,sha256:createHash('sha256').update(data).digest('hex')};
  const {page,ui,saved}=await open(t,async route=>{
    const path=new URL(route.request().url()).pathname;
    if(path.endsWith('/capabilities'))return route.fulfill({json:{connected:true,mesh:true,run:true,reason:'Local test fixture',namespace,limits:{cpu:1,memoryGb:4,wallTimeMinutes:15,storageGb:1,retentionDays:3,maxCells:500000,concurrentJobs:1}}});
    if(path.endsWith('/jobs')&&route.request().method()==='POST'){const request=route.request().postDataJSON();sourceHash=request.sourceHash;job={id:'99999999-9999-4999-8999-999999999999',studyId:request.studyId,clientRevision:request.clientRevision,phase:'Completed',progress:100,message:'Retained local fixture'};return route.fulfill({json:job});}
    if(path.endsWith('/jobs'))return route.fulfill({json:job?[job]:[]});
    if(path.endsWith('/logs'))return route.fulfill({json:{...job,cursor:0,nextCursor:0,text:''}});
    if(path.endsWith('/result'))return route.fulfill({json:{jobId:job.id,studyId:job.studyId,clientRevision:job.clientRevision,sourceHash,configurationHash:'b'.repeat(64),pressureUnit:'m2/s2',accepted:true,artifacts:[artifact]}});
    if(path.endsWith('/artifacts/slice-0'))return route.fulfill({body:data});return route.fulfill({json:job});
  },true);
  const before=await saved();await cfdWindow(ui,'Simulations');await button(ui,'Run Office airflow').click();await eventually(()=>!!job,Boolean);await cfdWindow(ui,'Imported results');
  await ui.getByRole('combobox',{name:'View result in 3D',exact:true}).selectOption('slice-0');const inspector=ui.getByRole('dialog',{name:'Result plane inspector',exact:true});await eventually(()=>button(inspector,'Load this plane into building 3D').isEnabled(),Boolean);await button(inspector,'Load this plane into building 3D').click();
  const controls=ui.locator('.floating-toolbar').filter({hasText:'verified worker plane · metres → scene coordinates.'});
  await eventually(()=>button(controls,'Probe point value (V)').isEnabled(),Boolean);
  await controls.getByRole('combobox',{name:'Building result field',exact:true}).selectOption('point:p');
  await page.evaluate(()=>{const s=window.__pointScene();s.controls.target.set(.5,0,-.5);s.camera.position.set(.5,2,1);s.controls.update();s.camera.updateMatrixWorld();s.invalidate();});
  await ui.locator('.cfx-viewport').focus();await page.keyboard.press('v');
  async function pick(x,y){const p=await page.evaluate(({x,y})=>{const s=window.__pointScene(),point=s.camera.position.clone().set(x,0,-y).project(s.camera),b=s.gl.domElement.getBoundingClientRect();return{x:b.x+(point.x+1)*b.width/2,y:b.y+(1-point.y)*b.height/2};},{x,y});await page.mouse.click(p.x,p.y);await eventually(()=>reading(controls).getAttribute('data-probe-value'),v=>v!==null);return read(controls);}
  const first=await pick(.25,.25);assert.ok(Math.abs(first.value-(first.position[0]+2*first.position[1])/1000)<1e-5,JSON.stringify(first));assert.match(first.text,/p = .*m²\/s²/);assert.ok(Math.abs(first.position[0]-250)<10,JSON.stringify(first));assert.match(first.text,/mm/);
  const second=await pick(.75,.25);assert.ok(Math.abs(second.value-(second.position[0]+2*second.position[1])/1000)<1e-5,JSON.stringify(second));assert.notEqual(first.value,second.value);assert.equal(await reading(controls).count(),1);
  await controls.getByRole('combobox',{name:'Building result field',exact:true}).selectOption('point:U');assert.equal(await reading(controls).getAttribute('data-probe-value'),null);const velocity=await pick(.75,.25);assert.ok(Math.abs(velocity.value-Math.hypot(1+velocity.position[0]/1000,2*velocity.position[1]/1000,3))<1e-5,JSON.stringify(velocity));assert.match(velocity.text,/U magnitude = .*m\/s/);
  if(process.env.BROWSER_ARTIFACTS)await page.screenshot({path:`${process.env.BROWSER_ARTIFACTS}/point-probe-building.png`});
  await page.keyboard.press('Escape');assert.equal(await reading(controls).count(),0);assert.equal(await ui.locator('.cfx-setup-window:visible').count(),0);
  const after=await saved();assert.deepEqual(after.rooms,before.rooms);assert.deepEqual(after.cfdScenarios[0].outputs,before.cfdScenarios[0].outputs);
});
