import assert from "node:assert/strict";
import test from "node:test";
import { railwayCFDWorker, workerCapabilitiesSchema } from "../lib/railwayCFDWorker";

const capabilities = workerCapabilitiesSchema.parse({connected:true,mesh:true,run:true,reason:"Checked runtime",
  namespace:"11111111-1111-4111-8111-111111111111",limits:{cpu:2,memoryGb:4,wallTimeMinutes:15,storageGb:1,retentionDays:3,maxCells:500000,concurrentJobs:1}});

test("HTTP adapter keeps bearer credentials out of URLs and rejects wrong job/log provenance", async t => {
  const originalWindow = Object.getOwnPropertyDescriptor(globalThis,"window");
  const originalStorage = Object.getOwnPropertyDescriptor(globalThis,"sessionStorage");
  Object.defineProperty(globalThis,"window",{configurable:true,value:{}});
  Object.defineProperty(globalThis,"sessionStorage",{configurable:true,value:{getItem:()=>JSON.stringify({access_token:"opaque-token",refresh_token:"refresh",expires_at:Math.floor(Date.now()/1000)+3600,user:{id:capabilities.namespace}})}});
  t.after(()=>{
    if(originalWindow) Object.defineProperty(globalThis,"window",originalWindow); else Reflect.deleteProperty(globalThis,"window");
    if(originalStorage) Object.defineProperty(globalThis,"sessionStorage",originalStorage); else Reflect.deleteProperty(globalThis,"sessionStorage");
  });
  const id="22222222-2222-4222-8222-222222222222";
  const job={id,studyId:"study",clientRevision:"a".repeat(64),phase:"Running" as const,progress:null,message:""};
  let response:unknown={...job,cursor:0,nextCursor:9,text:"Time = 1\n"};
  t.mock.method(globalThis,"fetch",async(url: string | URL | Request, options?: RequestInit)=>{
    assert.ok(!String(url).includes("opaque-token"));
    assert.equal(new Headers(options?.headers).get("Authorization"),"Bearer opaque-token");
    assert.equal(options?.cache,"no-store");
    return Response.json(response);
  });
  const adapter=railwayCFDWorker("/engineering-api",capabilities);
  assert.equal((await adapter.logs(job,0,new AbortController().signal)).nextCursor,9);
  response={...job,studyId:"different",cursor:0,nextCursor:9,text:"Time = 1\n"};
  await assert.rejects(adapter.logs(job,0,new AbortController().signal),/different study/);
  response={...job,cursor:9,nextCursor:18,text:"Time = 2\n"};
  await assert.rejects(adapter.logs(job,0,new AbortController().signal),/Out-of-order/);
  const result={...job,jobId:id,sourceHash:"a".repeat(64),configurationHash:"b".repeat(64),pressureUnit:"m2/s2",accepted:false,artifacts:[],
    mesh:{cells:100,maxNonOrthogonality:3},convergence:{converged:false,target:1e-5,finalInitialResiduals:{p:.1}},
    conservation:{passed:false,relativeImbalance:.1,tolerance:.05,fluxM3S:{p_a:-.005,p_b:.0045}}};
  response=result;
  const measured=await adapter.result(job,new AbortController().signal);
  assert.equal(measured.mesh?.cells,100);
  assert.equal(measured.conservation?.relativeImbalance,.1);
  assert.equal(measured.convergence?.finalInitialResiduals?.p,.1);
  response={...result,pressureUnit:"Pa"};
  await assert.rejects(adapter.result(job,new AbortController().signal));
  const selection={runId:id,assetId:"c".repeat(64)};
  const request={projectId:capabilities.namespace,baseline:selection,field:"U",component:-1,size:96,deltaMode:"absolute" as const,epsilon:1e-6,temperature:"K" as const,point:[.25,.25,.5] as [number,number,number]};
  const pointResult={schemaVersion:1,baseline:{run:id,asset:selection.assetId,time:"100"},option:null,axis:"Z",coordinate:.5,field:"U",component:-1,unit:"m/s",deltaUnit:"m/s",deltaMode:"absolute",epsilon:1e-6,definition:"Option − Baseline",compatibility:[],method:"Actual source triangles",notes:[],point:request.point,probe:{baseline:{value:10,velocity:[10,0,0],method:"Barycentric source point data",reason:""},option:null,delta:null}};
  response=pointResult;
  assert.equal((await adapter.sliceData(request,new AbortController().signal)).probe?.baseline.value,10);
  response={...pointResult,point:[.75,.25,.5]};
  await assert.rejects(adapter.sliceData(request,new AbortController().signal),/coordinates/);
  response={...pointResult,deltaMode:"percent"};
  await assert.rejects(adapter.sliceData(request,new AbortController().signal),/settings/);
  response={...pointResult,baseline:{...pointResult.baseline,run:capabilities.namespace}};
  await assert.rejects(adapter.sliceData(request,new AbortController().signal),/current selection/);
});

test("worker capabilities cannot advertise limits above the approved deployment",()=>{
  assert.equal(workerCapabilitiesSchema.safeParse({...capabilities,limits:{...capabilities.limits,cpu:8}}).success,false);
  assert.equal(workerCapabilitiesSchema.safeParse({...capabilities,limits:{...capabilities.limits,memoryGb:8}}).success,false);
  for (const limits of [{cpu:0}, {cpu:1.5}, {cpu:-1}, {memoryGb:0}, {wallTimeMinutes:0}])
    assert.equal(workerCapabilitiesSchema.safeParse({...capabilities,limits:{...capabilities.limits,...limits}}).success,false);
});
