import assert from "node:assert/strict";
import test from "node:test";
import polygonClipping from "polygon-clipping";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { BALUSTRADE_STYLES, balustradeFootprint, balustradeRuns, defaultBalustrade, previewBalustradeFootprint } from "../lib/balustrades";
import { activeFloor, buildingOf, deleteFloor, duplicateFloor, floorOpeningSchema, roofForRoom, roofSchema, sharedRoofProfile, updateFloor } from "../lib/buildingDocument";
import { buildingRoofZones, buildRoofSurfaces, planArea, structuralFloorFootprint, validateFloorOpening, validateRoofGuardClearance } from "../lib/buildingGeometry";
import { parseProject } from "../lib/projectDocument";
import { OpeningProperties } from "../components/BuildingPropertyEditors";
import { BalustradeFixture } from "../components/BalustradeFixture";
import { roofProject, stairOpening } from "./roofBalustradeFixtures";

test("room roofs are opt-in and partition the exact wall envelope without overlaps or gaps",()=>{
  const p=roofProject(),base=buildingOf(p).roof,roomRoof={...sharedRoofProfile(base),type:"GABLE" as const,highHeightMm:3600,orientationDeg:37.5};
  const r={...base,roomOverrides:[{roomId:p.rooms[0].id,roof:roomRoof}]};
  assert.equal(buildingRoofZones(p,r).length,1);
  assert.equal(roofForRoom(r,p.rooms[0].id),r);
  r.roomRoofsEnabled=true;
  const zones=buildingRoofZones(p,r),footprint=structuralFloorFootprint(p);
  assert.equal(zones.length,2);
  assert.equal(zones.find(zone=>zone.id===p.rooms[0].id)!.roof.type,"GABLE");
  assert.deepEqual(zones[0].frameFootprint,footprint,"A partial shared roof must retain its original slope frame");
  assert.ok(Math.abs(zones.reduce((sum,zone)=>sum+planArea(zone.footprint),0)-planArea(footprint))<.001);
  assert.ok(planArea(polygonClipping.intersection(zones[0].footprint,zones[1].footprint))<.001);
  for(const zone of zones){const surfaces=buildRoofSurfaces(zone.footprint,zone.roof,zone.roof.lowHeightMm,zone.frameFootprint);assert.ok(surfaces.length>0);assert.ok(surfaces.every(s=>s.positionsMm.every(Number.isFinite)));}
  assert.deepEqual(buildingRoofZones(p,{...r,enabled:false}),[]);
});

test("all rooms can use independent profiles, finishes and ceiling heights",()=>{
  const p=roofProject(),base=buildingOf(p).roof;
  const roof={...base,roomRoofsEnabled:true,roomOverrides:p.rooms.map((room,i)=>({roomId:room.id,roof:{...sharedRoofProfile(base),type:i?"MONO" as const:"STEPPED" as const,lowHeightMm:2200+i*300,highHeightMm:3500,ceilingMode:"FLAT" as const,ceilingHeightMm:2000+i*200,finish:{material:i?"METAL" as const:"CLAY_TILES" as const,colour:i?"#456677":"#a65338",tileWidthMm:300,tileHeightMm:400}}}))};
  assert.doesNotThrow(()=>roofSchema.parse(roof));
  assert.equal(buildingRoofZones(p,roof).filter(zone=>zone.id==="shared").length,0);
  assert.equal(roofForRoom(roof,p.rooms[1].id).ceilingHeightMm,2200);
  assert.equal(roofForRoom(roof,"no-override").type,base.type);
});

