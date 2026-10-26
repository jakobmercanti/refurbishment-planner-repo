import test from "node:test";
import assert from "node:assert/strict";
import { applyCFDHeating, type CFDHeatingCandidate } from "../lib/cfdHeatingBridge";
import { boundarySchema, newCFDScenario, assetOverrideSchema } from "../lib/climoptixDocument";

test("heating handoff is explicit, atomic, source-linked, and never double counts watts plus temperature",()=>{
  const scenario=newCFDScenario("building"),original=structuredClone(scenario);
  scenario.assetOverrides=[assetOverrideSchema.parse({objectId:"radiator",heatW:400,mode:"solidProxy"})];
  scenario.hiddenObjectIds=["radiator","other"];
  const sources:CFDHeatingCandidate[]=[{id:"radiator",name:"Measured radiator",kind:"object",target:"radiator"},{id:"floor",name:"Measured UFH floor",kind:"floor",target:"room:floor",boundary:boundarySchema.parse({})}];
  const before=structuredClone(scenario),next=applyCFDHeating(scenario,sources,{radiator:318.15,floor:303.15});
  assert.deepEqual(scenario,before);
  assert.equal(next.assetOverrides.length,1);assert.equal(next.assetOverrides[0].heatW,0);assert.equal(next.assetOverrides[0].temperatureK,318.15);
  assert.deepEqual(next.hiddenObjectIds,["other"]);
  assert.equal(next.boundaries.patches["room:floor"].thermal.value,303.15);
  assert.equal(next.boundaries.patches["room:floor"].flow.type,"noSlip");
  assert.equal(next.physics.energy,true);assert.equal(next.physics.boussinesq,true);assert.ok(next.postProcessing.fields.includes("T"));
  assert.deepEqual(next.vents,original.vents);assert.deepEqual(next.objectCopies,original.objectCopies);
  assert.throws(()=>applyCFDHeating(scenario,sources,{missing:300}),/no longer/);
  assert.throws(()=>applyCFDHeating(scenario,sources,{floor:NaN}),/temperature/);
  assert.throws(()=>applyCFDHeating(scenario,sources,{floor:50}),/temperature/);
  assert.deepEqual(scenario,before);
});
