import assert from "node:assert/strict";
import test from "node:test";
import { openingRenderWidths } from "../lib/openingRendering.ts";

test("opening gap and jambs span scaled thick walls without changing opening width", () => {
  assert.deepEqual(openingRenderWidths(100), { gapWidth: 104, jambHalf: 52 });
  assert.deepEqual(openingRenderWidths(200), { gapWidth: 204, jambHalf: 102 });
});

test("schematic and invalid widths keep the existing opening symbol minimum", () => {
  for (const value of [undefined, 0, -1, NaN]) {
    assert.deepEqual(openingRenderWidths(value), { gapWidth: 14, jambHalf: 7 });
  }
});
