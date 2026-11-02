"use client";
import { useRef, useState, type PointerEvent } from "react";
import type { Point2D } from "@/lib/types";
import { projectOnSegment } from "@/lib/heatingCalculations";
import { moveHeatingRouteSegment, moveHeatingRouteVertex } from "@/lib/heatingPipes";
import { orthogonalisePath } from "@/lib/electricalLayout";

export function EditableHeatingPath({ path, toScreen, fromClient, onChange, onSelect, selected, square, locked = false, fixedStart = false, fixedEnd = false, colour = "#c74b1d", dashed = false, label, pointer }: {
  path: Point2D[]; toScreen: (p: Point2D) => Point2D; fromClient: (x: number, y: number, svg: SVGSVGElement) => Point2D; onChange: (path: Point2D[]) => void; onSelect?: () => void; selected: boolean; square: boolean; locked?: boolean; fixedStart?: boolean; fixedEnd?: boolean; colour?: string; dashed?: boolean; label: string; pointer?: Point2D | null;
}) {
  const [preview, setPreview] = useState<Point2D[] | null>(null), [menu, setMenu] = useState<{ index: number; at: Point2D; source: Point2D[] } | null>(null);
  const drag = useRef<{ source: Point2D[]; pointerId: number; path: Point2D[]; start: Point2D; index: number; segment: boolean; latest: Point2D[] | null } | null>(null);
  const shown = preview ?? path;
  const points = (route: Point2D[]) => route.map(p => { const s = toScreen(p); return `${s.x},${s.y}`; }).join(" ");
  const world = (event: { clientX: number; clientY: number; currentTarget: SVGElement }) => fromClient(event.clientX, event.clientY, event.currentTarget.ownerSVGElement!);
  function begin(event: PointerEvent<SVGElement>, index: number, segment: boolean) {
    if (event.button !== 0 || drag.current) return; event.preventDefault(); event.stopPropagation(); onSelect?.(); setMenu(null);
    if (locked) return;
    drag.current = { source: path, pointerId: event.pointerId, path: path.map(p => ({ ...p })), start: world(event), index, segment, latest: null };
    const layer = event.currentTarget.closest<SVGGElement>("[data-editable-heating-path]")!;
    layer.focus(); setPreview(path); layer.setPointerCapture(event.pointerId);
  }
  const nearest = (at: Point2D) => path.slice(1).map((p, index) => ({ index, ...projectOnSegment(at, path[index], p) })).sort((a, b) => a.distance - b.distance)[0];
  return <g data-heating-interactive="true" data-editable-heating-path={label} aria-label={label} tabIndex={-1} onPointerMove={event => {
    const value = drag.current; if (!value || event.pointerId !== value.pointerId) return; event.stopPropagation(); if (locked || path !== value.source) { drag.current = null; setPreview(null); return; } const at = world(event);
    const next = value.segment ? moveHeatingRouteSegment(value.path, value.index, { x: at.x - value.start.x, y: at.y - value.start.y }, square, fixedStart, fixedEnd) : moveHeatingRouteVertex(value.path, value.index, at, square, fixedStart, fixedEnd);
    value.latest = next; setPreview(next);
  }} onPointerUp={event => { const value = drag.current; if (!value || event.pointerId !== value.pointerId) return; event.stopPropagation(); if (value.latest && !locked && path === value.source) onChange(value.latest); drag.current = null; setPreview(null); if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId); }} onPointerCancel={event => { event.stopPropagation(); drag.current = null; setPreview(null); }} onKeyDown={event => { if (event.key === "Escape" && drag.current) { event.preventDefault(); event.stopPropagation(); if (event.currentTarget.hasPointerCapture(drag.current.pointerId)) event.currentTarget.releasePointerCapture(drag.current.pointerId); drag.current = null; setPreview(null); } }}>
    <polyline points={points(shown)} fill="none" stroke={colour} strokeWidth={selected ? 3 : 2} strokeDasharray={dashed ? "6 4" : undefined} pointerEvents="none" />
    {path.length > 1 && <polyline role="button" tabIndex={0} aria-label={`Select ${label}`} points={points(shown)} fill="none" stroke="transparent" strokeWidth={14} style={{ cursor: locked ? "pointer" : "move" }} onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); onSelect?.(); } }} onPointerDown={event => { const hit = nearest(world(event)); if (hit) begin(event, hit.index, true); }} onDoubleClick={event => { event.preventDefault(); event.stopPropagation(); if (locked) return; const hit = nearest(world(event)); if (hit) { const next = [...path]; next.splice(hit.index + 1, 0, hit.point); onChange(next); } }} />}
    {selected && !locked && shown.map((p, index) => {
      if (index === 0 && fixedStart || index === shown.length - 1 && fixedEnd) return null;
      const s = toScreen(p); return <circle key={index} data-heating-route-corner={index} role="button" tabIndex={0} aria-label={`${label} corner ${index + 1}`} cx={s.x} cy={s.y} r={5} fill="white" stroke={colour} strokeWidth={2} style={{ cursor: "move" }} onPointerDown={event => begin(event, index, false)} onContextMenu={event => { event.preventDefault(); event.stopPropagation(); setMenu({ index, at: s, source: path }); }} />;
    })}
    {pointer && path.length > 0 && preview === null && <polyline points={points(square ? [path.at(-1)!, { x: pointer.x, y: path.at(-1)!.y }, pointer] : [path.at(-1)!, pointer])} fill="none" stroke={colour} strokeWidth={2} strokeDasharray="5 4" pointerEvents="none" />}
    {menu && !locked && menu.source === path && <foreignObject x={menu.at.x + 8} y={menu.at.y + 8} width={180} height={85}><div className="heating-route-menu"><button type="button" disabled={path.length <= 2 || menu.index === 0 && fixedStart || menu.index === path.length - 1 && fixedEnd} onClick={() => { const next = path.filter((_, i) => i !== menu.index); onChange(square ? orthogonalisePath(next) : next); setMenu(null); }}>Delete corner</button><button type="button" onClick={() => setMenu(null)}>Cancel</button></div></foreignObject>}
  </g>;
}
