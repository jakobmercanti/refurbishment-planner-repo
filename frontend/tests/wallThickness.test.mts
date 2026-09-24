import assert from "node:assert/strict";
import test from "node:test";
import { needsWallThicknessOverride } from "../lib/wallThickness.ts";

test("applying the current default creates an independent thickness override", () => {
  assert.equal(needsWallThicknessOverride(undefined, 100), true);
  const overrides = { 0: 100 };
  assert.equal(overrides[0] ?? 200, 100);
  assert.equal(needsWallThicknessOverride(overrides[0], 100), false);
  assert.equal(needsWallThicknessOverride(overrides[0], 200), true);
});

test("invalid thickness never creates an override", () => {
  for (const requested of [0, -1, NaN, Infinity]) assert.equal(needsWallThicknessOverride(undefined, requested), false);
});
