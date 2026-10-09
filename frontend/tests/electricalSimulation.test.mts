import test from "node:test";
import assert from "node:assert/strict";
import { simulateLighting, switchGangCount, switchTestKey } from "../lib/electricalSimulation.ts";
import { createElectricalConnection, normalizeElectricalLayout, DEFAULT_ELECTRICAL_LAYOUT } from "../lib/electricalLayout.ts";
import { windowHelpSteps } from "../lib/windowHelp.ts";
import type { Obstacle } from "../lib/types.ts";
const fixtures = [
  { id: "s1", name: "First switch", representation_key: "electrical-switch-single" },
  { id: "s2", name: "Second switch", representation_key: "electrical-switch-single" },
  { id: "l1", name: "First light", representation_key: "electrical-ceiling-downlight" },
  { id: "l2", name: "Second light", representation_key: "electrical-pendant-dome" },
] as Obstacle[];
const id = DEFAULT_ELECTRICAL_LAYOUT.circuits[0].id;
const connection = (fromId: string, toId: string, extra = {}) => createElectricalConnection({ fromId, toId, circuitId: id, ...extra }, [])!;
const layout = (...connections: ReturnType<typeof connection>[]) => ({ ...DEFAULT_ELECTRICAL_LAYOUT, connections });

test("single switch turns connected lamps on/off without mutating project data", () => {
  const data = layout(connection("s1", "l1"), connection("l1", "l2"));
  const original = structuredClone(data), key = switchTestKey(id, "s1");
  assert.deepEqual(simulateLighting(data, fixtures, {}).lights, { l1: false, l2: false });
  assert.deepEqual(simulateLighting(data, fixtures, { [key]: true }).lights, { l1: true, l2: true });
  assert.deepEqual(data, original);
});
test("two-way control: either switch always flips the same lamps", () => {
  const data = layout(connection("s1", "l1"), connection("l1", "s2"), connection("l1", "l2"));
  const a = switchTestKey(id, "s1"), b = switchTestKey(id, "s2");
  for (const [positions, on] of [[{}, false], [{ [a]: true }, true], [{ [a]: true, [b]: true }, false], [{ [b]: true }, true]] as const) {
    const result = simulateLighting(data, fixtures, positions);
    assert.equal(result.lights.l1, on); assert.equal(result.lights.l2, on);
    assert.equal(result.groups[0].switchKeys.length, 2);
  }
});
test("multi-gang switches independently operate different lighting groups", () => {
  const devices = fixtures.map(item => item.id === "s1" ? { ...item, representation_key: "electrical-switch-double" } : item);
  const data = layout(connection("s1", "l1", { fromSwitchGang: 1 }), connection("l2", "s1", { toSwitchGang: 2 }));
  assert.deepEqual(simulateLighting(data, devices, { [switchTestKey(id, "s1", 2)]: true }).lights, { l1: false, l2: true });
  assert.equal(switchGangCount("electrical-switch-dimmer-double"), 2);
  assert.equal(switchGangCount("electrical-switch-quadruple"), 4);
});
test("control groups stay separate across circuits", () => {
  const second = { id: "other", name: "Other circuit", color: "#123456" };
  const data = { ...layout(connection("s1", "l1"), connection("s1", "l2", { circuitId: second.id })), circuits: [...DEFAULT_ELECTRICAL_LAYOUT.circuits, second] };
  assert.deepEqual(simulateLighting(data, fixtures, { [switchTestKey(second.id, "s1")]: true }).lights, { l1: false, l2: true });
});
test("duplicate/reversed edges do not toggle a lamp twice", () => {
  const data = layout(connection("s1", "l1"), connection("l1", "s1"), connection("s1", "l1", { type: "CONTROL" }));
  const result = simulateLighting(data, fixtures, { [switchTestKey(id, "s1")]: true });
  assert.equal(result.lights.l1, true); assert.equal(result.groups[0].switchKeys.length, 1);
});
test("Power links and unrelated devices are not interpreted as lighting control", () => {
  const socket = { ...fixtures[0], id: "socket", representation_key: "electrical-socket-single" };
  const result = simulateLighting(layout(connection("s1", "l1", { type: "POWER" }), connection("s2", "socket"), connection("socket", "l2")), [...fixtures, socket], { [switchTestKey(id, "s1")]: true });
  assert.deepEqual(result.lights, { l1: false, l2: false }); assert.match(result.warnings.join(" "), /no supported switch control/);
});
test("missing endpoints, invalid gangs and cross-circuit lamp assignments get feedback", () => {
  const missing = simulateLighting(layout(connection("s1", "missing")), fixtures, {});
  assert.match(missing.warnings.join(" "), /missing fitting/);
  const gang = simulateLighting(layout(connection("s1", "l1", { fromSwitchGang: 2 })), fixtures, {});
  assert.match(gang.warnings.join(" "), /gang 2 is unavailable/);
  const second = { id: "other", name: "Other", color: "#123456" };
  const multi = simulateLighting({ ...layout(connection("s1", "l1"), connection("s2", "l1", { circuitId: "other" })), circuits: [...DEFAULT_ELECTRICAL_LAYOUT.circuits, second] }, fixtures, {});
  assert.match(multi.warnings.join(" "), /multiple circuits/);
});
test("label anchors and gang assignments survive normalization and JSON roundtrip", () => {
  const data = layout(connection("s1", "l1", { labelPosition: { x: 321.5, y: -80 }, fromSwitchGang: 2 }));
  const parsed = normalizeElectricalLayout(JSON.parse(JSON.stringify(data)), new Set(["s1", "l1"]));
  assert.deepEqual(parsed.connections[0].labelPosition, { x: 321.5, y: -80 }); assert.equal(parsed.connections[0].fromSwitchGang, 2);
  const bad = normalizeElectricalLayout(layout(connection("s1", "l1", { labelPosition: { x: Infinity, y: 0 }, fromSwitchGang: 5 })), new Set(["s1", "l1"]));
  assert.equal(bad.connections[0].labelPosition, undefined); assert.equal(bad.connections[0].fromSwitchGang, undefined);
});
test("window help explains electrical checkout and each specialist workflow", () => {
  assert.match(JSON.stringify(windowHelpSteps("Full Electrical Layout module")), /press Enter/);
  assert.match(JSON.stringify(windowHelpSteps("Lighting layout test")), /Two-way/);
  assert.match(JSON.stringify(windowHelpSteps("Electrical BOM & schedule")), /order quantities/);
  assert.match(JSON.stringify(windowHelpSteps("Energy & Insulation")), /not official EPCs/);
  assert.match(JSON.stringify(windowHelpSteps("Heating Layout")), /UFH/);
});
