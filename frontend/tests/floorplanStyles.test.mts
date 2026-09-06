import assert from "node:assert/strict";
import test from "node:test";
import { FLOORPLAN_STYLE_OPTIONS, floorplanStyleClass, floorplanStyleCss, floorplanStyleLabel } from "../lib/floorplanStyles.ts";

test("the View menu exposes the same four floorplan styles used by export", () => {
  assert.deepEqual(FLOORPLAN_STYLE_OPTIONS.map((option) => option.value), ["DEFAULT", "TRADITIONAL", "MODERN", "CREATIVE"]);
  assert.equal(floorplanStyleLabel("MODERN"), "Modern style");
  assert.equal(floorplanStyleLabel("CREATIVE"), "Creative style");
});

test("live and exported styles share the same root class and CSS rules", () => {
  for (const style of ["TRADITIONAL", "MODERN", "CREATIVE"] as const) {
    const rootClass = floorplanStyleClass(style);
    const css = floorplanStyleCss(style);
    assert.equal(rootClass, `${style.toLowerCase()}-floorplan`);
    assert.match(css, new RegExp(`\\.${rootClass} \\.`));
  }
  assert.equal(floorplanStyleClass("DEFAULT"), "");
  assert.equal(floorplanStyleCss("DEFAULT"), "");
});

test("element dimensions keep their dark-orange export colour in every named style", () => {
  for (const style of ["TRADITIONAL", "MODERN", "CREATIVE"] as const) {
    assert.match(floorplanStyleCss(style), /fixture-dimension\{color:#b45309\}/);
  }
});
