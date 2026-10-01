import assert from "node:assert/strict";
import test from "node:test";

import { ADD_TO_PLAN_MODES } from "../lib/addToPlanModes.ts";

test("Add to plan exposes the four supported modes in their intended order", () => {
  assert.deepEqual(ADD_TO_PLAN_MODES.map(({ label }) => label), ["Doors", "Windows", "Fittings", "Electrical"]);
  assert.deepEqual(ADD_TO_PLAN_MODES.map(({ value }) => value), ["DOOR", "WINDOW", "FURNITURE", "ELECTRICAL"]);
});
