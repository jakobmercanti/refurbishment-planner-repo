import assert from 'node:assert/strict';
import test,{before,after} from 'node:test';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {cfdProject,realDefaultSetup} from '../climoptixFixtures';
import {cfdWindow,eventually,startBrowserHarness} from './harness.mjs';

let harness;
before(async()=>{harness=await startBrowserHarness({climoptixEnabled:true});});
after(async()=>{await harness?.close();});
const button=(scope,name)=>scope.getByRole('button',{name,exact:true});
const vtk=(z=.2)=>`# vtk DataFile Version 3.0\nphysical plane\nASCII\nDATASET POLYDATA\nPOINTS 4 float\n0 0 ${z} 1 0 ${z} 1 1 ${z} 0 1 ${z}\nPOLYGONS 1 5\n4 0 1 2 3\nPOINT_DATA 4\nSCALARS p float 1\nLOOKUP_TABLE default\n${3*z} ${1+3*z} ${3+3*z} ${2+3*z}\n`;
const namespace='11111111-1111-4111-8111-111111111111',jobId='99999999-9999-4999-8999-999999999999',otherId='88888888-8888-4888-8888-888888888888';
const data=[.2,.5,.8].map(z=>Buffer.from(vtk(z))),artifacts=data.map((d,i)=>({id:`slice-${i}`,name:`slice_Z_00${i+1}.vtk`,kind:'vtk',size:d.length,sha256:createHash('sha256').update(d).digest('hex')}));
async function open(t,worker=false){
  const p=cfdProject(false);p.cfdScenarios[0]=realDefaultSetup({project:p,scenario:p.cfdScenarios[0],clientRevision:'a'.repeat(64)});
  const s=await harness.session(p);t.after(()=>s.close());let job,sourceHash;
  await s.context.addInitScript(()=>{window.__octStores=[];window.__REACT_DEVTOOLS_GLOBAL_HOOK__={supportsFiber:true,inject:()=>1,onCommitFiberUnmount(){},onCommitFiberRoot(_,root){const store=root.containerInfo;if(typeof store?.getState==='function'&&!window.__octStores.includes(store))window.__octStores.push(store);}};window.__octScene=()=>window.__octStores.map(store=>store.getState()).find(state=>state.gl?.domElement?.closest('.cfx-viewport'));});
  if(worker)await s.context.route('**/climoptix/worker/**',async route=>{
    const url=new URL(route.request().url()),u=url.pathname;
    if(u.endsWith('/capabilities'))return route.fulfill({json:{connected:true,mesh:true,run:true,namespace,reason:'Local native-plane fixture',limits:{cpu:1,memoryGb:4,wallTimeMinutes:15,storageGb:1,retentionDays:3,maxCells:500000,concurrentJobs:1}}});
    if(u.endsWith('/jobs')&&route.request().method()==='POST'){const request=route.request().postDataJSON();sourceHash=request.sourceHash;job={id:jobId,studyId:request.studyId,clientRevision:request.clientRevision,phase:'Completed',progress:100,operation:'run',message:'Retained fixture'};return route.fulfill({json:job});}
    if(u.endsWith('/jobs'))return route.fulfill({json:job?[job,{...job,id:otherId,studyId:'other-study',name:'Alternative'}]:[]});
    if(u.endsWith('/slices'))return route.fulfill({status:404,json:{detail:'Not Found'}});
    if(u.endsWith('/result'))return route.fulfill({json:{jobId:u.includes(otherId)?otherId:jobId,studyId:u.includes(otherId)?'other-study':job.studyId,clientRevision:job.clientRevision,sourceHash,configurationHash:'b'.repeat(64),pressureUnit:'m2/s2',accepted:true,artifacts}});
    if(u.endsWith('/logs'))return route.fulfill({json:{...job,cursor:0,nextCursor:0,text:''}});
    const match=/artifacts\/slice-(\d+)/.exec(u);if(match)return route.fulfill({body:data[Number(match[1])]});
    return route.fulfill({json:job});
  });
  await s.page.reload();await s.page.getByRole('combobox',{name:'Workspace',exact:true}).selectOption('CLIMOPTIX');
  const ui=s.page.locator('.cfx-workspace');await cfdWindow(ui,'Solver');await eventually(()=>ui.getAttribute('data-preparation-state'),v=>v==='checked');
  return {...s,ui,project:p};
}
async function results(t){const s=await open(t,true);await cfdWindow(s.ui,'Simulations');await button(s.ui,'Run Office airflow').click();await cfdWindow(s.ui,'Imported results');await eventually(()=>s.ui.getByLabel('Plane to inspect',{exact:true}).inputValue(),v=>v==='slice_Z_001.vtk');return s;}
async function shot(page,name){if(process.env.BROWSER_ARTIFACTS)await page.screenshot({path:`${process.env.BROWSER_ARTIFACTS}/oct27-${name}.png`});}

