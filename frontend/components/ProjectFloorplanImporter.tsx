"use client";

import { useEffect, useMemo, useState } from "react";
import type { DetectedProjectRoom, Point2D, ProjectFloorplanResponse } from "@/lib/types";
import { fromDisplayNumber, toDisplayNumber, UNIT_LABEL, type DisplayUnits } from "@/lib/units";

interface ProjectFloorplanImporterProps {
  apiUrl: string;
  onOpenRoom: (name: string, vertices: Point2D[]) => void;
  displayUnits: DisplayUnits;
}

function previewPoints(vertices: Point2D[]): string {
  const minX = Math.min(...vertices.map((point) => point.x));
  const maxX = Math.max(...vertices.map((point) => point.x));
  const minY = Math.min(...vertices.map((point) => point.y));
  const maxY = Math.max(...vertices.map((point) => point.y));
  const scale = Math.min(150 / Math.max(1, maxX - minX), 110 / Math.max(1, maxY - minY));
  return vertices.map((point) => `${25 + (point.x - minX) * scale},${135 - (point.y - minY) * scale}`).join(" ");
}

function scaleRoom(vertices: Point2D[], millimetresPerPixel: number): Point2D[] {
  const minX = Math.min(...vertices.map((point) => point.x));
  const minY = Math.min(...vertices.map((point) => point.y));
  return vertices.map((point) => ({
    x: Math.round((point.x - minX) * millimetresPerPixel),
    y: Math.round((point.y - minY) * millimetresPerPixel),
  }));
}

export function ProjectFloorplanImporter({ apiUrl, onOpenRoom, displayUnits }: ProjectFloorplanImporterProps) {
  const [file, setFile] = useState<File | null>(null);
  const [result, setResult] = useState<ProjectFloorplanResponse | null>(null);
  const [selectedRoomId, setSelectedRoomId] = useState<string | null>(null);
  const [roomNames, setRoomNames] = useState<Record<string, string>>({});
  const [millimetresPerPixel, setMillimetresPerPixel] = useState(10);
  const gapClosure = 0.15;
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const previewUrl = useMemo(() => file && file.type !== "application/pdf" ? URL.createObjectURL(file) : null, [file]);
  useEffect(() => () => { if (previewUrl) URL.revokeObjectURL(previewUrl); }, [previewUrl]);

  const selectedRoom = useMemo(() => result?.rooms.find((room) => room.id === selectedRoomId) ?? result?.rooms[0] ?? null, [result, selectedRoomId]);

  async function detectRooms() {
    if (!file) return;
    setLoading(true);
    setError(null);
    try {
      const response = await fetch(`${apiUrl}/project-floorplan/detect`, {
        method: "POST",
        headers: { "Content-Type": file.type || "application/octet-stream", "X-Filename": file.name, "X-Gap-Closure": String(gapClosure) },
        body: await file.arrayBuffer(),
      });
      const payload = await response.json() as ProjectFloorplanResponse | { detail?: string };
      if (!response.ok) throw new Error("detail" in payload ? payload.detail : "The floorplan could not be read.");
      const recognised = payload as ProjectFloorplanResponse;
      setResult(recognised);
      setRoomNames(Object.fromEntries(recognised.rooms.map((room) => [room.id, room.name])));
      setSelectedRoomId(recognised.rooms[0]?.id ?? null);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "The floorplan could not be read.");
    } finally {
      setLoading(false);
    }
  }

  function openSelectedRoom() {
    if (!selectedRoom || !Number.isFinite(millimetresPerPixel) || millimetresPerPixel <= 0) return;
    onOpenRoom(roomNames[selectedRoom.id]?.trim() || selectedRoom.name, scaleRoom(selectedRoom.vertices, millimetresPerPixel));
  }

  return <section className="project-floorplan-page">
    <div className="project-floorplan-intro">
      <div><span className="eyebrow">Project floorplan</span><h1>Start from an existing drawing</h1><p>Upload a PDF, JPG, PNG or WEBP floorplan. Renovation Fit identifies enclosed rooms locally; choose one to open it in the existing editable floorplan.</p></div>
      <div className="project-safety-note"><strong>Draft recognition</strong><span>Image outlines and scale always need your review before fit analysis.</span></div>
    </div>
    <div className="project-floorplan-grid">
      <section className="project-upload-card">
        <h2>1 · Add a drawing</h2>
        <label className="project-file-input"><input type="file" accept="application/pdf,image/jpeg,image/png,image/webp" onChange={(event) => { setFile(event.target.files?.[0] ?? null); setResult(null); setError(null); }} /><span>{file ? file.name : "Choose PDF or image"}</span><small>PDF, JPG, PNG or WEBP · up to 25 MB</small></label>
        <button className="project-primary" type="button" onClick={detectRooms} disabled={!file || loading}>{loading ? "Reading drawing…" : result ? "Recognise again" : "Recognise rooms"}</button>
        {error && <p className="project-error">{error}</p>}
        {previewUrl ? <div className="project-source-map"><img className="project-source-preview" src={previewUrl} alt="Uploaded floorplan preview" />{result && <svg viewBox={`0 0 ${result.source_width_px} ${result.source_height_px}`} preserveAspectRatio="xMidYMid meet" aria-label="Detected rooms overlaid on uploaded floorplan">{result.rooms.map((room) => <polygon key={room.id} className={selectedRoom?.id === room.id ? "selected" : ""} points={room.vertices.map((point) => `${point.x},${result.source_height_px - point.y}`).join(" ")} onClick={() => setSelectedRoomId(room.id)} />)}</svg>}</div> : file?.type === "application/pdf" ? <div className="project-pdf-preview">PDF remains loaded · recognition uses page 1</div> : null}
      </section>
      <section className="project-rooms-card">
        <div className="project-room-heading"><div><h2>2 · Select a room</h2><p>{result ? `${result.rooms.length} detected outline${result.rooms.length === 1 ? "" : "s"}` : "Upload a drawing to find rooms."}</p></div>{result && <label>Scale <input type="number" min="0.01" step="0.01" value={toDisplayNumber(millimetresPerPixel, displayUnits)} onChange={(event) => setMillimetresPerPixel(fromDisplayNumber(Number(event.target.value), displayUnits))} /> <small>{UNIT_LABEL[displayUnits]} / pixel</small></label>}</div>
        {result && <p className="project-warning">{result.warning}</p>}
        <div className="project-room-list">{result?.rooms.map((room: DetectedProjectRoom) => <div key={room.id} className={`project-room-option ${selectedRoom?.id === room.id ? "selected" : ""}`} onClick={() => setSelectedRoomId(room.id)}><svg viewBox="0 0 200 160" aria-hidden="true"><polygon points={previewPoints(room.vertices)} /></svg><span><input aria-label={`Room ${room.id} name`} value={roomNames[room.id] ?? room.name} onChange={(event) => setRoomNames((current) => ({ ...current, [room.id]: event.target.value }))} onClick={(event) => event.stopPropagation()} /><small>{Math.round(room.area_px2).toLocaleString()} px² · {room.vertices.length} corners</small><em>{Math.round(room.confidence * 100)}% outline confidence</em></span></div>)}</div>
        <button className="project-primary" type="button" disabled={!selectedRoom || !Number.isFinite(millimetresPerPixel) || millimetresPerPixel <= 0} onClick={openSelectedRoom}>Open selected room in floorplan editor</button>
      </section>
    </div>
  </section>;
}
