import "fake-indexeddb/auto";
import assert from "node:assert/strict";
import test from "node:test";
import { activeFloor, duplicateFloor, sharedRoofProfile, updateFloor } from "../lib/buildingDocument";
import { defaultBalustrade } from "../lib/balustrades";
import { exportProject, importProject } from "../lib/projectPackage";
import { projectRepository } from "../lib/projectRepository";
import { ProjectHistory } from "../lib/projectHistory";
import { roofProject, stairOpening } from "./roofBalustradeFixtures";

function project(){
  const p=roofProject(true);
  p.building!.roof={...p.building!.roof,roomRoofsEnabled:true,roomOverrides:[{roomId:p.rooms[0].id,roof:{...sharedRoofProfile(p.building!.roof),type:"MONO",highHeightMm:3900,orientationDeg:33.75}}]};
  return updateFloor(p,activeFloor(p).id,{openings:[{...stairOpening(),balustrade:{...defaultBalustrade(),style:"GLASS",colour:"#456789"}}]});
}
test("IndexedDB and portable project packages retain every room roof and opening guard",async()=>{
  const p=project();await projectRepository.saveProject(p);
  const stored=await projectRepository.getProject(p.projectId);assert.deepEqual(stored?.building,p.building);
  const file=await exportProject(p),loaded=await importProject(new File([file],"combined-roofs.floorplan3d"));
  assert.deepEqual(loaded.building,p.building);assert.deepEqual(loaded.rooms,p.rooms);
});
test("history atomically restores combined roofs, copied guards and the optional single-roof state",()=>{
  const p=project(),copy=duplicateFloor(p,activeFloor(p).id),single=structuredClone(copy);single.building!.roof.roomRoofsEnabled=false;
  const history=new ProjectHistory();history.record(p,copy,true);history.record(copy,single,true);
  assert.deepEqual(history.undo(single)?.building,copy.building);assert.deepEqual(history.undo(copy)?.building,p.building);
  assert.deepEqual(history.redo(p)?.building,copy.building);assert.deepEqual(history.redo(copy)?.building,single.building);
  assert.equal(single.building!.roof.roomOverrides!.length,2);assert.notEqual(single.building!.floors[1].openings[0].id,single.building!.floors[2].openings[0].id);
});
