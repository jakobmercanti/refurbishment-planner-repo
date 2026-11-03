import test from "node:test";
import assert from "node:assert/strict";
import { hvacProject } from "./hvacFixtures";
import { realPreparation } from "./climoptixFixtures";
import { newAssembly, newEnergyProject } from "../lib/energyDocument";
import { createRoomUFH } from "../lib/heatingDesign";
import { parseProject } from "../lib/projectDocument";
import { commitHvacCFD } from "../lib/hvacDocument";
import { resolveHvacScenario, hvacBoundaryPackage } from "../lib/hvacBridge";
import { preparationInput, preparationRequestBody } from "../lib/climoptix";
import { prepareWorkerSubmission } from "../lib/climoptixJobs";
import { ventSchema } from "../lib/climoptixDocument";
import { effectiveBoundary } from "../lib/climoptixGroups";
import { thermalSetupSchema } from "../lib/thermalDocument";
import { ProjectHistory } from "../lib/projectHistory";
import { newHeatingProject } from "../lib/heatingDocument";

function fixture(ufh = false) {
  const p = hvacProject(), s = p.cfdScenarios![0], room = p.rooms[0];
  p.hvac!.bindings[s.id] = { deviceIds: [], operatingScenarioId: "operation-1", editMode: "design", overrides: {} };
  p.energyLayout = newEnergyProject();
  const assembly = newAssembly({ name: "Reviewed floor", category: "floor", materials: [["pir-tw55", 100]] });
  p.energyLayout.assemblies = [assembly];
  p.energyLayout.existingAssignments = [{ elementId: `${room.id}|floor`, assemblyId: assembly.assemblyId, uValue: null, boundary: "Ground", adjacentTemperatureC: 10 }];
  if (ufh) {
    p.heatingLayout = createRoomUFH(room, p.heatingLayout!).heating;
    p.hvac!.scenarios[0].heaterOverrides[p.heatingLayout.ufhZones[0].zoneId] = { enabled: true, actualW: 900 };
  }
  return p;
}
const prepare = p => realPreparation(JSON.parse(preparationRequestBody(p, p.cfdScenarios[0], "a".repeat(64))));

