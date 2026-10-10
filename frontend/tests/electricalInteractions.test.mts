import test from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { electricalCrossings, crossingBridgePath } from "../lib/electricalCrossings.ts";
import { simulateLighting, lightingSwitchGangs, switchTestKey } from "../lib/electricalSimulation.ts";
import { createElectricalConnection, DEFAULT_ELECTRICAL_LAYOUT, normalizeElectricalLayout } from "../lib/electricalLayout.ts";
import { ElectricalLightingTest } from "../components/ElectricalLightingTest";
import { planElectricalLayoutImport } from "../lib/electricalLayoutPackage.ts";
import type { Obstacle, Room } from "../lib/types.ts";

const fixtures = [
  { id: "s1", name: "Double switch", representation_key: "electrical-switch-double", center: { x: 0, y: 50 } },
  { id: "s2", name: "Second switch", representation_key: "electrical-switch-single", center: { x: 50, y: 0 } },
  { id: "l1", name: "First lamp", representation_key: "electrical-ceiling-downlight", center: { x: 100, y: 50 } },
  { id: "l2", name: "Second lamp", representation_key: "electrical-pendant-dome", center: { x: 50, y: 100 } },
] as Obstacle[];
const circuitId = DEFAULT_ELECTRICAL_LAYOUT.circuits[0].id;
const connection = (fromId: string, toId: string, extra = {}) => createElectricalConnection({ fromId, toId, circuitId, routing: "STRAIGHT", ...extra }, [])!;
const layout = { ...DEFAULT_ELECTRICAL_LAYOUT, forceOrthogonalRouting: false, connections: [connection("s1", "l1", { id: "wire-a", fromSwitchGang: 2 }), connection("s2", "l2", { id: "wire-b" })] };
const joined = { ...layout, junctions: [{ id: "join", position: { x: 50, y: 50 }, connectionIds: ["wire-a", "wire-b"] }] };

test("unconnected crossing is a bridge and never conducts through geometry or circuit membership", () => {
  const crossing = electricalCrossings(layout, fixtures);
  assert.equal(crossing.length, 1);
  assert.deepEqual(crossing[0].position, { x: 50, y: 50 });
  assert.equal(crossing[0].connected, false);
  assert.match(crossingBridgePath({ x: 20, y: 20 }, { x: 0, y: 1 }), /^M20,13 A7,7 0 0 1 20,27$/);
  assert.deepEqual(simulateLighting(layout, fixtures, { [switchTestKey(circuitId, "s1", 2)]: true }).lights, { l1: true, l2: false });
});
test("explicit junction dots join supported same-circuit control paths and stale joins do not", () => {
  assert.equal(electricalCrossings(joined, fixtures)[0].connected, true);
  assert.equal(simulateLighting(joined, fixtures, {}).groups.length, 1);
  const moved = fixtures.map(item => item.id === "s2" || item.id === "l2" ? { ...item, center: { ...item.center, x: 80 } } : item);
  assert.equal(electricalCrossings(joined, moved)[0].connected, false);
  assert.equal(simulateLighting(joined, moved, {}).groups.length, 2);
  const roundtrip = normalizeElectricalLayout(JSON.parse(JSON.stringify(joined)), new Set(fixtures.map(item => item.id)));
  assert.deepEqual(roundtrip.junctions, joined.junctions);
  assert.equal(normalizeElectricalLayout({ ...joined, connections: joined.connections.slice(0, 1) }, new Set(fixtures.map(item => item.id))).junctions, undefined);
});
test("different circuits cannot be joined merely by crossing", () => {
  const second = { id: "second", name: "Second", color: "#112233" };
  const data = { ...joined, circuits: [...joined.circuits, second], connections: joined.connections.map((item, index) => index ? { ...item, circuitId: second.id } : item) };
  assert.equal(electricalCrossings(data, fixtures)[0].canJoin, false);
  assert.equal(electricalCrossings(data, fixtures)[0].connected, false);
  assert.equal(normalizeElectricalLayout(data, new Set(fixtures.map(item => item.id))).junctions, undefined);
});
test("every rocker has its own control including unconnected gangs, and Gang 2 never operates Gang 1", () => {
  const data = { ...layout, connections: [connection("s1", "l1", { fromSwitchGang: 1 }), connection("s1", "l2", { fromSwitchGang: 2 })] };
  const result = simulateLighting(data, fixtures, { [switchTestKey(circuitId, "s1", 2)]: true });
  assert.deepEqual(result.lights, { l1: false, l2: true });
  assert.deepEqual(lightingSwitchGangs(fixtures, result).s1.map(gang => gang.on), [false, true]);
  assert.equal(electricalCrossings(data, fixtures).length, 0, "different gangs sharing a symbol centre are not crossing wires");
  const unconnected = lightingSwitchGangs(fixtures, simulateLighting(layout, fixtures, {})).s1;
  assert.equal(unconnected[0].label, "Not connected");
  assert.equal(unconnected[0].keys.length, 0);
});
test("compact lighting test exposes separate gang buttons and collapsible circuits/instructions", () => {
  const result = simulateLighting(layout, fixtures, {});
  const html = renderToStaticMarkup(createElement(ElectricalLightingTest, { layout, fixtures, result, positions: {}, onToggle() {}, onReset() {} }));
  assert.match(html, /aria-label="Double switch · Gang 1" disabled=""|disabled="" aria-label="Double switch · Gang 1"/);
  assert.match(html, /aria-label="Double switch · Gang 2"/);
  assert.match(html, /electrical-test-circuit/);
  assert.match(html, /<summary>How to test your layout<\/summary>/);
  assert.match(html, /Not connected/);
});
test("distinct switch-gang connections survive normalization without collapsing into one link", () => {
  const first = connection("s1", "s2", { fromSwitchGang: 1 });
  const second = createElectricalConnection({ fromId: "s1", toId: "s2", circuitId, fromSwitchGang: 2 }, [first]);
  assert.ok(second);
  assert.equal(normalizeElectricalLayout({ ...layout, connections: [first, second] }, new Set(["s1", "s2"])).connections.length, 2);
});
test("merge imports remap junction references without losing existing joins", () => {
  const room = { id: "room", vertices: [{ x: -10, y: -10 }, { x: 110, y: -10 }, { x: 110, y: 110 }, { x: -10, y: 110 }], obstacles: fixtures } as Room;
  const archive = { packageType: "freefloorplan3d-electrical-layout" as const, schemaVersion: 1 as const, projectName: "Test", exportedAt: "2026-10-10T00:00:00Z", items: fixtures.map(obstacle => ({ roomId: "room", obstacle })), assets: [], assetInstances: [], electricalLayout: joined };
  const imported = planElectricalLayoutImport(archive, [room], joined, [], [], "MERGE", new Map());
  assert.equal(imported.electricalLayout.junctions?.length, 2);
  const last = imported.electricalLayout.junctions!.at(-1)!;
  assert.ok(last.connectionIds.every(id => !["wire-a", "wire-b"].includes(id)));
  assert.ok(last.connectionIds.every(id => imported.electricalLayout.connections.some(link => link.id === id)));
});
