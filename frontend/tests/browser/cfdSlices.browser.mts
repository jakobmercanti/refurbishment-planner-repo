import assert from 'node:assert/strict';
import test,{before,after} from 'node:test';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {cfdProject} from '../climoptixFixtures';
import {cfdWindow,eventually,startBrowserHarness} from './harness.mjs';

let harness,server,fixture;
const button=(scope,name)=>scope.getByRole('button',{name,exact:true});
before(async()=>{
  const root=fileURLToPath(new URL('../../../',import.meta.url));
  server=spawn(path.join(root,'.venv',process.platform==='win32'?'Scripts/python.exe':'bin/python'),['-X','utf8',fileURLToPath(new URL('./fixtures/cfdSliceServer.py',import.meta.url))],{cwd:root,stdio:['ignore','pipe','pipe']});
  fixture=await new Promise((resolve,reject)=>{let data='',errors='';const timer=setTimeout(()=>reject(new Error('Slice fixture startup timed out: '+errors)),20000);server.stderr.on('data',v=>errors+=v);server.once('exit',code=>reject(new Error(`Slice fixture exited ${code}: ${errors}`)));server.stdout.on('data',chunk=>{data+=chunk;if(data.includes('\n')){clearTimeout(timer);resolve(JSON.parse(data.split('\n')[0]));}});});
  await eventually(async()=>{try{return(await fetch(fixture.origin+'/health')).ok;}catch{return false;}},Boolean);
  harness=await startBrowserHarness({climoptixEnabled:true});
});
after(async()=>{await harness?.close();server?.kill();});
async function open(t,options={}){
  const project=cfdProject(false);project.projectId=fixture.project;project.cfdScenarios.forEach(s=>s.sourceBuildingId=fixture.project);
  const s=await harness.session(project,options);t.after(()=>s.close());
  await s.context.route('**/climoptix/worker/**',async route=>{const u=new URL(route.request().url()),start=u.pathname.indexOf('/climoptix/worker/');const response=await fetch(fixture.origin+u.pathname.slice(start)+u.search,{method:route.request().method(),headers:{'Content-Type':'application/json'},...(route.request().method()==='POST'?{body:route.request().postData()}:{} )});await route.fulfill({status:response.status,contentType:'application/json',body:await response.text()});});
  await s.page.reload();await s.page.getByRole('combobox',{name:'Workspace',exact:true}).selectOption('CLIMOPTIX');const ui=s.page.locator('.cfx-workspace');await cfdWindow(ui,'Imported results');await ui.getByRole('tab',{name:'2D Slices',exact:true}).click();
  const slices=ui.getByRole('region',{name:'2D CFD slice results',exact:true});await slices.getByRole('combobox',{name:'Slice run',exact:true}).selectOption(fixture.baseline);await eventually(()=>slices.locator('[data-slice-pane=baseline] canvas').getAttribute('data-limits'),v=>v==='[10,10]');
  return{...s,ui,slices};
}
async function compare(s){await button(s,'Compare Runs').click();await s.getByRole('combobox',{name:'Option run',exact:true}).selectOption(fixture.option);await eventually(()=>s.locator('[data-slice-pane=baseline] canvas').getAttribute('data-limits'),v=>v==='[10,12]');}
async function screenshot(page,name){if(process.env.BROWSER_ARTIFACTS)await page.screenshot({path:`${process.env.BROWSER_ARTIFACTS}/slices-${name}.png`});}

