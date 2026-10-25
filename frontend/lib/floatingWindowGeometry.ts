export const DEFAULT_FLOATING_WINDOW_WIDTH = 340;
export const MIN_FLOATING_WINDOW_WIDTH = 220;
export const MIN_FLOATING_WINDOW_HEIGHT = 96;
export const FLOATING_WINDOW_MARGIN = 8;

/** Offset-parent coordinates clipped to the actual browser/visual viewport. */
export function visibleFloatingWorkspace(parent: { left: number; top: number; width: number; height: number }, viewport: { left: number; top: number; width: number; height: number }) {
  const left = Math.max(0, viewport.left - parent.left);
  const top = Math.max(0, viewport.top - parent.top);
  return { left, top, right: Math.max(left, Math.min(parent.width, viewport.left + viewport.width - parent.left)), bottom: Math.max(top, Math.min(parent.height, viewport.top + viewport.height - parent.top)) };
}

/** Divide the usable workspace after reserving the pinned floor-selector strip. */
export function floatingDockLayout(slot: number, slots: number, fill = false) {
  const count = Math.max(1, slots);
  const index = Math.max(0, Math.min(count - 1, slot));
  const inset = "var(--floating-toolbar-top-inset, 0px)";
  return {
    top: `calc(${index * 100 / count}% + (${inset} * ${1 - index / count}) + ${fill ? 8 - 16 * index / count : 8 * (1 - index / count)}px)`,
    height: `calc(${100 / count}% - (${inset} / ${count}) - ${(fill ? 16 : 8 * (count + 1)) / count}px)`,
  };
}

export type FloatingWindowResizeEdge = "TOP" | "LEFT" | "RIGHT" | "BOTTOM";

