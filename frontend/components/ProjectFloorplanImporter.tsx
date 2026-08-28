"use client";

import { useMemo, useState } from "react";
import type { DetectedProjectRoom, Point2D, ProjectFloorplanResponse } from "@/lib/types";

interface ProjectFloorplanImporterProps {
  apiUrl: string;
  onOpenRoom: (name: string, vertices: Point2D[]) => void;
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

export function ProjectFloorplanImporter({ apiUrl, onOpenRoom }: ProjectFloorplanImporterProps) {
  const [file, setFile] = useState<File | null>(null);
  const [result, setResult] = useState<ProjectFloorplanResponse | null>(null);
  const [selectedRoomId, setSelectedRoomId] = useState<string | null>(null);
  const [millimetresPerPixel, setMillimetresPerPixel] = useState(10);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const previewUrl = useMemo(() => file && file.type !== "application/pdf" ? URL.createObjectURL(file) : null, [file]);

  const selectedRoom = useMemo(() => result?.rooms.find((room) => room.id === selectedRoomId) ?? result?.rooms[0] ?? null, [result, selectedRoomId]);

  async function detectRooms() {
    if (!file) return;
    setLoading(true);
    setError(null);
    try {
      const response = await fetch(`${apiUrl}/project-floorplan/detect`, {
        method: "POST",
        headers: { "Content-Type": file.type || "application/octet-stream", "X-Filename": file.name },
        body: await file.arrayBuffer(),
      });
      const payload = await response.json() as ProjectFloorplanResponse | { detail?: string };
      if (!response.ok) throw new Error("detail" in payload ? payload.detail : "The floorplan could not be read.");
      const recognised = payload as ProjectFloorplanResponse;
      setResult(recognised);
      setSelectedRoomId(recognised.rooms[0]?.id ?? null);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "The floorplan could not be read.");
    } finally {
      setLoading(false);
    }
  }

  function openSelectedRoom() {
    if (!selectedRoom || !Number.isFinite(millimetresPerPixel) || millimetresPerPixel <= 0) return;
    onOpenRoom(selectedRoom.name, scaleRoom(selectedRoom.vertices, millimetresPerPixel));
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
        <button className="project-primary" type="button" onClick={detectRooms} disabled={!file || loading}>{loading ? "Reading drawing…" : "Recognise rooms"}</button>
        {error && <p className="project-error">{error}</p>}
        {previewUrl ? <img className="project-source-preview" src={previewUrl} alt="Uploaded floorplan preview" /> : file?.type === "application/pdf" ? <div className="project-pdf-preview">PDF ready for recognition</div> : null}
      </section>
      <section className="project-rooms-card">
        <div className="project-room-heading"><div><h2>2 · Select a room</h2><p>{result ? `${result.rooms.length} detected outline${result.rooms.length === 1 ? "" : "s"}` : "Upload a drawing to find rooms."}</p></div>{result && <label>Scale <input type="number" min="0.1" step="0.1" value={millimetresPerPixel} onChange={(event) => setMillimetresPerPixel(Number(event.target.value))} /> <small>mm / pixel</small></label>}</div>
        {result && <p className="project-warning">{result.warning}</p>}
        <div className="project-room-list">{result?.rooms.map((room: DetectedProjectRoom) => <button key={room.id} type="button" className={selectedRoom?.id === room.id ? "selected" : ""} onClick={() => setSelectedRoomId(room.id)}><svg viewBox="0 0 200 160" aria-hidden="true"><polygon points={previewPoints(room.vertices)} /></svg><span><strong>{room.name}</strong><small>{Math.round(room.area_px2).toLocaleString()} px² · {room.vertices.length} corners</small></span></button>)}</div>
        <button className="project-primary" type="button" disabled={!selectedRoom || !Number.isFinite(millimetresPerPixel) || millimetresPerPixel <= 0} onClick={openSelectedRoom}>Open selected room in floorplan editor</button>
      </section>
    </div>
  </section>;
}
