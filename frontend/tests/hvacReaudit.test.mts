import test from "node:test";
import assert from "node:assert/strict";
import { hvacProject } from "./hvacFixtures";
import { cfdScenariosSchema, ventSchema } from "../lib/climoptixDocument";
import { commitHvacCFD, resolveHvacVents, hvacSchema, type VentDevice } from "../lib/hvacDocument";
import { resolveHvacScenario, hvacBoundaryPackage } from "../lib/hvacBridge";
import { calculateHvac } from "../lib/hvacCalculations";
import { ProjectHistory } from "../lib/projectHistory";
import { parseProject } from "../lib/projectDocument";

function sharedCases() {
  const p = hvacProject(), a = p.cfdScenarios![0];
  const vent = ventSchema.parse({ id: "shared", name: "Shared inlet", role: "supply", host: { patchId: `${a.seed!.floorId}:${a.seed!.roomId}:floor` }, valueSI: .1 });
  p.hvac!.devices = [{ vent, enabled: true, floorId: a.seed!.floorId, roomId: a.seed!.roomId, outdoorAirFraction: 1, extractKind: "exhaust" }];
  const b = { ...structuredClone(a), id: "case-b", name: "Second case" };
  p.cfdScenarios = [a, b];
  for (const s of p.cfdScenarios) p.hvac!.bindings[s.id] = { deviceIds: [vent.id], operatingScenarioId: "operation-1", editMode: "design", overrides: {} };
  return p;
}
test("unchanged sibling cases cannot restore a globally deleted vent", () => {
  const p = sharedCases(), views = p.cfdScenarios!.map(s => resolveHvacScenario(p, s));
  views[0].vents = [];
  const next = commitHvacCFD(p, cfdScenariosSchema.parse(views));
  assert.equal(next.hvac!.devices.length, 0);
  assert.ok(next.cfdScenarios!.every(s => resolveHvacVents(next, s).length === 0));
});
test("only edited case deltas change shared geometry and physics regardless of sibling order", () => {
  for (const reverse of [false, true]) {
    const p = sharedCases(), views = p.cfdScenarios!.map(s => resolveHvacScenario(p, s));
    views[0].vents[0].widthMm = 700; views[0].vents[0].valueSI = .25;
    views[0].physics.referenceTemperatureK = 297.15;
    const next = commitHvacCFD(p, cfdScenariosSchema.parse(reverse ? views.reverse() : views));
    assert.equal(next.hvac!.devices[0].vent.widthMm, 700);
    assert.equal(next.hvac!.devices[0].vent.valueSI, .25);
    assert.equal(next.hvac!.scenarios[0].conditions.roomC, 24);
  }
});
test("new shared vents and ordering appear immediately in an existing room case", () => {
  const p = sharedCases();
  const copy = structuredClone(p.hvac!.devices[0]); copy.vent.id = "new-vent";
  p.hvac!.devices = [copy, p.hvac!.devices[0]];
  assert.deepEqual(resolveHvacVents(p, p.cfdScenarios![0]).map(v => v.id), ["new-vent", "shared"]);
});
test("case duplication preserves effective values without overwriting the shared design", () => {
  const p = sharedCases(); p.hvac!.scenarios[0].ventOverrides.shared = { valueSI: .2 };
  const copy = { ...resolveHvacScenario(p, p.cfdScenarios![0]), id: "copy", name: "Copy" };
  const next = commitHvacCFD(p, [...p.cfdScenarios!.map(s => resolveHvacScenario(p, s)), copy]);
  assert.equal(next.hvac!.devices[0].vent.valueSI, .1);
  assert.equal(resolveHvacVents(next, next.cfdScenarios!.at(-1)!)[0].valueSI, .2);
});
test("removed studies release bindings without deleting the shared physical design", () => {
  const p = sharedCases(), next = commitHvacCFD(p, [resolveHvacScenario(p, p.cfdScenarios![0])]);
  assert.equal(next.hvac!.bindings["case-b"], undefined); assert.equal(next.hvac!.devices.length, 1);
});
test("oversized scenario flow overrides fail import before any render", () => {
  const p = sharedCases(); p.hvac!.scenarios[0].ventOverrides.shared = { valueSI: 1e50 };
  assert.throws(() => hvacSchema.parse(p.hvac));
});
test("unlinked CFD mass-flow manifests use the selected fluid density", () => {
  const p = sharedCases(), s = p.cfdScenarios![0];
  p.hvac!.bindings[s.id].operatingScenarioId = null; s.physics.densityKgM3 = 2;
  p.hvac!.devices[0].vent.control = "massFlow"; p.hvac!.devices[0].vent.valueSI = .2;
  const pkg = hvacBoundaryPackage(p, s); assert.equal(pkg.vents[0].volumeFlowM3S, .1); assert.equal(pkg.vents[0].massFlowKgS, .2);
});
test("a pressure outlet does not conceal excess known extraction or invent backflow temperature", () => {
  const p = sharedCases(), supply = p.hvac!.devices[0], extract: VentDevice = { ...structuredClone(supply), vent: { ...supply.vent, id: "extract", role: "extract", valueSI: .2 } };
  const pressure: VentDevice = { ...structuredClone(extract), vent: { ...extract.vent, id: "pressure", control: "pressure", valueSI: 0 } };
  const result = calculateHvac({ volumeM3: 100, areaM2: 40, conditions: p.hvac!.scenarios[0].conditions, devices: [supply, extract, pressure] });
  assert.equal(result.equilibriumC, null); assert.equal(result.residualW, null);
});
test("validated connected scope discovers later vents without creating a modelling undo entry", () => {
  const p = sharedCases(), views = p.cfdScenarios!.map(s => resolveHvacScenario(p, s));
  const floorId = p.hvac!.devices[0].floorId, roomId = p.rooms[1].id;
  const next = commitHvacCFD(p, views, { scenarioId: views[0].id, rooms: [views[0].seed!, { floorId, roomId }] });
  const history = new ProjectHistory(); history.record(p, next); assert.equal(history.past.length, 0);
  const added = { ...structuredClone(next.hvac!.devices[0]), roomId, vent: { ...next.hvac!.devices[0].vent, id: "other-room", host: { patchId: `${floorId}:${roomId}:floor`, u: .5, v: .5 } } };
  next.hvac!.devices.push(added);
  assert.ok(resolveHvacVents(next, next.cfdScenarios![0]).some(v => v.id === "other-room"));
  assert.ok(!resolveHvacVents(next, next.cfdScenarios![1]).some(v => v.id === "other-room"));
});
test("legacy deleted-case bindings are pruned on import without deleting devices or mutating input", () => {
  const p = sharedCases();
  for (let i = 0; i < 110; i++) p.hvac!.bindings[`deleted-${i}`] = { deviceIds: ["shared"], operatingScenarioId: null, editMode: "design", overrides: {} };
  const result = parseProject(p);
  assert.equal(Object.keys(result.hvac!.bindings).length, 2); assert.equal(result.hvac!.devices.length, 1);
  assert.equal(Object.keys(p.hvac!.bindings).length, 112);
});
test("boundary manifests retain pressure, geometry, direction and signed outward velocity", () => {
  const p = sharedCases(), s = p.cfdScenarios![0];
  p.hvac!.devices[0].vent.yawDeg = 20;
  let pkg = hvacBoundaryPackage(p, s); assert.equal(pkg.vents[0].parameters.yawDeg, 20); assert.ok(pkg.vents[0].outwardNormalVelocityMS! < 0);
  p.hvac!.devices[0].vent.control = "pressure"; p.hvac!.devices[0].vent.valueSI = -12;
  pkg = hvacBoundaryPackage(p, s); assert.equal(pkg.vents[0].parameters.valueSI, -12); assert.equal(pkg.vents[0].volumeFlowM3S, null);
});
test("bounded multi-device snapshots can exceed the generic text bound without relaxing other fields", () => {
  const p = sharedCases(), boundaryJson = JSON.stringify({ version: 1, sourceInput: "x".repeat(150000) });
  p.hvac!.snapshots = [{ caseId: p.cfdScenarios![0].id, operatingScenarioId: "operation-1", createdAt: new Date().toISOString(), inputHash: "0".repeat(64), boundaryJson }];
  assert.equal(parseProject(p).hvac!.snapshots[0].boundaryJson, boundaryJson);
  assert.throws(() => parseProject({ ...p, name: "x".repeat(150000) }), /text exceeds/);
});
test("CFD boundary/mesh edits invalidate the package while raw and derived views agree", () => {
  const p = sharedCases(), s = p.cfdScenarios![0], before = hvacBoundaryPackage(p, s);
  assert.equal(hvacBoundaryPackage(p, resolveHvacScenario(p, s)).sourceInput, before.sourceInput);
  s.boundaries.groups.wall = { ...s.boundaries.groups.wall!, flow: { type: "slip", value: 0 } };
  assert.notEqual(hvacBoundaryPackage(p, s).sourceInput, before.sourceInput);
  const afterBoundary = hvacBoundaryPackage(p, s).sourceInput; s.mesh.baseCellMm = 150;
  assert.notEqual(hvacBoundaryPackage(p, s).sourceInput, afterBoundary);
});
test("duplicated cases keep independent heater-off and vent operating states", () => {
  const p = sharedCases(), s = p.cfdScenarios![0], heater = hvacBoundaryPackage(p, s).heaters[0];
  p.hvac!.scenarios[0].heaterOverrides[heater.id] = { enabled: false, actualW: 200 };
  p.hvac!.scenarios[0].ventOverrides.shared = { valueSI: .2 };
  const views = p.cfdScenarios!.map(s => resolveHvacScenario(p, s)), copy = { ...structuredClone(views[0]), id: "heater-copy" };
  const next = commitHvacCFD(p, [...views, copy], undefined, { "heater-copy": s.id });
  const binding = next.hvac!.bindings[copy.id]; assert.notEqual(binding.operatingScenarioId, "operation-1");
  const op = next.hvac!.scenarios.find(s => s.id === binding.operatingScenarioId)!;
  assert.equal(op.heaterOverrides[heater.id].enabled, false); assert.equal(op.ventOverrides.shared.valueSI, .2);
  assert.equal(resolveHvacScenario(next, next.cfdScenarios!.at(-1)!).assetOverrides[0].heatW, 0);
  op.heaterOverrides[heater.id].enabled = true;
  assert.equal(next.hvac!.scenarios[0].heaterOverrides[heater.id].enabled, false);
});