test('whole workbench survey keeps every phase contained and category text readable at wide and narrow sizes',async t=>{
  const {page,ui}=await open(t);
  const failures=[];
  for(const width of [1440,640,390]){
    await page.setViewportSize({width,height:1000});
    for(const name of ['Simulations','Domain','Equipment','Boundaries','Physics','Solver','Optimisation','Review & export','Imported results']){
      await cfdWindow(ui,name);
      const panel=ui.locator('.cfx-setup-panel:visible');
      const measurement=await panel.evaluate(n=>({width:n.clientWidth,scroll:n.scrollWidth,fonts:[...n.querySelectorAll('summary:not(.cfx-row-menu > summary)')].filter(s=>s.checkVisibility()).map(s=>parseFloat(getComputedStyle(s).fontSize))}));
      if(measurement.scroll>measurement.width+2||measurement.fonts.some(n=>n<12))failures.push(`${name} at ${width}px: ${JSON.stringify(measurement)}`);
      const bounds=await panel.boundingBox();for(const action of await panel.getByRole('button',{name:/^(Collapse all|Expand all)$/}).all()){const box=await action.boundingBox();assert.ok(box.x>=bounds.x-1&&box.x+box.width<=bounds.x+bounds.width+1,`${name} at ${width}px conceals a disclosure action horizontally`);}
      await shot(page,`audit-${width}-${name.replaceAll(' ','-')}`);
    }
  }
  assert.deepEqual(failures,[]);
});

test('external plane with a worker filename cannot become verified through keyboard navigation',async t=>{
  const {page,ui}=await results(t);
  await ui.getByLabel('Import result layers',{exact:true}).setInputFiles({name:'slice_Z_001.vtk',mimeType:'application/octet-stream',buffer:Buffer.from(vtk(.05))});
  const viewer=ui.getByRole('region',{name:'VTK results viewer',exact:true}),canvas=viewer.locator('.cfx-vtk-canvas');
  await eventually(()=>viewer.locator('footer [role=status]').textContent(),v=>v?.includes('4 points'));
  await canvas.focus();await page.keyboard.press('ArrowUp');await page.waitForTimeout(350);
  assert.equal(await viewer.getByLabel('Plane to inspect',{exact:true}).inputValue(),'slice_Z_001.vtk');
  assert.equal(await viewer.getByText(/External file layers/).count(),1);
  assert.equal(await button(ui,'Compare Runs').isEnabled(),false);
  const frame=viewer.getByLabel('2D plane viewer',{exact:true});await button(frame,'Expand viewer').click();await eventually(()=>page.evaluate(()=>!!document.fullscreenElement),Boolean);await button(frame,'Restore viewer').click();
});

test('unloading a re-downloaded verified plane also removes its existing building overlay',async t=>{
  const {page,ui}=await results(t);await button(ui,'Load selected plane into building 3D').click();
  await eventually(()=>page.evaluate(()=>!!window.__octScene()?.scene.getObjectByName('verified-cfd-result')),Boolean);
  await button(ui,'Return to results').click();await eventually(()=>ui.getByLabel('Plane to inspect',{exact:true}).inputValue(),v=>v==='slice_Z_001.vtk');
  const selection=ui.getByLabel('Plane to inspect',{exact:true}),downloaded=page.waitForResponse(r=>r.url().endsWith('/artifacts/slice-0'));
  await selection.selectOption('artifact:slice-0');await downloaded;await eventually(()=>selection.isEnabled(),Boolean);
  const cached=ui.getByText(/^Cached result layers · \d+ loaded$/);if(!(await cached.locator('..').getAttribute('open')))await cached.click();
  await ui.getByLabel('Delete result plane',{exact:true}).selectOption('slice_Z_001.vtk');
  await eventually(()=>page.evaluate(()=>!!window.__octScene()?.scene.getObjectByName('verified-cfd-result')),v=>!v);
});

