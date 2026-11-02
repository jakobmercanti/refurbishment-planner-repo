import test from "node:test";
import assert from "node:assert/strict";
import { newHeatingProject, parseHeatingProject } from "../lib/heatingDocument.ts";
import { newEnergyProject, parseEnergyProject } from "../lib/energyDocument.ts";
import { createRoomUFH, heatingResults, regenerateHeatingRoom } from "../lib/heatingDesign.ts";
import { assignEnergyElements, energyElements, withEnergyFabric } from "../lib/energyCalculations.ts";
import { ufhBendControls, editUFHBend } from "../lib/ufhBendControls.ts";
import { moveHeatingRouteSegment, moveHeatingRouteVertex } from "../lib/heatingPipes.ts";
import { calculateUFHOutput } from "../lib/heatingCalculations.ts";
import { buildEnergyPdf } from "../lib/energyExport.ts";
import { buildHeatingPdf } from "../lib/heatingExport.ts";
import { PDFDocument } from "pdf-lib";
import type { Room } from "../lib/types.ts";
const measurement = (value: number) => ({ value, uncertainty_mm: 0, verified: true, source_type: "USER_MEASURED" });
const room: Room = { id: "room", name: "Room 1", version: 1, vertices: [{x:0,y:0},{x:3050,y:0},{x:3050,y:2079},{x:0,y:2079}], wall_height: measurement(2400), wall_thickness: measurement(100), obstacles: [], openings: [] };

test("default room UFH has finite output, flow and explicit manifold design conditions without changing radiators", () => {
  const before = newHeatingProject(), data = createRoomUFH(room, before).heating;
  const zone = data.ufhZones[0], row = heatingResults([room],data).rooms[0], output = row.zones[0];
  assert.equal(zone.performanceDataset!.points.length, 135); assert.equal(zone.designFlowC,40); assert.equal(zone.designReturnC,30);
  assert.deepEqual(data.heatingSystem,before.heatingSystem); assert.deepEqual(before.ufhCircuits,[]);
  assert.ok(output.outputW! > 0); assert.ok(output.performance!.surfaceTemperatureC! > 20); assert.equal(output.performance!.surfaceEstimated,true);
  assert.ok(output.circuits.every(c => c.flowLmin! > 0)); assert.ok(output.coveredAreaM2/output.activeAreaM2 >= .85);
  assert.ok(!row.warnings.some(w => /table.*missing|no complete rating|surface-temperature data missing/i.test(w)));
  assert.notEqual(row.status,"Sufficient");
  assert.deepEqual(parseHeatingProject(JSON.parse(JSON.stringify(data))).ufhZones,data.ufhZones);
  assert.equal(calculateUFHOutput({...zone,estimateSurfaceTemperature:false},40,30,20)?.surfaceTemperatureC,null);
});

test("unknown UFH preset falls back to a complete default design", () => {
  const data=createRoomUFH(room,newHeatingProject(),999).heating;
  const result=heatingResults([room],data).rooms[0].zones[0];
  assert.equal(data.ufhZones[0].designFlowC,40);
  assert.equal(data.ufhZones[0].designReturnC,30);
  assert.ok(result.outputW!>0);assert.ok(result.circuits.every(c=>c.flowLmin!>0));
});

test("a generated spiral fallback remains visible in saved route warnings and room results",()=>{
 const data=createRoomUFH(room,newHeatingProject()).heating;data.ufhZones[0].pattern='Spiral';
 const next=regenerateHeatingRoom(room,data).heating;
 assert.equal(next.ufhCircuits[0].pattern,'Serpentine');
 assert.ok(next.ufhCircuits.every(c=>c.generationWarnings.some(w=>/spiral unavailable/i.test(w))));
 assert.ok(heatingResults([room],next).rooms[0].warnings.some(w=>/spiral unavailable/i.test(w)));
});

