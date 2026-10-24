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
  response={...job,jobId:id,sourceHash:"a".repeat(64),configurationHash:"b".repeat(64),pressureUnit:"Pa",accepted:true,artifacts:[]};
  await assert.rejects(adapter.result(job,new AbortController().signal));
});

test("worker capabilities cannot advertise limits above the approved deployment",()=>{
  assert.equal(workerCapabilitiesSchema.safeParse({...capabilities,limits:{...capabilities.limits,cpu:8}}).success,false);
  assert.equal(workerCapabilitiesSchema.safeParse({...capabilities,limits:{...capabilities.limits,memoryGb:8}}).success,false);
});
