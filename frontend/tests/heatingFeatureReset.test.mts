import test from "node:test";
import assert from "node:assert/strict";
import { createRoomUFH, newHeatingRadiator } from "../lib/heatingDesign";
import { newHeatingProject, parseHeatingProject } from "../lib/heatingDocument";
import { thermalRoom } from "../lib/heatingCalculations";
import { removeHeatingManifold, resetRoomHeatingFeature } from "../lib/heatingRoomReset";
import { commitHeatingElements, withHeatingElements } from "../lib/heatingElements";
import type { Room } from "../lib/types";
const m = (value: number) => ({ value, uncertainty_mm: 0, verified: true, source_type: "USER_MEASURED" });
const room: Room = { id: "a", name: "Living room", version: 1, vertices: [{ x: 0, y: 0 }, { x: 6000, y: 0 }, { x: 6000, y: 4000 }, { x: 0, y: 4000 }], wall_height: m(2500), wall_thickness: m(100), openings: [], obstacles: [] };
const other: Room = { ...room, id: "b", name: "Bedroom", vertices: room.vertices.map(p => ({ x: p.x + 6000, y: p.y })) };
function seed() {
  let data = createRoomUFH(room, newHeatingProject()).heating;
  data = createRoomUFH(other, data).heating;
  data.radiators = [newHeatingRadiator(room), newHeatingRadiator(other)];
  data.rooms = [room, other].map(r => ({ ...thermalRoom(r, data), selectedEmitterType: "Radiator + UFH", designIndoorTemperatureC: 23, designTemperatureOverride: true, airChangeRate: .7, airChangeRateOverride: true }));
  const manifold = data.ufhZones.find(z => z.roomId === room.id)!.manifoldId!;
  data.pipes = [{ pipeId: "a-pipe", name: "Local radiator", kind: "Supply", diameterMm: 16, fromId: data.radiators[0].radiatorId, toId: manifold, pathMm: [data.radiators[0].positionMm, data.manifolds[0].positionMm], locked: true },
    { pipeId: "b-pipe", name: "Other room", kind: "Supply", diameterMm: 16, fromId: data.radiators[1].radiatorId, toId: manifold, pathMm: [data.radiators[1].positionMm, data.manifolds[0].positionMm], locked: false }];
  data.exclusions = [{ exclusionId: "exclusion", roomId: room.id, name: "Cabinet", polygonMm: [{ x: 100, y: 100 }, { x: 500, y: 100 }, { x: 500, y: 500 }] }];
  return data;
}
test("remove UFH keeps placed radiators, thermal inputs and manifold shared with another room", () => {
  const data = seed(), before = structuredClone(data), next = parseHeatingProject(resetRoomHeatingFeature(data, room, "UFH"));
  assert.deepEqual(data, before); assert.deepEqual(next.radiators, data.radiators); assert.deepEqual(next.pipes, data.pipes);
  assert.equal(next.ufhZones.some(z => z.roomId === room.id), false); assert.equal(next.exclusions.length, 0);
  assert.deepEqual(next.ufhCircuits, data.ufhCircuits.filter(c => data.ufhZones.find(z => z.zoneId === c.zoneId)?.roomId === other.id));
  assert.deepEqual(next.manifolds, data.manifolds); assert.deepEqual(next.rooms.find(r => r.roomId === room.id), { ...data.rooms[0], selectedEmitterType: "Radiator" });
  assert.deepEqual(next.rooms.find(r => r.roomId === other.id), data.rooms[1]);
  const stored = commitHeatingElements(data, [room, other]);
  const view = withHeatingElements(stored.heatingLayout, stored.rooms);
  const committed = commitHeatingElements(resetRoomHeatingFeature(view, room, "UFH"), stored.rooms);
  assert.equal(committed.rooms[0].obstacles.length, 1); assert.equal(committed.heatingLayout.ufhZones.length, 1);
});
test("remove room elements leaves UFH and other rooms, updates method and cleans only dependent pipes", () => {
  const data = seed(), next = parseHeatingProject(resetRoomHeatingFeature(data, room, "EMITTERS"));
  assert.deepEqual(next.radiators, [data.radiators[1]]); assert.deepEqual(next.ufhZones, data.ufhZones); assert.deepEqual(next.ufhCircuits, data.ufhCircuits);
  assert.deepEqual(next.manifolds, data.manifolds); assert.deepEqual(next.exclusions, data.exclusions); assert.deepEqual(next.pipes, [data.pipes[1]]);
  assert.equal(next.rooms.find(r => r.roomId === room.id)!.selectedEmitterType, "Underfloor Heating");
});
test("remove room-only pipework preserves cross-room links, emitters and all UFH circuits", () => {
  const data = seed(), next = resetRoomHeatingFeature(data, room, "PIPES");
  assert.deepEqual(next.pipes, [data.pipes[1]]); assert.equal(next.rooms, data.rooms); assert.deepEqual(next.radiators, data.radiators); assert.deepEqual(next.ufhCircuits, data.ufhCircuits);
});
test("remove only UFH without other emitters sets None and cleans unused local manifolds", () => {
  const data = createRoomUFH(room, newHeatingProject()).heating, next = parseHeatingProject(resetRoomHeatingFeature(data, room, "UFH"));
  assert.equal(next.manifolds.length, 0); assert.equal(next.ufhCircuits.length, 0); assert.equal(next.rooms[0].selectedEmitterType, "None");
});
test("explicit manifold removal clears dependent circuits/references but keeps floor inputs and other manifold", () => {
  const data = seed(), id = data.ufhZones.find(z => z.roomId === room.id)!.manifoldId!, next = parseHeatingProject(removeHeatingManifold(data, id));
  assert.equal(next.ufhZones[0].manifoldId, null); assert.equal(next.ufhZones[0].spacingMm, data.ufhZones[0].spacingMm);
  assert.ok(next.ufhCircuits.every(c => c.manifoldId !== id)); assert.ok(next.manifolds.every(m => m.manifoldId !== id)); assert.equal(next.manifolds.length, 1); assert.equal(next.pipes.length, 0);
  assert.deepEqual(next.radiators, data.radiators); assert.deepEqual(next.rooms, data.rooms);
});
