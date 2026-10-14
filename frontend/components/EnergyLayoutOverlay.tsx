"use client";
import { useMemo, useRef, useState } from "react";
import type { Room, Point2D } from "@/lib/types";
import type { HeatingProject } from "@/lib/heatingDocument";
import type { EnergyProject } from "@/lib/energyDocument";
import { calculateAssemblyUValue, energyElements, scenarioAssignments, isInsulationSelectable } from "@/lib/energyCalculations";
import { layoutEnergyLabels, screenLabelToWorld, type EnergyLabelRequest, type EnergyLabelBox } from "@/lib/energyLabelLayout";
export function EnergyLayoutOverlay({ rooms, heating, data, selectedIds, onSelect, toScreen, fromClient, onChange, roomTitleBox }: { roomTitleBox?: (room: Room) => EnergyLabelBox | undefined; rooms: Room[]; heating: HeatingProject; data: EnergyProject; selectedIds: string[]; onSelect: (ids: string[]) => void; toScreen: (p: Point2D) => Point2D; fromClient: (x: number, y: number, svg: SVGSVGElement) => Point2D; onChange: (data: EnergyProject) => void }) {
  const drag = useRef<{ id: string; start: Point2D; position: Point2D; preview: Point2D } | null>(null);
  const [preview, setPreview] = useState<{ id: string; position: Point2D } | null>(null);
  const elements = useMemo(() => energyElements(rooms, heating, data), [rooms, heating, data]);
  const existing = useMemo(() => data.display.improvements ? energyElements(rooms, heating, data, null) : [], [rooms, heating, data]);
  const select = (id: string, additive: boolean) => onSelect(additive ? selectedIds.includes(id) ? selectedIds.filter(value => value !== id) : [...selectedIds, id] : [id]);
  const visible = elements.filter(e => isInsulationSelectable(e, rooms) && (e.category === "wall" ? data.display.walls : e.category === "floor" ? data.display.floors : e.category === "roof" ? data.display.roofs : false));
  const labels = visible.map(e => {
    const assigned = scenarioAssignments(data).find(a => a.elementId === e.elementId), assembly = data.assemblies.find(a => a.assemblyId === assigned?.assemblyId);
    const defined = assigned?.uValue != null || (assembly && calculateAssemblyUValue(assembly, data.materials).uValue !== null);
    const before = existing.find(v => v.elementId === e.elementId);
    const value = `${defined && !e.warnings.length ? "U" : "Estimated U"} ${e.uValue.toFixed(2)}${data.display.heatLoss ? ` · ${Math.round(e.heatLossW)} W` : ""}${e.warnings.length ? " ⚠" : ""}`;
    const text = value + (before && e.category === "wall" ? ` · was ${before.uValue.toFixed(2)}` : "");
    return { e, text, value };
  });
  const surfaceCards = rooms.map(room => ({ room, id: `${room.id}|surfaces`, rows: labels.filter(({e}) => e.roomId === room.id && e.category !== "wall") })).filter(c => c.rows.length);
  const positions = layoutEnergyLabels(rooms.map(r => ({ id: r.id, polygon: r.vertices.map(toScreen), titleBox: roomTitleBox?.(r) })), data.display.labels ? labels.map(({ e, text }): EnergyLabelRequest => ({
    id: e.elementId, roomId: e.roomId, category: e.category as EnergyLabelRequest["category"], width: e.category === "wall" ? text.length * 5.2 + 8 : 132, height: e.category === "wall" ? 14 : 20,
    start: e.startMm && toScreen(e.startMm), end: e.endMm && toScreen(e.endMm),
    preferred: preview?.id === e.elementId ? toScreen(preview.position) : data.labelPositions?.[e.elementId] ? toScreen(data.labelPositions[e.elementId]) : undefined,
  })).filter(r => r.category === "wall").concat(surfaceCards.map(c => ({ id:c.id,roomId:c.room.id,category:"floor" as const,width:162,height:54,preferred:preview?.id===c.id?toScreen(preview.position):data.labelPositions?.[c.id]?toScreen(data.labelPositions[c.id]):undefined }))) : []);
  function beginDrag(event: React.PointerEvent<SVGElement>, id: string, label: Point2D, selectionIds?: string[]) {
    event.preventDefault(); event.stopPropagation(); if (selectionIds) onSelect(selectionIds); else select(id, event.shiftKey);
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
    {labels.filter(({e})=>e.category === "wall").map(({ e, text }) => {
      const intensity = Math.min(1, e.uValue / 2), color = `hsl(${135 - intensity * 130} 60% 42%)`, selected = selectedIds.includes(e.elementId);
      const title = `${e.category === "floor" ? "Floor insulation; " : e.category === "roof" ? "Roof insulation; " : ""}${e.label}; ${e.boundary}; ${e.areaM2.toFixed(1)} m²; U ${e.uValue.toFixed(3)}; ΔT ${e.deltaTK.toFixed(1)} K; ${Math.round(e.heatLossW)} W${e.warnings.length ? "; incomplete inputs - fallback" : ""}`;
      const label = positions[e.elementId];
      const events = { onPointerDown: (event: React.PointerEvent<SVGElement>) => { event.stopPropagation(); select(e.elementId, event.shiftKey); }, onKeyDown: (event: React.KeyboardEvent<SVGElement>) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); select(e.elementId, event.shiftKey); } } };
      if (e.startMm && e.endMm) {
        const a = toScreen(e.startMm), b = toScreen(e.endMm);
        return <g key={e.elementId} data-energy-interactive="true" data-plan-info={`${title}\nExternal heat-loss wall: click to select and define construction layers. Drag its label to reposition it.`} role="button" tabIndex={0} aria-label={title} {...events} style={{ cursor: "pointer" }}><title>{title}</title>
          <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke={selected ? "#1b81ef" : color} strokeWidth={selected ? 7 : 4} strokeOpacity={.8} />
          {label && <text data-energy-label={e.elementId} style={{ cursor: "move", touchAction: "none" }} onPointerDown={event => beginDrag(event, e.elementId, label)} x={label.x} y={label.y + 3} fontSize={8.5} textAnchor="middle" fill="var(--ink,#10243e)" paintOrder="stroke" stroke="var(--surface,#fff)" strokeWidth={2}>{text}</text>}
        </g>;
      }
      return null;
    })}
    {surfaceCards.map(card => {
      const label = positions[card.id]; if (!label) return null;
      const ids = card.rows.map(({e})=>e.elementId), selected = ids.some(id=>selectedIds.includes(id));
      return <g key={card.id} data-energy-interactive="true" data-energy-label={card.id} data-energy-room-card={card.room.id} transform={`translate(${label.x},${label.y}) scale(${label.width/162})`} role="button" tabIndex={0} aria-label={`Move floor and roof insulation: ${card.room.name}`} onPointerDown={event=>beginDrag(event,card.id,label,ids)} onKeyDown={event=>{if(event.key === "Enter" || event.key === " "){event.preventDefault();event.stopPropagation();onSelect(ids);}}} style={{cursor:"move",touchAction:"none"}}>
        <rect x="-81" y="-27" width="162" height="54" rx="6" fill="var(--surface,#fff)" stroke={selected?"#1b81ef":"#298a31"} strokeWidth={selected?2:1} />
        <text x="0" y="-13" textAnchor="middle" fontSize="9" fontWeight="700" fill="var(--ink,#10243e)">{card.room.name}</text>
        {card.rows.map(({e,value},i)=><g key={e.elementId} data-energy-category={e.category} data-plan-info={`${card.room.name}\n${e.category === "floor" ? "Floor" : "Roof"} heat-loss surface · ${e.areaM2.toFixed(1)} m² · U ${e.uValue.toFixed(3)} · ${Math.round(e.heatLossW)} W. Click the row to edit; drag the table header to move both surfaces.`} role="button" tabIndex={0} aria-label={`${e.category === "floor"?"Floor":"Roof"} insulation: ${card.room.name}`} onPointerDown={event=>{event.stopPropagation();select(e.elementId,event.shiftKey);}} onKeyDown={event=>{if(event.key==="Enter"||event.key===" "){event.preventDefault();event.stopPropagation();select(e.elementId,event.shiftKey);}}}>
          <rect x="-76" y={-6+i*14} width="152" height="13" rx="2" fill={selectedIds.includes(e.elementId)?"#e0efff":"transparent"} />
          <text x="0" y={3+i*14} textAnchor="middle" fontSize={Math.min(8,144/((value.length+8)*.54))} fill="var(--ink,#10243e)" pointerEvents="none">{e.category === "floor"?"Floor":"Roof"} · {value}</text>
        </g>)}
      </g>;
    })}
  </g>;
}