export interface FloatingWindowBox {
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface FloatingWindowWorkspace {
  width: number;
  height: number;
}

export type WindowDockSide = "LEFT" | "RIGHT";
export interface WindowDockEntry {
  id: string;
  side: WindowDockSide;
  width: number;
}

/** Free screen-space rectangle shared by the viewer and all floating tools. */
export function floatingWindowArea(bounds: FloatingWindowBox, left = 0, right = 0): FloatingWindowBox {
  const reservedLeft = Math.max(0, Math.min(bounds.width, left));
  const reservedRight = Math.max(0, Math.min(bounds.width - reservedLeft, right));
  return { ...bounds, left: bounds.left + reservedLeft, width: bounds.width - reservedLeft - reservedRight };
}

export function maximizedFloatingWindow(bounds: FloatingWindowBox): FloatingWindowBox {
  const marginX = Math.min(FLOATING_WINDOW_MARGIN, bounds.width / 2);
  const marginY = Math.min(FLOATING_WINDOW_MARGIN, bounds.height / 2);
  return { left: bounds.left + marginX, top: bounds.top + marginY, width: Math.max(0, bounds.width - 2 * marginX), height: Math.max(0, bounds.height - 2 * marginY) };
}

/** UI pixels only. Keep room/model coordinates independent of window layout. */
export function edgeDockLayout(bounds: FloatingWindowBox, entries: WindowDockEntry[]) {
  const boxes: Record<string, FloatingWindowBox> = {};
  const enabled = bounds.width >= 720 && bounds.height >= 280;
  if (!enabled) return { enabled, left: 0, right: 0, boxes };
  const sides = (["LEFT", "RIGHT"] as const).map(side => entries.filter(entry => entry.side === side));
  const widths = sides.map(items => items.length ? Math.max(MIN_FLOATING_WINDOW_WIDTH, Math.min(560, bounds.width * .42, Math.max(...items.map(item => Number.isFinite(item.width) ? item.width : DEFAULT_FLOATING_WINDOW_WIDTH)))) : 0);
  // Two rails must still leave a usable view, including their outer/inner gaps.
  const minimumView = Math.min(320, bounds.width - 2 * (MIN_FLOATING_WINDOW_WIDTH + 16));
  const budget = bounds.width - minimumView - widths.filter(Boolean).length * 16;
  const excess = Math.max(0, widths[0] + widths[1] - budget);
  const adjustable = widths.map(width => Math.max(0, width - MIN_FLOATING_WINDOW_WIDTH));
  const total = adjustable[0] + adjustable[1];
  if (excess && total) widths.forEach((width, index) => { widths[index] = width - excess * adjustable[index] / total; });
  sides.forEach((items, side) => {
    const height = (bounds.height - 16 - Math.max(0, items.length - 1) * 8) / Math.max(1, items.length);
    items.forEach((entry, index) => {
      boxes[entry.id] = { left: side ? bounds.left + bounds.width - widths[side] - 8 : bounds.left + 8, top: bounds.top + 8 + index * (height + 8), width: widths[side], height };
    });
  });
  return { enabled, left: widths[0] ? widths[0] + 16 : 0, right: widths[1] ? widths[1] + 16 : 0, boxes };
}

/** Use the dragged window edge, not just the pointer (often in the title's centre). */
export function edgeDockTarget(box: FloatingWindowBox, pointer: { x: number; y: number }, bounds: FloatingWindowBox): WindowDockSide | null {
  if (bounds.width < 720 || bounds.height < 280 || pointer.y < bounds.top || pointer.y > bounds.top + bounds.height || pointer.x < bounds.left - 32 || pointer.x > bounds.left + bounds.width + 32) return null;
  // A nearly full-width editor already touches a side during ordinary vertical
  // movement. Require its pointer to reach the edge, as desktop snap layouts do.
  const wide = box.width >= bounds.width * .8;
  const left = box.left - bounds.left <= 20 && (!wide || pointer.x <= bounds.left + 40);
  const right = bounds.left + bounds.width - box.left - box.width <= 20 && (!wide || pointer.x >= bounds.left + bounds.width - 40);
  if (left && right) return pointer.x < bounds.left + bounds.width / 2 ? "LEFT" : "RIGHT";
  return left ? "LEFT" : right ? "RIGHT" : null;
}

function clamp(value: number, minimum: number, maximum: number) {
  return Math.max(minimum, Math.min(maximum, value));
}

/** Resize one edge while keeping the window inside its workspace. */
export function resizeFloatingWindow(
  box: FloatingWindowBox,
  edge: FloatingWindowResizeEdge,
  delta: { x: number; y: number },
  workspace: FloatingWindowWorkspace,
  minimumHeight = MIN_FLOATING_WINDOW_HEIGHT,
): FloatingWindowBox {
  if (edge === "TOP") {
    const fixedBottom = box.top + box.height;
    const maximumHeight = Math.max(0, fixedBottom - FLOATING_WINDOW_MARGIN);
    const boundedMinimumHeight = Math.min(minimumHeight, maximumHeight);
    const height = clamp(box.height - delta.y, boundedMinimumHeight, maximumHeight);
    return { ...box, top: fixedBottom - height, height };
  }

  if (edge === "BOTTOM") {
    const maximumHeight = Math.max(0, workspace.height - box.top - FLOATING_WINDOW_MARGIN);
    const boundedMinimumHeight = Math.min(minimumHeight, maximumHeight);
    return { ...box, height: clamp(box.height + delta.y, boundedMinimumHeight, maximumHeight) };
  }

  if (edge === "RIGHT") {
    const maximumWidth = Math.max(0, workspace.width - box.left - FLOATING_WINDOW_MARGIN);
    const minimumWidth = Math.min(MIN_FLOATING_WINDOW_WIDTH, maximumWidth);
    return { ...box, width: clamp(box.width + delta.x, minimumWidth, maximumWidth) };
  }

  const fixedRight = box.left + box.width;
  const maximumWidth = Math.max(0, fixedRight - FLOATING_WINDOW_MARGIN);
  const minimumWidth = Math.min(MIN_FLOATING_WINDOW_WIDTH, maximumWidth);
  const width = clamp(box.width - delta.x, minimumWidth, maximumWidth);
  return { ...box, left: fixedRight - width, width };
}
