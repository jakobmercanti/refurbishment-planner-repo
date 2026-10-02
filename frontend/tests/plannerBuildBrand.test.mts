import test from 'node:test';
import assert from 'node:assert/strict';
import {isPlannerBuildHost,plannerBuildConsent,capturePlannerBuildEvent} from '../lib/plannerBuildBrand.ts';
import {analyticsEnabled,setAnalyticsEnabled} from '../lib/analyticsConsent.ts';
test('PlannerBuild consent is explicit, expires and does not affect the other brand',async()=>{
  const savedWindow=globalThis.window,savedStorage=globalThis.localStorage,savedFetch=globalThis.fetch;
  const values=new Map<string,string>();const store={getItem:(k:string)=>values.get(k)??null,setItem:(k:string,v:string)=>values.set(k,v),removeItem:(k:string)=>values.delete(k)};
  const win={location:{hostname:'plannerbuild.com'},dispatchEvent:()=>true,parent:null as unknown};win.parent=win;
  let body: {event:string;properties:Record<string,unknown>}|null=null;
  Object.defineProperty(globalThis,'window',{value:win,configurable:true});Object.defineProperty(globalThis,'localStorage',{value:store,configurable:true});
  globalThis.fetch=async(_input,init)=>{body=JSON.parse(String(init?.body));return new Response(null,{status:204});};
  try{
    assert(isPlannerBuildHost());assert(!plannerBuildConsent());assert(!analyticsEnabled());capturePlannerBuildEvent('project_started','private-local-id');assert.equal(body,null);
    setAnalyticsEnabled(true);assert(plannerBuildConsent());assert(analyticsEnabled());capturePlannerBuildEvent('project_started','private-local-id');assert.equal(body!.event,'project_started');assert(!JSON.stringify(body).includes('private-local-id'));
    body=null;capturePlannerBuildEvent('project_started','private-local-id');assert.equal(body,null);
    store.setItem('plannerbuild-privacy-v2',JSON.stringify({analytics:true,expires:1}));assert(!analyticsEnabled());
    win.location.hostname='www.freefloorplan3d.com';assert(!isPlannerBuildHost());assert(analyticsEnabled());
    store.setItem('ffp3d_analytics_opt_out','true');assert(!analyticsEnabled());
  }finally{Object.defineProperty(globalThis,'window',{value:savedWindow,configurable:true});Object.defineProperty(globalThis,'localStorage',{value:savedStorage,configurable:true});globalThis.fetch=savedFetch;}
});
