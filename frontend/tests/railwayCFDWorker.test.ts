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
  const planes=Array.from({length:250},(_,i)=>({id:`slice-${i}`,kind:'vtk',size:1,sha256:'a'.repeat(64)}));
  const archives=['native-case','postprocessing'].map(id=>({id,kind:'zip',size:1,sha256:'a'.repeat(64)}));
  response={...result,artifacts:[...planes,...archives]};
  assert.equal((await adapter.result(job,new AbortController().signal)).artifacts.length,252);
  response={...result,artifacts:[...planes,...archives,planes[0]]};
  await assert.rejects(adapter.result(job,new AbortController().signal));
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
  const rasterRequest={...request,point:undefined};
  const raster={...pointResult,point:undefined,probe:undefined,size:16,bounds:[0,0,1,1],a:Array(256).fill(10),b:null,delta:Array(256).fill(null),range:[10,10],
    statistics:{valid:0,missing:256,coverage:0,min:null,max:null,mean:null,rms:null,commonAreaM2:0,method:'Uniform grid'}};
  response=raster;
  await assert.rejects(adapter.sliceData(rasterRequest,new AbortController().signal),/resolution/);
  assert.equal((await adapter.sliceData({...rasterRequest,size:16},new AbortController().signal)).size,16);
  const retained=Array.from({length:2500},(_,i)=>({id:i.toString(16).padStart(64,'0'),sha256:'a'.repeat(64),name:`slice-${i%250}.vtk`,axis:'Z',coordinate:(i%250+1)/251,time:String(100+Math.floor(i/250)),status:'ready',bounds:[0,0,1,1],fields:[{name:'U',components:3,cell:false,unit:'m/s'}],method:'Native sampling '+'.'.repeat(480)}));
  const inventory={schemaVersion:1,runId:id,projectId:capabilities.namespace,studyId:'study',name:'Retained planes',createdAt:1,updatedAt:1,status:'Completed',message:'',sourceHash:'a'.repeat(64),configurationHash:'b'.repeat(64),revision:'c'.repeat(64),frame:'global-XYZ-m-Z-up',solver:'simpleFoam',timeKind:'steady-iteration',pressureReference:'d'.repeat(64),planes:retained,warnings:[],pending:0};
  assert.ok(new TextEncoder().encode(JSON.stringify(inventory)).length>1024**2);
  response=inventory;
  assert.equal((await adapter.slices(id,capabilities.namespace,new AbortController().signal)).planes.length,2500);
  response={...inventory,planes:[...retained,retained[0]]};
  await assert.rejects(adapter.slices(id,capabilities.namespace,new AbortController().signal));
});

test("worker capabilities cannot advertise limits above the approved deployment",()=>{
  assert.equal(workerCapabilitiesSchema.safeParse({...capabilities,limits:{...capabilities.limits,cpu:8}}).success,false);
  assert.equal(workerCapabilitiesSchema.safeParse({...capabilities,limits:{...capabilities.limits,memoryGb:8}}).success,false);
  assert.equal(workerCapabilitiesSchema.safeParse({...capabilities,limits:{...capabilities.limits,maxCells:500001}}).success,false);
  for (const limits of [{cpu:0}, {cpu:1.5}, {cpu:-1}, {memoryGb:0}, {wallTimeMinutes:0}])
    assert.equal(workerCapabilitiesSchema.safeParse({...capabilities,limits:{...capabilities.limits,...limits}}).success,false);
});

test("free quota remains explicit and cannot claim inconsistent remaining simulations",()=>{
  const simulationQuota={tier:"free",period:"lifetime",limit:5,completed:4,remaining:1};
  assert.equal(workerCapabilitiesSchema.parse({...capabilities,simulationQuota}).simulationQuota?.remaining,1);
  assert.equal(workerCapabilitiesSchema.safeParse({...capabilities,simulationQuota:{...simulationQuota,remaining:5}}).success,false);
  assert.equal(workerCapabilitiesSchema.safeParse({...capabilities,simulationQuota:{...simulationQuota,limit:10}}).success,false);
  assert.equal(workerCapabilitiesSchema.parse({...capabilities,run:false,simulationQuota:{...simulationQuota,completed:7,remaining:0}}).connected,true);
});
