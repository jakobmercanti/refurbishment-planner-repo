import assert from "node:assert/strict";
import test from "node:test";
import { defaultFloorDesign, flooringSwatch, floorDesignColour, normalizeFloorDesign, WOOD_COLOURS, FLOORING_PATTERNS, FLOORING_COLLECTIONS, TILE_MATERIALS } from "../lib/flooring.ts";

test("all twenty tile materials survive saving and produce distinct deterministic textures", () => {
  assert.equal(TILE_MATERIALS.length, 20);
  const textures = TILE_MATERIALS.map((tile) => {
    const design = normalizeFloorDesign({ ...defaultFloorDesign(), tile_material_id: tile.id, tile_colour: tile.colour });
    assert.deepEqual(normalizeFloorDesign(JSON.parse(JSON.stringify(design))), design);
    const swatch = flooringSwatch(design);
    assert.equal(swatch.svg, flooringSwatch(design).svg);
    assert.ok(!/NaN|Infinity/.test(swatch.svg));
    return swatch.svg;
  });
  assert.equal(new Set(textures).size, 20);
  assert.ok(!("tile_material_id" in normalizeFloorDesign({ ...defaultFloorDesign(), tile_material_id: "missing" })));
});

test("catalogue supplies fifteen distinct woods and all requested flooring shapes", () => {
  assert.equal(WOOD_COLOURS.length, 15);
  assert.equal(new Set(WOOD_COLOURS.map((wood) => wood.base)).size, 15);
  assert.equal(FLOORING_PATTERNS.filter((p) => p.material === "tile").length, 3);
  assert.equal(FLOORING_PATTERNS.filter((p) => p.material === "wood").length, 6);
  assert.deepEqual(FLOORING_COLLECTIONS.map((c) => c.name), ["Wood colours", "Tiles", "Wooden flooring"]);
});

test("all flooring swatches are deterministic, distinct, self-contained and bounded", () => {
  const patterns = FLOORING_PATTERNS.map((p) => {
    const design = defaultFloorDesign(p.id), swatch = flooringSwatch(design);
    assert.deepEqual(swatch, flooringSwatch(design));
    assert.ok(swatch.width > 0 && swatch.height > 0);
    assert.ok(swatch.url.startsWith("data:image/svg+xml,"));
    assert.ok(!swatch.svg.includes("NaN") && !swatch.svg.includes("Infinity"));
    assert.ok(!swatch.svg.includes("<script") && !swatch.svg.includes('href="http'));
    assert.ok(swatch.svg.length < 600_000);
    return swatch.svg;
  });
  assert.equal(new Set(patterns).size, FLOORING_PATTERNS.length);
});

test("dimensions, arbitrary angles, wood and grout survive JSON serialization", () => {
  const design = normalizeFloorDesign({ ...defaultFloorDesign("wood-herringbone"), width_mm: 137, length_mm: 583, rotation_deg: -32.5, wood_id: "walnut", grout_mm: 2.5, grout_colour: "#abcdef" });
  assert.equal(design.rotation_deg, 327.5);
  assert.equal(design.width_mm, 137);
  assert.equal(design.length_mm, 583);
  assert.equal(floorDesignColour(design), "#71503a");
  assert.deepEqual(JSON.parse(JSON.stringify({ floor_design: design })).floor_design, design);
  const swatch = flooringSwatch(design);
  assert.equal(swatch.diagonal, true);
  assert.equal(swatch.width, 274);
  assert.equal(swatch.height, 1166);
});

test("square sizes and malformed imported settings are normalized safely", () => {
  const design = normalizeFloorDesign({ ...defaultFloorDesign(), width_mm: 250, length_mm: 800, rotation_deg: Infinity, wood_id: "missing", tile_colour: '<script>alert(1)</script>', grout_mm: -3 });
  assert.equal(design.length_mm, 250);
  assert.equal(design.rotation_deg, 0);
  assert.equal(design.wood_id, "natural-oak");
  assert.equal(design.tile_colour, "#d8d4c9");
  assert.equal(design.grout_mm, 0);
});
