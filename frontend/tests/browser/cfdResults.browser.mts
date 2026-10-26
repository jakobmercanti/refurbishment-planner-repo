import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import test,{before,after} from 'node:test';
import { zipSync,strToU8,unzipSync } from 'fflate';
import { cfdProject } from '../climoptixFixtures';
import { duplicateCFDScenario } from '../../lib/climoptixDocument';
import { archiveEntries,archiveFile } from '../../lib/cfdArchive';
import { checkVTKText } from '../../lib/climoptixVTK';
import { cfdWindow,eventually,startBrowserHarness } from './harness.mjs';

let harness;
before(async()=>{harness=await startBrowserHarness({climoptixEnabled:true});});
after(async()=>{await harness?.close();});
const button=(scope,name)=>scope.getByRole('button',{name,exact:true});
async function open(t,project=cfdProject(false),transport?) {
  const s=await harness.session(project);t.after(()=>s.close());
  if(transport)await s.context.route('**/climoptix/worker/**',transport);
  await s.context.addInitScript(()=>{
    window.__resultStores=[];
    window.__REACT_DEVTOOLS_GLOBAL_HOOK__={supportsFiber:true,inject:()=>1,onCommitFiberUnmount(){},onCommitFiberRoot(_,root){const store=root.containerInfo;if(typeof store?.getState==='function'&&!window.__resultStores.includes(store))window.__resultStores.push(store);}};
    window.__resultScene=()=>window.__resultStores.map(store=>store.getState()).find(s=>s.gl?.domElement?.closest('.cfx-viewport'));
  });
  await s.page.reload();
  await s.page.getByRole('combobox',{name:'Workspace',exact:true}).selectOption('CLIMOPTIX');
  const ui=s.page.getByRole('region',{name:'Climoptix CFD workspace',exact:true});await cfdWindow(ui,'Simulations');
  return {...s,ui};
}
test('Clear all removes simulation folders, persists an empty workbench, and Restore default creates exactly one ready group/case',async t=>{
  const p=cfdProject(false),first=p.cfdScenarios[0],second=duplicateCFDScenario(first);second.group='Alternative';p.cfdScenarios.push(second);p.cfdSimulationGroups=[{id:'general',name:'General'},{id:'other',name:'Alternative'},{id:'empty',name:'Empty folder'}];
  const {page,ui,saved}=await open(t,p),rooms=structuredClone((await saved()).rooms);
  assert.equal(await ui.getByRole('progressbar').count(),2);
  for (const bar of await ui.getByRole('progressbar').all()) { assert.equal(await bar.getAttribute('aria-valuenow'),'0');assert.ok(await bar.isVisible()); }
  await button(ui,'Clear all').click();await button(page.getByRole('dialog',{name:'Clear all simulations',exact:true}),'Delete all simulations').click();
  await eventually(saved,p=>p.cfdScenarios.length===0&&p.cfdSimulationGroups.length===0);
  assert.equal(await ui.getByRole('region',{name:/Simulation group/}).count(),0);
  await button(ui,'Add group').click();
  await eventually(saved,p=>p.cfdScenarios.length===0&&p.cfdSimulationGroups.length===1);
  assert.ok(await button(ui,'Clear all').isEnabled(),'Empty groups alone must remain clearable');
  await button(ui,'Clear all').click();await button(page.getByRole('dialog',{name:'Clear all simulations',exact:true}),'Delete all simulations').click();
  await eventually(saved,p=>p.cfdScenarios.length===0&&p.cfdSimulationGroups.length===0);
  await page.reload();await page.getByRole('combobox',{name:'Workspace',exact:true}).selectOption('CLIMOPTIX');await cfdWindow(ui,'Simulations');
  assert.equal(await ui.getByRole('region',{name:/Simulation group/}).count(),0);assert.ok(await button(ui,'Restore default').isEnabled());
  await button(ui,'Restore default').click();await button(page.getByRole('dialog',{name:'Restore the default workbench?',exact:true}),'Restore default').click();
  const restored=await eventually(saved,p=>p.cfdScenarios.length===1&&p.cfdScenarios[0].validation?.errors===0);
  assert.equal(restored.cfdSimulationGroups.length,1);assert.equal(restored.cfdSimulationGroups[0].name,'General');
  assert.equal(restored.cfdScenarios[0].vents.length,2);assert.equal(restored.cfdScenarios[0].resources.cpu,1);assert.ok(restored.cfdScenarios[0].mesh.maxCells<=500000);assert.deepEqual(restored.rooms,rooms);
  const select=ui.getByRole('combobox',{name:'CFD scenario',exact:true});
  const spacing=await select.evaluate(n=>{const r=n.getBoundingClientRect(),p=n.closest('.floating-toolbar-titlebar').getBoundingClientRect();return {top:r.top-p.top,bottom:p.bottom-r.bottom,height:r.height};});
  assert.ok(Math.abs(spacing.top-spacing.bottom)<2,JSON.stringify(spacing));assert.ok(spacing.height<=36);
  await cfdWindow(ui,'Equipment');const equipment=ui.getByRole('region',{name:'Equipment settings',exact:true});await button(equipment,'Clear all').click();await button(page.getByRole('dialog',{name:'Clear all CFD objects?',exact:true}),'Clear all').click();
  await eventually(saved,p=>!p.cfdScenarios[0].vents.length&&!p.cfdScenarios[0].objectGroups.length);assert.equal(await ui.getByRole('region',{name:/Object group/}).count(),0);
  await cfdWindow(ui,'Boundaries');await button(ui.getByRole('region',{name:'Boundaries settings',exact:true}),'Clear all').click();await button(page.getByRole('dialog',{name:'Clear all boundary customizations?',exact:true}),'Clear all').click();
  await eventually(saved,p=>p.cfdScenarios[0].boundaries.hideDefaultGroup);assert.equal(await ui.getByRole('region',{name:/Boundary group /}).count(),0);
  assert.ok(await ui.getByText(/Ungrouped building surfaces/).isVisible());
});

