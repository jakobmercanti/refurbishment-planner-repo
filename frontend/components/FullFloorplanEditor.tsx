"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { Point2D, ProjectFloorplanResponse } from "@/lib/types";
import type { DisplayUnits } from "@/lib/units";

type Wall = { id: string; points: Point2D[] };
type NamedOutline = { id: string; name: string; vertices: Point2D[] };
type Tool = "SELECT" | "DRAW" | "REMOVE";
interface Props { apiUrl: string; displayUnits: DisplayUnits; onOpenRoom: (name: string, vertices: Point2D[]) => void; }

const DEFAULT_SIZE = { width: 1100, height: 700 };
const SNAP = 12;

function snap(point: Point2D, walls: Wall[]): Point2D {
  const nearby = walls.flatMap((wall) => wall.points).find((candidate) => Math.hypot(candidate.x - point.x, candidate.y - point.y) <= 14);
  return nearby ?? { x: Math.round(point.x / SNAP) * SNAP, y: Math.round(point.y / SNAP) * SNAP };
}

function closedRooms(walls: Wall[], height: number): NamedOutline[] {
  return walls.filter((wall) => wall.points.length >= 4 && Math.hypot(wall.points[0].x - wall.points.at(-1)!.x, wall.points[0].y - wall.points.at(-1)!.y) <= 16)
    .map((wall, index) => ({ id: `project-room-${index + 1}`, name: `Room ${index + 1}`, vertices: wall.points.slice(0, -1).map((point) => ({ x: point.x, y: height - point.y })) }));
}

