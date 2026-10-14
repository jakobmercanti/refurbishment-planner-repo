import test from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createRoomUFH, heatingResults } from "../lib/heatingDesign";
import { REFERENCE_UFH_DATASETS, referenceUFHSettings } from "../lib/heatingCatalogue";
import { newHeatingProject, parseHeatingProject } from "../lib/heatingDocument";
import { calculateCircuitLength } from "../lib/heatingCalculations";
import { HeatingLayoutOverlay } from "../components/HeatingLayoutOverlay";
import { EnergyLayoutOverlay } from "../components/EnergyLayoutOverlay";
import { newEnergyProject } from "../lib/energyDocument";
import { windowHelpSteps } from "../lib/windowHelp";
import type { Room } from "../lib/types";
const measurement=(value:number)=>({value,uncertainty_mm:0,verified:true,source_type:"USER_MEASURED"});
const room:Room={id:"room",name:"Living room",version:1,vertices:[{x:0,y:0},{x:7500,y:0},{x:7500,y:4900},{x:0,y:4900}],wall_height:measurement(2500),wall_thickness:measurement(100),obstacles:[],openings:[]};
test("first UFH setup creates a manifold and valid split circuits without changing temperatures or other rooms",()=>{
 const initial=newHeatingProject(), before=structuredClone(initial), result=createRoomUFH(room,initial);
 assert.deepEqual(initial,before);const data=parseHeatingProject(result.heating);
 assert.equal(data.ufhZones.length,1);assert.equal(data.manifolds.length,1);assert.ok(data.ufhCircuits.length>0);
 assert.deepEqual(data.heatingSystem,initial.heatingSystem);assert.deepEqual(data.buildingSettings,initial.buildingSettings);
 assert.ok(data.ufhCircuits.every(c=>calculateCircuitLength(c)<=data.ufhZones[0].maxCircuitLengthM+.01));
 const row=heatingResults([room],data).rooms[0];assert.ok(row.zones[0].coveredAreaM2>row.zones[0].activeAreaM2*.8);
 assert.ok(!row.warnings.some(w=>/0\.0 \/|place.*manifold/i.test(w)));
 const repeated=createRoomUFH(room,data);assert.deepEqual(repeated.heating.ufhCircuits,data.ufhCircuits);
});
test("manufacturer presets populate technical data, with no invented table for geometry-only systems",()=>{
 assert.equal(REFERENCE_UFH_DATASETS.length,8);
 const minitec=REFERENCE_UFH_DATASETS[2];assert.equal(minitec.points.length,135);assert.equal(minitec.pipeDiameterMm,9.9);
 assert.equal(minitec.points.find(p=>p.spacingMm===150&&p.floorResistance===.1&&p.flowC===40&&p.returnC===30&&p.roomC===20)?.outputWm2,54);
 for(const dataset of REFERENCE_UFH_DATASETS){const defaults=referenceUFHSettings(dataset);assert.ok(defaults.minBendRadiusMm>0);assert.ok(dataset.reference.startsWith("https://www.uponor.com/"));assert.equal(defaults.performanceDataset.name,dataset.name);}
 for(const dataset of REFERENCE_UFH_DATASETS.slice(3))assert.deepEqual(dataset.points,[]);
});
test("each preset generates a first rectangular room route or safely rejects unsupported bend geometry",()=>{
 for(let i=0;i<REFERENCE_UFH_DATASETS.length;i++){
   // The fixed 150 mm Siccus FX grid cannot fit 160 mm diameter U-turns in
   // this generator. Keep its rating table, but never weaken the pipe radius.
   if(i===0){assert.throws(()=>createRoomUFH(room,newHeatingProject(),i),/No legal pipe route/);continue;}
   const before=newHeatingProject(); let result; try { result=createRoomUFH(room,before,i); } catch (e) { throw new Error(REFERENCE_UFH_DATASETS[i].name,{cause:e}); } assert.ok(result.heating.ufhCircuits.length,REFERENCE_UFH_DATASETS[i].name);assert.ok(!before.ufhCircuits.length);
 }
});
test("heating room cards include the room name and scale with zoom",()=>{
 const html=renderToStaticMarkup(createElement(HeatingLayoutOverlay,{zoom:.5,data:newHeatingProject(),rooms:[room],selection:null,onSelect(){},onChange(){},toScreen:p=>p,fromClient:(x,y)=>({x,y}),highlightedRoomId:null,draft:[]}));
 assert.match(html,/scale\(0.38\)/);assert.match(html,/>Living room<\/text>/);
});
test("insulation pairs named floor/roof rows in one movable table",()=>{
 const html=renderToStaticMarkup(createElement(EnergyLayoutOverlay,{rooms:[room],heating:newHeatingProject(),data:{...newEnergyProject(),enabled:true},selectedIds:[],onSelect(){},toScreen:p=>p,fromClient:(x,y)=>({x,y}),onChange(){}}));
 assert.equal((html.match(/data-energy-room-card=/g)||[]).length,1);assert.match(html,/data-energy-category="floor"/);assert.match(html,/data-energy-category="roof"/);assert.match(html,/Move floor and roof insulation: Living room/);
});
test("contextual help covers UFH import, room assumptions and electrical controls",()=>{
 assert.match(windowHelpSteps("Underfloor heating setup").map(v=>v.text).join(" "),/Create room UFH/);
 assert.match(windowHelpSteps("Heating — Pipe spacing mm").map(v=>v.text).join(" "),/bend radius|twice that radius/);
 assert.match(windowHelpSteps("Full Electrical Layout module — New connection defaults").map(v=>v.text).join(" "),/perpendicularly/);
});
