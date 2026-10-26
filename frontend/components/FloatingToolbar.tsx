"use client";

import { type CSSProperties, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent, type ReactNode, useEffect, useId, useLayoutEffect, useRef, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { DEFAULT_FLOATING_WINDOW_WIDTH, FLOATING_WINDOW_MARGIN, MIN_FLOATING_WINDOW_HEIGHT, edgeDockTarget, floatingDockLayout, maximizedFloatingWindow, resizeFloatingWindow, visibleFloatingWorkspace, type FloatingWindowBox, type FloatingWindowResizeEdge, type WindowDockSide } from "@/lib/floatingWindowGeometry";
import { useWindowDocking } from "@/lib/windowDocking";
import { windowViewport } from "@/lib/windowViewport";
import { useWindowFocusMode } from "@/lib/windowFocusMode";
import { WindowIcon } from "@/components/WindowIcon";
import { WindowHelpButton } from "@/components/WindowHelpButton";
import { useCompactWorkspace } from "@/lib/useCompactWorkspace";
import { useServiceMenuHelp } from "@/lib/serviceMenuHelp";
import type { WindowHelpStep } from "@/lib/windowHelp";

export interface ToolbarDock {
  side: "LEFT" | "RIGHT";
  slot: number;
  slots: number;
  fill?: boolean;
  top?: string | number;
  width?: string | number;
  height?: string | number;
}

export function filledToolbarDock(side: ToolbarDock["side"], visibleIds: string[], activeId: string): ToolbarDock {
  return {
    side,
    slot: Math.max(0, visibleIds.indexOf(activeId)),
    slots: Math.max(1, visibleIds.length),
    fill: true,
  };
}

export function positionedToolbarDock(side: ToolbarDock["side"], top: string | number | undefined, height: string | number | undefined, width?: string | number): ToolbarDock {
  return { side, slot: 0, slots: 1, top, height, width };
}

interface FloatingToolbarProps {
  title: string;
  headerContent?: ReactNode;
  help?: boolean;
  helpTitle?: string;
  helpSteps?: WindowHelpStep[];
  children: ReactNode;
  footer?: ReactNode;
  dialog?: boolean;
  hidden?: boolean;
  className?: string;
  compact?: boolean;
  initialSize?: { width: number; height?: number | null };
  defaultPosition: { x: number; y: number };
  maxHeight?: number;
  dock?: ToolbarDock;
  layoutResetKey?: number;
  bringToFront?: boolean;
  /** Increment to raise an already-open window without remounting its draft. */
  focusRequest?: number;
  onClose: () => void;
}

let floatingPanelStack: HTMLElement[] = [];
let minimizedIds: string[] = [];
const minimizedListeners = new Set<() => void>();
function setWindowMinimized(id: string, minimized: boolean) {
  minimizedIds = minimizedIds.filter(value => value !== id);
  if (minimized) minimizedIds.push(id);
  minimizedListeners.forEach(listener => listener());
}
const subscribeMinimized = (listener: () => void) => { minimizedListeners.add(listener); return () => { minimizedListeners.delete(listener); }; };
const minimizedSnapshot = () => minimizedIds.join(",");

function reindexFloatingPanels() {
  floatingPanelStack = floatingPanelStack.filter((panel) => panel.isConnected);
  floatingPanelStack.forEach((panel, index) => {
    panel.style.zIndex = String(21 + index);
  });
}

function bringFloatingPanelToFront(panel: HTMLElement) {
  floatingPanelStack = floatingPanelStack.filter((current) => current !== panel && current.isConnected);
  floatingPanelStack.push(panel);
  reindexFloatingPanels();
}

function registerBackgroundPanel(panel: HTMLElement) {
  floatingPanelStack = [panel, ...floatingPanelStack.filter(current => current !== panel && current.isConnected)];
  reindexFloatingPanels();
}

function removeFloatingPanel(panel: HTMLElement) {
  floatingPanelStack = floatingPanelStack.filter((current) => current !== panel);
  reindexFloatingPanels();
}

function getToolbarWorkspace(panel: HTMLElement) {
  if (panel.offsetParent instanceof HTMLElement) return panel.offsetParent;
  let ancestor = panel.parentElement;
  while (ancestor) {
    const bounds = ancestor.getBoundingClientRect();
    const styles = window.getComputedStyle(ancestor);
    if (styles.display !== "contents" && styles.position !== "static" && bounds.width > 0 && bounds.height > 0) return ancestor;
    ancestor = ancestor.parentElement;
  }
  return panel.parentElement;
}

function getVisibleWorkspace(parent: HTMLElement) {
  return visibleFloatingWorkspace(parent.getBoundingClientRect(), windowViewport());
}

function getContentMinimumHeight(panel: HTMLElement, maxHeight: number, compact = false) {
  const titlebar = panel.querySelector<HTMLElement>(".floating-toolbar-titlebar");
  const content = panel.querySelector<HTMLElement>(".floating-toolbar-content");
  if (!titlebar || !content) return MIN_FLOATING_WINDOW_HEIGHT;
  const panelStyles = window.getComputedStyle(panel);
  const borders = Number.parseFloat(panelStyles.borderTopWidth || "0") + Number.parseFloat(panelStyles.borderBottomWidth || "0");
  if (compact) return Math.ceil(titlebar.getBoundingClientRect().height + borders);

  const contentStyles = window.getComputedStyle(content);
  const margins = Number.parseFloat(contentStyles.marginTop || "0") + Number.parseFloat(contentStyles.marginBottom || "0");
  const inlineStyle = content.getAttribute("style");
  // Intrinsic measurement temporarily removes scroll constraints. Browsers can
  // clamp BOTH this scroller and nested panels to zero during that layout.
  // Restore the user's viewport after restoring the constraints, in the same task.
  const scrollers = [content,...content.querySelectorAll<HTMLElement>("*")];
  for(let parent=content.parentElement;parent;parent=parent.parentElement)scrollers.push(parent);
  const scrollPositions=scrollers.filter(node=>node.scrollTop||node.scrollLeft).map(node=>({node,top:node.scrollTop,left:node.scrollLeft}));
  let contentHeight = content.scrollHeight;
  try {
    // A flex item with overflow:auto can report its current viewport height as
    // scrollHeight. Temporarily measure it as an intrinsic block so a docked
    // window does not treat its whole slot as content.
    content.style.flex = "0 0 auto";
    content.style.height = "auto";
    content.style.minHeight = "0";
    content.style.maxHeight = "none";
    content.style.overflow = "visible";
    contentHeight = Math.max(content.scrollHeight, content.getBoundingClientRect().height);
  } finally {
    if (inlineStyle === null) content.removeAttribute("style");
    else content.setAttribute("style", inlineStyle);
    for(const {node,top,left} of scrollPositions){node.scrollTop=top;node.scrollLeft=left;}
  }
  const naturalHeight = titlebar.getBoundingClientRect().height + contentHeight + margins + borders;
  return Math.max(MIN_FLOATING_WINDOW_HEIGHT, Math.min(maxHeight, Math.ceil(naturalHeight)));
}

function getContentHeightWithinWorkspace(panel: HTMLElement, parent: HTMLElement, compact = false) {
  const naturalHeight = getContentMinimumHeight(panel, Number.POSITIVE_INFINITY, compact);
  const visible = getVisibleWorkspace(parent);
  const workspaceHeight = visible.bottom - visible.top;
  if (!workspaceHeight) return naturalHeight;
  const availableHeight = Math.max(MIN_FLOATING_WINDOW_HEIGHT, workspaceHeight - FLOATING_WINDOW_MARGIN * 2);
  return Math.min(naturalHeight, availableHeight);
}

export function FloatingToolbar(props: FloatingToolbarProps) {
  return <FloatingToolbarWindow key={props.layoutResetKey ?? 0} {...props} />;
}

function WindowDockActions({ title, docking, maximized, onMaximize, onMinimize, onDock, onFloat }: { title: string; docking: ReturnType<typeof useWindowDocking>; maximized: boolean; onMaximize: () => void; onMinimize: () => void; onDock: (side: WindowDockSide) => void; onFloat: () => void }) {
  const button = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const [anchor, setAnchor] = useState<{ left: number; top: number } | null>(null);
  useEffect(() => {
    if (!anchor) return;
    const close = (event: PointerEvent) => {
      if (!menu.current?.contains(event.target as Node) && !button.current?.contains(event.target as Node)) setAnchor(null);
    };
    const hide = () => setAnchor(null);
    document.addEventListener("pointerdown", close);
    window.addEventListener("resize", hide);
    menu.current?.querySelector<HTMLButtonElement>("button:not(:disabled)")?.focus();
    return () => { document.removeEventListener("pointerdown", close); window.removeEventListener("resize", hide); };
  }, [anchor]);
  if (docking.inactive) return null;
  return <>
    <button ref={button} type="button" className="floating-toolbar-dock" aria-label={`Window layout for ${title}`} aria-haspopup="menu" aria-expanded={!!anchor} title="Window layout · drag to either side to attach" onClick={() => {
      if (anchor) { setAnchor(null); return; }
      const rect = button.current?.getBoundingClientRect();
      if (rect) setAnchor({ left: Math.max(8, Math.min(rect.right - 180, window.innerWidth - 188)), top: Math.max(8, Math.min(rect.bottom + 4, window.innerHeight - 280)) });
    }}><svg viewBox="0 0 20 20" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><rect x="2" y="3" width="16" height="14" rx="2" /><path d="M8 3v14" /></svg></button>
    {anchor && createPortal(<div ref={menu} className="window-dock-menu" role="menu" aria-label={`${title} window layout`} style={anchor} onKeyDown={event => {
      const items = [...event.currentTarget.querySelectorAll<HTMLButtonElement>("button:not(:disabled)")];
      if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); setAnchor(null); button.current?.focus(); }
      else if (event.key === "Tab") { event.preventDefault(); setAnchor(null); button.current?.focus(); }
      else if (["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
        event.preventDefault();
        const index = items.indexOf(event.target as HTMLButtonElement);
        items[event.key === "Home" ? 0 : event.key === "End" ? items.length - 1 : (index + (event.key === "ArrowDown" ? 1 : -1) + items.length) % items.length]?.focus();
      }
    }}>
      <button type="button" role="menuitem" onClick={() => { onMaximize(); setAnchor(null); button.current?.focus(); }}>{maximized ? "Restore window" : "Maximise window"}</button>
      {(["LEFT", "RIGHT"] as const).map(side => <button key={side} type="button" role="menuitem" disabled={!docking.enabled || docking.side === side} onClick={() => { onDock(side); setAnchor(null); button.current?.focus(); }}>Dock {side.toLowerCase()}</button>)}
      <button type="button" role="menuitem" disabled={!docking.side} onClick={() => { onFloat(); setAnchor(null); button.current?.focus(); }}>Float window</button>
      <button type="button" role="menuitem" onClick={() => { setAnchor(null); onMinimize(); }}>Minimise window</button>
      {!docking.enabled && <small>More screen space is needed to dock.</small>}
    </div>, document.body)}
  </>;
}

