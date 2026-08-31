import assert from "node:assert/strict";
import test from "node:test";
import { retainDraggedWallConnections, type WallDragWall } from "../lib/wallDragGeometry.ts";

const roomWall: WallDragWall = {
  id: "room-1",
  points: [
    { x: 0, y: 2480 },
    { x: 1760, y: 2480 },
    { x: 1760, y: 0 },
    { x: 0, y: 0 },
    { x: 0, y: 2480 },
  ],
};

test("creates a bridge when a dragged endpoint moves beyond its host wall", () => {
  const baseline: WallDragWall[] = [
    roomWall,
    {
      id: "selected-wall",
      points: [{ x: -2160, y: 2480 }, { x: 0, y: 2480 }],
      attachments: { 1: { wallId: "room-1", segmentIndex: 3, along: 1 } },
    },
  ];
  const candidate: WallDragWall[] = [
    roomWall,
    {
      ...baseline[1],
      points: [{ x: -2160, y: 3300 }, { x: 0, y: 3300 }],
    },
  ];

  const repaired = retainDraggedWallConnections(baseline, candidate, "selected-wall", 0);

  assert.equal(repaired.length, 3);
  assert.deepEqual(repaired[2].points, [{ x: 0, y: 2480 }, { x: 0, y: 3300 }]);
});

test("does not add a bridge while the dragged endpoint remains on its host segment", () => {
  const baseline: WallDragWall[] = [
    roomWall,
    {
      id: "selected-wall",
      points: [{ x: -2160, y: 1800 }, { x: 0, y: 1800 }],
      attachments: { 1: { wallId: "room-1", segmentIndex: 3, along: 0.73 } },
    },
  ];
  const candidate: WallDragWall[] = [
    roomWall,
    {
      ...baseline[1],
      points: [{ x: -2160, y: 2200 }, { x: 0, y: 2200 }],
    },
  ];

  const repaired = retainDraggedWallConnections(baseline, candidate, "selected-wall", 0);

  assert.equal(repaired.length, 2);
});

test("repairs the mirrored start endpoint", () => {
  const baseline: WallDragWall[] = [
    roomWall,
    {
      id: "selected-wall",
      points: [{ x: 0, y: 2480 }, { x: 2160, y: 2480 }],
      attachments: { 0: { wallId: "room-1", segmentIndex: 3, along: 1 } },
    },
  ];
  const candidate: WallDragWall[] = [
    roomWall,
    { ...baseline[1], points: [{ x: 0, y: 3300 }, { x: 2160, y: 3300 }] },
  ];

  const repaired = retainDraggedWallConnections(baseline, candidate, "selected-wall", 0);

  assert.equal(repaired.length, 3);
  assert.deepEqual(repaired[2].points, [{ x: 0, y: 2480 }, { x: 0, y: 3300 }]);
});

test("infers the connection for plans saved before endpoint attachments existed", () => {
  const baseline: WallDragWall[] = [
    roomWall,
    { id: "legacy-selected-wall", points: [{ x: -2160, y: 2480 }, { x: 0, y: 2480 }] },
  ];
  const candidate: WallDragWall[] = [
    roomWall,
    { id: "legacy-selected-wall", points: [{ x: -2160, y: 3300 }, { x: 0, y: 3300 }] },
  ];

  const repaired = retainDraggedWallConnections(baseline, candidate, "legacy-selected-wall", 0);

  assert.equal(repaired.length, 3);
  assert.deepEqual(repaired[2].points, [{ x: 0, y: 2480 }, { x: 0, y: 3300 }]);
});

test("updates one bridge throughout a drag instead of duplicating it", () => {
  const baseline: WallDragWall[] = [
    roomWall,
    {
      id: "selected-wall",
      points: [{ x: -2160, y: 2480 }, { x: 0, y: 2480 }],
      attachments: { 1: { wallId: "room-1", segmentIndex: 3, along: 1 } },
    },
  ];
  const firstFrame = retainDraggedWallConnections(baseline, [
    roomWall,
    { ...baseline[1], points: [{ x: -2160, y: 3000 }, { x: 0, y: 3000 }] },
  ], "selected-wall", 0);
  const nextFrame = retainDraggedWallConnections(baseline, [
    roomWall,
    { ...baseline[1], points: [{ x: -2160, y: 3400 }, { x: 0, y: 3400 }] },
    firstFrame[2],
  ], "selected-wall", 0);

  assert.equal(nextFrame.length, 3);
  assert.deepEqual(nextFrame[2].points, [{ x: 0, y: 2480 }, { x: 0, y: 3400 }]);
});
