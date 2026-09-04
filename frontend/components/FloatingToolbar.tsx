"use client";

import { type CSSProperties, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent, type ReactNode, useEffect, useRef, useState } from "react";
import { DEFAULT_FLOATING_WINDOW_WIDTH, resizeFloatingWindow, type FloatingWindowResizeEdge } from "@/lib/floatingWindowGeometry";

export interface ToolbarDock {
  side: "LEFT" | "RIGHT";
  slot: number;
  slots: number;
}

interface FloatingToolbarProps {
  title: string;
  children: ReactNode;
  className?: string;
  defaultPosition: { x: number; y: number };
  maxHeight?: number;
  dock?: ToolbarDock;
  layoutResetKey?: number;
  onClose: () => void;
}

let nextFloatingZIndex = 20;

function claimNextFloatingZIndex() {
  nextFloatingZIndex += 1;
  return nextFloatingZIndex;
}

function getToolbarWorkspace(panel: HTMLElement) {
  return panel.offsetParent instanceof HTMLElement ? panel.offsetParent : panel.parentElement;
}

export function FloatingToolbar(props: FloatingToolbarProps) {
  return <FloatingToolbarWindow key={props.layoutResetKey ?? 0} {...props} />;
}

function FloatingToolbarWindow({ title, children, className = "", defaultPosition, maxHeight = 560, dock, onClose }: FloatingToolbarProps) {
  const panelRef = useRef<HTMLElement>(null);
  const dragRef = useRef<{ pointerX: number; pointerY: number; left: number; top: number; parentWidth: number; parentHeight: number; width: number; height: number } | null>(null);
  const resizeRef = useRef<{ edge: FloatingWindowResizeEdge; pointerX: number; pointerY: number; left: number; top: number; width: number; height: number; parentWidth: number; parentHeight: number } | null>(null);
  const mouseDragRef = useRef(false);
  const [position, setPosition] = useState(defaultPosition);
  const [size, setSize] = useState<{ width: number; height: number | null }>({ width: DEFAULT_FLOATING_WINDOW_WIDTH, height: null });
  const [zIndex, setZIndex] = useState(20);
  const [isDocked, setIsDocked] = useState(Boolean(dock));

  useEffect(() => {
    const panel = panelRef.current;
    if (!panel) return;
    const parent = getToolbarWorkspace(panel);
    if (!parent) return;
    const workspacePanel = panel;
    const workspace = parent;

    function keepPanelInsideWorkspace() {
      const panelBounds = workspacePanel.getBoundingClientRect();
      const parentBounds = workspace.getBoundingClientRect();
      setPosition((current) => {
        const x = Math.max(8, Math.min(parentBounds.width - Math.min(panelBounds.width, parentBounds.width - 16) - 8, current.x));
        const y = Math.max(8, Math.min(parentBounds.height - Math.min(panelBounds.height, parentBounds.height - 16) - 8, current.y));
        return x === current.x && y === current.y ? current : { x, y };
      });
    }

    keepPanelInsideWorkspace();
    const resizeObserver = new ResizeObserver(keepPanelInsideWorkspace);
    resizeObserver.observe(workspace);
    resizeObserver.observe(workspacePanel);
    return () => resizeObserver.disconnect();
  }, []);

  useEffect(() => {
    function moveMouseDrag(event: MouseEvent) {
      const drag = dragRef.current;
      if (!mouseDragRef.current || !drag) return;
      const x = Math.max(8, Math.min(drag.parentWidth - Math.min(drag.width, drag.parentWidth - 16) - 8, drag.left + event.clientX - drag.pointerX));
      const y = Math.max(8, Math.min(drag.parentHeight - Math.min(drag.height, drag.parentHeight - 16) - 8, drag.top + event.clientY - drag.pointerY));
      setPosition({ x, y });
    }
    function endMouseDrag() {
      mouseDragRef.current = false;
      dragRef.current = null;
    }
    window.addEventListener("mousemove", moveMouseDrag);
    window.addEventListener("mouseup", endMouseDrag);
    return () => {
      window.removeEventListener("mousemove", moveMouseDrag);
      window.removeEventListener("mouseup", endMouseDrag);
    };
  }, []);

  function focusPanel() {
    setZIndex(claimNextFloatingZIndex());
  }

  function releaseDock(panelBounds: DOMRect, parentBounds: DOMRect) {
    if (!isDocked) return;
    setIsDocked(false);
    setPosition({ x: panelBounds.left - parentBounds.left, y: panelBounds.top - parentBounds.top });
  }

  function beginDrag(event: ReactPointerEvent<HTMLElement>) {
    if (event.target instanceof Element && event.target.closest(".floating-toolbar-close")) return;
    const panel = panelRef.current;
    if (!panel) return;
    const parent = getToolbarWorkspace(panel);
    if (!parent) return;
    const panelBounds = panel.getBoundingClientRect();
    const parentBounds = parent.getBoundingClientRect();
    releaseDock(panelBounds, parentBounds);
    dragRef.current = { pointerX: event.clientX, pointerY: event.clientY, left: panelBounds.left - parentBounds.left, top: panelBounds.top - parentBounds.top, parentWidth: parentBounds.width, parentHeight: parentBounds.height, width: panelBounds.width, height: panelBounds.height };
    focusPanel();
    event.currentTarget.setPointerCapture(event.pointerId);
    event.preventDefault();
  }

  function beginMouseDrag(event: ReactMouseEvent<HTMLElement>) {
    if (event.target instanceof Element && event.target.closest(".floating-toolbar-close")) return;
    if (!dragRef.current) {
      const panel = panelRef.current;
      if (!panel) return;
      const parent = getToolbarWorkspace(panel);
      if (!parent) return;
      const panelBounds = panel.getBoundingClientRect();
      const parentBounds = parent.getBoundingClientRect();
      releaseDock(panelBounds, parentBounds);
      dragRef.current = { pointerX: event.clientX, pointerY: event.clientY, left: panelBounds.left - parentBounds.left, top: panelBounds.top - parentBounds.top, parentWidth: parentBounds.width, parentHeight: parentBounds.height, width: panelBounds.width, height: panelBounds.height };
    }
    mouseDragRef.current = true;
    event.preventDefault();
  }

  function moveDrag(event: ReactPointerEvent<HTMLElement>) {
    const drag = dragRef.current;
    if (!drag) return;
    const x = Math.max(8, Math.min(drag.parentWidth - Math.min(drag.width, drag.parentWidth - 16) - 8, drag.left + event.clientX - drag.pointerX));
    const y = Math.max(8, Math.min(drag.parentHeight - Math.min(drag.height, drag.parentHeight - 16) - 8, drag.top + event.clientY - drag.pointerY));
    setPosition({ x, y });
  }

  function endDrag(event: ReactPointerEvent<HTMLElement>) {
    dragRef.current = null;
    mouseDragRef.current = false;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  }

  function beginResize(edge: FloatingWindowResizeEdge, event: ReactPointerEvent<HTMLButtonElement>) {
    const panel = panelRef.current;
    if (!panel) return;
    const parent = getToolbarWorkspace(panel);
    if (!parent) return;
    const panelBounds = panel.getBoundingClientRect();
    const parentBounds = parent.getBoundingClientRect();
    releaseDock(panelBounds, parentBounds);
    const left = panelBounds.left - parentBounds.left;
    const top = panelBounds.top - parentBounds.top;
    setPosition({ x: left, y: top });
    setSize({ width: panelBounds.width, height: panelBounds.height });
    resizeRef.current = { edge, pointerX: event.clientX, pointerY: event.clientY, left, top, width: panelBounds.width, height: panelBounds.height, parentWidth: parentBounds.width, parentHeight: parentBounds.height };
    focusPanel();
    event.currentTarget.setPointerCapture(event.pointerId);
    event.stopPropagation();
    event.preventDefault();
  }

  function moveResize(event: ReactPointerEvent<HTMLButtonElement>) {
    const resize = resizeRef.current;
    if (!resize) return;
    const next = resizeFloatingWindow(
      { left: resize.left, top: resize.top, width: resize.width, height: resize.height },
      resize.edge,
      { x: event.clientX - resize.pointerX, y: event.clientY - resize.pointerY },
      { width: resize.parentWidth, height: resize.parentHeight },
    );
    setPosition({ x: next.left, y: next.top });
    setSize({ width: next.width, height: next.height });
  }

  function endResize(event: ReactPointerEvent<HTMLButtonElement>) {
    resizeRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  }

  const slotHeight = dock ? `calc(${100 / dock.slots}% - ${(8 * (dock.slots + 1)) / dock.slots}px)` : undefined;
  const dockTop = dock ? `calc(${(dock.slot * 100) / dock.slots}% + ${8 * (1 - dock.slot / dock.slots)}px)` : undefined;
  const style = {
    left: dock && isDocked ? (dock.side === "LEFT" ? 8 : undefined) : position.x,
    right: dock && isDocked && dock.side === "RIGHT" ? 8 : undefined,
    top: dock && isDocked ? dockTop : position.y,
    width: size.width,
    height: size.height ?? undefined,
    maxHeight: size.height === null
      ? (dock && isDocked ? `min(${maxHeight}px, ${slotHeight})` : `min(${maxHeight}px, calc(100% - 16px))`)
      : "calc(100% - 16px)",
    zIndex,
  } as CSSProperties;
  return <section ref={panelRef} className={`floating-toolbar ${className}`.trim()} style={style} onPointerDown={focusPanel}>
    <header className="floating-toolbar-titlebar" aria-label={`Move ${title}`} title={`Drag to move ${title}`} onPointerDown={beginDrag} onPointerMove={moveDrag} onPointerUp={endDrag} onPointerCancel={endDrag} onMouseDown={beginMouseDrag}>
      <span className="floating-toolbar-drag" aria-hidden>⠿</span>
      <strong>{title}</strong>
      <button type="button" className="floating-toolbar-close" aria-label={`Hide ${title}`} title={`Hide ${title}`} onClick={onClose}>×</button>
    </header>
    <div className="floating-toolbar-content">{children}</div>
    {(["LEFT", "RIGHT", "BOTTOM"] as const).map((edge) => <button key={edge} type="button" tabIndex={-1} className={`floating-toolbar-resize floating-toolbar-resize-${edge.toLowerCase()}`} aria-label={`Resize ${title} from the ${edge.toLowerCase()} edge`} onPointerDown={(event) => beginResize(edge, event)} onPointerMove={moveResize} onPointerUp={endResize} onPointerCancel={endResize} />)}
  </section>;
}
