import assert from "node:assert/strict";
import test from "node:test";

import { ADD_TO_PLAN_MODES } from "../lib/addToPlanModes.ts";

test("Add to plan exposes all five supported modes in their intended order", () => {
  assert.deepEqual(ADD_TO_PLAN_MODES.map(({ label }) => label), ["Doors", "Windows", "Fittings", "Heating elements", "Electrical"]);
  assert.deepEqual(ADD_TO_PLAN_MODES.map(({ value }) => value), ["DOOR", "WINDOW", "FURNITURE", "HEATING", "ELECTRICAL"]);
});
