import test from 'node:test';
import 'fake-indexeddb/auto';
import assert from 'node:assert/strict';
import { newHeatingProject, parseHeatingProject, heatingElementSpecSchema } from '../lib/heatingDocument';
import { withHeatingElements, commitHeatingElements, radiatorFromElement } from '../lib/heatingElements';
import { newHeatingRadiator, heatingResults } from '../lib/heatingDesign';
import { refreshHeatingPipeEndpoints, heatingPipeLengthM } from '../lib/heatingPipes';
import { newProject, parseProject } from '../lib/projectDocument';
import { exportProject, importProject } from '../lib/projectPackage';
import type { Room } from '../lib/types';
const measure = (value:number) => ({value, uncertainty_mm:0,verified:true,source_type:'USER_MEASURED'});
const room:Room={id:'room',name:'Room',version:1,vertices:[{x:0,y:0},{x:5000,y:0},{x:5000,y:4000},{x:0,y:4000}],wall_height:measure(2500),wall_thickness:measure(100),openings:[],obstacles:[]};
test('API null optional metadata and sound levels normalize without suppressing invalid values',()=>{
 const r={...newHeatingRadiator(room),catalogueItemId:null,performanceReference:null,manufacturerPerformanceData:[{flowC:45,returnC:40,roomC:20,outputW:600,electricalW:5,fanMode:'Normal',soundDb:null}]};
 const parsed=parseHeatingProject({...newHeatingProject(),radiators:[r]});assert.equal(parsed.radiators[0].catalogueItemId,undefined);assert.equal(parsed.radiators[0].manufacturerPerformanceData[0].soundDb,undefined);
 assert.equal(heatingElementSpecSchema.safeParse({...r,catalogueItemId:123}).success,false);
});
test('boiler provides an endpoint and persisted CH rating, but not room-emitter capacity',()=>{
 const boiler={...newHeatingRadiator(room),category:'Boiler' as const,ratedOutputW:24000,model:'System boiler'};
 const data={...newHeatingProject(),radiators:[boiler]};const result=heatingResults([room],data);assert.equal(result.rooms[0].emitters[0].outputW,0);
 const stored=commitHeatingElements(data,[room]);const view=withHeatingElements(stored.heatingLayout,stored.rooms);assert.equal(view.radiators[0].ratedOutputW,24000);assert.notEqual(view.radiators[0].estimatedOutput,true);
});
test('square heating routes retain waypoints and endpoints with no diagonal segments',()=>{
 const data={...newHeatingProject(),pipes:[{pipeId:'p',name:'Hot supply',kind:'Supply' as const,diameterMm:15,locked:false,pathMm:[{x:0,y:0},{x:100,y:200},{x:300,y:400}]}]};
 const path=refreshHeatingPipeEndpoints(data).pipes[0].pathMm;assert.deepEqual(path[0],{x:0,y:0});assert.deepEqual(path.at(-1),{x:300,y:400});assert.ok(path.some(p=>p.x===100&&p.y===200));assert.ok(path.slice(1).every((p,i)=>p.x===path[i].x||p.y===path[i].y));
});
test('legacy heating geometry migrates to one placed object and remains idempotent',()=>{
 const data=newHeatingProject();const r=newHeatingRadiator(room);data.radiators=[r];
 const stored=commitHeatingElements(data,[room]);assert.equal(stored.heatingLayout.radiators.length,0);assert.equal(stored.rooms[0].obstacles.length,1);
 const view=withHeatingElements(stored.heatingLayout,stored.rooms);assert.deepEqual(view.radiators[0],radiatorFromElement(stored.rooms[0].obstacles[0],room));
 assert.deepEqual(commitHeatingElements(view,stored.rooms),stored);
 const resized=structuredClone(stored.rooms);resized[0].obstacles[0].dimensions.width.value=1500;
 assert.equal(withHeatingElements(stored.heatingLayout,resized).radiators[0].widthMm,1500);
 const deleted=commitHeatingElements({...view,radiators:[]},stored.rooms);assert.equal(deleted.rooms[0].obstacles.length,0);assert.equal(withHeatingElements(deleted.heatingLayout,deleted.rooms).radiators.length,0);
});
test('old ordinary catalogue radiators have explicitly estimated surrogate capacity',()=>{
 const data=newHeatingProject(),r=newHeatingRadiator(room),stored=commitHeatingElements({...data,radiators:[r]},[room]);delete stored.rooms[0].obstacles[0].heating_spec;
 const view=withHeatingElements(data,stored.rooms);assert.equal(view.radiators.length,1);assert.equal(view.radiators[0].ratedOutputW,1709);assert.equal(view.radiators[0].estimatedOutput,true);
});
test('technical edits and undo recovery preserve measured dimensions and catalogue appearance',()=>{
 const r=newHeatingRadiator(room),data=newHeatingProject(),stored=commitHeatingElements({...data,radiators:[r]},[room]);
 const item=stored.rooms[0].obstacles[0];item.representation_key='furniture-radiator-vertical-1-450';item.color_hex='#123456';item.dimensions.width.verified=true;item.dimensions.width.uncertainty_mm=7;
 const view=withHeatingElements(stored.heatingLayout,stored.rooms),edited={...view,radiators:view.radiators.map(r=>({...r,ratedOutputW:1234}))};
 const committed=commitHeatingElements(edited,stored.rooms);assert.deepEqual(committed.rooms[0].obstacles[0].dimensions.width,item.dimensions.width);
 const deleted=commitHeatingElements({...view,radiators:[]},stored.rooms),restored=commitHeatingElements(view,deleted.rooms);
 assert.equal(restored.rooms[0].obstacles[0].representation_key,item.representation_key);assert.equal(restored.rooms[0].obstacles[0].color_hex,item.color_hex);
});
test('linked pipe endpoints follow radiators without overwriting manually edited corners',()=>{
 const r=newHeatingRadiator(room),data={...newHeatingProject(),forceOrthogonalRouting:false,radiators:[r],pipes:[{pipeId:'pipe',fromId:r.radiatorId,name:'Supply',kind:'Supply' as const,diameterMm:15,locked:false,pathMm:[{x:10,y:10},{x:2000,y:3000},{x:5000,y:4000}]}]};
 const updated=refreshHeatingPipeEndpoints(data);assert.deepEqual(updated.pipes[0].pathMm[0],r.positionMm);assert.deepEqual(updated.pipes[0].pathMm[1],data.pipes[0].pathMm[1]);assert.equal(heatingPipeLengthM([{x:0,y:0},{x:3000,y:4000}]),5);
});
test('portable project preserves technical specs and edited pipes with no second radiator source',async()=>{
 const p=newProject(),data=newHeatingProject();data.radiators=[newHeatingRadiator(room)];data.pipes=[{pipeId:'pipe',name:'Manual return',kind:'Return',diameterMm:16,locked:true,pathMm:[{x:1,y:2},{x:3000,y:2},{x:3000,y:4000}]}];p.rooms=[room];p.heatingLayout=data;
 const saved=await importProject(await exportProject(p));assert.equal(saved.heatingLayout!.radiators.length,0);assert.equal(saved.rooms[0].obstacles.length,1);assert.deepEqual(saved.heatingLayout!.pipes,data.pipes);
 assert.equal(withHeatingElements(saved.heatingLayout!,saved.rooms).radiators.length,1);assert.deepEqual(parseProject(saved),saved);
});