function FloatingToolbarWindow({ title, headerContent, help = true, helpTitle = title, helpSteps, children, footer, dialog = false, hidden = false, className = "", compact = false, initialSize, defaultPosition, maxHeight = 560, dock, bringToFront = false, focusRequest, onClose }: FloatingToolbarProps) {
  const windowId = useId();
  const [minimized, setMinimized] = useState(false);
  const minimizedOrder = useSyncExternalStore(subscribeMinimized, minimizedSnapshot, () => "");
  const minimize = () => { setWindowMinimized(windowId, true); setMinimized(true); };
  const restoreMinimized = () => { setWindowMinimized(windowId, false); setMinimized(false); requestAnimationFrame(() => { focusPanel(); panelRef.current?.querySelector<HTMLElement>(".floating-toolbar-titlebar")?.focus({preventScroll:true}); }); };
  useEffect(() => () => setWindowMinimized(windowId, false), [windowId]);
  const compactWorkspace = useCompactWorkspace();
  const panelRef = useRef<HTMLElement>(null);
  const edgeDock = useWindowDocking(panelRef);
  useServiceMenuHelp(panelRef, title);
  const dragRef = useRef<{ pointerX: number; pointerY: number; left: number; top: number; width: number; height: number; moved: boolean; attached?: WindowDockSide; attachedWidth: number; grabFraction: number; candidate: WindowDockSide | null; restore: { x: number; y: number }; legacyDocked: boolean } | null>(null);
  const resizeRef = useRef<{ edge: FloatingWindowResizeEdge; pointerX: number; pointerY: number; left: number; top: number; width: number; height: number; parentWidth: number; parentHeight: number; minimumHeight: number; side?: WindowDockSide } | null>(null);
  const previousBringToFront = useRef(bringToFront);
  const backgroundOnMount = useRef(Boolean(dock) && !bringToFront);
  const foregroundOnMount = useRef(bringToFront);
  const [position, setPosition] = useState(defaultPosition);
  const [size, setSize] = useState<{ width: number; height: number | null }>(() => ({ width: initialSize?.width ?? DEFAULT_FLOATING_WINDOW_WIDTH, height: initialSize?.height ?? null }));
  const [minimumHeight, setMinimumHeight] = useState(compact ? 0 : MIN_FLOATING_WINDOW_HEIGHT);
  const [visibleWorkspace, setVisibleWorkspace] = useState<ReturnType<typeof visibleFloatingWorkspace> | null>(null);
  const [isDocked, setIsDocked] = useState(Boolean(dock));
  const [heightMaximized, setHeightMaximized] = useState(false);
  const heightMaximizeRestoreRef = useRef<{ position: { x: number; y: number }; size: { width: number; height: number | null }; isDocked: boolean } | null>(null);
  const [maximized, setMaximized] = useState(false);
  useWindowFocusMode(panelRef, maximized, false, toggleMaximized);
  const maximizeRestore = useRef<{ side?: WindowDockSide; dockWidth: number } | null>(null);
  const [freeWorkspace, setFreeWorkspace] = useState<FloatingWindowBox | null>(null);
  const [maximizeBounds, setMaximizeBounds] = useState<FloatingWindowBox | null>(null);

  useLayoutEffect(() => {
    const panel = panelRef.current;
    if (!panel) return;
    // Restored docked tools must not cover an independent editor when a floor
    // change remounts the canvas. A click can still raise any window normally.
    if (backgroundOnMount.current) registerBackgroundPanel(panel);
    else bringFloatingPanelToFront(panel);
    // A portalled editor mounts before its React parent's focus-request effect.
    // Finish raising an explicitly opened editor after that parent has settled.
    const frame = foregroundOnMount.current ? requestAnimationFrame(() => bringFloatingPanelToFront(panel)) : null;
    return () => { if(frame!==null)cancelAnimationFrame(frame); removeFloatingPanel(panel); };
  }, []);

  useLayoutEffect(() => {
    if (!bringToFront || previousBringToFront.current) {
      previousBringToFront.current = bringToFront;
      return;
    }
    const panel = panelRef.current;
    if (panel) bringFloatingPanelToFront(panel);
    previousBringToFront.current = bringToFront;
  }, [bringToFront]);

  useLayoutEffect(() => {
    if (focusRequest === undefined) return;
    const panel = panelRef.current;
    if (panel) bringFloatingPanelToFront(panel);
  }, [focusRequest]);

  useLayoutEffect(() => {
    const panel = panelRef.current;
    if (!panel) return;
    const content = panel.querySelector<HTMLElement>(".floating-toolbar-content");
    if (!content) return;
    const updateMinimumHeight = () => {
      // Hidden/minimized windows have no measurable layout. Measuring them as
      // zero would replace the saved intrinsic height and shrink on restore.
      if (!panel.getClientRects().length) return;
      const nextMinimumHeight = getContentMinimumHeight(panel, maxHeight, compact);
      setMinimumHeight((current) => current === nextMinimumHeight ? current : nextMinimumHeight);
      if (!heightMaximized || maximized) return;
      const parent = getToolbarWorkspace(panel);
      if (!parent) return;
      const nextHeight = getContentHeightWithinWorkspace(panel, parent, compact);
      setSize((current) => current.height === nextHeight ? current : { ...current, height: nextHeight });
    };
    updateMinimumHeight();
    const resizeObserver = new ResizeObserver(updateMinimumHeight);
    resizeObserver.observe(panel);
    resizeObserver.observe(content);
    const workspace = getToolbarWorkspace(panel);
    if (workspace) resizeObserver.observe(workspace);
    const mutationObserver = new MutationObserver(updateMinimumHeight);
    mutationObserver.observe(content, { childList: true, subtree: true, characterData: true });
    return () => {
      resizeObserver.disconnect();
      mutationObserver.disconnect();
    };
  }, [compact, heightMaximized, maximized, maxHeight]);

  useLayoutEffect(() => {
    const panel = panelRef.current;
    if (!panel) return;
    const parent = getToolbarWorkspace(panel);
    if (!parent) return;
    const workspacePanel = panel;
    const workspace = parent;

    function keepPanelInsideWorkspace() {
      const panelBounds = workspacePanel.getBoundingClientRect();
      const visible = getVisibleWorkspace(workspace);
      // Workbenches stay mounted while hidden. A zero-size parent is not a
      // real resize: clamping here stacks every window at (8,8) on first use.
      if (visible.right <= visible.left || visible.bottom <= visible.top) return;
      setVisibleWorkspace(current => current && Object.keys(visible).every(key => current[key as keyof typeof current] === visible[key as keyof typeof visible]) ? current : visible);
      const parentBounds = workspace.getBoundingClientRect();
      const area = edgeDock.supported ? edgeDock.freeBounds : { left: parentBounds.left + visible.left, top: parentBounds.top + visible.top, width: visible.right - visible.left, height: visible.bottom - visible.top };
      const nextArea = { ...area, left: area.left - parentBounds.left, top: area.top - parentBounds.top };
      setFreeWorkspace(current => current && Object.keys(nextArea).every(key => current[key as keyof FloatingWindowBox] === nextArea[key as keyof FloatingWindowBox]) ? current : nextArea);
      const full = maximizedFloatingWindow(area);
      setMaximizeBounds(current => current && Object.keys(full).every(key => current[key as keyof FloatingWindowBox] === full[key as keyof FloatingWindowBox]) ? current : full);
      // Automatic reflow is a presentation constraint, not a destructive rewrite
      // of the preferred floating position or dimensions. Removing a rail restores them.
      if (!workspacePanel.getClientRects().length || edgeDock.hasRails || maximized || workspacePanel.hasAttribute("data-window-focus-blocked")) return;
      setPosition((current) => {
        const x = Math.max(visible.left + 8, Math.min(visible.right - Math.min(panelBounds.width, visible.right - visible.left - 16) - 8, current.x));
        const y = Math.max(visible.top + 8, Math.min(visible.bottom - MIN_FLOATING_WINDOW_HEIGHT - 8, current.y));
        return x === current.x && y === current.y ? current : { x, y };
      });
    }

    keepPanelInsideWorkspace();
    const resizeObserver = new ResizeObserver(keepPanelInsideWorkspace);
    resizeObserver.observe(workspace);
    resizeObserver.observe(workspacePanel);
    window.addEventListener("resize", keepPanelInsideWorkspace);
    window.addEventListener("scroll", keepPanelInsideWorkspace, true);
    window.visualViewport?.addEventListener("resize", keepPanelInsideWorkspace);
    window.visualViewport?.addEventListener("scroll", keepPanelInsideWorkspace);
    return () => {
      resizeObserver.disconnect();
      window.removeEventListener("resize", keepPanelInsideWorkspace);
      window.removeEventListener("scroll", keepPanelInsideWorkspace, true);
      window.visualViewport?.removeEventListener("resize", keepPanelInsideWorkspace);
      window.visualViewport?.removeEventListener("scroll", keepPanelInsideWorkspace);
    };
  }, [edgeDock.supported, edgeDock.hasRails, edgeDock.freeBounds, maximized]);

  function focusPanel() {
    if (panelRef.current) bringFloatingPanelToFront(panelRef.current);
  }

  function toggleMaximized() {
    if (maximized) {
      const restore = maximizeRestore.current;
      setMaximized(false);
      if (restore?.side) edgeDock.attach(restore.side, restore.dockWidth);
      maximizeRestore.current = null;
    } else {
      maximizeRestore.current = { side: edgeDock.side, dockWidth: panelRef.current?.getBoundingClientRect().width ?? size.width };
      edgeDock.detach();
      setMaximized(true);
    }
    focusPanel();
  }

  function toggleHeightMaximized(event: ReactMouseEvent<HTMLElement>) {
    if (event.target instanceof Element && event.target.closest("button,input,select,textarea,a")) return;
    if (maximized) { event.preventDefault(); event.stopPropagation(); toggleMaximized(); return; }
    if (compactWorkspace) return;
    if (edgeDock.box) return;
    const panel = panelRef.current;
    if (!panel) return;
    const parent = getToolbarWorkspace(panel);
    if (!parent) return;
    const panelBounds = panel.getBoundingClientRect();
    const parentBounds = parent.getBoundingClientRect();
    event.preventDefault();
    event.stopPropagation();
    focusPanel();

    if (heightMaximized) {
      const restore = heightMaximizeRestoreRef.current;
      if (restore) {
        setPosition(restore.position);
        setSize(restore.size);
        setIsDocked(restore.isDocked);
      }
      heightMaximizeRestoreRef.current = null;
      setHeightMaximized(false);
      return;
    }

    const naturalHeight = getContentMinimumHeight(panel, Number.POSITIVE_INFINITY, compact);
    const nextHeight = getContentHeightWithinWorkspace(panel, parent, compact);
    const left = Math.max(FLOATING_WINDOW_MARGIN, panelBounds.left - parentBounds.left);
    const maximumTop = Math.max(FLOATING_WINDOW_MARGIN, parentBounds.height - nextHeight - FLOATING_WINDOW_MARGIN);
    const top = Math.max(FLOATING_WINDOW_MARGIN, Math.min(maximumTop, panelBounds.top - parentBounds.top));
    heightMaximizeRestoreRef.current = { position, size, isDocked };
    setPosition({ x: left, y: top });
    setSize({ width: panelBounds.width, height: nextHeight });
    setMinimumHeight((current) => current === naturalHeight ? current : naturalHeight);
    setIsDocked(false);
    setHeightMaximized(true);
  }

  function releaseDock(panelBounds: DOMRect, parentBounds: DOMRect) {
    if (!isDocked) return;
    setIsDocked(false);
    setPosition({ x: panelBounds.left - parentBounds.left, y: panelBounds.top - parentBounds.top });
  }

  function beginDrag(event: ReactPointerEvent<HTMLElement>) {
    if (maximized) return;
    if (event.button !== 0 || (event.pointerType === "touch" && !event.isPrimary) || (compactWorkspace && !edgeDock.enabled)) return;
    if (event.target instanceof Element && event.target.closest("button,input,select,textarea,a")) return;
    const panel = panelRef.current;
    if (!panel) return;
    const parent = getToolbarWorkspace(panel);
    if (!parent) return;
    const panelBounds = panel.getBoundingClientRect();
    const parentBounds = parent.getBoundingClientRect();
    dragRef.current = { pointerX: event.clientX, pointerY: event.clientY, left: panelBounds.left - parentBounds.left, top: panelBounds.top - parentBounds.top, width: panelBounds.width, height: panelBounds.height, moved: false, attached: edgeDock.box ? edgeDock.side : undefined, attachedWidth: panelBounds.width, grabFraction: (event.clientX - panelBounds.left) / panelBounds.width, candidate: null, restore: position, legacyDocked: isDocked };
    focusPanel();
    event.currentTarget.focus();
    panel.setAttribute("data-window-dragging", "true");
    event.currentTarget.setPointerCapture(event.pointerId);
    event.preventDefault();
  }

  function dockWindow(side: WindowDockSide) {
    setMaximized(false);
    maximizeRestore.current = null;
    setIsDocked(false);
    setHeightMaximized(false);
    edgeDock.attach(side, size.width);
  }

  function floatWindow() {
    edgeDock.detach();
    setIsDocked(false);
    focusPanel();
  }

  function moveDrag(event: ReactPointerEvent<HTMLElement>) {
    const drag = dragRef.current;
    if (!drag) return;
    if (!drag.moved && Math.hypot(event.clientX - drag.pointerX, event.clientY - drag.pointerY) < 5) return;
    const panel = panelRef.current;
    const parent = panel && getToolbarWorkspace(panel);
    if (!panel || !parent) return;
    let parentBounds = parent.getBoundingClientRect();
    if (!drag.moved) {
      if (drag.attached) {
        // Retain the grab point, but restore the original floating width/height.
        edgeDock.detach();
        parentBounds = parent.getBoundingClientRect();
        drag.width = Math.min(size.width, parentBounds.width - 16);
        drag.left = event.clientX - parentBounds.left - Math.max(16, Math.min(drag.width - 16, drag.width * drag.grabFraction));
        drag.top = event.clientY - parentBounds.top - 20;
        drag.pointerX = event.clientX;
        drag.pointerY = event.clientY;
      }
      setIsDocked(false);
      drag.moved = true;
    }
    const rawX = drag.left + event.clientX - drag.pointerX;
    const rawY = drag.top + event.clientY - drag.pointerY;
    const visible = getVisibleWorkspace(parent);
    const x = Math.max(visible.left + 8, Math.min(visible.right - Math.min(drag.width, visible.right - visible.left - 16) - 8, rawX));
    const y = Math.max(visible.top + 8, Math.min(visible.bottom - MIN_FLOATING_WINDOW_HEIGHT - 8, rawY));
    setPosition({ x, y });
    drag.candidate = edgeDockTarget({ left: parentBounds.left + rawX, top: parentBounds.top + rawY, width: drag.width, height: drag.height }, { x: event.clientX, y: event.clientY }, edgeDock.bounds);
    edgeDock.showPreview(drag.candidate, size.width);
  }

  function endDrag(event: ReactPointerEvent<HTMLElement>) {
    const drag = dragRef.current;
    dragRef.current = null;
    panelRef.current?.removeAttribute("data-window-dragging");
    if (drag?.moved && event.type === "pointerup" && drag.candidate) dockWindow(drag.candidate);
    else if (drag?.moved && event.type !== "pointerup") {
      setPosition(drag.restore);
      setIsDocked(drag.legacyDocked);
      if (drag.attached) edgeDock.attach(drag.attached, drag.attachedWidth);
    }
    edgeDock.showPreview(null, size.width);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  }

  function beginResize(edge: FloatingWindowResizeEdge, event: ReactPointerEvent<HTMLButtonElement>) {
    const panel = panelRef.current;
    if (!panel) return;
    const parent = getToolbarWorkspace(panel);
    if (!parent) return;
    const panelBounds = panel.getBoundingClientRect();
    const parentBounds = parent.getBoundingClientRect();
    if (edgeDock.box) {
      resizeRef.current = { edge, pointerX: event.clientX, pointerY: event.clientY, left: 0, top: 0, width: panelBounds.width, height: panelBounds.height, parentWidth: parentBounds.width, parentHeight: parentBounds.height, minimumHeight: 0, side: edgeDock.side };
      focusPanel();
      event.currentTarget.setPointerCapture(event.pointerId);
      event.stopPropagation();
      event.preventDefault();
      return;
    }
    const contentMinimumHeight = getContentMinimumHeight(panel, maxHeight, compact);
    releaseDock(panelBounds, parentBounds);
    const left = panelBounds.left - parentBounds.left;
    const top = panelBounds.top - parentBounds.top;
    setPosition({ x: left, y: top });
    setSize({ width: panelBounds.width, height: panelBounds.height });
    setMinimumHeight(contentMinimumHeight);
    resizeRef.current = { edge, pointerX: event.clientX, pointerY: event.clientY, left, top, width: panelBounds.width, height: panelBounds.height, parentWidth: parentBounds.width, parentHeight: parentBounds.height, minimumHeight: contentMinimumHeight };
    focusPanel();
    event.currentTarget.setPointerCapture(event.pointerId);
    event.stopPropagation();
    event.preventDefault();
  }

  function moveResize(event: ReactPointerEvent<HTMLButtonElement>) {
    const resize = resizeRef.current;
    if (!resize) return;
    if (resize.side) {
      edgeDock.resize(resize.width + (event.clientX - resize.pointerX) * (resize.side === "LEFT" ? 1 : -1));
      return;
    }
    const next = resizeFloatingWindow(
      { left: resize.left, top: resize.top, width: resize.width, height: resize.height },
      resize.edge,
      { x: event.clientX - resize.pointerX, y: event.clientY - resize.pointerY },
      { width: resize.parentWidth, height: resize.parentHeight },
      resize.minimumHeight,
    );
    setPosition({ x: next.left, y: next.top });
    setSize({ width: next.width, height: next.height });
  }

  function endResize(event: ReactPointerEvent<HTMLButtonElement>) {
    resizeRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  }

  const dockSlots = Math.max(1, dock?.slots ?? 1);
  const dockSlot = Math.max(0, Math.min(dockSlots - 1, dock?.slot ?? 0));
  const dockLayout = dock ? floatingDockLayout(dockSlot, dockSlots, dock.fill) : undefined;
  const slotHeight = dockLayout?.height;
  const dockTop = dockLayout?.top;
  const docked = Boolean(dock && isDocked);
  const dockHeight = dock?.height ?? (dock?.fill ? slotHeight : undefined);
  const appliedMinimumHeight = docked && size.height === null ? undefined : minimumHeight;
  const cssLength = (value: string | number | undefined) => typeof value === "number" ? `${value}px` : value ?? "8px";
  const insetTop = (value: string | number | undefined) => `calc(${cssLength(value)} + var(--floating-toolbar-top-inset, 0px))`;
  const requestedTop = compactWorkspace ? insetTop((visibleWorkspace?.top ?? 0)+8) : heightMaximized ? position.y : docked ? dock?.top!==undefined?insetTop(dock.top):dockTop : position.y;
  // Tall free windows must still move. Their scrollable body shrinks to the
  // remaining viewport instead of pinning the titlebar to its original row.
  const visibleMinimumHeight = MIN_FLOATING_WINDOW_HEIGHT;
  // Reserve the selector strip for automatic layouts only. Once undocked, the
  // user can move a window directly below the main menu, as the drag bounds allow.
  const minimumTop = compactWorkspace || docked ? insetTop((visibleWorkspace?.top ?? 0)+8) : cssLength((visibleWorkspace?.top ?? 0)+8);
  const top = visibleWorkspace ? `clamp(${minimumTop}, ${cssLength(requestedTop)}, max(${minimumTop}, ${Math.max(visibleWorkspace.top + 8, visibleWorkspace.bottom - Math.min(visibleMinimumHeight, visibleWorkspace.bottom - visibleWorkspace.top - 16) - 8)}px))` : requestedTop;
  const availableHeight = visibleWorkspace ? `max(0px, calc(${visibleWorkspace.bottom - 8}px - (${cssLength(top)})))` : "calc(100% - 16px)";
  const preferredMaximum = heightMaximized || size.height !== null ? "calc(100% - 16px)" : docked ? (dock?.height ?? (dock?.fill ? slotHeight : `min(${maxHeight}px, ${slotHeight})`)) : `${maxHeight}px`;
  const style = {
    "--floating-available-height": availableHeight,
    "--floating-visible-top": cssLength(top),
    left: docked ? (dock?.side === "LEFT" ? 8 : undefined) : position.x,
    right: docked && dock?.side === "RIGHT" ? 8 : undefined,
    top,
    width: docked ? (dock?.width ?? size.width) : size.width,
    height: heightMaximized ? size.height ?? "auto" : size.height ?? dockHeight,
    minHeight: heightMaximized || appliedMinimumHeight === undefined ? undefined : `min(${appliedMinimumHeight}px, ${availableHeight})`,
    maxHeight: `min(${cssLength(preferredMaximum)}, ${availableHeight})`,
    zIndex: 20,
    ...(freeWorkspace ? {
      "--window-free-left": `${freeWorkspace.left + 8}px`,
      "--window-free-right": `${freeWorkspace.left + freeWorkspace.width - 8}px`,
      "--window-free-width": `${Math.max(0, freeWorkspace.width - 16)}px`,
      "--window-preferred-width": cssLength(docked ? (dock?.width ?? size.width) : size.width),
      "--window-preferred-left": docked && dock?.side === "RIGHT" ? `calc(100% - (${cssLength(dock?.width ?? size.width)}) - 8px)` : cssLength(docked ? 8 : position.x),
    } : {}),
    ...(maximized && maximizeBounds ? { "--window-max-left": `${maximizeBounds.left}px`, "--window-max-top": `${maximizeBounds.top}px`, "--window-max-width": `${maximizeBounds.width}px`, "--window-max-height": `${maximizeBounds.height}px` } : {}),
    ...(edgeDock.box ? { "--edge-dock-left": `${edgeDock.box.left}px`, "--edge-dock-top": `${edgeDock.box.top}px`, "--edge-dock-width": `${edgeDock.box.width}px`, "--edge-dock-height": `${edgeDock.box.height}px` } : {}),
  } as CSSProperties;
  return <><section ref={panelRef} hidden={hidden || minimized} role={dialog ? "dialog" : undefined} aria-label={dialog ? title : undefined} data-dock-workspace-hidden={edgeDock.inactive || undefined} data-edge-docked={edgeDock.box ? edgeDock.side : undefined} data-dock-capable={edgeDock.enabled || undefined} data-window-reflow={edgeDock.hasRails && !edgeDock.box && freeWorkspace ? true : undefined} data-window-maximized={maximized || undefined} className={`floating-toolbar ${compact ? "floating-toolbar-compact" : ""} ${className}`.trim()} style={style} onFocusCapture={event=>{if(event.currentTarget.contains(event.target as Node))focusPanel();}} onPointerDown={event => { if(!event.currentTarget.contains(event.target as Node))return; event.stopPropagation(); focusPanel(); }}>
    <header className="floating-toolbar-titlebar" tabIndex={0} aria-label={`Move ${title}`} title={`${heightMaximized || maximized ? "Double-click to restore" : "Double-click to maximise height"} · Drag to move ${title} or attach to either side`} onPointerDown={beginDrag} onPointerMove={moveDrag} onPointerUp={endDrag} onPointerCancel={endDrag} onLostPointerCapture={endDrag} onDoubleClick={toggleHeightMaximized} onKeyDown={event => {
      if (event.key !== "Escape" || !dragRef.current) return;
      event.preventDefault(); event.stopPropagation();
      const drag = dragRef.current;
      dragRef.current = null;
      panelRef.current?.removeAttribute("data-window-dragging");
      setPosition(drag.restore); setIsDocked(drag.legacyDocked);
      if (drag.attached) edgeDock.attach(drag.attached, drag.attachedWidth);
      edgeDock.showPreview(null, size.width);
    }}>
      <span className="floating-toolbar-drag" aria-hidden>⠿</span>
      <span className="floating-toolbar-icon"><WindowIcon title={title} /></span>
      <strong>{title}</strong>
      {headerContent && <div className="floating-toolbar-header-content">{headerContent}</div>}
      <div className="window-header-actions"><button type="button" className="floating-toolbar-minimize" aria-label={`Minimise ${title}`} title="Minimise window" onClick={minimize}>−</button><WindowDockActions title={title} docking={edgeDock} maximized={maximized} onMaximize={toggleMaximized} onMinimize={minimize} onDock={dockWindow} onFloat={floatWindow} />{help && <WindowHelpButton title={helpTitle} steps={helpSteps} />}<button type="button" className="floating-toolbar-close" aria-label={`Hide ${title}`} title={`Hide ${title}`} onClick={onClose}>×</button></div>
    </header>
    <div className="floating-toolbar-content" hidden={compact}>{children}</div>
    {footer}
    {(["TOP", "LEFT", "RIGHT", "BOTTOM"] as const).map((edge) => <button key={edge} type="button" tabIndex={-1} className={`floating-toolbar-resize floating-toolbar-resize-${edge.toLowerCase()}`} aria-label={`Resize ${title} from the ${edge.toLowerCase()} edge`} onPointerDown={(event) => beginResize(edge, event)} onPointerMove={moveResize} onPointerUp={endResize} onPointerCancel={endResize} />)}
  </section>{minimized && !hidden && !edgeDock.inactive && createPortal(<button className="floating-window-task" aria-label={`Restore ${title}`} style={{bottom:12 + Math.max(0,minimizedOrder.split(",").indexOf(windowId))*42}} onClick={restoreMinimized}>▣ {title}</button>,document.body)}{edgeDock.preview && createPortal(<div className="window-dock-preview" aria-hidden="true" data-dock-side={edgeDock.preview.side} style={{ left: edgeDock.preview.box.left, top: edgeDock.preview.box.top, width: edgeDock.preview.box.width, height: edgeDock.preview.box.height }}><span>Attach {title} · {edgeDock.preview.side.toLowerCase()}</span></div>, document.body)}</>;
}