const namespace='11111111-1111-4111-8111-111111111111',jobId='99999999-9999-4999-8999-999999999999';
const caps={connected:true,mesh:true,run:true,reason:'Measured fixture',namespace,limits:{cpu:1,memoryGb:4,wallTimeMinutes:15,storageGb:1,retentionDays:3,maxCells:500000,concurrentJobs:1}};
const vtk=(name='plane')=>`# vtk DataFile Version 3.0\n${name}\nASCII\nDATASET POLYDATA\nPOINTS 4 float\n0 0 0 1 0 0 1 1 0 0 1 0\nPOLYGONS 1 5\n4 0 1 2 3\nPOINT_DATA 4\nSCALARS p float 1\nLOOKUP_TABLE default\n0 1 2 3\nVECTORS U float\n1 0 0 2 0 0 3 0 0 4 0 0\n`;
const digest=(bytes:Uint8Array)=>createHash('sha256').update(bytes).digest('hex');
test('real result folder, old-worker post-processing download, selectable residuals and multi-plane display are connected',async t=>{
  let job,sourceHash,submits=0;
  const a=strToU8(vtk('xy')),b=strToU8(vtk('xz'));
  const zip=zipSync({'system/controlDict':strToU8('endTime 2000;'),'0/U':strToU8('native field'),'postProcessing/slices/20/xy.vtk':a,'postProcessing/slices/20/xz.vtk':b,'postProcessing/probes/0/U':strToU8('probe values')});
  const artifacts=[{id:'native-case',kind:'zip',size:zip.length,sha256:digest(zip)},{id:'slice-0',name:'xy.vtk',kind:'vtk',size:a.length,sha256:digest(a)},{id:'slice-1',name:'xz.vtk',kind:'vtk',size:b.length,sha256:digest(b)}];
  const transport=async route=>{
    const path=new URL(route.request().url()).pathname;
    if(path.endsWith('/capabilities'))return route.fulfill({json:caps});
    if(path.endsWith('/jobs')&&route.request().method()==='POST'){const request=route.request().postDataJSON();sourceHash=request.sourceHash;submits++;job={id:jobId,studyId:request.studyId,clientRevision:request.clientRevision,phase:'Completed',progress:100,message:'Native run complete',operation:'run'};return route.fulfill({json:job});}
    if(path.endsWith('/jobs'))return route.fulfill({json:job?[job]:[]});
    if(path.endsWith('/result'))return route.fulfill({json:{jobId,studyId:job.studyId,clientRevision:job.clientRevision,sourceHash,configurationHash:'b'.repeat(64),pressureUnit:'m2/s2',accepted:true,artifacts}});
    if(path.endsWith('/logs')){const cursor=Number(new URL(route.request().url()).searchParams.get('cursor')),text='Time = 1\nSolving for Ux, Initial residual = .1, Final residual = .01\nSolving for p, Initial residual = .2, Final residual = .02\nSolving for p, Initial residual = .002, Final residual = .0002\nTime = 2\nSolving for Ux, Initial residual = .05, Final residual = .005\nSolving for p, Initial residual = .1, Final residual = .01\n';return route.fulfill({json:{...job,cursor,nextCursor:Buffer.byteLength(text),text:cursor?'':text}});}
    if(path.endsWith('/artifacts/native-case'))return route.fulfill({body:Buffer.from(zip)});
    if(path.endsWith('/artifacts/slice-0'))return route.fulfill({body:Buffer.from(a)});
    if(path.endsWith('/artifacts/slice-1'))return route.fulfill({body:Buffer.from(b)});
    return route.fulfill({json:job});
  };
  const {page,ui}=await open(t,cfdProject(false),transport);
  await page.evaluate(()=>window.dispatchEvent(new Event('focus')));
  const run=button(ui,'Run Office airflow');await eventually(()=>run.isEnabled(),Boolean);await run.click();await eventually(()=>!!job,Boolean);
  const progress=ui.getByRole('progressbar',{name:'Office airflow phase progress',exact:true});await eventually(()=>progress.getAttribute('aria-valuenow'),value=>value==='100');assert.match(await progress.innerText(),/Completed · 100%/);
  await cfdWindow(ui,'Convergence monitor');await ui.getByRole('img',{name:'Residual graph for Ux',exact:true}).waitFor();
  const graphs=ui.locator('.cfx-residual-grid svg');assert.equal(await graphs.count(),2);const rects=await graphs.evaluateAll(nodes=>nodes.map(n=>n.getBoundingClientRect().x));assert.ok(rects[1]>rects[0]);
  await ui.getByRole('combobox',{name:'Residuals to display',exact:true}).selectOption('Ux');assert.ok(await ui.getByRole('img',{name:'Residual graph for p',exact:true}).isVisible());assert.equal(await graphs.count(),1);
  await cfdWindow(ui,'Imported results');await button(ui,'Open online results folder').click();const folder=ui.getByRole('region',{name:'Private simulation files',exact:true});await folder.waitFor();
  await folder.getByRole('row',{name:'Folder system',exact:true}).dblclick();const downloaded=page.waitForEvent('download');await button(folder,'Download controlDict').click();assert.match((await downloaded).suggestedFilename(),/controlDict/);await button(folder,'Close folder').click();
  const post=page.waitForEvent('download');await ui.getByRole('combobox',{name:'Download simulation data',exact:true}).selectOption('postprocessing');const postBytes=await readFile(await (await post).path());assert.ok(Object.keys(unzipSync(postBytes)).includes('postProcessing/probes/0/U'));
  await ui.getByRole('combobox',{name:'View result in 3D',exact:true}).selectOption('slice-0');await ui.getByRole('region',{name:'VTK results viewer',exact:true}).getByRole('status').filter({hasText:/4 points.*1 cell/}).waitFor();
  await ui.getByRole('combobox',{name:'Plane to inspect',exact:true}).selectOption('artifact:slice-1');const viewer=ui.getByRole('region',{name:'VTK results viewer',exact:true});await eventually(()=>viewer.getByRole('combobox',{name:'Active result layer',exact:true}).locator('option').count(),n=>n===2);
  await viewer.getByRole('combobox',{name:'Active result layer',exact:true}).selectOption('1');await viewer.getByRole('combobox',{name:'VTK result field',exact:true}).selectOption('point:U');
  await viewer.getByLabel('Vector component',{exact:true}).selectOption('0');await viewer.getByLabel('Colour legend',{exact:true}).selectOption('viridis');
  const maximum=viewer.getByRole('spinbutton',{name:'Legend maximum',exact:true});await maximum.fill('5');await maximum.press('Enter');await viewer.getByRole('checkbox',{name:'Show result xy.vtk',exact:true}).uncheck();
  const canvas=await viewer.locator('.cfx-vtk-canvas').boundingBox(),controls=await viewer.locator('.cfx-results-sidebar').boundingBox();
  assert.ok(canvas.x>controls.x+controls.width-1&&canvas.width>400,'The main 3D scene stays alongside its bounded inspector');
  await viewer.getByText('Building & object visibility',{exact:true}).click();
  const overlays=viewer.locator('details').filter({hasText:'Building & object visibility'});
  await overlays.getByRole('checkbox').first().check();await overlays.getByRole('checkbox').first().uncheck();
  assert.equal(submits,1);assert.equal(await ui.getByRole('alert').count(),0);
  if(process.env.BROWSER_ARTIFACTS)await page.screenshot({path:`${process.env.BROWSER_ARTIFACTS}/results-folder-and-planes.png`});
  await button(ui.getByRole('dialog',{name:'Result plane inspector',exact:true}),'Load this plane into building 3D').click();
  await eventually(()=>page.evaluate(()=>{const mesh=window.__resultScene()?.scene.getObjectByName('verified-cfd-result');return mesh?Array.from(mesh.geometry.attributes.position.array):null;}),values=>values?.length===18,'A verified real polygon is triangulated into the measured building scene');
  await ui.getByRole('combobox',{name:'Building result field',exact:true}).selectOption('point:U');
  await ui.getByRole('checkbox',{name:'Show result plane',exact:true}).uncheck();
  await eventually(()=>page.evaluate(()=>!!window.__resultScene()?.scene.getObjectByName('verified-cfd-result')),value=>!value);
  await ui.getByRole('checkbox',{name:'Show result plane',exact:true}).check();
  await eventually(()=>page.evaluate(()=>!!window.__resultScene()?.scene.getObjectByName('verified-cfd-result')),Boolean);
});

