import assert from "node:assert/strict";
import test from "node:test";
import { followWallAttachedFixtures } from "../lib/wallFixtureAttachment.ts";
import type { Obstacle } from "../lib/types.ts";

const measurement = (value: number) => ({ value, uncertainty_mm: 0, verified: true, source_type: "TEST" });

test("wall-mounted shower follows a wall when its length is entered numerically", () => {
  const walls = [{
    id: "room",
    points: [{ x: 0, y: 0 }, { x: 10801, y: 0 }, { x: 10801, y: 6226 }, { x: 0, y: 6226 }, { x: 0, y: 0 }],
  }];
  const resizedWalls = [{
    ...walls[0],
    points: [{ x: 0, y: 0 }, { x: 5000, y: 0 }, { x: 5000, y: 6226 }, { x: 0, y: 6226 }, { x: 0, y: 0 }],
  }];
  const shower: Obstacle = {
    id: "shower-1",
    name: "Shower",
    center: { x: 5400.5, y: 450 },
    dimensions: { width: measurement(900), depth: measurement(900), height: measurement(2100) },
    base_z_mm: 0,
    rotation_deg: 0,
    fixture_kind: "SHOWER",
    representation_key: "shower-walk-in",
    verified: false,
  };
  const furniture: Obstacle = {
    ...shower,
    id: "table-1",
    name: "Table",
    center: { x: 5000, y: 3000 },
    fixture_kind: "FURNITURE",
    representation_key: "furniture-table-rectangular",
  };

  const positioned = followWallAttachedFixtures([shower, furniture], walls, resizedWalls, () => 100);

  assert.ok(Math.abs(positioned[0].center.x - 2500) < 0.1);
  assert.equal(positioned[0].center.y, shower.center.y);
  assert.deepEqual(positioned[1], furniture, "free-standing furniture stays in place");
});
