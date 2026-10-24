import assert from "node:assert/strict";
import test, {before, after} from "node:test";
import {cfdProject} from "../climoptixFixtures";
import {cfdWindow, eventually, startBrowserHarness} from "./harness.mjs";

let harness;
before(async () => {harness = await startBrowserHarness();});
after(async () => {await harness?.close();});
async function open(t, project = cfdProject()) {
  const session = await harness.session(project); t.after(() => session.close());
  await session.page.getByRole("combobox",{name:"Workspace",exact:true}).selectOption("CLIMOPTIX");
  const ui = session.page.getByRole("region",{name:"Climoptix CFD workspace",exact:true});
  await eventually(() => ui.getAttribute("data-preparation-state"), state => state === "checked");
  return {...session,ui};
}

test("nested rows, compact metrics, collapse actions and transfer columns match the requested layout", async t => {
  const {page,ui} = await open(t);
  const heading = ui.locator('.cfx-study-group .cfx-list-header').first();
  const row = ui.locator('.cfx-study-row').first();
  const parent = await heading.boundingBox(), child = await row.boundingBox();
  assert.ok(child.x > parent.x+8, 'Expanded simulations are indented');
  assert.equal(await heading.locator('small').count(),0);
  const widths = await heading.locator('.cfx-group-actions > button').evaluateAll(nodes => nodes.map(n=>n.getBoundingClientRect().width));
  assert.ok(Math.max(...widths)-Math.min(...widths)<1);
  await cfdWindow(ui,'Domain');
  assert.ok((await ui.locator('.cfx-metrics').boundingBox()).height < 75);
  await cfdWindow(ui,'Physics');
  await ui.getByRole('button',{name:'Collapse all',exact:true}).click();
  assert.equal(await ui.locator('.cfx-physics-panel details[open]').count(),0);
  await cfdWindow(ui,'Solver'); await ui.getByRole('tab',{name:'Run',exact:true}).click();
  const actions = ui.locator('.cfx-run-panel .cfx-panel-actions');
  const boxes = await actions.locator('button').evaluateAll(nodes=>nodes.map(n=>{const r=n.getBoundingClientRect();return {x:r.x,y:r.y,w:r.width};}));
  assert.equal(boxes.length,4);
  assert.ok(Math.max(...boxes.map(b=>b.w))-Math.min(...boxes.map(b=>b.w))<1);
  assert.ok(Math.max(...boxes.map(b=>b.y))-Math.min(...boxes.map(b=>b.y))<1);
  await actions.getByRole('button',{name:'Collapse all',exact:true}).click();
  assert.equal(await ui.locator('.cfx-run-panel details[open]').count(),0);
  await cfdWindow(ui,'Review & export');
  assert.ok(await ui.getByText('Geometry ready',{exact:false}).isVisible());
  await ui.getByRole('tab',{name:'Import / export',exact:true}).click();
  const transfer = await ui.locator('.cfx-transfer-actions > *').evaluateAll(nodes=>nodes.map(n=>{const r=n.getBoundingClientRect();return {x:r.x,y:r.y,w:r.width};}));
  assert.equal(transfer.length,4);
  assert.ok(Math.abs(transfer[0].x-transfer[3].x)<1);
  assert.ok(Math.max(...transfer.map(b=>b.w))-Math.min(...transfer.map(b=>b.w))<1);
  if(process.env.BROWSER_ARTIFACTS) await page.screenshot({path:`${process.env.BROWSER_ARTIFACTS}/cfd-new-actions.png`});
});

test("boundary conditions can be added through an explicit room and real surface picker", async t => {
  const project = cfdProject(); project.cfdScenarios[0].seed = null;
  const {page,ui,saved} = await open(t,project);
  await cfdWindow(ui,'Boundaries');
  const picker = ui.getByRole('combobox',{name:'Boundary seed room',exact:true});
  await picker.selectOption({index:1});
  await eventually(saved,p=>!!p.cfdScenarios[0].seed);
  await eventually(()=>ui.getAttribute('data-preparation-state'),s=>s==='checked');
  await ui.getByRole('button',{name:'Add boundary conditions to Default surfaces',exact:true}).click();
  const dialog = ui.locator('.floating-toolbar').filter({has:page.getByText('Assign boundary surfaces',{exact:true})});
  await dialog.getByRole('combobox',{name:'Boundary assignment surface type',exact:true}).selectOption('wall');
  const available = dialog.getByRole('checkbox',{name:/Assign surface/});
  assert.ok(await available.count()>0);
  await available.first().check();
  await dialog.getByRole('button',{name:'Apply and edit conditions',exact:true}).click();
  await ui.getByRole('region',{name:'Boundary group conditions',exact:true}).waitFor();
  await eventually(saved,p=>p.cfdScenarios[0].boundaries.collections.some(g=>g.id!=='all-surfaces'&&g.patchIds.length===1&&g.boundary));
});

