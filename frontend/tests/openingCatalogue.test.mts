import assert from "node:assert/strict";
import test from "node:test";
import { openingCatalogueDefaultDimensions } from "../lib/openingCatalogue.ts";

test("bay and bow window defaults cap height and sill", () => {
  for (const representation_key of ["window-bay", "window-bow"]) {
    assert.deepEqual(openingCatalogueDefaultDimensions({ fixture_kind: "WINDOW", representation_key, height_mm: 1500 }), { height: 1400, sill: 1000 });
  }
});

test("ordinary window defaults keep their catalogue height and sill rule", () => {
  assert.deepEqual(openingCatalogueDefaultDimensions({ fixture_kind: "WINDOW", representation_key: "window-casement", height_mm: 1500 }), { height: 1500, sill: 1200 });
});
