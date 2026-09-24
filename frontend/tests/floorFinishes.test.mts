import assert from "node:assert/strict";
import test from "node:test";
import { buildFloorFinishUpdates } from "../lib/floorFinishes.ts";
import type { Room } from "../lib/types.ts";

const measurement = (value: number) => ({ value, uncertainty_mm: 0, verified: true, source_type: "TEST" });

function room(id: string, finishes?: Room["finishes"]): Room {
  return {
    id,
    name: id,
    version: 1,
    vertices: [{ x: 0, y: 0 }, { x: 1000, y: 0 }, { x: 1000, y: 800 }, { x: 0, y: 800 }],
    wall_height: measurement(2400),
    wall_thickness: measurement(100),
    openings: [],
    obstacles: [],
    finishes,
  };
}

const rooms = [
  room("room-1", { floor_tile_id: "old-tile" }),
  room("room-2", { floor_tile_id: "other-tile" }),
];

const applyTile = (tileId: string) => buildFloorFinishUpdates(rooms, "room-1", "ALL", (finishes) => ({ ...finishes, floor_tile_id: tileId }));

test("selected floor updates only the selected room floor", () => {
  const updates = buildFloorFinishUpdates(rooms, "room-2", "SELECTED", (finishes) => ({ ...finishes, floor_tile_id: "new-tile" }));
  assert.deepEqual(updates.map((update) => update.roomId), ["room-2"]);
  assert.equal(updates[0].finishes.floor_tile_id, "new-tile");
});

test("current room floor updates remain scoped to the selected room", () => {
  const updates = buildFloorFinishUpdates(rooms, "room-1", "ROOM", (finishes) => ({ ...finishes, floor_tile_id: "new-tile" }));
  assert.deepEqual(updates.map((update) => update.roomId), ["room-1"]);
});

test("all floors receive the tile while preserving each room's other finishes", () => {
  const updates = applyTile("new-tile");
  assert.deepEqual(updates.map((update) => update.roomId), ["room-1", "room-2"]);
  updates.forEach((update) => assert.equal(update.finishes.floor_tile_id, "new-tile"));
});
