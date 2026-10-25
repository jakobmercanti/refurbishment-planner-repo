"use client";

import { useLayoutEffect, useState, useSyncExternalStore, type RefObject } from "react";
import { edgeDockLayout, floatingWindowArea, visibleFloatingWorkspace, type FloatingWindowBox, type WindowDockEntry, type WindowDockSide } from "./floatingWindowGeometry";
import { windowViewport } from "./windowViewport";

type Entry = WindowDockEntry & { panel: HTMLElement };
interface Snapshot {
  bounds: FloatingWindowBox;
  freeBounds: FloatingWindowBox;
  hasRails: boolean;
  enabled: boolean;
  boxes: Record<string, FloatingWindowBox>;
  sides: Record<string, WindowDockSide>;
  preview: { id: string; side: WindowDockSide; box: FloatingWindowBox } | null;
}
const EMPTY_BOUNDS = { left: 0, top: 0, width: 0, height: 0 };
const EMPTY: Snapshot = { bounds: EMPTY_BOUNDS, freeBounds: EMPTY_BOUNDS, hasRails: false, enabled: false, boxes: {}, sides: {}, preview: null };
const managers = new WeakMap<HTMLElement, DockManager>();
const subscribeNothing = () => () => {};
const emptySnapshot = () => EMPTY;
let nextWindowId = 0;

/** One session-only layout per workbench, shared by native and portalled windows.
 * Only viewport CSS changes; no project data, camera or model geometry is mutated.
 */
class DockManager {
  private entries = new Map<string, Entry>();
  private panels = new Map<string, HTMLElement>();
  private listeners = new Set<() => void>();
  private pending: WindowDockEntry | null = null;
  private snapshot = EMPTY;
  private signature = "";
  private frame = 0;
  private resize: ResizeObserver;
  private mutation: MutationObserver;

  constructor(private root: HTMLElement) {
    this.resize = new ResizeObserver(this.schedule);
    this.resize.observe(root);
    this.mutation = new MutationObserver(this.schedule);
    // Workbenches/2D views stay mounted while hidden. Hidden windows reserve no space.
    this.mutation.observe(root, { attributes: true, attributeFilter: ["hidden", "data-dock-workspace-hidden"], subtree: true });
    window.addEventListener("resize", this.schedule);
    window.addEventListener("scroll", this.schedule, true);
    window.visualViewport?.addEventListener("resize", this.schedule);
    window.visualViewport?.addEventListener("scroll", this.schedule);
  }

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  };
  read = () => this.snapshot;
  private schedule = () => {
    if (!this.frame) this.frame = requestAnimationFrame(() => { this.frame = 0; this.refresh(); });
  };
  private setInset(name: string, value: number) {
    const text = `${value}px`;
    if (this.root.style.getPropertyValue(name) !== text) this.root.style.setProperty(name, text);
  }
  private refresh = () => {
    const rect = this.root.getBoundingClientRect();
    const visible = visibleFloatingWorkspace(rect, windowViewport());
    const bounds = { left: rect.left + visible.left, top: rect.top + visible.top, width: visible.right - visible.left, height: visible.bottom - visible.top };
    const shown = [...this.entries.values()].filter(entry => entry.panel.isConnected && entry.panel.getClientRects().length && !entry.panel.closest("[hidden]"));
    const layout = edgeDockLayout(bounds, shown);
    const pending = this.pending;
    const previewBox = pending && edgeDockLayout(bounds, [...shown.filter(entry => entry.id !== pending.id), pending]).boxes[pending.id];
    const next: Snapshot = { bounds, freeBounds: floatingWindowArea(bounds, layout.left, layout.right), hasRails: !!(layout.left || layout.right), enabled: layout.enabled, boxes: layout.boxes, sides: Object.fromEntries([...this.entries.values()].map(entry => [entry.id, entry.side])), preview: pending && previewBox ? { id: pending.id, side: pending.side, box: previewBox } : null };
    this.setInset("--workspace-dock-left", layout.left);
    this.setInset("--workspace-dock-right", layout.right);
    const signature = JSON.stringify(next);
    if (signature === this.signature) return;
    this.signature = signature;
    this.snapshot = next;
    this.listeners.forEach(listener => listener());
  };
  register(panel: HTMLElement) {
    const id = `window-${++nextWindowId}`;
    this.panels.set(id, panel);
    this.resize.observe(panel);
    this.refresh();
    return id;
  }
  remove(id: string) {
    const panel = this.panels.get(id);
    if (panel) this.resize.unobserve(panel);
    this.panels.delete(id);
    this.entries.delete(id);
    if (this.pending?.id === id) this.pending = null;
    this.refresh();
    if (this.panels.size) return;
    cancelAnimationFrame(this.frame);
    this.resize.disconnect();
    this.mutation.disconnect();
    window.removeEventListener("resize", this.schedule);
    window.removeEventListener("scroll", this.schedule, true);
    window.visualViewport?.removeEventListener("resize", this.schedule);
    window.visualViewport?.removeEventListener("scroll", this.schedule);
    this.root.style.removeProperty("--workspace-dock-left");
    this.root.style.removeProperty("--workspace-dock-right");
    managers.delete(this.root);
  }
  attach(id: string, side: WindowDockSide, width: number) {
    const panel = this.panels.get(id);
    if (!panel || !this.snapshot.enabled) return;
    this.entries.set(id, { id, panel, side, width });
    this.pending = null;
    this.refresh();
  }
  detach(id: string) {
    this.entries.delete(id);
    if (this.pending?.id === id) this.pending = null;
    this.refresh();
  }
  preview(id: string, side: WindowDockSide | null, width: number) {
    this.pending = side ? { id, side, width } : null;
    this.refresh();
  }
  resizeWindow(id: string, width: number) {
    const entry = this.entries.get(id);
    if (!entry) return;
    // A side is one rail. Resize every stacked window, rather than letting a
    // wider sibling silently prevent the dragged edge from moving inward.
    this.entries.forEach(item => { if (item.side === entry.side) item.width = width; });
    this.refresh();
  }
}

