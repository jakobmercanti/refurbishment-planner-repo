import test from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ElectricalLightingTest } from '../components/ElectricalLightingTest';
import { simulateLighting } from '../lib/electricalSimulation';
import { DEFAULT_ELECTRICAL_LAYOUT, createElectricalConnection } from '../lib/electricalLayout';
import { electricalPlanEndpoint, gangBadgePosition, GANG_BADGE_WIDTH, GANG_BADGE_HEIGHT, GANG_BADGE_PITCH } from '../lib/electricalPlanPorts';
import { electricalCrossings } from '../lib/electricalCrossings';
import { newAssembly } from '../lib/energyDocument';
import { reorderConstructionLayer } from '../lib/energyWallConstruction';
import { newHeatingProject, parseHeatingProject } from '../lib/heatingDocument';
import { newHeatingRadiator, newUFHZone, heatingResults } from '../lib/heatingDesign';
import { calculateUFHOutput, ufhPerformanceIssue, radiatorPlacementWarnings } from '../lib/heatingCalculations';
import { commitHeatingElements, withHeatingElements } from '../lib/heatingElements';
import { resetRoomHeating } from '../lib/heatingRoomReset';
import type { Room, Obstacle } from '../lib/types';
const measure = (value:number) => ({value,uncertainty_mm:0,verified:true,source_type:'USER_MEASURED'});
const room:Room={id:'a',name:'Room A',version:1,vertices:[{x:0,y:0},{x:5000,y:0},{x:5000,y:4000},{x:0,y:4000}],wall_height:measure(2500),wall_thickness:measure(100),openings:[],obstacles:[]};
const other:Room={...room,id:'b',name:'Room B',vertices:room.vertices.map(p=>({x:p.x+5000,y:p.y}))};
const fixture:Obstacle={id:'switch',name:'Quad',kind:'BOX',center:{x:1000,y:2000},rotation_deg:0,dimensions:{width:measure(146),depth:measure(20),height:measure(86)},representation_key:'electrical-switch-quadruple'};
const circuitId=DEFAULT_ELECTRICAL_LAYOUT.circuits[0].id;
const wire=(gang:number)=>createElectricalConnection({fromId:'switch',toId:'light',fromSwitchGang:gang,circuitId},[])!;

