import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { FloorPlanOpeningSymbol } from "../components/FloorPlanOpeningGraphics";
import { DOOR_MODELS } from "../lib/doorModels";
import { openingClearAreaMm2, passageAreaMm2, passageHeightAt, passageProfileForKey, passageTopPoints, PASSAGE_PROFILES } from "../lib/passageOpenings";
import { newProject, parseProject } from "../lib/projectDocument";
import { calculatePlannerBuildMetrics } from "../lib/plannerBuild";
import { newHeatingProject } from "../lib/heatingDocument";
import { heatingResults } from "../lib/heatingDesign";
import { heatingRoomBalance } from "../lib/heatingPresentation";
import { skirtingRuns } from "../lib/skirting";
import { buildRenderedWalls } from "../lib/wallRendering";
import { windowHelpSteps } from "../lib/windowHelp";
import type { Opening, Room } from "../lib/types";

const measure = (value:number)=>({value,uncertainty_mm:1,verified:true,source_type:"USER_MEASURED"});
const passage = (profile:Opening["passage_profile"]="ROUND_ARCH"):Opening=>({id:"passage",kind:"DOOR",passage_profile:profile,parent_wall_id:"wall-001",offset_mm:800,width:measure(1000),height:measure(2300),sill_height_mm:0,metadata:{representation_key:"door-opening-arch"}});
function room():Room {return {id:"room-a",name:"Studio",version:1,vertices:[{x:0,y:0},{x:4000,y:0},{x:4000,y:3600},{x:0,y:3600}],wall_height:measure(2600),wall_thickness:measure(150),openings:[passage()],obstacles:[]};}

test("six doorless catalogue models provide four validated profiles with no leaves",()=>{
  const models=DOOR_MODELS.filter(model=>model.family==="doors-openings");
  assert.equal(models.length,6);assert.equal(new Set(models.map(model=>model.key)).size,6);
  assert.deepEqual(new Set(models.map(model=>model.profile)),new Set(PASSAGE_PROFILES));
  for(const model of models){assert.equal(model.operation,"OPENING");assert.equal(model.leaves,0);assert.equal(passageProfileForKey(model.key),model.profile);}
  assert.equal(passageProfileForKey("door-single"),undefined);
});

test("profile elevations and clear areas are symmetric, exact and stable across split wall spans",()=>{
  for(const profile of PASSAGE_PROFILES){
    const width=1600,height=2300,points=passageTopPoints(profile,width,height);
    assert.equal(passageHeightAt(profile,width,height,width/2),height);
    assert.ok(points.every((p,i)=>p.y>0&&p.y<=height&&(!i||p.x>points[i-1].x)));
    for(const p of points)assert.ok(Math.abs(p.y-passageHeightAt(profile,width,height,width-p.x))<1e-8);
    const total=passageAreaMm2(profile,width,height),parts=passageAreaMm2(profile,width,height,0,475)+passageAreaMm2(profile,width,height,475,1300)+passageAreaMm2(profile,width,height,1300,width);
    assert.ok(Math.abs(total-parts)<1e-8);
    assert.ok(total<=width*height);
    const clipped=passageTopPoints(profile,width,height,475,1300);assert.equal(clipped[0].x,475);assert.equal(clipped.at(-1)!.x,1300);
    assert.equal(clipped[0].y,passageHeightAt(profile,width,height,475));
  }
  assert.equal(passageAreaMm2("RECTANGULAR",900,2100),1890000);
  assert.ok(Math.abs(passageAreaMm2("ROUND_ARCH",1000,2300)-(1800000+Math.PI*250000/2))<1e-8);
});

test("every passage draws a selectable wall gap without a door leaf or swing arc",()=>{
  for(const model of DOOR_MODELS.filter(model=>model.operation==="OPENING")){
    const markup=renderToStaticMarkup(createElement(FloorPlanOpeningSymbol,{opening:{id:model.key,kind:"DOOR",representationKey:model.key,offset:400,width:model.width,doorType:"SINGLE",hingeSide:"START",opensInward:true},wallStart:{x:0,y:0},wallEnd:{x:5000,y:0},toScreen:p=>p,displayUnits:"MM"}));
    assert.match(markup,/passage-opening-symbol/);assert.match(markup,/opening-gap/);assert.match(markup,/no door leaf or swing/);assert.doesNotMatch(markup,/<path|door-leaf|swing-arc/);
  }
});

test("passage metadata and measured dimensions survive project parsing, but inconsistent profiles are rejected",()=>{
  const p=newProject();p.rooms=[room()];const restored=parseProject(JSON.parse(JSON.stringify(p)));
  assert.deepEqual(restored.rooms[0].openings[0],p.rooms[0].openings[0]);
  const mismatch=structuredClone(p);mismatch.rooms[0].openings[0].passage_profile="RECTANGULAR";
  assert.throws(()=>parseProject(mismatch),/profile does not match/);
  const window=structuredClone(p);window.rooms[0].openings[0].kind="WINDOW";
  assert.throws(()=>parseProject(window),/require a doorway/);
});

test("arch voids affect wall quantities, not door purchases or extra skirting casings",()=>{
  const p=newProject();p.rooms=[room()];const metrics=calculatePlannerBuildMetrics(p),area=openingClearAreaMm2(p.rooms[0].openings[0]);
  assert.equal(metrics.summary.doorCount,0);assert.equal(metrics.openings.doors,0);
  assert.equal(metrics.rooms[0].doors,0);assert.ok(Math.abs(metrics.rooms[0].openingAreaMm2-area)<1e-8);
  const wall=buildRenderedWalls(p.rooms).find(w=>w.index===0)!;
  assert.deepEqual(skirtingRuns(wall),[[0,800],[1800,4000]]);
});

test("a doorless passage to a colder space cannot be presented as a verified sealed-door heat-loss result",()=>{
  const results=heatingResults([room()],newHeatingProject()).rooms[0];
  assert.equal(results.capacityComparisonValid,false);assert.equal(results.status,"Not verified");
  assert.ok(results.warnings.some(w=>w.startsWith("Open passage ")));
  assert.equal(heatingRoomBalance(results).headline,"Heat loss needs checking");
  assert.ok(!results.demand.surfaces.some(s=>s.key==="opening:passage"));
});

test("Add elements help explains the new family, clear dimensions and lower side headroom",()=>{
  const text=windowHelpSteps("Add elements").map(step=>step.text).join(" ");
  assert.match(text,/Doors → Openings/);assert.match(text,/without a leaf or swing/);assert.match(text,/crown/);
});
