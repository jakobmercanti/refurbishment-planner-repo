"use client";
import { useEffect, useRef, useState } from "react";
import { useHvac, useHvacMarkersVisible } from "./HvacContext";
import { activeFloor } from "@/lib/buildingDocument";
import { ventCenter } from "@/lib/climoptixPreview";
import { ventUVFromPlanDrag } from "@/lib/ventPlacement";
import type { CFDHost } from "@/lib/climoptix";
import type { VentDevice } from "@/lib/hvacDocument";
import type { Point2D } from "@/lib/types";

/** Checked host projection; drafts commit once to the shared project on release. */
export function HvacPlanMarkers({ toScreen, fromClient }: { toScreen: (point: Point2D) => Point2D; fromClient: (x: number, y: number, svg: SVGSVGElement) => Point2D }) {
  const ctx = useHvac();
  const visible = useHvacMarkersVisible();
  const [draft, setDraft] = useState<{ id: string; u: number; v: number } | null>(null), [error, setError] = useState("");
  const drag = useRef<{ device: VentDevice; host: CFDHost; baseline: string; pointer: number; start: Point2D; startPixel: Point2D; moved: boolean; u: number; v: number } | null>(null);
  const cancel = () => { drag.current = null; setDraft(null); };
  useEffect(() => { const escape = (e: KeyboardEvent) => { if (e.key === "Escape") { drag.current = null; setDraft(null); } }; window.addEventListener("keydown", escape); return () => window.removeEventListener("keydown", escape); }, []);
  if (!visible || !ctx?.project.hvac) return null;
  const floorId = activeFloor(ctx.project).id;
  return <g aria-label="Shared ventilation markers">{ctx.project.hvac.devices.filter(d => d.floorId === floorId).map(d => {
    const host = ctx.geometryPatches.find(p => p.id === d.vent.host.patchId)?.host ?? ctx.geometryReport?.patches.find(p => p.id === d.vent.host.patchId)?.host; if (!host) return null;
    const uv = draft?.id === d.vent.id ? draft : d.vent.host, center = ventCenter(d.vent, host, uv.u, uv.v), p = toScreen({ x: center[0], y: center[1] });
    return <g key={d.vent.id} data-hvac-plan-vent data-heating-interactive role="button" tabIndex={0} aria-label={`Select shared vent ${d.vent.name}`} style={{ cursor: "move", touchAction: "none" }}
      onDoubleClick={e => { e.stopPropagation(); ctx.editVent(d.vent.id); }}
      onKeyDown={e => { if (["Enter", " "].includes(e.key)) { e.preventDefault(); e.stopPropagation(); ctx.selectVent(d.vent.id); ctx.editVent(d.vent.id); } }}
      onPointerDown={e => {
        const svg = e.currentTarget.ownerSVGElement;
        if (e.button !== 0 || !svg || drag.current) return;
        e.preventDefault(); e.stopPropagation(); ctx.selectVent(d.vent.id); e.currentTarget.focus(); e.currentTarget.setPointerCapture(e.pointerId);
        drag.current = { device: d, host, baseline: JSON.stringify([ctx.geometryKey, d.vent]), pointer: e.pointerId, start: fromClient(e.clientX, e.clientY, svg), startPixel: { x: e.clientX, y: e.clientY }, moved: false, u: d.vent.host.u, v: d.vent.host.v };
      }}
      onPointerMove={e => {
        const active = drag.current, svg = e.currentTarget.ownerSVGElement;
        if (!active || active.pointer !== e.pointerId || !svg) return;
        e.preventDefault(); e.stopPropagation();
        if (!active.moved && Math.hypot(e.clientX - active.startPixel.x, e.clientY - active.startPixel.y) < 4) return;
        active.moved = true;
        const uv = ventUVFromPlanDrag(active.device.vent, active.host, active.start, fromClient(e.clientX, e.clientY, svg));
        if (uv) { [active.u, active.v] = uv; setDraft({ id: active.device.vent.id, u: uv[0], v: uv[1] }); }
      }}
      onPointerCancel={cancel} onLostPointerCapture={cancel}
      onPointerUp={e => { const active = drag.current; if (!active || active.pointer !== e.pointerId) return; e.preventDefault(); e.stopPropagation(); cancel(); try { if (active.u !== active.device.vent.host.u || active.v !== active.device.vent.host.v) ctx.moveVent(active.device.vent.id, active.u, active.v, active.baseline); setError(""); } catch (cause) { setError(cause instanceof Error ? cause.message : "Vent move failed."); } if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId); }}>
      <rect x={p.x - 9} y={p.y - 7} width={18} height={14} rx={3} fill={d.enabled ? d.vent.role === "supply" ? "#277ab5" : "#ae5a26" : "#697987"} stroke={ctx.selectedVentId === d.vent.id ? "#ff7900" : "#fff"} strokeWidth={2} />
      <path d={`M${p.x-5},${p.y-2}h10m-10,4h10`} stroke="white" strokeWidth={1.5} pointerEvents="none" />
      <title>{d.vent.name} · {d.vent.role} · {center.map(n => n.toFixed(0)).join(", ")} mm. Drag to move; double click or Enter to edit. Escape cancels.</title>
    </g>;
  })}{error && <foreignObject x={10} y={10} width={360} height={70}><p role="alert" style={{ background: "var(--surface-raised)", color: "var(--ink)" }}>{error}</p></foreignObject>}</g>;
}