test('mixed imported and verified layers retain selected-file provenance and independent unload behaviour',async t=>{
  const {page,ui}=await results(t);await ui.getByLabel('Import result layers',{exact:true}).setInputFiles({name:'external.vtk',mimeType:'application/octet-stream',buffer:Buffer.from(vtk(.4))});
  const viewer=ui.getByRole('region',{name:'VTK results viewer',exact:true});await viewer.getByText('Plane controls',{exact:true}).click();await viewer.getByLabel('Plane to inspect',{exact:true}).selectOption('slice_Z_001.vtk');
  await ui.getByRole('tab',{name:'Summary & 3D',exact:true}).click();assert.ok(await button(ui,'Load selected plane into building 3D').isEnabled());await button(ui,'Load selected plane into building 3D').click();
  await eventually(()=>page.evaluate(()=>!!window.__octScene()?.scene.getObjectByName('verified-cfd-result')),Boolean);await button(ui,'Return to results').click();
  await eventually(()=>ui.getByLabel('Plane to inspect',{exact:true}).inputValue(),v=>v==='slice_Z_001.vtk');await ui.getByLabel('Import result layers',{exact:true}).setInputFiles({name:'slice_Z_001.vtk',mimeType:'application/octet-stream',buffer:Buffer.from(vtk(.05))});
  await ui.getByRole('tab',{name:'Summary & 3D',exact:true}).click();const cached=ui.getByText(/^Cached result layers · \d+ loaded$/);if(!(await cached.locator('..').getAttribute('open')))await cached.click();await ui.getByLabel('Delete result plane',{exact:true}).selectOption('slice_Z_001.vtk');
  assert.equal(await page.evaluate(()=>!!window.__octScene()?.scene.getObjectByName('verified-cfd-result')),true,'Deleting an external namesake must not unload the verified worker overlay');
});

test('every workbench category can collapse and expand without opening row menus or changing the simulation',async t=>{
  const {page,ui,saved}=await open(t),before=await saved();
  const verify=async root=>{
    await button(root,'Collapse all').first().click();
    assert.equal(await root.locator('details[open]:not(.cfx-row-menu)').count(),0);
    await button(root,'Expand all').first().click();
    assert.equal(await root.locator('.cfx-row-menu[open]').count(),0);
    assert.ok(await root.locator('details[open]:not(.cfx-row-menu)').count()>0);
  };
  await cfdWindow(ui,'Simulations');await button(ui,'Collapse all').click();assert.equal(await button(ui,'Select Office airflow').count(),0);await button(ui,'Expand all').click();assert.equal(await button(ui,'Select Office airflow').count(),1);
  for(const [name,root] of [['Domain','.cfx-domain-panel'],['Equipment','.cfx-objects'],['Boundaries','.cfx-boundaries-panel'],['Physics','.cfx-physics-panel']]){await cfdWindow(ui,name);await verify(ui.locator(root));}
  await cfdWindow(ui,'Solver');
  for(const [tab,root] of [['Mesh','.cfx-mesh-panel'],['Run','.cfx-run-panel'],['Monitor','.cfx-convergence'],['Post-processing','.cfx-post-panel']]){await ui.getByRole('tab',{name:tab,exact:true}).click();await verify(ui.locator(root));}
  await cfdWindow(ui,'Review & export');await verify(ui.locator('.cfx-review'));
  await ui.getByRole('tab',{name:'Import / export',exact:true}).click();await button(ui.locator('.cfx-review'),'Collapse all').click();assert.equal(await button(ui,'Export simulation JSON').count(),0);await button(ui.locator('.cfx-review'),'Expand all').click();assert.equal(await button(ui,'Export simulation JSON').count(),1);
  const after=await saved();assert.deepEqual(after.rooms,before.rooms);for(const key of ['vents','mesh','physics','boundaries','postProcessing','resources'])assert.deepEqual(after.cfdScenarios[0][key],before.cfdScenarios[0][key]);
  assert.equal(await ui.locator('.cfx-plane-context-menu').count(),0);await shot(page,'audit-collapse-export');
});

