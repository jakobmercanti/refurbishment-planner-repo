"use client";

import { useLayoutEffect, useRef, type RefObject } from "react";

type Entry = { panel: HTMLElement; owner: HTMLElement | null; requested: boolean; inert: boolean; restore?: () => void };
const windows = new Map<HTMLElement, Entry>();
let active: HTMLElement | null = null;
let lastFocused: HTMLElement | null = null;
let observer: MutationObserver | null = null;
let frame = 0;

function belongsTo(panel: HTMLElement, parent: HTMLElement): boolean {
  const visited = new Set<HTMLElement>();
  for (let node: HTMLElement | null = panel; node && !visited.has(node); node = windows.get(node)?.owner ?? null) {
    if (node === parent || parent.contains(node)) return true;
    visited.add(node);
  }
  return false;
}
function visible(panel: HTMLElement) { return panel.isConnected && !!panel.getClientRects().length && !panel.closest("[hidden]"); }
function sync() {
  active = [...windows.values()].filter(entry => entry.requested && visible(entry.panel)).at(-1)?.panel ?? null;
  document.body.toggleAttribute("data-window-fullscreen", !!active);
  const viewport = window.visualViewport;
  for (const [key, value] of Object.entries({ left: viewport?.offsetLeft ?? 0, top: viewport?.offsetTop ?? 0, width: viewport?.width ?? document.documentElement.clientWidth, height: viewport?.height ?? window.innerHeight })) {
    const name = `--window-focus-${key}`, text = `${value}px`;
    if (document.body.style.getPropertyValue(name) !== text) document.body.style.setProperty(name, text);
  }
  let overlay = 0;
  windows.forEach(entry => {
    const { panel } = entry;
    const blocked = !!active && !belongsTo(panel, active) && !panel.contains(active);
    panel.toggleAttribute("data-window-focus-active", panel === active);
    panel.toggleAttribute("data-window-focus-blocked", blocked);
    panel.toggleAttribute("data-window-focus-overlay", !!active && !blocked && panel !== active);
    panel.inert = blocked || entry.inert;
    if (active && !blocked && panel !== active) {
      const index = String(++overlay);
      if (panel.style.getPropertyValue("--window-focus-overlay-index") !== index) panel.style.setProperty("--window-focus-overlay-index", index);
    } else panel.style.removeProperty("--window-focus-overlay-index");
  });
}
function schedule() {
  if (!frame && [...windows.values()].some(entry => entry.requested)) frame = requestAnimationFrame(() => { frame = 0; sync(); });
}
function focused(event: FocusEvent) {
  if (!(event.target instanceof Node)) return;
  const found = [...windows.keys()].reverse().find(panel => panel.contains(event.target as Node));
  if (found) lastFocused = found;
}
function escape(event: KeyboardEvent) {
  if (event.key !== "Escape" || event.defaultPrevented || !active) return;
  // Menus, related editors/help and an in-progress drag get first refusal.
  if ([...document.querySelectorAll<HTMLElement>(":popover-open,[data-window-dragging],[role=menu]")].some(node => node.getClientRects().length)) return;
  if ([...windows.keys()].some(panel => panel !== active && belongsTo(panel, active!) && visible(panel) && getComputedStyle(panel).visibility !== "hidden")) return;
  const restore = windows.get(active)?.restore;
  if (restore) { event.preventDefault(); event.stopImmediatePropagation(); restore(); }
}
function install() {
  if (observer) return;
  observer = new MutationObserver(schedule);
  observer.observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ["hidden", "open", "style", "class"] });
  document.addEventListener("focusin", focused, true);
  document.addEventListener("keydown", escape, true);
  window.addEventListener("resize", schedule);
  window.visualViewport?.addEventListener("resize", schedule);
  window.visualViewport?.addEventListener("scroll", schedule);
}
function register(panel: HTMLElement) {
  install();
  const focusedPanel = [...windows.keys()].reverse().find(node => node.contains(document.activeElement)) ?? lastFocused;
  const owner = active && focusedPanel && belongsTo(focusedPanel, active) ? focusedPanel : null;
  windows.set(panel, { panel, owner, requested: false, inert: panel.inert });
  sync();
  return () => {
    const entry = windows.get(panel);
    if (entry) panel.inert = entry.inert;
    windows.delete(panel);
    for (const attribute of ["data-window-focus-active", "data-window-focus-blocked", "data-window-focus-overlay"]) panel.removeAttribute(attribute);
    panel.style.removeProperty("--window-focus-overlay-index");
    if (lastFocused === panel) lastFocused = null;
    sync();
    if (windows.size) return;
    observer?.disconnect(); observer = null;
    cancelAnimationFrame(frame); frame = 0;
    document.removeEventListener("focusin", focused, true);
    document.removeEventListener("keydown", escape, true);
    window.removeEventListener("resize", schedule);
    window.visualViewport?.removeEventListener("resize", schedule);
    window.visualViewport?.removeEventListener("scroll", schedule);
    for (const key of ["left", "top", "width", "height"]) document.body.style.removeProperty(`--window-focus-${key}`);
  };
}

/** Session-only presentation. Hidden windows retain their layout, draft and
 * original inert state. Editors opened by the maximised window remain usable,
 * including portalled help and dialogs; closing/restoring unwinds the mode. */
export function useWindowFocusMode(ref: RefObject<HTMLElement | null>, maximized: boolean, dialogButton = false, onRestore?: () => void) {
  const restore = useRef(onRestore);
  useLayoutEffect(() => { restore.current = onRestore; });
  useLayoutEffect(() => {
    const node = ref.current;
    const panel = dialogButton ? node?.closest(".window-header-actions")?.closest<HTMLElement>("[role=dialog],dialog") : node;
    if (!panel || dialogButton && panel.classList.contains("floating-toolbar")) return;
    const remove = register(panel);
    windows.get(panel)!.restore = () => restore.current?.();
    return () => { remove(); if (dialogButton) panel.removeAttribute("data-window-maximized"); };
  }, [ref, dialogButton]);
  useLayoutEffect(() => {
    const node = ref.current;
    const panel = dialogButton ? node?.closest(".window-header-actions")?.closest<HTMLElement>("[role=dialog],dialog") : node;
    if (!panel || dialogButton && panel.classList.contains("floating-toolbar") || !windows.has(panel)) return;
    windows.get(panel)!.requested = maximized;
    if (dialogButton) panel.toggleAttribute("data-window-maximized", maximized);
    sync();
  }, [ref, maximized, dialogButton]);
}
