import assert from "node:assert/strict";
import test from "node:test";
import { calibratedDrawingSize, orthogonalCalibrationPoint } from "../lib/drawingCalibration.ts";

test("Shift calibration snaps the reference line to its dominant axis", () => {
  assert.deepEqual(orthogonalCalibrationPoint({ x: 100, y: 200 }, { x: 350, y: 240 }), { x: 350, y: 200 });
  assert.deepEqual(orthogonalCalibrationPoint({ x: 100, y: 200 }, { x: 140, y: 500 }), { x: 100, y: 500 });
});

test("a diagonal reference sets exact millimetres and preserves image aspect ratio", () => {
  const result = calibratedDrawingSize({ width: 1000, height: 800 }, { x: 10, y: 20 }, { x: 310, y: 420 }, 2500);
  assert.deepEqual(result, { width: 5000, height: 4000 });
  assert.equal(Math.hypot(300 * 5, 400 * 5), 2500);
});
test("recalibration works in scaled coordinates and rejects degenerate input", () => {
  assert.deepEqual(calibratedDrawingSize({ width: 5000, height: 4000 }, { x: 0, y: 0 }, { x: 1500, y: 2000 }, 500), { width: 1000, height: 800 });
  for (const length of [0, -1, NaN, Infinity]) assert.equal(calibratedDrawingSize({ width: 100, height: 100 }, { x: 0, y: 0 }, { x: 10, y: 0 }, length), null);
  assert.equal(calibratedDrawingSize({ width: 100, height: 100 }, { x: 2, y: 2 }, { x: 2, y: 2 }, 100), null);
});