test('secondary equipment, refinement and boundary editors share readable collapsible categories',async t=>{
  const {page,ui}=await open(t);
  const check=async root=>{await button(root,'Collapse all').click();assert.equal(await root.getByRole('spinbutton').count(),0);assert.equal(await root.getByRole('combobox').count(),0);await button(root,'Expand all').click();assert.ok(await root.getByRole('spinbutton').count()>0);};
  await cfdWindow(ui,'Equipment');await ui.locator('.cfx-device-actions button').first().click();await check(ui.locator('.cfx-vent-settings'));await button(ui,'Done').click();
  await cfdWindow(ui,'Solver');await ui.getByRole('tab',{name:'Mesh',exact:true}).click();await ui.locator('.cfx-refinement-actions button').first().click();const refinement=ui.getByRole('region',{name:'Refinement editor',exact:true});await check(refinement);await button(ui,'Done').click();
  await cfdWindow(ui,'Boundaries');await ui.locator('.cfx-surface-row .cfx-device-actions button').first().click();const boundary=ui.locator('.cfx-boundary-fields:visible');await check(boundary);await shot(page,'audit-boundary-editor');
});

test('Domain collapses completely; Physics and Objects actions share rows; category text matches controls',async t=>{
  const {page,ui}=await open(t);await cfdWindow(ui,'Domain');const domain=ui.locator('.cfx-domain-panel');
  await button(domain,'Collapse all').click();assert.equal(await domain.getByRole('combobox').count(),0);assert.equal(await domain.getByRole('spinbutton').count(),0);
  const font=await domain.locator('summary').first().evaluate(n=>parseFloat(getComputedStyle(n).fontSize));assert.ok(font>=12);
  await button(domain,'Expand all').click();assert.ok(await domain.getByRole('combobox',{name:'Seed room',exact:true}).isVisible());
  await cfdWindow(ui,'Physics');const physics=ui.locator('.cfx-physics-panel'),a=await button(physics,'Import insulation & heating conditions').boundingBox(),b=await button(physics,'Collapse all').boundingBox();assert.ok(Math.abs(a.y-b.y)<2);
  await cfdWindow(ui,'Equipment');const edit=await button(ui,'Edit source building & assets').boundingBox(),supply=await button(ui,'+ Supply').boundingBox();assert.equal(edit.y,supply.y);await shot(page,'compact-actions');
});

test('Thermal is embedded in Bounds and footer controls align without oversized headings',async t=>{
  const {page,ui}=await open(t);await cfdWindow(ui,'Thermal Envelope & Solar Conditions');
  const panel=ui.getByRole('region',{name:'Thermal envelope setup',exact:true});await panel.waitFor();assert.equal(await panel.locator('xpath=ancestor::*[contains(concat(" ",@class," ")," floating-toolbar ")]').count(),1);
  assert.equal(await ui.getByRole('dialog',{name:'Insulation boundary import & thermal envelope',exact:true}).count(),0);
  assert.ok(await panel.locator('h2').evaluate(n=>parseFloat(getComputedStyle(n).fontSize))<=16);
  const positions=await panel.locator('.thermal-footer button').evaluateAll(nodes=>nodes.map(n=>n.getBoundingClientRect().y));assert.ok(Math.max(...positions)-Math.min(...positions)<2);
  const footer=await panel.locator('.thermal-footer').boundingBox(),windowBounds=await ui.locator('.cfx-setup-window').boundingBox();assert.ok(footer.y+footer.height<=windowBounds.y+windowBounds.height,'Thermal footer stays inside the workbench, not clipped beneath it');
  await shot(page,'embedded-thermal');
});