export function FullFloorplanEditor({ apiUrl, onOpenRoom }: Props) {
  const [walls, setWalls] = useState<Wall[]>([]);
  const [draft, setDraft] = useState<Point2D[]>([]);
  const [tool, setTool] = useState<Tool>("SELECT");
  const [sourceFile, setSourceFile] = useState<File | null>(null);
  const [sourceUrl, setSourceUrl] = useState<string | null>(null);
  const [canvasSize, setCanvasSize] = useState(DEFAULT_SIZE);
  const [importing, setImporting] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);
  const [finished, setFinished] = useState(false);
  const [rooms, setRooms] = useState<NamedOutline[]>([]);
  const [selectedRoomId, setSelectedRoomId] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const selectedRoom = useMemo(() => rooms.find((room) => room.id === selectedRoomId) ?? rooms[0] ?? null, [rooms, selectedRoomId]);
  useEffect(() => () => { if (sourceUrl) URL.revokeObjectURL(sourceUrl); }, [sourceUrl]);

  function canvasPoint(event: React.PointerEvent<SVGSVGElement>): Point2D {
    const matrix = event.currentTarget.getScreenCTM();
    if (!matrix) return { x: 0, y: 0 };
    const point = event.currentTarget.createSVGPoint();
    point.x = event.clientX; point.y = event.clientY;
    const mapped = point.matrixTransform(matrix.inverse());
    return snap({ x: mapped.x, y: mapped.y }, walls);
  }

  function commitDraft(points = draft) {
    if (points.length >= 2) setWalls((current) => [...current, { id: crypto.randomUUID(), points }]);
    setDraft([]); setFinished(false); setRooms([]);
  }

  async function importDrawing(file?: File) {
    if (!file) return;
    setSourceFile(file);
    if (sourceUrl) URL.revokeObjectURL(sourceUrl);
    setSourceUrl(URL.createObjectURL(file));
    setImporting(true); setImportError(null);
    try {
      const response = await fetch(`${apiUrl}/project-floorplan/detect`, { method: "POST", headers: { "Content-Type": file.type || "application/octet-stream", "X-Filename": file.name, "X-Gap-Closure": "0.15" }, body: await file.arrayBuffer() });
      const payload = await response.json() as ProjectFloorplanResponse | { detail?: string };
      if (!response.ok) throw new Error("detail" in payload ? payload.detail : "The drawing could not be recognised.");
      const result = payload as ProjectFloorplanResponse;
      setCanvasSize({ width: result.source_width_px, height: result.source_height_px });
      setWalls(result.rooms.map((room) => ({ id: room.id, points: [...room.vertices.map((point) => ({ x: point.x, y: result.source_height_px - point.y })), { x: room.vertices[0].x, y: result.source_height_px - room.vertices[0].y }] })));
      setFinished(false); setRooms([]); setTool("SELECT");
    } catch (reason) { setImportError(reason instanceof Error ? reason.message : "The drawing could not be recognised."); }
    finally { setImporting(false); }
  }

  function recogniseRooms() {
    const found = closedRooms(walls, canvasSize.height);
    setRooms(found); setSelectedRoomId(found[0]?.id ?? null);
  }

  return <section className="full-plan-shell">
    <aside className="full-plan-controls"><div className="step-badge">1</div><h2>Build floorplan</h2>
      <button className={tool === "SELECT" ? "active" : ""} onClick={() => { setTool("SELECT"); setDraft([]); }}>Select</button>
      <button className={tool === "DRAW" ? "active" : ""} onClick={() => { setTool("DRAW"); setDraft([]); }}>Add walls</button>
      <button className={tool === "REMOVE" ? "active danger" : ""} onClick={() => { setTool("REMOVE"); setDraft([]); }}>Remove walls</button><hr />
      <button onClick={() => fileInput.current?.click()}>{importing ? "Importing…" : "Import PDF or image"}</button>
      <input ref={fileInput} hidden type="file" accept="application/pdf,image/png,image/jpeg,image/webp" onChange={(event) => { void importDrawing(event.target.files?.[0]); event.target.value = ""; }} />
      {sourceFile && <small>{sourceFile.name}</small>}{importError && <p className="project-error">{importError}</p>}<hr />
      <button className="finish" disabled={!walls.length || Boolean(draft.length)} onClick={() => { setFinished(true); setTool("SELECT"); }}>Finish floorplan</button>
      {finished && <button className="recognise" onClick={recogniseRooms}>Recognise rooms</button>}
      <p className="full-plan-help">Click consecutive points to add walls. End on an existing point, double-click, or right-click.</p>
    </aside>
    <main className="full-plan-canvas-card"><header><div><span className="eyebrow">Full floorplan</span><h1>Edit the complete building layout</h1></div><span>{walls.length} wall run{walls.length === 1 ? "" : "s"}</span></header>
      <div className="full-plan-canvas">{sourceUrl && (sourceFile?.type === "application/pdf" ? <embed src={sourceUrl} type="application/pdf" /> : <img src={sourceUrl} alt="Imported floorplan underlay" />)}
        <svg viewBox={`0 0 ${canvasSize.width} ${canvasSize.height}`} preserveAspectRatio="xMidYMid meet" onPointerDown={(event) => {
          if (tool !== "DRAW" || event.button !== 0 || event.detail > 1) return;
          const point = canvasPoint(event);
          const touches = walls.some((wall) => wall.points.some((candidate) => Math.hypot(candidate.x - point.x, candidate.y - point.y) <= 14));
          const closes = draft.length >= 3 && Math.hypot(point.x - draft[0].x, point.y - draft[0].y) <= 16;
          if ((touches && draft.length) || closes) { commitDraft([...draft, closes ? draft[0] : point]); return; }
          setDraft((current) => [...current, point]);
        }} onDoubleClick={(event) => { event.preventDefault(); if (draft.length) commitDraft(); }} onContextMenu={(event) => { event.preventDefault(); if (draft.length) commitDraft(); }}>
          <defs><pattern id="full-plan-grid" width="24" height="24" patternUnits="userSpaceOnUse"><path d="M24 0H0V24" fill="none" stroke="#d6dfd9" strokeWidth="1" /></pattern></defs>
          <rect width="100%" height="100%" fill={sourceUrl ? "rgba(250,251,248,.25)" : "url(#full-plan-grid)"} />
          {walls.map((wall) => <g key={wall.id} className={tool === "REMOVE" ? "removable" : ""} onPointerDown={(event) => { if (tool === "REMOVE") { event.stopPropagation(); setWalls((current) => current.filter((item) => item.id !== wall.id)); setFinished(false); setRooms([]); } }}><polyline points={wall.points.map((point) => `${point.x},${point.y}`).join(" ")} className="full-wall-outer" /><polyline points={wall.points.map((point) => `${point.x},${point.y}`).join(" ")} className="full-wall-inner" /></g>)}
          {draft.length > 0 && <><polyline points={draft.map((point) => `${point.x},${point.y}`).join(" ")} className="full-wall-outer draft" /><polyline points={draft.map((point) => `${point.x},${point.y}`).join(" ")} className="full-wall-inner draft" /></>}
          {[...walls.flatMap((wall) => wall.points), ...draft].map((point, index) => <circle key={`${point.x}-${point.y}-${index}`} cx={point.x} cy={point.y} r="6" className="project-wall-node" />)}
        </svg>
      </div></main>
    <aside className="full-plan-rooms"><div className="step-badge">2</div><h2>Rooms</h2>{!finished ? <p>Finish the wall layout before recognising rooms.</p> : rooms.length === 0 ? <p>Select Recognise rooms when the geometry is ready.</p> : rooms.map((room) => <div key={room.id} className={selectedRoom?.id === room.id ? "selected" : ""} onClick={() => setSelectedRoomId(room.id)}><input value={room.name} onClick={(event) => event.stopPropagation()} onChange={(event) => setRooms((current) => current.map((item) => item.id === room.id ? { ...item, name: event.target.value } : item))} /><small>{room.vertices.length} walls</small></div>)}<button disabled={!selectedRoom} onClick={() => selectedRoom && onOpenRoom(selectedRoom.name, selectedRoom.vertices)}>Open in room editor</button></aside>
  </section>;
}