test("roof junctions depend on geometry, not room names or regenerated copy IDs",()=>{
  const p=roofProject(),base=buildingOf(p).roof;
  p.building!.roof={...base,roomRoofsEnabled:true,roomOverrides:p.rooms.map((room,i)=>({roomId:room.id,roof:{...sharedRoofProfile(base),type:i?"MONO":"GABLE",highHeightMm:3400+i*500}}))};
  const shape=(content,roof)=>buildingRoofZones(content,roof).map(zone=>({footprint:zone.footprint,frame:zone.frameFootprint,type:zone.roof.type}));
  const expected=shape(p,p.building!.roof),renamed=structuredClone(p);
  renamed.rooms[0].id="z-last";renamed.rooms[0].name="Z";renamed.rooms[1].id="a-first";renamed.rooms[1].name="A";
  renamed.building!.roof.roomOverrides!.forEach((item,i)=>item.roomId=renamed.rooms[i].id);
  assert.deepEqual(shape(renamed,renamed.building!.roof),expected);
  const copied=duplicateFloor(p,activeFloor(p).id);assert.deepEqual(shape(copied,copied.building!.roof),expected);
});

test("room roof references are strict, non-recursive, duplicated independently and removed with deleted floors",()=>{
  const p=roofProject();p.building!.roof={...p.building!.roof,roomRoofsEnabled:true,roomOverrides:[{roomId:p.rooms[0].id,roof:{...sharedRoofProfile(p.building!.roof),type:"GABLE",highHeightMm:3500}}]};
  assert.deepEqual(parseProject(JSON.parse(JSON.stringify(p))),p);
  const missing=structuredClone(p);missing.building!.roof.roomOverrides![0].roomId="missing";assert.throws(()=>parseProject(missing),/missing room/);
  assert.equal(roofSchema.safeParse({...p.building!.roof,roomOverrides:[...p.building!.roof.roomOverrides!,...p.building!.roof.roomOverrides!]}).success,false);
  assert.equal(roofSchema.safeParse({...p.building!.roof,roomOverrides:[{roomId:p.rooms[0].id,roof:{...sharedRoofProfile(p.building!.roof),roomOverrides:[]}}]}).success,false);
  assert.equal(roofSchema.safeParse({...p.building!.roof,roomOverrides:[{roomId:p.rooms[0].id,roof:{...sharedRoofProfile(p.building!.roof),enabled:false}}]}).success,false);
  const copy=duplicateFloor(p,activeFloor(p).id);assert.equal(copy.building!.roof.roomOverrides!.length,2);assert.notEqual(copy.building!.roof.roomOverrides![0].roomId,copy.building!.roof.roomOverrides![1].roomId);
  copy.building!.roof.roomOverrides![1].roof.highHeightMm=4800;assert.equal(p.building!.roof.roomOverrides![0].roof.highHeightMm,3500);
  const deleted=deleteFloor(copy,activeFloor(copy).id);assert.equal(deleted.building!.roof.roomOverrides!.length,1);assert.doesNotThrow(()=>parseProject(deleted));
});

test("five balustrades preserve the void, sit on the slab, and are winding independent",()=>{
  const p=roofProject(true),opening=stairOpening();
  assert.equal(BALUSTRADE_STYLES.length,5);
  for(const style of BALUSTRADE_STYLES){const config={...defaultBalustrade(),style:style.id as ReturnType<typeof defaultBalustrade>["style"]};opening.balustrade=config;
    assert.doesNotThrow(()=>validateFloorOpening(p,opening,[opening]));
    const footprint=balustradeFootprint(opening.vertices,config),reverse=balustradeFootprint([...opening.vertices].reverse(),config);
    assert.ok(Math.abs(planArea(footprint)-planArea(reverse))<.001);
    assert.equal(balustradeRuns(opening.vertices,config).length,4);
    assert.equal(planArea(polygonClipping.intersection(footprint,[opening.vertices.map(point=>[point.x,point.y])])),0);
    const model=BalustradeFixture({representation:style.key,width:1,depth:style.depthMm*.001,height:1.1,colour:style.colour});assert.equal(model.props.name,`Balustrade · ${style.id}`);
    const persisted=updateFloor(p,activeFloor(p).id,{openings:[opening]});assert.deepEqual(parseProject(persisted).building!.floors.at(-1)!.openings[0].balustrade,config);
  }
});