test('residual dropdown selects multiple full-history graphs with a four-field two-by-two default',async t=>{
  const {page,ui}=await open(t);await cfdWindow(ui,'Convergence monitor');
  const text=Array.from({length:150},(_,i)=>`Time = ${i+1}\n`+["Ux","Uy","Uz","p"].map(field=>`Solving for ${field}, Initial residual = ${.1/(i+1)}, Final residual = ${.01/(i+1)}\n`).join('')).join('');
  await ui.getByLabel('Import solver log',{exact:true}).setInputFiles({name:'four-fields.log',mimeType:'text/plain',buffer:Buffer.from(text)});
  const figures=ui.locator('.cfx-residual-grid figure');await eventually(()=>figures.count(),n=>n===4);
  const boxes=await figures.evaluateAll(nodes=>nodes.map(n=>({x:n.getBoundingClientRect().x,y:n.getBoundingClientRect().y})));
  assert.ok(boxes[0].y===boxes[1].y&&boxes[2].y===boxes[3].y&&boxes[1].x>boxes[0].x&&boxes[2].y>boxes[0].y,JSON.stringify(boxes));
  for(const graph of await ui.locator('.cfx-residual-grid svg').all())assert.match(await graph.textContent(),/150 iterations/);
  const select=ui.getByRole('combobox',{name:'Residuals to display',exact:true});await select.selectOption('Uy');assert.equal(await figures.count(),3);
  await select.selectOption('Uy');assert.equal(await figures.count(),4);
  await ui.getByRole('combobox',{name:'Residual measure',exact:true}).selectOption('final');assert.equal(await ui.getByRole('img',{name:/Final residual graph/}).count(),4);
  if(process.env.BROWSER_ARTIFACTS)await page.screenshot({path:`${process.env.BROWSER_ARTIFACTS}/residuals-four-graphs.png`});
});

