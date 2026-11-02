import test from "node:test";
import assert from "node:assert/strict";
import { hvacProject } from "./hvacFixtures";
import { parseProject } from "../lib/projectDocument";
import { commitHvacCFD, migrateHvac, resolveHvacVents } from "../lib/hvacDocument";
import { hvacBoundaryPackage, resolveHvacScenario, conventionalHvac } from "../lib/hvacBridge";
import { ventSchema } from "../lib/climoptixDocument";
import { createRoomUFH } from "../lib/heatingDesign";
import { prepareWorkerSubmission } from "../lib/climoptixJobs";

function withVent() {
  const p = hvacProject(), s = p.cfdScenarios![0];
  p.hvac!.devices = [{ vent: ventSchema.parse({ id: "sync-vent", name: "Shared supply", role: "supply", valueSI: .1, host: { patchId: `${s.seed!.floorId}:${s.seed!.roomId}:floor` } }), floorId: s.seed!.floorId, roomId: s.seed!.roomId, enabled: true, outdoorAirFraction: 1, extractKind: "exhaust" }];
  return p;
}
test("an older empty CFD case discovers a later design while retaining independent air settings until linked", () => {
  const p = migrateHvac(withVent()), s = p.cfdScenarios![0];
  assert.equal(resolveHvacVents(p, s)[0]?.valueSI, .1);
  assert.equal(p.hvac!.bindings[s.id]?.operatingScenarioId, null);
  assert.equal(resolveHvacScenario(p, s).physics.referenceTemperatureK, s.physics.referenceTemperatureK);
  p.hvac!.bindings[s.id].operatingScenarioId = "operation-1";
  p.hvac!.scenarios[0].ventOverrides["sync-vent"] = { valueSI: .18 };
  assert.equal(resolveHvacVents(p, s)[0].valueSI, .18);
  assert.deepEqual(migrateHvac(p), p);
});
test("Heating-only projects share live rated output without requiring a ventilation device", () => {
  const source = hvacProject(); delete source.hvac;
  let p = parseProject(source), s = p.cfdScenarios![0];
  assert.equal(resolveHvacScenario(p, s).assetOverrides[0]?.heatW, 1000);
  p.rooms[0].obstacles[0].heating_spec!.ratedOutputW = 1600;
  p = parseProject(p); s = p.cfdScenarios![0];
  assert.equal(resolveHvacScenario(p, s).assetOverrides[0].heatW, 1600);
});
test("CFD edits cannot persist derived radiator heat after the source is deleted", () => {
  const p = withVent(), s = p.cfdScenarios![0];
  p.hvac!.bindings[s.id] = { deviceIds: ["sync-vent"], operatingScenarioId: "operation-1", editMode: "design", overrides: {} };
  const view = resolveHvacScenario(p, s); view.mesh.baseCellMm = 180;
  const next = commitHvacCFD(p, [view]);
  assert.equal(next.cfdScenarios![0].assetOverrides.length, 0);
  next.rooms[0].obstacles = [];
  assert.equal(resolveHvacScenario(next, next.cfdScenarios![0]).assetOverrides.length, 0);
});
test("a linked CFD operating edit replaces an older case override in both workbenches", () => {
  const p = withVent(), s = p.cfdScenarios![0];
  p.hvac!.bindings[s.id] = { deviceIds: ["sync-vent"], operatingScenarioId: "operation-1", editMode: "override", overrides: { "sync-vent": { valueSI: .2, temperatureK: 310 } } };
  const view = resolveHvacScenario(p, s); view.vents[0].valueSI = .3;
  const next = commitHvacCFD(p, [view]), op = next.hvac!.scenarios[0];
  assert.equal(resolveHvacVents(next, next.cfdScenarios![0])[0].valueSI, .3);
  assert.equal(conventionalHvac(next, op).supplyM3S, .3);
  assert.equal(resolveHvacVents(next, next.cfdScenarios![0])[0].temperatureK, 310);
});
test("Heating source changes update CFD provenance without overwriting a retained historical package", () => {
  const p = withVent(), s = p.cfdScenarios![0];
  p.hvac!.bindings[s.id] = { deviceIds: ["sync-vent"], operatingScenarioId: "operation-1", editMode: "design", overrides: {} };
  const saved = JSON.stringify(hvacBoundaryPackage(p, s));
  p.hvac!.snapshots = [{ caseId: s.id, operatingScenarioId: "operation-1", createdAt: new Date().toISOString(), inputHash: "0".repeat(64), boundaryJson: saved }];
  p.rooms[0].obstacles[0].heating_spec!.ratedOutputW = 1800;
  assert.notEqual(hvacBoundaryPackage(p, s).sourceInput, JSON.parse(saved).sourceInput);
  assert.equal(p.hvac!.snapshots[0].boundaryJson, saved);
});
test("unlinked radiator and UFH-only thermal cases refuse unsupported worker runs", async () => {
  const radiator = hvacProject(); delete radiator.hvac;
  const ufh = hvacProject(); delete ufh.hvac; ufh.rooms[0].obstacles = [];
  ufh.heatingLayout = createRoomUFH(ufh.rooms[0], ufh.heatingLayout!).heating;
  for (const input of [radiator, ufh]) {
    const p = parseProject(input), s = p.cfdScenarios![0];
    assert.equal(p.hvac!.bindings[s.id].operatingScenarioId, null);
    assert.equal(resolveHvacScenario(p, s).physics.energy, true);
    await assert.rejects(prepareWorkerSubmission("unused", p, s, "run", new AbortController().signal), /thermal execution is not connected/);
  }
});
test("migration removes an older generated radiator treatment before a later source deletion", () => {
  const p = withVent(), s = p.cfdScenarios![0];
  p.hvac!.bindings[s.id] = { deviceIds: ["sync-vent"], operatingScenarioId: "operation-1", editMode: "design", overrides: {} };
  p.cfdScenarios![0] = { ...s, assetOverrides: resolveHvacScenario(p, s).assetOverrides };
  const loaded = parseProject(p); assert.equal(loaded.cfdScenarios![0].assetOverrides.length, 0);
  loaded.rooms[0].obstacles = [];
  assert.equal(resolveHvacScenario(loaded, loaded.cfdScenarios![0]).assetOverrides.length, 0);
});
test("Heating water-temperature changes reach both room heat input and CFD surface power", () => {
  const p = withVent(), s = p.cfdScenarios![0];
  p.rooms[0].obstacles[0].heating_spec!.emitterTechnology = "Hydronic";
  p.hvac!.bindings[s.id] = { deviceIds: ["sync-vent"], operatingScenarioId: "operation-1", editMode: "design", overrides: {} };
  p.heatingLayout!.heatingSystem.flowTemperatureC = 75; p.heatingLayout!.heatingSystem.returnTemperatureC = 65;
  const high = hvacBoundaryPackage(p, s).heaters[0].watts!;
  p.heatingLayout!.heatingSystem.flowTemperatureC = 45; p.heatingLayout!.heatingSystem.returnTemperatureC = 40;
  const low = hvacBoundaryPackage(p, s).heaters[0].watts!;
  assert.ok(high > low && low > 0);
  assert.equal(conventionalHvac(p, p.hvac!.scenarios[0]).heatingW, low);
  assert.equal(resolveHvacScenario(p, s).assetOverrides[0].heatW, low);
});