test('all embedded Thermal steps remain contained with aligned reachable actions in both themes and densities',async t=>{
  const {page,ui}=await open(t);await cfdWindow(ui,'Thermal Envelope & Solar Conditions');const panel=ui.getByRole('region',{name:'Thermal envelope setup',exact:true});
  for(const [width,theme,density] of [[1440,'light','comfortable'],[640,'dark','compact'],[390,'dark','comfortable']] as const){
    await page.setViewportSize({width,height:1000});await page.evaluate(({theme,density})=>{document.documentElement.dataset.theme=theme;document.documentElement.dataset.density=density;},{theme,density});
    for(let step=0;step<6;step++){
      const select=panel.getByLabel('Thermal step',{exact:true});if(await select.isVisible())await select.selectOption(String(step));else await panel.locator('.thermal-steps button').nth(step).click();
      const body=panel.locator('.thermal-scroll'),dimensions=await body.evaluate(n=>({width:n.clientWidth,scroll:n.scrollWidth}));assert.ok(dimensions.scroll<=dimensions.width+2,`Thermal step ${step} at ${width}px: ${JSON.stringify(dimensions)}`);
      const footer=await panel.locator('.thermal-footer').boundingBox(),bounds=await ui.locator('.cfx-setup-window').boundingBox();assert.ok(footer.y+footer.height<=bounds.y+bounds.height+1);
      const positions=await panel.locator('.thermal-footer button').evaluateAll(nodes=>nodes.map(n=>n.getBoundingClientRect().y));assert.ok(Math.max(...positions)-Math.min(...positions)<2);
    }
    await shot(page,`audit-thermal-${width}-${theme}-${density}`);
  }
});

test('2D probe is one black point and adjacent value anchored on the plane, including after pan/zoom',async t=>{
  const {page,ui,saved}=await open(t),before=await saved();await cfdWindow(ui,'Imported results');await ui.getByLabel('Import result layers',{exact:true}).setInputFiles({name:'probe.vtk',mimeType:'application/octet-stream',buffer:Buffer.from(vtk(.5))});
  const viewer=ui.getByRole('region',{name:'VTK results viewer',exact:true}),canvas=viewer.locator('.cfx-vtk-canvas');await canvas.waitFor();
  await eventually(()=>viewer.locator('footer [role=status]').textContent(),v=>v?.includes('4 points'));await canvas.focus();await page.keyboard.press('v');await canvas.scrollIntoViewIfNeeded();const box=await canvas.boundingBox();await page.mouse.click(box.x+box.width/2,box.y+box.height/2);
  const output=viewer.getByRole('status',{name:'Picked result value',exact:true});await eventually(()=>output.getAttribute('data-probe-value'),v=>v!==null);
  assert.equal(await output.locator('.cfx-picked-dot').evaluate(n=>getComputedStyle(n).backgroundColor),'rgb(0, 0, 0)');
  const position=JSON.parse(await output.getAttribute('data-probe-position'));assert.ok(Math.abs(Number(await output.getAttribute('data-probe-value'))-(position[0]+2*position[1]+3*position[2]))<1e-5);
  const dot=await output.locator('.cfx-picked-dot').boundingBox();assert.ok(Math.abs(dot.x+dot.width/2-box.x-box.width/2)<3);assert.ok(Math.abs(dot.y+dot.height/2-box.y-box.height/2)<3);
  await page.mouse.click(box.x+box.width/2+30,box.y+box.height/2+20);assert.equal(await output.count(),1);await shot(page,'anchored-probe');await page.keyboard.press('Escape');assert.equal(await output.count(),0);assert.deepEqual((await saved()).rooms,before.rooms);
});