test('real Results X/Y/Z browsing, actual arrows, keyboard scope and per-axis state do not alter the building viewer',async t=>{
  const {page,ui,slices,saved}=await open(t),before=await saved();
  await slices.getByLabel('Slice orientation',{exact:true}).selectOption('X');await eventually(()=>slices.getByLabel('Available physical plane',{exact:true}).innerText(),v=>v.includes('X = 0.5'));
  await button(slices,'Next plane').click();await eventually(()=>slices.getByLabel('Available physical plane',{exact:true}).inputValue(),v=>!!v);assert.match(await slices.getByLabel('Available physical plane',{exact:true}).locator('option:checked').innerText(),/0.8/);assert.ok(await button(slices,'Next plane').isDisabled());
  await slices.getByLabel('Slice orientation',{exact:true}).selectOption('Y');await slices.getByLabel('Slice orientation',{exact:true}).selectOption('X');assert.match(await slices.getByLabel('Available physical plane',{exact:true}).locator('option:checked').innerText(),/0.8/);
  await slices.locator('[data-slice-pane=baseline] canvas').focus();await page.keyboard.press('Home');assert.ok(await button(slices,'Previous plane').isDisabled());await page.keyboard.press('ArrowRight');assert.match(await slices.getByLabel('Available physical plane',{exact:true}).locator('option:checked').innerText(),/0.5/);
  assert.equal(await slices.locator('canvas').count(),1);assert.match(await slices.locator('canvas').getAttribute('aria-label'),/horizontal Y, vertical Z/);
  const after=await saved();assert.deepEqual(after.rooms,before.rooms);assert.deepEqual(after.cfdScenarios[0].outputs,before.cfdScenarios[0].outputs);assert.equal(await ui.locator('.cfx-main-result-window').count(),0);
  await slices.getByLabel('Slice field',{exact:true}).selectOption('q');await eventually(()=>slices.getByText('No comparable numeric samples in this pane.',{exact:true}).isVisible(),Boolean);assert.ok(await button(slices,'Download baseline PNG').isDisabled());
});
test('compare quadrant mapping, sign, shared ranges, manual legends, PNG/CSV export, probe and Esc',async t=>{
  const {page,slices}=await open(t);await compare(slices);
  assert.deepEqual(await slices.locator('[data-slice-pane]').evaluateAll(nodes=>nodes.map(n=>n.getAttribute('data-slice-pane'))),['baseline','option','inspector','delta']);
  const panes=slices.locator('[data-slice-pane]');const positions=await panes.evaluateAll(nodes=>nodes.map(n=>({x:n.getBoundingClientRect().x,y:n.getBoundingClientRect().y})));assert.equal(positions[0].y,positions[1].y);assert.equal(positions[2].y,positions[3].y);assert.equal(positions[0].x,positions[2].x);
  await button(slices,'Zoom in baseline').click();assert.equal(await slices.locator('[data-slice-pane=baseline] canvas').getAttribute('data-slice-view'),await slices.locator('[data-slice-pane=delta] canvas').getAttribute('data-slice-view'));await button(slices,'Reset plot views').click();
  await button(slices,'Probe point value (V)').click();const c=slices.locator('[data-slice-pane=baseline] canvas');await c.scrollIntoViewIfNeeded();const box=await c.boundingBox();await page.mouse.click(box.x+box.width/2,box.y+150);
  const reading=slices.getByRole('status',{name:'Picked result value',exact:true});await eventually(()=>reading.getAttribute('data-probe-value'),v=>v==='10');assert.match(await slices.locator('[data-slice-pane=inspector]').innerText(),/Δ\|U\|.*2 m\/s/s);
  await page.mouse.click(box.x+60,box.y+box.height-30);assert.equal(await reading.getAttribute('data-probe-value'),'10');
  await page.keyboard.press('Escape');assert.equal(await reading.count(),0);assert.ok(await slices.isVisible());
  await slices.getByText('Visual settings & delta legend',{exact:true}).click();await slices.getByRole('checkbox',{name:'Auto Delta scale',exact:true}).uncheck();await slices.getByRole('spinbutton',{name:'Delta scale minimum',exact:true}).fill('-1');await page.keyboard.press('Tab');await slices.getByRole('spinbutton',{name:'Delta scale maximum',exact:true}).fill('4');await page.keyboard.press('Tab');
  assert.equal(await slices.locator('[data-slice-pane=delta] canvas').getAttribute('data-limits'),'[-1,4]');
  await slices.getByRole('spinbutton',{name:'Delta scale minimum',exact:true}).fill('5');await page.keyboard.press('Tab');assert.ok(await slices.getByRole('alert').filter({hasText:'Legend minimum'}).isVisible());await slices.getByRole('checkbox',{name:'Auto Delta scale',exact:true}).check();
  await slices.getByText('Export numeric data & provenance',{exact:true}).click();const download=page.waitForEvent('download');await button(slices,'Download slice / delta CSV').click();const file=await download;assert.match(file.suggestedFilename(),/option-minus-baseline/);
  const csvChunks=[];for await(const chunk of await file.createReadStream())csvChunks.push(chunk);const csv=Buffer.concat(csvChunks).toString('utf8');assert.ok(csv.includes(fixture.baseline)&&csv.includes(fixture.option));assert.match(csv,/Option − Baseline/);assert.ok(csv.split('\n').some(line=>line.split(',').slice(3,7).join(',')==='10,12,2,1'));
  const pngDownload=page.waitForEvent('download');await button(slices,'Download baseline PNG').click();const png=await pngDownload;assert.equal(png.suggestedFilename(),'cfd-baseline.png');if(process.env.BROWSER_ARTIFACTS)await png.saveAs(`${process.env.BROWSER_ARTIFACTS}/slices-baseline-export.png`);
  const jsonDownload=page.waitForEvent('download');await button(slices,'Download comparison metadata').click();const jsonFile=await jsonDownload,jsonChunks=[];for await(const chunk of await jsonFile.createReadStream())jsonChunks.push(chunk);const exported=JSON.parse(Buffer.concat(jsonChunks).toString('utf8'));assert.equal(exported.data.definition,'Option − Baseline');assert.equal(exported.data.baseline.run,fixture.baseline);assert.equal(exported.data.option.run,fixture.option);assert.deepEqual(exported.settings.legends['U:-1:K:absolute'].delta.auto,true);
  await button(slices,'Swap runs').click();await eventually(()=>slices.locator('[data-slice-pane=delta]').innerText(),v=>v.includes('Option − Baseline'));await eventually(()=>slices.getByLabel('Delta statistics',{exact:true}).innerText(),v=>v.includes('mean -2'));
  if(process.env.BROWSER_ARTIFACTS)await slices.locator('.cfx-slice-grid').screenshot({path:`${process.env.BROWSER_ARTIFACTS}/slices-compare-grid.png`});
  await slices.getByRole('combobox',{name:'Baseline run',exact:true}).scrollIntoViewIfNeeded();await screenshot(page,'compare-desktop');
});
test('nearest mismatched plane never produces quantitative delta, pending/error states remain honest',async t=>{
  const {page,context,slices}=await open(t);
  // Older v1 workers omit these optional response fields; the manifest is authoritative.
  await context.route('**/climoptix/worker/slice-data',async route=>{const response=await fetch(fixture.origin+'/climoptix/worker/slice-data',{method:'POST',headers:{'Content-Type':'application/json'},body:route.request().postData()});const json=await response.json();if(json.option){delete json.option.coordinate;delete json.option.axis;}await route.fulfill({status:response.status,json});});
  await button(slices,'Compare Runs').click();await slices.getByRole('combobox',{name:'Option run',exact:true}).selectOption(fixture.shifted);
  await eventually(()=>slices.innerText(),v=>v.includes('No matching physical plane'));assert.match(await slices.locator('[data-slice-pane=delta]').innerText(),/No comparable numeric samples/);
  await eventually(()=>slices.locator('[data-slice-pane=option]').getAttribute('data-coordinate'),v=>v==='0.7');
  await button(slices,'Probe point value (V)').click();assert.equal(await slices.locator('[data-slice-pane=option] canvas').getAttribute('data-probing'),null);await button(slices,'Exit point probe (Esc)').click();
  await slices.getByText('Export numeric data & provenance',{exact:true}).click();const download=page.waitForEvent('download');await button(slices,'Download slice / delta CSV').click();
  const chunks=[];for await(const chunk of await(await download).createReadStream())chunks.push(chunk);const row=Buffer.concat(chunks).toString('utf8').split('\n')[2].split(',');
  assert.equal(row[2],'0.5');assert.equal(row[9],'0.7');assert.equal(row[5],'');assert.equal(row[6],'0');
  await context.route('**/climoptix/worker/slice-data',route=>route.fulfill({status:403,json:{detail:'No permission for this retained run'}}));await button(slices,'Refresh slice data').click();await eventually(()=>slices.getByRole('alert').allTextContents(),v=>v.some(s=>s.includes('No permission')));
  await screenshot(page,'permission-error');
});

