"use client";
import { useEffect, useRef, useState } from "react";
import { useHvac, useHvacMarkersVisible } from "./HvacContext";
import { activeFloor } from "@/lib/buildingDocument";
import { ventCenter } from "@/lib/climoptixPreview";
import { ventHostAtPoint, ventPointFromPlanDrag, ventUVAtPoint } from "@/lib/ventPlacement";
import type { CFDHost } from "@/lib/climoptix";
import type { VentDevice } from "@/lib/hvacDocument";
import type { Point2D } from "@/lib/types";

/** Checked host projection; drafts commit once to the shared project on release. */
export function HvacPlanMarkers({ toScreen, fromClient }: { toScreen: (point: Point2D) => Point2D; fromClient: (x: number, y: number, svg: SVGSVGElement) => Point2D }) {
  const ctx = useHvac();
  const visible = useHvacMarkersVisible();
  type Position = { id: string; patchId: string; u: number; v: number };
  const [draft, setDraft] = useState<Position | null>(null), [error, setError] = useState("");
  const drag = useRef<{ device: VentDevice; host: CFDHost; baseline: string; pointer: number; start: Point2D; startPixel: Point2D; moved: boolean; position: Position | null } | null>(null);
  const cancel = () => { drag.current = null; setDraft(null); };
  useEffect(() => { const escape = (e: KeyboardEvent) => { if (e.key === "Escape") { drag.current = null; setDraft(null); } }; window.addEventListener("keydown", escape); return () => window.removeEventListener("keydown", escape); }, []);
  if (!visible || !ctx?.project.hvac) return null;
  const floorId = activeFloor(ctx.project).id;
  const faces = new Map([...(ctx.geometryReport?.patches ?? []), ...ctx.geometryPatches].filter(p => p.floorId === floorId).map(p => [p.id, p]));
  const walls = [...faces.values()].filter(p => p.kind === "wall");
  return <g aria-label="Shared ventilation markers">{ctx.project.hvac.devices.filter(d => d.floorId === floorId).map(d => {
    const host = faces.get(d.vent.host.patchId)?.host;
    if (!host) return null;
    const uv = draft?.id === d.vent.id ? draft : d.vent.host;
    const center = ventCenter(d.vent, faces.get(uv.patchId)?.host ?? host, uv.u, uv.v);
    const p = toScreen({ x: center[0], y: center[1] });
    return <g key={d.vent.id} data-hvac-plan-vent data-heating-interactive role="button" tabIndex={0} aria-label={`Select shared vent ${d.vent.name}`} style={{ cursor: "move", touchAction: "none" }}
      onDoubleClick={e => { e.stopPropagation(); ctx.editVent(d.vent.id); }}
      onKeyDown={e => { if (["Enter", " "].includes(e.key)) { e.preventDefault(); e.stopPropagation(); ctx.selectVent(d.vent.id); ctx.editVent(d.vent.id); } }}
      onPointerDown={e => {
        const svg = e.currentTarget.ownerSVGElement;
        if (e.button !== 0 || !svg || drag.current) return;
        e.preventDefault(); e.stopPropagation(); ctx.selectVent(d.vent.id); e.currentTarget.focus(); e.currentTarget.setPointerCapture(e.pointerId);
        drag.current = { device: d, host, baseline: JSON.stringify([ctx.geometryKey, d.vent]), pointer: e.pointerId, start: fromClient(e.clientX, e.clientY, svg), startPixel: { x: e.clientX, y: e.clientY }, moved: false, position: null };
      }}
      onPointerMove={e => {
        const active = drag.current, svg = e.currentTarget.ownerSVGElement;
        if (!active || active.pointer !== e.pointerId || !svg) return;
        e.preventDefault(); e.stopPropagation();
        if (!active.moved && Math.hypot(e.clientX - active.startPixel.x, e.clientY - active.startPixel.y) < 4) return;
        active.moved = true;
        const vent = active.device.vent, at = fromClient(e.clientX, e.clientY, svg);
        const near = fromClient(e.clientX + 14, e.clientY, svg);
        const point = ventPointFromPlanDrag(vent, active.host, active.start, at);
        const match = faces.get(vent.host.patchId)?.kind === "wall"
          ? ventHostAtPoint(vent, walls, point, Math.hypot(near.x - at.x, near.y - at.y))
          : null;
        const uv = match?.uv ?? ventUVAtPoint(vent, active.host, point);
        if (!uv) return;
        const next = { id: vent.id, patchId: match?.patch.id ?? vent.host.patchId, u: uv[0], v: uv[1] };
        active.position = next;
        setDraft(next);
      }}
      onPointerCancel={cancel} onLostPointerCapture={cancel}
      onPointerUp={e => {
        const active = drag.current;
        if (!active || active.pointer !== e.pointerId) return;
        e.preventDefault(); e.stopPropagation(); cancel();
        const next = active.position, previous = active.device.vent.host;
        try {
          if (next && (next.patchId !== previous.patchId || next.u !== previous.u || next.v !== previous.v))
            ctx.moveVent(next.id, next.u, next.v, active.baseline, next.patchId);
          setError("");
        } catch (cause) { setError(cause instanceof Error ? cause.message : "Vent move failed."); }
        if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
      }}>
      <rect x={p.x - 9} y={p.y - 7} width={18} height={14} rx={3} fill={d.enabled ? d.vent.role === "supply" ? "#277ab5" : "#ae5a26" : "#697987"} stroke={ctx.selectedVentId === d.vent.id ? "#ff7900" : "#fff"} strokeWidth={2} />
      <path d={`M${p.x-5},${p.y-2}h10m-10,4h10`} stroke="white" strokeWidth={1.5} pointerEvents="none" />
      <title>{d.vent.name} · {d.vent.role} · {center.map(n => n.toFixed(0)).join(", ")} mm. Drag to move; double click or Enter to edit. Escape cancels.</title>
    </g>;
  })}{error && <foreignObject x={10} y={10} width={360} height={70}><p role="alert" style={{ background: "var(--surface-raised)", color: "var(--ink)" }}>{error}</p></foreignObject>}</g>;
}