test("switching to CFD captures current insulation even without opening Thermal Envelope", () => {
  const p = fixture(); delete p.hvac;
  const loaded = parseProject(p), body = JSON.parse(preparationRequestBody(loaded, loaded.cfdScenarios![0], "a".repeat(64)));
  assert.ok(body.scenario.sharedBoundaries); assert.ok(body.project.energyLayout);
  const report = realPreparation(body), floor = report.sharedBoundaryAudit!.envelope.find(e => e.id.endsWith("floor"))!;
  assert.equal(floor.status, "applied");
  assert.ok(Math.abs(floor.coefficientWm2K! - 1 / (100 / 1000 / .022 + .04)) < 1e-10);
  assert.equal(floor.ambientK, 283.15);
  const face = report.patches.find(p => floor.patchIds.includes(p.id))!;
  assert.equal(effectiveBoundary(loaded.cfdScenarios![0], face).thermal.type, "heatTransfer", "The boundary editor must show the checked source, not its adiabatic group preset.");
});
test("current UFH circuits become checked partial-floor flux while retaining insulation", () => {
  const p = fixture(true), view = resolveHvacScenario(p, p.cfdScenarios![0]);
  assert.equal(view.sharedBoundaries!.sources.find(s => s.kind === "ufh")!.geometryValid, true);
  const report = prepare(p), ufh = report.sharedBoundaryAudit!.sources.find(s => s.kind === "ufh")!;
  assert.equal(ufh.status, "applied"); assert.ok(Math.abs(ufh.appliedW - 900) < 1e-6);
  const floorArea = report.patches.filter(p => p.kind === "floor").reduce((s, p) => s + p.areaM2, 0);
  assert.ok(ufh.areaM2 > 0 && ufh.areaM2 < floorArea);
  for (const patch of report.patches.filter(p => ufh.patchIds.includes(p.id))) {
    assert.equal(patch.boundary.thermal.type, "heatTransfer"); assert.ok(patch.boundary.thermal.sourceFluxWm2! > 0);
  }
  assert.equal(report.surface.closed, true);
});
test("editing an insulation layer changes live CFD coefficients and provenance, preserving old capture", () => {
  const p = fixture(), before = prepare(p), input = preparationInput(p, p.cfdScenarios![0]);
  const saved = JSON.stringify(hvacBoundaryPackage(p, p.cfdScenarios![0], before));
  p.energyLayout!.assemblies[0].layers[0].thicknessMm = 200;
  const after = prepare(p);
  assert.notEqual(preparationInput(p, p.cfdScenarios![0]), input);
  assert.notEqual(before.validation.configurationHash, after.validation.configurationHash);
  assert.equal(before.validation.sourceHash, after.validation.sourceHash);
  const old = JSON.parse(saved).checkedBoundaryCapture.envelope.find(s => s.id.endsWith("floor"));
  assert.ok(old.coefficientWm2K > after.sharedBoundaryAudit!.envelope.find(s => s.id.endsWith("floor"))!.coefficientWm2K!);
});
test("generated shared boundary inputs are not persisted as an independent case copy", () => {
  const p = fixture(true), view = resolveHvacScenario(p, p.cfdScenarios![0]); view.mesh.baseCellMm = 150;
  const next = commitHvacCFD(p, [view]); assert.equal(next.cfdScenarios![0].sharedBoundaries, undefined);
  assert.equal(next.cfdScenarios![0].assetOverrides.length, 0);
  assert.equal(resolveHvacScenario(next, next.cfdScenarios![0]).sharedBoundaries!.sources.length, 2);
});
test("detached worker/preparation transport preserves the same source revision inputs", async () => {
  const p = fixture(true), s = p.cfdScenarios![0], body = JSON.parse(preparationRequestBody(p, s, "a".repeat(64)));
  assert.equal(preparationInput(p, s), preparationInput(body.project, body.scenario));
  await assert.rejects(prepareWorkerSubmission("unused", body.project, body.scenario, "run", new AbortController().signal), /thermal execution is not connected/);
});
test("supply and pressure-extract thermal and scalar values survive actual boundary preparation", () => {
  const p = fixture(), s = p.cfdScenarios![0], base = prepare(p), host = base.patches.find(v => v.kind === "wall" && v.hostable)!;
  const a = ventSchema.parse({ id: "source", name: "Supply", role: "supply", host: { patchId: host.id, u: .25, v: .5 }, control: "massFlow", valueSI: .2, temperatureK: 305, co2Ppm: 500 });
  const b = ventSchema.parse({ ...a, id: "return", name: "Return", role: "extract", control: "pressure", valueSI: -10, host: { ...a.host, u: .75 }, temperatureK: 299, co2Ppm: 700 });
  p.hvac!.devices = [a,b].map(vent => ({ vent, floorId: s.seed!.floorId, roomId: s.seed!.roomId, enabled: true, outdoorAirFraction: 1, extractKind: "return" }));
  p.hvac!.scenarios[0].conditions.densityKgM3 = 2; s.physics.co2 = true;
  const report = prepare(p), supply = report.patches.find(p => p.kind === "supply")!, outlet = report.patches.find(p => p.kind === "extract")!;
  assert.equal(supply.boundary.thermal.value, 305); assert.equal(supply.boundary.flow.type, "massFlow");
  assert.equal(report.vents.find(v => v.id === a.id)!.volumeFlowM3S, .1);
  assert.equal(outlet.boundary.thermal.type, "inletOutlet"); assert.equal(outlet.boundary.thermal.value, 299);
  assert.equal(outlet.boundary.scalarType, "inletOutlet"); assert.equal(outlet.boundary.scalarPpm, 700);
});
test("live insulation selection follows the source while an explicit case construction stays selected", () => {
  const p = fixture(), s = p.cfdScenarios![0], baseline = prepare(p).sharedBoundaryAudit!.envelope.find(s => s.id.endsWith("floor"))!;
  const copy = structuredClone(p.energyLayout!.assemblies[0]); copy.assemblyId = "upgrade"; copy.layers[0].thicknessMm = 200;
  p.energyLayout!.assemblies.push(copy); p.energyLayout!.scenarios = [{ scenarioId: "retrofit", name: "Retrofit", assignments: [{ ...p.energyLayout!.existingAssignments[0], assemblyId: copy.assemblyId }] }];
  p.energyLayout!.activeScenarioId = "retrofit";
  const upgrade = prepare(p).sharedBoundaryAudit!.envelope.find(s => s.id.endsWith("floor"))!;
  assert.ok(upgrade.coefficientWm2K! < baseline.coefficientWm2K!);
  s.thermalEnvelope = thermalSetupSchema.parse({ insulationScenarios: { [s.seed!.floorId]: null } });
  const pinned = prepare(p).sharedBoundaryAudit!.envelope.find(s => s.id.endsWith("floor"))!;
  assert.equal(pinned.coefficientWm2K, baseline.coefficientWm2K);
});
test("background capture does not add an undo step for an unlinked fabric case, while real air edits do", () => {
  const input = fixture(); delete input.hvac; const p = parseProject(input), view = resolveHvacScenario(p, p.cfdScenarios![0]);
  const next = commitHvacCFD(p, [view]), history = new ProjectHistory(); history.record(p, next);
  assert.equal(history.past.length, 0);
  const changed = structuredClone(next); changed.cfdScenarios![0].physics.referenceTemperatureK += 1;
  history.record(next, changed); assert.equal(history.past.length, 1);
});
test("stored derived sources cannot survive removal of their authoritative workbench data", () => {
  const input = fixture(true), sources = resolveHvacScenario(input, input.cfdScenarios![0]).sharedBoundaries;
  delete input.hvac; delete input.energyLayout; input.heatingLayout = newHeatingProject(); input.rooms[0].obstacles = [];
  input.cfdScenarios![0].sharedBoundaries = sources;
  const p = parseProject(input); assert.equal(p.cfdScenarios![0].sharedBoundaries, undefined);
});
test("unlocated ventilation gains and infiltration are captured for review without inventing heat or openings", () => {
  const p = fixture(); Object.assign(p.hvac!.scenarios[0].conditions, { occupants: 2, sensibleWPerson: 75, equipmentW: 200, solarW: 100, infiltrationM3S: .01 });
  const report = prepare(p), audit = report.sharedBoundaryAudit!;
  assert.equal(audit.state, "review");
  const unlocated = audit.sources.filter(s => ["people", "equipment", "solar", "infiltration"].includes(s.kind));
  assert.equal(unlocated.length, 4); assert.ok(unlocated.every(s => s.status === "incomplete" && s.appliedW === 0 && s.patchIds.length === 0));
  assert.equal(unlocated.find(s => s.kind === "people")!.watts, 150);
});
