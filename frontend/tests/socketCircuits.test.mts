import test from "node:test";
import assert from "node:assert/strict";
import { buildSocketCircuit, testSocketCircuits } from "../lib/socketCircuits.ts";
import { createElectricalConnection, DEFAULT_ELECTRICAL_LAYOUT, normalizeElectricalLayout, type ElectricalCircuit } from "../lib/electricalLayout.ts";
import { planElectricalLayoutImport } from "../lib/electricalLayoutPackage.ts";
import type { Room, Obstacle } from "../lib/types.ts";
const devices = [{ id: "board", representation_key: "electrical-board-compact" }, ...["a", "b", "c"].map(id => ({ id, representation_key: "electrical-socket-double" })), { id: "lamp", representation_key: "electrical-pendant-dome" }];
const circuit: ElectricalCircuit = { id: "socket-circuit", name: "Sockets", color: "#123456", consumerUnitId: "board", socketTopology: "RING", socketIds: ["a", "b", "c"] };
const layout = (c = circuit) => ({ ...DEFAULT_ELECTRICAL_LAYOUT, circuits: [c], connections: buildSocketCircuit(c, devices, []) });
test("ring creates a real return to the consumer unit and every socket passes", () => {
  const data = layout(); assert.equal(data.connections.length, 4);
  assert.deepEqual(data.connections.map(e => [e.fromId, e.toId]), [["board", "a"], ["a", "b"], ["b", "c"], ["c", "board"]]);
  assert.ok(testSocketCircuits(data, devices).every(s => s.passed));
});
test("open return remains reachable but fails a ring test; isolated sockets fail individually", () => {
  const data = layout(); data.connections.pop();
  assert.ok(testSocketCircuits(data, devices).every(s => s.connected && !s.passed));
  data.connections = data.connections.filter(e => ![e.fromId, e.toId].includes("b"));
  const tests = testSocketCircuits(data, devices);
  assert.equal(tests.find(s => s.socketId === "a")!.connected, true);
  assert.equal(tests.find(s => s.socketId === "b")!.connected, false);
});
test("radials support branches but reject cycles and ignore lighting control", () => {
  const data = layout({ ...circuit, socketTopology: "RADIAL" });
  assert.ok(testSocketCircuits(data, devices).every(s => s.passed));
  data.connections[2] = { ...data.connections[2], fromId: "a" };
  assert.ok(testSocketCircuits(data, devices).every(s => s.passed));
  data.connections.push(createElectricalConnection({ fromId: "b", toId: "c", circuitId: circuit.id, type: "POWER" }, data.connections)!);
  assert.ok(testSocketCircuits(data, devices).every(s => !s.passed));
  data.connections = data.connections.map(e => ({ ...e, type: "CONTROL" }));
  assert.ok(testSocketCircuits(data, devices).every(s => !s.connected));
});
test("route regeneration replaces only this circuit's power edges", () => {
  const control = createElectricalConnection({ fromId: "a", toId: "lamp", circuitId: circuit.id, type: "CONTROL" }, [])!;
  const edges = buildSocketCircuit(circuit, devices, [control, ...layout().connections]);
  assert.equal(edges.length, 5); assert.equal(edges[0], control);
});
test("missing boards, deleted sockets, duplicate members and single-socket rings fail clearly", () => {
  for (const change of [{ consumerUnitId: "missing" }, { socketIds: ["a"] }, { socketIds: ["a", "missing"] }, { socketIds: ["a", "a"] }]) assert.throws(() => buildSocketCircuit({ ...circuit, ...change }, devices, []));
  const data = layout(); assert.ok(testSocketCircuits(data, devices.filter(d => d.id !== "board")).every(s => !s.passed));
  assert.ok(testSocketCircuits(data, devices.filter(d => d.id !== "b")).every(s => !s.passed));
});
test("cross-circuit feeds are rejected and reversed duplicate edges cannot fake a ring", () => {
  const foreign = createElectricalConnection({ fromId: "board", toId: "a", circuitId: "foreign", type: "POWER" }, [])!;
  assert.throws(() => buildSocketCircuit(circuit, devices, [foreign]), /another power circuit/);
  const data = layout(); data.connections.push({ ...data.connections[0], id: "reverse", fromId: "a", toId: "board" });
  assert.ok(testSocketCircuits(data, devices).every(s => !s.passed));
});
test("power topology and membership survive normalization and JSON save/load", () => {
  const data = layout(); const restored = normalizeElectricalLayout(JSON.parse(JSON.stringify(data)), new Set(devices.map(d => d.id)));
  assert.deepEqual(restored.circuits, data.circuits); assert.ok(testSocketCircuits(restored, devices).every(s => s.passed));
});
test("merge import remaps the consumer unit and socket membership with their routes", () => {
  const measure = (value: number) => ({ value, uncertainty_mm: 0, verified: true, source_type: "USER_MEASURED" });
  const fittings = devices.map((d, i) => ({ ...d, name: d.id, center: { x: 200 + i * 400, y: 100 }, base_z_mm: 300, verified: true, rotation_deg: 0, dimensions: { width: measure(80), depth: measure(20), height: measure(80) } })) as Obstacle[];
  const room = { id: "room", vertices: [{ x: 0, y: 0 }, { x: 3000, y: 0 }, { x: 3000, y: 3000 }, { x: 0, y: 3000 }], wall_thickness: measure(50), obstacles: fittings } as Room;
  const data = layout();
  const archive = { packageType: "freefloorplan3d-electrical-layout" as const, schemaVersion: 1 as const, projectName: "Test", exportedAt: "2026-11-01T00:00:00Z", items: fittings.map(obstacle => ({ roomId: room.id, obstacle })), assets: [], assetInstances: [], electricalLayout: data };
  const imported = planElectricalLayoutImport(archive, [room], data, [], [], "MERGE", new Map());
  const next = imported.electricalLayout.circuits.find(c => c.id !== circuit.id)!;
  assert.ok(next.consumerUnitId !== "board"); assert.ok(next.socketIds!.every(id => !["a", "b", "c"].includes(id)));
  assert.ok(testSocketCircuits(imported.electricalLayout, imported.rooms.flatMap(r => r.obstacles)).every(s => s.passed));
});