test('structured scalar volumes show real movable slices and computed isosurfaces, without modifying a study',async t=>{
  const {page,ui,saved}=await open(t),before=JSON.stringify((await saved()).cfdScenarios[0]);await cfdWindow(ui,'Imported results');
  const scalar=Array.from({length:27},(_,i)=>i%3).join(' ');
  const text=`<VTKFile type="ImageData" version="0.1" byte_order="LittleEndian"><ImageData WholeExtent="0 2 0 2 0 2" Origin="0 0 0" Spacing="1 1 1"><Piece Extent="0 2 0 2 0 2"><PointData Scalars="CO2"><DataArray type="Float32" Name="CO2" NumberOfComponents="1" format="ascii">${scalar}</DataArray></PointData><CellData/></Piece></ImageData></VTKFile>`;
  await ui.getByLabel('Import result layers',{exact:true}).setInputFiles({name:'passive-scalar.vti',mimeType:'application/xml',buffer:Buffer.from(text)});
  const viewer=ui.getByRole('region',{name:'VTK results viewer',exact:true});await viewer.getByRole('status').filter({hasText:/9 points.*4 cells/}).waitFor();
  await viewer.getByText('Planes & passive scalar isosurfaces',{exact:true}).click();
  await viewer.getByLabel('Slice normal',{exact:true}).selectOption('0');await viewer.getByLabel('Slice grid index',{exact:true}).fill('2');
  await viewer.getByLabel('Volume display',{exact:true}).selectOption('iso');
  const iso=viewer.getByRole('spinbutton',{name:'Scalar isovalue (file units)',exact:true});await iso.fill('.75');await iso.press('Enter');
  await viewer.getByRole('status').filter({hasText:/9 points.*8 cells/}).waitFor();assert.equal(await viewer.getByRole('alert').count(),0);
  await viewer.locator('.cfx-vtk-canvas').scrollIntoViewIfNeeded();
  if(process.env.BROWSER_ARTIFACTS)await page.screenshot({path:`${process.env.BROWSER_ARTIFACTS}/results-scalar-isosurface.png`});
  await page.setViewportSize({width:390,height:900});assert.ok(await ui.locator('.cfx-setup-window').evaluate(n=>n.scrollWidth<=n.clientWidth+2));
  await eventually(async()=>({canvas:await viewer.locator('.cfx-vtk-canvas').boundingBox(),panel:await ui.getByRole('dialog',{name:'Result plane inspector',exact:true}).boundingBox()}),
    ({canvas,panel})=>canvas&&panel&&canvas.height>=140&&canvas.width>200&&canvas.y>=panel.y&&canvas.y+canvas.height<=panel.y+panel.height+1&&panel.y+panel.height<=901,
    'The independent mobile inspector keeps a real usable 3D viewport onscreen');
  if(process.env.BROWSER_ARTIFACTS)await page.screenshot({path:`${process.env.BROWSER_ARTIFACTS}/results-scalar-isosurface-mobile.png`});
  const after=(await saved()).cfdScenarios[0];const original=JSON.parse(before);delete after.validation;delete original.validation;assert.deepEqual(after,original);
});

