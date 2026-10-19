import test from 'node:test';
import assert from 'node:assert/strict';
import { closeOpeningDraft,moveOpeningVertex,openingDraftPoint } from '../lib/floorOpeningDraft';
import { validateSimplePolygon } from '../lib/buildingGeometry';
import { activeFloor,buildingOf,duplicateFloor,moveFloor } from '../lib/buildingDocument';
import { newProject } from '../lib/projectDocument';

const square=(v:{x:number;y:number}[])=>v.every((p,i)=>p.x===v[(i+1)%v.length].x||p.y===v[(i+1)%v.length].y);

test('opening drawing locks each new side to the nearest orthogonal direction only when requested',()=>{
 const previous=[{x:100,y:100}];
 assert.deepEqual(openingDraftPoint(previous,{x:900,y:170},true),{x:900,y:100});
 assert.deepEqual(openingDraftPoint(previous,{x:150,y:900},true),{x:100,y:900});
 assert.deepEqual(openingDraftPoint(previous,{x:900,y:170},false),{x:900,y:170});
 assert.deepEqual(openingDraftPoint([],{x:900,y:170},true),{x:900,y:170});
});

test('Enter closes an orthogonal L-shaped opening with a final square corner',()=>{
 const points=[{x:0,y:0},{x:1200,y:0},{x:1200,y:600},{x:600,y:600},{x:600,y:1200}];
 const result=closeOpeningDraft(points,true);
 assert.equal(square(result),true);assert.equal(result.length,6);assert.doesNotThrow(()=>validateSimplePolygon(result));
 assert.equal(points.length,5,'draft closure cannot mutate source coordinates');
});

test('closing removes accidental repeated points, but never silently repairs self-crossings',()=>{
 const points=[{x:0,y:0},{x:1000,y:0},{x:1000,y:0},{x:1000,y:1000},{x:0,y:1000},{x:0,y:0}];
 const result=closeOpeningDraft(points,true);assert.equal(result.length,4);assert.doesNotThrow(()=>validateSimplePolygon(result));
 const crossing=closeOpeningDraft([{x:0,y:0},{x:1000,y:1000},{x:0,y:1000},{x:1000,y:0}],false);
 assert.throws(()=>validateSimplePolygon(crossing),/crosses|touches/);
});

test('square opening vertex drags retain adjacent right angles without changing the original',()=>{
 const points=[{x:0,y:0},{x:1000,y:0},{x:1000,y:1000},{x:0,y:1000}];
 const result=moveOpeningVertex(points,1,{x:1200,y:100},true);
 assert.equal(square(result),true);assert.deepEqual(points[0],{x:0,y:0});assert.deepEqual(points[1],{x:1000,y:0});
 assert.deepEqual(moveOpeningVertex(points,1,{x:1200,y:100},false)[0],points[0]);
});

test('floor sequence changes preserve custom names and the independent roof',()=>{
 let p=newProject();p=duplicateFloor(p,activeFloor(p).id);p=duplicateFloor(p,activeFloor(p).id);
 p.building!.floors.forEach((f,i)=>{f.name=['Lobby','Bedrooms','Loft'][i];});
 const before=buildingOf(p),names=new Map(before.floors.map(f=>[f.id,f.name])),roof=structuredClone(before.roof);
 p=moveFloor(p,before.floors[0].id,2);
 for(const f of buildingOf(p).floors)assert.equal(f.name,names.get(f.id));
 assert.deepEqual(buildingOf(p).roof,roof);
});
