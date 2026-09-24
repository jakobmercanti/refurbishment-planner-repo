import assert from "node:assert/strict";
import test from "node:test";
import { closedRooms } from "../lib/roomDetection.ts";

function area(points: { x: number; y: number }[]): number {
  return Math.abs(points.reduce((total, point, index) => {
    const next = points[(index + 1) % points.length];
    return total + point.x * next.y - next.x * point.y;
  }, 0) / 2);
}

test("returns only the two faces when an internal wall subdivides a rectangle", () => {
  const rooms = closedRooms([
    { id: "room-1", points: [{ x: 0, y: 0 }, { x: 2400, y: 0 }, { x: 2400, y: 1800 }, { x: 0, y: 1800 }, { x: 0, y: 0 }] },
    // 4–5–6–7; the final endpoint lands on the top wall at corner 7.
    { id: "internal-wall", points: [{ x: 0, y: 0 }, { x: 0, y: 420 }, { x: 600, y: 420 }, { x: 600, y: 0 }] },
  ]);

  assert.equal(rooms.length, 2);
  assert.deepEqual(rooms.map((room) => area(room.vertices)).sort((first, second) => first - second), [252_000, 4_068_000]);
  const smallRoom = rooms.find((room) => area(room.vertices) === 252_000);
  assert.ok(smallRoom);
  assert.deepEqual(smallRoom.vertices, [{ x: 0, y: 0 }, { x: 600, y: 0 }, { x: 600, y: 420 }, { x: 0, y: 420 }]);
});

test("keeps separate closed wall outlines when no subdivision exists", () => {
  const rooms = closedRooms([
    { id: "room-1", points: [{ x: 0, y: 0 }, { x: 2400, y: 0 }, { x: 2400, y: 1800 }, { x: 0, y: 1800 }, { x: 0, y: 0 }] },
    { id: "room-2", points: [{ x: 3000, y: 0 }, { x: 4200, y: 0 }, { x: 4200, y: 1200 }, { x: 3000, y: 1200 }, { x: 3000, y: 0 }] },
  ]);

  assert.equal(rooms.length, 2);
  assert.deepEqual(rooms.map((room) => room.sourceWallId).sort(), ["room-1", "room-2"]);
});

test("keeps the original room when an attached external loop creates another room", () => {
  const rooms = closedRooms([
    { id: "room-1", points: [{ x: 0, y: 0 }, { x: 2400, y: 0 }, { x: 2400, y: 1800 }, { x: 0, y: 1800 }, { x: 0, y: 0 }] },
    // 5–6–7–8–9; the endpoints at 5 and 9 attach to the original right and top walls.
    { id: "external-wall", points: [{ x: 2400, y: 900 }, { x: 3600, y: 900 }, { x: 3600, y: -600 }, { x: 1200, y: -600 }, { x: 1200, y: 0 }] },
  ]);

  assert.equal(rooms.length, 2);
  assert.ok(rooms.some((room) => area(room.vertices) === 4_320_000));
  assert.ok(rooms.some((room) => area(room.vertices) === 2_520_000));
});
