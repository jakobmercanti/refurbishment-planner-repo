import assert from "node:assert/strict";
import test from "node:test";
import { captureCFDSource, matchesCFDSource, cacheCFDReport } from "../lib/cfdSource";
import { parseCFDReport } from "../lib/climoptixReport";
import { sharedBoundaryInputsSchema } from "../lib/sharedBoundaryDocument";
import { sharedCaseRooms } from "../lib/sharedSources";
import { hvacBoundaryPackage, resolveHvacScenario } from "../lib/hvacBridge";
import { parseProject } from "../lib/projectDocument";
import { newHeatingProject } from "../lib/heatingDocument";
import { cfdProject, realPreparation } from "./climoptixFixtures";
import { hvacProject } from "./hvacFixtures";

test("late successes and failures are tied to project, study and source, even when study IDs are reused", () => {
  const p = cfdProject(), scenario = p.cfdScenarios![0], source = captureCFDSource(p, scenario);
  assert.equal(matchesCFDSource(source, p, [scenario]), true);
  assert.equal(matchesCFDSource(source, { ...p, projectId: crypto.randomUUID() }, [scenario]), false);
  assert.equal(matchesCFDSource(source, p, []), false);
  assert.equal(matchesCFDSource(source, p, [{ ...scenario, physics: { ...scenario.physics, densityKgM3: 2 } }]), false);
  assert.equal(matchesCFDSource(source, p, [{ ...scenario, name: "Only a presentation change" }]), true);
});

test("large preparation and thermal caches evict old or deleted studies and never reuse another project's reports", () => {
  let cache = { projectId: "first", reports: {} as Record<string, string> };
  const ids = ["one", "two", "three", "four"];
  for (const studyId of ids) cache = cacheCFDReport(cache, { projectId: "first", studyId, input: "" }, studyId, ids);
  assert.deepEqual(Object.keys(cache.reports), ["two", "three", "four"]);
  cache = cacheCFDReport(cache, { projectId: "first", studyId: "three", input: "" }, "updated", ["three", "four"]);
  assert.deepEqual(cache.reports, { four: "four", three: "updated" });
  cache = cacheCFDReport(cache, { projectId: "second", studyId: "three", input: "" }, "new project", ids);
  assert.deepEqual(cache.reports, { three: "new project" });
});

test("preparation parsing rejects null validation, duplicate IDs, orphan patch references and invalid meshes", () => {
  const p = cfdProject(), scenario = p.cfdScenarios![0], revision = "a".repeat(64);
  const report = realPreparation({ project: p, scenario, clientRevision: revision });
  assert.equal(parseCFDReport(report, revision).surface.closed, true);
  const edits = [
    value => { value.validation = null; },
    value => { value.patches.push(value.patches[0]); },
    value => { value.surface.trianglePatches[0] = "missing-patch"; },
    value => { value.surface.triangles[0][0] = value.surface.verticesMm.length; },
    value => { value.surface.triangleCount += 1; },
    value => { value.surface.closed = false; value.surface.exportable = true; },
    value => { value.validation.clientRevision = "b".repeat(64); },
  ];
  for (const edit of edits) {
    const value = structuredClone(report); edit(value);
    assert.throws(() => parseCFDReport(value, revision));
  }
});

test("unlocated boundary inputs reject duplicate source IDs and mismatched physical units", () => {
  const value = { version: 1, captureEnvelope: true, sources: [], inventory: [],
    unlocated: [{ id: "gains", name: "Gain", floorId: "floor", roomId: "room", kind: "equipment", valueSI: 200, units: "W" }] };
  assert.equal(sharedBoundaryInputsSchema.safeParse(value).success, true);
  assert.equal(sharedBoundaryInputsSchema.safeParse({ ...value, unlocated: [...value.unlocated, ...value.unlocated] }).success, false);
  assert.equal(sharedBoundaryInputsSchema.safeParse({ ...value, unlocated: [{ ...value.unlocated[0], units: "m³/s" }] }).success, false);
});

test("discovered domain scope survives reordered seed properties but is discarded when the seed changes", () => {
  const p = hvacProject(), scenario = p.cfdScenarios![0], seed = scenario.seed!;
  p.hvac!.bindings[scenario.id] = { operatingScenarioId: null, deviceIds: [], editMode: "design", overrides: {},
    scopeSeed: { roomId: seed.roomId, floorId: seed.floorId }, scopeRooms: [{ floorId: seed.floorId, roomId: "connected" }] };
  assert.ok(sharedCaseRooms(p, scenario).some(r => r.roomId === "connected"));
  assert.deepEqual(sharedCaseRooms(p, { ...scenario, seed: { ...seed, roomId: "another" } }), [{ ...seed, roomId: "another" }]);
});

test("a plant/distribution-only Heating workbench still has shared CFD inventory without fabricated room heat", () => {
  const p = hvacProject(); delete p.hvac;
  p.rooms.forEach(room => { room.obstacles = []; });
  p.heatingLayout = newHeatingProject();
  p.heatingLayout.manifolds = [{ manifoldId: "plant", name: "Plant", positionMm: { x: 500, y: 500 }, rotationDeg: 0, ports: 4 }];
  const loaded = parseProject(p), scenario = loaded.cfdScenarios![0];
  assert.ok(loaded.hvac!.bindings[scenario.id]);
  const source = resolveHvacScenario(loaded, scenario);
  assert.deepEqual(source.sharedBoundaries!.sources, []);
  assert.equal(hvacBoundaryPackage(loaded, scenario).boundaryInputs.inventory.find(i => i.kind === "manifold")!.count, 1);
});
