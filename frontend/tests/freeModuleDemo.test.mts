import assert from "node:assert/strict";
import test from "node:test";
import {
  canAddPlannerActivityInDemo,
} from "../lib/freeModuleDemo";

test("PlannerBuild demo accepts five activities and rejects a sixth", () => {
  assert.equal(canAddPlannerActivityInDemo(true, 4), true);
  assert.equal(canAddPlannerActivityInDemo(true, 5), false);
  assert.equal(canAddPlannerActivityInDemo(false, 50), true);
});
