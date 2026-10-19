import test from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { newProject,parseProject,type ProjectDocument } from '../lib/projectDocument';
import { activeFloor,buildingOf,defaultBuilding,deleteFloor,duplicateFloor,minimumRoofHeight,roofSchema,selectFloor,updateFloor,withRoofProfile } from '../lib/buildingDocument';
import { matchesProjectScope,projectScope } from '../lib/projectScope';
import { roomMeasurement } from '../lib/roomMeasurement';
import { ProjectHistory } from '../lib/projectHistory';
import { BuildingPlanOverlay } from '../components/BuildingPlanOverlay';
import { structuralFloorFootprint,roofFrame } from '../lib/buildingGeometry';

const measure=(value:number)=>({value,uncertainty_mm:0,verified:true,source_type:'USER_MEASURED'});
function fixture():ProjectDocument {
 const p=newProject();
 p.rooms=[{id:'audit-room',name:'Audit room',version:1,vertices:[{x:0,y:0},{x:8000,y:0},{x:8000,y:6000},{x:0,y:6000}],wall_height:measure(2400),wall_thickness:measure(100),wall_thickness_overrides_mm:{'wall-004':250},openings:[],obstacles:[]}];
 p.building=defaultBuilding(p);return p;
}
test('floor selection does not bury modelling edits or invalidate Redo',()=>{
 const base=fixture(),copied=duplicateFloor(base,'floor-ground'),id=activeFloor(copied).id,history=new ProjectHistory();
 const renamed=updateFloor(copied,id,{name:'Library'});history.record(copied,renamed,true,0);
 const ground=selectFloor(renamed,'floor-ground');history.record(renamed,ground,true,1000);
 assert.equal(history.past.length,1,'floor projection is view state, not a second modelling edit');
 const undo=history.undo(ground)!;assert.equal(buildingOf(undo).floors[1].name,buildingOf(copied).floors[1].name);
 const upstairs=selectFloor(undo,id);history.record(undo,upstairs,true,2000);
 assert.equal(history.future.length,1,'changing floor after Undo must keep Redo');
 assert.equal(buildingOf(history.redo(upstairs)!).floors[1].name,'Library');
});
test('view settings on inactive floors do not consume model history',()=>{
 const p=duplicateFloor(fixture(),'floor-ground'),q=structuredClone(p),history=new ProjectHistory();
 const content=q.building!.floors[0].content!;
 // Test both active and inactive projections even when no plan was previously saved.
 const plan={walls:[],rooms:[],openings:[],measurements:[],annotations:[],dimensionOffsets:{},hiddenDimensions:[],selectedRoomId:null,canvasSize:{width:1100,height:700},wallHeight:2400,wallThickness:100};
 p.building!.floors[0].content!.floorplan={...plan};content.floorplan={...plan,canvasSize:{width:600,height:400}};
 history.record(p,q);assert.equal(history.past.length,0);
});
test('2D roof ridge uses the same asymmetric exterior-wall frame as the 3D roof',()=>{
 const p=fixture(),roof={...buildingOf(p).roof,type:'GABLE' as const,orientationDeg:90},frame=roofFrame(structuralFloorFootprint(p),roof);
 const expectedX=-(frame.min+frame.max)/2;
 const html=renderToStaticMarkup(createElement(BuildingPlanOverlay,{content:p,openings:[],tool:null,onTool(){},selected:null,onSelect(){},onChange(){},onError(){},toScreen:(point:{x:number;y:number})=>point,fromClient:(x:number,y:number)=>({x,y}),units:'MM',finishRequest:0,roof}));
 const x=Number(html.match(/<line x1="([^"]+)"/)![1]);assert.ok(Math.abs(x-expectedX)<.001,`${x} must align with exterior ridge ${expectedX}`);
});
test('five-floor repeated duplicate/edit/delete inputs remain independently serializable',()=>{
 let p=fixture();const original=structuredClone(p.rooms);
 for(let i=0;i<4;i++)p=parseProject(duplicateFloor(p,activeFloor(p).id));
 for(const floor of buildingOf(p).floors){p=selectFloor(p,floor.id);p=updateFloor(p,floor.id,{name:'Level '+floor.elevationMm});assert.doesNotThrow(()=>parseProject(p));}
 assert.deepEqual(selectFloor(p,'floor-ground').rooms,original);
 assert.equal(new Set(buildingOf(p).floors.map(f=>f.id)).size,5);
 for(let i=0;i<4;i++){p=parseProject(deleteFloor(p,activeFloor(p).id));}
 assert.equal(buildingOf(p).floors.length,1);assert.deepEqual(p.rooms,original);
});
test('a delayed callback cannot write to another project with the same ground-floor ID',()=>{
 const p=fixture(),other=fixture(),token=projectScope(p);
 assert.equal(p.building!.activeFloorId,other.building!.activeFloorId);
 assert.equal(matchesProjectScope(other,token),false);
 assert.equal(matchesProjectScope(p,token),true);
 assert.equal(matchesProjectScope(duplicateFloor(p,'floor-ground'),token),false);
 assert.equal(matchesProjectScope(null,token),false);
 assert.equal(matchesProjectScope(p,projectScope(p,1),2),false,'reopening the same file must invalidate old callbacks too');
});
test('roof profile changes preserve valid rises and repair only invalid ones',()=>{
 const roof={...buildingOf(fixture()).roof,type:'GABLE' as const,highHeightMm:2800};
 for(const type of ['FLAT','MONO','GABLE','STEPPED'] as const){const next=withRoofProfile(roof,type);assert.equal(next.highHeightMm,2800);assert.doesNotThrow(()=>roofSchema.parse(next));}
 const flat={...roof,type:'FLAT' as const,highHeightMm:2400};assert.equal(withRoofProfile(flat,'GABLE').highHeightMm,3400);
 const reversed={...roof,type:'STEPPED' as const,highHeightMm:2000};assert.equal(withRoofProfile(reversed,'STEPPED').highHeightMm,2000);assert.equal(withRoofProfile(reversed,'MONO').highHeightMm,3400);
});
test('flat ceiling validation uses the effective profile underside, not an unused high field',()=>{
 const roof={...buildingOf(fixture()).roof,type:'FLAT' as const,highHeightMm:1800,ceilingMode:'FLAT' as const,ceilingHeightMm:2300};
 assert.equal(minimumRoofHeight(roof),2400);assert.doesNotThrow(()=>roofSchema.parse(roof));
 assert.equal(minimumRoofHeight({...roof,type:'STEPPED'}),1800);assert.equal(roofSchema.safeParse({...roof,type:'STEPPED'}).success,false);
});
test('plan restoration preserves verified dimensions, uncertainty and room-specific heights',()=>{
 const stored={value:2150,uncertainty_mm:1.5,verified:true,source_type:'IMPORTED_SURVEY'};
 assert.equal(roomMeasurement(stored,2400),stored);
 assert.equal(roomMeasurement(stored,2150,true),stored);
 assert.deepEqual(stored,{value:2150,uncertainty_mm:1.5,verified:true,source_type:'IMPORTED_SURVEY'});
});
test('new or deliberately edited dimensions use an explicit unverified measurement',()=>{
 const stored={value:100,uncertainty_mm:1,verified:true,source_type:'IMPORTED_SURVEY'};
 assert.deepEqual(roomMeasurement(stored,200,true),{value:200,uncertainty_mm:5,verified:false,source_type:'USER_MEASURED'});
 assert.deepEqual(roomMeasurement(undefined,200),{value:200,uncertainty_mm:5,verified:false,source_type:'USER_MEASURED'});
});
test('benign editor default hydration is not a model edit; dimensions still are',()=>{
 const p=fixture(),q=structuredClone(p),history=new ProjectHistory();
 const plan={walls:[],rooms:[{id:'outline',name:'Audit',sourceWallId:'wall',vertices:p.rooms[0].vertices}],openings:[],measurements:[],annotations:[],dimensionOffsets:{},hiddenDimensions:[],selectedRoomId:null,canvasSize:{width:1100,height:700},wallHeight:2400,wallThickness:100};
 p.floorplan=plan;q.floorplan={...plan,roomFinishes:{},rooms:plan.rooms.map(r=>({...r,sourceWallIds:['wall'],colourIndex:0}))};q.rooms[0].person_mockup=null;
 history.record(p,q);assert.equal(history.past.length,0);
 q.rooms[0].wall_thickness={...q.rooms[0].wall_thickness,value:150};history.record(p,q);assert.equal(history.past.length,1);
});
test('legacy low ceilings are not silently raised to 2400 mm by migration',()=>{
 const p=fixture();p.rooms[0].wall_height=measure(2000);delete p.building;
 const q=parseProject(p);assert.equal(q.building!.roof.lowHeightMm,2000);assert.equal(q.building!.floors[0].heightMm,2200);assert.equal(q.rooms[0].wall_height.value,2000);
});

test('schema hydration object-key ordering does not create a model history step',()=>{
 const p=fixture(),q=structuredClone(p),history=new ProjectHistory();
 q.rooms[0]=Object.fromEntries(Object.entries(q.rooms[0]).reverse()) as typeof q.rooms[number];
 history.record(p,q);assert.equal(history.past.length,0);
 q.rooms[0].wall_height={...q.rooms[0].wall_height,uncertainty_mm:2};
 history.record(p,q);assert.equal(history.past.length,1,'measurement uncertainty remains authoritative');
});
