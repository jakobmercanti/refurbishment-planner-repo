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
  const zip=zipSync({'system/controlDict':strToU8('endTime 2000;'),'0/U':strToU8('native field'),'postProcessing/slices/20/xy.vtk':a,'postProcessing/slices/20/xz.vtk':b,'postProcessing/probes/0/U':strToU8('probe values'),...Object.fromEntries(Array.from({length:101},(_,i)=>[`root-${i}.txt`,strToU8('native archive file')]))});
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
  await button(folder,'Next files').click();await folder.getByText('Page 2 of 2',{exact:true}).waitFor();await button(folder,'Close folder').click();
  await button(ui,'Open online results folder').click();await folder.getByText('Page 1 of 2',{exact:true}).waitFor();assert.ok(await button(folder,'Download root-0.txt').isVisible());
  await folder.getByRole('row',{name:'Folder system',exact:true}).dblclick();const downloaded=page.waitForEvent('download');await button(folder,'Download controlDict').click();assert.match((await downloaded).suggestedFilename(),/controlDict/);await button(folder,'Close folder').click();
  const post=page.waitForEvent('download');await ui.getByRole('combobox',{name:'Download simulation data',exact:true}).selectOption('postprocessing');const postBytes=await readFile(await (await post).path());assert.ok(Object.keys(unzipSync(postBytes)).includes('postProcessing/probes/0/U'));
  await ui.getByRole('combobox',{name:'View result in 3D',exact:true}).selectOption('slice-0');await ui.getByRole('region',{name:'VTK results viewer',exact:true}).getByRole('status').filter({hasText:/4 points.*1 cell/}).waitFor();
  await ui.getByRole('combobox',{name:'Plane to inspect',exact:true}).selectOption('artifact:slice-1');const viewer=ui.getByRole('region',{name:'VTK results viewer',exact:true});await eventually(()=>viewer.getByRole('checkbox',{name:/^Show result /}).count(),n=>n===2);
  await viewer.getByRole('combobox',{name:'VTK result field',exact:true}).selectOption('point:U');
  await viewer.getByLabel('Vector component',{exact:true}).selectOption('0');await viewer.getByLabel('Colour legend',{exact:true}).selectOption('viridis');
  const maximum=viewer.getByRole('spinbutton',{name:'Legend maximum',exact:true});await maximum.fill('5');await maximum.press('Enter');await viewer.getByRole('checkbox',{name:'Show result xy.vtk',exact:true}).uncheck();
  const canvas=await viewer.locator('.cfx-vtk-canvas').boundingBox(),controls=await viewer.locator('.cfx-results-controls').boundingBox();
  assert.ok(controls.y>=canvas.y+canvas.height-1&&canvas.width>400,'The data canvas stays above its full-width controls');
  await viewer.getByText('Building & object visibility',{exact:true}).click();
  const overlays=viewer.locator('details').filter({hasText:'Building & object visibility'});
  await overlays.getByRole('checkbox').first().check();await overlays.getByRole('checkbox').first().uncheck();
  assert.equal(submits,1);assert.equal(await ui.getByRole('alert').count(),0);
  if(process.env.BROWSER_ARTIFACTS)await page.screenshot({path:`${process.env.BROWSER_ARTIFACTS}/results-folder-and-planes.png`});
  await button(ui,'Load selected plane into building 3D').click();
  await eventually(()=>page.evaluate(()=>{const mesh=window.__resultScene()?.scene.getObjectByName('verified-cfd-result');return mesh?Array.from(mesh.geometry.attributes.position.array):null;}),values=>values?.length===18,'A verified real polygon is triangulated into the measured building scene');
  await ui.getByRole('combobox',{name:'Building result field',exact:true}).selectOption('point:U');
  await ui.getByRole('checkbox',{name:'Show result plane',exact:true}).uncheck();
  await eventually(()=>page.evaluate(()=>!!window.__resultScene()?.scene.getObjectByName('verified-cfd-result')),value=>!value);
  await ui.getByRole('checkbox',{name:'Show result plane',exact:true}).check();
  await eventually(()=>page.evaluate(()=>!!window.__resultScene()?.scene.getObjectByName('verified-cfd-result')),Boolean);
  await cfdWindow(ui,'Imported results');await ui.getByRole('combobox',{name:'Plane to inspect',exact:true}).selectOption('xy.vtk');
  await button(ui,'Load selected plane into building 3D').click();
  await eventually(()=>page.evaluate(()=>{let count=0;window.__resultScene()?.scene.traverse(node=>{if(node.name==='verified-cfd-result')count++;});return count;}),n=>n===2);
  const building=ui.getByRole('combobox',{name:'Building 3D plane',exact:true});assert.equal(await building.locator('option').count(),2);
  await button(ui,'Unload selected plane').click();await eventually(()=>building.locator('option').count(),n=>n===1);
  await cfdWindow(ui,'Imported results');await ui.getByText('Planes loaded in building 3D · 1',{exact:true}).click();assert.equal(await ui.getByRole('combobox',{name:'Planes loaded in building 3D',exact:true}).locator('option').count(),2);
  await button(ui,'Unload all 3D planes').click();
  await eventually(()=>page.evaluate(()=>{let count=0;window.__resultScene()?.scene.traverse(node=>{if(node.name==='verified-cfd-result')count++;});return count;}),n=>n===0);
});

