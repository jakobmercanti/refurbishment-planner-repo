import assert from "node:assert/strict";
import test from "node:test";

import { ADD_TO_PLAN_MODES } from "../lib/addToPlanModes.ts";

test("Add to plan exposes all six supported modes in their intended order", () => {
  assert.deepEqual(ADD_TO_PLAN_MODES.map(({ label }) => label), ["Doors", "Windows", "People", "Fittings", "Heating elements", "Electrical"]);
  assert.deepEqual(ADD_TO_PLAN_MODES.map(({ value }) => value), ["DOOR", "WINDOW", "PEOPLE", "FURNITURE", "HEATING", "ELECTRICAL"]);
});
