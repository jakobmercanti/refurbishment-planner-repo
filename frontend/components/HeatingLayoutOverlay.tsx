"use client";
import { useMemo, useRef, useState, type PointerEvent as ReactPointerEvent, type MouseEvent as ReactMouseEvent } from "react";
import type { Point2D, Room } from "@/lib/types";
import type { HeatingProject } from "@/lib/heatingDocument";
import { heatingResults } from "@/lib/heatingDesign";
import { heatingPlanSize, heatingRoomBalance, heatingWatts } from "@/lib/heatingPresentation";
import { calculateCircuitLength, projectOnSegment, snapRadiatorToWall } from "@/lib/heatingCalculations";
import type { HeatingSelection } from "./HeatingLayoutPanel";
import { heatingPipeLengthM, moveHeatingRouteSegment, refreshHeatingPipeEndpoints } from "@/lib/heatingPipes";
import { EditableHeatingPath } from "./EditableHeatingPath";
import { editUFHBend, ufhBendControls } from "@/lib/ufhBendControls";
import { pipeSegmentAllowed } from "@/lib/heatingGeometry";
interface Props { onPipeDraftChange?: (path: Point2D[]) => void; pipePointer?: Point2D | null; zoom?: number; connecting?: boolean; onConnect?: (id: string) => void; pipeDraft?: Point2D[]; data: HeatingProject; rooms: Room[]; selection: HeatingSelection; onSelect: (s: HeatingSelection) => void; onChange: (p: HeatingProject) => void; toScreen: (p: Point2D) => Point2D; fromClient: (x: number, y: number, svg: SVGSVGElement) => Point2D; highlightedRoomId: string | null; draft: Point2D[]; }
type Drag = { bend?: number; bendMode?: "POSITION" | "RADIUS"; source: HeatingProject; before: HeatingProject; kind: "radiator" | "manifold" | "exclusion" | "circuit" | "roomIndicator"; id: string; pathKey?: "pathMm" | "supplyPathMm" | "returnPathMm"; index?: number; segment?: boolean; start: Point2D; };
export function HeatingLayoutOverlay(props: Props) {
  const [preview, setPreview] = useState<HeatingProject | null>(null);
  const [editError, setEditError] = useState("");
  const drag = useRef<Drag | null>(null), latest = useRef<HeatingProject | null>(null), data = preview ?? props.data;
  const results = useMemo(() => heatingResults(props.rooms, props.data), [props.rooms, props.data]);
  const screenPath = (p: Point2D[]) => p.map(props.toScreen).map(p => `${p.x},${p.y}`).join(" ");
  const pointFromEvent = (event: ReactPointerEvent<SVGElement> | ReactMouseEvent<SVGElement>) => props.fromClient(event.clientX, event.clientY, event.currentTarget.ownerSVGElement!);
  function begin(event: ReactPointerEvent<SVGElement>, value: Omit<Drag, "before" | "start" | "source">) {
    if (event.button !== 0) return; event.preventDefault(); event.stopPropagation();
    // preventDefault retains the previous form focus; explicitly return keyboard actions to the canvas.
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
    event.currentTarget.closest<SVGElement>('[role="button"]')?.focus(); if (props.connecting && (value.kind === "radiator" || value.kind === "manifold")) { props.onConnect?.(value.id); return; } if (value.kind !== "roomIndicator") props.onSelect({ kind: value.kind, id: value.id });setEditError("");
    const circuit = data.ufhCircuits.find(c => c.circuitId === value.id), radiator = data.radiators.find(r => r.radiatorId === value.id);
    if (circuit?.locked || radiator?.locked) return;
    drag.current = { ...value, source: props.data, before: structuredClone(props.data), start: pointFromEvent(event) };latest.current = null;event.currentTarget.closest<SVGGElement>('[aria-label="Heating layer"]')!.setPointerCapture(event.pointerId);
  }
  function move(event: ReactPointerEvent<SVGElement>) {
    const value = drag.current;if (!value) return;event.stopPropagation();const at = pointFromEvent(event), next = structuredClone(value.before), dx = at.x - value.start.x, dy = at.y - value.start.y;
    if (value.kind === "roomIndicator") {
      const room = props.rooms.find(r => r.id === value.id);
      if (!room) return;
      const original = value.before.roomIndicatorPositions?.[value.id] ?? { x: room.vertices.reduce((s, p) => s + p.x, 0) / room.vertices.length, y: room.vertices.reduce((s, p) => s + p.y, 0) / room.vertices.length };
      next.roomIndicatorPositions = { ...next.roomIndicatorPositions, [value.id]: { x: original.x + dx, y: original.y + dy } };
    }
    if (value.kind === "radiator") { const r = next.radiators.find(r => r.radiatorId === value.id)!, room = props.rooms.find(room => room.id === r.roomId);if (room) Object.assign(r, snapRadiatorToWall(r, room, at)); }
    if (value.kind === "manifold") { const m = next.manifolds.find(m => m.manifoldId === value.id)!;m.positionMm = at;for (const c of next.ufhCircuits.filter(c => c.manifoldId === m.manifoldId)) { c.supplyPathMm[0] = at;c.returnPathMm[c.returnPathMm.length - 1] = at; } }
    if (value.kind === "exclusion") { const ex = next.exclusions.find(e => e.exclusionId === value.id)!;if (value.index !== undefined) ex.polygonMm[value.index] = at;else ex.polygonMm = ex.polygonMm.map(p => ({ x: p.x + dx, y: p.y + dy })); }
    if (value.kind === "circuit") { const c = next.ufhCircuits.find(c => c.circuitId === value.id)!, key = value.pathKey!;if (value.bend !== undefined) {
        const zone = next.ufhZones.find(z => z.zoneId === c.zoneId), room = props.rooms.find(r => r.id === zone?.roomId);
        if (!zone || !room) return;
        try { const path = editUFHBend(c.pathMm, value.bend, at, value.bendMode ?? "POSITION", zone.minBendRadiusMm, zone.spacingMm);
          const holes = next.exclusions.filter(e => e.roomId === room.id).map(e => e.polygonMm);
          if (!path.slice(1).every((p,i) => pipeSegmentAllowed(path[i], p, room.vertices, holes, zone.boundaryOffsetMm))) throw new Error("This bend would cross a wall, exclusion or clearance boundary.");
          c.pathMm = path; setEditError("");
        } catch (cause) { setEditError(cause instanceof Error ? cause.message : "Invalid bend."); return; }
      } else if (value.segment) { c[key] = moveHeatingRouteSegment(c[key], value.index!, { x: dx, y: dy }, false, true, true); }else c[key][value.index!] = at;c.manuallyEdited = true;
      if (key === "pathMm") { c.supplyPathMm[c.supplyPathMm.length - 1] = c.pathMm[0];c.returnPathMm[0] = c.pathMm.at(-1)!; }
      if (key === "supplyPathMm" && value.index === c.supplyPathMm.length - 1) c.pathMm[0] = c.supplyPathMm.at(-1)!;
      if (key === "returnPathMm" && value.index === 0) c.pathMm[c.pathMm.length - 1] = c.returnPathMm[0];
    }
    Object.assign(next, refreshHeatingPipeEndpoints(next));latest.current = next;setPreview(next);
  }
  function finish(event: ReactPointerEvent<SVGElement>) { if (!drag.current) return;event.stopPropagation();if (latest.current && props.data === drag.current.source) props.onChange(latest.current);drag.current = null;latest.current = null;setPreview(null); }
  function insert(event: ReactMouseEvent<SVGPolylineElement>, id: string, key: "pathMm" | "supplyPathMm" | "returnPathMm") {
    event.preventDefault();event.stopPropagation();const next = structuredClone(props.data), circuit = next.ufhCircuits.find(c => c.circuitId === id)!;if (circuit.locked) return;
    const p = pointFromEvent(event), nearest = circuit[key].slice(1).map((b, i) => ({ ...projectOnSegment(p, circuit[key][i], b), i })).sort((a, b) => a.distance - b.distance)[0];
    if (!nearest) return;circuit[key].splice(nearest.i + 1, 0, nearest.point);circuit.manuallyEdited = true;props.onChange(next);props.onSelect({ kind: "circuit", id });
  }
  return <g data-heating-interactive="true" aria-label="Heating layer" onPointerMove={move} onPointerUp={finish} onPointerCancel={event => { event.stopPropagation();drag.current = null;latest.current = null;setPreview(null); }}>
    <defs><pattern id="heating-exclusion-hatch" width="8" height="8" patternUnits="userSpaceOnUse"><path d="M0,8L8,0" stroke="#aa6b29" strokeWidth="1" /></pattern></defs>
    {results.rooms.map(row => <g key={row.room.id} pointerEvents="none">
        {data.display.zones && row.zones.length > 0 && <polygon points={screenPath(row.room.vertices)} fill="#da813722" stroke="#da8137" strokeWidth="1" strokeDasharray="5 4" />}
        {props.highlightedRoomId === row.room.id && row.demand.surfaces.filter(s => s.edgeIndex !== undefined && s.lossW > 0).map(s => <line key={s.key} x1={props.toScreen(s.startMm!).x} y1={props.toScreen(s.startMm!).y} x2={props.toScreen(s.endMm!).x} y2={props.toScreen(s.endMm!).y} stroke="#dd791d" strokeWidth="5" opacity=".65" />)}
    </g>)}
    {data.display.exclusions && data.exclusions.map(ex => <g key={ex.exclusionId} data-plan-info="Underfloor heating exclusion: no heated pipe should enter this area. Click to select; drag its corners to edit."><polygon points={screenPath(ex.polygonMm)} fill="url(#heating-exclusion-hatch)" fillOpacity=".5" stroke="#a15f22" strokeWidth="2" onPointerDown={e => begin(e, { kind: "exclusion", id: ex.exclusionId })} style={{ cursor: "move" }} />{props.selection?.id === ex.exclusionId && ex.polygonMm.map((p, i) => <circle key={i} cx={props.toScreen(p).x} cy={props.toScreen(p).y} r="5" fill="white" stroke="#a15f22" onPointerDown={e => begin(e, { kind: "exclusion", id: ex.exclusionId, index: i })} />)}</g>)}
    {data.ufhCircuits.map(c => <g key={c.circuitId} data-plan-info={`${c.name}\nUnderfloor heating loop · ${calculateCircuitLength(c).toFixed(1)} m. Click to select; use position/radius handles for tube bends. Drag lead corners or double-click a lead to add a point.`}>
      {(["pathMm", "supplyPathMm", "returnPathMm"] as const).map(key => {
        if (!(key === "pathMm" ? data.display.loops : data.display.tails)) return null;
        const path = c[key], selected = props.selection?.id === c.circuitId, colour = key === "returnPathMm" ? "#277ab5" : "#d76824";
        return <g key={key}><polyline points={screenPath(path)} fill="none" stroke={selected ? "#f2b644" : colour} strokeWidth={selected ? 3 : 1.8} strokeDasharray={key === "returnPathMm" ? "5 3" : undefined} pointerEvents="none" />
          <polyline points={screenPath(path)} fill="none" stroke="transparent" strokeWidth="10" onDoubleClick={key === "pathMm" ? undefined : e => insert(e, c.circuitId, key)} onPointerDown={e => { props.onSelect({ kind: "circuit", id: c.circuitId });if (e.shiftKey && key !== "pathMm") { const p = pointFromEvent(e), nearest = path.slice(1).map((b, i) => ({ i, distance: projectOnSegment(p, path[i], b).distance })).sort((a, b) => a.distance - b.distance)[0];if (nearest) begin(e, { kind: "circuit", id: c.circuitId, index: nearest.i, pathKey: key, segment: true }); }else e.stopPropagation(); }} style={{ cursor: c.locked ? "pointer" : "move" }} />
          {selected && !c.locked && (key === "pathMm" ? ufhBendControls(path, data.ufhZones.find(z => z.zoneId === c.zoneId)?.minBendRadiusMm ?? 50, c.spacingMm).bends.map((bend, index) => <g key={index} data-ufh-bend={index}>{(["POSITION", "RADIUS"] as const).map(mode => {
            const p = props.toScreen(mode === "POSITION" ? bend.position : bend.radiusHandle);
            return <circle key={mode} role="button" tabIndex={0} aria-label={"UFH bend "+(index+1)+" "+(mode === "POSITION" ? "position" : "radius")} data-ufh-handle={mode.toLowerCase()} cx={p.x} cy={p.y} r={mode === "POSITION" ? 5 : 4} fill={mode === "POSITION" ? "white" : "#ffc765"} stroke="#8b4319" strokeWidth={2} style={{cursor:"move"}} onPointerDown={e => begin(e, { kind:"circuit",id:c.circuitId,pathKey:key,bend:index,bendMode:mode })}><title>{mode === "POSITION" ? "Move this tube end along the runs" : "Drag to change this bend radius"}</title></circle>;
          })}</g>) : path.map((p,index) => key === "supplyPathMm" && index === 0 || key === "returnPathMm" && index === path.length - 1 ? null : <circle key={index} cx={props.toScreen(p).x} cy={props.toScreen(p).y} r={4} fill="white" stroke="#b55419" onPointerDown={e => begin(e,{kind:"circuit",id:c.circuitId,pathKey:key,index})} />))}
        </g>;
      })}
      {data.display.labels && <text x={props.toScreen(c.pathMm[0]).x + 7} y={props.toScreen(c.pathMm[0]).y - 7} fill="#8b4319" fontSize="10" pointerEvents="none">{c.name} · {calculateCircuitLength(c).toFixed(1)} m{c.locked ? " (locked)" : ""}</text>}
    </g>)}
    {data.pipes.map(pipe => <g key={pipe.pipeId} className="heating-pipe" data-plan-info={pipe.name+": drag route segments or corners; double-click to insert a corner; right-click a corner to delete."}><EditableHeatingPath label={pipe.name} path={pipe.pathMm} toScreen={props.toScreen} fromClient={props.fromClient} onSelect={() => props.onSelect({kind:"pipe",id:pipe.pipeId})} onChange={pathMm => props.onChange(refreshHeatingPipeEndpoints({...props.data,pipes:props.data.pipes.map(p => p.pipeId === pipe.pipeId ? {...p,pathMm} : p)}))} selected={props.selection?.id === pipe.pipeId} locked={pipe.locked} fixedStart={Boolean(pipe.fromId)} fixedEnd={Boolean(pipe.toId)} square={data.forceOrthogonalRouting === true} colour={pipe.kind === "Supply" ? "#c74b1d" : "#2377b2"} dashed={pipe.kind === "Return"} />{data.display.labels && <text x={props.toScreen(pipe.pathMm[0]).x+8} y={props.toScreen(pipe.pathMm[0]).y+15} pointerEvents="none" fill="#713413" fontSize={10}>{pipe.name} · {heatingPipeLengthM(pipe.pathMm).toFixed(1)} m</text>}</g>)}
    {data.display.radiators && results.rooms.flatMap(row => row.emitters.map(({ radiator, outputW, estimated }) => {
      const r = data.radiators.find(r => r.radiatorId === radiator.radiatorId) ?? radiator;
      const centre = props.toScreen(r.positionMm), end = props.toScreen({ x: r.positionMm.x + r.widthMm, y: r.positionMm.y }), scale = Math.hypot(end.x - centre.x, end.y - centre.y) / r.widthMm;
      const { width, depth } = heatingPlanSize(r.widthMm * scale, r.depthMm * scale, true);
      return <g key={r.radiatorId} transform={`translate(${centre.x},${centre.y}) rotate(${r.rotationDeg})`} onPointerDown={e => begin(e, { kind: "radiator", id: r.radiatorId })} data-plan-info={`${r.model}\nWall-mounted ${r.emitterTechnology.toLowerCase()} heater · ${outputW === null ? "output not set" : `${Math.round(outputW)} W at selected conditions`}. Click to edit; drag along a wall. Ratings must match the selected temperatures and fan mode.`} className="heating-emitter-symbol" role="button" tabIndex={0} aria-label={`Heating element: ${r.model}`} onKeyDown={event => { if (event.key === "Enter") { event.stopPropagation(); if (props.connecting) props.onConnect?.(r.radiatorId); else props.onSelect({ kind: "radiator", id: r.radiatorId }); } }} style={{ cursor: r.locked ? "pointer" : "move" }}><rect x={-width / 2} y={-depth / 2} width={width} height={depth} rx="5" fill={r.emitterTechnology === "Electric" ? "#ffe4ad" : "#fbd0bd"} stroke={props.selection?.id === r.radiatorId ? "#e5a719" : "#a54b23"} strokeWidth="2" />{data.display.output && <g transform={`translate(0 ${-depth / 2 - 8}) rotate(${-r.rotationDeg})`}><text textAnchor="middle" fill="#713413" fontSize="10">{r.category === "Boiler" ? `Boiler · ${Math.round((r.ratedOutputW ?? 0) / 1000)} kW CH` : outputW === null ? "Output not set" : `${r.estimatedOutput || estimated ? "~" : ""}${Math.round(outputW)} W`}</text></g>}</g>;
    }))}
    {data.display.manifolds && data.manifolds.map(m => { const p = props.toScreen(m.positionMm), used = data.ufhCircuits.filter(c => c.manifoldId === m.manifoldId).length;return <g key={m.manifoldId} transform={`translate(${p.x},${p.y}) rotate(${m.rotationDeg})`} role="button" tabIndex={0} data-plan-info={`${m.name}\nUnderfloor-heating distribution point: ${used} of ${m.ports} loop connections used. Orange bar: warm-water supply. Blue bar: cooler return. Click for settings and help; drag to move.`} aria-label={`Heating manifold: ${m.name}`} onKeyDown={event => { if (event.key === "Enter") { event.stopPropagation(); if (props.connecting) props.onConnect?.(m.manifoldId); else props.onSelect({ kind: "manifold", id: m.manifoldId }); } }} onPointerDown={e => begin(e, { kind: "manifold", id: m.manifoldId })} style={{ cursor: "move" }}><rect x="-17" y="-10" width="34" height="20" rx="3" fill="#fff" stroke="#a54b23" strokeWidth="2" /><path d="M-12,-4H12" stroke="#c74b1d" strokeWidth="3" /><path d="M-12,4H12" stroke="#277ab5" strokeWidth="3" />{data.display.labels && <text textAnchor="middle" y="-15" fill="#713413" fontSize="10">{m.name} · {used}/{m.ports} loops</text>}</g>; })}
    {(props.pipeDraft?.length ?? 0) > 0 && <EditableHeatingPath label="Draft heating pipe" path={props.pipeDraft!} toScreen={props.toScreen} fromClient={props.fromClient} onChange={path => props.onPipeDraftChange?.(path)} selected square={data.forceOrthogonalRouting === true} dashed pointer={props.pipePointer} />}
    {editError && <text x={10} y={20} fill="#ad2323" role="alert">{editError}</text>}
    {props.draft.length > 0 && <polyline points={screenPath(props.draft)} stroke="#b45c24" strokeWidth="2" fill="none" pointerEvents="none" />}
    {results.rooms.map(row => {
      const pts = row.room.vertices.map(props.toScreen), savedPosition = data.roomIndicatorPositions?.[row.room.id], label = savedPosition ? props.toScreen(savedPosition) : { x: pts.reduce((s, p) => s + p.x, 0) / pts.length, y: pts.reduce((s, p) => s + p.y, 0) / pts.length };
      const balance = heatingRoomBalance(row), green = balance.tone === "sufficient", red = balance.tone === "insufficient";
      const colour = green ? "#15803d" : red ? "#b91c1c" : "#a16207", background = green ? "#f0fdf4" : red ? "#fff1f2" : "#fffbeb";
      return <g key={row.room.id} pointerEvents="none">
        {(data.display.demand || data.display.temperature || data.display.density) && <g className="heating-room-indicator" data-room-id={row.room.id} data-balance={balance.tone} transform={`translate(${label.x},${label.y + 37}) scale(${.76 * (props.zoom ?? 1)})`} pointerEvents="all" role="button" tabIndex={0} aria-label={`Move heating summary: ${row.room.name}`} style={{ cursor: "move" }} onPointerDown={event => begin(event, { kind: "roomIndicator", id: row.room.id })} onKeyDown={event => {
          const directions: Record<string, Point2D> = { ArrowLeft: { x: -50, y: 0 }, ArrowRight: { x: 50, y: 0 }, ArrowUp: { x: 0, y: 50 }, ArrowDown: { x: 0, y: -50 } }, direction = directions[event.key];
          if (!direction) return; event.preventDefault(); event.stopPropagation();
          const original = data.roomIndicatorPositions?.[row.room.id] ?? { x: row.room.vertices.reduce((s, p) => s + p.x, 0) / row.room.vertices.length, y: row.room.vertices.reduce((s, p) => s + p.y, 0) / row.room.vertices.length };
          props.onChange({ ...props.data, roomIndicatorPositions: { ...props.data.roomIndicatorPositions, [row.room.id]: { x: original.x + direction.x, y: original.y + direction.y } } });
        }}>
          <title>{`${row.room.name}: ${balance.headline}. ${balance.detail}. Drag this summary to move it; arrow keys also move it. ${row.warnings.join(" ")}`}</title>
          <rect x="-120" y="-33" width="240" height="111" rx="10" fill={background} fillOpacity=".97" stroke={colour} strokeWidth="1.5" />
          <text x="0" y="-18" textAnchor="middle" fill="#24334b" fontSize="11" fontWeight="700">{row.room.name}</text>
          {data.display.demand && <text x="0" y="0" textAnchor="middle" fill="#24334b" fontSize="11">Heat loss: {heatingWatts(row.demand.designW)}</text>}
          <text x="0" y="17" textAnchor="middle" fill="#24334b" fontSize="11">Heat available: {balance.capacityText}</text>
          <rect className="heating-room-status-fill" x="-112" y="24" width="224" height="25" rx="6" fill={colour} />
          <text x="0" y="40" textAnchor="middle" fill="#fff" fontSize="11" fontWeight="700">{green ? "✓ " : red ? "! " : ""}{balance.indicator}</text>
          <text x="0" y="65" textAnchor="middle" fill="#475569" fontSize="10">{data.display.density ? `${Math.round(row.demand.densityWm2)} W/m² · ` : ""}{data.display.temperature ? `Target ${row.demand.targetC}°C` : ""}{data.display.warnings && row.warnings.length ? " · ⚠ Review" : ""}</text>
        </g>}
      </g>;
    })}

  </g>;
}
