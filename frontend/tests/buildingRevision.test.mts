import test from 'node:test';
import { copyTopFloor } from './buildingTestUtils';
import assert from 'node:assert/strict';
import polygonClipping from 'polygon-clipping';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { newProject,parseProject,type ProjectDocument } from '../lib/projectDocument';
import { activeFloor,buildingOf,defaultBuilding,duplicateFloor,moveFloor,projectFloors,resetBuildingOutline,roofSchema,updateFloor } from '../lib/buildingDocument';
import { buildRoofSurfaces,floorFootprint,planArea,polygonOf,structuralFloorFootprint,subtractVoids,validateFloorSupports } from '../lib/buildingGeometry';
import { buildIsolatedRoomWalls,buildRenderedWalls } from '../lib/wallRendering';
import { wallEnvelope } from '../lib/wallEnvelope';
import { ROOF_MATERIALS,resolvedRoofFinish,roofTexturePixels } from '../lib/roofAppearance';
import { ProjectHistory } from '../lib/projectHistory';
import { FloorProperties,RoofProperties } from '../components/BuildingPropertyEditors';
import { BuildingPlanOverlay } from '../components/BuildingPlanOverlay';
const m=(value:number)=>({value,uncertainty_mm:0,verified:true,source_type:'USER_MEASURED'});
function fixture():ProjectDocument {
 const p=newProject(),vertices=[{x:0,y:0},{x:8000,y:0},{x:8000,y:6000},{x:0,y:6000}];
 p.rooms=[{id:'room',name:'Ground living',version:1,vertices,wall_height:m(2400),wall_thickness:m(100),openings:[],obstacles:[{id:'chair',name:'Chair',kind:'BOX',fixture_kind:'FURNITURE',center:{x:2000,y:2000},base_z_mm:0,rotation_deg:0,verified:true,dimensions:{width:m(500),depth:m(500),height:m(700)}}]}];
 p.floorplan={walls:[{id:'wall',points:[...vertices,vertices[0]]}],rooms:[{id:'outline',sourceWallId:'wall',name:'Ground living',vertices}],openings:[],annotations:[],measurements:[],dimensionOffsets:{},hiddenDimensions:[],selectedRoomId:'outline',canvasSize:{width:1100,height:700},wallHeight:2400,wallThickness:100};p.building=defaultBuilding(p);return p;
}
const bounds=(p:ReturnType<typeof structuralFloorFootprint>)=>{const a=p.flatMap(p=>p[0]);return[Math.min(...a.map(p=>p[0])),Math.min(...a.map(p=>p[1])),Math.max(...a.map(p=>p[0])),Math.max(...a.map(p=>p[1]))];};
test('slabs reach exactly the exterior wall faces, including per-wall thickness overrides',()=>{
 const p=fixture(),before=structuredClone(p);assert.deepEqual(bounds(structuralFloorFootprint(p)),[-100,-100,8100,6100]);assert.equal(planArea(floorFootprint(p)),48000000);assert.deepEqual(p,before);
 p.rooms[0].wall_thickness_overrides_mm={'wall-004':250,'wall-002':200};assert.deepEqual(bounds(structuralFloorFootprint(p)),[-250,-100,8200,6100]);
});
test('concave and shared-wall slabs contain every actual rendered wall quad without a bounding-box shortcut',()=>{
 for(const multiple of [false,true]){
  const p=fixture();p.rooms[0].vertices=[{x:0,y:0},{x:8000,y:0},{x:8000,y:3000},{x:4000,y:3000},{x:4000,y:6000},{x:0,y:6000}];
  if(multiple)p.rooms.push({...structuredClone(p.rooms[0]),id:'right',vertices:[{x:8000,y:0},{x:10000,y:0},{x:10000,y:3000},{x:8000,y:3000}],obstacles:[]});
  const before=structuredClone(p),fp=structuralFloorFootprint(p),walls=multiple?buildRenderedWalls(p.rooms):buildIsolatedRoomWalls(p.rooms[0]);
  for(const w of walls)assert.ok(planArea(polygonClipping.difference(polygonOf(wallEnvelope(w)),fp))<.01);
  assert.equal(planArea(polygonClipping.intersection(fp,polygonOf([{x:5000,y:4000},{x:6000,y:4000},{x:6000,y:5000},{x:5000,y:5000}]))),0,'concave notch stays empty');assert.deepEqual(p,before);
 }
});
test('wall-aligned structural slab keeps semantic voids clear and roof footprint flush',()=>{
 const p=fixture(),fp=structuralFloorFootprint(p),o={id:'void',name:'Stairwell',shape:'RECTANGLE' as const,vertices:[{x:2000,y:2000},{x:4000,y:2000},{x:4000,y:3500},{x:2000,y:3500}]};
 assert.equal(planArea(fp)-planArea(subtractVoids(fp,[o])),3000000);
 const mesh=buildRoofSurfaces(fp,buildingOf(p).roof,2400),roof=mesh.filter(s=>s.kind==='ROOF');assert.equal(Math.min(...roof.flatMap(s=>s.positionsMm.filter((_,i)=>i%3===0))),-100);assert.ok(mesh.some(s=>s.kind==='FASCIA'));assert.ok(mesh.every(s=>s.positionsMm.every(Number.isFinite)));
});
test('duplicating a larger lower floor inserts it below the smaller top and retains supported geometry',()=>{
 const p=copyTopFloor(fixture());p.rooms[0].vertices=p.rooms[0].vertices.map(v=>({x:v.x/2,y:v.y/2}));p.floorplan!.walls[0].points=[...p.rooms[0].vertices,p.rooms[0].vertices[0]];p.floorplan!.rooms[0].vertices=p.rooms[0].vertices;
 const before=structuredClone(p),top=activeFloor(p).id,q=duplicateFloor(p,'floor-ground');
 assert.equal(buildingOf(q).floors[1].id,activeFloor(q).id);assert.equal(buildingOf(q).floors[2].id,top);assert.deepEqual(q.rooms[0].vertices,projectFloors(p)[0].content.rooms[0].vertices);assert.doesNotThrow(()=>validateFloorSupports(projectFloors(q)));assert.doesNotThrow(()=>parseProject(q));assert.deepEqual(p,before);
});
test('duplicate names remain unique and valid at the 100-character limit; copies can exclude contents',()=>{
 let p=updateFloor(fixture(),'floor-ground',{name:'a'.repeat(100)});p=duplicateFloor(p,'floor-ground',false);assert.equal(p.rooms[0].obstacles.length,0);p=duplicateFloor(p,'floor-ground');const names=buildingOf(p).floors.map(f=>f.name);assert.equal(new Set(names).size,3);assert.ok(names.every(n=>n.length<=100));assert.doesNotThrow(()=>parseProject(p));
});
test('atomic reorder moves between distant positions and preserves the active projection and contents',()=>{
 const p=copyTopFloor(copyTopFloor(fixture())),before=structuredClone(p),ids=buildingOf(p).floors.map(f=>f.id),q=moveFloor(p,ids[0],2);assert.deepEqual(buildingOf(q).floors.map(f=>f.id),[ids[1],ids[2],ids[0]]);assert.equal(activeFloor(q).id,activeFloor(p).id);assert.deepEqual(q.rooms,p.rooms);assert.deepEqual(projectFloors(q).map(f=>f.elevationMm),[0,2600,5200]);assert.deepEqual(p,before);assert.doesNotThrow(()=>parseProject(q));assert.equal(moveFloor(p,ids[0],-1),p);assert.throws(()=>moveFloor(p,'missing',0),/not found/);
});
test('new outline from an upper floor keeps only the original ground level and resets placed contents',()=>{
 const p=copyTopFloor(copyTopFloor(fixture())),before=structuredClone(p),points=[{x:0,y:0},{x:2400,y:0},{x:2400,y:1800},{x:0,y:1800}],q=resetBuildingOutline(p,points);
 assert.equal(buildingOf(q).floors.length,1);assert.equal(activeFloor(q).id,'floor-ground');assert.deepEqual(q.rooms,[]);assert.deepEqual(q.assetInstances,[]);assert.equal(q.heatingLayout,undefined);assert.equal(q.energyLayout,undefined);assert.equal(q.electricalLayout,undefined);assert.deepEqual(q.floorplan!.walls[0].points,[...points,points[0]]);assert.equal(buildingOf(q).roof.type,'FLAT');assert.deepEqual(q.assets,p.assets);assert.deepEqual(q.plannerBuild,p.plannerBuild);assert.deepEqual(p,before);assert.doesNotThrow(()=>parseProject(q));
 const h=new ProjectHistory();h.record(p,q,true,0);assert.deepEqual(h.undo(q),p);assert.deepEqual(h.redo(p),q);
});
test('empty new outline also switches to the ground floor without retaining an upper footprint',()=>{
 const q=resetBuildingOutline(copyTopFloor(fixture()),null);assert.equal(buildingOf(q).floors.length,1);assert.equal(activeFloor(q).id,'floor-ground');assert.deepEqual(q.floorplan!.walls,[]);assert.deepEqual(q.floorplan!.rooms,[]);assert.deepEqual(q.rooms,[]);
});
test('legacy roof appearance is compatible; five finishes round-trip and never change geometry',()=>{
 const p=fixture(),r=buildingOf(p).roof,fp=structuralFloorFootprint(p),shape=buildRoofSurfaces(fp,r,2400);assert.equal(resolvedRoofFinish(r).material,'SLATE');
 for(const m of ROOF_MATERIALS){const roof={...r,enabled:true,finish:{material:m.id,colour:m.colour,tileWidthMm:300,tileHeightMm:400}};assert.deepEqual(buildRoofSurfaces(fp,roof,2400),shape);assert.deepEqual(roofSchema.parse(roof),roof);const q=parseProject({...p,building:{...buildingOf(p),roof}});assert.deepEqual(q.building!.roof,roof);}
 assert.deepEqual(buildRoofSurfaces(fp,{...r,enabled:false},2400),[]);
});
test('invalid roof materials, colours, scale and visibility flags are rejected',()=>{
 const r=buildingOf(fixture()).roof,finish=resolvedRoofFinish(r);
 for(const patch of [{material:'html'},{colour:'url(x)'},{colour:'#fff'},{tileWidthMm:99},{tileHeightMm:Infinity}])assert.equal(roofSchema.safeParse({...r,finish:{...finish,...patch}}).success,false);
 assert.equal(roofSchema.safeParse({...r,enabled:'true'}).success,false);
});
test('roof texture generation is deterministic, varied and opaque for each material',()=>{
 const patterns=ROOF_MATERIALS.map(m=>{const a=roofTexturePixels(m.id,64);assert.deepEqual(a,roofTexturePixels(m.id,64));assert.equal(a.length,64*64*4);assert.ok(new Set(a.filter((_,i)=>i%4!==3)).size>3);assert.ok(a.filter((_,i)=>i%4===3).every(v=>v===255));return Buffer.from(a).toString('base64');});assert.equal(new Set(patterns).size,5);
});
test('independent floor and roof editors expose existing styled controls, not copy-from-top actions',()=>{
 const p=fixture(),floor=renderToStaticMarkup(createElement(FloorProperties,{project:p,units:'MM',adding:true,onCommit(){},onCancel(){}}));assert.match(floor,/Floor name/);assert.match(floor,/Add floor/);assert.doesNotMatch(floor,/Duplicate floor|Copy floor below/);
 const roof=renderToStaticMarkup(createElement(RoofProperties,{roof:buildingOf(p).roof,units:'MM',footprint:structuralFloorFootprint(p),onPreview(){},onCommit(){},onCancel(){},onPreviewExterior(){}}));assert.match(roof,/Roof colour/);assert.match(roof,/Standing-seam metal/);assert.match(roof,/Preview exterior in 3D/);assert.doesNotMatch(roof,/<select(?![^>]*workspace-mode-select)/);
});
test('removing a roof also removes its ridge indicator from the 2D plan',()=>{
 const p=fixture(),roof={...buildingOf(p).roof,type:'GABLE' as const,highHeightMm:3400};
 const props={content:p,openings:[],tool:null,onTool(){},selected:null,onSelect(){},onChange(){},onError(){},toScreen:(point:{x:number;y:number})=>point,fromClient:(x:number,y:number)=>({x,y}),units:'MM' as const,finishRequest:0};
 assert.match(renderToStaticMarkup(createElement(BuildingPlanOverlay,{...props,roof})),/Roof ridge/);
 assert.doesNotMatch(renderToStaticMarkup(createElement(BuildingPlanOverlay,{...props,roof:{...roof,enabled:false}})),/Roof ridge|data-roof-profile/);
});
