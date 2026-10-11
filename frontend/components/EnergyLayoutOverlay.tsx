"use client";
import { useMemo, useRef, useState } from "react";
import type { Room, Point2D } from "@/lib/types";
import type { HeatingProject } from "@/lib/heatingDocument";
import type { EnergyProject } from "@/lib/energyDocument";
import { calculateAssemblyUValue, energyElements, scenarioAssignments } from "@/lib/energyCalculations";
import { layoutEnergyLabels, screenLabelToWorld, type EnergyLabelRequest, type EnergyLabelBox } from "@/lib/energyLabelLayout";
export function EnergyLayoutOverlay({ rooms, heating, data, selectedIds, onSelect, toScreen, fromClient, onChange, roomTitleBox }: { roomTitleBox?: (room: Room) => EnergyLabelBox | undefined; rooms: Room[]; heating: HeatingProject; data: EnergyProject; selectedIds: string[]; onSelect: (ids: string[]) => void; toScreen: (p: Point2D) => Point2D; fromClient: (x: number, y: number, svg: SVGSVGElement) => Point2D; onChange: (data: EnergyProject) => void }) {
  const drag = useRef<{ id: string; start: Point2D; position: Point2D; preview: Point2D } | null>(null);
  const [preview, setPreview] = useState<{ id: string; position: Point2D } | null>(null);
  const elements = useMemo(() => energyElements(rooms, heating, data), [rooms, heating, data]);
  const existing = useMemo(() => data.display.improvements ? energyElements(rooms, heating, data, null) : [], [rooms, heating, data]);
  const select = (id: string, additive: boolean) => onSelect(additive ? selectedIds.includes(id) ? selectedIds.filter(value => value !== id) : [...selectedIds, id] : [id]);
  const visible = elements.filter(e => e.category === "wall" ? data.display.walls : e.category === "floor" ? data.display.floors : e.category === "roof" ? data.display.roofs : false);
  const labels = visible.map(e => {
    const assigned = scenarioAssignments(data).find(a => a.elementId === e.elementId), assembly = data.assemblies.find(a => a.assemblyId === assigned?.assemblyId);
    const defined = assigned?.uValue != null || (assembly && calculateAssemblyUValue(assembly, data.materials).uValue !== null);
    const before = existing.find(v => v.elementId === e.elementId);
    const value = `${defined && !e.warnings.length ? "U" : "Estimated U"} ${e.uValue.toFixed(2)}${data.display.heatLoss ? ` · ${Math.round(e.heatLossW)} W` : ""}${e.warnings.length ? " ⚠" : ""}`;
    const text = value + (before && e.category === "wall" ? ` · was ${before.uValue.toFixed(2)}` : "");
    return { e, text, value };
  });
  const positions = layoutEnergyLabels(rooms.map(r => ({ id: r.id, polygon: r.vertices.map(toScreen), titleBox: roomTitleBox?.(r) })), data.display.labels ? labels.map(({ e, text }): EnergyLabelRequest => ({
    id: e.elementId, roomId: e.roomId, category: e.category as EnergyLabelRequest["category"], width: e.category === "wall" ? text.length * 5.2 + 8 : 156, height: e.category === "wall" ? 14 : 34,
    start: e.startMm && toScreen(e.startMm), end: e.endMm && toScreen(e.endMm),
    preferred: preview?.id === e.elementId ? toScreen(preview.position) : data.labelPositions?.[e.elementId] ? toScreen(data.labelPositions[e.elementId]) : undefined,
  })) : []);
  function beginDrag(event: React.PointerEvent<SVGElement>, id: string, label: Point2D) {
    event.preventDefault(); event.stopPropagation(); select(id, event.shiftKey);
    const start = fromClient(event.clientX, event.clientY, event.currentTarget.ownerSVGElement!);
    const position = screenLabelToWorld(label, toScreen);
    drag.current = { id, start, position, preview: position };
    event.currentTarget.setPointerCapture(event.pointerId);
  }
  return <g data-energy-layer="true" onPointerMove={event => {
    if (!drag.current) return; event.stopPropagation();
    const at = fromClient(event.clientX, event.clientY, event.currentTarget.ownerSVGElement!);
    const position = { x: drag.current.position.x + at.x - drag.current.start.x, y: drag.current.position.y + at.y - drag.current.start.y };
    drag.current.preview = position; setPreview({ id: drag.current.id, position });
  }} onPointerUp={event => {
    if (!drag.current) return; event.stopPropagation();
    onChange({ ...data, labelPositions: { ...data.labelPositions, [drag.current.id]: drag.current.preview } });
    drag.current = null; setPreview(null);
  }} onPointerCancel={() => { drag.current = null; setPreview(null); }}>
    {labels.map(({ e, text, value }) => {
      const intensity = Math.min(1, e.uValue / 2), color = `hsl(${135 - intensity * 130} 60% 42%)`, selected = selectedIds.includes(e.elementId);
      const title = `${e.label}; ${e.boundary}; ${e.areaM2.toFixed(1)} m²; U ${e.uValue.toFixed(3)}; ΔT ${e.deltaTK.toFixed(1)} K; ${Math.round(e.heatLossW)} W${e.warnings.length ? "; incomplete inputs - fallback" : ""}`;
      const label = positions[e.elementId];
      const events = { onPointerDown: (event: React.PointerEvent<SVGElement>) => { event.stopPropagation(); select(e.elementId, event.shiftKey); }, onKeyDown: (event: React.KeyboardEvent<SVGElement>) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); select(e.elementId, event.shiftKey); } } };
      if (e.startMm && e.endMm) {
        const a = toScreen(e.startMm), b = toScreen(e.endMm);
        return <g key={e.elementId} data-energy-interactive="true" role="button" tabIndex={0} aria-label={title} {...events} style={{ cursor: "pointer" }}><title>{title}</title>
          <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke={selected ? "#1b81ef" : color} strokeWidth={selected ? 7 : 4} strokeOpacity={.8} />
          {label && <text data-energy-label={e.elementId} style={{ cursor: "move", touchAction: "none" }} onPointerDown={event => beginDrag(event, e.elementId, label)} x={label.x} y={label.y + 3} fontSize={8.5} textAnchor="middle" fill="var(--ink,#10243e)" paintOrder="stroke" stroke="var(--surface,#fff)" strokeWidth={2}>{text}</text>}
        </g>;
      }
      if (!label) return null;
      return <g key={e.elementId} data-energy-interactive="true" data-energy-category={e.category} data-energy-label={e.elementId} role="button" tabIndex={0} aria-label={title} {...events} onPointerDown={event => beginDrag(event, e.elementId, label)} style={{ cursor: "move", touchAction: "none" }}><title>{title}</title>
        <rect x={label.x - label.width / 2} y={label.y - label.height / 2} width={label.width} height={label.height} rx={6} fill="var(--surface,#fff)" stroke={selected ? "#1b81ef" : color} strokeWidth={selected ? 2 : 1} />
        <text x={label.x} y={label.y - 3} fontSize={10} fontWeight={700} fill="var(--ink,#10243e)" textAnchor="middle">{e.category === "floor" ? "Floor insulation" : "Roof insulation"}</text>
        <text x={label.x} y={label.y + 10} fontSize={8.5} fill="var(--ink,#10243e)" textAnchor="middle">{value}</text>
      </g>;
    })}
  </g>;
}
