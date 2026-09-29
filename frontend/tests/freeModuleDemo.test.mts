import assert from "node:assert/strict";
import test from "node:test";
import {
  canAddElectricalCircuitInDemo,
  canAddElectricalConnectionInDemo,
  canAddPlannerActivityInDemo,
} from "../lib/freeModuleDemo";

test("Free PlannerBuild demo accepts five activities and rejects a sixth", () => {
  assert.equal(canAddPlannerActivityInDemo(true, 4), true);
  assert.equal(canAddPlannerActivityInDemo(true, 5), false);
  assert.equal(canAddPlannerActivityInDemo(false, 50), true);
});

test("Free Full Electrical Layout module demo supports one circuit only", () => {
  assert.equal(canAddElectricalCircuitInDemo(true, 0), true);
  assert.equal(canAddElectricalCircuitInDemo(true, 1), false);
  assert.equal(canAddElectricalCircuitInDemo(false, 20), true);
});

test("Free Full Electrical Layout module demo requires its single circuit and caps connections at five", () => {
  assert.equal(canAddElectricalConnectionInDemo(true, 0, 0, null), false);
  assert.equal(canAddElectricalConnectionInDemo(true, 0, 1, null), false);
  assert.equal(canAddElectricalConnectionInDemo(true, 0, 1, "demo-circuit"), true);
  assert.equal(canAddElectricalConnectionInDemo(true, 4, 1, "demo-circuit"), true);
  assert.equal(canAddElectricalConnectionInDemo(true, 5, 1, "demo-circuit"), false);
  assert.equal(canAddElectricalConnectionInDemo(true, 0, 2, "demo-circuit"), false);
  assert.equal(canAddElectricalConnectionInDemo(false, 100, 8, null), true);
});