test('current simulation owns both result tabs; legacy slice 404 uses verified native planes and no stale run selector',async t=>{
  const project=cfdProject(false),first=project.cfdScenarios[0],second=duplicateCFDScenario(first);second.name='Second simulation';project.cfdScenarios.push(second);
  const secondId='88888888-8888-4888-8888-888888888888',requested:string[]=[];
  const jobs=[first,second].map((s,i)=>({id:i?secondId:jobId,studyId:s.id,clientRevision:'c'.repeat(64),phase:'Completed',progress:100,message:'Completed fixture',operation:'run'}));
  const data=strToU8(vtk()),artifact={id:'slice-0',name:'native-plane.vtk',kind:'vtk',size:data.length,sha256:digest(data)};
  const {page,ui}=await open(t,project,async route=>{
    const path=new URL(route.request().url()).pathname;
    if(path.endsWith('/capabilities'))return route.fulfill({json:caps});
    if(path.endsWith('/jobs'))return route.fulfill({json:jobs});
    const job=jobs.find(j=>path.includes(j.id));
    if(path.endsWith('/logs'))return route.fulfill({json:{...job,cursor:0,nextCursor:0,text:''}});
    if(path.endsWith('/slices')){requested.push(job!.id);return route.fulfill({status:404,json:{detail:'Not Found'}});}
    if(path.endsWith('/result'))return route.fulfill({json:{jobId:job!.id,studyId:job!.studyId,clientRevision:job!.clientRevision,sourceHash:'a'.repeat(64),configurationHash:'b'.repeat(64),pressureUnit:'m2/s2',accepted:true,artifacts:[artifact]}});
    if(path.includes('/artifacts/'))return route.fulfill({body:Buffer.from(data)});
    return route.fulfill({json:job});
  });
  await cfdWindow(ui,'Imported results');const viewer=ui.getByRole('region',{name:'VTK results viewer',exact:true});await viewer.getByRole('status').filter({hasText:/4 points.*1 cell/}).waitFor();
  assert.equal(await ui.getByRole('dialog',{name:'Result plane inspector',exact:true}).count(),0);
  const actions=await ui.locator('.cfx-result-open-actions > button').evaluateAll(nodes=>nodes.map(n=>{const b=n.getBoundingClientRect();return{x:b.x,y:b.y,w:b.width};}));
  assert.equal(actions.length,4);assert.equal(actions[0].y,actions[1].y);assert.equal(actions[2].y,actions[3].y);assert.ok(actions[2].y>actions[0].y);assert.ok(Math.max(...actions.map(a=>a.w))-Math.min(...actions.map(a=>a.w))<1);
  await button(ui,'Collapse all').click();assert.equal(await ui.locator('.cfx-results details[open]').count(),0);await button(ui,'Expand all').click();assert.equal(await ui.locator('.cfx-results details:not([open]):not(.cfx-row-menu)').count(),0);
  const tabs=ui.getByRole('tablist',{name:'Results views',exact:true});await tabs.getByRole('tab',{name:'Summary & 3D',exact:true}).focus();await page.keyboard.press('ArrowRight');
  const slices=ui.getByRole('region',{name:'2D CFD slice results',exact:true});await slices.getByText(/This service has no indexed slice API/).waitFor();await viewer.getByLabel('Interactive VTK 2D field',{exact:true}).waitFor();
  assert.equal(await slices.getByRole('combobox',{name:'Slice run',exact:true}).count(),0);assert.deepEqual([...new Set(requested)],[jobId]);assert.equal(await slices.getByRole('alert').count(),0);
  await button(viewer,'Probe point value (V)').click();await viewer.locator('.cfx-vtk-canvas').scrollIntoViewIfNeeded();const b=await viewer.locator('.cfx-vtk-canvas').boundingBox();await page.mouse.click(b.x+b.width/2,b.y+b.height/2);
  const output=viewer.getByRole('status',{name:'Picked result value',exact:true});await eventually(()=>output.getAttribute('data-probe-value'),v=>v!==null);assert.doesNotMatch(await output.innerText(),/coordinates|Interpolated|mm/);await page.keyboard.press('Escape');assert.equal(await output.count(),0);
  const canvas2d=viewer.locator('.cfx-vtk-canvas');await canvas2d.scrollIntoViewIfNeeded();let area=await canvas2d.boundingBox();
  await page.mouse.move(area.x+area.width/2,area.y+area.height/2);await page.mouse.down();await page.mouse.move(area.x+area.width/2+20,area.y+area.height/2+15,{steps:8});await page.mouse.up();
  await button(viewer,'Probe point value (V)').click();await canvas2d.scrollIntoViewIfNeeded();area=await canvas2d.boundingBox();
  const samples=[];for(const dx of [-20,20]){await page.mouse.click(area.x+area.width/2+dx,area.y+area.height/2);await eventually(()=>output.getAttribute('data-probe-value'),v=>v!==null);samples.push(JSON.parse(await output.getAttribute('data-probe-position')));}
  assert.ok(Math.abs(samples[0][1]-samples[1][1])<1e-6,'A 2D drag must not rotate physical axes');assert.ok(samples[1][0]>samples[0][0]);
  await page.keyboard.press('Escape');
  await ui.getByRole('combobox',{name:'CFD scenario',exact:true}).selectOption(second.id);await ui.getByRole('tab',{name:'2D Slices',exact:true}).click();await slices.getByText(/This service has no indexed slice API/).waitFor();
  assert.equal(requested.at(-1),secondId);assert.equal(await slices.getByRole('combobox',{name:'Slice run',exact:true}).count(),0);assert.equal(await slices.getByRole('alert').count(),0);
  await button(slices,'Compare Runs').click();await slices.getByRole('combobox',{name:'Option run',exact:true}).selectOption(jobId);
  const panes=slices.locator('[data-slice-pane]');assert.equal(await panes.count(),4);
  const positions=await panes.evaluateAll(nodes=>nodes.map(node=>({x:node.getBoundingClientRect().x,y:node.getBoundingClientRect().y})));
  assert.equal(positions[0].y,positions[1].y);assert.equal(positions[2].y,positions[3].y);assert.ok(positions[1].x>positions[0].x);
  const optionViewer=slices.locator('[data-slice-pane=option]').getByRole('region',{name:'VTK results viewer',exact:true});await optionViewer.getByRole('status').filter({hasText:/4 points.*1 cell/}).waitFor();
  assert.equal(await slices.getByRole('button',{name:'View Z',exact:true}).count(),0);
  await button(ui,'Collapse all').click();assert.equal(await slices.locator('canvas').filter({visible:true}).count(),0);assert.equal(await slices.getByRole('combobox').count(),0);await button(ui,'Expand all').click();
  if(process.env.BROWSER_ARTIFACTS)await page.screenshot({path:`${process.env.BROWSER_ARTIFACTS}/current-simulation-legacy-2d.png`});
});

