import assert from "node:assert/strict";
import test from "node:test";
import { DEFAULT_FLOATING_WINDOW_WIDTH, resizeFloatingWindow, visibleFloatingWorkspace } from "../lib/floatingWindowGeometry.ts";

const workspace = { width: 1200, height: 800 };
const windowBox = { left: 100, top: 80, width: DEFAULT_FLOATING_WINDOW_WIDTH, height: 300 };

test("floating workspace clips oversized hosts to the visible browser area after menubar/viewport changes", () => {
  assert.deepEqual(visibleFloatingWorkspace({ left: 0, top: 68, width: 1400, height: 900 }, { left: 0, top: 0, width: 1400, height: 650 }), { left: 0, top: 0, right: 1400, bottom: 582 });
  assert.deepEqual(visibleFloatingWorkspace({ left: -40, top: -100, width: 1000, height: 800 }, { left: 10, top: 20, width: 700, height: 500 }), { left: 50, top: 120, right: 750, bottom: 620 });
});

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

test("enforces the measured content minimum from the lower edge", () => {
  assert.deepEqual(resizeFloatingWindow(windowBox, "BOTTOM", { x: 0, y: -280 }, workspace, 180), { ...windowBox, height: 180 });
});

test("resizes dynamically from the upper edge while keeping the lower edge fixed", () => {
  assert.deepEqual(resizeFloatingWindow(windowBox, "TOP", { x: 0, y: -80 }, workspace), { ...windowBox, top: 8, height: 372 });
  assert.deepEqual(resizeFloatingWindow(windowBox, "TOP", { x: 0, y: 120 }, workspace), { ...windowBox, top: 200, height: 180 });
});

test("enforces the measured content minimum from the upper edge", () => {
  assert.deepEqual(resizeFloatingWindow(windowBox, "TOP", { x: 0, y: 200 }, workspace, 180), { ...windowBox, top: 200, height: 180 });
});

test("keeps a resized floating window inside its workspace", () => {
  assert.deepEqual(resizeFloatingWindow(windowBox, "RIGHT", { x: 2000, y: 0 }, workspace), { ...windowBox, width: 1092 });
  assert.deepEqual(resizeFloatingWindow(windowBox, "BOTTOM", { x: 0, y: 2000 }, workspace), { ...windowBox, height: 712 });
  assert.deepEqual(resizeFloatingWindow(windowBox, "TOP", { x: 0, y: -2000 }, workspace), { ...windowBox, top: 8, height: 372 });
});
