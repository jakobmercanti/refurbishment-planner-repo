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
import { pipeSegmentAllowed, ufhLayoutCorners } from "@/lib/heatingGeometry";
import { resizeUFHFootprint } from "@/lib/heatingRoomResize";
import type { UFHZone } from "@/lib/heatingDocument";
import type { ServiceLabelPortal } from "./ServiceViewContext";
import { useHvac } from "./HvacContext";
import { activeFloor } from "@/lib/buildingDocument";
import { conventionalHvac } from "@/lib/hvacHeating";
import { hvacConditionsSchema, roomOperatingScenario } from "@/lib/hvacDocument";
interface Props { labelPortal?:ServiceLabelPortal; onPipeDraftChange?: (path: Point2D[]) => void; pipePointer?: Point2D | null; zoom?: number; connecting?: boolean; onConnect?: (id: string) => void; pipeDraft?: Point2D[]; data: HeatingProject; rooms: Room[]; selection: HeatingSelection; onSelect: (s: HeatingSelection) => void; onChange: (p: HeatingProject) => void; toScreen: (p: Point2D) => Point2D; fromClient: (x: number, y: number, svg: SVGSVGElement) => Point2D; highlightedRoomId: string | null; draft: Point2D[]; }
type IndicatorPositions = "roomIndicatorPositions" | "ventilationIndicatorPositions";
type Drag = { bend?: number; bendMode?: "POSITION" | "RADIUS"; source: HeatingProject; before: HeatingProject; kind: "radiator" | "manifold" | "exclusion" | "circuit" | "roomIndicator"; id: string; pathKey?: "pathMm" | "supplyPathMm" | "returnPathMm"; index?: number; segment?: boolean; start: Point2D; indicatorPositions?: IndicatorPositions };

