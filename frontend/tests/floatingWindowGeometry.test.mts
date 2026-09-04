import assert from "node:assert/strict";
import test from "node:test";
import { DEFAULT_FLOATING_WINDOW_WIDTH, resizeFloatingWindow } from "../lib/floatingWindowGeometry.ts";

const workspace = { width: 1200, height: 800 };
const windowBox = { left: 100, top: 80, width: DEFAULT_FLOATING_WINDOW_WIDTH, height: 300 };

test("all floating windows start from the shared default width", () => {
  assert.equal(DEFAULT_FLOATING_WINDOW_WIDTH, 340);
});

test("resizes dynamically from either side boundary", () => {
  assert.deepEqual(resizeFloatingWindow(windowBox, "RIGHT", { x: 120, y: 0 }, workspace), { ...windowBox, width: 460 });
  assert.deepEqual(resizeFloatingWindow(windowBox, "LEFT", { x: -120, y: 0 }, workspace), { ...windowBox, left: 8, width: 432 });
});

test("resizes dynamically from the lower edge", () => {
  assert.deepEqual(resizeFloatingWindow(windowBox, "BOTTOM", { x: 0, y: 180 }, workspace), { ...windowBox, height: 480 });
});

test("keeps a resized floating window inside its workspace", () => {
  assert.deepEqual(resizeFloatingWindow(windowBox, "RIGHT", { x: 2000, y: 0 }, workspace), { ...windowBox, width: 1092 });
  assert.deepEqual(resizeFloatingWindow(windowBox, "BOTTOM", { x: 0, y: 2000 }, workspace), { ...windowBox, height: 712 });
});
