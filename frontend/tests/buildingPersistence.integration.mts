import test from 'node:test';
import { copyTopFloor } from './buildingTestUtils';
import assert from 'node:assert/strict';
import 'fake-indexeddb/auto';
import { newProject,parseProject } from '../lib/projectDocument';
import { activeFloor,buildingOf,defaultBuilding,projectFloors,selectFloor,updateFloor,type FloorOpening } from '../lib/buildingDocument';
import { LocalProjectRepository } from '../lib/projectRepository';
import { exportProject,importProject,inspectPackage } from '../lib/projectPackage';
import { assetRepository } from '../lib/assetRepository';
import { ROOF_MATERIALS } from '../lib/roofAppearance';
const m=(value:number)=>({value,uncertainty_mm:0,verified:true,source_type:'USER_MEASURED'});
function fixture(){const p=newProject();p.rooms=[{id:'r',name:'Room',version:1,vertices:[{x:0,y:0},{x:8000,y:0},{x:8000,y:6000},{x:0,y:6000}],wall_height:m(2400),wall_thickness:m(100),obstacles:[],openings:[]}];p.building=defaultBuilding(p);return p;}
test('every roof finish and a precise custom direction survive a portable multi-floor project',async()=>{
 for(const material of ROOF_MATERIALS) {
  const p=copyTopFloor(fixture());p.building!.roof={...p.building!.roof,type:'GABLE',orientationDeg:37.125,finish:{material:material.id,colour:'#a17349',tileWidthMm:425,tileHeightMm:615}};
  const before=structuredClone(projectFloors(p)),blob=await exportProject(p),restored=await importProject(new File([blob],'roof-finish.floorplan3d'));
  assert.deepEqual(restored.building!.roof,p.building!.roof);assert.deepEqual(projectFloors(restored),before);
 }
});
test('three floors, polygonal slab openings and independent ceiling survive IndexedDB and portable package round trips',async()=>{
 let p=copyTopFloor(copyTopFloor(fixture()));const id=activeFloor(p).id,o:FloorOpening={id:'atrium',name:'Atrium',shape:'POLYGON',vertices:[{x:1000,y:1000},{x:4000,y:1000},{x:3500,y:3000},{x:1000,y:2500}]};
 p=updateFloor(p,id,{openings:[o]});p.building!.roof={...p.building!.roof,type:'GABLE',ceilingMode:'FLAT',ceilingHeightMm:2300,enabled:true,finish:{material:'CLAY_TILES',colour:'#a65338',tileWidthMm:300,tileHeightMm:400}};
 p=selectFloor(p,'floor-ground');p=parseProject(p);const repo=new LocalProjectRepository();await repo.saveProject(p);const saved=await repo.getProject(p.projectId);assert.deepEqual(saved,p);
 const blob=await exportProject(p),restored=await importProject(new File([blob],'building.floorplan3d'));assert.deepEqual(restored,p);assert.equal(projectFloors(restored).length,3);assert.deepEqual(projectFloors(restored).at(-1)!.openings,[o]);assert.equal(buildingOf(restored).roof.ceilingMode,'FLAT');
 const duplicate=await repo.duplicateProject(p.projectId);assert.equal(projectFloors(duplicate).length,3);assert.notEqual(duplicate.projectId,p.projectId);
});
test('inactive-floor data cannot bypass safety checks or smuggle project-level fields',()=>{
 const p=copyTopFloor(fixture());let q=structuredClone(p);q.building!.floors[0].content!.rooms[0].vertices[0].x=NaN;assert.throws(()=>parseProject(q),/number|finite/i);
 q=structuredClone(p);(q.building!.floors[0].content as unknown as Record<string,unknown>).projectId='other';assert.throws(()=>parseProject(q),/contents/);
 q=structuredClone(p);q.building!.floors[0].content!.rooms[0].id=q.rooms[0].id;assert.throws(()=>parseProject(q),/share/);
 q=structuredClone(p);(q.building!.floors[0].content!.rooms[0] as unknown as Record<string,unknown>).model_url='https://example.com/private';assert.throws(()=>parseProject(q),/External/);
});
test('a model referenced only by an inactive floor is included once and survives package import',async()=>{
 const json=JSON.stringify({asset:{version:'2.0'},scene:0,scenes:[{nodes:[0]}],nodes:[{mesh:0}],meshes:[{primitives:[{attributes:{POSITION:0}}]}],buffers:[{byteLength:36}],bufferViews:[{buffer:0,byteOffset:0,byteLength:36}],accessors:[{bufferView:0,componentType:5126,count:3,type:'VEC3',min:[0,0,0],max:[1,1,1]}]});
 const padded=json.padEnd(Math.ceil(json.length/4)*4,' '),jsonBytes=new TextEncoder().encode(padded),bytes=new Uint8Array(12+8+jsonBytes.length+8+36),view=new DataView(bytes.buffer);
 view.setUint32(0,0x46546c67,true);view.setUint32(4,2,true);view.setUint32(8,bytes.length,true);view.setUint32(12,jsonBytes.length,true);view.setUint32(16,0x4e4f534a,true);bytes.set(jsonBytes,20);const bin=20+jsonBytes.length;view.setUint32(bin,36,true);view.setUint32(bin+4,0x004e4942,true);[0,0,0,1,0,0,0,1,1].forEach((n,i)=>view.setFloat32(bin+8+i*4,n,true));
 const metadata=await assetRepository.importLocalAsset(new File([bytes],'upper-furniture.glb'));let p=fixture();p.assets=[metadata];p.assetInstances=[{instanceId:'ground-model',assetId:metadata.assetId,assetVersion:1,positionMm:{x:1200,y:2200,z:0},rotationDeg:{x:0,y:0,z:45},scale:{x:1,y:1,z:1}}];
 p=copyTopFloor(p);p=selectFloor(p,'floor-ground');p.assetInstances=[];const blob=await exportProject(p),inspected=inspectPackage(new Uint8Array(await blob.arrayBuffer()));assert.equal(inspected.project.assets.length,1);assert.equal(Object.keys(inspected.entries).filter(k=>k.endsWith('/model.glb')).length,1);
 const restored=await importProject(new File([blob],'inactive-asset.floorplan3d'));assert.equal(restored.assetInstances.length,0);assert.equal(projectFloors(restored)[1].content.assetInstances[0].assetId,metadata.assetId);assert.deepEqual(projectFloors(restored)[1].content.assetInstances[0].positionMm,{x:1200,y:2200,z:0});
});
