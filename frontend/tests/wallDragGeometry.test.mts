import assert from "node:assert/strict";
import test from "node:test";
import { constrainSquaredCornerTarget, constrainTranslatedWallDistance, enforceWallLengthOverrides, enforceWallLengthOverridesPreservingOrthogonality, followTerminatingEndpointsOnTranslatedSegments, isPreciseWallJunction, materializeWallIntersections, materializeWallJunctionsForSelection, preserveUnrelatedParallelWallSegments, preserveUnrelatedWallGeometry, reanchorAttachedWallEndpoints, reanchorAutoWallBridges, retainDraggedWallConnections, separateParallelSegmentEndForDrag, separateParallelSegmentStartForDrag, translateHostSegmentWithDraggedEndpoint, translateIncidentWallRunsForCorner, translateStraightWallRunForCorner, type WallDragWall } from "../lib/wallDragGeometry.ts";

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

test("keeps an edited wall measurement authoritative and attached at a shared endpoint", () => {
  const candidate: WallDragWall[] = [
    { id: "room", points: [{ x: 0, y: 0 }, { x: 2000, y: 0 }, { x: 2000, y: 1000 }], lengthOverridesMm: { 0: 1800 } },
    { id: "branch", points: [{ x: 2000, y: 0 }, { x: 2000, y: 400 }] },
  ];

  const enforced = enforceWallLengthOverrides(candidate);
  assert.equal(Math.hypot(enforced[0].points[1].x - enforced[0].points[0].x, enforced[0].points[1].y - enforced[0].points[0].y), 1800);
  assert.deepEqual(enforced[1].points[0], enforced[0].points[1]);
  assert.deepEqual(enforced[0].lengthOverridesMm, { 0: 1800 });
});

test("repairs an attached endpoint even when it has already drifted from the locked wall", () => {
  const enforced = enforceWallLengthOverrides([
    { id: "host", points: [{ x: 0, y: 0 }, { x: 2000, y: 0 }], lengthOverridesMm: { 0: 1800 } },
    { id: "branch", points: [{ x: 2060, y: 0 }, { x: 2060, y: 400 }], attachments: { 0: { wallId: "host", segmentIndex: 0, along: 1 } } },
  ]);

  assert.deepEqual(enforced[1].points[0], enforced[0].points[1]);
});

test("enforces an edited closing segment without breaking a closed wall", () => {
  const enforced = enforceWallLengthOverrides([{
    id: "closed",
    points: [{ x: 0, y: 0 }, { x: 2000, y: 0 }, { x: 2000, y: 1000 }, { x: 0, y: 1000 }, { x: 0, y: 0 }],
    lengthOverridesMm: { 3: 800 },
  }]);

  const wall = enforced[0];
  assert.equal(Math.hypot(wall.points[0].x - wall.points[3].x, wall.points[0].y - wall.points[3].y), 800);
  assert.deepEqual(wall.points[0], wall.points.at(-1));
});

test("rejects locked-length edits that would incline a squared plan", () => {
  const candidate: WallDragWall[] = [{
    id: "room",
    points: [{ x: 0, y: 100 }, { x: 3000, y: 100 }, { x: 3000, y: 1800 }, { x: 0, y: 1800 }, { x: 0, y: 100 }],
    lengthOverridesMm: { 0: 2800, 1: 1800, 2: 2800, 3: 1800 },
  }];

  assert.equal(enforceWallLengthOverridesPreservingOrthogonality(candidate), null);
});

test("retains edited lengths when a straight run is separated for a drag", () => {
  const startSplit = separateParallelSegmentStartForDrag([{
    id: "run",
    points: [{ x: 0, y: 0 }, { x: 1000, y: 0 }, { x: 2000, y: 0 }],
    lengthOverridesMm: { 1: 750 },
  }], "run", 1);
  assert.deepEqual(startSplit.walls[0].lengthOverridesMm, { 2: 750 });

  const endSplit = separateParallelSegmentEndForDrag([{
    id: "run",
    points: [{ x: 0, y: 0 }, { x: 1000, y: 0 }, { x: 2000, y: 0 }],
    lengthOverridesMm: { 0: 750 },
  }], "run", 0);
  assert.deepEqual(endSplit.walls[0].lengthOverridesMm, { 0: 750 });
});

test("splits wall 3-2 at corner 5 and moves only selected wall 3-5", () => {
  const walls: WallDragWall[] = [
    { id: "room", points: [{ x: 0, y: 0 }, { x: 2400, y: 0 }, { x: 2400, y: 4080 }, { x: 0, y: 4080 }, { x: 0, y: 0 }], cornerNumbers: { 0: 1, 1: 2, 2: 3, 3: 4 } },
    { id: "outer", points: [{ x: 2400, y: 2660 }, { x: 3820, y: 2660 }], cornerNumbers: { 0: 5, 1: 6 }, attachments: { 0: { wallId: "room", segmentIndex: 1, along: 2660 / 4080 } } },
  ];

  const materialized = materializeWallJunctionsForSelection(walls, "room", 1, { x: 2400, y: 3500 });
  assert.equal(materialized.segmentIndex, 2);
  assert.deepEqual(materialized.walls[0].points, [{ x: 0, y: 0 }, { x: 2400, y: 0 }, { x: 2400, y: 2660 }, { x: 2400, y: 4080 }, { x: 0, y: 4080 }, { x: 0, y: 0 }]);
  assert.deepEqual(materialized.walls[0].cornerNumbers, { 0: 1, 1: 2, 2: 5, 3: 3, 4: 4 });
  assert.deepEqual(materialized.walls[1].cornerNumbers, { 0: 5, 1: 6 });
  assert.deepEqual(materialized.walls[1].attachments?.[0], { wallId: "room", segmentIndex: 2, along: 0 });

  const candidate = materialized.walls.map((wall) => wall.id !== "room" ? wall : {
    ...wall,
    points: wall.points.map((point, index) => index === 2 || index === 3 ? { x: point.x + 300, y: point.y } : point),
  });
  const followed = followTerminatingEndpointsOnTranslatedSegments(materialized.walls, candidate, "room");
  assert.deepEqual(followed.find((wall) => wall.id === "outer")?.points, [{ x: 2700, y: 2660 }, { x: 3820, y: 2660 }]);
});

test("separates a translated upper segment from its parallel lower segment", () => {
  const baseline: WallDragWall[] = [
    { id: "room", points: [{ x: 0, y: 0 }, { x: 2400, y: 0 }, { x: 2400, y: 1220 }, { x: 2400, y: 2480 }, { x: 0, y: 2480 }, { x: 0, y: 0 }], cornerNumbers: { 0: 1, 1: 2, 2: 5, 3: 3, 4: 4 } },
    { id: "side", points: [{ x: 2400, y: 1220 }, { x: 3500, y: 1220 }], cornerNumbers: { 0: 5, 1: 6 } },
  ];

  const separated = separateParallelSegmentStartForDrag(baseline, "room", 2);
  assert.equal(separated.segmentIndex, 3);
  assert.equal(separated.detachedPointIndex, 3);
  assert.deepEqual(separated.walls[0].points, [
    { x: 0, y: 0 }, { x: 2400, y: 0 }, { x: 2400, y: 1220 }, { x: 2400, y: 1220 },
    { x: 2400, y: 2480 }, { x: 0, y: 2480 }, { x: 0, y: 0 },
  ]);
  assert.equal(separated.walls[0].cornerNumbers?.[2], 7);
  assert.equal(separated.walls[0].cornerNumbers?.[3], 5);
  assert.equal(separated.walls[0].attachments?.[3]?.hideCorner, true);
});

test("separates a translated lower segment from its parallel upper segment", () => {
  const baseline: WallDragWall[] = [
    { id: "room", points: [{ x: 0, y: 0 }, { x: 2400, y: 0 }, { x: 2400, y: 1220 }, { x: 2400, y: 2480 }, { x: 0, y: 2480 }, { x: 0, y: 0 }], cornerNumbers: { 0: 1, 1: 2, 2: 5, 3: 3, 4: 4 } },
    { id: "side", points: [{ x: 2400, y: 1220 }, { x: 3500, y: 1220 }], cornerNumbers: { 0: 5, 1: 6 } },
  ];

  const separated = separateParallelSegmentEndForDrag(baseline, "room", 1);
  assert.equal(separated.segmentIndex, 1);
  assert.equal(separated.detachedEndPointIndex, 2);
  assert.deepEqual(separated.walls[0].points, [
    { x: 0, y: 0 }, { x: 2400, y: 0 }, { x: 2400, y: 1220 }, { x: 2400, y: 1220 },
    { x: 2400, y: 2480 }, { x: 0, y: 2480 }, { x: 0, y: 0 },
  ]);
  assert.equal(separated.walls[0].cornerNumbers?.[2], 5);
  assert.equal(separated.walls[0].cornerNumbers?.[3], 7);
  assert.equal(separated.walls[0].attachments?.[2]?.hideCorner, true);
});

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
  assert.equal(repaired[2].attachments?.[0]?.hideCorner, true);
});

