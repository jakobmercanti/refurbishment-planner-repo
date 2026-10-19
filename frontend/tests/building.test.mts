import test from 'node:test';
import { copyTopFloor } from './buildingTestUtils';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { Mesh, MeshBasicMaterial, Raycaster, ShapeGeometry, Vector3, DoubleSide, ExtrudeGeometry } from 'three';
import { newProject,parseProject,type ProjectDocument } from '../lib/projectDocument';
import { activeFloor,addFloor,buildingOf,defaultBuilding,deleteFloor,duplicateFloor,projectFloors,reorderFloor,roofSchema,selectFloor,updateFloor,type FloorOpening } from '../lib/buildingDocument';
import { buildRoofSurfaces,exposedCover,floorFootprint,planArea,polygonAreaMm2,roofFrame,roofHeightAt,snapToFloorReference,subtractVoids,validateFloorOpening,validateSimplePolygon,validateFloorOnBelow,validateFloorSupports,validateWallRunsOnFloor } from '../lib/buildingGeometry';
import { shapesFromPolygons } from '../components/BuildingSurfaces';
import { ProjectHistory } from '../lib/projectHistory';
import { BuildingControls } from '../components/BuildingControls';
import { BuildingPlanOverlay } from '../components/BuildingPlanOverlay';
import { newHeatingProject } from '../lib/heatingDocument';
import { newEnergyProject } from '../lib/energyDocument';
import { windowHelpSteps } from '../lib/windowHelp';
const m=(value:number)=>({value,uncertainty_mm:0,verified:true,source_type:'USER_MEASURED'});
const rectangle=[{x:0,y:0},{x:8000,y:0},{x:8000,y:6000},{x:0,y:6000}];
export function fixture():ProjectDocument {
 const p=newProject(),vertices=structuredClone(rectangle);
 p.rooms=[{id:'room-a',source_floorplan_room_id:'outline-a',name:'Ground living',version:1,vertices,wall_height:m(2400),wall_thickness:m(100),openings:[],obstacles:[{id:'fitting-a',name:'Furniture',kind:'BOX',fixture_kind:'FURNITURE',center:{x:2000,y:2000},base_z_mm:100,rotation_deg:30,verified:true,dimensions:{width:m(500),depth:m(600),height:m(700)}}]}];
 p.floorplan={walls:[{id:'wall-a',points:[...vertices,vertices[0]]}],rooms:[{id:'outline-a',sourceWallId:'wall-a',name:'Ground living',vertices}],openings:[],measurements:[],annotations:[],dimensionOffsets:{'wall-a:0':250},hiddenDimensions:[],canvasSize:{width:1100,height:700},selectedRoomId:'outline-a',wallHeight:2400,wallThickness:100};
 p.building=defaultBuilding(p);return p;
}
const opening=(id='void-1'):FloorOpening=>({id,name:'Stairwell',shape:'RECTANGLE',vertices:[{x:2000,y:2000},{x:4000,y:2000},{x:4000,y:3500},{x:2000,y:3500}]});
const near=(a:number,b:number,t=.001)=>assert.ok(Math.abs(a-b)<t,`${a} != ${b}`);
test('legacy v1 migrates deterministically to one flat-roof floor without changing geometry or sources',()=>{
 const original=fixture();delete original.building;const before=structuredClone(original),a=parseProject(original),b=parseProject(original);
 assert.equal(buildingOf(a).floors.length,1);assert.equal(buildingOf(a).roof.type,'FLAT');assert.deepEqual(a.building,b.building);assert.deepEqual(a.rooms,original.rooms);assert.deepEqual(a.floorplan,original.floorplan);assert.deepEqual(original,before);assert.deepEqual(parseProject(JSON.parse(JSON.stringify(a))),a);
});
test('copy/edit/stack owns independent rooms, wall references, assets and service data',()=>{
 const p=fixture();p.heatingLayout=newHeatingProject();p.energyLayout=newEnergyProject();const before=structuredClone(p),copy=copyTopFloor(p),top=activeFloor(copy);
 assert.equal(copy.building!.floors.length,2);near(top.elevationMm,2600);assert.notEqual(copy.rooms[0].id,p.rooms[0].id);assert.notEqual(copy.rooms[0].obstacles[0].id,p.rooms[0].obstacles[0].id);
 assert.equal(copy.rooms[0].source_floorplan_room_id,copy.floorplan!.rooms[0].id);assert.equal(copy.floorplan!.rooms[0].sourceWallId,copy.floorplan!.walls[0].id);assert.deepEqual(copy.rooms[0].vertices,p.rooms[0].vertices);
 copy.rooms[0].vertices[1].x=7000;copy.rooms[0].obstacles[0].center.x=3500;copy.heatingLayout!.buildingSettings.airChangeRate=2;
 const ground=selectFloor(copy,p.building!.activeFloorId);assert.deepEqual(ground.rooms,p.rooms);assert.deepEqual(ground.heatingLayout,p.heatingLayout);assert.deepEqual(p,before);
 assert.doesNotThrow(()=>parseProject(copy));
});
test('ID remapping never corrupts enum values, local wall IDs, finish keys or user text',()=>{
 const p=fixture();p.rooms[0].id='SOLID';p.floorplan!.walls[0].id='wall-001';p.floorplan!.rooms[0].sourceWallId='wall-001';p.floorplan!.annotations=[{id:'ann',type:'LINE',start:{x:1,y:2},end:{x:5,y:6},style:{lineStyle:'SOLID',thickness:1,textSize:14}}];
 p.rooms[0].openings=[{id:'door',kind:'DOOR',parent_wall_id:'wall-001',offset_mm:500,width:m(900),height:m(2100),sill_height_mm:0}];p.rooms[0].finishes={wall_colors:{'wall-001':'#ff0000'}};
 const next=copyTopFloor(p);assert.equal(next.floorplan!.annotations[0].style.lineStyle,'SOLID');assert.equal(next.rooms[0].openings[0].parent_wall_id,'wall-001');assert.equal(next.rooms[0].finishes!.wall_colors!['wall-001'],'#ff0000');assert.doesNotThrow(()=>parseProject(next));
});
test('blank and geometry-only copies cannot inherit previous floor service layouts or furniture',()=>{
 const p=fixture();p.heatingLayout=newHeatingProject();p.energyLayout=newEnergyProject();
 const blank=addFloor(p);assert.deepEqual(blank.rooms,[]);assert.equal(blank.floorplan,null);assert.equal(blank.heatingLayout,undefined);assert.equal(blank.energyLayout,undefined);assert.equal(blank.electricalLayout,undefined);
 const geometry=copyTopFloor(p,false);assert.equal(geometry.rooms.length,1);assert.equal(geometry.rooms[0].obstacles.length,0);assert.equal(geometry.heatingLayout,undefined);assert.equal(geometry.energyLayout,undefined);assert.doesNotThrow(()=>parseProject(blank));
});
test('rename, height/elevation changes, reorder and delete retain independent contents and dynamic top roof',()=>{
 let p=copyTopFloor(copyTopFloor(fixture()));const ids=p.building!.floors.map(f=>f.id),roof=p.building!.roof;
 p=updateFloor(p,ids[1],{name:'Studio',heightMm:3000});near(p.building!.floors[2].elevationMm,5600);
 p=updateFloor(p,ids[1],{elevationMm:2800});near(p.building!.floors[0].heightMm,2800);near(p.building!.floors[2].elevationMm,5800);
 p=reorderFloor(p,ids[1],1);assert.equal(p.building!.floors.at(-1)!.id,ids[1]);assert.deepEqual(p.building!.roof,roof);
 p=deleteFloor(p,ids[1]);assert.equal(p.building!.floors.length,2);assert.deepEqual(p.building!.roof,roof);assert.doesNotThrow(()=>parseProject(p));
 assert.throws(()=>deleteFloor(fixture(),'floor-ground'),/last floor/);assert.throws(()=>updateFloor(p,ids[0],{heightMm:-100}),/height|2000/i);
});
test('repeated copy and delete has no ID collisions, accumulated transforms or shared references',()=>{
 let p=fixture();const original=structuredClone(p.rooms);
 for(let i=0;i<12;i++){p=parseProject(copyTopFloor(p));assert.deepEqual(p.rooms[0].vertices,original[0].vertices);p=parseProject(deleteFloor(p,activeFloor(p).id));assert.deepEqual(p.rooms,original);}
 let five=fixture();for(let i=0;i<4;i++)five=copyTopFloor(five);const floors=projectFloors(parseProject(five));assert.equal(new Set(floors.flatMap(f=>f.content.rooms.map(r=>r.id))).size,5);assert.deepEqual(floors.map(f=>f.elevationMm),[0,2600,5200,7800,10400]);
});
test('duplicate any selected floor copies its dimensions and content immediately above its source',()=>{
 const p=updateFloor(copyTopFloor(fixture()),'floor-ground',{heightMm:3000,slabThicknessMm:250}),next=duplicateFloor(p,'floor-ground');
 assert.equal(activeFloor(next).heightMm,3000);assert.equal(activeFloor(next).slabThicknessMm,250);assert.equal(next.rooms.length,1);assert.notEqual(next.rooms[0].id,'room-a');assert.doesNotThrow(()=>parseProject(next));
});
test('real slab triangulation and thickness leave a hole with a clear ray through the slab',()=>{
 const p=fixture(),o=opening();validateFloorOpening(p,o,[]);const footprint=floorFootprint(p),cut=subtractVoids(footprint,[o]);near(planArea(cut),48000000-3000000);
 const shapes=shapesFromPolygons(cut),flat=new ShapeGeometry(shapes),solid=new ExtrudeGeometry(shapes,{depth:.2,bevelEnabled:false}),material=new MeshBasicMaterial({side:DoubleSide}),mesh=new Mesh(solid,material);
 mesh.updateMatrixWorld();const voidRay=new Raycaster(new Vector3(3,2.5,2),new Vector3(0,0,-1));assert.equal(voidRay.intersectObject(mesh).length,0);
 const solidRay=new Raycaster(new Vector3(1,1,2),new Vector3(0,0,-1));assert.ok(solidRay.intersectObject(mesh).length>0);
 let area=0;const pos=flat.getAttribute('position'),ix=flat.index!;for(let i=0;i<ix.count;i+=3){const a=ix.getX(i),b=ix.getX(i+1),c=ix.getX(i+2);area+=Math.abs((pos.getX(b)-pos.getX(a))*(pos.getY(c)-pos.getY(a))-(pos.getY(b)-pos.getY(a))*(pos.getX(c)-pos.getX(a)))/2;}near(area,45,1e-5);flat.dispose();solid.dispose();material.dispose();
});
test('opening validation rejects self-crossing, touching, small, nonfinite, overlapping and out-of-slab geometry',()=>{
 const p=fixture(),o=opening();assert.throws(()=>validateFloorOpening(p,{...o,vertices:o.vertices.map(v=>({x:v.x+7000,y:v.y}))},[]),/inside/);
 assert.throws(()=>validateFloorOpening(p,o,[{...o,id:'other'}]),/overlap/);assert.throws(()=>validateFloorOpening(p,{...o,vertices:o.vertices.map(v=>({x:v.x-1990,y:v.y}))},[]),/wall/);
 assert.throws(()=>validateSimplePolygon([{x:0,y:0},{x:200,y:200},{x:0,y:200},{x:200,y:0}]),/cross/);
 assert.throws(()=>validateSimplePolygon([{x:0,y:0},{x:10,y:0},{x:10,y:10}]),/50 mm/);assert.throws(()=>validateSimplePolygon([{x:NaN,y:0},{x:200,y:0},{x:0,y:200}]),/finite/);
 let upper=copyTopFloor(p);upper=updateFloor(upper,activeFloor(upper).id,{openings:[o]});assert.doesNotThrow(()=>parseProject(upper));assert.throws(()=>reorderFloor(upper,activeFloor(upper).id,-1),/lowest/);
 upper=deleteFloor(upper,'floor-ground');assert.deepEqual(activeFloor(upper).openings,[]);
});
test('smaller upper footprint produces a real exposed lower-floor flat cover',()=>{
 const p=fixture(),upper=structuredClone(p);upper.rooms[0].vertices=rectangle.map(v=>({x:v.x/2,y:v.y/2}));const lower=floorFootprint(p),top=floorFootprint(upper),cover=exposedCover(lower,top);near(planArea(cover),36000000);assert.ok(!subtractVoids(top,[opening()]).some(poly=>poly.length===0));
});
test('all four roof profiles triangulate arbitrary concave footprints without invalid coordinates or spanning a ridge',()=>{
 const footprints=[rectangle,[{x:0,y:0},{x:8000,y:0},{x:8000,y:2000},{x:3000,y:2000},{x:3000,y:6000},{x:0,y:6000}], [{x:0,y:0},{x:3000,y:0},{x:3000,y:4000},{x:5000,y:4000},{x:5000,y:0},{x:8000,y:0},{x:8000,y:6000},{x:0,y:6000}]];
 for(const vertices of footprints)for(const type of ['FLAT','MONO','GABLE','STEPPED']as const)for(const orientationDeg of [0,45,90,135,180,270]){
  const p=fixture();p.rooms[0].vertices=vertices;const footprint=floorFootprint(p),r=roofSchema.parse({...buildingOf(p).roof,type,orientationDeg}),frame=roofFrame(footprint,r),mesh=buildRoofSurfaces(footprint,r,2400);assert.ok(mesh.length>0);
  let projected=0;for(const s of mesh){assert.ok(s.positionsMm.every(Number.isFinite));assert.ok(s.indices.every(i=>i>=0&&i<s.positionsMm.length/3));if(s.kind!=='ROOF')continue;
   for(let i=0;i<s.indices.length;i+=3){const abc=s.indices.slice(i,i+3).map(j=>({x:s.positionsMm[j*3],y:s.positionsMm[j*3+1],z:s.positionsMm[j*3+2]}));const area=polygonAreaMm2(abc);assert.ok(area>0);projected+=area;
    const centre={x:abc.reduce((v,p)=>v+p.x/3,0),y:abc.reduce((v,p)=>v+p.y/3,0)};assert.ok(Math.abs(abc.reduce((v,p)=>v+p.z/3,0)-roofHeightAt(centre,r,frame)-r.thicknessMm)<.02,JSON.stringify({type,orientationDeg,abc,centre}));
   }
  }near(projected,planArea(footprint),.1);if(type==='STEPPED')assert.ok(mesh.some(s=>s.kind==='STEP'));
 }
});
test('flat suspended ceiling is geometrically distinct from a gabled roof underside',()=>{
 const p=fixture(),fp=floorFootprint(p),r={...buildingOf(p).roof,type:'GABLE' as const,ceilingMode:'FLAT' as const,ceilingHeightMm:2200},surfaces=buildRoofSurfaces(fp,r,2400);
 const ceilings=surfaces.filter(s=>s.kind==='CEILING');assert.equal(ceilings.length,1);assert.ok(ceilings[0].positionsMm.filter((_,i)=>i%3===2).every(z=>z===2200));assert.ok(surfaces.filter(s=>s.kind==='ROOF').some(s=>s.positionsMm.filter((_,i)=>i%3===2).some(z=>z>3000)));
 assert.equal(roofSchema.safeParse({...r,ceilingHeightMm:2800}).success,false);assert.equal(roofSchema.safeParse({...r,highHeightMm:2300}).success,false);assert.equal(roofSchema.safeParse({...r,type:'STEPPED',highHeightMm:2400}).success,false);
});
test('reference snapping operates in mm and never changes the noneditable lower plan',()=>{
 const p=fixture(),before=structuredClone(p);assert.deepEqual(snapToFloorReference({x:5,y:2},p,20),{x:0,y:0});assert.deepEqual(snapToFloorReference({x:4000,y:7},p,20),{x:4000,y:0});assert.deepEqual(snapToFloorReference({x:4000,y:3000},p,20),{x:4000,y:3000});assert.deepEqual(p,before);
});
test('project history restores floor operations without losing a later active-floor edit',()=>{
 const p=fixture(),h=new ProjectHistory(),copy=copyTopFloor(p);h.record(p,copy,true,0);const edited={...copy,rooms:copy.rooms.map(r=>({...r,name:'Upstairs edited'}))};h.record(copy,edited,false,1000);
 const undone=h.undo(edited)!;assert.equal(undone.rooms[0].name,'Ground living');const ground=h.undo(undone)!;assert.equal(projectFloors(ground).length,1);const redo=h.redo(ground)!;assert.equal(projectFloors(redo).length,2);assert.equal(h.redo(redo)!.rooms[0].name,'Upstairs edited');
});
test('compact floor selector exposes only the management button and detailed contextual help',()=>{
 const p=copyTopFloor(fixture());const props={onEdit(){},onUndo(){},onRedo(){},canUndo:false,canRedo:false,units:'MM' as const,in3D:false,view:{whole:false,roof:false,reference:true,snap:true},onView(){},tool:null,onTool(){},onFinish(){},selectedOpening:null,onSelectOpening(){},onRoofPreview(){},error:'',onError(){}};
 const bar=renderToStaticMarkup(createElement(BuildingControls,{...props,project:p}));assert.match(bar,/class="workspace-mode-select" aria-label="Selected floor"/);assert.match(bar,/class="workspace-mode-label">Floor/);assert.match(bar,/Manage floors and building/);assert.doesNotMatch(bar,/Floor properties…|Roof &amp; ceiling…|Export all floors|Snap to below/);assert.equal((bar.match(/<button/g)??[]).length,1);
 for(const title of ['Floors & building','Floor properties','Floor openings','Roof & ceiling','Add floor'])assert.ok(windowHelpSteps(title).length>=4);
});
test('add-floor help distinguishes blank floors from independent copies inserted above their source',()=>{
 const help=windowHelpSteps('Add floor').map(step=>step.text).join(' ');
 assert.match(help,/blank-floor properties window/);assert.match(help,/immediately above its source/);assert.doesNotMatch(help,/Copy floor below|view and export controls/);
});
test('slab-opening contours are read-only and greyed while a service module is editing',()=>{
 const content=fixture(),props={content,openings:[opening()],tool:null,selected:'void-1',onTool(){},onSelect(){},onChange(){},onError(){},toScreen:(p:{x:number;y:number})=>p,fromClient:(x:number,y:number)=>({x,y}),units:'MM' as const,finishRequest:0};
 const readonly=renderToStaticMarkup(createElement(BuildingPlanOverlay,{...props,interactive:false}));assert.match(readonly,/pointer-events="none"/);assert.match(readonly,/opacity="0.42"/);assert.match(readonly,/aria-disabled="true"/);assert.doesNotMatch(readonly,/data-floor-opening-interactive=/);assert.doesNotMatch(readonly,/floor-opening-handle/);
 const editable=renderToStaticMarkup(createElement(BuildingPlanOverlay,{...props,interactive:true}));assert.match(editable,/data-floor-opening-interactive="true"/);assert.match(editable,/floor-opening-handle/);
});
test('reversed stepped heights retain valid roof geometry and enforce the lowest ceiling limit',()=>{
 const p=fixture(),roof={...buildingOf(p).roof,type:'STEPPED' as const,lowHeightMm:3500,highHeightMm:2200,ceilingMode:'FLAT' as const,ceilingHeightMm:2100};assert.doesNotThrow(()=>roofSchema.parse(roof));assert.equal(roofSchema.safeParse({...roof,ceilingHeightMm:2300}).success,false);
 const mesh=buildRoofSurfaces(floorFootprint(p),roof,2200);assert.ok(mesh.some(s=>s.kind==='STEP'));assert.ok(mesh.every(s=>s.positionsMm.every(Number.isFinite)));assert.ok(mesh.filter(s=>s.kind==='CEILING').every(s=>s.positionsMm.filter((_,i)=>i%3===2).every(z=>z===2100)));
});
test('upper outlines must be contained by the immediately lower floor, not just have a smaller area',()=>{
 const below=fixture(),upper=structuredClone(below);assert.doesNotThrow(()=>validateFloorOnBelow(upper,below));
 const resize=(vertices:{x:number;y:number}[])=>{upper.rooms[0].vertices=vertices;upper.floorplan!.walls[0].points=[...vertices,vertices[0]];upper.floorplan!.rooms[0].vertices=vertices;};
 resize(rectangle.map(p=>({x:p.x/2,y:p.y/2})));assert.doesNotThrow(()=>validateFloorOnBelow(upper,below));
 resize(rectangle.map(p=>({x:p.x/2+6000,y:p.y/2})));assert.throws(()=>validateFloorOnBelow(upper,below),/A floor bigger than the one below is not supported/);
 resize(rectangle.map(p=>({x:p.x+1,y:p.y})));assert.throws(()=>validateFloorOnBelow(upper,below),/bigger/);
 const floors=projectFloors(copyTopFloor(below));floors[0].content.rooms[0].vertices=rectangle.map(p=>({x:p.x/2,y:p.y/2}));floors[0].content.floorplan!.walls[0].points=[...floors[0].content.rooms[0].vertices,floors[0].content.rooms[0].vertices[0]];assert.throws(()=>validateFloorSupports(floors),/bigger/);
});
test('open walls cannot extend outside, cross a concave recess or bridge a courtyard',()=>{
 const below=fixture();below.rooms[0].vertices=[{x:0,y:0},{x:8000,y:0},{x:8000,y:6000},{x:5000,y:6000},{x:5000,y:2000},{x:3000,y:2000},{x:3000,y:6000},{x:0,y:6000}];
 assert.doesNotThrow(()=>validateWallRunsOnFloor([{points:[{x:0,y:0},{x:8000,y:0}]}],below));
 assert.throws(()=>validateWallRunsOnFloor([{points:[{x:1000,y:5000},{x:7000,y:5000}]}],below),/bigger/);
 assert.throws(()=>validateWallRunsOnFloor([{points:[{x:0,y:0},{x:0,y:6001}]}],below),/bigger/);
 assert.throws(()=>validateWallRunsOnFloor([{points:[{x:100,y:100}]}],{rooms:[],floorplan:null,assetInstances:[]}),/Complete an enclosed floor/);
 const courtyard=fixture();courtyard.rooms=[[[0,0],[8000,0],[8000,2000],[0,2000]],[[0,4000],[8000,4000],[8000,6000],[0,6000]],[[0,2000],[2000,2000],[2000,4000],[0,4000]],[[6000,2000],[8000,2000],[8000,4000],[6000,4000]]].map((vertices,i)=>({...structuredClone(courtyard.rooms[0]),id:`court-${i}`,vertices:vertices.map(([x,y])=>({x,y}))}));
 assert.throws(()=>validateWallRunsOnFloor([{points:[{x:1000,y:3000},{x:7000,y:3000}]}],courtyard),/bigger/);
});
test('copy/reorder refuse a larger floor above a smaller one without changing the source',()=>{
 const p=copyTopFloor(fixture()),v=rectangle.map(p=>({x:p.x/2,y:p.y/2}));p.rooms[0].vertices=v;p.floorplan!.walls[0].points=[...v,v[0]];p.floorplan!.rooms[0].vertices=v;const original=structuredClone(p);
 assert.doesNotThrow(()=>validateFloorSupports(projectFloors(p)));const duplicated=duplicateFloor(p,'floor-ground');assert.equal(buildingOf(duplicated).floors[1].id,activeFloor(duplicated).id);assert.doesNotThrow(()=>validateFloorSupports(projectFloors(duplicated)));assert.throws(()=>reorderFloor(p,activeFloor(p).id,-1),/bigger/);assert.deepEqual(p,original);
});
test('reference snapping prefers exact non-grid corners and still snaps to rotated segments',()=>{
 const p=fixture();p.floorplan!.walls=[{id:'angled',points:[{x:117,y:163},{x:4117,y:2163}]}];assert.deepEqual(snapToFloorReference({x:125,y:165},p,20),{x:117,y:163});
 const result=snapToFloorReference({x:2110,y:1170},p,30);near((result.y-163)/(result.x-117),.5);assert.deepEqual(snapToFloorReference({x:5000,y:5000},p,20),{x:5000,y:5000});
});
