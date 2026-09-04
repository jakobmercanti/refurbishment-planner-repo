import test from "node:test";
import assert from "node:assert/strict";
import { addRoomOutsideWall, removeRoomBoundary } from "../lib/roomOperations.ts";
import { closedRooms } from "../lib/roomDetection.ts";
import { retainDraggedWallConnections } from "../lib/wallDragGeometry.ts";

const rectangle = {id:"base",points:[{x:0,y:0},{x:2400,y:0},{x:2400,y:1800},{x:0,y:1800},{x:0,y:0}]};
for(const reverse of [false,true])for(let side=0;side<4;side++)test(`adds exterior room on side ${side}, reversed=${reverse}`,()=>{
  const original={...rectangle,points:reverse?[...rectangle.points].reverse():rectangle.points};
  const result=addRoomOutsideWall([original],{wallId:"base",segmentIndex:side},"new");
  assert.equal(result.error,undefined);
  assert.deepEqual(result.walls[0],original);
  assert.equal(result.walls[1].points.length,4);
  assert.equal(closedRooms(result.walls).length,2);
  assert.equal(Math.hypot(result.walls[1].points[0].x-result.walls[1].points[1].x,result.walls[1].points[0].y-result.walls[1].points[1].y),2000);
});
test("rejects adding on shared wall",()=>{
  const first=addRoomOutsideWall([rectangle],{wallId:"base",segmentIndex:0},"new");
  assert.ok(addRoomOutsideWall(first.walls,{wallId:"base",segmentIndex:0},"third").error);
});
test("removes added room without touching original geometry",()=>{
  const added=addRoomOutsideWall([rectangle],{wallId:"base",segmentIndex:0},"new");
  const room=closedRooms(added.walls).find(r=>r.vertices.some(p=>p.y<0))!;
  const result=removeRoomBoundary(added.walls,room.vertices);
  assert.equal(result.walls.length,1);
  assert.deepEqual(result.walls[0].points,rectangle.points);
  assert.equal(closedRooms(result.walls).length,1);
});
test("removes original room while preserving added room and shared locked wall",()=>{
  const original={...rectangle,lengthOverridesMm:{0:2400},thicknessOverridesMm:{0:150}};
  const added=addRoomOutsideWall([original],{wallId:"base",segmentIndex:0},"new");
  const result=removeRoomBoundary(added.walls,rectangle.points.slice(0,-1));
  assert.equal(closedRooms(result.walls).length,1);
  assert.equal(result.walls.find(w=>w.id==="base")!.lengthOverridesMm![0],2400);
  assert.equal(result.walls.find(w=>w.id==="base")!.thicknessOverridesMm![0],150);
  assert.deepEqual(result.segmentMap["base:0"],[{wallId:"base",segmentIndex:0,from:0,to:1}]);
  assert.deepEqual(result.segmentMap["base:1"],[]);
});
test("removes only exclusive parts of a partially shared boundary",()=>{
  const walls=[rectangle,{id:"new",points:[{x:500,y:0},{x:500,y:-1000},{x:1500,y:-1000},{x:1500,y:0}]}];
  const result=removeRoomBoundary(walls,rectangle.points.slice(0,-1));
  assert.equal(closedRooms(result.walls).length,1);
  assert.deepEqual(result.walls.find(w=>w.id==="base")!.points,[{x:500,y:0},{x:1500,y:0}]);
  assert.equal(result.segmentMap["base:0"][0].from,500/2400);
  assert.equal(result.segmentMap["base:0"][0].to,1500/2400);
});
test("rejects collision with an existing wall in proposed room",()=>{
  const blocker={id:"blocker",points:[{x:800,y:-500},{x:1600,y:-500}]};
  assert.ok(addRoomOutsideWall([rectangle,blocker],{wallId:"base",segmentIndex:0},"new").error);
});
test("removing only room leaves empty geometry",()=>assert.deepEqual(removeRoomBoundary([rectangle],rectangle.points.slice(0,-1)).walls,[]));
test("rejects duplicating an incident wall along a proposed side",()=>{
  const branch={id:"branch",points:[{x:0,y:0},{x:0,y:-500}]};
  assert.ok(addRoomOutsideWall([rectangle,branch],{wallId:"base",segmentIndex:0},"new").error);
});
test("retained piece IDs cannot collide with pre-existing retained IDs",()=>{
  const neighbour={id:"upper",points:[{x:0,y:0},{x:0,y:-1000},{x:2400,y:-1000},{x:2400,y:0}]};
  const right={id:"right",points:[{x:2400,y:0},{x:3400,y:0},{x:3400,y:1800},{x:2400,y:1800}]};
  const reserved={id:"base-retained-2",points:[{x:9000,y:0},{x:9000,y:1000}]};
  const result=removeRoomBoundary([rectangle,neighbour,right,reserved],rectangle.points.slice(0,-1));
  assert.equal(new Set(result.walls.map(w=>w.id)).size,result.walls.length);
  assert.equal(closedRooms(result.walls).length,2);
  assert.deepEqual(result.pointMap["base:2"],{wallId:"base-retained-3",pointIndex:1});
});
test("remaining room stays closed when its retained shared wall is dragged",()=>{
  const added=addRoomOutsideWall([rectangle],{wallId:"base",segmentIndex:0},"new");
  const remaining=removeRoomBoundary(added.walls,rectangle.points.slice(0,-1)).walls;
  const candidate=remaining.map(w=>({...w,points:w.points.map(p=>w.id==="base"?{x:p.x,y:p.y+400}:{...p})}));
  const repaired=retainDraggedWallConnections(remaining,candidate,"base",0);
  assert.equal(closedRooms(repaired).length,1);
});
test("removing original from three rooms preserves both separate neighbours and metadata",()=>{
  const base={...rectangle,lengthOverridesMm:{0:2400,1:1800},thicknessOverridesMm:{0:140,1:180}};
  const above=addRoomOutsideWall([base],{wallId:"base",segmentIndex:0},"above");
  const three=addRoomOutsideWall(above.walls,{wallId:"base",segmentIndex:1},"right");
  assert.equal(three.error,undefined);
  const polygonKey=(vertices:{x:number;y:number}[])=>vertices.map(p=>`${p.x},${p.y}`).sort().join("|");
  const before=closedRooms(three.walls).filter(r=>r.vertices.some(p=>p.y<0||p.x>2400)).map(r=>polygonKey(r.vertices)).sort();
  const removed=removeRoomBoundary(three.walls,rectangle.points.slice(0,-1));
  assert.equal(closedRooms(removed.walls).length,2);
  assert.deepEqual(closedRooms(removed.walls).map(r=>polygonKey(r.vertices)).sort(),before);
  for(const index of [0,1]){
    const mapping=removed.segmentMap[`base:${index}`][0];
    const wall=removed.walls.find(w=>w.id===mapping.wallId)!;
    assert.equal(wall.lengthOverridesMm![mapping.segmentIndex],base.lengthOverridesMm[index as 0|1]);
    assert.equal(wall.thicknessOverridesMm![mapping.segmentIndex],base.thicknessOverridesMm[index as 0|1]);
  }
  for(const wall of removed.walls)for(const [index,attachment]of Object.entries(wall.attachments??{})){
    const host=removed.walls.find(w=>w.id===attachment.wallId)!;
    assert.ok(host);
    const start=host.points[attachment.segmentIndex],end=host.points[attachment.segmentIndex+1];
    assert.ok(start&&end);
    assert.deepEqual(wall.points[Number(index)],{x:start.x+(end.x-start.x)*attachment.along,y:start.y+(end.y-start.y)*attachment.along});
  }
});
test("repeated add/remove cycles keep identifiers unique and restore original",()=>{
  let walls=[rectangle];
  for(let cycle=0;cycle<5;cycle++){
    const added=addRoomOutsideWall(walls,{wallId:"base",segmentIndex:0},`added-${cycle}`);
    assert.equal(added.error,undefined);
    assert.equal(new Set(added.walls.map(w=>w.id)).size,added.walls.length);
    const room=closedRooms(added.walls).find(r=>r.vertices.some(p=>p.y<0))!;
    walls=removeRoomBoundary(added.walls,room.vertices).walls;
    assert.equal(closedRooms(walls).length,1);
    assert.deepEqual(walls[0].points,rectangle.points);
  }
});
for(const gap of [199,200])test(`exterior nonincident clearance ${gap} mm`,()=>{
  const blocker={id:"blocker",points:[{x:500,y:-2000-gap},{x:1500,y:-2000-gap}]};
  const result=addRoomOutsideWall([rectangle,blocker],{wallId:"base",segmentIndex:0},"new");
  assert.equal(Boolean(result.error),gap<200);
});
