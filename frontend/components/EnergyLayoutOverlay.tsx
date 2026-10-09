"use client";
import { useMemo } from "react";
import type { Room, Point2D } from "@/lib/types";
import type { HeatingProject } from "@/lib/heatingDocument";
import type { EnergyProject } from "@/lib/energyDocument";
import { energyElements } from "@/lib/energyCalculations";
export function EnergyLayoutOverlay({ rooms, heating, data, selectedIds, onSelect, toScreen }: { rooms: Room[]; heating: HeatingProject; data: EnergyProject; selectedIds: string[]; onSelect: (ids: string[]) => void; toScreen: (p: Point2D) => Point2D }) {
  const elements = useMemo(() => energyElements(rooms, heating, data), [rooms, heating, data]);
  const existing = useMemo(() => data.display.improvements ? energyElements(rooms, heating, data, null) : [], [rooms, heating, data]);
  const select = (elementId: string, additive: boolean) => onSelect(additive ? selectedIds.includes(elementId) ? selectedIds.filter(id => id !== elementId) : [...selectedIds, elementId] : [elementId]);
  return <g data-energy-layer="true">
    {elements.filter(e => e.category === "wall" ? data.display.walls : e.category === "floor" ? data.display.floors : e.category === "roof" ? data.display.roofs : data.display.openings).map(e => {
      const intensity = Math.min(1, e.uValue / 2), color = `hsl(${135 - intensity * 130} 60% 42%)`, selected = selectedIds.includes(e.elementId), room = rooms.find(r => r.id === e.roomId)!, before = existing.find(v => v.elementId === e.elementId);
      const title = `${e.label}; ${e.boundary}; ${e.areaM2.toFixed(1)} m²; U ${e.uValue.toFixed(3)}; ΔT ${e.deltaTK.toFixed(1)} K; ${Math.round(e.heatLossW)} W${e.warnings.length ? "; incomplete inputs - fallback" : ""}`;
      const events = { onPointerDown: (event: React.PointerEvent<SVGElement>) => { event.stopPropagation();select(e.elementId, event.shiftKey); }, onKeyDown: (event: React.KeyboardEvent<SVGElement>) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault();select(e.elementId, event.shiftKey); } } };
      if (e.startMm && e.endMm) { const a = toScreen(e.startMm), b = toScreen(e.endMm), dx = b.x - a.x, dy = b.y - a.y, length = Math.hypot(dx, dy), offset = e.category === "wall" ? 12 : -12;
        return <g key={e.elementId} data-energy-interactive="true" role="button" tabIndex={0} aria-label={title} {...events} style={{ cursor: "pointer" }}><title>{title}</title><line x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke={selected ? "#1b81ef" : color} strokeWidth={selected ? 9 : e.category === "wall" ? 5 : 7} strokeOpacity={.8} />{data.display.labels && length > 45 && <text x={(a.x + b.x) / 2 - (length ? dy / length * offset : 0)} y={(a.y + b.y) / 2 + (length ? dx / length * offset : 0)} fontSize={10} textAnchor="middle" fill="var(--ink,#10243e)" paintOrder="stroke" stroke="var(--surface,#fff)" strokeWidth={3}>U {e.uValue.toFixed(2)}{data.display.heatLoss ? ` · ${Math.round(e.heatLossW)} W` : ""}{before ? ` · was ${before.uValue.toFixed(2)}` : ""}{e.warnings.length ? " ⚠" : ""}</text>}</g>;
      }
      const polygon = room.vertices.map(toScreen), center = polygon.reduce((p, v) => ({ x: p.x + v.x / polygon.length, y: p.y + v.y / polygon.length }), { x: 0, y: 0 });
      return <g key={e.elementId} data-energy-interactive="true" role="button" tabIndex={0} aria-label={title} {...events} style={{ cursor: "pointer" }}><title>{title}</title><polygon points={polygon.map(p => `${p.x},${p.y}`).join(" ")} fill={color} fillOpacity={.08} stroke={selected ? "#1b81ef" : "none"} strokeWidth={3} /><text x={center.x} y={center.y + (e.category === "floor" ? 25 : 43)} fontSize={11} fill="var(--ink,#10243e)" textAnchor="middle">{e.category} U {e.uValue.toFixed(2)} · {Math.round(e.heatLossW)} W</text></g>;
    })}
  </g>;
}
