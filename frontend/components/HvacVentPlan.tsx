"use client";
import { useEffect, useRef, useState, type PointerEvent } from "react";
import type { Point2D, Room } from "@/lib/types";
import type { CFDHost, CFDReport } from "@/lib/climoptix";
import type { VentDevice } from "@/lib/hvacDocument";
import { ventCenter } from "@/lib/climoptixPreview";
import { ventUVFromPlanDrag } from "@/lib/ventPlacement";
import styles from "./HeatingLayoutPanel.module.css";

function planPoint(event: PointerEvent<SVGGElement>) {
  const svg = event.currentTarget.ownerSVGElement;
  const matrix = svg?.getScreenCTM();
  if (!svg || !matrix) return null;
  const point = svg.createSVGPoint();
  point.x = event.clientX;
  point.y = event.clientY;
  return point.matrixTransform(matrix.inverse());
}

/** Plan edits are measured host-coordinate intent. The existing kernel validates cutouts. */
export function HvacVentPlan({ room, devices, report, selected, onSelect, sourceStamp, onMove }: {
  room: Room; devices: VentDevice[]; report: CFDReport | null; selected: string | null;
  onSelect: (id: string) => void; sourceStamp: string;
  onMove: (id: string, u: number, v: number, baseline: string) => void;
}) {
  const [draft, setDraft] = useState<{ id: string; u: number; v: number } | null>(null);
  const drag = useRef<{ id: string; pointer: number; host: CFDHost; device: VentDevice; baseline: string; start: Point2D; startPixel: Point2D; moved: boolean; u: number; v: number } | null>(null);
  const cancel = () => { drag.current = null; setDraft(null); };
  useEffect(() => {
    const escape = (event: KeyboardEvent) => { if (event.key === "Escape" && drag.current) { event.preventDefault(); drag.current = null; setDraft(null); } };
    window.addEventListener("keydown", escape); return () => window.removeEventListener("keydown", escape);
  }, []);
  function move(event: PointerEvent<SVGGElement>) {
    const active = drag.current;
    if (!active || active.pointer !== event.pointerId) return;
    event.preventDefault(); event.stopPropagation();
    if (!active.moved && Math.hypot(event.clientX - active.startPixel.x, event.clientY - active.startPixel.y) < 4) return;
    const point = planPoint(event);
    if (!point) return;
    active.moved = true;
    const uv = ventUVFromPlanDrag(active.device.vent, active.host, active.start, point);
    if (!uv) return;
    [active.u, active.v] = uv; setDraft({ id: active.id, u: uv[0], v: uv[1] });
  }
  const xs = room.vertices.map(p => p.x), ys = room.vertices.map(p => p.y);
  return <><svg className={styles.hvacPlan} aria-label="Ventilation room plan" viewBox={`${Math.min(...xs) - 200} ${Math.min(...ys) - 200} ${Math.max(...xs) - Math.min(...xs) + 400} ${Math.max(...ys) - Math.min(...ys) + 400}`}>
    <polygon points={room.vertices.map(p => `${p.x},${p.y}`).join(" ")} fill="var(--surface-muted)" stroke="var(--deep)" strokeWidth={20} />
    {devices.map(d => {
      const host = report?.patches.find(p => p.id === d.vent.host.patchId)?.host; if (!host) return null;
      const current = draft?.id === d.vent.id ? draft : d.vent.host;
      const center = ventCenter(d.vent, host, current.u, current.v);
      return <g key={d.vent.id} role="button" tabIndex={0} aria-label={`Select ${d.vent.name} in plan`} style={{ touchAction: "none" }}
        onClick={() => onSelect(d.vent.id)} onKeyDown={e => { if (["Enter", " "].includes(e.key)) { e.preventDefault(); onSelect(d.vent.id); } }}
        onPointerDown={event => {
          if (event.button !== 0 || drag.current) return;
          const start = planPoint(event);
          if (!start) return;
          event.preventDefault(); event.stopPropagation(); onSelect(d.vent.id); event.currentTarget.focus(); event.currentTarget.setPointerCapture(event.pointerId);
          drag.current = { id: d.vent.id, pointer: event.pointerId, host, device: d, baseline: sourceStamp, start, startPixel: { x: event.clientX, y: event.clientY }, moved: false, u: d.vent.host.u, v: d.vent.host.v };
        }} onPointerMove={move} onPointerCancel={cancel} onLostPointerCapture={cancel} onPointerUp={event => {
          const active = drag.current; if (!active || active.pointer !== event.pointerId) return;
          event.preventDefault(); event.stopPropagation(); cancel();
          if (active.u !== active.device.vent.host.u || active.v !== active.device.vent.host.v) onMove(active.id, active.u, active.v, active.baseline);
          if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
        }}>
        <circle cx={center[0]} cy={center[1]} r={selected === d.vent.id ? 100 : 70} fill="var(--deep)" opacity={d.enabled ? 1 : .4} />
        <title>{d.vent.name} · {center.map(n => n.toFixed(0)).join(", ")} mm. Drag within this host; Escape cancels.</title>
      </g>;
    })}
  </svg><small>Drag a marker to move it on its measured host; Escape cancels. Wall-mounted vents retain their height. Recheck geometry for opening/overlap validation.</small></>;
}