test('the retained real native planes render as imported data without claiming a new solve',{skip:!process.env.CFD_NATIVE_ARCHIVE_PATH},async t=>{
  const bytes=new Uint8Array(await readFile(process.env.CFD_NATIVE_ARCHIVE_PATH!));
  const entries=archiveEntries(bytes).filter(entry=>entry.name.startsWith('postProcessing/')&&entry.name.endsWith('.vtk'));
  const time=(name:string)=>Number(name.split('/').at(-2));const latest=Math.max(...entries.map(entry=>time(entry.name)));
  const selected=entries.filter(entry=>time(entry.name)===latest).slice(0,3);assert.ok(selected.length>0);
  const {page,ui}=await open(t);await cfdWindow(ui,'Imported results');
  const files=await Promise.all(selected.map(async entry=>{const file=archiveFile(bytes,entry.name),text=await file.text();checkVTKText(text,false);return {name:file.name,mimeType:'application/octet-stream',buffer:Buffer.from(text)};}));
  await ui.getByLabel('Import result layers',{exact:true}).setInputFiles(files);
  const viewer=ui.getByRole('region',{name:'VTK results viewer',exact:true});await viewer.getByRole('status').filter({hasText:/\d[\d,]* points.*\d[\d,]* cells/}).waitFor();
  const fields=await viewer.getByRole('combobox',{name:'VTK result field',exact:true}).locator('option').allTextContents();
  assert.ok(fields.some(field=>/\bp\b/.test(field)));assert.ok(fields.some(field=>/\bU\b/.test(field)));
  assert.match(await viewer.locator('.cfx-stale').innerText(),/External/);assert.equal(await viewer.getByRole('alert').count(),0);
  await viewer.locator('.cfx-vtk-canvas').scrollIntoViewIfNeeded();
  if(process.env.BROWSER_ARTIFACTS)await page.screenshot({path:`${process.env.BROWSER_ARTIFACTS}/results-retained-native-planes.png`});
});

