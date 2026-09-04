import assert from "node:assert/strict";
import test from "node:test";
import { closestValidOpeningOffset, cornerOffsetsOnWallSegment, isOpeningPlacementValid } from "../lib/openingPlacement.ts";

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