test('expired current run gives an actionable retention message, not a generic Not Found or another run',async t=>{
  const project=cfdProject(false),job={id:jobId,studyId:project.cfdScenarios[0].id,clientRevision:'c'.repeat(64),phase:'Completed',progress:100,message:'Expired fixture'};
  const {ui}=await open(t,project,route=>{
    const path=new URL(route.request().url()).pathname;
    if(path.endsWith('/capabilities'))return route.fulfill({json:caps});
    if(path.endsWith('/jobs'))return route.fulfill({json:[job]});
    if(path.endsWith('/logs'))return route.fulfill({json:{...job,cursor:0,nextCursor:0,text:''}});
    return route.fulfill({status:404,json:{detail:'Not Found'}});
  });
  await cfdWindow(ui,'Imported results');await ui.getByRole('tab',{name:'2D Slices',exact:true}).click();const slices=ui.getByRole('region',{name:'2D CFD slice results',exact:true});
  await eventually(()=>slices.getByRole('alert').allTextContents(),v=>v.some(s=>s.includes('retained results are no longer available')));assert.equal(await slices.getByRole('combobox',{name:'Slice run',exact:true}).count(),0);
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

test('a delayed plane download preserves layers added or removed while it was loading',async t=>{
  const project=cfdProject(false),data=strToU8(vtk()),job={id:jobId,studyId:project.cfdScenarios[0].id,clientRevision:'c'.repeat(64),phase:'Completed',progress:100,message:'Retained job'};
  const artifacts=[0,1].map(index=>({id:`slice-${index}`,name:`plane-${index}.vtk`,kind:'vtk',size:data.length,sha256:digest(data)}));
  let requested=false,release=()=>{};
  const delayed=new Promise<void>(resolve=>{release=resolve;});t.after(()=>release());
  const {page,ui}=await open(t,project,async route=>{
    const path=new URL(route.request().url()).pathname;
    if(path.endsWith('/capabilities'))return route.fulfill({json:caps});
    if(path.endsWith('/jobs'))return route.fulfill({json:[job]});
    if(path.endsWith('/logs'))return route.fulfill({json:{...job,cursor:0,nextCursor:0,text:''}});
    if(path.endsWith('/result'))return route.fulfill({json:{jobId,studyId:job.studyId,clientRevision:job.clientRevision,sourceHash:'a'.repeat(64),configurationHash:'b'.repeat(64),pressureUnit:'m2/s2',accepted:true,artifacts}});
    if(path.endsWith('/artifacts/slice-1')){requested=true;await delayed;}
    if(path.includes('/artifacts/'))return route.fulfill({body:Buffer.from(data)});
    return route.fulfill({json:job});
  });
  await page.evaluate(()=>window.dispatchEvent(new Event('focus')));await cfdWindow(ui,'Imported results');
  const menu=ui.getByRole('combobox',{name:'View result in 3D',exact:true});await eventually(()=>menu.isEnabled(),Boolean);await menu.selectOption('slice-0');
  const viewer=ui.getByRole('region',{name:'VTK results viewer',exact:true});await viewer.getByRole('status').filter({hasText:/4 points.*1 cell/}).waitFor();
  await ui.getByRole('combobox',{name:'Plane to inspect',exact:true}).selectOption('artifact:slice-1');await eventually(()=>requested,Boolean);
  await button(viewer,'Hide plane viewer').click();await ui.getByText('3D result layers · 1 loaded',{exact:true}).click();
  await ui.getByRole('combobox',{name:'Delete result plane',exact:true}).selectOption('plane-0.vtk');
  await ui.getByLabel('Import result layers',{exact:true}).setInputFiles({name:'external.vtk',mimeType:'application/octet-stream',buffer:Buffer.from(data)});
  await viewer.getByRole('status').filter({hasText:/4 points.*1 cell/}).waitFor();release();
  await eventually(()=>viewer.getByRole('checkbox',{name:/^Show result /}).evaluateAll(nodes=>nodes.map(n=>n.parentElement!.textContent)),names=>names.includes('plane-1.vtk')&&names.length===2);
  const names=await viewer.getByRole('checkbox',{name:/^Show result /}).evaluateAll(nodes=>nodes.map(n=>n.parentElement!.textContent));
  assert.deepEqual([...names].sort(),['external.vtk','plane-1.vtk']);
  assert.match(await viewer.locator('.cfx-stale').innerText(),/External file layers/);
});

test('unload all stays unloaded when an earlier native-plane download finishes late',async t=>{
  const project=cfdProject(false),data=strToU8(vtk()),job={id:jobId,studyId:project.cfdScenarios[0].id,clientRevision:'c'.repeat(64),phase:'Completed',progress:100,message:'Retained job'};
  const artifacts=[0,1].map(i=>({id:`slice-${i}`,name:`plane-${i}.vtk`,kind:'vtk',size:data.length,sha256:digest(data)}));
  let requested=false,release=()=>{};const delayed=new Promise<void>(resolve=>{release=resolve;});t.after(()=>release());
  const {ui}=await open(t,project,async route=>{
    const path=new URL(route.request().url()).pathname;
    if(path.endsWith('/capabilities'))return route.fulfill({json:caps});
    if(path.endsWith('/jobs'))return route.fulfill({json:[job]});
    if(path.endsWith('/logs'))return route.fulfill({json:{...job,cursor:0,nextCursor:0,text:''}});
    if(path.endsWith('/result'))return route.fulfill({json:{jobId,studyId:job.studyId,clientRevision:job.clientRevision,sourceHash:'a'.repeat(64),configurationHash:'b'.repeat(64),pressureUnit:'m2/s2',accepted:true,artifacts}});
    if(path.endsWith('/artifacts/slice-1')){requested=true;await delayed;}
    if(path.includes('/artifacts/'))return route.fulfill({body:Buffer.from(data)});
    return route.fulfill({json:job});
  });
  await cfdWindow(ui,'Imported results');await ui.getByRole('region',{name:'VTK results viewer',exact:true}).getByRole('status').filter({hasText:/4 points.*1 cell/}).waitFor();
  const menu=ui.getByRole('combobox',{name:'View result in 3D',exact:true});await menu.selectOption('slice-1');await eventually(()=>requested,Boolean);
  await ui.getByText('3D result layers · 1 loaded',{exact:true}).click();await button(ui,'Unload all result layers').click();release();await eventually(()=>menu.isEnabled(),Boolean);
  assert.equal(await ui.getByRole('region',{name:'VTK results viewer',exact:true}).count(),0);assert.ok(await ui.getByText('3D result layers · 0 loaded',{exact:true}).isVisible());
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
  await viewer.locator('.cfx-vtk-canvas').scrollIntoViewIfNeeded();
  await eventually(async()=>({canvas:await viewer.locator('.cfx-vtk-canvas').boundingBox(),panel:await ui.locator('.cfx-setup-window').boundingBox()}),
    ({canvas,panel})=>canvas&&panel&&canvas.height>=140&&canvas.width>200&&canvas.y>=panel.y&&canvas.y+canvas.height<=panel.y+panel.height+1&&panel.y+panel.height<=901,
    'The embedded mobile inspector keeps a real usable 3D viewport onscreen');
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
  await viewer.locator('.cfx-vtk-canvas').scrollIntoViewIfNeeded();
  await eventually(async()=>({canvas:await viewer.locator('.cfx-vtk-canvas').boundingBox(),windowBox:await ui.locator('.cfx-setup-window').boundingBox()}),
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
  const {ui}=await open(t);await cfdWindow(ui,'Imported results');
  const bad='<VTKFile type="ImageData"><ImageData WholeExtent="0 999999 0 999999 0 999999"><Piece Extent="0 999999 0 999999 0 999999"><PointData/></Piece></ImageData></VTKFile>';
  await ui.getByLabel('Import result layers',{exact:true}).setInputFiles({name:'oversized.vti',mimeType:'application/xml',buffer:Buffer.from(bad)});
  await ui.getByRole('alert').filter({hasText:/250,000/}).waitFor();await button(ui,'Hide plane viewer').click();await ui.getByText('3D result layers · 1 loaded',{exact:true}).click();
  await ui.getByRole('combobox',{name:'Delete result plane',exact:true}).selectOption('oversized.vti');await ui.getByLabel('Import result layers',{exact:true}).setInputFiles({name:'entities.vti',mimeType:'application/xml',buffer:Buffer.from('<!DOCTYPE VTKFile [<!ENTITY x SYSTEM "file:///private">]><VTKFile type="ImageData">&x;</VTKFile>')});
  await ui.getByRole('alert').filter({hasText:/uncompressed ASCII/}).waitFor();
});
