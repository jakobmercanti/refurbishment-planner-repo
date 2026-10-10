"use client";
import { useMemo, useRef, useState, type PointerEvent as ReactPointerEvent, type MouseEvent as ReactMouseEvent } from "react";
import type { Point2D, Room } from "@/lib/types";
import type { HeatingProject } from "@/lib/heatingDocument";
import { heatingResults } from "@/lib/heatingDesign";
import { heatingRoomBalance, heatingWatts } from "@/lib/heatingPresentation";
import { calculateCircuitLength, projectOnSegment, snapRadiatorToWall } from "@/lib/heatingCalculations";
import type { HeatingSelection } from "./HeatingLayoutPanel";
import { heatingPipeLengthM, refreshHeatingPipeEndpoints } from "@/lib/heatingPipes";
interface Props { connecting?: boolean; onConnect?: (id: string) => void; pipeDraft?: Point2D[]; data: HeatingProject; rooms: Room[]; selection: HeatingSelection; onSelect: (s: HeatingSelection) => void; onChange: (p: HeatingProject) => void; toScreen: (p: Point2D) => Point2D; fromClient: (x: number, y: number, svg: SVGSVGElement) => Point2D; highlightedRoomId: string | null; draft: Point2D[]; }
type Drag = { before: HeatingProject; kind: "radiator" | "manifold" | "exclusion" | "circuit" | "pipe"; id: string; pathKey?: "pathMm" | "supplyPathMm" | "returnPathMm"; index?: number; segment?: boolean; start: Point2D; };
export function HeatingLayoutOverlay(props: Props) {
  const [preview, setPreview] = useState<HeatingProject | null>(null), [menu, setMenu] = useState<{ id: string; key: "pathMm" | "supplyPathMm" | "returnPathMm"; index: number; at: Point2D } | null>(null);
  const drag = useRef<Drag | null>(null), latest = useRef<HeatingProject | null>(null), data = preview ?? props.data;
  const results = useMemo(() => heatingResults(props.rooms, props.data), [props.rooms, props.data]);
  const screenPath = (p: Point2D[]) => p.map(props.toScreen).map(p => `${p.x},${p.y}`).join(" ");
  const pointFromEvent = (event: ReactPointerEvent<SVGElement> | ReactMouseEvent<SVGElement>) => props.fromClient(event.clientX, event.clientY, event.currentTarget.ownerSVGElement!);
  function begin(event: ReactPointerEvent<SVGElement>, value: Omit<Drag, "before" | "start">) {
    if (event.button !== 0) return; event.preventDefault(); event.stopPropagation();
    // preventDefault retains the previous form focus; explicitly return keyboard actions to the canvas.
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
    event.currentTarget.closest<SVGElement>('[role="button"]')?.focus(); if (props.connecting && (value.kind === "radiator" || value.kind === "manifold")) { props.onConnect?.(value.id); return; } props.onSelect({ kind: value.kind, id: value.id });setMenu(null);
    const circuit = data.ufhCircuits.find(c => c.circuitId === value.id), radiator = data.radiators.find(r => r.radiatorId === value.id);
    if (circuit?.locked || radiator?.locked || data.pipes.find(p => p.pipeId === value.id)?.locked) return;
    drag.current = { ...value, before: structuredClone(props.data), start: pointFromEvent(event) };event.currentTarget.setPointerCapture(event.pointerId);
  }
  function move(event: ReactPointerEvent<SVGElement>) {
    const value = drag.current;if (!value) return;event.stopPropagation();const at = pointFromEvent(event), next = structuredClone(value.before), dx = at.x - value.start.x, dy = at.y - value.start.y;
    if (value.kind === "radiator") { const r = next.radiators.find(r => r.radiatorId === value.id)!, room = props.rooms.find(room => room.id === r.roomId);if (room) Object.assign(r, snapRadiatorToWall(r, room, at)); }
    if (value.kind === "pipe") { const p = next.pipes.find(p => p.pipeId === value.id)!; if (value.index !== undefined && !(value.index === 0 && p.fromId) && !(value.index === p.pathMm.length - 1 && p.toId)) p.pathMm[value.index] = at; }
    if (value.kind === "manifold") { const m = next.manifolds.find(m => m.manifoldId === value.id)!;m.positionMm = at;for (const c of next.ufhCircuits.filter(c => c.manifoldId === m.manifoldId)) { c.supplyPathMm[0] = at;c.returnPathMm[c.returnPathMm.length - 1] = at; } }
    if (value.kind === "exclusion") { const ex = next.exclusions.find(e => e.exclusionId === value.id)!;if (value.index !== undefined) ex.polygonMm[value.index] = at;else ex.polygonMm = ex.polygonMm.map(p => ({ x: p.x + dx, y: p.y + dy })); }
    if (value.kind === "circuit") { const c = next.ufhCircuits.find(c => c.circuitId === value.id)!, key = value.pathKey!;if (value.segment) { for (const index of [value.index!, value.index! + 1]) c[key][index] = { x: c[key][index].x + dx, y: c[key][index].y + dy }; }else c[key][value.index!] = at;c.manuallyEdited = true;
      if (key === "pathMm") { c.supplyPathMm[c.supplyPathMm.length - 1] = c.pathMm[0];c.returnPathMm[0] = c.pathMm.at(-1)!; }
      if (key === "supplyPathMm" && value.index === c.supplyPathMm.length - 1) c.pathMm[0] = c.supplyPathMm.at(-1)!;
      if (key === "returnPathMm" && value.index === 0) c.pathMm[c.pathMm.length - 1] = c.returnPathMm[0];
    }
    Object.assign(next, refreshHeatingPipeEndpoints(next));latest.current = next;setPreview(next);
  }
  function finish(event: ReactPointerEvent<SVGElement>) { if (!drag.current) return;event.stopPropagation();if (latest.current) props.onChange(latest.current);drag.current = null;latest.current = null;setPreview(null); }
  function insert(event: ReactMouseEvent<SVGPolylineElement>, id: string, key: "pathMm" | "supplyPathMm" | "returnPathMm") {
    event.preventDefault();event.stopPropagation();const next = structuredClone(props.data), circuit = next.ufhCircuits.find(c => c.circuitId === id)!;if (circuit.locked) return;
    const p = pointFromEvent(event), nearest = circuit[key].slice(1).map((b, i) => ({ ...projectOnSegment(p, circuit[key][i], b), i })).sort((a, b) => a.distance - b.distance)[0];
    if (!nearest) return;circuit[key].splice(nearest.i + 1, 0, nearest.point);circuit.manuallyEdited = true;props.onChange(next);props.onSelect({ kind: "circuit", id });
  }
  return <g data-heating-interactive="true" aria-label="Heating layer" onPointerMove={move} onPointerUp={finish} onPointerCancel={event => { event.stopPropagation();drag.current = null;latest.current = null;setPreview(null); }}>
    <defs><pattern id="heating-exclusion-hatch" width="8" height="8" patternUnits="userSpaceOnUse"><path d="M0,8L8,0" stroke="#aa6b29" strokeWidth="1" /></pattern></defs>
    {results.rooms.map(row => {
      const pts = row.room.vertices.map(props.toScreen), label = { x: pts.reduce((s, p) => s + p.x, 0) / pts.length, y: pts.reduce((s, p) => s + p.y, 0) / pts.length };
      const balance = heatingRoomBalance(row), green = balance.tone === "sufficient", red = balance.tone === "insufficient";
      const colour = green ? "#15803d" : red ? "#b91c1c" : "#a16207", background = green ? "#f0fdf4" : red ? "#fff1f2" : "#fffbeb";
      return <g key={row.room.id} pointerEvents="none">
        {data.display.zones && row.zones.length > 0 && <polygon points={screenPath(row.room.vertices)} fill="#da813722" stroke="#da8137" strokeWidth="1" strokeDasharray="5 4" />}
        {props.highlightedRoomId === row.room.id && row.demand.surfaces.filter(s => s.edgeIndex !== undefined && s.lossW > 0).map(s => <line key={s.key} x1={props.toScreen(s.startMm!).x} y1={props.toScreen(s.startMm!).y} x2={props.toScreen(s.endMm!).x} y2={props.toScreen(s.endMm!).y} stroke="#dd791d" strokeWidth="5" opacity=".65" />)}
        {(data.display.demand || data.display.temperature || data.display.density) && <g className="heating-room-indicator" data-room-id={row.room.id} data-balance={balance.tone} transform={`translate(${label.x},${label.y + 37})`}>
          <title>{`${row.room.name}: ${balance.headline}. ${balance.detail}. ${row.warnings.join(" ")}`}</title>
          <rect x="-120" y="-16" width="240" height="94" rx="10" fill={background} fillOpacity=".97" stroke={colour} strokeWidth="1.5" />
          {data.display.demand && <text x="0" y="0" textAnchor="middle" fill="#24334b" fontSize="11">Heat loss: {heatingWatts(row.demand.designW)}</text>}
          <text x="0" y="17" textAnchor="middle" fill="#24334b" fontSize="11">Heat available: {balance.capacityText}</text>
          <rect className="heating-room-status-fill" x="-112" y="24" width="224" height="25" rx="6" fill={colour} />
          <text x="0" y="40" textAnchor="middle" fill="#fff" fontSize="11" fontWeight="700">{green ? "✓ " : red ? "! " : ""}{balance.indicator}</text>
          <text x="0" y="65" textAnchor="middle" fill="#475569" fontSize="10">{data.display.density ? `${Math.round(row.demand.densityWm2)} W/m² · ` : ""}{data.display.temperature ? `Target ${row.demand.targetC}°C` : ""}{data.display.warnings && row.warnings.length ? " · ⚠ Review" : ""}</text>
        </g>}
      </g>;
    })}
    {data.display.exclusions && data.exclusions.map(ex => <g key={ex.exclusionId}><polygon points={screenPath(ex.polygonMm)} fill="url(#heating-exclusion-hatch)" fillOpacity=".5" stroke="#a15f22" strokeWidth="2" onPointerDown={e => begin(e, { kind: "exclusion", id: ex.exclusionId })} style={{ cursor: "move" }} />{props.selection?.id === ex.exclusionId && ex.polygonMm.map((p, i) => <circle key={i} cx={props.toScreen(p).x} cy={props.toScreen(p).y} r="5" fill="white" stroke="#a15f22" onPointerDown={e => begin(e, { kind: "exclusion", id: ex.exclusionId, index: i })} />)}</g>)}
    {data.ufhCircuits.map(c => <g key={c.circuitId}>
      {(["pathMm", "supplyPathMm", "returnPathMm"] as const).map(key => {
        if (!(key === "pathMm" ? data.display.loops : data.display.tails)) return null;
        const path = c[key], selected = props.selection?.id === c.circuitId, colour = key === "returnPathMm" ? "#277ab5" : "#d76824";
        return <g key={key}><polyline points={screenPath(path)} fill="none" stroke={selected ? "#f2b644" : colour} strokeWidth={selected ? 3 : 1.8} strokeDasharray={key === "returnPathMm" ? "5 3" : undefined} pointerEvents="none" />
          <polyline points={screenPath(path)} fill="none" stroke="transparent" strokeWidth="10" onDoubleClick={e => insert(e, c.circuitId, key)} onPointerDown={e => { props.onSelect({ kind: "circuit", id: c.circuitId });if (e.shiftKey) { const p = pointFromEvent(e), nearest = path.slice(1).map((b, i) => ({ i, distance: projectOnSegment(p, path[i], b).distance })).sort((a, b) => a.distance - b.distance)[0];if (nearest) begin(e, { kind: "circuit", id: c.circuitId, index: nearest.i, pathKey: key, segment: true }); }else e.stopPropagation(); }} style={{ cursor: c.locked ? "pointer" : "move" }} />
          {selected && !c.locked && path.map((p, index) => index === 0 || index === path.length - 1 || index % Math.max(1, Math.ceil(path.length / 100)) === 0 ? <circle key={index} cx={props.toScreen(p).x} cy={props.toScreen(p).y} r="4" fill="white" stroke="#b55419" onPointerDown={e => begin(e, { kind: "circuit", id: c.circuitId, pathKey: key, index })} onContextMenu={e => { e.preventDefault();e.stopPropagation();setMenu({ id: c.circuitId, key, index, at: props.toScreen(p) }); }} /> : null)}
        </g>;
      })}
      {data.display.labels && <text x={props.toScreen(c.pathMm[0]).x + 7} y={props.toScreen(c.pathMm[0]).y - 7} fill="#8b4319" fontSize="10" pointerEvents="none">{c.name} · {calculateCircuitLength(c).toFixed(1)} m{c.locked ? " (locked)" : ""}</text>}
    </g>)}
    {data.pipes.map(pipe => <g key={pipe.pipeId} className="heating-pipe"><title>{pipe.name}: {heatingPipeLengthM(pipe.pathMm).toFixed(1)} m (drawing route)</title><polyline points={screenPath(pipe.pathMm)} fill="none" stroke={pipe.kind === "Supply" ? "#c74b1d" : "#2377b2"} strokeWidth={props.selection?.id === pipe.pipeId ? 4 : 2.5} strokeDasharray={pipe.kind === "Return" ? "6 4" : undefined} /><polyline points={screenPath(pipe.pathMm)} fill="none" stroke="transparent" strokeWidth="14" onPointerDown={e => { e.stopPropagation(); props.onSelect({ kind: "pipe", id: pipe.pipeId }); }} onDoubleClick={e => { e.preventDefault(); e.stopPropagation(); if (pipe.locked) return; const at = pointFromEvent(e), nearest = pipe.pathMm.slice(1).map((p, i) => ({ i, ...projectOnSegment(at, pipe.pathMm[i], p) })).sort((a, b) => a.distance - b.distance)[0]; if (!nearest) return; const next = structuredClone(props.data), path = next.pipes.find(p => p.pipeId === pipe.pipeId)!.pathMm; path.splice(nearest.i + 1, 0, nearest.point); props.onChange(next); }} />{props.selection?.id === pipe.pipeId && !pipe.locked && pipe.pathMm.map((p, index) => <circle key={index} cx={props.toScreen(p).x} cy={props.toScreen(p).y} r="5" fill="white" stroke="#9a4e24" onPointerDown={e => begin(e, { kind: "pipe", id: pipe.pipeId, index })} onContextMenu={e => { e.preventDefault(); e.stopPropagation(); if (index === 0 || index === pipe.pathMm.length - 1) return; const next = structuredClone(props.data); next.pipes.find(p => p.pipeId === pipe.pipeId)!.pathMm.splice(index, 1); props.onChange(next); }} />)}{data.display.labels && <text x={props.toScreen(pipe.pathMm[0]).x + 8} y={props.toScreen(pipe.pathMm[0]).y + 15} fill="#713413" fontSize="10" pointerEvents="none">{pipe.name} · {heatingPipeLengthM(pipe.pathMm).toFixed(1)} m</text>}</g>)}
    {data.display.radiators && results.rooms.flatMap(row => row.emitters.map(({ radiator, outputW, estimated }) => {
      const r = data.radiators.find(r => r.radiatorId === radiator.radiatorId) ?? radiator;
      const centre = props.toScreen(r.positionMm), end = props.toScreen({ x: r.positionMm.x + r.widthMm, y: r.positionMm.y }), scale = Math.hypot(end.x - centre.x, end.y - centre.y) / r.widthMm;
      return <g key={r.radiatorId} transform={`translate(${centre.x},${centre.y}) rotate(${r.rotationDeg})`} onPointerDown={e => begin(e, { kind: "radiator", id: r.radiatorId })} className="heating-emitter-symbol" role="button" tabIndex={0} aria-label={`Heating element: ${r.model}`} onKeyDown={event => { if (event.key === "Enter") { event.stopPropagation(); if (props.connecting) props.onConnect?.(r.radiatorId); else props.onSelect({ kind: "radiator", id: r.radiatorId }); } }} style={{ cursor: r.locked ? "pointer" : "move" }}><rect x={-Math.max(64, r.widthMm * scale) / 2} y={-Math.max(24, r.depthMm * scale) / 2} width={Math.max(64, r.widthMm * scale)} height={Math.max(24, r.depthMm * scale)} rx="5" fill={r.emitterTechnology === "Electric" ? "#ffe4ad" : "#fbd0bd"} stroke={props.selection?.id === r.radiatorId ? "#e5a719" : "#a54b23"} strokeWidth="2" />{data.display.output && <g transform={`translate(0 ${-Math.max(24, r.depthMm * scale) / 2 - 8}) rotate(${-r.rotationDeg})`}><text textAnchor="middle" fill="#713413" fontSize="10">{r.category === "Boiler" ? `Boiler · ${Math.round((r.ratedOutputW ?? 0) / 1000)} kW CH` : outputW === null ? "Output not set" : `${r.estimatedOutput || estimated ? "~" : ""}${Math.round(outputW)} W`}</text></g>}</g>;
    }))}
    {data.display.manifolds && data.manifolds.map(m => { const p = props.toScreen(m.positionMm);return <g key={m.manifoldId} transform={`translate(${p.x},${p.y}) rotate(${m.rotationDeg})`} role="button" tabIndex={0} aria-label={`Heating manifold: ${m.name}`} onKeyDown={event => { if (event.key === "Enter") { event.stopPropagation(); if (props.connecting) props.onConnect?.(m.manifoldId); else props.onSelect({ kind: "manifold", id: m.manifoldId }); } }} onPointerDown={e => begin(e, { kind: "manifold", id: m.manifoldId })} style={{ cursor: "move" }}><rect x="-17" y="-10" width="34" height="20" rx="3" fill="#fff" stroke="#a54b23" strokeWidth="2" /><path d="M-12,-4H12M-12,4H12" stroke="#277ab5" strokeWidth="3" />{data.display.labels && <text textAnchor="middle" y="-15" fill="#713413" fontSize="10">{m.name} ({m.ports})</text>}</g>; })}
    {(props.pipeDraft?.length ?? 0) > 0 && <polyline points={screenPath(props.pipeDraft!)} stroke="#c74b1d" strokeWidth="3" strokeDasharray="5 4" fill="none" pointerEvents="none" />}
    {props.draft.length > 0 && <polyline points={screenPath(props.draft)} stroke="#b45c24" strokeWidth="2" fill="none" pointerEvents="none" />}
    {menu && <foreignObject x={menu.at.x} y={menu.at.y} width="180" height="70"><div style={{ background: "#fff", padding: 5, border: "1px solid #a54b23", color: "#222" }}><button onClick={() => { const next = structuredClone(props.data), c = next.ufhCircuits.find(c => c.circuitId === menu.id);if (c && !c.locked && menu.index > 0 && menu.index < c[menu.key].length - 1) { c[menu.key].splice(menu.index, 1);c.manuallyEdited = true;props.onChange(next); }setMenu(null); }}>Delete control point</button><button onClick={() => setMenu(null)}>Cancel</button></div></foreignObject>}
  </g>;
}