test('percent semantics, field changes, density metrics and pane/action alignment stay consistent',async t=>{
  const {page,slices}=await open(t);await compare(slices);
  const panes=slices.locator('[data-slice-pane]');
  const canvases=slices.locator('[data-slice-pane=baseline] canvas, [data-slice-pane=option] canvas');
  const tops=await canvases.evaluateAll(nodes=>nodes.map(n=>n.getBoundingClientRect().top));assert.ok(Math.abs(tops[0]-tops[1])<1);
  for(const pane of ['baseline','option','delta']){
    const sizes=await slices.locator(`[data-slice-pane=${pane}] footer > button`).evaluateAll(nodes=>nodes.map(n=>({w:n.getBoundingClientRect().width,h:n.getBoundingClientRect().height})));
    assert.ok(Math.max(...sizes.map(s=>s.w))-Math.min(...sizes.map(s=>s.w))<=1);assert.ok(Math.max(...sizes.map(s=>s.h))-Math.min(...sizes.map(s=>s.h))<=1);
  }
  await slices.getByText('Visual settings & delta legend',{exact:true}).click();
  const definition=slices.getByLabel('Delta definition',{exact:true});await definition.selectOption('percent');
  await eventually(()=>slices.locator('[data-slice-pane=delta] header').innerText(),v=>v.includes('100 × (Option − Baseline) / |Baseline|'));
  await eventually(()=>slices.getByLabel('Delta statistics',{exact:true}).innerText(),v=>v.includes('mean 20'));
  await definition.selectOption('vector');await slices.getByLabel('Slice field',{exact:true}).selectOption('p');assert.equal(await definition.inputValue(),'absolute');
  await eventually(()=>button(slices,'Download baseline PNG').isEnabled(),Boolean);
  await page.setViewportSize({width:390,height:900});await panes.first().scrollIntoViewIfNeeded();assert.ok(await slices.evaluate(n=>n.scrollWidth<=n.clientWidth+2));
  await screenshot(page,'audit-mobile-controls');
});

