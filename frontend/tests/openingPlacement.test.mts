import assert from "node:assert/strict";
import test from "node:test";
import { closestValidOpeningOffset, cornerOffsetsOnWallSegment, isOpeningPlacementValid } from "../lib/openingPlacement.ts";
import { translateWallAndAttachedOpenings } from "../lib/openingWallDrag.ts";

test("finds space for further openings on a 7500 mm wall at an occupied offset", () => {
  const openings = [{ offset: 5000, width: 800 }];
  const corners = [0, 7500];
  for (let count = 0; count < 2; count++) {
    const offset = closestValidOpeningOffset(5000, 800, 7500, corners, openings, 50);
    assert.notEqual(offset, null);
    assert.equal(isOpeningPlacementValid(offset!, 800, 7500, corners, openings, 50), true);
    openings.push({ offset: offset!, width: 800 });
  }
  assert.equal(closestValidOpeningOffset(1000, 800, 7500, corners, openings, 50), 1000);
  assert.equal(closestValidOpeningOffset(100, 800, 900, [0, 900], [{ offset: 50, width: 800 }], 50), null);
});

test("keeps a door 50 mm clear of an interior wall junction", () => {
  const cornerOffsets = cornerOffsetsOnWallSegment(
    { x: 0, y: 1800 },
    { x: 0, y: 0 },
    [{ x: 0, y: 1800 }, { x: 0, y: 0 }, { x: 0, y: 900 }, { x: -660, y: 900 }],
  );
  const offset = closestValidOpeningOffset(500, 700, 1800, cornerOffsets, [], 50);

  assert.deepEqual(cornerOffsets, [0, 900, 1800]);
  assert.equal(offset, 150);
  assert.equal(isOpeningPlacementValid(offset!, 700, 1800, cornerOffsets, [], 50), true);
  assert.equal(isOpeningPlacementValid(500, 700, 1800, cornerOffsets, [], 50), false);
});

test("rejects a door that crosses any wall corner or overlaps another opening", () => {
  const corners = [0, 900, 1800];

  assert.equal(isOpeningPlacementValid(50, 700, 1800, corners, [], 50), true);
  assert.equal(isOpeningPlacementValid(200, 700, 1800, corners, [], 50), false);
  assert.equal(isOpeningPlacementValid(950, 700, 1800, corners, [{ offset: 1100, width: 300 }], 50), false);
});

test("keeps every door and window at least 50 mm apart", () => {
  const corners = [0, 3000];
  assert.equal(isOpeningPlacementValid(50, 800, 3000, corners, [{ offset: 900, width: 800 }], 50), true);
  assert.equal(isOpeningPlacementValid(50, 800, 3000, corners, [{ offset: 849, width: 800 }], 50), false);
  assert.equal(closestValidOpeningOffset(850, 800, 3000, corners, [{ offset: 50, width: 800 }], 50), 900);
});

test("shifts openings with a dragged adjoining wall endpoint", () => {
  const walls = [{ id: "room", points: [{ x: 0, y: 0 }, { x: 7500, y: 0 }, { x: 7500, y: 3300 }, { x: 0, y: 3300 }, { x: 0, y: 0 }] }];
  const openings = [
    { id: "window", wallId: "room", segmentIndex: 0, offset: 4500, width: 800 },
    { id: "door", wallId: "room", segmentIndex: 0, offset: 5900, width: 1200 },
  ];
  const translated = translateWallAndAttachedOpenings(walls, openings, "room", 1, { x: -1, y: 0 }, 3000);

  assert.equal(translated.walls[0].points[1].x, 4500);
  assert.deepEqual(translated.openings.map((opening) => opening.offset), [1500, 2900]);
});