test("shows a corner where a bridge joins the interior of another wall", () => {
  const baseline: WallDragWall[] = [
    { id: "host", points: [{ x: 0, y: 0 }, { x: 2400, y: 0 }] },
    { id: "moving", points: [{ x: 1200, y: 0 }, { x: 1200, y: 900 }], attachments: { 0: { wallId: "host", segmentIndex: 0, along: .5 } } },
  ];
  const candidate: WallDragWall[] = [
    baseline[0],
    { ...baseline[1], points: [{ x: 1200, y: 500 }, { x: 1200, y: 1400 }] },
  ];

  const repaired = retainDraggedWallConnections(baseline, candidate, "moving", 0);

  assert.equal(repaired.length, 3);
  assert.deepEqual(repaired[2].points, [{ x: 1200, y: 0 }, { x: 1200, y: 500 }]);
  assert.equal(repaired[2].attachments?.[0]?.hideCorner, false);
  assert.equal(repaired[2].attachments?.[1]?.hideCorner, true);
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

test("moves every coincident host run when an open corner drag is ambiguous", () => {
  const baseline: WallDragWall[] = [
    // An older plan can contain the same physical side as two stored runs.
    // The first run wins naive connection inference, but both hosts must
    // follow the dragged corner so no duplicate corner or detached wall is
    // manufactured.
    { id: "duplicate-side", points: [{ x: 2400, y: 0 }, { x: 2400, y: 1800 }] },
    { id: "room", points: [{ x: 0, y: 0 }, { x: 2400, y: 0 }, { x: 2400, y: 1800 }, { x: 0, y: 1800 }, { x: 0, y: 0 }] },
    { id: "outer", points: [{ x: 2400, y: 900 }, { x: 3600, y: 900 }] },
  ];
  const candidate: WallDragWall[] = [baseline[0], baseline[1], { ...baseline[2], points: [{ x: 3000, y: 900 }, { x: 3600, y: 900 }] }];
  const inferred = translateHostSegmentWithDraggedEndpoint(baseline, candidate, "outer", 0);
  const translated = translateIncidentWallRunsForCorner(baseline, inferred, "outer", 0);
  const repaired = retainDraggedWallConnections(baseline, translated, "outer", 0);

  assert.deepEqual(repaired.find((wall) => wall.id === "duplicate-side")?.points, [{ x: 3000, y: 0 }, { x: 3000, y: 1800 }]);
  assert.deepEqual(repaired.find((wall) => wall.id === "room")?.points.slice(1, 3), [{ x: 3000, y: 0 }, { x: 3000, y: 1800 }]);
  assert.equal(repaired.some((wall) => wall.id.startsWith("auto-wall-bridge:")), false);
});

test("recovers an attached corner during a fast diagonal pointer sample", () => {
  const baseline: WallDragWall[] = [
    { id: "room", points: [{ x: 0, y: 0 }, { x: 2400, y: 0 }, { x: 2400, y: 1800 }, { x: 0, y: 1800 }, { x: 0, y: 0 }] },
    { id: "outer", points: [{ x: 2400, y: 900 }, { x: 3600, y: 900 }] },
  ];
  // A fast pointer event can include a small tangential component. The old
  // strict normal-direction check rejects the host and creates a bridge.
  const candidate: WallDragWall[] = [baseline[0], { ...baseline[1], points: [{ x: 3000, y: 1020 }, { x: 3600, y: 900 }] }];
  const hostOnly = translateHostSegmentWithDraggedEndpoint(baseline, candidate, "outer", 0);
  const naive = retainDraggedWallConnections(baseline, hostOnly, "outer", 0);
  assert.ok(naive.some((wall) => wall.id.startsWith("auto-wall-bridge:")));

  const translated = translateIncidentWallRunsForCorner(baseline, hostOnly, "outer", 0);
  const repaired = retainDraggedWallConnections(baseline, translated, "outer", 0);
  assert.equal(repaired.some((wall) => wall.id.startsWith("auto-wall-bridge:")), false);
  assert.deepEqual(repaired.find((wall) => wall.id === "room")?.points.slice(1, 3), [{ x: 3000, y: 120 }, { x: 3000, y: 1920 }]);
  assert.deepEqual(repaired.find((wall) => wall.id === "outer")?.points[0], { x: 3000, y: 1020 });
});

test("materializes a visible corner when a dragged endpoint lands inside its host wall", () => {
  const baseline: WallDragWall[] = [
    { id: "host-wall", points: [{ x: 0, y: 0 }, { x: 2400, y: 0 }] },
    { id: "selected-wall", points: [{ x: 1200, y: -800 }, { x: 1200, y: 0 }], attachments: { 1: { wallId: "host-wall", segmentIndex: 0, along: .5 } } },
  ];
  const candidate: WallDragWall[] = [
    baseline[0],
    { ...baseline[1], points: [{ x: 900, y: -800 }, { x: 900, y: 0 }] },
  ];

  const repaired = retainDraggedWallConnections(baseline, candidate, "selected-wall", 0);

  assert.equal(repaired.length, 2);
  assert.deepEqual(repaired[0].points, [{ x: 0, y: 0 }, { x: 900, y: 0 }, { x: 2400, y: 0 }]);
  assert.deepEqual(repaired[1].points, candidate[1].points);
});

test("does not add an overlapping bridge when a moved stacked-room endpoint stays on the host wall", () => {
  const baseline: WallDragWall[] = [
    { id: "lower-room", points: [{ x: 0, y: 0 }, { x: 2400, y: 0 }, { x: 2400, y: 1800 }, { x: 0, y: 1800 }, { x: 0, y: 0 }], cornerNumbers: { 0: 1, 1: 2, 2: 3, 3: 4 } },
    { id: "upper-room", points: [{ x: 0, y: 1800 }, { x: 0, y: 2100 }, { x: 2400, y: 2100 }, { x: 2400, y: 1800 }], cornerNumbers: { 0: 4, 1: 5, 2: 6, 3: 3 }, attachments: { 0: { wallId: "lower-room", segmentIndex: 3, along: 0 }, 3: { wallId: "lower-room", segmentIndex: 1, along: 1 } } },
  ];
  const moved: WallDragWall[] = [
    baseline[0],
    { ...baseline[1], points: [{ x: 300, y: 1800 }, { x: 300, y: 2100 }, { x: 2400, y: 2100 }, { x: 2400, y: 1800 }] },
  ];

  const repaired = retainDraggedWallConnections(baseline, moved, "upper-room", 0);
  assert.equal(repaired.filter((wall) => wall.id.startsWith("auto-wall-bridge:")).length, 0);
  const materialized = materializeWallIntersections(repaired);
  assert.ok(materialized.find((wall) => wall.id === "lower-room")?.points.some((point) => Math.abs(point.x - 300) < 0.001 && Math.abs(point.y - 1800) < 0.001));
});

test("reveals a previously hidden stacked-room endpoint when it moves into the host wall", () => {
  const baseline: WallDragWall[] = [
    { id: "lower-room", points: [{ x: 0, y: 0 }, { x: 2400, y: 0 }, { x: 2400, y: 1800 }, { x: 0, y: 1800 }, { x: 0, y: 0 }], cornerNumbers: { 0: 1, 1: 2, 2: 3, 3: 4 } },
    { id: "upper-room", points: [{ x: 0, y: 1800 }, { x: 0, y: 2550 }, { x: 2400, y: 2550 }, { x: 2400, y: 1800 }], cornerNumbers: { 0: 4, 1: 5, 2: 6, 3: 3 }, attachments: { 0: { wallId: "lower-room", segmentIndex: 3, along: 0, hideCorner: true }, 3: { wallId: "lower-room", segmentIndex: 1, along: 1, hideCorner: true } } },
  ];
  const moved: WallDragWall[] = [
    baseline[0],
    { ...baseline[1], points: [{ x: 300, y: 1800 }, { x: 300, y: 2550 }, { x: 2400, y: 2550 }, { x: 2400, y: 1800 }] },
  ];

  const repaired = retainDraggedWallConnections(baseline, moved, "upper-room", 0);
  assert.equal(repaired.some((wall) => wall.id.startsWith("auto-wall-bridge:")), false);
  const materialized = materializeWallIntersections(repaired);
  const upper = materialized.find((wall) => wall.id === "upper-room")!;
  const lower = materialized.find((wall) => wall.id === "lower-room")!;
  assert.equal(upper.attachments?.[0]?.hideCorner, false);
  assert.ok(lower.points.some((point) => Math.abs(point.x - 300) < 0.001 && Math.abs(point.y - 1800) < 0.001));
});

test("keeps a closed host wall closed when an interior junction is materialized", () => {
  const baseline: WallDragWall[] = [
    { id: "host-room", points: [{ x: 0, y: 0 }, { x: 2400, y: 0 }, { x: 2400, y: 1800 }, { x: 0, y: 1800 }, { x: 0, y: 0 }] },
    { id: "selected-wall", points: [{ x: 1200, y: -800 }, { x: 1200, y: 0 }], attachments: { 1: { wallId: "host-room", segmentIndex: 0, along: .5 } } },
  ];
  const candidate: WallDragWall[] = [
    baseline[0],
    { ...baseline[1], points: [{ x: 900, y: -800 }, { x: 900, y: 0 }] },
  ];

  const repaired = retainDraggedWallConnections(baseline, candidate, "selected-wall", 0);

  assert.deepEqual(repaired[0].points, [{ x: 0, y: 0 }, { x: 900, y: 0 }, { x: 2400, y: 0 }, { x: 2400, y: 1800 }, { x: 0, y: 1800 }, { x: 0, y: 0 }]);
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

test("bridges an adjoining terminating wall when a room side is translated", () => {
  const baseline: WallDragWall[] = [
    {
      id: "room-1",
      points: [{ x: 0, y: 0 }, { x: 2400, y: 0 }, { x: 2400, y: 1800 }, { x: 0, y: 1800 }, { x: 0, y: 0 }],
    },
    { id: "adjoining-wall", points: [{ x: 0, y: 0 }, { x: 0, y: -700 }] },
  ];
  const candidate: WallDragWall[] = [
    {
      ...baseline[0],
      points: [{ x: 500, y: 0 }, { x: 2400, y: 0 }, { x: 2400, y: 1800 }, { x: 500, y: 1800 }, { x: 500, y: 0 }],
    },
    baseline[1],
  ];

  const repaired = retainDraggedWallConnections(baseline, candidate, "room-1", 3);

  assert.equal(repaired.length, 3);
  assert.deepEqual(repaired[2].points, [{ x: 0, y: 0 }, { x: 500, y: 0 }]);
  assert.equal(repaired[2].attachments?.[0]?.hideCorner, true);
});

test("retains both side-room walls when the bottom wall is raised past their junctions", () => {
  const baseline: WallDragWall[] = [
    {
      id: "room-1",
      points: [{ x: 0, y: 0 }, { x: 2400, y: 0 }, { x: 2400, y: 2480 }, { x: 0, y: 2480 }, { x: 0, y: 0 }],
    },
    { id: "left-room", points: [{ x: -1160, y: 1220 }, { x: 0, y: 1220 }] },
    { id: "right-room", points: [{ x: 2400, y: 1220 }, { x: 3560, y: 1220 }] },
  ];
  const candidate: WallDragWall[] = [
    { ...baseline[0], points: [{ x: 0, y: 1300 }, { x: 2400, y: 1300 }, { x: 2400, y: 2480 }, { x: 0, y: 2480 }, { x: 0, y: 1300 }] },
    baseline[1],
    baseline[2],
  ];

  const repaired = retainDraggedWallConnections(baseline, candidate, "room-1", 0);

  assert.equal(repaired.length, 5);
  assert.ok(repaired.some((wall) => JSON.stringify(wall.points) === JSON.stringify([{ x: 0, y: 1300 }, { x: 0, y: 1220 }])));
  assert.ok(repaired.some((wall) => JSON.stringify(wall.points) === JSON.stringify([{ x: 2400, y: 1300 }, { x: 2400, y: 1220 }])));
  assert.ok(repaired.filter((wall) => wall.id.startsWith("auto-wall-bridge")).every((wall) => wall.attachments?.[1]?.hideCorner === true));
});

test("retains both side-room walls when the top wall is lowered past their junctions", () => {
  const baseline: WallDragWall[] = [
    {
      id: "room-1",
      points: [{ x: 0, y: 0 }, { x: 2400, y: 0 }, { x: 2400, y: 2480 }, { x: 0, y: 2480 }, { x: 0, y: 0 }],
    },
    { id: "left-room", points: [{ x: -1160, y: 1220 }, { x: 0, y: 1220 }] },
    { id: "right-room", points: [{ x: 2400, y: 1220 }, { x: 3560, y: 1220 }] },
  ];
  const candidate: WallDragWall[] = [
    { ...baseline[0], points: [{ x: 0, y: 0 }, { x: 2400, y: 0 }, { x: 2400, y: 1100 }, { x: 0, y: 1100 }, { x: 0, y: 0 }] },
    baseline[1],
    baseline[2],
  ];

  const repaired = retainDraggedWallConnections(baseline, candidate, "room-1", 2);

  assert.equal(repaired.length, 5);
  assert.ok(repaired.some((wall) => JSON.stringify(wall.points) === JSON.stringify([{ x: 2400, y: 1100 }, { x: 2400, y: 1220 }])));
  assert.ok(repaired.some((wall) => JSON.stringify(wall.points) === JSON.stringify([{ x: 0, y: 1100 }, { x: 0, y: 1220 }])));
});

test("moves a terminating wall endpoint with a room side translated by a corner drag", () => {
  const baseline: WallDragWall[] = [
    {
      id: "room-1",
      points: [{ x: 0, y: 0 }, { x: 2400, y: 0 }, { x: 2400, y: 1800 }, { x: 0, y: 1800 }, { x: 0, y: 0 }],
    },
    { id: "adjoining-wall", points: [{ x: -660, y: 900 }, { x: 0, y: 900 }] },
  ];
  const candidate: WallDragWall[] = [
    {
      ...baseline[0],
      points: [{ x: 720, y: 0 }, { x: 2400, y: 0 }, { x: 2400, y: 1800 }, { x: 720, y: 1800 }, { x: 720, y: 0 }],
    },
    baseline[1],
  ];

  const followed = followTerminatingEndpointsOnTranslatedSegments(baseline, candidate, "room-1");
  const repaired = retainDraggedWallConnections(baseline, followed, "room-1", 3);

  assert.equal(repaired.length, 2);
  assert.deepEqual(repaired[1].points, [{ x: -660, y: 900 }, { x: 720, y: 900 }]);
  assert.deepEqual(repaired[1].attachments?.[1], { wallId: "room-1", segmentIndex: 3, along: .5 });
});

test("does not treat a nearby, separate wall as a dragged-wall junction", () => {
  const hostStart = { x: 0, y: 0 };
  const hostEnd = { x: 2400, y: 0 };

  assert.equal(isPreciseWallJunction({ x: 1200, y: 4 }, hostStart, hostEnd), true);
  assert.equal(isPreciseWallJunction({ x: 1200, y: 160 }, hostStart, hostEnd), false);
  assert.equal(isPreciseWallJunction({ x: 2404, y: 0 }, hostStart, hostEnd), true);
});

test("keeps the 200 mm penetration clearance when a horizontal side is translated", () => {
  const walls: WallDragWall[] = [
    { id: "moving", points: [{ x: 0, y: 0 }, { x: 2400, y: 0 }] },
    { id: "blocking", points: [{ x: 200, y: 700 }, { x: 2200, y: 700 }] },
  ];

  assert.equal(constrainTranslatedWallDistance(walls, "moving", 0, 800, 200), 500);
});

test("keeps the 200 mm penetration clearance when a vertical side is translated", () => {
  const walls: WallDragWall[] = [
    { id: "moving", points: [{ x: 0, y: 0 }, { x: 0, y: 2400 }] },
    { id: "blocking", points: [{ x: 700, y: 200 }, { x: 700, y: 2200 }] },
  ];

  assert.equal(constrainTranslatedWallDistance(walls, "moving", 0, -800, 200), -500);
});

test("moves a host wall with a perpendicular terminating endpoint instead of creating a bridge", () => {
  const baseline: WallDragWall[] = [
    { id: "room", points: [{ x: 0, y: 0 }, { x: 2400, y: 0 }, { x: 2400, y: 1800 }, { x: 0, y: 1800 }, { x: 0, y: 0 }] },
    { id: "adjoining", points: [{ x: 2400, y: 900 }, { x: 3600, y: 900 }], attachments: { 0: { wallId: "room", segmentIndex: 1, along: .5 } } },
  ];
  const candidate: WallDragWall[] = [
    baseline[0],
    { ...baseline[1], points: [{ x: 3000, y: 900 }, { x: 3600, y: 900 }] },
  ];

  const translated = translateHostSegmentWithDraggedEndpoint(baseline, candidate, "adjoining", 0);
  const repaired = retainDraggedWallConnections(baseline, translated, "adjoining", 0);

  assert.deepEqual(translated[0].points, [{ x: 0, y: 0 }, { x: 3000, y: 0 }, { x: 3000, y: 1800 }, { x: 0, y: 1800 }, { x: 0, y: 0 }]);
  assert.equal(repaired.length, 2);
});

test("moves a materialized straight host run when its branch endpoint is dragged", () => {
  const baseline: WallDragWall[] = [
    { id: "room", points: [{ x: 0, y: 0 }, { x: 2400, y: 0 }, { x: 2400, y: 900 }, { x: 2400, y: 1800 }, { x: 0, y: 1800 }, { x: 0, y: 0 }] },
    { id: "branch", points: [{ x: 2400, y: 900 }, { x: 3500, y: 900 }], attachments: { 0: { wallId: "room", segmentIndex: 1, along: 1 } } },
  ];
  const candidate: WallDragWall[] = [
    baseline[0],
    { ...baseline[1], points: [{ x: 3000, y: 900 }, { x: 3500, y: 900 }] },
  ];

  const translated = translateHostSegmentWithDraggedEndpoint(baseline, candidate, "branch", 0);

  assert.deepEqual(translated[0].points, [{ x: 0, y: 0 }, { x: 3000, y: 0 }, { x: 3000, y: 900 }, { x: 3000, y: 1800 }, { x: 0, y: 1800 }, { x: 0, y: 0 }]);
  assert.deepEqual(translated[1].points, candidate[1].points);
});

test("keeps a separate host run fixed when a closed room corner is dragged", () => {
  const baseline: WallDragWall[] = [
    { id: "room", points: [{ x: 0, y: 0 }, { x: 2400, y: 0 }, { x: 2400, y: 1800 }, { x: 0, y: 1800 }, { x: 0, y: 0 }] },
    { id: "host", points: [{ x: 2400, y: 900 }, { x: 2400, y: 2700 }] },
  ];
  const candidate: WallDragWall[] = [
    { ...baseline[0], points: [{ x: 0, y: 0 }, { x: 3000, y: 0 }, { x: 3000, y: 1800 }, { x: 0, y: 1800 }, { x: 0, y: 0 }] },
    baseline[1],
  ];

  const translated = translateHostSegmentWithDraggedEndpoint(baseline, candidate, "room", 2);
  const repaired = retainDraggedWallConnections(baseline, translated, "room", 1);

  assert.deepEqual(translated[1].points, baseline[1].points);
  assert.deepEqual(repaired[1].points, baseline[1].points);
  assert.equal(repaired.some((wall) => wall.id.startsWith("auto-wall-bridge:room:1:2:host:0")), true);
});

test("keeps an unrelated lower parallel wall fixed during a shared wall drag", () => {
  const baseline: WallDragWall[] = [
    { id: "room-1", points: [{ x: 0, y: 1800 }, { x: 800, y: 1800 }, { x: 2300, y: 1800 }, { x: 2300, y: 0 }, { x: 0, y: 0 }, { x: 0, y: 1800 }] },
    { id: "room-2", points: [{ x: 0, y: 1800 }, { x: 800, y: 1800 }, { x: 800, y: 3000 }, { x: -1200, y: 3000 }, { x: -1200, y: 1200 }, { x: 0, y: 1200 }, { x: 0, y: 1800 }] },
  ];
  const candidate: WallDragWall[] = [
    baseline[0],
    { ...baseline[1], points: baseline[1].points.map((point, index) => index === 0 || index === 1 || index === 4 || index === 5 ? { x: point.x, y: point.y + 600 } : { ...point }) },
  ];

  const preserved = preserveUnrelatedParallelWallSegments(baseline, candidate, "room-1", 0);

  assert.deepEqual(preserved[1].points[0], { x: 0, y: 2400 });
  assert.deepEqual(preserved[1].points[1], { x: 800, y: 2400 });
  assert.deepEqual(preserved[1].points[4], baseline[1].points[4]);
  assert.deepEqual(preserved[1].points[5], baseline[1].points[5]);
});

test("keeps an unrelated parallel side fixed on the selected closed wall", () => {
  const baseline: WallDragWall[] = [
    { id: "room-2", points: [{ x: 0, y: 0 }, { x: 0, y: 1000 }, { x: -1000, y: 1000 }, { x: -1000, y: -1000 }, { x: 1000, y: -1000 }, { x: 1000, y: 0 }, { x: 0, y: 0 }] },
  ];
  const candidate: WallDragWall[] = [
    { ...baseline[0], points: baseline[0].points.map((point, index) => index === 0 || index === 5 || index === 6 || index === 1 || index === 2 ? { x: point.x, y: point.y - 600 } : { ...point }) },
  ];

  const preserved = preserveUnrelatedParallelWallSegments(baseline, candidate, "room-2", 5);

  assert.deepEqual(preserved[0].points[5], { x: 1000, y: -600 });
  assert.deepEqual(preserved[0].points[0], { x: 0, y: -600 });
  assert.deepEqual(preserved[0].points[1], baseline[0].points[1]);
  assert.deepEqual(preserved[0].points[2], baseline[0].points[2]);
  assert.deepEqual(preserved[0].points.at(-1), { x: 0, y: -600 });
});

test("keeps wall 5-11 fixed when wall 1-2 moves and retains the new 3-12 bridge", () => {
  const baseline: WallDragWall[] = [
    { id: "room-1", points: [{ x: 0, y: 0 }, { x: 2400, y: 0 }, { x: 2400, y: 2040 }, { x: 0, y: 2040 }, { x: 0, y: 0 }] },
    { id: "wall-5-11", points: [{ x: 3200, y: 500 }, { x: 3200, y: 1400 }] },
  ];
  const moved: WallDragWall[] = [
    { ...baseline[0], points: [{ x: 0, y: 240 }, { x: 2400, y: 240 }, { x: 2400, y: 2040 }, { x: 0, y: 2040 }, { x: 0, y: 240 }] },
    { id: "wall-5-11", points: [{ x: 3200, y: 740 }, { x: 3200, y: 1190 }, { x: 3200, y: 1640 }] },
    { id: "auto-wall-bridge:room-1:0:3:wall-5-11:0", points: [{ x: 1200, y: 240 }, { x: 1200, y: 500 }], attachments: { 0: { wallId: "room-1", segmentIndex: 0, along: .5 }, 1: { wallId: "wall-5-11", segmentIndex: 0, along: 0 } } },
  ];

  const isolated = preserveUnrelatedWallGeometry(baseline, moved, "room-1", 0);

  assert.deepEqual(isolated.find((wall) => wall.id === "wall-5-11")?.points, baseline[1].points);
  assert.ok(isolated.some((wall) => wall.id.startsWith("auto-wall-bridge:room-1:0:")));
});

test("preserves an explicitly attached endpoint while restoring unrelated points on the same wall", () => {
  const baseline: WallDragWall[] = [
    { id: "room", points: [{ x: 0, y: 0 }, { x: 2400, y: 0 }] },
    { id: "attached", points: [{ x: 1200, y: 0 }, { x: 1200, y: 900 }, { x: 1800, y: 900 }], attachments: { 0: { wallId: "room", segmentIndex: 0, along: .5 } } },
  ];
  const candidate: WallDragWall[] = [
    baseline[0],
    { ...baseline[1], points: [{ x: 1200, y: 150 }, { x: 1200, y: 1050 }, { x: 1800, y: 1050 }] },
  ];

  const isolated = preserveUnrelatedWallGeometry(baseline, candidate, "room", 0);

  assert.deepEqual(isolated.find((wall) => wall.id === "attached")?.points, [{ x: 1200, y: 150 }, { x: 1200, y: 900 }, { x: 1800, y: 900 }]);
});

test("keeps closed rooms joined when a shared wall is translated", () => {
  const baseline: WallDragWall[] = [
    { id: "room-1", points: [{ x: 0, y: 0 }, { x: 2580, y: 0 }, { x: 2580, y: 1640 }, { x: 0, y: 1640 }, { x: 0, y: 0 }] },
    { id: "room-2", points: [{ x: 0, y: 1640 }, { x: 2580, y: 1640 }, { x: 5100, y: 1640 }, { x: 5100, y: 2740 }, { x: 0, y: 2740 }, { x: 0, y: 1640 }] },
    { id: "room-3", points: [{ x: 2580, y: 0 }, { x: 5100, y: 0 }, { x: 5100, y: 1640 }, { x: 2580, y: 1640 }, { x: 2580, y: 0 }] },
  ];
  const moved: WallDragWall[] = [
    { ...baseline[0], points: [{ x: 0, y: 0 }, { x: 2120, y: 0 }, { x: 2120, y: 1640 }, { x: 0, y: 1640 }, { x: 0, y: 0 }] },
    { ...baseline[1], points: [{ x: 0, y: 1640 }, { x: 2120, y: 1640 }, { x: 5100, y: 1640 }, { x: 5100, y: 2740 }, { x: 0, y: 2740 }, { x: 0, y: 1640 }] },
    { ...baseline[2], points: [{ x: 2120, y: 0 }, { x: 5100, y: 0 }, { x: 5100, y: 1640 }, { x: 2120, y: 1640 }, { x: 2120, y: 0 }] },
  ];

  const isolated = preserveUnrelatedWallGeometry(baseline, moved, "room-1", 1);

  assert.deepEqual(isolated.find((wall) => wall.id === "room-2")?.points[1], { x: 2120, y: 1640 });
  assert.deepEqual(isolated.find((wall) => wall.id === "room-3")?.points.slice(0, 4), [
    { x: 2120, y: 0 }, { x: 5100, y: 0 }, { x: 5100, y: 1640 }, { x: 2120, y: 1640 },
  ]);
  isolated.forEach((wall) => assert.deepEqual(wall.points[0], wall.points.at(-1)));
});

test("moves a closed host side instead of creating a wall stub for an interior corner", () => {
  const baseline: WallDragWall[] = [
    { id: "outer-room", points: [{ x: -1000, y: 0 }, { x: 3000, y: 0 }, { x: 3000, y: 3000 }, { x: 0, y: 3000 }, { x: 0, y: 1500 }, { x: -1000, y: 1500 }, { x: -1000, y: 0 }] },
    { id: "room-1", points: [{ x: 0, y: 0 }, { x: 2000, y: 0 }, { x: 2000, y: 3000 }, { x: 0, y: 3000 }, { x: 0, y: 0 }] },
  ];
  const candidate: WallDragWall[] = [
    { ...baseline[0], points: baseline[0].points.map((point, index) => index === 4 ? { x: 500, y: 1500 } : { ...point }) },
    baseline[1],
  ];

  const translated = translateHostSegmentWithDraggedEndpoint(baseline, candidate, "outer-room", 4);
  const repaired = retainDraggedWallConnections(baseline, translated, "outer-room", 4);

  assert.deepEqual(translated[1].points.slice(0, 4), [{ x: 500, y: 0 }, { x: 2000, y: 0 }, { x: 2000, y: 3000 }, { x: 500, y: 3000 }]);
  assert.equal(repaired.some((wall) => wall.id.startsWith("auto-wall-bridge:outer-room:4:")), false);
});

test("translates the full perpendicular branch when an interior junction corner is dragged", () => {
  const baseline: WallDragWall[] = [
    // The outer outline contains the 5-6 branch. Corner 5 is also in the
    // interior of the right side of the closed room below.
    { id: "outer-outline", points: [{ x: 0, y: 0 }, { x: 5000, y: 0 }, { x: 5000, y: 2400 }, { x: 3800, y: 2400 }, { x: 3800, y: 1400 }, { x: 1500, y: 1400 }, { x: 1500, y: 2400 }, { x: 0, y: 2400 }, { x: 0, y: 0 }] },
    { id: "room-3", points: [{ x: 1500, y: 4200 }, { x: 3800, y: 4200 }, { x: 3800, y: 1400 }, { x: 1500, y: 1400 }, { x: 1500, y: 4200 }] },
  ];
  const candidate: WallDragWall[] = [
    { ...baseline[0], points: baseline[0].points.map((point, index) => index === 3 ? { x: 4300, y: 2400 } : { ...point }) },
    baseline[1],
  ];

  const translated = translateHostSegmentWithDraggedEndpoint(baseline, candidate, "outer-outline", 3);
  const repaired = retainDraggedWallConnections(baseline, translated, "outer-outline", 3);
  const outer = repaired.find((wall) => wall.id === "outer-outline");

  assert.deepEqual(outer?.points[2], { x: 5500, y: 2400 });
  assert.deepEqual(outer?.points[3], { x: 4300, y: 2400 });
  assert.equal(Math.hypot(outer!.points[3].x - outer!.points[2].x, outer!.points[3].y - outer!.points[2].y), 1200);
  assert.equal(repaired.some((wall) => wall.id.startsWith("auto-wall-bridge:outer-outline:3:")), false);
});

test("translates both endpoints of an open branch attached to a closed room", () => {
  const baseline: WallDragWall[] = [
    { id: "room", points: [{ x: 0, y: 0 }, { x: 3800, y: 0 }, { x: 3800, y: 4200 }, { x: 0, y: 4200 }, { x: 0, y: 0 }] },
    { id: "wall-5-6", points: [{ x: 3800, y: 2400 }, { x: 5000, y: 2400 }], attachments: { 0: { wallId: "room", segmentIndex: 1, along: 2400 / 4200 } } },
  ];
  const candidate: WallDragWall[] = [
    baseline[0],
    { ...baseline[1], points: [{ x: 4300, y: 2400 }, { x: 5000, y: 2400 }] },
  ];

  const translated = translateHostSegmentWithDraggedEndpoint(baseline, candidate, "wall-5-6", 0);
  const repaired = retainDraggedWallConnections(baseline, translated, "wall-5-6", 0);

  assert.deepEqual(repaired.find((wall) => wall.id === "wall-5-6")?.points, [{ x: 4300, y: 2400 }, { x: 5500, y: 2400 }]);
  assert.equal(repaired.find((wall) => wall.id === "room")?.points[1].x, 4300);
  assert.equal(repaired.find((wall) => wall.id === "room")?.points[2].x, 4300);
  assert.equal(repaired.some((wall) => wall.id.startsWith("auto-wall-bridge:wall-5-6:0:")), false);

  // The first drag materializes a hidden host vertex at the junction. A
  // subsequent drag must keep treating that vertex as movable, not revert to
  // shortening the branch or add another connector.
  const secondCandidate: WallDragWall[] = [
    repaired[0],
    { ...repaired[1], points: [{ x: 4600, y: 2400 }, { x: 5500, y: 2400 }] },
  ];
  const secondTranslated = translateHostSegmentWithDraggedEndpoint(repaired, secondCandidate, "wall-5-6", 0);
  const secondRepaired = retainDraggedWallConnections(repaired, secondTranslated, "wall-5-6", 0);
  assert.deepEqual(secondRepaired.find((wall) => wall.id === "wall-5-6")?.points, [{ x: 4600, y: 2400 }, { x: 5800, y: 2400 }]);
  assert.equal(secondRepaired.some((wall) => wall.id.startsWith("auto-wall-bridge:wall-5-6:0:")), false);
});

test("bridges a moved corner run back to an interior room side", () => {
  const baseline: WallDragWall[] = [
    { id: "room-1", points: [{ x: 0, y: 0 }, { x: 2400, y: 0 }, { x: 2400, y: 1800 }, { x: 0, y: 1800 }, { x: 0, y: 0 }] },
    // The 5 point is an interior junction on room-1's left side; 6 is the
    // corner being dragged down on the surrounding closed outline.
    { id: "room-2", points: [{ x: -1200, y: -1800 }, { x: 1200, y: -1800 }, { x: 1200, y: 0 }, { x: 0, y: 0 }, { x: 0, y: 700 }, { x: -1200, y: 700 }, { x: -1200, y: -1800 }] },
  ];
  const candidate: WallDragWall[] = [
    baseline[0],
    { ...baseline[1], points: [{ x: -1200, y: -1800 }, { x: 1200, y: -1800 }, { x: 1200, y: 0 }, { x: 0, y: 0 }, { x: 0, y: 2200 }, { x: -1200, y: 2200 }, { x: -1200, y: -1800 }] },
  ];

  const repaired = retainDraggedWallConnections(baseline, candidate, "room-2", 5);
  const bridge = repaired.find((wall) => wall.id.startsWith("auto-wall-bridge:room-2:5:point:4:room-1:"));

  assert.ok(bridge);
  assert.deepEqual(bridge.points, [{ x: 0, y: 1800 }, { x: 0, y: 2200 }]);
  assert.equal(bridge.attachments?.[0]?.wallId, "room-1");
  assert.equal(bridge.attachments?.[1]?.wallId, "room-2");
});

test("moves the host wall when an attached corner carries a stale segment index", () => {
  const baseline: WallDragWall[] = [
    { id: "room-1", points: [{ x: 0, y: 1800 }, { x: 2400, y: 1800 }, { x: 2400, y: 0 }, { x: 0, y: 0 }, { x: 0, y: 1800 }] },
    {
      id: "outer-run",
      points: [{ x: 3600, y: 700 }, { x: 2400, y: 700 }],
      // Segment 0 is deliberately stale: corner 9 is on room-1 segment 1.
      attachments: { 1: { wallId: "room-1", segmentIndex: 0, along: .5 } },
    },
  ];
  const candidate: WallDragWall[] = [
    baseline[0],
    { ...baseline[1], points: [{ x: 3600, y: 700 }, { x: 3200, y: 700 }] },
  ];

  const translated = translateHostSegmentWithDraggedEndpoint(baseline, candidate, "outer-run", 1);
  const repaired = retainDraggedWallConnections(baseline, translated, "outer-run", 1);

  assert.deepEqual(translated[0].points, [{ x: 0, y: 1800 }, { x: 3200, y: 1800 }, { x: 3200, y: 0 }, { x: 0, y: 0 }, { x: 0, y: 1800 }]);
  assert.equal(repaired.some((wall) => wall.id.startsWith("auto-wall-bridge:outer-run:1:")), false);
});

test("moves an attached room side without translating the preceding leg of a polyline", () => {
  const baseline: WallDragWall[] = [
    { id: "room-1", points: [{ x: 0, y: 1800 }, { x: 2400, y: 1800 }, { x: 2400, y: 0 }, { x: 0, y: 0 }, { x: 0, y: 1800 }] },
    {
      // The selected endpoint is corner 9. The preceding 7–8 leg is a real
      // perpendicular wall and must stay put while the 2–3 room side follows
      // the dragged junction.
      id: "outer-polyline",
      points: [{ x: 0, y: 1800 }, { x: 1000, y: 1800 }, { x: 1000, y: 2700 }, { x: 3000, y: 2700 }, { x: 3000, y: 900 }, { x: 2400, y: 900 }],
      attachments: { 5: { wallId: "room-1", segmentIndex: 1, along: .5 } },
    },
  ];
  const candidate: WallDragWall[] = [
    baseline[0],
    { ...baseline[1], points: baseline[1].points.map((point, index) => index === 5 ? { x: 2800, y: 900 } : { ...point }) },
  ];

  const translated = translateHostSegmentWithDraggedEndpoint(baseline, candidate, "outer-polyline", 5);
  const repaired = retainDraggedWallConnections(baseline, translated, "outer-polyline", 4);
  const room = repaired.find((wall) => wall.id === "room-1");
  const outer = repaired.find((wall) => wall.id === "outer-polyline");

  assert.equal(room?.points.length, baseline[0].points.length);
  assert.deepEqual(room?.points.slice(0, 3), [{ x: 0, y: 1800 }, { x: 2800, y: 1800 }, { x: 2800, y: 0 }]);
  assert.deepEqual(outer?.points[4], { x: 3000, y: 900 });
  assert.deepEqual(outer?.points[5], { x: 2800, y: 900 });
  assert.equal(repaired.some((wall) => wall.id.startsWith("auto-wall-bridge:outer-polyline:4:")), false);
});

test("keeps every preceding leg fixed when corner 10 is dragged on a complete outline", () => {
  const baseline: WallDragWall[] = [
    { id: "room-1", points: [{ x: 0, y: 0 }, { x: 2400, y: 0 }, { x: 2400, y: 1800 }, { x: 0, y: 1800 }, { x: 0, y: 0 }] },
    {
      // This is the complete 3–5–6–7–8–9–10 outline from the reported
      // reproduction. Corner 10 terminates on the room's left side; the
      // 8–9 leg must stay where it was when 10 is dragged right.
      id: "outer-outline",
      points: [{ x: 2400, y: 1800 }, { x: 2400, y: 900 }, { x: 3400, y: 900 }, { x: 3400, y: 1800 }, { x: -800, y: 1800 }, { x: -800, y: 900 }, { x: 0, y: 900 }],
      attachments: { 6: { wallId: "room-1", segmentIndex: 3, along: .5 } },
    },
  ];
  const candidate: WallDragWall[] = [
    baseline[0],
    { ...baseline[1], points: baseline[1].points.map((point, index) => index === 6 ? { x: 600, y: 900 } : { ...point }) },
  ];

  const translated = translateHostSegmentWithDraggedEndpoint(baseline, candidate, "outer-outline", 6);
  const repaired = retainDraggedWallConnections(baseline, translated, "outer-outline", 5);
  const outer = repaired.find((wall) => wall.id === "outer-outline");
  const room = repaired.find((wall) => wall.id === "room-1");

  assert.deepEqual(outer?.points[4], { x: -800, y: 1800 });
  assert.deepEqual(outer?.points[5], { x: -800, y: 900 });
  assert.deepEqual(outer?.points[6], { x: 600, y: 900 });
  assert.deepEqual(room?.points.slice(0, 4), [{ x: 600, y: 0 }, { x: 2400, y: 0 }, { x: 2400, y: 1800 }, { x: 600, y: 1800 }]);
  assert.equal(repaired.some((wall) => wall.id.startsWith("auto-wall-bridge:outer-outline:5:")), false);
});

test("keeps a separately stored 8–9 wall fixed when corner 10 is dragged", () => {
  const baseline: WallDragWall[] = [
    { id: "room-1", points: [{ x: 0, y: 0 }, { x: 2400, y: 0 }, { x: 2400, y: 1800 }, { x: 0, y: 1800 }, { x: 0, y: 0 }] },
    { id: "wall-8-9", points: [{ x: -800, y: 1800 }, { x: -800, y: 900 }] },
    { id: "wall-9-10", points: [{ x: -800, y: 900 }, { x: 0, y: 900 }], attachments: { 1: { wallId: "room-1", segmentIndex: 3, along: .5 } } },
  ];
  const candidate: WallDragWall[] = [
    baseline[0],
    baseline[1],
    { ...baseline[2], points: [baseline[2].points[0], { x: 600, y: 900 }] },
  ];

  const translated = translateHostSegmentWithDraggedEndpoint(baseline, candidate, "wall-9-10", 1);
  const repaired = retainDraggedWallConnections(baseline, translated, "wall-9-10", 0);
  const preceding = repaired.find((wall) => wall.id === "wall-8-9");
  const branch = repaired.find((wall) => wall.id === "wall-9-10");
  const room = repaired.find((wall) => wall.id === "room-1");

  assert.deepEqual(preceding?.points, baseline[1].points);
  assert.deepEqual(branch?.points, [{ x: -800, y: 900 }, { x: 600, y: 900 }]);
  assert.equal(room?.points[0].x, 600);
  assert.equal(room?.points[3].x, 600);
  assert.equal(repaired.some((wall) => wall.id.startsWith("auto-wall-bridge:wall-9-10:0:")), false);
});

test("moves the complete materialized host run when its junction corner is dragged", () => {
  const baseline: WallDragWall[] = [
    { id: "room", points: [{ x: 0, y: 0 }, { x: 2400, y: 0 }, { x: 2400, y: 900 }, { x: 2400, y: 1800 }, { x: 0, y: 1800 }, { x: 0, y: 0 }] },
    { id: "branch", points: [{ x: 2400, y: 900 }, { x: 3500, y: 900 }] },
  ];
  const candidate: WallDragWall[] = [
    { ...baseline[0], points: [{ x: 0, y: 0 }, { x: 2400, y: 0 }, { x: 3000, y: 900 }, { x: 2400, y: 1800 }, { x: 0, y: 1800 }, { x: 0, y: 0 }] },
    baseline[1],
  ];

  const translated = translateStraightWallRunForCorner(baseline, candidate, "room", 2);

  assert.deepEqual(translated[0].points, [{ x: 0, y: 0 }, { x: 3000, y: 0 }, { x: 3000, y: 900 }, { x: 3000, y: 1800 }, { x: 0, y: 1800 }, { x: 0, y: 0 }]);
});

test("moves an attached wall with its materialized room-side junction corner", () => {
  const baseline: WallDragWall[] = [
    // Corner 5 has been materialized on Room 1's right side.
    { id: "room-1", points: [{ x: 0, y: 0 }, { x: 2400, y: 0 }, { x: 2400, y: 900 }, { x: 2400, y: 1800 }, { x: 0, y: 1800 }, { x: 0, y: 0 }], attachments: { 2: { wallId: "outer-wall", segmentIndex: 3, along: 1 } } },
    // The path was drawn 9–8–7–6–5, so corner 5 is the endpoint being dragged.
    { id: "outer-wall", points: [{ x: 1200, y: 0 }, { x: 1200, y: -600 }, { x: 3600, y: -600 }, { x: 3600, y: 900 }, { x: 2400, y: 900 }], attachments: { 4: { wallId: "room-1", segmentIndex: 1, along: 1 } } },
  ];
  const candidate: WallDragWall[] = [
    { ...baseline[0], points: baseline[0].points.map((point, index) => index === 2 ? { x: 3000, y: 900 } : { ...point }) },
    baseline[1],
  ];

  const translatedRun = translateStraightWallRunForCorner(baseline, candidate, "room-1", 2);
  const moved = translateHostSegmentWithDraggedEndpoint(baseline, translatedRun, "room-1", 2);
  const repaired = retainDraggedWallConnections(baseline, moved, "room-1", 2);

  assert.deepEqual(repaired.find((wall) => wall.id === "room-1")?.points.slice(1, 4), [{ x: 3000, y: 0 }, { x: 3000, y: 900 }, { x: 3000, y: 1800 }]);
  assert.deepEqual(repaired.find((wall) => wall.id === "outer-wall")?.points.slice(-2), [{ x: 3600, y: 900 }, { x: 3000, y: 900 }]);
  assert.equal(repaired.find((wall) => wall.id === "outer-wall")?.points.length, 5);
  assert.equal(repaired.some((wall) => wall.id.startsWith("auto-wall-bridge:room-1:2:")), false);
});

test("keeps a junction corner attached after its room side is clearance-clamped", () => {
  const baseline: WallDragWall[] = [
    { id: "room-1", points: [{ x: 0, y: 0 }, { x: 800, y: 0 }, { x: 800, y: 900 }, { x: 800, y: 1800 }, { x: 0, y: 1800 }, { x: 0, y: 0 }], attachments: { 2: { wallId: "outer-wall", segmentIndex: 3, along: 1 } } },
    { id: "outer-wall", points: [{ x: 1200, y: 0 }, { x: 1200, y: -600 }, { x: 1400, y: -600 }, { x: 1400, y: 900 }, { x: 800, y: 900 }], attachments: { 4: { wallId: "room-1", segmentIndex: 1, along: .5 } } },
  ];
  const clampedCandidate: WallDragWall[] = [
    // Corner 5 was materialized on the Room 1 side and has the reciprocal
    // attachment to the outer branch. It must remain the host, not be pulled
    // back to that branch after the side has stopped at its clearance limit.
    { id: "room-1", points: [{ x: 0, y: 0 }, { x: 1000, y: 0 }, { x: 1000, y: 900 }, { x: 1000, y: 1800 }, { x: 0, y: 1800 }, { x: 0, y: 0 }], attachments: { 2: { wallId: "outer-wall", segmentIndex: 3, along: 1 } } },
    // The open endpoint overshot while the room side stopped 200 mm short of
    // wall 6–7.
    // Simulate the materialization/remapping frame where this temporary copy
    // has lost its endpoint attachment and still holds the pointer target.
    { id: "outer-wall", points: [{ x: 1200, y: 0 }, { x: 1200, y: -600 }, { x: 1400, y: -600 }, { x: 1400, y: 900 }, { x: 1100, y: 900 }] },
  ];

  const anchored = reanchorAttachedWallEndpoints(clampedCandidate);
  const repaired = retainDraggedWallConnections(baseline, anchored, "room-1", 2);
  const outer = repaired.find((wall) => wall.id === "outer-wall");
  const room = repaired.find((wall) => wall.id === "room-1");

  assert.deepEqual(outer?.points.at(-1), { x: 1000, y: 900 });
  assert.deepEqual(room?.points[2], { x: 1000, y: 900 });
  assert.equal(outer?.points.length, 5);
  assert.equal(repaired.some((wall) => wall.id.startsWith("auto-wall-bridge:")), false);
});

test("recovers a missing attachment when a room-side junction is dragged left", () => {
  const baseline: WallDragWall[] = [
    { id: "room-1", points: [{ x: 0, y: 0 }, { x: 1000, y: 0 }, { x: 1000, y: 1800 }, { x: 0, y: 1800 }, { x: 0, y: 0 }] },
    { id: "outer-wall", points: [{ x: 1200, y: 0 }, { x: 1200, y: -600 }, { x: 1400, y: -600 }, { x: 1400, y: 900 }, { x: 1000, y: 900 }] },
  ];
  const candidate: WallDragWall[] = [
    baseline[0],
    { ...baseline[1], points: [{ x: 1200, y: 0 }, { x: 1200, y: -600 }, { x: 1400, y: -600 }, { x: 1400, y: 900 }, { x: 700, y: 900 }] },
  ];

  const repaired = retainDraggedWallConnections(baseline, candidate, "outer-wall", 3);

  assert.deepEqual(repaired.find((wall) => wall.id === "outer-wall")?.points.at(-1), { x: 1000, y: 900 });
  assert.equal(repaired.find((wall) => wall.id === "outer-wall")?.points.length, 5);
  assert.equal(repaired.some((wall) => wall.id.startsWith("auto-wall-bridge:")), false);
});

test("keeps an existing bridge corner anchored while either host wall moves", () => {
  const walls: WallDragWall[] = [
    { id: "host", points: [{ x: 300, y: 0 }, { x: 300, y: 1800 }] },
    { id: "branch", points: [{ x: -900, y: 900 }, { x: 300, y: 900 }] },
    {
      id: "auto-wall-bridge:branch:0:0:host:0",
      points: [{ x: 0, y: 900 }, { x: 0, y: 900 }],
      attachments: {
        0: { wallId: "host", segmentIndex: 0, along: .5 },
        1: { wallId: "branch", segmentIndex: 0, along: 1, hideCorner: true },
      },
    },
  ];

  const repaired = reanchorAutoWallBridges(walls);

  assert.deepEqual(repaired[2].points, [{ x: 300, y: 900 }, { x: 300, y: 900 }]);
});

test("reanchors chained connector walls in one editor update", () => {
  const walls: WallDragWall[] = [
    { id: "host", points: [{ x: 300, y: 0 }, { x: 300, y: 1800 }] },
    { id: "branch", points: [{ x: -900, y: 900 }, { x: 300, y: 900 }] },
    { id: "fixed", points: [{ x: -600, y: 600 }, { x: -600, y: 1200 }] },
    { id: "auto-wall-bridge:primary", points: [{ x: 0, y: 900 }, { x: 0, y: 900 }], attachments: { 0: { wallId: "host", segmentIndex: 0, along: .5 }, 1: { wallId: "branch", segmentIndex: 0, along: 1 } } },
    { id: "auto-wall-bridge:nested", points: [{ x: 0, y: 900 }, { x: -600, y: 900 }], attachments: { 0: { wallId: "auto-wall-bridge:primary", segmentIndex: 0, along: 0 }, 1: { wallId: "fixed", segmentIndex: 0, along: .5 } } },
  ];

  const repaired = reanchorAutoWallBridges(walls);

  assert.deepEqual(repaired[3].points, [{ x: 300, y: 900 }, { x: 300, y: 900 }]);
  assert.deepEqual(repaired[4].points, [{ x: 300, y: 900 }, { x: -600, y: 900 }]);
});

test("resizes an unbranched host wall instead of adding a wall beyond its endpoint", () => {
  const baseline: WallDragWall[] = [
    { id: "moving", points: [{ x: -1200, y: 0 }, { x: 0, y: 0 }], attachments: { 1: { wallId: "host", segmentIndex: 0, along: 1 } } },
    { id: "host", points: [{ x: 0, y: -900 }, { x: 0, y: 0 }] },
  ];
  const candidate: WallDragWall[] = [
    { ...baseline[0], points: [{ x: -1200, y: 500 }, { x: 0, y: 500 }] },
    baseline[1],
  ];

  const repaired = retainDraggedWallConnections(baseline, candidate, "moving", 0);

  assert.equal(repaired.length, 2);
  assert.deepEqual(repaired[1].points, [{ x: 0, y: -900 }, { x: 0, y: 500 }]);
});

test("keeps a bridge at a branch junction instead of moving the closed room corner", () => {
  const baseline: WallDragWall[] = [
    roomWall,
    { id: "moving", points: [{ x: -1200, y: 2480 }, { x: 0, y: 2480 }], attachments: { 1: { wallId: "room-1", segmentIndex: 3, along: 1 } } },
  ];
  const candidate: WallDragWall[] = [
    roomWall,
    { ...baseline[1], points: [{ x: -1200, y: 3000 }, { x: 0, y: 3000 }] },
  ];

  const repaired = retainDraggedWallConnections(baseline, candidate, "moving", 0);

  assert.equal(repaired.length, 3);
  assert.deepEqual(repaired[0].points, roomWall.points);
  assert.deepEqual(repaired[2].points, [{ x: 0, y: 2480 }, { x: 0, y: 3000 }]);
});

test("corner-dragging the outer top wall stops 200 mm before the inner top wall", () => {
  const walls: WallDragWall[] = [
    { id: "inner", points: [{ x: 0, y: 0 }, { x: 2400, y: 0 }, { x: 2400, y: 2540 }, { x: 0, y: 2540 }, { x: 0, y: 0 }] },
    { id: "outer", points: [{ x: 2400, y: 2540 }, { x: 3520, y: 2540 }, { x: 3520, y: 4020 }, { x: -1260, y: 4020 }, { x: -1260, y: 2540 }, { x: 0, y: 2540 }] },
  ];
  const requestedTarget = { x: -1260, y: 2320 };
  const candidatePoints = walls[1].points.map((point) => ({ ...point }));
  candidatePoints[2].y = requestedTarget.y;
  candidatePoints[3].y = requestedTarget.y;

  const constrained = constrainSquaredCornerTarget(walls, "outer", 3, candidatePoints, requestedTarget, 200);

  assert.deepEqual(constrained, { x: -1260, y: 2740 });
});

test("corner 8 stops before the nearer 5-6 and 9-10 walls after wall 3-4 is lowered", () => {
  const walls: WallDragWall[] = [
    { id: "inner", points: [{ x: 0, y: 0 }, { x: 2400, y: 0 }, { x: 2400, y: 1720 }, { x: 0, y: 1720 }, { x: 0, y: 0 }] },
    { id: "outer", points: [{ x: 2400, y: 2780 }, { x: 4020, y: 2780 }, { x: 4020, y: 4460 }, { x: -1320, y: 4460 }, { x: -1320, y: 2780 }, { x: 0, y: 2780 }] },
  ];
  // A real corner drag rarely stays perfectly vertical: include tangential
  // movement that resizes 7-8 while it is being lowered.
  const requestedTarget = { x: -1120, y: 1460 };
  const candidatePoints = walls[1].points.map((point) => ({ ...point }));
  candidatePoints[2].y = requestedTarget.y;
  candidatePoints[3] = { ...requestedTarget };

  const constrained = constrainSquaredCornerTarget(walls, "outer", 3, candidatePoints, requestedTarget, 200);

  assert.deepEqual(constrained, { x: -1120, y: 2980 });
});

test("corner 10 stops its attached vertical connector 200 mm before wall 2-5", () => {
  const walls: WallDragWall[] = [
    { id: "main-room", points: [{ x: 0, y: 0 }, { x: 1740, y: 0 }, { x: 1740, y: 1380 }, { x: 0, y: 1380 }, { x: 0, y: 0 }] },
    { id: "outer", points: [{ x: -2360, y: 3180 }, { x: 0, y: 3180 }] },
    { id: "wall-2-5", points: [{ x: 1740, y: 0 }, { x: 1740, y: 3180 }] },
    {
      id: "connector-4-10",
      points: [{ x: 0, y: 1380 }, { x: 0, y: 3180 }],
      attachments: {
        0: { wallId: "main-room", segmentIndex: 3, along: 0 },
        1: { wallId: "outer", segmentIndex: 0, along: 1 },
      },
    },
  ];
  const requestedTarget = { x: 2400, y: 3180 };
  const candidatePoints = walls[1].points.map((point) => ({ ...point }));
  candidatePoints[1] = { ...requestedTarget };

  const constrained = constrainSquaredCornerTarget(walls, "outer", 1, candidatePoints, requestedTarget, 200);

  assert.deepEqual(constrained, { x: 1540, y: 3180 });
});

test("corner 5 stays 200 mm inside both neighbouring walls when dragged past the L-junction", () => {
  const walls: WallDragWall[] = [
    {
      id: "outline",
      // 1-6 is the upper wall, 6-5 the inner vertical leg, 5-4 the inner
      // horizontal leg, and 4-3 the opposite vertical wall.
      points: [
        { x: 0, y: 0 }, { x: 1000, y: 0 }, { x: 1000, y: 600 },
        { x: 1800, y: 600 }, { x: 1800, y: 1800 }, { x: 0, y: 1800 }, { x: 0, y: 0 },
      ],
    },
  ];
  const requestedTarget = { x: 2200, y: -1000 };
  const candidatePoints = [
    { x: 0, y: 0 }, { x: 2200, y: 0 }, { ...requestedTarget },
    { x: 1800, y: -1000 }, { x: 1800, y: 1800 }, { x: 0, y: 1800 }, { x: 0, y: 0 },
  ];

  const constrained = constrainSquaredCornerTarget(walls, "outline", 2, candidatePoints, requestedTarget, 200);

  assert.deepEqual(constrained, { x: 1600, y: 200 });
});

test("keeps a side-wall junction at its physical height when its host is resized", () => {
  const baseline: WallDragWall[] = [
    { id: "room", points: [{ x: 0, y: 0 }, { x: 2400, y: 0 }, { x: 2400, y: 2540 }, { x: 0, y: 2540 }, { x: 0, y: 0 }] },
    { id: "side", points: [{ x: 2400, y: 1220 }, { x: 3520, y: 1220 }], attachments: { 0: { wallId: "room", segmentIndex: 1, along: 1220 / 2540 } } },
  ];
  const candidate: WallDragWall[] = [
    { ...baseline[0], points: [{ x: 0, y: 0 }, { x: 2500, y: 0 }, { x: 2500, y: 2540 }, { x: 0, y: 2540 }, { x: 0, y: 0 }] },
    baseline[1],
  ];

  const repaired = followTerminatingEndpointsOnTranslatedSegments(baseline, candidate, "room");

  assert.deepEqual(repaired[1].points, [{ x: 2500, y: 1220 }, { x: 3520, y: 1220 }]);
  assert.equal(repaired[1].attachments?.[0]?.along, 1220 / 2540);
});

test("wall and corner paths move the right room side without dropping or detaching wall 5-6", () => {
  const baseline: WallDragWall[] = [
    { id: "room", points: [{ x: 0, y: 0 }, { x: 2400, y: 0 }, { x: 2400, y: 2540 }, { x: 0, y: 2540 }, { x: 0, y: 0 }] },
    { id: "outer", points: [{ x: 2400, y: 1220 }, { x: 3520, y: 1220 }, { x: 3520, y: 4020 }, { x: -1260, y: 4020 }, { x: -1260, y: 1220 }, { x: 0, y: 1220 }], attachments: { 0: { wallId: "room", segmentIndex: 1, along: 1220 / 2540 }, 5: { wallId: "room", segmentIndex: 3, along: (2540 - 1220) / 2540 } } },
  ];
  const requestedRoom = [{ x: 0, y: 0 }, { x: 3700, y: 0 }, { x: 3700, y: 2540 }, { x: 0, y: 2540 }, { x: 0, y: 0 }];
  const constrainedCorner = constrainSquaredCornerTarget(baseline, "room", 2, requestedRoom, requestedRoom[2], 200);
  assert.deepEqual(constrainedCorner, { x: 3320, y: 2540 });

  const candidate: WallDragWall[] = [
    { ...baseline[0], points: [{ x: 0, y: 0 }, { x: constrainedCorner.x, y: 0 }, constrainedCorner, { x: 0, y: 2540 }, { x: 0, y: 0 }] },
    baseline[1],
  ];
  const followed = followTerminatingEndpointsOnTranslatedSegments(baseline, candidate, "room");
  const repaired = retainDraggedWallConnections(baseline, followed, "room", 1);

  assert.deepEqual(repaired.find((wall) => wall.id === "outer")?.points[0], { x: 3320, y: 1220 });
  assert.equal(repaired.some((wall) => wall.id.startsWith("auto-wall-bridge")), false);
  assert.equal(repaired[0].points[1].x, 3320);
  assert.equal(repaired[0].points[2].x, 3320);
});

test("materializes a real host corner when either stacked-room wall is translated", () => {
  const baseline: WallDragWall[] = [
    { id: "lower-room", points: [{ x: 0, y: 0 }, { x: 2400, y: 0 }, { x: 2400, y: 1800 }, { x: 0, y: 1800 }, { x: 0, y: 0 }], cornerNumbers: { 0: 1, 1: 2, 2: 3, 3: 4 } },
    { id: "upper-room", points: [{ x: 0, y: 1800 }, { x: 0, y: 2550 }, { x: 2400, y: 2550 }, { x: 2400, y: 1800 }], cornerNumbers: { 0: 4, 1: 5, 2: 6, 3: 3 }, attachments: { 0: { wallId: "lower-room", segmentIndex: 3, along: 0 }, 3: { wallId: "lower-room", segmentIndex: 1, along: 1 } } },
  ];
  const movedUpper = baseline.map((wall) => wall.id !== "upper-room" ? wall : {
    ...wall,
    points: wall.points.map((point) => ({ x: point.x + 300, y: point.y })),
  });
  const upperBridge = retainDraggedWallConnections(baseline, movedUpper, "upper-room", 0);
  const upperMaterialized = materializeWallIntersections(upperBridge);
  const lower = upperMaterialized.find((wall) => wall.id === "lower-room")!;
  assert.ok(lower.points.some((point) => Math.abs(point.x - 300) < 0.001 && Math.abs(point.y - 1800) < 0.001));

  const movedLower = baseline.map((wall) => wall.id !== "lower-room" ? wall : {
    ...wall,
    points: wall.points.map((point, index) => index === 0 || index === 3 || index === 4 ? { x: point.x + 300, y: point.y } : { ...point }),
  });
  const lowerBridge = retainDraggedWallConnections(baseline, movedLower, "lower-room", 3);
  const lowerMaterialized = materializeWallIntersections(lowerBridge);
  const lowerHost = lowerMaterialized.find((wall) => wall.id === "lower-room")!;
  assert.ok(lowerHost.points.some((point) => Math.abs(point.x - 300) < 0.001 && Math.abs(point.y - 1800) < 0.001));
});

test("moving wall 3-2 translates connector 3-5 and shortens 5-6 at the same height", () => {
  const connectorId = "auto-wall-bridge:room:2:2:outer:0";
  const candidate: WallDragWall[] = [
    { id: "room", points: [{ x: 0, y: 0 }, { x: 2560, y: 0 }, { x: 2560, y: 1720 }, { x: 0, y: 1720 }, { x: 0, y: 0 }] },
    { id: "outer", points: [{ x: 2400, y: 2780 }, { x: 4020, y: 2780 }, { x: 4020, y: 4460 }, { x: -1320, y: 4460 }, { x: -1320, y: 2780 }, { x: 0, y: 2780 }], attachments: { 0: { wallId: connectorId, segmentIndex: 0, along: 1 } } },
    { id: connectorId, points: [{ x: 2400, y: 1720 }, { x: 2400, y: 2780 }], attachments: { 0: { wallId: "room", segmentIndex: 1, along: 1 }, 1: { wallId: "outer", segmentIndex: 0, along: 0 } } },
  ];

  const repaired = reanchorAutoWallBridges(candidate);

  assert.deepEqual(repaired.find((wall) => wall.id === "outer")?.points[0], { x: 2560, y: 2780 });
  assert.deepEqual(repaired.find((wall) => wall.id === connectorId)?.points, [{ x: 2560, y: 1720 }, { x: 2560, y: 2780 }]);
});

test("preserves and resizes existing connector walls across later wall drags", () => {
  const baseline: WallDragWall[] = [
    { id: "room", points: [{ x: 0, y: 0 }, { x: 2400, y: 0 }, { x: 2400, y: 1580 }, { x: 0, y: 1580 }, { x: 0, y: 0 }] },
    { id: "outer", points: [{ x: 2400, y: 2480 }, { x: 3520, y: 2480 }] },
    { id: "outer-left", points: [{ x: -1260, y: 2480 }, { x: 0, y: 2480 }] },
    { id: "auto-wall-bridge:room:2:2:outer:0", points: [{ x: 2400, y: 1580 }, { x: 2400, y: 2480 }], attachments: { 0: { wallId: "room", segmentIndex: 1, along: 1 }, 1: { wallId: "outer", segmentIndex: 0, along: 0 } } },
    { id: "auto-wall-bridge:room:2:3:outer-left:1", points: [{ x: 0, y: 1580 }, { x: 0, y: 2480 }], attachments: { 0: { wallId: "room", segmentIndex: 3, along: 0 }, 1: { wallId: "outer-left", segmentIndex: 0, along: 1 } } },
  ];
  const candidate: WallDragWall[] = [
    { ...baseline[0], points: [{ x: 0, y: 0 }, { x: 2400, y: 0 }, { x: 2400, y: 1400 }, { x: 0, y: 1400 }, { x: 0, y: 0 }] },
    baseline[1],
    baseline[2],
    baseline[3],
    baseline[4],
  ];

  const anchored = reanchorAutoWallBridges(candidate);
  const repaired = retainDraggedWallConnections(baseline, anchored, "room", 2);

  assert.equal(repaired.filter((wall) => wall.id === baseline[3].id).length, 1);
  assert.equal(repaired.filter((wall) => wall.id === baseline[4].id).length, 1);
  assert.deepEqual(repaired.find((wall) => wall.id === baseline[3].id)?.points, [{ x: 2400, y: 1400 }, { x: 2400, y: 2480 }]);
  assert.deepEqual(repaired.find((wall) => wall.id === baseline[4].id)?.points, [{ x: 0, y: 1400 }, { x: 0, y: 2480 }]);
  assert.deepEqual(repaired[0].points[0], repaired[0].points.at(-1));
});

test("dragging a connector moves its open host endpoint and bridges its closed host", () => {
  const connectorId = "auto-wall-bridge:room:2:2:outer:0";
  const baseline: WallDragWall[] = [
    { id: "room", points: [{ x: 0, y: 0 }, { x: 2400, y: 0 }, { x: 2400, y: 1580 }, { x: 0, y: 1580 }, { x: 0, y: 0 }] },
    { id: "outer", points: [{ x: 2400, y: 2480 }, { x: 3520, y: 2480 }] },
    { id: connectorId, points: [{ x: 2400, y: 1580 }, { x: 2400, y: 2480 }], attachments: { 0: { wallId: "room", segmentIndex: 1, along: 1 }, 1: { wallId: "outer", segmentIndex: 0, along: 0 } } },
  ];
  const candidate: WallDragWall[] = [
    baseline[0],
    baseline[1],
    { ...baseline[2], points: [{ x: 3000, y: 1580 }, { x: 3000, y: 2480 }] },
  ];

  const repaired = retainDraggedWallConnections(baseline, candidate, connectorId, 0);

  assert.deepEqual(repaired.find((wall) => wall.id === "outer")?.points[0], { x: 3000, y: 2480 });
  const elbowWall = repaired.find((wall) => wall.id !== connectorId && wall.id.startsWith(`auto-wall-bridge:${connectorId}:0:`) && JSON.stringify(wall.points) === JSON.stringify([{ x: 2400, y: 1580 }, { x: 3000, y: 1580 }]));
  assert.ok(elbowWall);
  assert.equal(elbowWall.attachments?.[1]?.hideCorner, false);
});