test("automatic manifold port allocation does not leave an obsolete capacity warning",()=>{
 const data=createRoomUFH(room,newHeatingProject()).heating;data.ufhCircuits=[];data.ufhZones[0].circuitCountTarget=20;
 const next=createRoomUFH(room,data).heating;
 assert.equal(next.ufhCircuits.length,20);assert.equal(next.manifolds[0].ports,20);
 assert.ok(!heatingResults([room],next).rooms[0].warnings.some(w=>/ports? (count )?exceeded|exceeds available manifold ports/i.test(w)));
});
test("surface U edits are the same Insulation assignments used by Heating", () => {
  const heating = newHeatingProject(), energy = newEnergyProject(), wall = energyElements([room],heating,energy).find(e => e.category === "wall")!;
  const changed = parseEnergyProject(assignEnergyElements(energy,[{elementId:wall.elementId,assemblyId:null,uValue:.123,geometrySignature:wall.geometrySignature}]));
  const energyWall = energyElements([room],heating,changed).find(e => e.elementId===wall.elementId)!;
  const loss = heatingResults([room],withEnergyFabric(heating,changed,[room])).rooms[0].demand;
  assert.equal(energyWall.uValue,.123); assert.ok(loss.surfaces.some(s => s.uValue===.123));
  assert.equal(loss.fabricW,energyElements([room],heating,changed).reduce((n,e)=>n+e.heatLossW,0));
});
test("sampled UFH arcs expose two controls per bend rather than their sampled vertices", () => {
  const data = createRoomUFH(room,newHeatingProject()).heating, zone=data.ufhZones[0], circuit=data.ufhCircuits[0];
  const model=ufhBendControls(circuit.pathMm,zone.minBendRadiusMm,zone.spacingMm);
  assert.ok(model.bends.length>0); assert.ok(model.bends.length*2<circuit.pathMm.length/2);
  assert.ok(model.bends.every(b=>b.indices.length<=2));
  const bend=model.bends[0];
  const rebuilt=editUFHBend(circuit.pathMm,0,bend.radiusHandle,"RADIUS",zone.minBendRadiusMm,zone.spacingMm);
  assert.ok(rebuilt.every(p=>Number.isFinite(p.x)&&Number.isFinite(p.y)));
  assert.deepEqual(rebuilt[0],circuit.pathMm[0]); assert.deepEqual(rebuilt.at(-1),circuit.pathMm.at(-1));
  const moved=editUFHBend(circuit.pathMm,0,{x:bend.position.x+bend.direction.x*20,y:bend.position.y+bend.direction.y*20},"POSITION",zone.minBendRadiusMm,zone.spacingMm);
  assert.notDeepEqual(moved,circuit.pathMm);
  assert.throws(()=>editUFHBend(circuit.pathMm,0,{x:100000,y:100000},"RADIUS",zone.minBendRadiusMm,zone.spacingMm),/does not fit/);
  const crossing=[{x:0,y:0},{x:1000,y:0},{x:1000,y:1000},{x:0,y:1000},{x:0,y:500},{x:1500,y:500}];
  const unsafe=ufhBendControls(crossing,50,150).bends[0];
  assert.throws(()=>editUFHBend(crossing,0,unsafe.radiusHandle,"RADIUS",50,150),/cross another/);
});
test("square heating route edits preserve connected endpoints and allow corners and segments",()=>{
 const route=[{x:0,y:0},{x:100,y:0},{x:100,y:100},{x:200,y:100}];
 for(const next of [moveHeatingRouteVertex(route,1,{x:130,y:20},true,true,true),moveHeatingRouteSegment(route,0,{x:0,y:40},true,true,true)]) {
  assert.deepEqual(next[0],route[0]);assert.deepEqual(next.at(-1),route.at(-1));
  assert.ok(next.slice(1).every((p,i)=>p.x===next[i].x||p.y===next[i].y));
 }
 assert.deepEqual(moveHeatingRouteVertex(route,0,{x:10,y:10},true,true,true),route);
});
test("report preview options generate valid PDFs and omit calculation pages when requested",async()=>{
 const heating=newHeatingProject(),energy=newEnergyProject();
 for(const build of [(options:{title:string;includeDetails:boolean})=>buildHeatingPdf([room],heating,"Project",options),(options:{title:string;includeDetails:boolean})=>buildEnergyPdf([room],heating,energy,"Project",options)]) {
  const full=await PDFDocument.load(await build({title:"Review report",includeDetails:true}));
  const brief=await PDFDocument.load(await build({title:"Review report",includeDetails:false}));
  assert.ok(full.getPageCount()>brief.getPageCount());assert.ok(brief.getPageCount()>0);
 }
});
