"use client";

import { useRef, useSyncExternalStore, type PointerEvent, type MouseEvent } from "react";
import { MOUSE } from "three";
import { getNavigationSnapshot, subscribeNavigation, type NavigationPreference } from "./appPreferences";

const BUTTONS = {
  STANDARD: { LEFT: MOUSE.ROTATE, MIDDLE: MOUSE.DOLLY, RIGHT: MOUSE.PAN },
  CAD: { LEFT: MOUSE.PAN, MIDDLE: MOUSE.DOLLY, RIGHT: MOUSE.ROTATE },
  BLENDER: { LEFT: undefined, MIDDLE: MOUSE.ROTATE, RIGHT: MOUSE.PAN },
} as const;
export const navigationButtons = (preference: NavigationPreference) => BUTTONS[preference];
export function useViewerNavigation() {
  return navigationButtons(useSyncExternalStore(subscribeNavigation, getNavigationSnapshot, () => "STANDARD" as const));
}

/** Open on release, never on Windows' contextmenu-at-press event. A secondary
 * drag belongs to OrbitControls; keyboard and touch context menus still work. */
export function useViewerContextMenu(isSurface: (target: Element) => boolean, open: (point: { x: number; y: number }) => void, dismiss: () => void) {
  const press = useRef<{ id: number; x: number; y: number; moved: boolean; released: boolean } | null>(null);
  return {
    onPointerDownCapture(event: PointerEvent<HTMLElement>) {
      press.current = null;
      if (event.button !== 2 || !(event.target instanceof Element) || !isSurface(event.target)) return;
      press.current = { id: event.pointerId, x: event.clientX, y: event.clientY, moved: false, released: false };
      dismiss();
    },
    onPointerMoveCapture(event: PointerEvent<HTMLElement>) {
      const at = press.current;
      if (at && !at.released && at.id === event.pointerId && Math.hypot(event.clientX - at.x, event.clientY - at.y) > 5) at.moved = true;
    },
    onPointerUpCapture(event: PointerEvent<HTMLElement>) {
      const at = press.current;
      if (!at || at.released || at.id !== event.pointerId || event.button !== 2) return;
      at.released = true;
      if (!at.moved) open({ x: event.clientX, y: event.clientY });
    },
    onPointerCancelCapture() { press.current = null; },
    onContextMenu(event: MouseEvent<HTMLElement>) {
      if (!(event.target instanceof Element) || !isSurface(event.target)) return;
      event.preventDefault();
      if (event.button !== 2 || !press.current) open({ x: event.clientX, y: event.clientY });
    },
  };
}
