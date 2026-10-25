// Regression coverage: all worker traffic below is mocked, never deployed.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import type {CFDSubmission,CFDWorkerJob} from '../../lib/climoptixJobs';
import test, {before,after} from 'node:test';
import {cfdProject} from '../climoptixFixtures';
import {startBrowserHarness,eventually,cfdWindow} from './harness.mjs';

let harness;
before(async()=>{harness=await startBrowserHarness({climoptixEnabled:true});});
after(async()=>{await harness?.close();});
test("authenticated HTTP worker feeds real log samples, cancels jobs and recovers after page reload", async t => {
  const {page,context,ui}=await open(t, async route => route.fulfill({json: route.request().url().endsWith('/capabilities') ? caps : []}));
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
  // Account changes close the private workspace until server reauthorization.
  await eventually(()=>page.locator('.workspace-mode-select option[value="CLIMOPTIX"]').count(), n=>n===1);
  await page.getByRole('combobox',{name:'Workspace',exact:true}).selectOption('CLIMOPTIX');
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
const namespace='11111111-1111-4111-8111-111111111111';
const caps={connected:true,mesh:true,run:true,reason:'Audit mock runtime',namespace,
  limits:{cpu:1,memoryGb:4,wallTimeMinutes:15,storageGb:1,retentionDays:3,maxCells:500000,concurrentJobs:1}};
const log='Time = 1\nsmoothSolver: Solving for Ux, Initial residual = 0.2, Final residual = 0.001, No Iterations 2\n';
const hash=(value:Buffer)=>createHash('sha256').update(value).digest('hex');

test('leaving a monitor aborts its artifact action and a late response cannot open results',async t=>{
  let job:CFDWorkerJob, started=false, release:()=>void;
  const hold=new Promise<void>(resolve=>{release=resolve;});t.after(()=>release());
  const vtk=Buffer.from('# vtk DataFile Version 3.0\nlate slice\nASCII\nDATASET POLYDATA\nPOINTS 0 float\n');
  const artifact={id:'slice-0',kind:'vtk',size:vtk.length,sha256:hash(vtk)};
  const s=await open(t,async route=>{
    const path=new URL(route.request().url()).pathname;
    if(path.endsWith('/capabilities'))return route.fulfill({json:caps});
    if(path.endsWith('/jobs')&&route.request().method()==='POST'){
      const request=route.request().postDataJSON();job={id:'88888888-8888-4888-8888-888888888888',studyId:request.studyId,
        clientRevision:request.clientRevision,phase:'Completed',progress:100,message:'Completed'};
      return route.fulfill({json:job});
    }
    if(path.endsWith('/jobs'))return route.fulfill({json:[]});
    if(path.endsWith('/logs'))return route.fulfill({json:{...job,cursor:0,nextCursor:0,text:''}});
    if(path.endsWith('/result'))return route.fulfill({json:{...job,jobId:job.id,sourceHash:'a'.repeat(64),configurationHash:'b'.repeat(64),pressureUnit:'m2/s2',accepted:true,artifacts:[artifact]}});
    if(path.endsWith('/artifacts/slice-0')){started=true;await hold;return route.fulfill({body:vtk}).catch(()=>{});}
    return route.fulfill({json:job});
  });
  await s.ui.getByRole('button',{name:'Run Office airflow',exact:true}).click();
  await eventually(()=>job,Boolean);await cfdWindow(s.ui,'Convergence monitor');
  await s.ui.getByRole('button',{name:'View slice-0',exact:true}).click();
  await eventually(()=>started,Boolean);await cfdWindow(s.ui,'Simulations');release();
  await s.page.waitForTimeout(300);
  assert.equal(await s.ui.getByRole('region',{name:'VTK results viewer',exact:true}).count(),0);
  assert.equal(await s.ui.getByRole('alert').count(),0);
});
async function open(t, transport){
  const s=await harness.session(cfdProject());t.after(()=>s.close());
  await s.context.route('**/climoptix/worker/**',transport);
  await s.page.evaluate(()=>window.dispatchEvent(new Event('focus')));
  await s.page.getByRole('combobox',{name:'Workspace',exact:true}).selectOption('CLIMOPTIX');
  const ui=s.page.getByRole('region',{name:'Climoptix CFD workspace',exact:true});
  await eventually(()=>ui.getByRole('button',{name:'Run Office airflow',exact:true}).isEnabled(),Boolean);
  return {...s,ui};
}

test('access outage and page reload retain the original ambiguous submission identity',async t=>{
  const requests:CFDSubmission[]=[];let job:CFDWorkerJob, outage=false;
  const s=await open(t,async route=>{
    const path=new URL(route.request().url()).pathname;
    if(path.endsWith('/capabilities'))return route.fulfill({status:outage?503:200,json:outage?{detail:'Temporary outage'}:caps});
    if(path.endsWith('/jobs')&&route.request().method()==='POST'){
      const request=route.request().postDataJSON();requests.push(request);
      job={id:'22222222-2222-4222-8222-222222222222',
        studyId:request.studyId,clientRevision:request.clientRevision,phase:'Completed',progress:100,message:'Accepted remotely'};
      if(requests.length===1)return route.abort('failed');
      return route.fulfill({json:job});
    }
    if(path.endsWith('/jobs'))return route.fulfill({status:503,json:{detail:'Job recovery temporarily unavailable'}});
    return route.fulfill({json:job});
  });
  await s.ui.getByRole('button',{name:'Run Office airflow',exact:true}).click();
  await s.ui.getByText('Submission status unknown',{exact:true}).waitFor();
  assert.equal(requests.length,1);
  outage=true;await s.page.evaluate(()=>window.dispatchEvent(new Event('focus')));
  await eventually(()=>s.page.locator('.climoptix-screen').count(),n=>n===0);
  outage=false;await s.page.evaluate(()=>window.dispatchEvent(new Event('focus')));
  await eventually(()=>s.page.locator('option[value="CLIMOPTIX"]').count(),n=>n===1);
  await s.page.getByRole('combobox',{name:'Workspace',exact:true}).selectOption('CLIMOPTIX');
  const run=s.ui.getByRole('button',{name:'Run Office airflow',exact:true});
  await eventually(()=>run.isEnabled(),Boolean);
  await s.ui.getByText('Submission status unknown',{exact:true}).waitFor();
  await s.page.reload();
  await s.page.getByRole('combobox',{name:'Workspace',exact:true}).selectOption('CLIMOPTIX');
  await s.ui.getByText('Submission status unknown',{exact:true}).waitFor();
  await run.click();await eventually(()=>requests.length,n=>n===2);
  assert.equal(requests[0].submissionId,requests[1].submissionId);
  assert.deepEqual(requests[0],requests[1]);
});

test('result-fetch outages are visible, retry automatically and never rerun the job',async t=>{
  let job:CFDWorkerJob,resultCalls=0,submits=0;
  const s=await open(t,async route=>{
    const path=new URL(route.request().url()).pathname;
    if(path.endsWith('/capabilities'))return route.fulfill({json:caps});
    if(path.endsWith('/jobs')&&route.request().method()==='POST'){
      submits++;
      const request=route.request().postDataJSON();job={id:'44444444-4444-4444-8444-444444444444',studyId:request.studyId,clientRevision:request.clientRevision,phase:'Completed',progress:100,message:'Converged'};
      return route.fulfill({json:job});
    }
    if(path.endsWith('/jobs'))return route.fulfill({json:[]});
    if(path.endsWith('/logs')){const cursor=Number(new URL(route.request().url()).searchParams.get('cursor'));return route.fulfill({json:{...job,cursor,nextCursor:Buffer.byteLength(log),text:cursor?'':log}});}
    if(path.endsWith('/result')){resultCalls++;return resultCalls===1?route.fulfill({status:503,json:{detail:'Temporary result outage'}}):route.fulfill({json:{...job,jobId:job.id,sourceHash:'a'.repeat(64),configurationHash:'b'.repeat(64),pressureUnit:'m2/s2',accepted:true,artifacts:[]}});}
    return route.fulfill({json:job});
  });
  await s.ui.getByRole('button',{name:'Run Office airflow',exact:true}).click();
  await eventually(()=>job,Boolean);await cfdWindow(s.ui,'Convergence monitor');
  await eventually(()=>resultCalls,n=>n===1);
  await s.ui.getByText(/Native result retrieval failed/).waitFor();
  await eventually(()=>resultCalls,n=>n===2);
  const monitor=s.ui.getByRole('region',{name:'Authenticated OpenFOAM job',exact:true});
  await monitor.getByRole('region',{name:'Worker artifacts',exact:true}).waitFor();
  assert.equal(await monitor.getByRole('alert').count(),0);
  assert.equal(submits,1);
});

test('native downloads, VTK viewing, resource controls, probe/flow graphs and CSV are connected',async t=>{
  let job:CFDWorkerJob,request:CFDSubmission;
  const vtk=Buffer.from('# vtk DataFile Version 3.0\nAudit slice\nASCII\nDATASET POLYDATA\nPOINTS 4 float\n0 0 0\n1 0 0\n1 1 0\n0 1 0\nPOLYGONS 1 5\n4 0 1 2 3\nPOINT_DATA 4\nSCALARS p float 1\nLOOKUP_TABLE default\n0 1 2 3\n');
  const zip=Buffer.from('504b0506000000000000000000000000000000000000','hex');
  const artifacts=[{id:'slice-0',kind:'vtk',size:vtk.length,sha256:hash(vtk)},{id:'native-case',kind:'zip',size:zip.length,sha256:hash(zip)}];
  const telemetry={version:1,truncated:false,warnings:[],
    balance:{tolerance:.05,fluxM3S:{p_a:-.005,p_b:.005},samples:[
      {iteration:1,incomingM3S:.005,outgoingM3S:.0045,netM3S:-.0005,relativeImbalance:.105263},
      {iteration:2,incomingM3S:.005,outgoingM3S:.005,netM3S:0,relativeImbalance:0}]},
    probes:[0,1].map(index=>({index,positionMm:[1000+index*100,500,250],samples:[
      {iteration:1,velocityMS:[1,2,3],pressureM2S2:.1},{iteration:2,velocityMS:[2,3,4],pressureM2S2:.2}]}))};
  const s=await open(t,async route=>{
    const url=new URL(route.request().url()),path=url.pathname;
    if(path.endsWith('/capabilities'))return route.fulfill({json:caps});
    if(path.endsWith('/jobs')&&route.request().method()==='POST'){
      request=route.request().postDataJSON();job={id:'55555555-5555-4555-8555-555555555555',studyId:request.studyId,clientRevision:request.clientRevision,phase:'Completed',progress:100,message:'Converged'};return route.fulfill({json:job});
    }
    if(path.endsWith('/jobs'))return route.fulfill({json:[]});
    if(path.endsWith('/logs')){const cursor=Number(url.searchParams.get('cursor'));return route.fulfill({json:{...job,cursor,nextCursor:Buffer.byteLength(log),text:cursor?'':log,telemetry}});}
    if(path.endsWith('/result'))return route.fulfill({json:{...job,jobId:job.id,sourceHash:request.sourceHash,configurationHash:request.configurationHash,pressureUnit:'m2/s2',accepted:true,artifacts,
      mesh:{cells:100,maxNonOrthogonality:3,maxSkewness:.2},conservation:{passed:true,relativeImbalance:0.001,tolerance:.05,fluxM3S:{p_a:-.005,p_b:.005}},convergence:{converged:true,target:1e-5,finalInitialResiduals:{Ux:1e-6,p:1e-6}}}});
    if(path.endsWith('/artifacts/native-case'))return route.fulfill({body:zip,contentType:'application/zip'});
    if(path.endsWith('/artifacts/slice-0'))return route.fulfill({body:vtk,contentType:'application/octet-stream'});
    return route.fulfill({json:job});
  });
  await cfdWindow(s.ui,'Solver');await s.ui.getByRole('tab',{name:'Run',exact:true}).click();
  await s.ui.getByRole('button',{name:'Use worker resource limits',exact:true}).click();
  await eventually(s.saved,p=>p.cfdScenarios[0].resources.cpu===1&&p.cfdScenarios[0].resources.wallTimeMinutes===15&&p.cfdScenarios[0].resources.memoryGb===4);
  await s.ui.getByRole('button',{name:'Run solver',exact:true}).click();
  await eventually(()=>job,Boolean);await cfdWindow(s.ui,'Solver');
  await s.ui.getByRole('tab',{name:'Run',exact:true}).click();
  await s.ui.getByRole('button',{name:'Open monitor',exact:true}).click();
  await s.ui.getByRole('button',{name:'Download native-case',exact:true}).waitFor();
  await s.ui.getByRole('img',{name:'Relative flow imbalance history (fraction)',exact:true}).waitFor();
  await s.ui.getByRole('img',{name:'Probe 1 speed history (m/s)',exact:true}).waitFor();
  await s.ui.getByRole('combobox',{name:'Probe to monitor',exact:true}).selectOption('1');
  await s.ui.getByRole('img',{name:'Probe 2 pressure history (m²/s²)',exact:true}).waitFor();
  await s.ui.getByRole('region',{name:'Final measured acceptance metrics',exact:true}).waitFor();
  const csv=s.page.waitForEvent('download');await s.ui.getByRole('button',{name:'Download telemetry CSV',exact:true}).click();
  const csvText=await readFile(await (await csv).path(),'utf8');assert.match(csvText,/probe,1,2,1000,500,250,2,3,4,0.2/);
  if(process.env.BROWSER_ARTIFACTS) await s.ui.getByRole('region',{name:'Measured worker telemetry',exact:true}).screenshot({path:`${process.env.BROWSER_ARTIFACTS}/openfoam-probes-desktop.png`});
  await s.page.setViewportSize({width:390,height:844});
  await eventually(()=>s.ui.locator('.cfx-setup-window').evaluate(e=>e.scrollWidth<=e.clientWidth+2),Boolean);
  await s.ui.getByRole('img',{name:'Probe 2 pressure history (m²/s²)',exact:true}).waitFor();
  if(process.env.BROWSER_ARTIFACTS) await s.page.screenshot({path:`${process.env.BROWSER_ARTIFACTS}/openfoam-probes-mobile.png`});
  await s.page.setViewportSize({width:1440,height:1000});
  const logDownload=s.page.waitForEvent('download');await s.ui.getByRole('button',{name:'Download worker log',exact:true}).click();
  assert.match((await logDownload).suggestedFilename(),/\.log$/);
  const download=s.page.waitForEvent('download');await s.ui.getByRole('button',{name:'Download native-case',exact:true}).click();
  assert.match((await download).suggestedFilename(),/native-case\.zip$/);
  await s.ui.getByRole('button',{name:'View slice-0',exact:true}).click();
  await s.ui.getByText(/Authenticated worker job 55555555/).waitFor();
  const viewer=s.ui.getByRole('region',{name:'VTK results viewer',exact:true});
  await viewer.getByRole('status').filter({hasText:/4 points.*1 cell/}).waitFor();
  await viewer.getByRole('button',{name:'Zoom VTK in',exact:true}).click();
  await viewer.getByRole('button',{name:'Zoom VTK out',exact:true}).click();
  await viewer.getByRole('button',{name:'Fit',exact:true}).click();
  const original=s.page.waitForEvent('download');await viewer.getByRole('button',{name:'Download full original data',exact:true}).click();
  assert.match((await original).suggestedFilename(),/slice-0\.vtk$/);
  assert.equal(await s.ui.getByRole('alert').count(),0);
  await viewer.getByRole('button',{name:'Back to geometry',exact:true}).click();

});

test('a definite 422 rejection releases its payload so corrected settings get a fresh submission',async t=>{
  const requests:CFDSubmission[]=[];
  const s=await open(t,async route=>{
    const path=new URL(route.request().url()).pathname;
    if(path.endsWith('/capabilities'))return route.fulfill({json:caps});
    if(path.endsWith('/jobs')&&route.request().method()==='POST'){
      requests.push(route.request().postDataJSON());
      if(requests.length===1)return route.fulfill({status:422,json:{detail:'Worker limit: cpu must be at most 1. Change the study explicitly.'}});
      const request=requests[1];return route.fulfill({json:{id:'66666666-6666-4666-8666-666666666666',studyId:request.studyId,clientRevision:request.clientRevision,phase:'Completed',progress:100,message:'Accepted corrected input'}});
    }
    return route.fulfill({json:[]});
  });
  await s.ui.getByRole('button',{name:'Run Office airflow',exact:true}).click();
  await s.ui.getByText(/Worker limit: cpu must be at most 1/).waitFor();
  await s.ui.getByText('Not submitted',{exact:true}).waitFor();
  assert.ok(await s.ui.getByRole('button',{name:'Delete Office airflow',exact:true}).isEnabled());
  await s.ui.getByRole('button',{name:'View issues for Office airflow',exact:true}).click();
  await s.ui.getByRole('tabpanel',{name:'Warnings & checks',exact:true}).getByRole('alert').filter({hasText:'Worker submission or status'}).waitFor();
  assert.equal(requests[0].scenario.resources.cpu,4);
  await cfdWindow(s.ui,'Solver');await s.ui.getByRole('tab',{name:'Run',exact:true}).click();
  await s.ui.getByRole('button',{name:'Use worker resource limits',exact:true}).click();
  await eventually(s.saved,p=>p.cfdScenarios[0].resources.cpu===1);
  assert.equal(await s.ui.locator('.cfx-worker-compatibility').count(),0);
  await s.ui.getByRole('button',{name:'Run solver',exact:true}).click();
  await eventually(()=>requests.length,n=>n===2);
  assert.equal(requests[1].scenario.resources.cpu,1);
  assert.notEqual(requests[0].submissionId,requests[1].submissionId);
  await s.ui.getByText('Completed',{exact:true}).waitFor();
});

test('manual result retry is a read-only recovery action and works without reopening the monitor',async t=>{
  let job:CFDWorkerJob,submits=0,results=0,available=false;
  const s=await open(t,async route=>{
    const url=new URL(route.request().url()),path=url.pathname;
    if(path.endsWith('/capabilities'))return route.fulfill({json:caps});
    if(path.endsWith('/jobs')&&route.request().method()==='POST'){
      submits++;const request=route.request().postDataJSON();job={id:'77777777-7777-4777-8777-777777777777',studyId:request.studyId,
        clientRevision:request.clientRevision,phase:'Completed',progress:100,message:'Completed'};
      return route.fulfill({json:job});
    }
    if(path.endsWith('/jobs'))return route.fulfill({json:[]});
    if(path.endsWith('/logs'))return route.fulfill({json:{...job,cursor:0,nextCursor:0,text:''}});
    if(path.endsWith('/result')){
      results++;return route.fulfill(available?{json:{...job,jobId:job.id,sourceHash:'a'.repeat(64),configurationHash:'b'.repeat(64),pressureUnit:'m2/s2',accepted:true,artifacts:[]}}:
        {status:503,json:{detail:'Results temporarily unavailable'}});
    }
    return route.fulfill({json:job});
  });
  await s.ui.getByRole('button',{name:'Run Office airflow',exact:true}).click();
  await eventually(()=>job,Boolean);await cfdWindow(s.ui,'Convergence monitor');
  const retry=s.ui.getByRole('button',{name:'Retry loading results',exact:true});await retry.waitFor();
  const previous=results;available=true;await retry.click();
  await s.ui.getByRole('region',{name:'Worker artifacts',exact:true}).waitFor();
  assert.ok(results>previous);assert.equal(submits,1);
});

test('storage failure before dispatch never starts an unrecoverable paid job',async t=>{
  let submits=0;
  const s=await open(t,async route=>{
    const path=new URL(route.request().url()).pathname;
    if(path.endsWith('/capabilities'))return route.fulfill({json:caps});
    if(route.request().method()==='POST')submits++;
    return route.fulfill({json:[]});
  });
  await s.page.evaluate(()=>{
    const write=Storage.prototype.setItem;
    Storage.prototype.setItem=function(key,value){if(key.startsWith('freefloorplan3d:cfd-pending:'))throw new DOMException('Storage is full','QuotaExceededError');write.call(this,key,value);};
  });
  await s.ui.getByRole('button',{name:'Run Office airflow',exact:true}).click();
  await s.ui.getByText(/No job was sent; free browser storage/).waitFor();
  assert.equal(submits,0);
  assert.ok(await s.ui.getByRole('button',{name:'Delete Office airflow',exact:true}).isEnabled());
});
