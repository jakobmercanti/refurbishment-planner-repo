import assert from "node:assert/strict";
import test from "node:test";
import { buildIsolatedRoomWalls, buildRenderedWalls, buildSharedWallFinishFaces } from "../lib/wallRendering.ts";
import type { Room } from "../lib/types.ts";

const measurement = (value: number) => ({ value, uncertainty_mm: 0, verified: true, source_type: "TEST" });

test("an attached L-shaped room owns both shared partition finishes", () => {
  const first = room("room-1", [{x:0,y:0},{x:2400,y:0},{x:2400,y:1800},{x:0,y:1800}]);
  const second = room("room-2", [{x:1500,y:1800},{x:2400,y:1800},{x:2400,y:600},{x:3300,y:600},{x:3300,y:2750},{x:1500,y:2750}]);
  second.finishes = { wall_colors: { "wall-001": "#6B3136", "wall-002": "#6B3136" } };
  const solids = buildRenderedWalls([first, second]);
  const faces = buildSharedWallFinishFaces([first, second], solids);
  assert.equal(faces.length, 2);
  assert.ok(faces.every((face) => face.room.id === second.id && face.paintOnly));
  assert.deepEqual(faces.map((face) => face.index).sort(), [0, 1]);
  assert.ok(faces.some((face) => face.start.y === 1900 && face.end.y === 1900));
  assert.ok(faces.some((face) => face.start.x === 2500 && face.end.x === 2500));
  const horizontal = faces.find((face) => face.index === 0)!;
  const vertical = faces.find((face) => face.index === 1)!;
  assert.deepEqual(horizontal.end, vertical.start);
  assert.deepEqual(horizontal.end, { x: 2500, y: 1900 });
  assert.equal(vertical.sourceOffsetMm, -100);
});

function room(id: string, vertices: Room["vertices"], openings: Room["openings"] = []): Room {
  return {
    id,
    name: id,
    version: 1,
    vertices,
    wall_height: measurement(2400),
    wall_thickness: measurement(100),
    openings,
    obstacles: [],
  };
}

function spanKey(start: { x: number; y: number }, end: { x: number; y: number }): string {
  return [start, end].map((point) => `${point.x},${point.y}`).sort().join("|");
}

function hasEndpoints(wall: { start: { x: number; y: number }; end: { x: number; y: number } }, first: { x: number; y: number }, second: { x: number; y: number }): boolean {
  return (wall.start.x === first.x && wall.start.y === first.y && wall.end.x === second.x && wall.end.y === second.y)
    || (wall.start.x === second.x && wall.start.y === second.y && wall.end.x === first.x && wall.end.y === first.y);
}

test("shared partial boundaries become one set of atomic 3D wall spans", () => {
  const walls = buildRenderedWalls([
    room("large", [{ x: 0, y: 0 }, { x: 1000, y: 0 }, { x: 1000, y: 1000 }, { x: 0, y: 1000 }]),
    // This room shares only the middle 400 mm of the large room's bottom edge.
    room("attached", [{ x: 300, y: 0 }, { x: 700, y: 0 }, { x: 700, y: -400 }, { x: 300, y: -400 }]),
  ]);

  const spans = new Set(walls.map((wall) => spanKey(wall.start, wall.end)));
  assert.equal(walls.length, spans.size);
  assert.deepEqual([...walls]
    .filter((wall) => wall.start.y === 0 && wall.end.y === 0)
    .map((wall) => spanKey(wall.start, wall.end))
    .sort(), ["0,0|300,0", "1000,0|700,0", "300,0|700,0"]);
  assert.equal(spans.has("300,0|700,0"), true);
});

test("an isolated room keeps every perimeter edge as a boundary wall", () => {
  const isolated = room("isolated", [
    { x: 0, y: 0 },
    { x: 1000, y: 0 },
    { x: 1000, y: 600 },
    { x: 700, y: 600 },
    { x: 700, y: 1000 },
    { x: 0, y: 1000 },
  ]);

  const walls = buildIsolatedRoomWalls(isolated);

  assert.equal(walls.length, isolated.vertices.length);
  assert.deepEqual(walls.map((wall) => spanKey(wall.start, wall.end)), [
    "0,0|1000,0",
    "1000,0|1000,600",
    "1000,600|700,600",
    "700,1000|700,600",
    "0,1000|700,1000",
    "0,0|0,1000",
  ]);
  assert.equal(walls.every((wall) => wall.sourceOffsetMm === 0 && wall.capStart === false && wall.capEnd === false), true);
});

test("atomic spans use flat caps at a T junction instead of carrying a room mitre", () => {
  const walls = buildRenderedWalls([
    room("large", [{ x: 0, y: 0 }, { x: 1000, y: 0 }, { x: 1000, y: 1000 }, { x: 0, y: 1000 }]),
    room("attached", [{ x: 300, y: 0 }, { x: 700, y: 0 }, { x: 700, y: -400 }, { x: 300, y: -400 }]),
  ]);

  const left = walls.find((wall) => hasEndpoints(wall, { x: 0, y: 0 }, { x: 300, y: 0 }));
  const shared = walls.find((wall) => spanKey(wall.start, wall.end) === "300,0|700,0");
  const right = walls.find((wall) => hasEndpoints(wall, { x: 700, y: 0 }, { x: 1000, y: 0 }));
  assert.ok(left && shared && right);
  assert.equal(left.capEnd, true);
  assert.equal(shared.capStart, true);
  assert.equal(shared.capEnd, true);
  assert.equal(right.capStart, true);
});

test("an opening-bearing source wins when a wall span is shared", () => {
  const walls = buildRenderedWalls([
    room("large", [{ x: 0, y: 0 }, { x: 1000, y: 0 }, { x: 1000, y: 1000 }, { x: 0, y: 1000 }]),
    room("attached", [{ x: 600, y: 0 }, { x: 800, y: 0 }, { x: 800, y: -300 }, { x: 600, y: -300 }], [{
      id: "door-1",
      kind: "DOOR",
      parent_wall_id: "wall-001",
      offset_mm: 25,
      width: measurement(100),
      height: measurement(2040),
      sill_height_mm: 0,
    }]),
  ]);

  const shared = walls.find((wall) => spanKey(wall.start, wall.end) === "600,0|800,0");
  assert.ok(shared);
  assert.equal(shared.room.id, "attached");
  assert.equal(shared.index, 0);
});