test('2D Up/Down loads real adjacent native planes and never changes stored geometry',async t=>{
  const {page,ui,saved}=await results(t),before=await saved();assert.equal(await ui.getByRole('region',{name:'VTK results viewer',exact:true}).count(),0,'Summary & 3D has no independent plane viewer');
  await button(ui,'Inspect in 2D').click();const viewer=ui.getByRole('region',{name:'VTK results viewer',exact:true}),canvas=viewer.locator('.cfx-vtk-canvas');await canvas.focus();await page.keyboard.press('ArrowUp');await eventually(()=>viewer.getByLabel('Plane to inspect',{exact:true}).inputValue(),v=>v==='slice_Z_002.vtk');
  await canvas.focus();await page.keyboard.press('ArrowDown');await eventually(()=>viewer.getByLabel('Plane to inspect',{exact:true}).inputValue(),v=>v==='slice_Z_001.vtk');assert.deepEqual((await saved()).rooms,before.rooms);
});

test('main 3D plane selection and Up/Down replace sampled layers; visibility controls are display-only and compact',async t=>{
  const {page,ui,saved}=await results(t),before=await saved();await button(ui,'Load selected plane into building 3D').click();
  await eventually(()=>page.evaluate(()=>!!window.__octScene()?.scene.getObjectByName('verified-cfd-result')),Boolean);
  const plane=ui.getByRole('combobox',{name:'Building 3D plane',exact:true});assert.equal(await plane.inputValue(),'slice_Z_001.vtk');
  await ui.locator('.cfx-viewport').focus();await page.keyboard.press('ArrowUp');await eventually(()=>plane.inputValue(),v=>v==='slice_Z_002.vtk');assert.equal(await plane.locator('option').count(),1,'Navigating replaces the selected layer rather than leaking new layers');
  await button(ui,'Previous 3D plane').click();await eventually(()=>plane.inputValue(),v=>v==='slice_Z_001.vtk');
  await cfdWindow(ui,'View properties');const controls=ui.getByLabel('CFD view properties',{exact:true});await controls.getByRole('checkbox',{name:'Only CFD result planes',exact:true}).check();assert.equal(await page.evaluate(()=>window.__octScene().scene.getObjectByName('cfd-building-context').visible),false);
  await controls.getByRole('checkbox',{name:'Show CFD result planes',exact:true}).uncheck();await eventually(()=>page.evaluate(()=>!!window.__octScene().scene.getObjectByName('verified-cfd-result')),v=>!v);
  const viewWindow=ui.locator('.cfx-view-window');assert.ok((await viewWindow.boundingBox()).height<350);await shot(page,'view-properties');assert.deepEqual((await saved()).rooms,before.rooms);assert.deepEqual((await saved()).cfdScenarios[0].vents,before.cfdScenarios[0].vents);
});

test('legacy comparison is a compact shared 2 by 2 viewport with collapsed floating controls',async t=>{
  const {page,ui}=await results(t);await button(ui,'Inspect in 2D').click();const slices=ui.getByRole('region',{name:'2D CFD slice results',exact:true});await button(slices,'Compare Runs').click();
  const grid=slices.locator('.cfx-slice-grid.compare');await grid.waitFor();const boxes=await grid.locator(':scope > [data-slice-pane]').evaluateAll(nodes=>nodes.map(n=>n.getBoundingClientRect().toJSON()));assert.equal(boxes.length,4);assert.equal(boxes[0].y,boxes[1].y);assert.equal(boxes[2].y,boxes[3].y);assert.equal(boxes[0].x,boxes[2].x);assert.ok((await grid.boundingBox()).height<800);
  assert.equal(await grid.locator('.cfx-floating-controls[open]').count(),0);assert.equal(await slices.getByRole('dialog').count(),0);
  const controls=slices.getByText('Comparison controls',{exact:true});await controls.click();await slices.getByText('Comparison run selection',{exact:true}).click();await slices.getByRole('combobox',{name:'Option run',exact:true}).selectOption(otherId);await controls.click();
  const option=grid.locator('[data-slice-pane=option]'),optionCanvas=option.locator('.cfx-vtk-canvas');await eventually(()=>option.locator('footer [role=status]').textContent(),v=>v?.includes('4 points'));await optionCanvas.scrollIntoViewIfNeeded();await optionCanvas.focus();await page.keyboard.press('v');const box=await optionCanvas.boundingBox();await page.mouse.click(box.x+box.width/2,box.y+box.height/2);await eventually(()=>option.getByRole('status',{name:'Picked result value',exact:true}).getAttribute('data-probe-value'),v=>v!==null);assert.equal(await grid.locator('[data-slice-pane=baseline]').getByRole('status',{name:'Picked result value',exact:true}).count(),0,'V must target the focused plane, not the first comparison pane');await page.keyboard.press('Escape');
  const baseline=grid.locator('[data-slice-pane=baseline]'),baselineCanvas=baseline.locator('.cfx-vtk-canvas');
  await baselineCanvas.focus();await page.keyboard.press('v');await optionCanvas.focus();await page.keyboard.press('v');
  assert.equal(await baseline.locator('.cfx-point-probe').getAttribute('data-probe-mode'),'true');assert.equal(await option.locator('.cfx-point-probe').getAttribute('data-probe-mode'),'true');
  await page.keyboard.press('Escape');assert.equal(await option.locator('.cfx-point-probe').getAttribute('data-probe-mode'),null);assert.equal(await baseline.locator('.cfx-point-probe').getAttribute('data-probe-mode'),'true','Esc exits the focused option, not an unrelated baseline probe');
  await baselineCanvas.focus();await page.keyboard.press('Escape');assert.equal(await baseline.locator('.cfx-point-probe').getAttribute('data-probe-mode'),null);
  await shot(page,'shared-compare');
});

