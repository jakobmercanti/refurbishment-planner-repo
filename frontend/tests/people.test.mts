import test from "node:test";
import assert from "node:assert/strict";
import { defaultPersonSpec, personDimensions, withPersonSpec, placePersonOnSupport, syncSupportedPeople, personSpecSchema, PERSON_MODELS, STATURE_PRESETS, type CataloguePerson } from "../lib/people";
import { newProject, parseProject } from "../lib/projectDocument";
import { defaultBuilding, duplicateFloor, activeFloor, projectFloors } from "../lib/buildingDocument";
import { MACRO_CATEGORY_ORDER, macroCategoryForCategoryId } from "../lib/catalogueTaxonomy";
import { ADD_TO_PLAN_MODES } from "../lib/addToPlanModes";
import { windowHelpSteps } from "../lib/windowHelp";
import type { Obstacle, Room } from "../lib/types";

const m=(value:number)=>({value,uncertainty_mm:0,verified:false,source_type:"USER_MEASURED"});
const host=(key="furniture-chair-modern"):Obstacle=>({id:"support",name:"My furniture",kind:"BOX",representation_key:key,fixture_kind:"FURNITURE",center:{x:2500,y:2500},rotation_deg:0,base_z_mm:0,verified:false,dimensions:{width:m(1600),depth:m(2100),height:m(850)}});
function person(posture:CataloguePerson["posture"]="SEATED",style:CataloguePerson["style"]="CASUAL"):Obstacle {
  const spec:CataloguePerson={posture,style,stature_mm:1800,seat_height_mm:441};
  return withPersonSpec({...host(),id:"person",name:"Seated person · 1800 mm stature"},spec);
}
const room=(items:Obstacle[]):Room=>({id:"people-room",name:"Room",version:1,vertices:[{x:0,y:0},{x:6000,y:0},{x:6000,y:6000},{x:0,y:6000}],wall_height:m(2600),wall_thickness:m(100),obstacles:items,openings:[]});
const near=(a:number,b:number)=>assert.ok(Math.abs(a-b)<1e-7,`${a} != ${b}`);

