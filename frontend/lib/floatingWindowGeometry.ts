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