export function useWindowDocking(panel: RefObject<HTMLElement | null>) {
  const [connection, setConnection] = useState<{ manager: DockManager; id: string } | null>(null);
  useLayoutEffect(() => {
    const node = panel.current;
    // Blocking confirmation dialogs must remain modal, not become docked tools.
    if (!node || node.closest("dialog,[aria-modal=true]")) return;
    const root = node.closest<HTMLElement>("[data-dock-workspace]") ?? [...document.querySelectorAll<HTMLElement>("[data-dock-workspace]")].find(candidate => candidate.getClientRects().length > 0);
    if (!root) return;
    let manager = managers.get(root);
    if (!manager) { manager = new DockManager(root); managers.set(root, manager); }
    const id = manager.register(node);
    // The DOM/portal host is known only after mount. Publish the external
    // connection on the next frame instead of cascading a layout-effect render.
    const frame = requestAnimationFrame(() => setConnection({ manager, id }));
    return () => { cancelAnimationFrame(frame); manager.remove(id); };
  }, [panel]);
  const snapshot = useSyncExternalStore(connection?.manager.subscribe ?? subscribeNothing, connection?.manager.read ?? emptySnapshot, emptySnapshot);
  return {
    supported: !!connection,
    inactive: !!connection && (!snapshot.bounds.width || !snapshot.bounds.height),
    enabled: snapshot.enabled,
    bounds: snapshot.bounds,
    freeBounds: snapshot.freeBounds,
    hasRails: snapshot.hasRails,
    box: connection ? snapshot.boxes[connection.id] : undefined,
    side: connection ? snapshot.sides[connection.id] : undefined,
    preview: connection && snapshot.preview?.id === connection.id ? snapshot.preview : null,
    attach: (side: WindowDockSide, width: number) => connection?.manager.attach(connection.id, side, width),
    detach: () => connection?.manager.detach(connection.id),
    showPreview: (side: WindowDockSide | null, width: number) => connection?.manager.preview(connection.id, side, width),
    resize: (width: number) => connection?.manager.resizeWindow(connection.id, width),
  };
}