test("balustrades reject walls, other voids, sharp corners and malformed properties without altering the source",()=>{
  const p=roofProject(true),opening=stairOpening();opening.balustrade=defaultBalustrade();
  const nearWall={...opening,vertices:opening.vertices.map(point=>({...point,x:point.x-1100}))};
  assert.throws(()=>validateFloorOpening(p,nearWall,[nearWall]),/balustrade/i);
  const neighbour={...stairOpening(),id:"neighbour",vertices:[{x:3000,y:1600},{x:3600,y:1600},{x:3600,y:3600},{x:3000,y:3600}]};
  assert.throws(()=>validateFloorOpening(p,opening,[opening,{...neighbour,vertices:neighbour.vertices.map(point=>({...point,x:point.x-100}))}]),/balustrade/i);
  assert.equal(floorOpeningSchema.safeParse({...opening,balustrade:{...opening.balustrade,heightMm:NaN}}).success,false);
  assert.equal(floorOpeningSchema.safeParse({...opening,balustrade:{...opening.balustrade,style:"unsafe"}}).success,false);
  const sharp=[{x:0,y:0},{x:1000,y:0},{x:1,y:60}];assert.throws(()=>balustradeFootprint(sharp,opening.balustrade!),/sharp/);assert.deepEqual(previewBalustradeFootprint(sharp,opening.balustrade!),[]);
  assert.deepEqual(balustradeFootprint(opening.vertices,{...opening.balustrade,enabled:false}),[]);
  assert.doesNotThrow(()=>validateFloorOpening(p,{...nearWall,balustrade:{...opening.balustrade,enabled:false}},[]));
  const markup=renderToStaticMarkup(createElement(OpeningProperties,{opening,units:"MM",onCommit(){},onDelete(){}}));assert.match(markup,/Add balustrade/);assert.match(markup,/Glass panels/);assert.match(markup,/Balustrade height/);
});

test("a guard cannot rise through a low shared or room-specific ceiling",()=>{
  const p=roofProject(true),opening={...stairOpening(),balustrade:{...defaultBalustrade(),heightMm:2000}};
  const roof={...buildingOf(p).roof,lowHeightMm:1800};
  assert.throws(()=>validateRoofGuardClearance(p,[opening],roof),/ceiling height/);
  assert.doesNotThrow(()=>validateRoofGuardClearance(p,[opening],{...roof,enabled:false}));
  const local={...buildingOf(p).roof,roomRoofsEnabled:true,roomOverrides:[{roomId:p.rooms[0].id,roof:{...sharedRoofProfile(roof),ceilingMode:"FLAT" as const,ceilingHeightMm:1800}}]};
  assert.throws(()=>validateRoofGuardClearance(p,[opening],local),/ceiling height/);
});

test("guards support concave and rotated polygon openings and reject touching guard envelopes",()=>{
  const p=roofProject(true),config=defaultBalustrade();
  const concave=[{x:1000,y:1000},{x:3000,y:1000},{x:3000,y:2000},{x:2000,y:2000},{x:2000,y:4000},{x:1000,y:4000}];
  const angle=Math.PI/6,rotated=stairOpening().vertices.map(point=>({x:2000+(point.x-2000)*Math.cos(angle)-(point.y-2600)*Math.sin(angle),y:2600+(point.x-2000)*Math.sin(angle)+(point.y-2600)*Math.cos(angle)}));
  for(const vertices of [concave,rotated])for(const style of BALUSTRADE_STYLES){const opening={...stairOpening(),shape:"POLYGON" as const,vertices,balustrade:{...config,style:style.id as typeof config.style}};assert.doesNotThrow(()=>validateFloorOpening(p,opening,[opening]));}
  const first={...stairOpening(),vertices:[{x:1000,y:1600},{x:2000,y:1600},{x:2000,y:3600},{x:1000,y:3600}],balustrade:config};
  const second={...first,id:"nearby",vertices:first.vertices.map(point=>({...point,x:point.x+1200}))};
  assert.throws(()=>validateFloorOpening(p,first,[first,second]),/neighbouring openings cannot overlap/);
});
