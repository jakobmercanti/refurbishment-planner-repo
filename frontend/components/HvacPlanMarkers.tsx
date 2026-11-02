"use client";
import { useHvac } from "./HvacContext";
import { useHeatingLayout } from "./HeatingLayoutContext";
import { ventCenter } from "@/lib/climoptixPreview";
import type { Point2D } from "@/lib/types";

/** Presentation-only projection of checked measured hosts; never used to determine fit. */
export function HvacPlanMarkers({ toScreen }: { toScreen: (point: Point2D) => Point2D }) {
  const ctx = useHvac(), heating = useHeatingLayout();
  if (!ctx?.geometryReport || !ctx.project.hvac) return null;
  return <g aria-label="Shared ventilation markers">{ctx.project.hvac.devices.filter(d => d.floorId === ctx.project.building?.activeFloorId).map(d => {
    const host = ctx.geometryReport?.patches.find(p => p.id === d.vent.host.patchId)?.host;
    if (!host) return null;
    const center = ventCenter(d.vent, host), p = toScreen({ x: center[0], y: center[1] });
    const select = () => { ctx.selectVent(d.vent.id); ctx.setTab("Ventilation"); heating.open(); };
    return <g key={d.vent.id} data-heating-interactive role="button" tabIndex={0} aria-label={`Select shared vent ${d.vent.name}`} onClick={select} onKeyDown={e => { if (["Enter", " "].includes(e.key)) { e.preventDefault(); select(); } }} style={{ cursor: "pointer" }}>
      <circle cx={p.x} cy={p.y} r={ctx.selectedVentId === d.vent.id ? 10 : 7} fill={d.enabled ? "var(--deep)" : "var(--surface-muted)"} stroke="var(--ink)" strokeWidth={1.5} />
      <title>{d.vent.name} · {d.vent.role} · X {center[0].toFixed(0)}, Y {center[1].toFixed(0)}, Z {center[2].toFixed(0)} mm. Edit host coordinates in Ventilation or drag in CFD.</title>
    </g>;
  })}</g>;
}
