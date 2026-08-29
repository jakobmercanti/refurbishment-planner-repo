"use client";

import { useMemo, useState } from "react";
import { ProjectFloorplanImporter } from "@/components/ProjectFloorplanImporter";
import type { Point2D } from "@/lib/types";
import type { DisplayUnits } from "@/lib/units";

type Wall = { id: string; points: Point2D[] };
type NamedOutline = { id: string; name: string; vertices: Point2D[] };

interface Props {
  apiUrl: string;
  displayUnits: DisplayUnits;
  onOpenRoom: (name: string, vertices: Point2D[]) => void;
}

const WIDTH = 980;
const HEIGHT = 610;
const SNAP = 12;

function snap(point: Point2D, walls: Wall[]): Point2D {
  const endpoints = walls.flatMap((wall) => [wall.points[0], wall.points.at(-1)!]);
  const nearby = endpoints.find((candidate) => Math.hypot(candidate.x - point.x, candidate.y - point.y) <= 14);
  return nearby ?? { x: Math.round(point.x / SNAP) * SNAP, y: Math.round(point.y / SNAP) * SNAP };
}

function closedOutlines(walls: Wall[]): NamedOutline[] {
  return walls.filter((wall) => wall.points.length >= 4 && Math.hypot(wall.points[0].x - wall.points.at(-1)!.x, wall.points[0].y - wall.points.at(-1)!.y) <= 16)
    .map((wall, index) => ({ id: `manual-room-${index + 1}`, name: `Room ${index + 1}`, vertices: wall.points.slice(0, -1) }));
}

export function FullFloorplanEditor({ apiUrl, displayUnits, onOpenRoom }: Props) {
  const [walls, setWalls] = useState<Wall[]>([]);
  const [draft, setDraft] = useState<Point2D[]>([]);
  const [tool, setTool] = useState<"DRAW" | "REMOVE">("DRAW");
  const [showImporter, setShowImporter] = useState(false);
  const [rooms, setRooms] = useState<NamedOutline[]>([]);
  const [selectedRoomId, setSelectedRoomId] = useState<string | null>(null);
  const selectedRoom = useMemo(() => rooms.find((room) => room.id === selectedRoomId) ?? rooms[0] ?? null, [rooms, selectedRoomId]);

  function canvasPoint(event: React.PointerEvent<SVGSVGElement>): Point2D {
    const bounds = event.currentTarget.getBoundingClientRect();
    return snap({ x: (event.clientX - bounds.left) * WIDTH / bounds.width, y: (event.clientY - bounds.top) * HEIGHT / bounds.height }, walls);
  }

  function finishDraft(close = false) {
    if (draft.length < 2) { setDraft([]); return; }
    const points = close && draft.length >= 3 ? [...draft, draft[0]] : draft;
    setWalls((current) => [...current, { id: crypto.randomUUID(), points }]);
    setDraft([]);
  }

  function recogniseRooms() {
    const detected = closedOutlines(walls);
    setRooms(detected);
    setSelectedRoomId(detected[0]?.id ?? null);
  }

  return <section className="full-floorplan-editor">
    <header className="full-floorplan-toolbar">
      <div><span className="eyebrow">Full floorplan</span><h1>Define walls and rooms</h1></div>
      <div className="full-floorplan-actions">
        <button className={tool === "DRAW" ? "active" : ""} onClick={() => setTool("DRAW")}>Add walls</button>
        <button className={tool === "REMOVE" ? "active danger" : ""} onClick={() => { setTool("REMOVE"); setDraft([]); }}>Remove walls</button>
        <button onClick={() => setShowImporter((value) => !value)}>Import PDF or image</button>
        <button className="primary" onClick={recogniseRooms}>Recognise rooms</button>
      </div>
    </header>
    <p className="full-floorplan-help">Click successive points to draw walls. Finish by clicking the first point, double-clicking, right-clicking, or clicking an existing wall endpoint.</p>
    <div className="full-floorplan-workspace">
      <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} onPointerDown={(event) => {
        if (tool !== "DRAW" || event.button !== 0) return;
        const point = canvasPoint(event);
        const closes = draft.length >= 3 && Math.hypot(point.x - draft[0].x, point.y - draft[0].y) <= 16;
        if (closes) { setDraft((current) => [...current, current[0]]); setTimeout(() => finishDraft(true), 0); return; }
        setDraft((current) => [...current, point]);
      }} onDoubleClick={() => finishDraft()} onContextMenu={(event) => { event.preventDefault(); finishDraft(); }}>
        <defs><pattern id="project-grid" width="24" height="24" patternUnits="userSpaceOnUse"><path d="M 24 0 L 0 0 0 24" fill="none" stroke="#d7dfda" strokeWidth="1" /></pattern></defs>
        <rect width={WIDTH} height={HEIGHT} fill="url(#project-grid)" />
        {walls.map((wall) => <polyline key={wall.id} points={wall.points.map((point) => `${point.x},${point.y}`).join(" ")} className={`project-wall ${tool === "REMOVE" ? "removable" : ""}`} onPointerDown={(event) => { if (tool === "REMOVE") { event.stopPropagation(); setWalls((current) => current.filter((item) => item.id !== wall.id)); } }} />)}
        {draft.length > 0 && <polyline points={draft.map((point) => `${point.x},${point.y}`).join(" ")} className="project-wall draft" />}
        {[...walls.flatMap((wall) => wall.points), ...draft].map((point, index) => <circle key={`${point.x}-${point.y}-${index}`} cx={point.x} cy={point.y} r="5" className="project-wall-node" />)}
      </svg>
      <aside className="full-floorplan-rooms"><h2>Rooms</h2>{rooms.length === 0 ? <p>Close wall outlines, then select Recognise rooms.</p> : rooms.map((room) => <div key={room.id} className={selectedRoom?.id === room.id ? "selected" : ""} onClick={() => setSelectedRoomId(room.id)}><input value={room.name} onClick={(event) => event.stopPropagation()} onChange={(event) => setRooms((current) => current.map((item) => item.id === room.id ? { ...item, name: event.target.value } : item))} /><small>{room.vertices.length} walls</small></div>)}<button disabled={!selectedRoom} onClick={() => selectedRoom && onOpenRoom(selectedRoom.name, selectedRoom.vertices)}>Open selected room</button></aside>
    </div>
    {showImporter && <div className="embedded-floorplan-importer"><ProjectFloorplanImporter apiUrl={apiUrl} displayUnits={displayUnits} onOpenRoom={onOpenRoom} /></div>}
  </section>;
}
