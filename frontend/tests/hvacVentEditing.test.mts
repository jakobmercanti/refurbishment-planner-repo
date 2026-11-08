import test from "node:test";
import assert from "node:assert/strict";
import { changeVentControl, ventSchema } from "../lib/climoptixDocument";
import { commitHvacCFD, hvacSchema, resolveHvacVents, updateVentDevice } from "../lib/hvacDocument";
import { hvacProject } from "./hvacFixtures";

function fixture(control: "pressure" | "volumeFlow" = "pressure") {
  const project = hvacProject(), hvac = project.hvac!, op = hvac.scenarios[0], scenario = project.cfdScenarios![0];
  const vent = ventSchema.parse({ id: "edited-vent", name: "Edited vent", role: "extract", control, valueSI: control === "pressure" ? 100 : .1, host: { patchId: `${op.floorId}:${op.roomId}:floor` } });
  hvac.devices = [{ vent, floorId: op.floorId, roomId: op.roomId, enabled: true, outdoorAirFraction: 1, extractKind: "exhaust" }];
  op.ventOverrides[vent.id] = { valueSI: control === "pressure" ? 0 : .2, temperatureK: 310, enabled: true };
  hvac.scenarios.push({ ...structuredClone(op), id: "independent-operation", name: "Independent" });
  hvac.bindings[scenario.id] = { deviceIds: [vent.id], operatingScenarioId: op.id, editMode: "design", overrides: { [vent.id]: { valueSI: control === "pressure" ? 50 : .3, temperatureK: 320 } } };
  return { project, hvac, vent, op, scenario };
}

test("changing quantity uses valid defaults instead of interpreting a number in different units", () => {
  const { vent } = fixture();
  for (const [control, value] of [["volumeFlow", .05], ["massFlow", .06], ["velocity", 1], ["pressure", 0]] as const) {
    const source = { ...vent, control: control === "pressure" ? "velocity" as const : "pressure" as const };
    const changed = changeVentControl(source, control);
    assert.equal(changed.valueSI, value); assert.equal(changed.host.patchId, source.host.patchId);
    assert.equal(source.valueSI, 100);
  }
  assert.equal(changeVentControl(vent, vent.control), vent);
});

test("permanent quantity edits atomically discard incompatible values in every operation and case", () => {
  const { hvac, vent } = fixture(), original = structuredClone(hvac);
  const next = updateVentDevice(hvac, vent.id, { vent: changeVentControl(vent, "volumeFlow") });
  assert.deepEqual(hvac, original);
  assert.equal(next.devices[0].vent.valueSI, .05);
  for (const op of next.scenarios) assert.deepEqual(op.ventOverrides[vent.id], { temperatureK: 310, enabled: true });
  assert.deepEqual(Object.values(next.bindings)[0].overrides[vent.id], { temperatureK: 320 });
  assert.doesNotThrow(() => hvacSchema.parse(next));
});

test("permanent ventilation edits supersede the same fields in all linked scenarios and cases", () => {
  const { hvac, vent } = fixture("volumeFlow");
  const next = updateVentDevice(hvac, vent.id, { vent: { ...vent, valueSI: .4, temperatureK: 300 } });
  assert.deepEqual(next.scenarios[0].ventOverrides[vent.id], { enabled: true });
  assert.deepEqual(next.scenarios[1].ventOverrides[vent.id], { enabled: true });
  assert.equal(Object.values(next.bindings)[0].overrides[vent.id], undefined);
  assert.equal(updateVentDevice(next, vent.id, { enabled: false }).scenarios[0].ventOverrides[vent.id], undefined);
});

test("CFD restore replaces only the shared vents in the checked domain and clears their overrides", () => {
  const { project, hvac, scenario, vent, op } = fixture();
  const outside = { ...hvac.devices[0], roomId: "other-room", vent: { ...vent, id: "other-vent" } };
  hvac.devices.push(outside);
  const starter = { ...scenario, id: "restored-study", vents: [{ ...vent, widthMm: 800 }] };
  const scope = { scenarioId: starter.id, rooms: [{ floorId: op.floorId, roomId: op.roomId }], replaceVents: true };
  assert.throws(() => commitHvacCFD(project, [starter]), /conflicts with a shared design ID/);
  const next = commitHvacCFD(project, [starter], scope);
  assert.deepEqual(next.hvac!.devices.find(device => device.vent.id === outside.vent.id), outside);
  assert.equal(next.hvac!.devices.find(device => device.vent.id === vent.id)?.vent.widthMm, 800);
  assert.ok(next.hvac!.scenarios.every(operation => operation.ventOverrides[vent.id] === undefined));
  assert.deepEqual(resolveHvacVents(next, next.cfdScenarios![0]), starter.vents);
  assert.equal(project.hvac!.devices[0].vent.widthMm, vent.widthMm);
});

test("invalid or stale edits cannot mutate the shared document", () => {
  const { hvac, vent } = fixture(), original = structuredClone(hvac);
  assert.throws(() => updateVentDevice(hvac, "missing-vent", { enabled: false }), /no longer exists/);
  assert.throws(() => updateVentDevice(hvac, vent.id, { vent: { ...vent, id: "changed-id" } }), /cannot change its ID/);
  assert.throws(() => updateVentDevice(hvac, vent.id, { vent: { ...vent, control: "velocity", valueSI: 0 } }));
  assert.deepEqual(hvac, original);
});

for (const mode of ["design", "override"] as const) test(`CFD ${mode} quantity edits keep canonical and resolved values valid`, () => {
  const { project, hvac, scenario, vent } = fixture();
  hvac.bindings[scenario.id].editMode = mode;
  // The design and one scenario may legitimately be at zero relative pressure.
  hvac.devices[0].vent.valueSI = 0;
  const edited = { ...scenario, vents: resolveHvacVents(project, scenario) };
  edited.vents[0] = changeVentControl(edited.vents[0], "volumeFlow");
  const next = commitHvacCFD(project, [edited]);
  assert.equal(next.hvac!.devices[0].vent.valueSI, .05);
  assert.equal(next.hvac!.devices[0].vent.control, "volumeFlow");
  assert.equal(resolveHvacVents(next, next.cfdScenarios![0])[0].valueSI, .05);
  assert.equal(next.hvac!.scenarios[1].ventOverrides[vent.id].valueSI, undefined);
  assert.equal(next.hvac!.scenarios[1].ventOverrides[vent.id].temperatureK, 310);
  assert.equal(next.hvac!.bindings[scenario.id].overrides[vent.id].temperatureK, 320);
  assert.doesNotThrow(() => hvacSchema.parse(next.hvac));
});

test("equal numeric values with different quantities still clear all incompatible overrides", () => {
  const { project, hvac, vent, scenario } = fixture();
  hvac.devices[0].vent.valueSI = 1;
  hvac.bindings[scenario.id].overrides[vent.id].valueSI = 1;
  const edited = { ...scenario, vents: resolveHvacVents(project, scenario) };
  edited.vents[0] = { ...edited.vents[0], control: "velocity", valueSI: 1 };
  const next = commitHvacCFD(project, [edited]);
  assert.equal(resolveHvacVents(next, next.cfdScenarios![0])[0].valueSI, 1);
  assert.equal(next.hvac!.scenarios[0].ventOverrides[vent.id].valueSI, undefined);
  assert.equal(next.hvac!.scenarios[1].ventOverrides[vent.id].valueSI, undefined);
  assert.equal(next.hvac!.bindings[scenario.id].overrides[vent.id].valueSI, undefined);
});