test("refinement selection clears from setup whitespace without changing the view scope", async t => {
  const project = cfdProject();
  project.cfdScenarios[0].mesh.refinements=[{id:'region',name:'Refinement A',shape:'box',centerMm:[1000,1000,1000],sizeMm:[500,500,500],cellMm:50,level:2}];
  const {ui} = await open(t,project);
  await cfdWindow(ui,'Solver');
  await ui.getByRole('button',{name:'Select Refinement A',exact:true}).click();
  assert.equal(await ui.locator('.cfx-refinement-row.selected').count(),1);
  const viewport=ui.locator('.cfx-viewport'); const scope=await viewport.getAttribute('data-scope');
  await ui.locator('#cfx-setup-panel-mesh').click({position:{x:10,y:400}});
  assert.equal(await ui.locator('.cfx-refinement-row.selected').count(),0);
  assert.equal(await viewport.getAttribute('data-scope'),scope);
  await ui.getByRole('button',{name:'Select Refinement A',exact:true}).click();
  const canvas=viewport.locator('canvas'); const canvasBox=await canvas.boundingBox();
  await viewport.locator('.stable-canvas-host').click({position:{x:canvasBox.width-10,y:canvasBox.height-20}});
  assert.equal(await ui.locator('.cfx-refinement-row.selected').count(),0,'3D background removes selection');
});

test("authenticated HTTP worker feeds real log samples, cancels jobs and recovers after page reload", async t => {
  const {page,context,ui}=await open(t);
  const owner="11111111-1111-4111-8111-111111111111";
  let job;
  const log='Time = 1\nsmoothSolver: Solving for Ux, Initial residual = 0.2, Final residual = 0.001, No Iterations 2\nTime = 2\nsmoothSolver: Solving for Ux, Initial residual = 0.02, Final residual = 0.0001, No Iterations 2\n';
  await context.route('**/climoptix/worker/**',async route=>{
    assert.equal(route.request().headers().authorization,'Bearer test-access');
    const url=new URL(route.request().url()); const path=url.pathname;
    let result:unknown;
    if(path.endsWith('/capabilities')) result={connected:true,mesh:true,run:true,reason:'Runtime accepted',namespace:owner,
      limits:{cpu:2,memoryGb:4,wallTimeMinutes:15,storageGb:1,retentionDays:3,maxCells:500000,concurrentJobs:1}};
    else if(path.endsWith('/jobs')&&route.request().method()==='POST'){
      const request=route.request().postDataJSON(); job={id:'22222222-2222-4222-8222-222222222222',studyId:request.studyId,clientRevision:request.clientRevision,phase:'Running',progress:null,message:'Actual test telemetry'}; result=job;
    }else if(path.endsWith('/jobs')) result=job?[job]:[];
    else if(path.endsWith('/logs')){const cursor=Number(url.searchParams.get('cursor'));result={...job,cursor,nextCursor:Buffer.byteLength(log),text:cursor?"":log};}
    else if(path.endsWith('/cancel')){job={...job,phase:'Cancelled'};result=job;}
    else if(path.endsWith('/result')){await route.fulfill({status:409,contentType:'application/json',body:'{"detail":"No finalized result"}'});return;}
    else result=job;
    await route.fulfill({contentType:'application/json',body:JSON.stringify(result)});
  });
  await page.evaluate(owner=>{sessionStorage.setItem('freefloorplan3d:commercial-session:v1',JSON.stringify({access_token:'test-access',refresh_token:'test-refresh',expires_at:Math.floor(Date.now()/1000)+3600,user:{id:owner}}));window.dispatchEvent(new Event('freefloorplan3d:auth-session-changed'));},owner);
  await eventually(()=>ui.getByRole('button',{name:'Run Office airflow',exact:true}).isEnabled(),Boolean);
  await ui.getByRole('button',{name:'Run Office airflow',exact:true}).click();
  await eventually(()=>job,Boolean);
  await cfdWindow(ui,'Convergence monitor');
  await ui.getByRole('img',{name:'Residual graph for Ux',exact:true}).waitFor();
  await ui.getByRole('button',{name:'Cancel job',exact:true}).click();
  await eventually(()=>job.phase,s=>s==='Cancelled');
  await page.reload();
  await page.getByRole('combobox',{name:'Workspace',exact:true}).selectOption('CLIMOPTIX');
  await eventually(()=>ui.locator('.cfx-job-detail').textContent(),text=>text?.includes('Cancelled'));
});
