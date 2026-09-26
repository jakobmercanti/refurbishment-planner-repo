import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  FloorPlanFixtureDimensions,
  FloorPlanFixtureRoomSpacingDimensions,
} from "../components/FloorPlanFixtureDimensions";
import {
  constrainObstacleToRoom,
  DEFAULT_OBSTACLE_WALL_LOCK,
  obstacleFitsInRoom,
  obstacleFootprint,
  resolveObstaclePlacement,
} from "../lib/elementPlacement";
import type { Obstacle, Point2D, Room } from "../lib/types";

const measurement = (value: number) => ({ value, uncertainty_mm: 0, verified: false, source_type: "USER_MEASURED" });

function room(vertices: Point2D[], wallThickness = 100): Room {
  return {
    id: "test-room",
    name: "Test room",
    version: 1,
    vertices,
    wall_height: measurement(2700),
    wall_thickness: measurement(wallThickness),
    openings: [],
    obstacles: [],
  };
}

function fixture(center: Point2D = { x: 2500, y: 2000 }, options: { width?: number; depth?: number; rotation?: number; wallLock?: boolean } = {}): Obstacle {
  return {
    id: "test-fixture",
    name: "Table",
    kind: "BOX",
    center,
    dimensions: {
      width: measurement(options.width ?? 600),
      depth: measurement(options.depth ?? 400),
      height: measurement(750),
    },
    base_z_mm: 0,
    rotation_deg: options.rotation ?? 0,
    verified: false,
    wall_lock: options.wallLock,
  };
}

const rectangle = room([{ x: 0, y: 0 }, { x: 5000, y: 0 }, { x: 5000, y: 4000 }, { x: 0, y: 4000 }]);
const identity = (point: Point2D) => point;

test("new ordinary fittings default to free 2D movement", () => {
  assert.equal(DEFAULT_OBSTACLE_WALL_LOCK, false);
  const item = fixture(undefined, { wallLock: DEFAULT_OBSTACLE_WALL_LOCK });
  assert.equal(item.wall_lock, false);
});

test("free fittings can move left, right, up, down, and diagonally within room bounds", () => {
  const item = fixture({ x: 2000, y: 1500 });
  const destinations = [
    { x: 1500, y: 1500 },
    { x: 2500, y: 1500 },
    { x: 2000, y: 2000 },
    { x: 2000, y: 1000 },
    { x: 2300, y: 1300 },
  ];

  for (const destination of destinations) {
    const resolved = resolveObstaclePlacement(item, destination, [room(rectangle.vertices)], [], rectangle.id);
    assert.ok(resolved, `expected valid placement at ${destination.x},${destination.y}`);
    assert.deepEqual(resolved.obstacle.center, destination);
    assert.equal(obstacleFitsInRoom(resolved.obstacle, rectangle), true);
  }
});

test("enabling wall adjacency snaps to a valid wall, follows its tangent, and disabling preserves position", () => {
  const unlocked = fixture({ x: 2500, y: 2000 }, { wallLock: false });
  const locked = constrainObstacleToRoom({ ...unlocked, wall_lock: true }, rectangle, unlocked.center);
  assert.ok(locked);
  assert.equal(locked.wall_lock, true);
  assert.equal(obstacleFitsInRoom(locked, rectangle), true);
  const lowestFootprintY = Math.min(...obstacleFootprint(locked).map(point => point.y));
  assert.ok(Math.abs(lowestFootprintY - 51) < 1, `expected 51 mm wall-face clearance, got ${lowestFootprintY}`);

  const alongWall = constrainObstacleToRoom(locked, rectangle, { x: locked.center.x + 300, y: locked.center.y });
  assert.ok(alongWall);
  assert.ok(Math.abs(alongWall.center.x - (locked.center.x + 300)) < 1);
  assert.ok(Math.abs(alongWall.center.y - locked.center.y) < 1);

  const freeAgain = constrainObstacleToRoom({ ...alongWall, wall_lock: false }, rectangle, alongWall.center);
  assert.ok(freeAgain);
  assert.deepEqual(freeAgain.center, alongWall.center);
  assert.equal(freeAgain.rotation_deg, alongWall.rotation_deg);
  const movedFreely = resolveObstaclePlacement(freeAgain, { x: freeAgain.center.x - 100, y: freeAgain.center.y + 120 }, [rectangle], [], rectangle.id);
  assert.deepEqual(movedFreely?.obstacle.center, { x: freeAgain.center.x - 100, y: freeAgain.center.y + 120 });
});

