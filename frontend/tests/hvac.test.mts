import assert from "node:assert/strict";
import test from "node:test";
import { calculateHvac, requiredSensibleFlow, flowFromDisplay, flowToDisplay } from "../lib/hvacCalculations";
import { commitHvacCFD, hvacConditionsSchema, hvacSchema, migrateHvac, operatingVents, removeVent, resolveHvacVents, type VentDevice } from "../lib/hvacDocument";
import { cfdScenarioSchema, ventSchema } from "../lib/climoptixDocument";
import { conventionalHvac, hvacBoundaryPackage, resolveHvacScenario } from "../lib/hvacBridge";
import { preparationInput, preparationRequestBody } from "../lib/climoptix";
import { ProjectHistory } from "../lib/projectHistory";
import { parseProject } from "../lib/projectDocument";
import { cfdProject, realPreparation } from "./climoptixFixtures";
import { hvacProject } from "./hvacFixtures";
import { createRoomUFH } from "../lib/heatingDesign";
import { prepareWorkerSubmission } from "../lib/climoptixJobs";
const conditions = () => hvacConditionsSchema.parse({ roomC: 25, supplyC: 15 });
function device(valueSI = 0.1, role: "supply" | "extract" = "supply"): VentDevice {
  return { vent: ventSchema.parse({ id: role, name: role, role, valueSI, temperatureK: 293.15, host: { patchId: "unassigned" } }), floorId: "floor", roomId: "room", outdoorAirFraction: 1, extractKind: "exhaust", enabled: true };
}
const calc = (devices = [device()], extra = {}) => calculateHvac({ volumeM3: 100, areaM2: 40, conditions: conditions(), devices, ...extra });

test("100 m³, 100 L/s gives 3.6 total/outdoor ACH and -603 W at 20/25°C", () => {
  const r = calc(); assert.equal(r.supplyACH, 3.6); assert.equal(r.outdoorACH, 3.6); assert.equal(r.ventilationW, -603);
});
test("sensible flow respects load sign and rejects zero/opposing driving temperature", () => {
  assert.ok(Math.abs(requiredSensibleFlow(1000, 15, 25)! - 0.08291873963515755) < 1e-12);
  assert.equal(requiredSensibleFlow(1000, 25, 25), null); assert.equal(requiredSensibleFlow(1000, 30, 25), null);
  assert.ok(requiredSensibleFlow(-1000, 30, 20)! > 0); assert.equal(requiredSensibleFlow(1000, 15, 25, 0), null);
});
test("500 L/s recirculated air never counts as fresh outdoor air", () => {
  const r = calc([{ ...device(0.5), outdoorAirFraction: 0 }]); assert.equal(r.supplyACH, 18); assert.equal(r.outdoorACH, 0); assert.equal(r.recirculatedM3S, 0.5);
});
test("return and exhaust are separate paths and pressure outlets stay unknown", () => {
  const extract = device(0.05, "extract"), returning = { ...device(0.05, "extract"), extractKind: "return" as const };
  let r = calc([device(), extract, returning]); assert.equal(r.exhaustACH, 1.8); assert.equal(r.returnM3S, .05); assert.equal(r.balanceM3S, 0);
  r = calc([device(), { ...extract, vent: { ...extract.vent, control: "pressure", valueSI: 0 } }]); assert.equal(r.extractM3S, null); assert.equal(r.exhaustACH, null); assert.equal(r.equilibriumC, 20);
});
test("weighted mixed supplies, envelope sources and one heating input close the heat balance", () => {
  const a = device(.1), b = device(.1); b.vent.temperatureK = 303.15;
  const r = calc([a, b], { surfaces: [{ label: "outside", hWK: 100, adjacentC: 5 }], heating: [{ id: "h", name: "h", watts: 1000 }] });
  assert.ok(Math.abs(r.equilibriumResidualW!) < 1e-8); assert.equal(r.heatingW, 1000); assert.equal(r.ventilationW, 0);
});
test("no removal path, unknown heat, or extract exceeding supply produces no false equilibrium", () => {
  assert.equal(calc([], { heating: [{ id: "h", name: "h", watts: 1000 }] }).equilibriumC, null);
  assert.equal(calc([device()], { heating: [{ id: "h", name: "h", watts: null }] }).residualW, null);
  assert.equal(calc([device(.1), device(.2, "extract")]).equilibriumC, null);
});
test("invalid volume/area/density/cp and non-finite values fail validation", () => {
  for (const volumeM3 of [0, -1, NaN, Infinity]) assert.throws(() => calc([], { volumeM3 }));
  for (const field of ["densityKgM3", "cpJKgK"]) for (const n of [0, -1, NaN]) assert.throws(() => calc([], { conditions: { ...conditions(), [field]: n } }));
  assert.throws(() => calc([], { surfaces: [{ label: "bad", hWK: -1, adjacentC: 0 }] }));
});
test("flow display roundtrips without a double 3600 conversion; mass and velocity use free area", () => {
  for (const unit of ["L/s", "m³/h", "m³/s"]) assert.ok(Math.abs(flowFromDisplay(flowToDisplay(.000035, unit), unit) - .000035) < 1e-14);
  const d = device(); d.vent.control = "massFlow"; d.vent.valueSI = .12; assert.equal(calc([d]).supplyM3S, .1);
  d.vent.control = "velocity"; d.vent.valueSI = 2; d.vent.openAreaFraction = .5; assert.equal(calc([d]).supplyM3S, .06);
});
test("occupancy-plus-area rates, thermal duration and solar ledger are transparent", () => {
  const r = calc([], { conditions: { ...conditions(), occupants: 2, litresPerson: 10, litresM2: 1, equipmentW: 100, solarW: 50, durationHours: 2 } });
  assert.equal(r.occupancyFlowM3S, .06); assert.equal(r.peopleW, 150); assert.equal(r.solarW, 50); assert.equal(r.sensibleKwh, .6);
});

