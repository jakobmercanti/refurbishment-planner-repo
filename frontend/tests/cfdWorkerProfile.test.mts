import assert from "node:assert/strict";
import test from "node:test";
import { cfdProject } from "./climoptixFixtures";
import { applyWorkerLimits, workerProfileIssues } from "../lib/cfdWorkerProfile";
import { postProcessingSchema } from "../lib/climoptixDocument";

const limits = { cpu: 1, memoryGb: 4, wallTimeMinutes: 15, storageGb: 1, retentionDays: 3, maxCells: 500000, concurrentJobs: 1 };

test("worker limits are explicit, immutable, idempotent and never increase a smaller request", () => {
  const scenario = cfdProject().cfdScenarios![0], before = structuredClone(scenario);
  const limited = applyWorkerLimits(scenario, limits);
  assert.deepEqual(scenario, before);
  assert.equal(limited.resources.cpu, 1);
  assert.ok(limited.mesh.maxCells <= limits.maxCells);
  assert.equal(limited.physics, scenario.physics);
  assert.equal(limited.seed, scenario.seed);
  assert.deepEqual(applyWorkerLimits(limited, limits), limited);
  limited.resources.memoryGb = 1;
  assert.equal(applyWorkerLimits(limited, limits).resources.memoryGb, 1);
});

test("worker compatibility advises on unsupported intent without changing it", () => {
  const scenario = applyWorkerLimits(cfdProject().cfdScenarios![0], limits);
  assert.deepEqual(workerProfileIssues(scenario, limits), []);
  scenario.physics.energy = true;
  scenario.mesh.layers.enabled = true;
  scenario.outputs.co2 = true;
  const before = structuredClone(scenario);
  const issues = workerProfileIssues(scenario, limits);
  assert.ok(issues.some(x => x.includes("thermal")));
  assert.ok(issues.some(x => x.includes("Boundary layers")));
  assert.ok(issues.some(x => x.includes("velocity")));
  assert.deepEqual(scenario, before);
});

test("250 enabled sampling planes are allowed across axes while the probe limit stays at 100",()=>{
  const scenario=applyWorkerLimits(cfdProject().cfdScenarios![0],limits);
  scenario.postProcessing={...scenario.postProcessing,x:{enabled:true,count:250},y:{enabled:false,count:250},z:{enabled:false,count:250}};
  assert.ok(postProcessingSchema.safeParse(scenario.postProcessing).success);
  assert.deepEqual(workerProfileIssues(scenario,limits),[]);
  scenario.postProcessing.y={enabled:true,count:1};
  assert.ok(workerProfileIssues(scenario,limits).some(s=>s.includes('250 sampling planes')));
  scenario.postProcessing.y.enabled=false;scenario.outputs.probesMm=Array.from({length:101},()=>[0,0,0]);
  assert.ok(workerProfileIssues(scenario,limits).some(s=>s.includes('100 probes')));
  assert.equal(postProcessingSchema.safeParse({...scenario.postProcessing,x:{enabled:true,count:251}}).success,false);
});
