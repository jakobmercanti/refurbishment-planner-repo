import assert from "node:assert/strict";
import test from "node:test";
import { windowViewport } from "../lib/windowViewport";

function viewportWithMenu(visual: { offsetLeft: number; offsetTop: number; width: number; height: number } | null, menu: { top: number; bottom: number } | null) {
  const previousWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
  const previousDocument = Object.getOwnPropertyDescriptor(globalThis, "document");
  try {
    Object.defineProperty(globalThis, "window", { configurable: true, value: { visualViewport: visual, innerHeight: 900 } });
    Object.defineProperty(globalThis, "document", { configurable: true, value: { documentElement: { clientWidth: 1440 }, querySelector: () => menu ? { getBoundingClientRect: () => menu } : null } });
    return windowViewport();
  } finally {
    if (previousWindow) Object.defineProperty(globalThis, "window", previousWindow); else Reflect.deleteProperty(globalThis, "window");
    if (previousDocument) Object.defineProperty(globalThis, "document", previousDocument); else Reflect.deleteProperty(globalThis, "document");
  }
}

test("maximised/docked tools cannot use the area covered by the persistent app menu", () => {
  assert.deepEqual(viewportWithMenu(null, { top: 0, bottom: 97 }), { left: 0, top: 97, width: 1440, height: 803 });
  assert.deepEqual(viewportWithMenu(null, { top: -20, bottom: 48 }), { left: 0, top: 48, width: 1440, height: 852 });
});

test("visual viewport offsets and keyboard clipping preserve usable dimensions", () => {
  assert.deepEqual(viewportWithMenu({ offsetLeft: 12, offsetTop: 20, width: 390, height: 300 }, { top: 0, bottom: 97 }), { left: 12, top: 97, width: 390, height: 223 });
  assert.deepEqual(viewportWithMenu({ offsetLeft: 0, offsetTop: 0, width: 390, height: 40 }, { top: 0, bottom: 97 }), { left: 0, top: 40, width: 390, height: 0 });
});

test("hidden, absent or offscreen menus do not reserve viewport space", () => {
  for (const menu of [null, { top: -100, bottom: -3 }, { top: 1000, bottom: 1100 }, { top: 0, bottom: 0 }]) {
    assert.deepEqual(viewportWithMenu(null, menu), { left: 0, top: 0, width: 1440, height: 900 });
  }
});