test('nonuniform X/Y/Z planes visibly preserve orientation and signed deltas across different meshes',async t=>{
  const {page,slices}=await open(t);
  await slices.getByRole('combobox',{name:'Slice run',exact:true}).selectOption(fixture.gradientBaseline);
  await button(slices,'Compare Runs').click();
  await slices.getByRole('combobox',{name:'Option run',exact:true}).selectOption(fixture.gradientOption);
  await slices.getByLabel('Vector quantity',{exact:true}).selectOption('0');
  await slices.getByText('Visual settings & delta legend',{exact:true}).click();
  await slices.getByLabel('Shared scale palette',{exact:true}).selectOption('grey');
  await slices.getByLabel('Delta scale palette',{exact:true}).selectOption('grey');
  for(const [axis,mean] of [['X',3.75],['Y',4.5],['Z',5.25]] as const){
    await slices.getByLabel('Slice orientation',{exact:true}).selectOption(axis);
    await eventually(()=>slices.getByLabel('Delta statistics',{exact:true}).innerText(),v=>v.includes(`mean ${-3*mean-5}`));
    for(const [kind,direction] of [['baseline',1],['option',-1],['delta',-1]] as const){
      const canvas=slices.locator(`[data-slice-pane=${kind}] canvas`);
      assert.match(await canvas.getAttribute('aria-label'),new RegExp(`horizontal ${axis==='X'?'Y':'X'}, vertical ${axis==='Z'?'Y':'Z'}`));
      await canvas.scrollIntoViewIfNeeded();
      const [sw,ne]=await canvas.evaluate(node=>{
        const r=node.getBoundingClientRect(),edge=Math.min(r.width-72,r.height-132),left=52+(r.width-72-edge)/2,top=42+(r.height-132-edge)/2,ctx=node.getContext('2d');
        return [.25,.75].map(f=>Array.from(ctx.getImageData(Math.floor((left+f*edge)*node.width/r.width),Math.floor((top+(1-f)*edge)*node.height/r.height),1,1).data));
      });
      assert.equal(sw[3],255);assert.equal(ne[3],255);
      assert.ok(direction*(ne[0]-sw[0])>5,`${axis}/${kind}: physical NE/SW grey values ${ne}/${sw} must preserve the analytical gradient`);
    }
    await screenshot(page,`gradient-${axis}`);
  }
  await slices.getByLabel('Delta definition',{exact:true}).selectOption('vector');
  await eventually(()=>slices.getByLabel('Delta statistics',{exact:true}).innerText(),v=>v.includes('mean 20.75'));
  const pngDownload=page.waitForEvent('download');await button(slices,'Download delta PNG').click();const png=await pngDownload;
  if(process.env.BROWSER_ARTIFACTS)await png.saveAs(`${process.env.BROWSER_ARTIFACTS}/gradient-vector-delta.png`);
  await slices.getByLabel('Delta definition',{exact:true}).selectOption('percent');
  await eventually(()=>slices.getByLabel('Delta statistics',{exact:true}).innerText(),v=>v.includes('mean -'));
  const download=page.waitForEvent('download');await slices.getByText('Export numeric data & provenance',{exact:true}).click();await button(slices,'Download slice / delta CSV').click();
  const chunks=[];for await(const chunk of await(await download).createReadStream())chunks.push(chunk);
  const rows=Buffer.concat(chunks).toString('utf8').split('\n').slice(2).filter(Boolean);
  for(const row of rows){const [x,y,z,a,b,delta,valid,ox,oy,oz]=row.split(',').map(Number),expected=x+2*y+3*z;
    assert.ok(Math.abs(a-expected)<1e-10);assert.ok(Math.abs(b-(-2*expected-5))<1e-10);
    assert.ok(Math.abs(delta-100*(b-a)/Math.abs(a))<1e-10);assert.equal(valid,1);assert.deepEqual([ox,oy,oz],[x,y,z]);}
});
test('progressive inventory preserves selection and reload restores project-scoped settings with mobile/light-dark layouts',async t=>{
  const {page,ui,slices}=await open(t);await compare(slices);await slices.getByLabel('Available physical plane',{exact:true}).selectOption({label:'Plane 1 of 3 | Z = 0.2 m'});const selected=await slices.getByLabel('Available physical plane',{exact:true}).inputValue();
  assert.ok((await fetch(fixture.origin+'/fixture/progress',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'})).ok);await button(slices,'Refresh slice data').click();await eventually(()=>slices.getByLabel('Available physical plane',{exact:true}).locator('option').count(),n=>n===4);assert.equal(await slices.getByLabel('Available physical plane',{exact:true}).inputValue(),selected);
  await eventually(()=>page.evaluate(()=>Object.values(localStorage).some(v=>v.includes('"mode":"compare"'))),Boolean);await page.reload();await page.getByRole('combobox',{name:'Workspace',exact:true}).selectOption('CLIMOPTIX');await cfdWindow(ui,'Imported results');await ui.getByRole('tab',{name:'2D Slices',exact:true}).click();await button(slices,'Compare Runs').waitFor();assert.equal(await button(slices,'Compare Runs').getAttribute('aria-pressed'),'true');assert.equal(await slices.getByRole('combobox',{name:'Option run',exact:true}).inputValue(),fixture.option);
  for(const [name,width,height] of [['laptop',1280,900],['tablet',800,1000],['mobile',390,900]]){await page.setViewportSize({width,height});await slices.locator('[data-slice-pane=delta]').scrollIntoViewIfNeeded();assert.equal(await slices.locator('[data-slice-pane]').count(),4);assert.equal(await slices.evaluate(n=>n.scrollWidth<=n.clientWidth+2),true);await screenshot(page,name);}
  await page.evaluate(()=>document.documentElement.dataset.theme='dark');await screenshot(page,'mobile-dark');
});

test('rapid navigation cancels a delayed prior slice instead of painting its values under a new physical label',async t=>{
  const {context,slices}=await open(t);await slices.getByLabel('Slice orientation',{exact:true}).selectOption('X');
  const selection=slices.getByLabel('Available physical plane',{exact:true}),canvas=slices.locator('[data-slice-pane=baseline] canvas');
  await eventually(()=>canvas.getAttribute('data-limits'),v=>v==='[10.5,10.5]');
  const slow=await selection.locator('option').filter({hasText:'X = 0.2 m'}).getAttribute('value');
  let began=false,finish;const finished=new Promise<void>(resolve=>finish=resolve);
  await context.route('**/climoptix/worker/slice-data',async route=>{
    const body=route.request().postDataJSON(),delayed=body.baseline.assetId===slow;
    if(delayed){began=true;await new Promise(resolve=>setTimeout(resolve,500));}
    try{const response=await fetch(fixture.origin+'/climoptix/worker/slice-data',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});await route.fulfill({status:response.status,contentType:'application/json',body:await response.text()});}
    catch(error){if(!route.request().failure())throw error;}
    finally{if(delayed)finish();}
  });
  await selection.selectOption(slow);await eventually(()=>began,Boolean);await selection.selectOption({label:'Plane 3 of 3 | X = 0.8 m'});
  await eventually(()=>canvas.getAttribute('data-limits'),v=>{try{return JSON.parse(v).every(n=>Math.abs(n-10.8)<1e-10);}catch{return false;}});
  await finished;assert.match(await selection.locator('option:checked').innerText(),/X = 0.8 m/);assert.ok(JSON.parse(await canvas.getAttribute('data-limits')).every(n=>Math.abs(n-10.8)<1e-10));
});

test('V and Esc remain usable when the point settings are collapsed and never close Results',async t=>{
  const {page,slices}=await open(t),canvas=slices.locator('[data-slice-pane=baseline] canvas');
  const summary=slices.getByText('Point probing (V / Esc)',{exact:true});
  await summary.click();assert.equal(await summary.evaluate(n=>n.parentElement.open),false);await canvas.focus();await page.keyboard.press('v');
  assert.equal(await canvas.getAttribute('data-probing'),'true');
  await page.keyboard.press('Escape');assert.equal(await canvas.getAttribute('data-probing'),null);assert.ok(await slices.isVisible());
  await summary.click();await button(slices,'Probe point value (V)').click();await summary.click();await canvas.focus();
  await page.keyboard.press('Escape');assert.equal(await canvas.getAttribute('data-probing'),null);assert.ok(await slices.isVisible());
});

test('a wrong-resolution worker response clears contours and disables export instead of mislabelling the grid',async t=>{
  const {context,slices}=await open(t);
  await context.route('**/climoptix/worker/slice-data',async route=>{
    const body={...route.request().postDataJSON(),size:16};
    const response=await fetch(fixture.origin+'/climoptix/worker/slice-data',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
    await route.fulfill({status:response.status,contentType:'application/json',body:await response.text()});
  });
  await button(slices,'Refresh slice data').click();
  await eventually(()=>slices.getByRole('alert').allTextContents(),v=>v.some(message=>message.includes('sampling resolution')));
  assert.ok(await button(slices,'Download baseline PNG').isDisabled());
  await slices.getByText('Export numeric data & provenance',{exact:true}).click();
  assert.ok(await button(slices,'Download slice / delta CSV').isDisabled());
  assert.equal(await slices.locator('[data-slice-pane=baseline] canvas').getAttribute('data-limits'),'[0,1]');
});
