"use client";

import { Fragment, useEffect, useId, useLayoutEffect, useRef, useState, type DragEvent, type ReactNode } from "react";

const MIME = "application/x-climoptix-reorder";
const PREVIEW = "cfx-reorder-preview", DROP = "cfx-reorder-drop";
type Drag = { scope: string; id: string; token: string; list: string };
let activeDrag: Drag | null = null;
const clearDrag = () => { activeDrag = null; window.dispatchEvent(new CustomEvent(PREVIEW)); };

/** Grip-only, scoped, same-session transfers. No data changes until a valid drop.
 * Mouse, captured touch/pen, and keyboard reordering share one mutation path. */
export function CFDReorderList<T extends { id: string; name: string }>({
  items, label, scope, onMove, children, header, collapsed = false,
}: {
  items: T[];
  label: string;
  scope: string;
  onMove: (id: string, boundary: number) => void;
  children: (item: T, index: number) => ReactNode;
  /** The header remains a validated transfer target even while collapsed. */
  header?: ReactNode;
  collapsed?: boolean;
}) {
  const listId = useId();
  const [boundary, setBoundary] = useState<number | null>(null);
  const latest = useRef({ scope, onMove, length: items.length });
  useLayoutEffect(() => { latest.current = { scope, onMove, length: items.length }; }, [scope, onMove, items.length]);
  const touch = useRef<{ x: number; y: number; id: string; target?: string; at?: number; started: boolean } | null>(null);
  useEffect(() => {
    const preview = (event: Event) => {
      const detail = (event as CustomEvent).detail;
      setBoundary(detail?.list === listId ? detail.at : null);
    };
    const drop = (event: Event) => {
      const d = (event as CustomEvent).detail, current = latest.current;
      if (d?.list === listId && activeDrag && d.token === activeDrag.token &&
          activeDrag.scope === current.scope && Number.isInteger(d.at) && d.at >= 0 && d.at <= current.length)
        current.onMove(activeDrag.id, d.at);
    };
    const cancel = () => { touch.current = null; clearDrag(); };
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape" && activeDrag) { event.preventDefault(); event.stopPropagation(); cancel(); }
    };
    window.addEventListener(PREVIEW, preview); window.addEventListener(DROP, drop);
    window.addEventListener("keydown", escape, true); window.addEventListener("blur", cancel);
    return () => {
      window.removeEventListener(PREVIEW, preview); window.removeEventListener(DROP, drop);
      window.removeEventListener("keydown", escape, true); window.removeEventListener("blur", cancel);
      if (activeDrag?.list === listId) clearDrag();
    };
  }, [listId]);
  const hover = (event: DragEvent, at: number) => {
    if (!activeDrag || activeDrag.scope !== scope || !event.dataTransfer.types.includes(MIME)) return;
    event.preventDefault(); event.stopPropagation(); event.dataTransfer.dropEffect = "move";
    window.dispatchEvent(new CustomEvent(PREVIEW, { detail: { list: listId, at } }));
  };
  const drop = (event: DragEvent, at: number) => {
    if (!activeDrag || activeDrag.scope !== scope) return;
    event.preventDefault(); event.stopPropagation();
    try {
      const data = JSON.parse(event.dataTransfer.getData(MIME));
      if (data?.token === activeDrag.token && data.id === activeDrag.id && data.scope === scope && at >= 0 && at <= items.length)
        onMove(data.id, at);
    } catch { /* External/malformed transfers cannot mutate a list. */ }
    clearDrag();
  };
  const targetData = (at: number, item = false) => ({
    "data-cfx-drop-list": listId, "data-cfx-drop-scope": scope,
    "data-cfx-boundary": at, "data-cfx-drop-item": item || undefined,
  });
  const slot = (at: number) => <li aria-hidden="true" className="cfx-insertion" {...targetData(at)}
    data-active={boundary === at} onDragOver={e => hover(e, at)} onDrop={e => drop(e, at)} />;
  return <ol className="cfx-reorder-list" aria-label={label} {...targetData(items.length)}
    onDragOver={e => { if (!items.length || e.target === e.currentTarget) hover(e, items.length); }}
    onDrop={e => { if (!items.length || e.target === e.currentTarget) drop(e, items.length); }}>
    {header && <li className="cfx-list-header" {...targetData(items.length)} data-active={boundary === items.length}
      onDragOver={e => hover(e, items.length)} onDrop={e => drop(e, items.length)}>{header}</li>}
    {!collapsed && items.map((item, index) => <Fragment key={item.id}>
      {slot(index)}
      <li className="cfx-reorder-item" data-item-id={item.id} {...targetData(index, true)}
        onDragOver={e => { const r = e.currentTarget.getBoundingClientRect(); hover(e, index + (e.clientY >= r.top + r.height / 2 ? 1 : 0)); }}
        onDrop={e => { const r = e.currentTarget.getBoundingClientRect(); drop(e, index + (e.clientY >= r.top + r.height / 2 ? 1 : 0)); }}>
        <button type="button" className="cfx-grip" draggable={false} aria-label={`Reorder ${item.name}`}
          title="Drag the grip; Arrow Up/Down reorders; Escape cancels"
          onDragStart={e => {
            e.stopPropagation(); activeDrag = { scope, id: item.id, token: crypto.randomUUID(), list: listId };
            e.dataTransfer.setData(MIME, JSON.stringify(activeDrag)); e.dataTransfer.effectAllowed = "move";
            window.dispatchEvent(new CustomEvent(PREVIEW));
          }}
          onDragEnd={e => { e.stopPropagation(); clearDrag(); }}
          onPointerDown={e => {
            if (e.button !== 0 || !e.isPrimary) return;
            e.stopPropagation(); e.currentTarget.setPointerCapture(e.pointerId);
            touch.current = { x: e.clientX, y: e.clientY, id: item.id, started: false };
          }}
          onPointerMove={e => {
            const press = touch.current;
            if (!press) return;
            if (!press.started && Math.hypot(e.clientX - press.x, e.clientY - press.y) < 8) return;
            e.preventDefault(); e.stopPropagation();
            if (!press.started) { activeDrag = { scope, id: press.id, token: crypto.randomUUID(), list: listId }; press.started = true; }
            // Native dragging a button is browser-dependent and can be cancelled
            // by focus/reflow in nested windows. Use the same captured gesture
            // for mouse, touch and pen, with no mutation before pointer release.
            let node = document.elementFromPoint(e.clientX, e.clientY)?.closest<HTMLElement>("[data-cfx-drop-scope]") ?? null;
            while (node && node.dataset.cfxDropScope !== scope) node = node.parentElement?.closest<HTMLElement>("[data-cfx-drop-scope]") ?? null;
            if (!node) { press.target = undefined; window.dispatchEvent(new CustomEvent(PREVIEW)); return; }
            for (let parent = node.parentElement; parent; parent = parent.parentElement) {
              if (parent.scrollHeight <= parent.clientHeight || !/auto|scroll/.test(getComputedStyle(parent).overflowY)) continue;
              const box = parent.getBoundingClientRect();
              if (e.clientY < box.top + 28) parent.scrollTop -= 16;
              else if (e.clientY > box.bottom - 28) parent.scrollTop += 16;
              break;
            }
            const r = node.getBoundingClientRect();
            press.target = node.dataset.cfxDropList;
            press.at = Number(node.dataset.cfxBoundary) + (node.dataset.cfxDropItem && e.clientY >= r.top + r.height / 2 ? 1 : 0);
            window.dispatchEvent(new CustomEvent(PREVIEW, { detail: { list: press.target, at: press.at } }));
          }}
          onPointerUp={e => {
            const press = touch.current; if (!press) return;
            e.stopPropagation();
            if (press.started && press.target && activeDrag)
              window.dispatchEvent(new CustomEvent(DROP, { detail: { list: press.target, at: press.at, token: activeDrag.token } }));
            touch.current = null; clearDrag();
          }}
          onPointerCancel={() => { touch.current = null; clearDrag(); }}
          onLostPointerCapture={() => { if (touch.current) { touch.current = null; clearDrag(); } }}
          onKeyDown={e => {
            if (e.key === "Escape" && activeDrag) { e.preventDefault(); e.stopPropagation(); touch.current = null; clearDrag(); return; }
            if (e.key !== "ArrowUp" && e.key !== "ArrowDown") return;
            e.preventDefault(); e.stopPropagation();
            if (e.key === "ArrowUp" && index > 0) onMove(item.id, index - 1);
            if (e.key === "ArrowDown" && index < items.length - 1) onMove(item.id, index + 2);
          }}>⠿</button>
        {children(item, index)}
      </li>
    </Fragment>)}
    {!collapsed && slot(items.length)}
  </ol>;
}
