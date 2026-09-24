import test from "node:test";
import assert from "node:assert/strict";
import { gardenClear, roomAppearances } from "../lib/floorplanAppearance.ts";
import type { Room } from "../lib/types.ts";

const rooms = ["a", "b", "c", "d"].map((id) => ({ id, name: `Room ${id}`, vertices: [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }, { x: 0, y: 100 }] } as Room));
test("default room colours are distinct and independent of enumeration order", () => {
  const appearances = roomAppearances(rooms);
  assert.equal(new Set(appearances.map((a) => a.base)).size, rooms.length);
  assert.deepEqual(roomAppearances([...rooms].reverse()).reverse(), appearances);
});
test("explicit floor colours, tile pattern and custom palette override guesses", () => {
  const [appearance] = roomAppearances([{ ...rooms[0], finishes: { floor_color: "#123456", floor_pattern: "CHECKERBOARD", floor_tile_id: "tile", floor_tile_colours: { tile: { base: "#abcdef", accent: "#987654", grout: "#ffffff" } } } }]);
  assert.equal(appearance.base, "#abcdef");
  assert.equal(appearance.accent, "#987654");
  assert.equal(appearance.pattern, "CHECKERBOARD");
  assert.equal(roomAppearances([{ ...rooms[0], finishes: { floor_pattern: "NONE", floor_color: "#123456" } }])[0].pattern, "NONE");
});
test("garden rejects canopies inside or crossing any room including neighbouring rooms", () => {
  const polygons = rooms.slice(0, 1).map((r) => r.vertices);
  assert.equal(gardenClear({ x: 50, y: 50 }, 10, polygons), false);
  assert.equal(gardenClear({ x: 105, y: 50 }, 10, polygons), false);
  assert.equal(gardenClear({ x: 125, y: 50 }, 10, polygons), true);
});