test('gang badges have no bounding-box overlap at any rotation or zoom',()=>{
 for(const count of [2,3,4]) for(let angle=0;angle<360;angle++) {
  const rad=angle*Math.PI/180, points=Array.from({length:count},(_,i)=>gangBadgePosition(count,i,48));
  for(let i=0;i<points.length;i++) for(let j=i+1;j<points.length;j++) {
   const dx=(points[j].x-points[i].x)*Math.cos(rad),dy=(points[j].x-points[i].x)*Math.sin(rad);
   assert.ok(Math.abs(dx)>=GANG_BADGE_WIDTH || Math.abs(dy)>=GANG_BADGE_HEIGHT,`${count} gangs at ${angle}° overlap`);
  }
 }
});
test('routes have distinct gang ports for forward, reverse, rotated and scaled switches without modifying geometry',()=>{
 for(const scale of [.05,.3,2]) for(const rotation_deg of [0,90,180,270]) {
  const item={...fixture,rotation_deg}, screen=(p:{x:number,y:number})=>({x:p.x*scale+100,y:500-p.y*scale});
  const points=[1,2,3,4].map(g=>electricalPlanEndpoint(wire(g),'from',item,screen,true));
  assert.equal(new Set(points.map(p=>JSON.stringify(p))).size,4);
  assert.equal(electricalPlanEndpoint(wire(1),'from',item,screen,false),item.center);
  assert.deepEqual(electricalPlanEndpoint({...wire(3),fromId:'light',toId:'switch',toSwitchGang:3},'to',item,screen,true),points[2]);
  const p1=screen(points[0]),p2=screen(points[1]);assert.ok(Math.abs(Math.hypot(p2.x-p1.x,p2.y-p1.y)-GANG_BADGE_PITCH)<1e-8);
 }
 assert.equal(fixture.dimensions.width.value,146);
});
test('display crossing detection uses the same precise endpoints, without changing default world routes',()=>{
 const light={...fixture,id:'light',representation_key:'electrical-ceiling-downlight',center:{x:4000,y:1500}};
 const layout={...DEFAULT_ELECTRICAL_LAYOUT,connections:[wire(1),wire(4)]};
 const screen=(p:{x:number,y:number})=>({x:p.x*.2,y:-p.y*.2});
 const crossings=electricalCrossings(layout,[fixture,light],(c,s,f)=>electricalPlanEndpoint(c,s,f,screen,true));
 assert.ok(crossings.every(c=>!c.sharedEndpoint || Math.hypot(c.position.x-light.center.x,c.position.y-light.center.y)<.01));
 assert.deepEqual(layout.connections,[wire(1),wire(4)].map((w,i)=>({...w,id:layout.connections[i].id}))); // IDs otherwise randomly generated
});
test('lighting circuits expose explicit disclosure arrows',()=>{
 const html=renderToStaticMarkup(createElement(ElectricalLightingTest,{layout:DEFAULT_ELECTRICAL_LAYOUT,fixtures:[],result:{groups:[],lights:{},contacts:{},warnings:[],switchLabels:{}},positions:{},onToggle(){},onReset(){}}));
 assert.match(html,/electrical-test-disclosure/);assert.match(html,/▶/);
});
test('joined crossings remain logically and visually joined across readable port positions and zoom',()=>{
 const s2={...fixture,id:'s2',representation_key:'electrical-switch-single',center:{x:2500,y:3500}};
 const l1={...fixture,id:'light',representation_key:'electrical-ceiling-downlight',center:{x:4000,y:2000}};
 const l2={...l1,id:'l2',center:{x:2500,y:500}};
 const items=[fixture,s2,l1,l2],connections=[wire(2),createElectricalConnection({fromId:'s2',toId:'l2',circuitId},[])!];
 for(const forceOrthogonalRouting of [false,true]) {
 const data={...DEFAULT_ELECTRICAL_LAYOUT,forceOrthogonalRouting,connections};
 const crossing=electricalCrossings(data,items).find(c=>c.canJoin)!;
 assert.ok(crossing);
 const joined={...data,junctions:[{junctionId:'join',connectionIds:crossing.connectionIds,position:crossing.position}]};
 assert.equal(simulateLighting(joined,items,{}).groups.length,1);
 for(const scale of [.1,.3,1]) {
  const screen=(p:{x:number,y:number})=>({x:p.x*scale,y:-p.y*scale});
  const shown=electricalCrossings(joined,items,(c,s,f)=>electricalPlanEndpoint(c,s,f,screen,true));
  assert.ok(shown.some(c=>c.connected && !c.sharedEndpoint),`Join lost at zoom ${scale}`);
 }
 assert.deepEqual(joined.junctions[0].position,crossing.position);
 }
});
test('layer drag reorder keeps identity, colour and thermal overrides; invalid drops are no-ops',()=>{
 const a=newAssembly({name:'Test',category:'wall',materials:[['custom-0',50],['pir-tw55',100],['plasterboard',12.5]]});
 a.layers=a.layers.map((l,i)=>({...l,colorHex:['#aa0000','#00bb00','#0000cc'][i],lambdaOverride:.1+i}));
 const next=reorderConstructionLayer(a,a.layers[0].layerId,a.layers[2].layerId);
 assert.deepEqual(next.layers,[a.layers[1],a.layers[2],a.layers[0]]);assert.equal(next.layers[2],a.layers[0]);assert.notEqual(next.layers,a.layers);
 assert.deepEqual(reorderConstructionLayer(next,a.layers[0].layerId,a.layers[1].layerId).layers,a.layers);
 assert.equal(reorderConstructionLayer(a,'missing',a.layers[1].layerId),a);
});
test('room reset removes placed heating and its circuits, preserving other rooms, settings and shared manifolds',()=>{
 const data=newHeatingProject(), a={...newHeatingRadiator(room),ratedOutputW:1000}, b={...newHeatingRadiator(other),ratedOutputW:2000};
 data.radiators=[a,b];const za=newUFHZone(room,'shared'),zb=newUFHZone(other,'shared');data.ufhZones=[za,zb];
 data.manifolds=[{manifoldId:'shared',name:'Shared',positionMm:{x:1000,y:1000},rotationDeg:0,ports:4},{manifoldId:'local',name:'Local',positionMm:{x:2000,y:1000},rotationDeg:0,ports:2}];
 const path=[{x:1000,y:1000},{x:2000,y:1000}];
 data.ufhCircuits=[za,zb].map(z=>({circuitId:z.zoneId,zoneId:z.zoneId,manifoldId:'shared',name:z.name,pipeType:z.pipeType,diameterMm:z.diameterMm,spacingMm:z.spacingMm,pathMm:path,supplyPathMm:path,returnPathMm:path,pattern:'Serpentine',locked:false,manuallyEdited:false,generationWarnings:[]}));
 data.exclusions=[{exclusionId:'e',roomId:room.id,name:'Cabinet',polygonMm:[...path,{x:2000,y:2000}]}];
 data.pipes=[{pipeId:'p',name:'A',fromId:a.radiatorId,toId:'shared',kind:'Supply',diameterMm:15,pathMm:path,locked:false},{pipeId:'q',name:'B',fromId:b.radiatorId,toId:'shared',kind:'Supply',diameterMm:15,pathMm:path,locked:false}];
 const reset=parseHeatingProject(resetRoomHeating(data,room));
 assert.deepEqual(reset.radiators,[b]);assert.deepEqual(reset.ufhZones,[zb]);assert.equal(reset.ufhCircuits.length,1);assert.equal(reset.exclusions.length,0);
 assert.deepEqual(reset.manifolds,[data.manifolds[0]]);assert.deepEqual(reset.pipes,[data.pipes[1]]);assert.equal(reset.rooms[0].selectedEmitterType,"None");assert.equal(reset.rooms[0].designIndoorTemperatureC,20);assert.deepEqual(reset.buildingSettings,data.buildingSettings);
 const stored=commitHeatingElements(data,[room,other]);const view=withHeatingElements(stored.heatingLayout,stored.rooms);
 const committed=commitHeatingElements(resetRoomHeating(view,room),stored.rooms);
 assert.equal(committed.rooms[0].obstacles.length,0);assert.equal(committed.rooms[1].obstacles.length,1);
 assert.equal(withHeatingElements(committed.heatingLayout,committed.rooms).radiators.length,1);
});
test('wall-snapped emitter metadata is reconstructed after persistence, not after it is moved away',()=>{
 const r={...newHeatingRadiator(room),ratedOutputW:1000};const stored=commitHeatingElements({...newHeatingProject(),radiators:[r]},[room]);
 const restored=withHeatingElements(stored.heatingLayout,stored.rooms).radiators[0];
 assert.equal(restored.wallIndex,r.wallIndex);assert.ok(!radiatorPlacementWarnings(restored,stored.rooms[0]).some(w=>w.includes('Not wall-snapped')));
 stored.rooms[0].obstacles[0].center={x:2500,y:2000};const moved=withHeatingElements(stored.heatingLayout,stored.rooms).radiators[0];
 assert.equal(moved.wallIndex,undefined);assert.ok(radiatorPlacementWarnings(moved,stored.rooms[0]).some(w=>w.includes('Not wall-snapped')));
 stored.rooms[0].obstacles[0]={...stored.rooms[0].obstacles[0],wall_lock:true,center:{x:1500,y:101},rotation_deg:180};
 const locked=withHeatingElements(stored.heatingLayout,stored.rooms).radiators[0];assert.equal(locked.wallIndex,0);assert.equal(locked.positionAlongWallMm,1500);
});
test('fully defined UFH inputs still need matching tested data, and warnings report the actual missing conditions',()=>{
 const z=newUFHZone(room,null);assert.match(ufhPerformanceIssue(z,45,40,30),/table missing/);
 z.performanceDataset={name:'Test',reference:'Test only',pipeDiameterMm:16,floorConstruction:z.floorConstruction,points:[{spacingMm:200,floorResistance:.01,flowC:45,returnC:40,roomC:20,outputWm2:50,surfaceTemperatureC:27}]};
 assert.equal(calculateUFHOutput(z,45,40,20)?.outputWm2,50);assert.equal(calculateUFHOutput(z,45,40,30),null);
 assert.match(ufhPerformanceIssue(z,45,40,30),/45\/40\/30°C/);assert.match(ufhPerformanceIssue({...z,diameterMm:20},45,40,20),/diameter 20 mm/);
 const result=heatingResults([room],{...newHeatingProject(),ufhZones:[z]});assert.ok(result.rooms[0].warnings.some(w=>w.includes('coverage 0.0')));
 assert.equal(result.rooms[0].capacityComparisonValid,false);
});
