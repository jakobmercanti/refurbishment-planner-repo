import test from "node:test";
import assert from "node:assert/strict";
import { createRoomUFH, heatingResults } from "../lib/heatingDesign";
import { newHeatingProject, parseHeatingProject } from "../lib/heatingDocument";
import { resizeHeatingRooms } from "../lib/heatingRoomResize";
import { calculateCircuitLength, geometryFingerprint } from "../lib/heatingCalculations";
import type { Room } from "../lib/types";

const measured = (value:number) => ({value,uncertainty_mm:0,verified:true,source_type:"USER_MEASURED"});
const room:Room = {id:"room",name:"Studio",version:1,vertices:[{x:0,y:0},{x:4000,y:0},{x:4000,y:3000},{x:0,y:3000}],wall_height:measured(2400),wall_thickness:measured(100),openings:[],obstacles:[]};
test("room resizing regenerates UFH with real spacing, new coverage and heat demand; undo source stays intact",()=>{
 const heating=createRoomUFH(room,newHeatingProject()).heating, before=structuredClone(heating);
 heating.ufhCircuits[0].locked=true;before.ufhCircuits[0].locked=true;
 const bigger={...room,vertices:room.vertices.map(p=>({x:p.x*1.5,y:p.y*1.3}))};
 const resized=parseHeatingProject(resizeHeatingRooms([room],[bigger],heating));
 assert.deepEqual(heating,before);
 assert.equal(resized.ufhZones[0].spacingMm,heating.ufhZones[0].spacingMm);
 assert.equal(resized.ufhCircuits[0].circuitId,heating.ufhCircuits[0].circuitId);
 assert.equal(resized.ufhCircuits[0].locked,true);
 assert.equal(resized.ufhZones[0].geometryFingerprint,geometryFingerprint(bigger,[]));
 assert.ok(resized.ufhCircuits.reduce((n,c)=>n+calculateCircuitLength(c),0)>heating.ufhCircuits.reduce((n,c)=>n+calculateCircuitLength(c),0));
 assert.ok(heatingResults([bigger],resized).rooms[0].demand.designW>heatingResults([room],heating).rooms[0].demand.designW);
 assert.ok(!heatingResults([bigger],resized).rooms[0].warnings.some(w=>/geometry.*changed/i.test(w)));
 assert.equal(resizeHeatingRooms([room],[{...room,name:"New name"}],heating),heating);
});
test("resizing one room preserves the other room, follows exclusions and room labels",()=>{
 const other={...room,id:"other",vertices:room.vertices.map(p=>({x:p.x+10000,y:p.y}))};
 let heating=createRoomUFH(other,createRoomUFH(room,newHeatingProject()).heating).heating;
 heating={...heating,roomIndicatorPositions:{room:{x:2000,y:1500}},exclusions:[{exclusionId:"hole",roomId:"room",name:"Cabinet",polygonMm:[{x:50,y:50},{x:300,y:50},{x:300,y:300},{x:50,y:300}]}]};
 const changed={...room,vertices:room.vertices.map(p=>({x:p.x*1.2,y:p.y*1.2}))};
 const next=resizeHeatingRooms([room,other],[changed,other],heating);
 assert.deepEqual(next.ufhCircuits.filter(c=>c.roomId==="other"),heating.ufhCircuits.filter(c=>c.roomId==="other"));
 assert.deepEqual(next.roomIndicatorPositions.room,{x:2400,y:1800});
 assert.deepEqual(next.exclusions[0].polygonMm[0],{x:60,y:60});
 assert.equal(next.ufhZones[0].geometryFingerprint,geometryFingerprint(changed,next.exclusions));
});
