import assert from "node:assert/strict";
import test from "node:test";
import { DEFAULT_FLOATING_WINDOW_WIDTH, edgeDockLayout, edgeDockTarget, floatingDockLayout, resizeFloatingWindow, visibleFloatingWorkspace } from "../lib/floatingWindowGeometry.ts";

const workspace = { width: 1200, height: 800 };
const windowBox = { left: 100, top: 80, width: DEFAULT_FLOATING_WINDOW_WIDTH, height: 300 };

test("every dock slot shares the area below the pinned selector, rather than moving only the first window", () => {
  const first = floatingDockLayout(0, 3);
  const second = floatingDockLayout(1, 3);
  const last = floatingDockLayout(2, 3);
  assert.match(first.top, /var\(--floating-toolbar-top-inset, 0px\) \* 1\)/);
  assert.match(second.top, /var\(--floating-toolbar-top-inset, 0px\) \* 0\.666/);
  assert.match(last.top, /var\(--floating-toolbar-top-inset, 0px\) \* 0\.333/);
  assert.equal(first.height, second.height);
  assert.equal(second.height, last.height);
  assert.match(first.height, /var\(--floating-toolbar-top-inset, 0px\) \/ 3/);
  assert.deepEqual(floatingDockLayout(-2, 0), floatingDockLayout(0, 1));
  assert.deepEqual(floatingDockLayout(9, 3), last);
  assert.notEqual(floatingDockLayout(0, 3, true).height, first.height);
});

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

const bounds = { left: 30, top: 100, width: 1440, height: 800 };
test("an empty or compact docking layout reserves no viewer space", () => {
  assert.deepEqual(edgeDockLayout(bounds, []), { enabled: true, left: 0, right: 0, boxes: {} });
  for (const width of [0, 390, 719]) {
    assert.deepEqual(edgeDockLayout({ ...bounds, width }, [{ id: "mesh", side: "LEFT", width: 1000 }]), { enabled: false, left: 0, right: 0, boxes: {} });
  }
  assert.equal(edgeDockLayout({ ...bounds, height: 279 }, []).enabled, false);
});

test("a docked window uses the visible workspace, leaving exact canvas insets", () => {
  const layout = edgeDockLayout(bounds, [{ id: "mesh", side: "LEFT", width: 1000 }]);
  assert.deepEqual(layout.boxes.mesh, { left: 38, top: 108, width: 560, height: 784 });
  assert.equal(layout.left, 576);
  assert.equal(layout.right, 0);
  const right = edgeDockLayout(bounds, [{ id: "view", side: "RIGHT", width: 340 }]);
  assert.deepEqual(right.boxes.view, { left: 1122, top: 108, width: 340, height: 784 });
  assert.equal(right.right, 356);
});

test("same-side windows stack without overlap and reflow when one closes", () => {
  const entries = [{ id: "build", side: "LEFT" as const, width: 340 }, { id: "help", side: "LEFT" as const, width: 500 }];
  const { boxes, left } = edgeDockLayout(bounds, entries);
  assert.equal(left, 516);
  assert.equal(boxes.build.height, boxes.help.height);
  assert.equal(boxes.help.top, boxes.build.top + boxes.build.height + 8);
  assert.equal(boxes.help.top + boxes.help.height, bounds.top + bounds.height - 8);
  assert.equal(edgeDockLayout(bounds, entries.slice(1)).boxes.help.height, 784);
});

test("opposite rails cannot consume the whole view, even with oversized requests", () => {
  for (const width of [720, 768, 800, 1024, 1440, 1920]) {
    const layout = edgeDockLayout({ ...bounds, width }, [{ id: "left", side: "LEFT", width: 2000 }, { id: "right", side: "RIGHT", width: 2000 }]);
    const remaining = width - layout.left - layout.right;
    assert.ok(remaining >= Math.min(320, width - 472) - .001, `${width}: ${remaining}`);
    assert.ok(layout.boxes.left.width >= 220 - .001);
    assert.ok(layout.boxes.right.width >= 220 - .001);
    assert.ok(layout.boxes.left.left + layout.boxes.left.width < layout.boxes.right.left);
  }
});

test("malformed dock widths use a bounded fallback instead of invalid CSS", () => {
  for (const width of [NaN, Infinity, -300, 0]) {
    const layout = edgeDockLayout(bounds, [{ id: "window", side: "LEFT", width }]);
    assert.ok(Number.isFinite(layout.left));
    assert.ok(layout.boxes.window.width >= 220);
    assert.ok(layout.boxes.window.width <= 560);
  }
});

test("drag previews use window edges, disappear in the centre and ignore out-of-workspace drops", () => {
  const pointer = { x: 200, y: 160 };
  assert.equal(edgeDockTarget({ left: 38, top: 140, width: 340, height: 400 }, pointer, bounds), "LEFT");
  assert.equal(edgeDockTarget({ left: 1120, top: 140, width: 340, height: 400 }, { ...pointer, x: 1250 }, bounds), "RIGHT");
  assert.equal(edgeDockTarget({ left: 400, top: 140, width: 340, height: 400 }, pointer, bounds), null);
  for (const point of [{ x: 200, y: 80 }, { x: 200, y: 910 }, { x: -100, y: 160 }]) {
    assert.equal(edgeDockTarget({ left: 38, top: 140, width: 340, height: 400 }, point, bounds), null);
  }
  assert.equal(edgeDockTarget({ left: 38, top: 140, width: 340, height: 400 }, pointer, { ...bounds, width: 390 }), null);
});

test("nearly full-width roof/property editors do not dock during an ordinary downward drag", () => {
  const full = { left: 38, top: 180, width: 1424, height: 620 };
  assert.equal(edgeDockTarget(full, { x: 250, y: 200 }, bounds), null);
  assert.equal(edgeDockTarget(full, { x: 48, y: 200 }, bounds), "LEFT");
  assert.equal(edgeDockTarget(full, { x: 1460, y: 200 }, bounds), "RIGHT");
});