test('Monitor result dropdown opens real FIELD planes from a recovered older job in the 3D Results view',{skip:!process.env.CFD_NATIVE_ARCHIVE_PATH},async t=>{
  const bytes=new Uint8Array(await readFile(process.env.CFD_NATIVE_ARCHIVE_PATH!));
  const entries=archiveEntries(bytes).filter(entry=>entry.name.startsWith('postProcessing/')&&entry.name.endsWith('.vtk'));
  const time=(name:string)=>Number(name.split('/').at(-2)),latest=Math.max(...entries.map(entry=>time(entry.name)));
  const planes=await Promise.all(entries.filter(entry=>time(entry.name)===latest).slice(0,3).map(async entry=>new Uint8Array(await archiveFile(bytes,entry.name).arrayBuffer())));
  assert.equal(planes.length,3);
  const measured=JSON.parse(await archiveFile(bytes,'result.json').text()),project=cfdProject(false);
  const job={id:jobId,studyId:project.cfdScenarios[0].id,clientRevision:'c'.repeat(64),phase:'Completed',progress:100,message:'Native solve converged'};
  const artifacts=[{id:'native-case',kind:'zip',size:bytes.length,sha256:digest(bytes)},...planes.map((data,index)=>({id:`slice-${index}`,kind:'vtk',size:data.length,sha256:digest(data)}))];
  let submits=0;
  const {page,ui}=await open(t,project,async route=>{
    const path=new URL(route.request().url()).pathname;
    if(path.endsWith('/capabilities'))return route.fulfill({json:caps});
    if(route.request().method()==='POST'){submits++;return route.fulfill({status:400,json:{detail:'Read-only recovery test'}});}
    if(path.endsWith('/jobs'))return route.fulfill({json:[job]});
    if(path.endsWith('/logs'))return route.fulfill({json:{...job,cursor:0,nextCursor:0,text:''}});
    if(path.endsWith('/result'))return route.fulfill({json:{jobId,studyId:job.studyId,clientRevision:job.clientRevision,sourceHash:'a'.repeat(64),configurationHash:'b'.repeat(64),pressureUnit:'m2/s2',accepted:true,artifacts,
      mesh:measured.mesh,convergence:measured.convergence,conservation:measured.conservation}});
    if(path.endsWith('/artifacts/native-case'))return route.fulfill({body:Buffer.from(bytes)});
    const slice=path.match(/\/artifacts\/slice-(\d+)$/);if(slice)return route.fulfill({body:Buffer.from(planes[Number(slice[1])])});
    return route.fulfill({json:job});
  });
  await page.evaluate(()=>window.dispatchEvent(new Event('focus')));
  await ui.locator('.cfx-study-row .cfx-job-progress').filter({hasText:'Completed'}).waitFor();
  await cfdWindow(ui,'Convergence monitor');
  const menu=ui.getByRole('combobox',{name:'View result in 3D',exact:true});await menu.waitFor();
  assert.equal(await ui.getByRole('button',{name:/^(View slice-|Download native-case)/}).count(),0);
  await menu.selectOption('slice-1');
  const viewer=ui.getByRole('region',{name:'VTK results viewer',exact:true});
  await viewer.getByRole('status').filter({hasText:/1,?645 points.*\d[\d,]* cells/}).waitFor();
  await eventually(async()=>({canvas:await viewer.locator('.cfx-vtk-canvas').boundingBox(),windowBox:await ui.getByRole('dialog',{name:'Result plane inspector',exact:true}).boundingBox()}),
    ({canvas,windowBox})=>canvas.width>300&&canvas.height>=280&&canvas.y>=windowBox.y&&canvas.y+canvas.height<=windowBox.y+windowBox.height+2,
    'Opening a plane brings the complete 3D scene into the visible window');
  assert.match(await viewer.locator('.cfx-stale').innerText(),/Authenticated worker job.*older setup/);
  const fields=viewer.getByRole('combobox',{name:'VTK result field',exact:true});
  const options=await fields.locator('option').evaluateAll(nodes=>nodes.map(n=>({value:n.value,label:n.textContent})));
  assert.ok(options.some(option=>/^p ·/.test(option.label)));const velocity=options.find(option=>/^U ·/.test(option.label));assert.ok(velocity);
  await fields.selectOption(velocity.value);
  await viewer.getByRole('button',{name:'Fit',exact:true}).click();
  await viewer.locator('.cfx-vtk-canvas').scrollIntoViewIfNeeded();
  assert.equal(await ui.getByRole('alert').count(),0);assert.equal(submits,0);
  if(process.env.BROWSER_ARTIFACTS)await page.screenshot({path:`${process.env.BROWSER_ARTIFACTS}/monitor-native-dropdown-to-3d.png`});
});

test('oversized or entity-bearing volume imports fail before allocation and remain removable',async t=>{
  const {page,ui}=await open(t);await cfdWindow(ui,'Imported results');
  const bad='<VTKFile type="ImageData"><ImageData WholeExtent="0 999999 0 999999 0 999999"><Piece Extent="0 999999 0 999999 0 999999"><PointData/></Piece></ImageData></VTKFile>';
  await ui.getByLabel('Import result layers',{exact:true}).setInputFiles({name:'oversized.vti',mimeType:'application/xml',buffer:Buffer.from(bad)});
  await ui.getByRole('alert').filter({hasText:/250,000/}).waitFor();await button(page,'Hide Result plane inspector').click();await ui.getByText('3D result layers · 1 loaded',{exact:true}).click();
  await button(ui,'Remove layer oversized.vti').click();await ui.getByLabel('Import result layers',{exact:true}).setInputFiles({name:'entities.vti',mimeType:'application/xml',buffer:Buffer.from('<!DOCTYPE VTKFile [<!ENTITY x SYSTEM "file:///private">]><VTKFile type="ImageData">&x;</VTKFile>')});
  await ui.getByRole('alert').filter({hasText:/uncompressed ASCII/}).waitFor();
});
