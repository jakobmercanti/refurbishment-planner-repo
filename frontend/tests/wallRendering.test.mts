import assert from "node:assert/strict";
import test from "node:test";
import { buildRenderedWalls } from "../lib/wallRendering.ts";
import type { Room } from "../lib/types.ts";

const measurement = (value: number) => ({ value, uncertainty_mm: 0, verified: true, source_type: "TEST" });

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
