"use client";
import { useMemo, useRef, useState } from "react";
import type { Room, Point2D } from "@/lib/types";
import type { HeatingProject } from "@/lib/heatingDocument";
import type { EnergyProject } from "@/lib/energyDocument";
import { calculateAssemblyUValue, energyElements, scenarioAssignments } from "@/lib/energyCalculations";
export function EnergyLayoutOverlay({ rooms, heating, data, selectedIds, onSelect, toScreen, fromClient, onChange }: { rooms: Room[]; heating: HeatingProject; data: EnergyProject; selectedIds: string[]; onSelect: (ids: string[]) => void; toScreen: (p: Point2D) => Point2D; fromClient: (x: number, y: number, svg: SVGSVGElement) => Point2D; onChange: (data: EnergyProject) => void }) {
  const drag = useRef<{ id: string; start: Point2D; position: Point2D } | null>(null);
  const [preview, setPreview] = useState<{ id: string; position: Point2D } | null>(null);
  const elements = useMemo(() => energyElements(rooms, heating, data), [rooms, heating, data]);
  const existing = useMemo(() => data.display.improvements ? energyElements(rooms, heating, data, null) : [], [rooms, heating, data]);
  const select = (elementId: string, additive: boolean) => onSelect(additive ? selectedIds.includes(elementId) ? selectedIds.filter(id => id !== elementId) : [...selectedIds, elementId] : [elementId]);
  return <g data-energy-layer="true" onPointerMove={event => {
    if (!drag.current) return;event.stopPropagation();const at = fromClient(event.clientX, event.clientY, event.currentTarget.ownerSVGElement!);
    setPreview({ id: drag.current.id, position: { x: drag.current.position.x + at.x - drag.current.start.x, y: drag.current.position.y + at.y - drag.current.start.y } });
  }} onPointerUp={event => { if (!drag.current) return;event.stopPropagation();if (preview) onChange({ ...data, labelPositions: { ...data.labelPositions, [preview.id]: preview.position } });drag.current = null;setPreview(null); }} onPointerCancel={() => { drag.current = null;setPreview(null); }}>
    {elements.filter(e => ["wall", "floor", "roof"].includes(e.category)).map(e => {
      const intensity = Math.min(1, e.uValue / 2), color = `hsl(${135 - intensity * 130} 60% 42%)`, selected = selectedIds.includes(e.elementId), room = rooms.find(r => r.id === e.roomId)!, before = existing.find(v => v.elementId === e.elementId);
      const assigned = scenarioAssignments(data).find(a => a.elementId === e.elementId), assembly = data.assemblies.find(a => a.assemblyId === assigned?.assemblyId);
      const defined = assigned?.uValue != null || (assembly && calculateAssemblyUValue(assembly, data.materials).uValue !== null);
      const valueLabel = `${defined && !e.warnings.length ? "U" : "Estimated U"} ${e.uValue.toFixed(2)}`;
      const title = `${e.label}; ${e.boundary}; ${e.areaM2.toFixed(1)} m²; U ${e.uValue.toFixed(3)}; ΔT ${e.deltaTK.toFixed(1)} K; ${Math.round(e.heatLossW)} W${e.warnings.length ? "; incomplete inputs - fallback" : ""}`;
      const events = { onPointerDown: (event: React.PointerEvent<SVGElement>) => { event.stopPropagation();select(e.elementId, event.shiftKey); }, onKeyDown: (event: React.KeyboardEvent<SVGElement>) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault();select(e.elementId, event.shiftKey); } } };
      if (e.startMm && e.endMm) { const a = toScreen(e.startMm), b = toScreen(e.endMm), dx = b.x - a.x, dy = b.y - a.y, length = Math.hypot(dx, dy), offset = e.category === "wall" ? 12 : -12;
        const defaultPosition = { x: (a.x + b.x) / 2 - (length ? dy / length * offset : 0), y: (a.y + b.y) / 2 + (length ? dx / length * offset : 0) };
        const worldPosition = preview?.id === e.elementId ? preview.position : data.labelPositions?.[e.elementId];
        const label = worldPosition ? toScreen(worldPosition) : defaultPosition;
        return <g key={e.elementId} data-energy-interactive="true" role="button" tabIndex={0} aria-label={title} {...events} style={{ cursor: "pointer" }}><title>{title}</title><line x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke={selected ? "#1b81ef" : color} strokeWidth={selected ? 9 : e.category === "wall" ? 5 : 7} strokeOpacity={.8} />{length > 45 && <text data-energy-label={e.elementId} style={{ cursor: "move", touchAction: "none" }} onPointerDown={event => { event.preventDefault();event.stopPropagation();const svg = event.currentTarget.ownerSVGElement!;const start = fromClient(event.clientX, event.clientY, svg);const scale = Math.hypot(dx, dy) / Math.hypot(e.endMm!.x - e.startMm!.x, e.endMm!.y - e.startMm!.y);
          const position = worldPosition ?? { x: (e.startMm!.x + e.endMm!.x) / 2 + (label.x - (a.x + b.x) / 2) / scale, y: (e.startMm!.y + e.endMm!.y) / 2 - (label.y - (a.y + b.y) / 2) / scale };drag.current = { id: e.elementId, start, position };event.currentTarget.setPointerCapture(event.pointerId);
        }} x={label.x} y={label.y} fontSize={10} textAnchor="middle" fill="var(--ink,#10243e)" paintOrder="stroke" stroke="var(--surface,#fff)" strokeWidth={3}>{valueLabel}{` · ${Math.round(e.heatLossW)} W`}{before ? ` · was ${before.uValue.toFixed(2)}` : ""}{e.warnings.length ? " ⚠" : ""}</text>}</g>;
      }
      const polygon = room.vertices.map(toScreen), center = polygon.reduce((p, v) => ({ x: p.x + v.x / polygon.length, y: p.y + v.y / polygon.length }), { x: 0, y: 0 });
      const y = center.y + (e.category === "floor" ? 42 : -42);
      return <g key={e.elementId} data-energy-interactive="true" data-energy-category={e.category} role="button" tabIndex={0} aria-label={title} {...events} style={{ cursor: "pointer" }}><title>{title}</title>
        <rect x={center.x - 105} y={y - 23} width={210} height={46} rx={8} fill="var(--surface,#fff)" stroke={selected ? "#1b81ef" : color} strokeWidth={selected ? 3 : 1.5} />
        <text x={center.x} y={y - 5} fontSize={12} fontWeight={700} fill="var(--ink,#10243e)" textAnchor="middle">{e.category === "floor" ? "Floor insulation" : "Roof insulation"}</text>
        <text x={center.x} y={y + 12} fontSize={11} fill="var(--ink,#10243e)" textAnchor="middle">{valueLabel} · {Math.round(e.heatLossW)} W{e.warnings.length ? " ⚠" : ""}</text>
      </g>;
    })}
  </g>;
}
