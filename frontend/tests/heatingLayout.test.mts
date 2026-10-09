import test from 'node:test';
import assert from 'node:assert/strict';
import { PDFDocument } from 'pdf-lib';
import 'fake-indexeddb/auto';
import type { Room, Point2D } from '../lib/types.ts';
import { newHeatingProject, parseHeatingProject } from '../lib/heatingDocument.ts';
import { calculateFabricLoss, calculateVentilationLoss, calculateRoomHeatLoss, calculateRadiatorOutput, calculateElectricEmitterSize, calculateUFHOutput, lookupHybridRadiatorOutput, calculateCircuitLength, calculateUFHFlowRate, calculatePressureDrop, thermalRoom, snapRadiatorToWall, radiatorPlacementWarnings, geometryFingerprint } from '../lib/heatingCalculations.ts';
import { activeUFHAreaM2, generateUFHLoops, pipeSegmentAllowed, splitPathByLength } from '../lib/heatingGeometry.ts';
import { newUFHZone, newHeatingRadiator, heatingResults, autoDesignHeating, regenerateHeatingRoom, splitHeatingCircuit } from '../lib/heatingDesign.ts';
import { newProject, parseProject } from '../lib/projectDocument.ts';
import { exportProject, importProject } from '../lib/projectPackage.ts';
import { LocalProjectRepository } from '../lib/projectRepository.ts';
import { buildHeatingPdf, heatingScheduleCsv } from '../lib/heatingExport.ts';
import { REFERENCE_RADIATORS, REFERENCE_UFH_DATASETS, referenceRadiatorForRoom } from '../lib/heatingCatalogue.ts';
const measured = (value: number) => ({ value, uncertainty_mm: 0, verified: true, source_type: 'USER_MEASURED' });
function room(vertices: Point2D[] = [{x:0,y:0},{x:5000,y:0},{x:5000,y:4000},{x:0,y:4000}], id='room-test'): Room { return { id, name:'Living room', version:1, vertices, wall_height:measured(2500), wall_thickness:measured(100), openings:[], obstacles:[] }; }
const close = (actual: number, expected: number, tolerance=1e-6) => assert.ok(Math.abs(actual-expected)<=tolerance, `${actual} != ${expected}`);
function generatedFixture(shape=room(), manifoldPosition={x:2500,y:2000}) {
 const h = newHeatingProject(), m = {manifoldId:'mf-1', name:'Ground floor', positionMm:manifoldPosition, rotationDeg:0, ports:50}, z=newUFHZone(shape,m.manifoldId);h.manifolds=[m];h.ufhZones=[z];z.pattern='Serpentine';z.maxCircuitLengthM=55;return { h,m,z,r:shape };
}
test('transparent fabric and ventilation examples use m2/m3 and no hidden allowance',()=>{
 close(calculateFabricLoss(10,.3,20,0),60);close(calculateVentilationLoss(100,.5,20,0),330);
 const h=newHeatingProject(),r=room();h.buildingSettings.designAllowancePercent=0;const result=calculateRoomHeatLoss(r,[r],h);
 close(result.areaM2,20);close(result.volumeM3,50);close(result.perimeterM,18);close(result.totalW,result.designW);close(result.totalW,result.fabricW+result.ventilationW);
 h.buildingSettings.designAllowancePercent=10;close(calculateRoomHeatLoss(r,[r],h).designW,result.totalW*1.1);
});
test('shared, partially shared and manually overridden walls are not silently external',()=>{
 const a=room(),b=room([{x:5000,y:0},{x:9000,y:0},{x:9000,y:4000},{x:5000,y:4000}],'adjacent'),h=newHeatingProject();
 h.rooms=[{...thermalRoom(a,h),designTemperatureOverride:true,designIndoorTemperatureC:20},{...thermalRoom(b,h),designTemperatureOverride:true,designIndoorTemperatureC:20}];
 const result=calculateRoomHeatLoss(a,[a,b],h);close(result.internalWallAreaM2,10);assert.equal(result.surfaces.find(s=>s.key==='wall:1:0')?.lossW,0);
 h.rooms[0].walls['1']={boundary:'Unheated',adjacentTemperatureC:10,uValue:.5};close(calculateRoomHeatLoss(a,[a,b],h).surfaces.find(s=>s.key==='wall:1:0')!.lossW,50);
 const partial={...b,vertices:[{x:5000,y:1000},{x:9000,y:1000},{x:9000,y:3000},{x:5000,y:3000}]};h.rooms[0].walls={};close(calculateRoomHeatLoss(a,[a,partial],h).internalWallAreaM2,5);
});
test('opening areas are removed from opaque fabric without double counting',()=>{
 const r=room(),h=newHeatingProject();r.openings=[{id:'window-1',kind:'WINDOW',parent_wall_id:'wall-001',offset_mm:1000,width:measured(2000),height:measured(1000),sill_height_mm:900}];
 const loss=calculateRoomHeatLoss(r,[r],h);close(loss.windowAreaM2,2);close(loss.externalWallAreaM2,43);close(loss.surfaces.find(s=>s.key==='wall:0:0')!.areaM2,10.5);
});
test('room defaults and overrides remain explicit, results track geometry',()=>{
 const h=newHeatingProject(),r=room();assert.equal(thermalRoom(r,h).designIndoorTemperatureC,21);
 h.rooms=[{...thermalRoom(r,h),designTemperatureOverride:true,airChangeRateOverride:true,designIndoorTemperatureC:22,airChangeRate:.8}];assert.equal(calculateRoomHeatLoss(r,[r],h).targetC,22);
 const bigger={...r,vertices:r.vertices.map(p=>({x:p.x*2,y:p.y*2}))};assert.ok(calculateRoomHeatLoss(bigger,[bigger],h).designW>calculateRoomHeatLoss(r,[r],h).designW);
});
test('building presets remain live after choosing a method; explicit room overrides remain fixed',()=>{
 const h=newHeatingProject(),r=room();h.rooms=[{...thermalRoom(r,h),selectedEmitterType:'Electric Radiator'}];h.buildingSettings.airChangeRate=1;h.buildingSettings.roomTypeTemperatures['Living room']=22;
 assert.equal(thermalRoom(r,h).airChangeRate,1);assert.equal(thermalRoom(r,h).designIndoorTemperatureC,22);
 h.rooms[0]={...h.rooms[0],designTemperatureOverride:true,airChangeRateOverride:true,designIndoorTemperatureC:19,airChangeRate:.4};assert.equal(thermalRoom(r,h).airChangeRate,.4);assert.equal(thermalRoom(r,h).designIndoorTemperatureC,19);
});
test('hydronic ΔT50 returns rating; low water reduces output; electric has no correction',()=>{
 const r=newHeatingRadiator(room());r.ratedOutputW=2000;close(calculateRadiatorOutput(r,75,65,20).outputW!,2000);
 assert.ok(calculateRadiatorOutput(r,45,40,20).outputW!<2000);close(calculateRadiatorOutput(r,20,20,20).outputW!,0);
 r.emitterTechnology='Electric';close(calculateRadiatorOutput(r,35,30,20).outputW!,2000);close(calculateRadiatorOutput(r,35,30,20).electricalW,2000);
 r.ratedOutputW=null;assert.equal(calculateRadiatorOutput(r,75,65,20).outputW,null);
});
test('electric sizing finds smallest standard total including multiple units',()=>{
 assert.deepEqual(calculateElectricEmitterSize(1450),[1500]);close(calculateElectricEmitterSize(2750).reduce((a,b)=>a+b,0),2750);
 assert.equal(calculateElectricEmitterSize(0).length,0);assert.ok(calculateElectricEmitterSize(8500).reduce((a,b)=>a+b,0)>=8500);
});
test('hybrid performance is supplied/interpolated only inside complete grids',()=>{
 const points=[{flowC:40,returnC:35,roomC:20,fanMode:'Normal' as const,outputW:1000,electricalW:10},{flowC:50,returnC:35,roomC:20,fanMode:'Normal' as const,outputW:2000,electricalW:20}];
 close(lookupHybridRadiatorOutput(points,45,35,20,'Normal')!.outputW,1500);assert.equal(lookupHybridRadiatorOutput(points,45,35,20,'Normal')!.interpolated,true);
 assert.equal(lookupHybridRadiatorOutput(points,55,35,20,'Normal'),null);assert.equal(lookupHybridRadiatorOutput(points,45,35,20,'Boost'),null);assert.equal(lookupHybridRadiatorOutput(points,45,40,20,'Normal'),null);
});
test('published reference radiators preserve exact product points and refuse hybrid extrapolation',()=>{
 const r=room(),purmo=referenceRadiatorForRoom(REFERENCE_RADIATORS.find(p=>p.catalogueId==='purmo-c22-600-1000')!,r);
 close(calculateRadiatorOutput(purmo,75,65,20).outputW!,1709);close(calculateRadiatorOutput(purmo,70,55,20).outputW!,1362);assert.equal(purmo.exponent,1.3358);
 const jaga=referenceRadiatorForRoom(REFERENCE_RADIATORS.find(p=>p.catalogueId==='jaga-strw-035-600-16')!,r);
 close(calculateRadiatorOutput(jaga,45,40,20).outputW!,624);close(calculateRadiatorOutput(jaga,35,30,20).electricalW,5.5);assert.equal(calculateRadiatorOutput(jaga,45,40,21).outputW,null);
 jaga.manufacturerPerformanceData[0].outputW=0;assert.notEqual(REFERENCE_RADIATORS.find(p=>p.catalogueId==='jaga-strw-035-600-16')!.manufacturerPerformanceData[0].outputW,0);
 const h=newHeatingProject();assert.ok(autoDesignHeating([r],h,null).heating.radiators[0].performanceReference);
});
test('published UFH tables match their build-up and stated water drop, not arbitrary systems',()=>{
 const z=newUFHZone(room(),null),d=REFERENCE_UFH_DATASETS[1];Object.assign(z,{diameterMm:12,spacingMm:150,floorThermalResistance:.01,floorConstruction:d.floorConstruction,performanceDataset:d});
 close(calculateUFHOutput(z,40,30,20)!.outputWm2,52.9);close(calculateUFHOutput(z,40,30,21)!.outputWm2,49.1);
 assert.equal(calculateUFHOutput(z,45,35,20)!.overLimit,true);assert.equal(calculateUFHOutput(z,40,35,20),null);assert.equal(calculateUFHOutput(z,40,30,20)!.surfaceTemperatureC,null);
 z.diameterMm=16;assert.equal(calculateUFHOutput(z,40,30,20),null);
});
test('UFH data uses all operating coordinates and refuses missing/extrapolated models',()=>{
 const z=newUFHZone(room(),null);assert.equal(calculateUFHOutput(z,40,35,20),null);
 z.performanceDataset={name:'Synthetic test table',reference:'TEST ONLY',pipeDiameterMm:16,floorConstruction:z.floorConstruction,points:[{spacingMm:200,floorResistance:.01,flowC:40,returnC:35,roomC:20,outputWm2:60,surfaceTemperatureC:26}]};
 close(calculateUFHOutput(z,40,35,20)!.outputWm2,60);assert.equal(calculateUFHOutput(z,45,35,20),null);
 z.floorThermalResistance=.1;assert.equal(calculateUFHOutput(z,40,35,20),null);z.floorThermalResistance=.01;z.maxSurfaceTemperatureC=25;assert.equal(calculateUFHOutput(z,40,35,20)!.overLimit,true);
});
test('hydronic flow and optional pipe-only pressure are explicit and bounded',()=>{
 close(calculateUFHFlowRate(1050,40,35)!,3.020394855,1e-6);assert.equal(calculateUFHFlowRate(1050,35,35),null);
 assert.equal(calculatePressureDrop(80,3,null,40),null);assert.ok(calculatePressureDrop(80,3,12,40)!>0);
});
test('active area subtracts clipped/overlapping exclusions only once',()=>{
 const r=room(),island=[{x:1000,y:1000},{x:2000,y:1000},{x:2000,y:2000},{x:1000,y:2000}];
 close(activeUFHAreaM2(r.vertices,[island,island]),19);
 const halfOutside=[{x:-1000,y:1000},{x:1000,y:1000},{x:1000,y:2000},{x:-1000,y:2000}];close(activeUFHAreaM2(r.vertices,[halfOutside]),19);
});
test('rectangle UFH stays inside, uses actual lengths, splits and balances including external manifold',()=>{
 const {r,z,m,h}=generatedFixture(room(),{x:-500,y:2000}),result=generateUFHLoops(r,z,m,[]);assert.ok(result.circuits.length>=2);
 for(const c of result.circuits){assert.ok(calculateCircuitLength(c)<=z.maxCircuitLengthM+1e-6);assert.ok(c.pathMm.slice(1).every((p,i)=>pipeSegmentAllowed(c.pathMm[i],p,r.vertices,[],z.boundaryOffsetMm)));assert.deepEqual(c.supplyPathMm[0],m.positionMm);}
 const lengths=result.circuits.map(c=>calculateCircuitLength(c));assert.ok(Math.max(...lengths)-Math.min(...lengths)<15);
 const runs=result.circuits.flatMap(c=>c.pathMm.slice(1).flatMap((b,i)=>Math.abs(b.y-c.pathMm[i].y)<1e-6&&Math.abs(b.x-c.pathMm[i].x)>1000?[b.y]:[]));const levels=[...new Set(runs)].sort((a,b)=>a-b);for(let i=1;i<levels.length;i++)close(levels[i]-levels[i-1],z.spacingMm);
 h.ufhCircuits=result.circuits;close(heatingResults([r],h).pipeM,lengths.reduce((a,b)=>a+b,0));
});
for(const [name,vertices] of [
 ['L-shaped',[{x:0,y:0},{x:6000,y:0},{x:6000,y:2500},{x:3000,y:2500},{x:3000,y:5000},{x:0,y:5000}]],
 ['U-shaped',[{x:0,y:0},{x:6000,y:0},{x:6000,y:5000},{x:4000,y:5000},{x:4000,y:2000},{x:2000,y:2000},{x:2000,y:5000},{x:0,y:5000}]],
 ['irregular',[{x:0,y:0},{x:6500,y:0},{x:5500,y:4500},{x:1000,y:5000}]],
] as [string,Point2D[]][]) test(`${name} routes do not cross room boundary`,()=>{
 const {r,z,m}=generatedFixture(room(vertices)),result=generateUFHLoops(r,z,m,[]);assert.ok(result.circuits.length>0,name);
 for(const c of result.circuits)assert.ok(c.pathMm.slice(1).every((p,i)=>pipeSegmentAllowed(c.pathMm[i],p,r.vertices,[],z.boundaryOffsetMm)));
});
test('island exclusions and narrow clearances produce safe geometry or explicit refusals',()=>{
 const {r,z,m}=generatedFixture(),polygonMm=[{x:1800,y:1400},{x:3000,y:1400},{x:3000,y:2600},{x:1800,y:2600}],e={exclusionId:'island',roomId:r.id,name:'Island',polygonMm},result=generateUFHLoops(r,z,m,[e]);
 assert.ok(result.circuits.length);for(const c of result.circuits)assert.ok(c.pathMm.slice(1).every((p,i)=>pipeSegmentAllowed(c.pathMm[i],p,r.vertices,[polygonMm],z.boundaryOffsetMm)));
 z.spacingMm=100;assert.equal(generateUFHLoops(r,z,m,[e]).circuits.length,0);
});
test('spiral generation is actual counterflow geometry or explicitly declared fallback',()=>{
 const {r,z,m}=generatedFixture();z.pattern='Spiral';z.maxCircuitLengthM=200;const result=generateUFHLoops(r,z,m,[]);assert.ok(result.circuits.length);
 assert.equal(result.circuits[0].pattern,'Spiral');
 const path=result.circuits[0].pathMm,cross=(a:Point2D,b:Point2D,c:Point2D)=>(b.x-a.x)*(c.y-a.y)-(b.y-a.y)*(c.x-a.x);
 for(let i=1;i<path.length;i++)for(let j=i+2;j<path.length;j++)assert.ok(!(cross(path[i-1],path[i],path[j-1])*cross(path[i-1],path[i],path[j])<0&&cross(path[j-1],path[j],path[i-1])*cross(path[j-1],path[j],path[i])<0),`Spiral crossing ${i}/${j}: ${JSON.stringify([path[i-1],path[i],path[j-1],path[j]])}`);
});
test('locked routes and explicit regeneration preserve manual layouts',()=>{
 const {r,z,m,h}=generatedFixture(),result=generateUFHLoops(r,z,m,[]);h.ufhCircuits=result.circuits;h.ufhCircuits[0].locked=true;h.ufhCircuits[0].pathMm[0].x+=20;
 assert.deepEqual(regenerateHeatingRoom(r,h).heating.ufhCircuits,h.ufhCircuits);
 h.ufhCircuits[0].manuallyEdited=true;const changed=structuredClone(h);changed.ufhCircuits[0].pathMm[1].x+=100;assert.notEqual(calculateCircuitLength(changed.ufhCircuits[0]),calculateCircuitLength(h.ufhCircuits[0]));
 h.ufhZones[0].geometryFingerprint=geometryFingerprint(r,[]);assert.ok(heatingResults([{...r,vertices:r.vertices.map(p=>({x:p.x+100,y:p.y}))}],h).warnings.some(w=>w.includes('geometry')));
});
test('manual circuit split includes separate manifold leads; geometric length is deterministic',()=>{
 const {r,z,m,h}=generatedFixture();h.ufhCircuits=generateUFHLoops(r,z,m,[]).circuits;const c=h.ufhCircuits[0],parts=splitPathByLength(c.pathMm,2),split=splitHeatingCircuit(c,h,parts);
 close(calculateCircuitLength({pathMm:[{x:0,y:0},{x:3000,y:4000}],supplyPathMm:[],returnPathMm:[]}),5);
 assert.equal(split.length,2);assert.notEqual(split[0].circuitId,split[1].circuitId);assert.deepEqual(split[1].supplyPathMm[0],m.positionMm);
});
test('radiators snap to walls and warn on a door; direct electric auto design does not alter geometry',()=>{
 const r=room(),h=newHeatingProject();r.openings=[{id:'door',kind:'DOOR',parent_wall_id:'wall-001',offset_mm:2000,width:measured(1000),height:measured(2000),sill_height_mm:0}];
 const radiator=snapRadiatorToWall(newHeatingRadiator(r),r,{x:2500,y:0});assert.ok(radiatorPlacementWarnings(radiator,r).some(w=>w.includes('door')));
 h.rooms=[{...thermalRoom(r,h),selectedEmitterType:'Electric Radiator'}];const before=structuredClone(r),next=autoDesignHeating([r],h,null).heating;assert.deepEqual(r,before);assert.ok(next.radiators.length);assert.ok(heatingResults([r],next).electricW>=calculateRoomHeatLoss(r,[r],h).designW);
});
test('unknown output and excessive floor temperature never become a compatibility pass',()=>{
 const r=room(),h=newHeatingProject();h.radiators=[newHeatingRadiator(r)];assert.equal(heatingResults([r],h).rooms[0].status,'Not verified');
 assert.equal(heatingResults([r],h).sufficient,0);
});
test('invalid flow/return and out-of-range hydraulic data cannot pass as verified design',()=>{
 const r=room(),h=newHeatingProject();h.radiators=[{...newHeatingRadiator(r),ratedOutputW:100000}];h.heatingSystem={name:'Invalid',flowTemperatureC:50,returnTemperatureC:60};assert.equal(heatingResults([r],h).sufficient,0);
 assert.equal(calculatePressureDrop(80,3,12,100),null);
});
test('stale or out-of-bound pipes never pass capacity screening; invalid bore stays unknown',()=>{
 const {r,z,m,h}=generatedFixture();const generated=generateUFHLoops(r,z,m,[]);h.ufhCircuits=generated.circuits;z.geometryFingerprint=generated.fingerprint;
 z.performanceDataset={name:'Synthetic test only',reference:'Test fixture, not product data',pipeDiameterMm:z.diameterMm,floorConstruction:z.floorConstruction,points:[{spacingMm:z.spacingMm,floorResistance:z.floorThermalResistance,flowC:45,returnC:40,roomC:21,outputWm2:100,surfaceTemperatureC:27}]};
 assert.equal(heatingResults([r],h).rooms[0].status,'Sufficient');
 z.spacingMm=150;assert.equal(heatingResults([r],h).rooms[0].zones[0].outputW,null);z.spacingMm=200;
 z.internalDiameterMm=20;assert.equal(heatingResults([r],h).rooms[0].zones[0].circuits[0].pressureDropPa,null);
 z.geometryFingerprint='stale';assert.equal(heatingResults([r],h).rooms[0].status,'Not verified');
 z.geometryFingerprint=generated.fingerprint;h.ufhCircuits[0].pathMm[1]={x:-1000,y:-1000};assert.equal(heatingResults([r],h).rooms[0].status,'Not verified');
});
test('versioned heating persists through portable files and local storage without regenerating edits',async()=>{
 const {r,z,m,h}=generatedFixture(),p=newProject();h.ufhCircuits=generateUFHLoops(r,z,m,[]).circuits;h.ufhCircuits[0].manuallyEdited=true;h.ufhCircuits[0].pathMm[0].x+=12;p.rooms=[r];p.heatingLayout=h;
 const restored=await importProject(await exportProject(p));assert.deepEqual(restored.heatingLayout,h);
 const repo=new LocalProjectRepository();await repo.saveProject(p);assert.deepEqual((await repo.getProject(p.projectId))?.heatingLayout,h);
 assert.equal(parseProject(newProject()).heatingLayout,undefined);assert.throws(()=>parseHeatingProject({...h,version:2}));assert.throws(()=>parseHeatingProject({...h,ufhCircuits:[...h.ufhCircuits,h.ufhCircuits[0]]}));
});
test('PDF is multi-page, light, and CSV includes edited current geometry and values',async()=>{
 const {r,z,m,h}=generatedFixture();h.ufhCircuits=generateUFHLoops(r,z,m,[]).circuits;r.name='Edited living room';h.radiators=[{...newHeatingRadiator(r),'model':'Edited radiator',ratedOutputW:1234}];
 const bytes=await buildHeatingPdf([r],h,'Edited project'),pdf=await PDFDocument.load(bytes);assert.ok(pdf.getPageCount()>=3);
 const csv=heatingScheduleCsv([r],h);assert.match(csv,/Edited living room/);assert.match(csv,new RegExp(calculateCircuitLength(h.ufhCircuits[0]).toFixed(1)));
 if(process.env.HEATING_PDF_QA){const {writeFile}=await import('node:fs/promises');await writeFile('../.local-logs/heating-qa.pdf',bytes);}
});
