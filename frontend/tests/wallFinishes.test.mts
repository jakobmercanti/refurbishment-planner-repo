import assert from "node:assert/strict";
import test from "node:test";
import { buildWallFinishUpdates, roomPerimeterWallIds } from "../lib/wallFinishes.ts";
import type { Room } from "../lib/types.ts";

const measurement = (value: number) => ({ value, uncertainty_mm: 0, verified: true, source_type: "TEST" });

function room(id: string, vertices: Room["vertices"], finishes?: Room["finishes"]): Room {
  return {
    id,
    name: id,
    version: 1,
    vertices,
    wall_height: measurement(2400),
    wall_thickness: measurement(100),
    openings: [],
    obstacles: [],
    finishes,
  };
}

const rooms = [
  room("room-1", [{ x: 0, y: 0 }, { x: 1000, y: 0 }, { x: 1000, y: 800 }, { x: 0, y: 800 }], { wall_colors: { "wall-001": "#111111" } }),
  room("room-2", [{ x: 1000, y: 0 }, { x: 1700, y: 0 }, { x: 1700, y: 900 }, { x: 1000, y: 900 }], { wall_colors: { "wall-002": "#222222" } }),
];

test("every room perimeter wall is included in the all-walls finish update", () => {
  assert.deepEqual(roomPerimeterWallIds(rooms[0]), ["wall-001", "wall-002", "wall-003", "wall-004"]);
  const updates = buildWallFinishUpdates(rooms, "room-1", ["wall-002"], true, { colour: "#abcdef", name: "Test blue" });
  assert.deepEqual(updates.map((update) => update.roomId), ["room-1", "room-2"]);
  updates.forEach((update) => {
    assert.deepEqual(
      roomPerimeterWallIds(rooms.find((room) => room.id === update.roomId)!).every((wallId) => update.finishes.wall_colors?.[wallId] === "#abcdef"),
      true,
    );
    assert.deepEqual(
      roomPerimeterWallIds(rooms.find((room) => room.id === update.roomId)!).every((wallId) => update.finishes.wall_color_codes?.[wallId] === "Test blue"),
      true,
    );
  });
});

test("single-room wall updates remain scoped to the selected wall set", () => {
  const updates = buildWallFinishUpdates(rooms, "room-2", ["wall-002"], false, { colour: "#fedcba", name: "Test orange" });
  assert.equal(updates.length, 1);
  assert.equal(updates[0].roomId, "room-2");
  assert.equal(updates[0].finishes.wall_colors?.["wall-002"], "#fedcba");
  assert.equal(updates[0].finishes.wall_colors?.["wall-001"], undefined);
  assert.equal(updates[0].finishes.wall_colors?.["wall-003"], undefined);
  assert.equal(updates[0].finishes.wall_colors?.["wall-004"], undefined);
});

test("removing an all-walls colour clears every perimeter colour and code", () => {
  const updates = buildWallFinishUpdates(rooms, "room-1", ["wall-001"], true);
  updates.forEach((update) => {
    roomPerimeterWallIds(rooms.find((room) => room.id === update.roomId)!).forEach((wallId) => {
      assert.equal(update.finishes.wall_colors?.[wallId], undefined);
      assert.equal(update.finishes.wall_color_codes?.[wallId], undefined);
    });
  });
});