function renderedDimensions(item: Obstacle, bounds: Point2D[]) {
  return renderToStaticMarkup(createElement("svg", null,
    createElement(FloorPlanFixtureDimensions, { obstacle: item, measurementId: item.id, toScreen: identity, displayUnits: "MM" }),
    createElement(FloorPlanFixtureRoomSpacingDimensions, { obstacle: item, roomVertices: bounds, toScreen: identity, displayUnits: "MM", viewportScale: 1 }),
  ));
}

test("selected object renders X and Y clearances and reuses its existing width/depth labels", () => {
  const item = fixture({ x: 2000, y: 1500 });
  const markup = renderedDimensions(item, rectangle.vertices);
  for (const label of ["X left clearance: 1700 mm", "X right clearance: 2700 mm", "Y top clearance: 2300 mm", "Y bottom clearance: 1300 mm", "X width: 600 mm", "Y depth: 400 mm"]) {
    assert.ok(markup.includes(label), `missing ${label}`);
  }
  assert.equal((markup.match(/X width: 600 mm/g) ?? []).length, 1);
  assert.equal((markup.match(/Y depth: 400 mm/g) ?? []).length, 1);
  assert.equal(markup.includes("X span:"), false);
  assert.equal(markup.includes("Y span:"), false);
});

test("wall-locked fittings retain their wall-relative X rail and can render only the room-relative Y chain", () => {
  const item = fixture({ x: 2000, y: 1500 }, { wallLock: true });
  const markup = renderToStaticMarkup(createElement("svg", null,
    createElement(FloorPlanFixtureRoomSpacingDimensions, { obstacle: item, roomVertices: rectangle.vertices, toScreen: identity, displayUnits: "MM", viewportScale: 1, axisFilter: ["Y"] }),
  ));
  assert.ok(markup.includes("Y top clearance:"));
  assert.ok(markup.includes("Y bottom clearance:"));
  assert.equal(markup.includes("X left clearance:"), false);
  assert.equal(markup.includes("X right clearance:"), false);
});

test("clearance dimensions respond to live X/Y movement", () => {
  const initial = renderedDimensions(fixture({ x: 2000, y: 1500 }), rectangle.vertices);
  const moved = renderedDimensions(fixture({ x: 2100, y: 1600 }), rectangle.vertices);
  assert.ok(initial.includes("X left clearance: 1700 mm"));
  assert.ok(initial.includes("Y top clearance: 2300 mm"));
  assert.ok(moved.includes("X left clearance: 1800 mm"));
  assert.ok(moved.includes("X right clearance: 2600 mm"));
  assert.ok(moved.includes("Y top clearance: 2200 mm"));
  assert.ok(moved.includes("Y bottom clearance: 1400 mm"));
});

test("rotated fitting clearances use its effective rotated footprint", () => {
  const item = fixture({ x: 2500, y: 2000 }, { rotation: 45 });
  const markup = renderedDimensions(item, rectangle.vertices);
  assert.ok(markup.includes("X left clearance: 2146 mm"));
  assert.ok(markup.includes("X right clearance: 2146 mm"));
  assert.ok(markup.includes("Y top clearance: 1646 mm"));
  assert.ok(markup.includes("Y bottom clearance: 1646 mm"));
  assert.ok(markup.includes("Y depth: 400 mm"));
});

test("Y clearances in an irregular room use the intersected room section, not the global bounding box", () => {
  const lShapedRoom = room([
    { x: 0, y: 0 }, { x: 5000, y: 0 }, { x: 5000, y: 2000 },
    { x: 3000, y: 2000 }, { x: 3000, y: 4000 }, { x: 0, y: 4000 },
  ]);
  const item = fixture({ x: 4000, y: 1000 });
  const markup = renderedDimensions(item, lShapedRoom.vertices);
  assert.ok(markup.includes("Y top clearance: 800 mm"));
  assert.ok(markup.includes("Y bottom clearance: 800 mm"));
  assert.equal(markup.includes("Y top clearance: 2800 mm"), false);
});