test("People is top-level in both catalogue taxonomy and the Add elements mode selector",()=>{
  assert.ok(MACRO_CATEGORY_ORDER.includes("people"));assert.equal(macroCategoryForCategoryId("people"),"people");
  assert.deepEqual(ADD_TO_PLAN_MODES.find(mode=>mode.value==="PEOPLE"),{value:"PEOPLE",label:"People"});
});
test("all 18 nominal templates separate standing stature from posed mm envelopes and preserve appearance independence",()=>{
  for(const model of PERSON_MODELS)for(const height of STATURE_PRESETS){
    const spec=defaultPersonSpec(model.key,height*model.heightFactor)!;near(spec.stature_mm,height);
    const size=personDimensions(spec);near(size.height,height*model.heightFactor);near(size.depth,height*model.depthFactor);
    for(const style of ["CASUAL","SMART","MANNEQUIN"] as const)assert.deepEqual(personDimensions({...spec,style} as CataloguePerson),size);
  }
  for(const change of [{stature_mm:NaN},{stature_mm:599},{seat_height_mm:Infinity},{style:"OTHER"},{posture:"STANDING",support:{obstacle_id:"support",surface_height_mm:450,lateral_offset_mm:0}}])assert.throws(()=>personSpecSchema.parse({...person().person_spec,...change}));
});
test("seated contact and lying mattress anchors are deterministic at arbitrary furniture rotations",()=>{
  for(const angle of [0,90,180,270,37.125]){
    const chair={...host(),rotation_deg:angle,base_z_mm:100};
    const seated=placePersonOnSupport(person(),chair,450,120),r=angle*Math.PI/180;
    near(seated.center.x,2500+120*Math.cos(r)+288*Math.sin(r));near(seated.center.y,2500+120*Math.sin(r)-288*Math.cos(r));
    assert.equal(seated.base_z_mm,0);assert.equal(seated.person_spec?.seat_height_mm,550);near(seated.dimensions.height.value,550+.52*1800);
    const bed={...host("furniture-bed-king"),rotation_deg:angle,base_z_mm:20};
    const lying=placePersonOnSupport(person("LYING"),bed,500);assert.equal(lying.base_z_mm,520);assert.equal(lying.rotation_deg,angle);
  }
});
test("attachments follow furniture translation/rotation, but person dragging or host deletion detaches without moving the last safe pose",()=>{
  const chair=host(),p=placePersonOnSupport(person(),chair,450),before=[chair,p];
  const moved={...chair,center:{x:3000,y:2700},rotation_deg:45};
  const grown=placePersonOnSupport(withPersonSpec(p,{...p.person_spec!,stature_mm:1950}),chair,450);
  assert.equal(syncSupportedPeople([chair,grown],before)[1].person_spec?.support?.obstacle_id,chair.id);
  const after=syncSupportedPeople([moved,p],before,room(before));assert.equal(after[1].person_spec?.support?.obstacle_id,chair.id);assert.equal(after[1].rotation_deg,45);assert.notDeepEqual(after[1].center,p.center);
  const dragged={...p,center:{x:p.center.x+200,y:p.center.y}};
  assert.equal(syncSupportedPeople([chair,dragged],before)[1].person_spec?.support,undefined);
  const orphan=syncSupportedPeople([p],before)[0];assert.equal(orphan.person_spec?.support,undefined);assert.deepEqual(orphan.center,p.center);
  const unsafe=syncSupportedPeople([{...chair,center:{x:50,y:50}},p],before,room(before))[1];assert.equal(unsafe.person_spec?.support,undefined);assert.deepEqual(unsafe.center,p.center);
});
test("wrong furniture, insufficient width/bed length and invalid contact heights cannot silently produce a misleading attachment",()=>{
  assert.throws(()=>placePersonOnSupport(person("LYING"),host()),/bed/);
  assert.throws(()=>placePersonOnSupport(person("STANDING"),host()),/seat/);
  assert.throws(()=>placePersonOnSupport(person(),host(),900),/Contact height/);
  assert.throws(()=>placePersonOnSupport(person(),{...host(),dimensions:{...host().dimensions,width:m(200)}}),/does not fit/);
  assert.throws(()=>placePersonOnSupport(person("LYING"),{...host("furniture-bed-single"),dimensions:{...host().dimensions,depth:m(1500)}}),/too long/);
  const forged=person("LYING");forged.dimensions.depth.value=500;
  assert.throws(()=>placePersonOnSupport(forged,{...host("furniture-bed-single"),dimensions:{...host().dimensions,depth:m(1500)}}),/too long/);
});
test("floor duplication remaps support links to copied furniture and malformed support/model metadata is rejected on import",()=>{
  let project=newProject();const chair=host(),p=placePersonOnSupport(person(),chair,450);
  project.rooms=[room([chair,p])];project.building=defaultBuilding(project);
  project=duplicateFloor(project,activeFloor(project).id);const copied=project.rooms[0].obstacles;
  assert.notEqual(copied[0].id,chair.id);assert.equal(copied[1].person_spec?.support?.obstacle_id,copied[0].id);
  assert.equal(projectFloors(project)[0].content.rooms[0].obstacles[1].person_spec?.support?.obstacle_id,chair.id);
  assert.doesNotThrow(()=>parseProject(project));
  const bad=structuredClone(project);bad.rooms[0].obstacles[1].person_spec!.support!.obstacle_id="missing";assert.throws(()=>parseProject(bad),/same room/);
  const wrong=structuredClone(project);wrong.rooms[0].obstacles[1].person_spec!.posture="LYING";assert.throws(()=>parseProject(wrong),/does not match/);
});
test("People help explains stature, furniture, support remapping and the limits of the CFD representation",()=>{
  const help=windowHelpSteps("People & furniture").map(step=>step.text).join(" ");
  for(const phrase of [/standing height/,/contact height/,/remaps support/,/not ergonomic/,/heat/])assert.match(help,phrase);
});
