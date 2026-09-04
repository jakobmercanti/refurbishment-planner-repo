export const DEFAULT_FLOATING_WINDOW_WIDTH = 340;
export const MIN_FLOATING_WINDOW_WIDTH = 220;
export const MIN_FLOATING_WINDOW_HEIGHT = 96;
export const FLOATING_WINDOW_MARGIN = 8;

export type FloatingWindowResizeEdge = "LEFT" | "RIGHT" | "BOTTOM";

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
): FloatingWindowBox {
  if (edge === "BOTTOM") {
    const maximumHeight = Math.max(0, workspace.height - box.top - FLOATING_WINDOW_MARGIN);
    const minimumHeight = Math.min(MIN_FLOATING_WINDOW_HEIGHT, maximumHeight);
    return { ...box, height: clamp(box.height + delta.y, minimumHeight, maximumHeight) };
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
