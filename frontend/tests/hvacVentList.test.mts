import test from "node:test";
import assert from "node:assert/strict";
import { hvacProject } from "./hvacFixtures";
import { ventSchema } from "../lib/climoptixDocument";
import { reorderHvacRoomVents } from "../lib/hvacDocument";

test("room vent reorder preserves other rooms and object slots while updating CFD group order", () => {
  const p = hvacProject(), op = p.hvac!.scenarios[0];
  p.hvac!.devices = ["a", "other", "b", "c"].map(id => ({ vent: ventSchema.parse({ id, name: id, role: "supply", host: { patchId: "host" } }), floorId: op.floorId, roomId: id === "other" ? "another-room" : op.roomId, enabled: true, outdoorAirFraction: 1, extractKind: "exhaust" }));
  p.cfdScenarios![0].objectGroups = [{ id: "objects-default", name: "General", memberIds: ["vent:a", "object:chair", "vent:other", "vent:b", "vent:c"] }];
  const original = structuredClone(p);
  const next = reorderHvacRoomVents(p, op.floorId, op.roomId, "c", 0);
  assert.deepEqual(next.hvac!.devices.map(d => d.vent.id), ["c", "other", "a", "b"]);
  assert.deepEqual(next.cfdScenarios![0].objectGroups![0].memberIds, ["vent:c", "object:chair", "vent:other", "vent:a", "vent:b"]);
  assert.deepEqual(p, original);
  assert.deepEqual(next.hvac!.scenarios, original.hvac!.scenarios);
  for (const [id, boundary] of [["missing", 0], ["other", 0], ["a", -1], ["a", 100], ["a", 0], ["a", .5]] as const) assert.equal(reorderHvacRoomVents(p, op.floorId, op.roomId, id, boundary), p);
});