function indicatorPosition(data: HeatingProject, key: IndicatorPositions, room: Room): Point2D {
  return data[key]?.[room.id] ?? room.vertices.reduce((centre, point) => ({
    x: centre.x + point.x / room.vertices.length, y: centre.y + point.y / room.vertices.length,
  }), { x: 0, y: 0 });
}
export function HeatingLayoutOverlay(props: Props) {
  const [preview, setPreview] = useState<HeatingProject | null>(null);
  const [editError, setEditError] = useState("");
  const [footprintPreview, setFootprintPreview] = useState<[Point2D, Point2D] | null>(null);
  const footprintDrag = useRef<{ pointerId: number; source: HeatingProject; room: Room; zone: UFHZone; index: 0 | 1; bounds: [Point2D, Point2D]; moved: boolean } | null>(null);
  const drag = useRef<Drag | null>(null), latest = useRef<HeatingProject | null>(null), data = preview ?? props.data;
  const results = useMemo(() => heatingResults(props.rooms, props.data), [props.rooms, props.data]);
  const hvac = useHvac(), ventilationProject = hvac?.tab === "Ventilation" ? hvac.project : null;
  const indicatorPositions = ventilationProject ? "ventilationIndicatorPositions" : "roomIndicatorPositions";
  const airResults = useMemo(() => {
    const layout = ventilationProject?.hvac;
    if (!ventilationProject || !layout) return null;
    const floor = activeFloor(ventilationProject);
    return new Map(props.rooms.map(room => {
      const operating = roomOperatingScenario(layout, floor.id, room.id) ?? {
        id: "plan-summary", name: "Nominal operation", floorId: floor.id, roomId: room.id,
        conditions: hvacConditionsSchema.parse({ outdoorC: props.data.buildingSettings.externalDesignTemperatureC }), ventOverrides: {}, heaterOverrides: {},
      };
      try { return [room.id, conventionalHvac(ventilationProject, operating)] as const; }
      catch { return [room.id, null] as const; }
    }));
  }, [ventilationProject, props.rooms, props.data.buildingSettings.externalDesignTemperatureC]);
  const labelAt = props.labelPortal ?? ((_anchor:Point2D,node:React.ReactNode)=>node);
  const screenPath = (p: Point2D[]) => p.map(props.toScreen).map(p => `${p.x},${p.y}`).join(" ");
  const pointFromEvent = (event: ReactPointerEvent<SVGElement> | ReactMouseEvent<SVGElement>) => props.fromClient(event.clientX, event.clientY, event.currentTarget.ownerSVGElement!);
  function moveFootprint(event: ReactPointerEvent<SVGElement>) {
    const active = footprintDrag.current;
    if (!active || event.pointerId !== active.pointerId) return;
    event.stopPropagation();
    const at = pointFromEvent(event), [min, max] = ufhLayoutCorners(active.room, { ...active.zone, layoutBoundsMm: undefined });
    const [a, b] = active.bounds, span = 2 * (active.zone.boundaryOffsetMm + active.zone.minBendRadiusMm) + 1;
    const clamp = (value: number, lo: number, hi: number) => Math.max(lo, Math.min(value, hi));
    active.bounds = active.index === 0
      ? [{ x: clamp(at.x, min.x, b.x - span), y: clamp(at.y, min.y, b.y - span) }, b]
      : [a, { x: clamp(at.x, a.x + span, max.x), y: clamp(at.y, a.y + span, max.y) }];
    active.moved = true;
    setFootprintPreview(active.bounds);
  }
  function cancelFootprint() { footprintDrag.current = null; setFootprintPreview(null); }
  function finishFootprint(event: ReactPointerEvent<SVGElement>) {
    const active = footprintDrag.current;
    if (!active || event.pointerId !== active.pointerId) return;
    event.stopPropagation(); cancelFootprint();
    if (!active.moved || active.source !== props.data) return;
    try { props.onChange(resizeUFHFootprint(active.room, active.source, active.zone, active.bounds)); setEditError(""); }
    catch (cause) { setEditError(cause instanceof Error ? cause.message : "Could not resize the UFH footprint."); }
  }
  function begin(event: ReactPointerEvent<SVGElement>, value: Omit<Drag, "before" | "start" | "source">) {
    if (event.button !== 0) return; event.preventDefault(); event.stopPropagation();
    // preventDefault retains the previous form focus; explicitly return keyboard actions to the canvas.
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
    event.currentTarget.closest<SVGElement>('[role="button"]')?.focus(); if (props.connecting && (value.kind === "radiator" || value.kind === "manifold")) { props.onConnect?.(value.id); return; } if (value.kind !== "roomIndicator") props.onSelect({ kind: value.kind, id: value.id });setEditError("");
    const circuit = data.ufhCircuits.find(c => c.circuitId === value.id), radiator = data.radiators.find(r => r.radiatorId === value.id);
    if (circuit?.locked || radiator?.locked) return;
    drag.current = { ...value, source: props.data, before: structuredClone(props.data), start: pointFromEvent(event) };latest.current = null;(event.currentTarget.closest<SVGGElement>('[aria-label="Heating layer"]') ?? event.currentTarget).setPointerCapture(event.pointerId);
  }
  function move(event: ReactPointerEvent<SVGElement>) {
    const value = drag.current;if (!value) return;event.stopPropagation();const at = pointFromEvent(event), next = structuredClone(value.before), dx = at.x - value.start.x, dy = at.y - value.start.y;
    if (value.kind === "roomIndicator") {
      const room = props.rooms.find(r => r.id === value.id);
      if (!room) return;
      const key = value.indicatorPositions ?? "roomIndicatorPositions";
      const original = indicatorPosition(value.before, key, room);
      next[key] = { ...next[key], [value.id]: { x: original.x + dx, y: original.y + dy } };
      latest.current = next;
      setPreview(next);
      return;
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
    {!ventilationProject && <>{results.rooms.map(row => <g key={row.room.id} pointerEvents="none">
        {data.display.zones && row.zones.length > 0 && <polygon points={screenPath(row.room.vertices)} fill="#da813722" stroke="#da8137" strokeWidth="1" strokeDasharray="5 4" />}
        {props.highlightedRoomId === row.room.id && row.demand.surfaces.filter(s => s.edgeIndex !== undefined && s.lossW > 0).map(s => <line key={s.key} x1={props.toScreen(s.startMm!).x} y1={props.toScreen(s.startMm!).y} x2={props.toScreen(s.endMm!).x} y2={props.toScreen(s.endMm!).y} stroke="#dd791d" strokeWidth="5" opacity=".65" />)}
    </g>)}
    {data.display.exclusions && data.exclusions.map(ex => <g key={ex.exclusionId} data-plan-info="Underfloor heating exclusion: no heated pipe should enter this area. Click to select; drag its corners to edit."><polygon points={screenPath(ex.polygonMm)} fill="url(#heating-exclusion-hatch)" fillOpacity=".5" stroke="#a15f22" strokeWidth="2" onPointerDown={e => begin(e, { kind: "exclusion", id: ex.exclusionId })} style={{ cursor: "move" }} />{props.selection?.id === ex.exclusionId && ex.polygonMm.map((p, i) => <circle key={i} cx={props.toScreen(p).x} cy={props.toScreen(p).y} r="5" fill="white" stroke="#a15f22" onPointerDown={e => begin(e, { kind: "exclusion", id: ex.exclusionId, index: i })} />)}</g>)}
    {data.ufhCircuits.map(c => <g key={c.circuitId} data-plan-info={`${c.name}\nUnderfloor heating loop · ${calculateCircuitLength(c).toFixed(1)} m. Select it to resize the whole footprint or adjust a bend radius. Drag lead corners or double-click a lead to add a point.`}>
      {(["pathMm", "supplyPathMm", "returnPathMm"] as const).map(key => {
        if (!(key === "pathMm" ? data.display.loops : data.display.tails)) return null;
        const path = c[key], selected = props.selection?.id === c.circuitId, colour = key === "returnPathMm" ? "#277ab5" : "#d76824";
        return <g key={key}><polyline points={screenPath(path)} fill="none" stroke={selected ? "#f2b644" : colour} strokeWidth={selected ? 3 : 1.8} strokeDasharray={key === "returnPathMm" ? "5 3" : undefined} pointerEvents="none" />
          <polyline points={screenPath(path)} fill="none" stroke="transparent" strokeWidth="10" onDoubleClick={key === "pathMm" ? undefined : e => insert(e, c.circuitId, key)} onPointerDown={e => { props.onSelect({ kind: "circuit", id: c.circuitId });if (e.shiftKey && key !== "pathMm") { const p = pointFromEvent(e), nearest = path.slice(1).map((b, i) => ({ i, distance: projectOnSegment(p, path[i], b).distance })).sort((a, b) => a.distance - b.distance)[0];if (nearest) begin(e, { kind: "circuit", id: c.circuitId, index: nearest.i, pathKey: key, segment: true }); }else e.stopPropagation(); }} style={{ cursor: c.locked ? "pointer" : "move" }} />
          {selected && !c.locked && (key === "pathMm" ? ufhBendControls(path, data.ufhZones.find(z => z.zoneId === c.zoneId)?.minBendRadiusMm ?? 50, c.spacingMm).bends.map((bend, index) => {
            const p = props.toScreen(bend.radiusHandle);
            return <circle key={index} role="button" tabIndex={0} aria-label={`UFH bend ${index + 1} radius`} data-ufh-handle="radius" cx={p.x} cy={p.y} r={4} fill="#ffc765" stroke="#8b4319" strokeWidth={2} style={{ cursor: "move" }} onPointerDown={e => begin(e, { kind: "circuit", id: c.circuitId, pathKey: key, bend: index, bendMode: "RADIUS" })}><title>Drag to change this bend radius</title></circle>;
          }) : path.map((p,index) => index === 0 || index === path.length - 1 ? null : <circle key={index} cx={props.toScreen(p).x} cy={props.toScreen(p).y} r={4} fill="white" stroke="#b55419" onPointerDown={e => begin(e,{kind:"circuit",id:c.circuitId,pathKey:key,index})} />))}
        </g>;
      })}
      {data.display.labels && labelAt(props.toScreen(c.pathMm[0]), <text x={props.toScreen(c.pathMm[0]).x + 7} y={props.toScreen(c.pathMm[0]).y - 7} fill="#8b4319" fontSize="10" pointerEvents="none">{c.name} · {calculateCircuitLength(c).toFixed(1)} m{c.locked ? " (locked)" : ""}</text>)}
    </g>)}
    {data.display.loops && (() => {
      const circuit = props.selection?.kind === "circuit" ? data.ufhCircuits.find(item => item.circuitId === props.selection?.id) : null;
      const zone = circuit && data.ufhZones.find(item => item.zoneId === circuit.zoneId);
      const room = zone && props.rooms.find(item => item.id === zone.roomId);
      if (!zone || !room || data.ufhCircuits.some(item => item.zoneId === zone.zoneId && item.locked)) return null;
      const bounds = ufhLayoutCorners(room, zone), points = (footprintPreview ?? bounds).map(props.toScreen);
      return <g aria-label="UFH footprint handles">
        <rect x={Math.min(points[0].x, points[1].x)} y={Math.min(points[0].y, points[1].y)} width={Math.abs(points[0].x - points[1].x)} height={Math.abs(points[0].y - points[1].y)} fill="none" stroke="#a54b23" strokeDasharray="5 4" pointerEvents="none" />
        {([0, 1] as const).map(index => <circle key={index} role="button" tabIndex={0} aria-label={`Resize UFH footprint corner ${index + 1}`} data-ufh-handle="footprint" cx={points[index].x} cy={points[index].y} r={7} fill="white" stroke="#a54b23" strokeWidth={2} style={{ cursor: "move", touchAction: "none" }}
          onPointerDown={event => { if (event.button !== 0) return; event.stopPropagation(); event.preventDefault(); event.currentTarget.focus(); event.currentTarget.setPointerCapture(event.pointerId); footprintDrag.current = { pointerId: event.pointerId, source: props.data, room, zone, index, bounds, moved: false }; }}
          onPointerMove={moveFootprint} onPointerUp={finishFootprint} onPointerCancel={cancelFootprint} onLostPointerCapture={cancelFootprint} onKeyDown={event => { if (event.key === "Escape") { event.stopPropagation(); cancelFootprint(); } }}><title>Drag to resize the whole underfloor layout</title></circle>)}
      </g>;
    })()}
    {data.pipes.map(pipe => <g key={pipe.pipeId} className="heating-pipe" data-plan-info={pipe.name+": drag route segments or corners; double-click to insert a corner; right-click a corner to delete."}><EditableHeatingPath label={pipe.name} path={pipe.pathMm} toScreen={props.toScreen} fromClient={props.fromClient} onSelect={() => props.onSelect({kind:"pipe",id:pipe.pipeId})} onChange={pathMm => props.onChange(refreshHeatingPipeEndpoints({...props.data,pipes:props.data.pipes.map(p => p.pipeId === pipe.pipeId ? {...p,pathMm} : p)}))} selected={props.selection?.id === pipe.pipeId} locked={pipe.locked} fixedStart={Boolean(pipe.fromId)} fixedEnd={Boolean(pipe.toId)} square={data.forceOrthogonalRouting === true} colour={pipe.kind === "Supply" ? "#c74b1d" : "#2377b2"} dashed={pipe.kind === "Return"} />{data.display.labels && labelAt(props.toScreen(pipe.pathMm[0]), <text x={props.toScreen(pipe.pathMm[0]).x+8} y={props.toScreen(pipe.pathMm[0]).y+15} pointerEvents="none" fill="#713413" fontSize={10}>{pipe.name} · {heatingPipeLengthM(pipe.pathMm).toFixed(1)} m</text>)}</g>)}
    {data.display.radiators && results.rooms.flatMap(row => row.emitters.map(({ radiator, outputW, estimated }) => {
      const r = data.radiators.find(r => r.radiatorId === radiator.radiatorId) ?? radiator;
      const centre = props.toScreen(r.positionMm), end = props.toScreen({ x: r.positionMm.x + r.widthMm, y: r.positionMm.y }), scale = Math.hypot(end.x - centre.x, end.y - centre.y) / r.widthMm;
      const { width, depth } = heatingPlanSize(r.widthMm * scale, r.depthMm * scale, true);
      return <g key={r.radiatorId}>{!props.labelPortal && <g transform={`translate(${centre.x},${centre.y}) rotate(${r.rotationDeg})`} onPointerDown={e => begin(e, { kind: "radiator", id: r.radiatorId })} data-plan-info={`${r.model}\nWall-mounted ${r.emitterTechnology.toLowerCase()} heater · ${outputW === null ? "output not set" : `${Math.round(outputW)} W at selected conditions`}. Click to edit; drag along a wall. Ratings must match the selected temperatures and fan mode.`} className="heating-emitter-symbol" role="button" tabIndex={0} aria-label={`Heating element: ${r.model}`} onKeyDown={event => { if (event.key === "Enter") { event.stopPropagation(); if (props.connecting) props.onConnect?.(r.radiatorId); else props.onSelect({ kind: "radiator", id: r.radiatorId }); } }} style={{ cursor: r.locked ? "pointer" : "move" }}><rect x={-width / 2} y={-depth / 2} width={width} height={depth} rx="5" fill={r.emitterTechnology === "Electric" ? "#ffe4ad" : "#fbd0bd"} stroke={props.selection?.id === r.radiatorId ? "#e5a719" : "#a54b23"} strokeWidth="2" /></g>}{data.display.output && labelAt(centre,<g transform={`translate(${centre.x} ${centre.y-depth / 2-8})`}><text textAnchor="middle" fill="#713413" fontSize="10">{r.category === "Boiler" ? `Boiler · ${Math.round((r.ratedOutputW ?? 0) / 1000)} kW CH` : outputW === null ? "Output not set" : `${r.estimatedOutput || estimated ? "~" : ""}${Math.round(outputW)} W`}</text></g>)}</g>;
    }))}
    {data.display.manifolds && data.manifolds.map(m => { const p = props.toScreen(m.positionMm), used = data.ufhCircuits.filter(c => c.manifoldId === m.manifoldId).length;return <g key={m.manifoldId}><g transform={`translate(${p.x},${p.y}) rotate(${m.rotationDeg})`} role="button" tabIndex={0} data-plan-info={`${m.name}\nUnderfloor-heating distribution point: ${used} of ${m.ports} loop connections used. Orange bar: warm-water supply. Blue bar: cooler return. Click for settings and help; drag to move.`} aria-label={`Heating manifold: ${m.name}`} onKeyDown={event => { if (event.key === "Enter") { event.stopPropagation(); if (props.connecting) props.onConnect?.(m.manifoldId); else props.onSelect({ kind: "manifold", id: m.manifoldId }); } }} onPointerDown={e => begin(e, { kind: "manifold", id: m.manifoldId })} style={{ cursor: "move" }}><rect x="-17" y="-10" width="34" height="20" rx="3" fill="#fff" stroke="#a54b23" strokeWidth="2" /><path d="M-12,-4H12" stroke="#c74b1d" strokeWidth="3" /><path d="M-12,4H12" stroke="#277ab5" strokeWidth="3" /></g>{data.display.labels && labelAt(p,<g transform={`translate(${p.x},${p.y})`}><rect data-manifold-label x={-(m.name.length + 16) * 3} y={-28} width={(m.name.length + 16) * 6} height={17} rx={3} fill="#fff" stroke="#713413" strokeWidth={.7} /><text textAnchor="middle" y="-15" fill="#713413" fontSize="10">{m.name} · {used}/{m.ports} loops</text></g>)}</g>; })}
    {(props.pipeDraft?.length ?? 0) > 0 && <EditableHeatingPath label="Draft heating pipe" path={props.pipeDraft!} toScreen={props.toScreen} fromClient={props.fromClient} onChange={path => props.onPipeDraftChange?.(path)} selected square={data.forceOrthogonalRouting === true} dashed pointer={props.pipePointer} />}
    {editError && <text x={10} y={20} fill="#ad2323" role="alert">{editError}</text>}
    {props.draft.length > 0 && <polyline points={screenPath(props.draft)} stroke="#b45c24" strokeWidth="2" fill="none" pointerEvents="none" />}</>}
    {results.rooms.map(row => {
      const label = props.toScreen(indicatorPosition(data, indicatorPositions, row.room));
      const interaction = {
        role: "button", tabIndex: 0, pointerEvents: "all", "data-heating-interactive": "true", "data-room-id": row.room.id,
        "aria-label": `Move ${ventilationProject ? "ventilation" : "heating"} summary: ${row.room.name}`,
        style: { cursor: "move", touchAction: "none" },
        onPointerDown: (event: ReactPointerEvent<SVGElement>) => begin(event, { kind: "roomIndicator", id: row.room.id, indicatorPositions }),
        onKeyDown: (event: React.KeyboardEvent<SVGElement>) => {
          const directions: Record<string, Point2D> = { ArrowLeft: { x: -50, y: 0 }, ArrowRight: { x: 50, y: 0 }, ArrowUp: { x: 0, y: 50 }, ArrowDown: { x: 0, y: -50 } };
          const direction = directions[event.key];
          if (!direction) return;
          event.preventDefault();
          event.stopPropagation();
          const original = indicatorPosition(props.data, indicatorPositions, row.room);
          props.onChange({ ...props.data, [indicatorPositions]: { ...props.data[indicatorPositions], [row.room.id]: { x: original.x + direction.x, y: original.y + direction.y } } });
        },
      };
      if (ventilationProject) {
        const air = airResults?.get(row.room.id);
        return <g key={row.room.id} pointerEvents="none">{labelAt(label, <g className="ventilation-room-indicator" transform={`translate(${label.x},${label.y + 37}) scale(${.76 * (props.zoom ?? 1)})`} {...interaction}>
          <title>Drag this ventilation summary or use the arrow keys to move it.</title>
          <rect x="-120" y="-32" width="240" height="77" rx="10" fill="#f0f7ff" stroke="#277ab5" />
          <text x="0" y="-14" textAnchor="middle" fill="#24334b" fontSize="11" fontWeight="700">{row.room.name}</text>
          <text x="0" y="5" textAnchor="middle" fill="#24334b" fontSize="11">Supply air changes: {air?.supplyACH == null ? "Unknown" : `${air.supplyACH.toFixed(2)} h⁻¹`}</text>
          <text x="0" y="25" textAnchor="middle" fill="#24334b" fontSize="11">Predicted temperature: {air?.equilibriumC == null ? "Unknown" : `${air.equilibriumC.toFixed(1)} °C`}</text>
        </g>)}</g>;
      }
      const balance = heatingRoomBalance(row), green = balance.tone === "sufficient", red = balance.tone === "insufficient";
      const colour = green ? "#15803d" : red ? "#b91c1c" : "#a16207", background = green ? "#f0fdf4" : red ? "#fff1f2" : "#fffbeb";
      return <g key={row.room.id} pointerEvents="none">
        {(data.display.demand || data.display.temperature || data.display.density) && labelAt(label, <g className="heating-room-indicator" data-balance={balance.tone} transform={`translate(${label.x},${label.y + 37}) scale(${.76 * (props.zoom ?? 1)})`} {...interaction}>
          <title>{`${row.room.name}: ${balance.headline}. ${balance.detail}. Drag this summary to move it; arrow keys also move it. ${row.warnings.join(" ")}`}</title>
          <rect x="-120" y="-33" width="240" height="111" rx="10" fill={background} fillOpacity=".97" stroke={colour} strokeWidth="1.5" />
          <text x="0" y="-18" textAnchor="middle" fill="#24334b" fontSize="11" fontWeight="700">{row.room.name}</text>
          {data.display.demand && <text x="0" y="0" textAnchor="middle" fill="#24334b" fontSize="11">Heat loss: {heatingWatts(row.demand.designW)}</text>}
          <text x="0" y="17" textAnchor="middle" fill="#24334b" fontSize="11">Heat available: {balance.capacityText}</text>
          <rect className="heating-room-status-fill" x="-112" y="24" width="224" height="25" rx="6" fill={colour} />
          <text x="0" y="40" textAnchor="middle" fill="#fff" fontSize="11" fontWeight="700">{green ? "✓ " : red ? "! " : ""}{balance.indicator}</text>
          <text x="0" y="65" textAnchor="middle" fill="#475569" fontSize="10">{data.display.density ? `${Math.round(row.demand.densityWm2)} W/m² · ` : ""}{data.display.temperature ? `Target ${row.demand.targetC}°C` : ""}{data.display.warnings && row.warnings.length ? " · ⚠ Review" : ""}</text>
        </g>)}
      </g>;
    })}

  </g>;
}