test("legacy vent migration is idempotent, preserves identity, and retains conflicting operating state", () => {
  const p = cfdProject(), s = p.cfdScenarios![0]; s.vents = [device().vent];
  const second = { ...structuredClone(s), id: "case-2", vents: [{ ...device().vent, valueSI: .2 }] }; p.cfdScenarios!.push(second);
  const m = migrateHvac(p); assert.equal(m.hvac!.devices.length, 1); assert.equal(m.cfdScenarios![0].vents.length, 0);
  assert.equal(resolveHvacVents(m, m.cfdScenarios![1])[0].valueSI, .2); assert.deepEqual(migrateHvac(m), m);
  assert.deepEqual(parseProject(JSON.parse(JSON.stringify(m))).hvac, m.hvac);
});
test("legacy geometry conflicts get a stable explicit crosswalk, with both designs retained", () => {
  const p = cfdProject(), s = p.cfdScenarios![0]; s.vents = [device().vent];
  p.cfdScenarios!.push({ ...structuredClone(s), id: "case-2", vents: [{ ...device().vent, widthMm: 900 }] });
  const m = migrateHvac(p); assert.equal(m.hvac!.devices.length, 2); assert.equal(m.hvac!.migrationWarnings.length, 1); assert.deepEqual(migrateHvac(m), m);
});
test("CFD permanent edits share identity, duplicate/delete globally, and undo/redo restores device data", () => {
  let p = cfdProject(); const s = p.cfdScenarios![0]; s.vents = [device().vent]; p = migrateHvac(p);
  const view = resolveHvacScenario(p, p.cfdScenarios![0]); view.vents[0] = { ...view.vents[0], valueSI: .3, host: { ...view.vents[0].host, u: .7 } };
  const next = commitHvacCFD(p, [view]); assert.equal(next.hvac!.devices[0].vent.valueSI, .3); assert.equal(next.hvac!.devices[0].vent.host.u, .7);
  const history = new ProjectHistory(); history.record(p, next); assert.equal(history.past.length, 1); assert.deepEqual(history.undo(next)?.hvac, p.hvac); assert.deepEqual(history.redo(p)?.hvac, next.hvac);
  const copy = { ...view, vents: [...view.vents, { ...view.vents[0], id: "copy" }] }; const duplicated = commitHvacCFD(next, [copy]); assert.equal(duplicated.hvac!.devices.length, 2);
  assert.equal(removeVent(duplicated.hvac!, "copy").devices.length, 1);
  assert.equal(commitHvacCFD(next, [{ ...view, vents: [] }]).hvac!.devices.length, 0);
});
test("CFD scenario overrides are visible conventionally and leave baseline designs intact", () => {
  const p = hvacProject(), s = p.cfdScenarios![0]; p.hvac!.devices = [device()];
  p.hvac!.bindings[s.id] = { deviceIds: ["supply"], operatingScenarioId: "operation-1", editMode: "override", overrides: {} };
  const view = resolveHvacScenario(p, s); view.vents[0] = { ...view.vents[0], valueSI: .2, temperatureK: 300 };
  const next = commitHvacCFD(p, [view]); assert.equal(next.hvac!.devices[0].vent.valueSI, .1);
  assert.equal(operatingVents(next.hvac!, next.hvac!.scenarios[0])[0].vent.valueSI, .2); assert.equal(resolveHvacVents(next, next.cfdScenarios![0])[0].temperatureK, 300);
  assert.throws(() => hvacSchema.parse({ ...next.hvac, scenarios: [{ ...next.hvac!.scenarios[0], ventOverrides: { supply: { valueSI: -2 } } }] }));
});
test("CFD host movement updates canonical room association rather than the seed room", () => {
  const p = hvacProject(), s = p.cfdScenarios![0]; p.hvac!.devices = [device()]; p.hvac!.bindings[s.id] = { deviceIds: ["supply"], operatingScenarioId: null, editMode: "design", overrides: {} };
  const v = resolveHvacScenario(p, s); v.vents[0] = { ...v.vents[0], host: { ...v.vents[0].host, patchId: `${s.seed!.floorId}:${p.rooms[1].id}:wall:1` } };
  const next = commitHvacCFD(p, [v]); assert.equal(next.hvac!.devices[0].roomId, p.rooms[1].id);
});
test("permanent geometry edits never copy effective operating overrides into the design", () => {
  const p = hvacProject(), s = p.cfdScenarios![0]; p.hvac!.devices = [device()];
  p.hvac!.bindings[s.id] = { deviceIds: ["supply"], operatingScenarioId: "operation-1", editMode: "design", overrides: {} };
  p.hvac!.scenarios[0].ventOverrides.supply = { valueSI: .2, temperatureK: 310 };
  const moved = resolveHvacScenario(p, s); moved.vents[0].host.u = .8;
  const next = commitHvacCFD(p, [moved]); assert.equal(next.hvac!.devices[0].vent.valueSI, .1); assert.equal(next.hvac!.devices[0].vent.temperatureK, 293.15);
  assert.equal(resolveHvacVents(next, next.cfdScenarios![0])[0].valueSI, .2);
  const permanent = resolveHvacScenario(next, next.cfdScenarios![0]); permanent.vents[0].valueSI = .3;
  const edited = commitHvacCFD(next, [permanent]); assert.equal(edited.hvac!.devices[0].vent.valueSI, .3); assert.equal(resolveHvacVents(edited, edited.cfdScenarios![0])[0].valueSI, .3);
  assert.equal(edited.hvac!.scenarios[0].ventOverrides.supply.temperatureK, 310);
});
test("1000 W measured electric radiator is mapped once and the thermal worker stays explicitly unsupported", () => {
  const p = hvacProject(), s = p.cfdScenarios![0]; p.hvac!.bindings[s.id] = { deviceIds: [], operatingScenarioId: "operation-1", editMode: "design", overrides: {} };
  const view = resolveHvacScenario(p, s), pkg = hvacBoundaryPackage(p, s);
  assert.equal(pkg.heaters.length, 1); assert.equal(pkg.heaters[0].watts, 1000); assert.equal(pkg.thermalExecution, "notConnected");
  assert.equal(view.assetOverrides.reduce((sum, o) => sum + o.heatW, 0), 1000); assert.equal(view.assetOverrides[0].temperatureK, null); assert.equal(view.physics.energy, true);
  assert.equal(conventionalHvac(p, p.hvac!.scenarios[0]).heatingW, 1000);
  const before = preparationInput(p, s); p.hvac!.scenarios[0].heaterOverrides[pkg.heaters[0].id] = { enabled: false, actualW: null };
  assert.equal(conventionalHvac(p, p.hvac!.scenarios[0]).heatingW, 0); assert.notEqual(preparationInput(p, s), before);
});
test("CFD transport resolves shared vents/heaters and omits the unrelated HVAC project payload", () => {
  const p = hvacProject(), s = p.cfdScenarios![0]; p.hvac!.devices = [{ ...device(), floorId: s.seed!.floorId, roomId: s.seed!.roomId }];
  p.hvac!.bindings[s.id] = { deviceIds: ["supply"], operatingScenarioId: "operation-1", editMode: "design", overrides: {} };
  const body = JSON.parse(preparationRequestBody(p, s, "0".repeat(64))); assert.equal(body.project.hvac, undefined); assert.equal(body.scenario.vents.length, 1); assert.equal(body.scenario.assetOverrides[0].heatW, 1000);
  assert.doesNotThrow(() => cfdScenarioSchema.parse(body.scenario));
});
test("UFH exports loop-level coverage and exclusions without imposing a whole-floor boundary", () => {
  const p = hvacProject(), s = p.cfdScenarios![0];
  p.heatingLayout = createRoomUFH(p.rooms[0], p.heatingLayout!).heating;
  const zone = p.heatingLayout.ufhZones[0];
  p.hvac!.scenarios[0].heaterOverrides[zone.zoneId] = { enabled: true, actualW: 1000 };
  p.hvac!.bindings[s.id] = { deviceIds: [], operatingScenarioId: "operation-1", editMode: "design", overrides: {} };
  const before = JSON.stringify(p.heatingLayout), pkg = hvacBoundaryPackage(p, s), ufh = pkg.heaters.find(h => h.kind === "ufh")!;
  assert.equal(ufh.watts, 1000); assert.ok(ufh.coverageM2! > 0); assert.equal(ufh.model, "zoneHeatFluxRequiresFaceMapping");
  assert.ok((ufh.footprint as { circuits: unknown[] }).circuits.length > 0);
  assert.deepEqual(resolveHvacScenario(p, s).boundaries, s.boundaries); assert.equal(JSON.stringify(p.heatingLayout), before);
});
test("door/window domain stopping and real Python surface heat mapping are retained", () => {
  const p = hvacProject(), s = p.cfdScenarios![0]; p.hvac!.bindings[s.id] = { deviceIds: [], operatingScenarioId: "operation-1", editMode: "design", overrides: {} };
  const request = JSON.parse(preparationRequestBody(p, s, "0".repeat(64))); const report = realPreparation(request);
  assert.equal(report.domain.includedRoomIds.length, 1); assert.equal(report.objects.filter(o => o.heatW === 1000).length, 1);
});
test("HVAC thermal execution fails closed even if a custom adapter advertises run capability", async () => {
  const p = hvacProject(), s = p.cfdScenarios![0];
  p.hvac!.bindings[s.id] = { deviceIds: [], operatingScenarioId: "operation-1", editMode: "design", overrides: {} };
  await assert.rejects(prepareWorkerSubmission("unused", p, s, "run", new AbortController().signal), /thermal execution is not connected/);
});