test('changing the physical setup blocks 3D keyboard navigation of stale result planes',async t=>{
  const {page,ui,saved}=await results(t);await button(ui,'Load selected plane into building 3D').click();await eventually(()=>page.evaluate(()=>!!window.__octScene()?.scene.getObjectByName('verified-cfd-result')),Boolean);
  await cfdWindow(ui,'Physics');const density=ui.getByRole('spinbutton',{name:'Air density (kg/m³)',exact:true});await density.fill('1.3');await density.press('Enter');await eventually(saved,p=>p.cfdScenarios[0].physics.densityKgM3===1.3);
  await button(page,'Hide Simulation setup').click();await ui.getByText('Setup changed. This pinned result is hidden to avoid overlaying a different building. Inspect the original job separately.',{exact:true}).waitFor();
  await ui.locator('.cfx-viewport').focus();await page.keyboard.press('ArrowUp');await page.waitForTimeout(400);assert.equal(await ui.getByRole('combobox',{name:'Building 3D plane',exact:true}).inputValue(),'slice_Z_001.vtk');assert.equal(await page.evaluate(()=>!!window.__octScene()?.scene.getObjectByName('verified-cfd-result')),false);
});

test('default optimisation selects an inlet, validates its actual region and exposes no fake execution',async t=>{
  const {page,ui,saved}=await open(t);const root=fileURLToPath(new URL('../../../',import.meta.url));
  await page.route('**/climoptix/optimisation/prepare',async route=>{const r=spawnSync(path.join(root,'.venv','Scripts/python.exe'),['-X','utf8','-c','import json,sys; from backend.app.climoptix_api import AdjointPreparationRequest,adjoint_preparation; print(json.dumps(adjoint_preparation(AdjointPreparationRequest.model_validate(json.load(sys.stdin)))))'],{cwd:root,input:route.request().postData(),encoding:'utf8',timeout:25000});if(r.status!==0)throw Error(r.stderr);await route.fulfill({json:JSON.parse(r.stdout)});});
  await cfdWindow(ui,'Optimisation');const panel=ui.getByRole('region',{name:'Adjoint optimisation preparation',exact:true});await button(panel,'Use current CFD setup').click();await eventually(saved,p=>p.cfdScenarios[0].adjointStudies?.length===1);assert.equal((await saved()).cfdScenarios[0].adjointStudies[0].ports.filter(p=>p.movable).length,1);
  await button(panel,'Validate setup').click();await eventually(()=>panel.innerText(),v=>v.includes('Configuration checks passed'));assert.equal(await panel.getByText('Study ID',{exact:true}).isVisible(),false);await button(panel,'Collapse all').click();assert.equal(await panel.getByRole('combobox').count(),0);await shot(page,'optimisation');
});
