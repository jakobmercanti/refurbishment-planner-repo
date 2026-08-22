"use client";

import {
  type PointerEvent as ReactPointerEvent,
  useMemo,
  useRef,
  useState,
} from "react";
import type {
  Point2D,
  Room,
  RoomValidationResponse,
} from "@/lib/types";

const CANVAS_WIDTH = 820;
const CANVAS_HEIGHT = 560;
const PADDING_MM = 400;
const SNAP_MM = 50;

const TEMPLATES: Record<"RECTANGLE" | "L_SHAPE", Point2D[]> = {
  RECTANGLE: [
    { x: 0, y: 0 },
    { x: 2400, y: 0 },
    { x: 2400, y: 1800 },
    { x: 0, y: 1800 },
  ],
  L_SHAPE: [
    { x: 0, y: 0 },
    { x: 3200, y: 0 },
    { x: 3200, y: 1800 },
    { x: 2200, y: 1800 },
    { x: 2200, y: 2800 },
    { x: 0, y: 2800 },
  ],
};

interface FloorPlanEditorProps {
  room: Room;
  apiUrl: string;
  onApply: (room: Room) => void;
  onCancel: () => void;
}

function cloneVertices(vertices: Point2D[]): Point2D[] {
  return vertices.map((vertex) => ({ ...vertex }));
}

function coordinateText(vertices: Point2D[]): string {
  return vertices.map((vertex) => `${vertex.x}, ${vertex.y}`).join("\n");
}

function parseCoordinateText(value: string): Point2D[] {
  const points = value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line, index) => {
      const parts = line.split(/[\s,;]+/).filter(Boolean);
      if (parts.length !== 2) {
        throw new Error(`Line ${index + 1} must contain exactly X and Y.`);
      }
      const x = Number(parts[0]);
      const y = Number(parts[1]);
      if (!Number.isFinite(x) || !Number.isFinite(y)) {
        throw new Error(`Line ${index + 1} contains a non-numeric coordinate.`);
      }
      return { x, y };
    });
  if (points.length < 3) throw new Error("Enter at least three vertices.");
  return points;
}

function snap(value: number, enabled: boolean): number {
  return enabled ? Math.round(value / SNAP_MM) * SNAP_MM : Math.round(value * 10) / 10;
}

export function FloorPlanEditor({ room, apiUrl, onApply, onCancel }: FloorPlanEditorProps) {
  const [vertices, setVertices] = useState<Point2D[]>(() => cloneVertices(room.vertices));
  const [history, setHistory] = useState<Point2D[][]>([]);
  const [selectedVertex, setSelectedVertex] = useState<number | null>(0);
  const [selectedWall, setSelectedWall] = useState<number | null>(null);
  const [mode, setMode] = useState<"SELECT" | "DRAW">("SELECT");
  const [snapEnabled, setSnapEnabled] = useState(true);
  const [wallHeight, setWallHeight] = useState(room.wall_height.value);
  const [wallThickness, setWallThickness] = useState(room.wall_thickness.value);
  const [coordinateInput, setCoordinateInput] = useState(() => coordinateText(room.vertices));
  const [coordinateError, setCoordinateError] = useState<string | null>(null);
  const [validation, setValidation] = useState<RoomValidationResponse | null>(null);
  const [validationError, setValidationError] = useState<string | null>(null);
  const [acknowledged, setAcknowledged] = useState(false);
  const [clearDependents, setClearDependents] = useState(false);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [wallLengthInput, setWallLengthInput] = useState("");
  const dragStart = useRef<Point2D[] | null>(null);
  const draggingVertex = useRef<number | null>(null);

  const bounds = useMemo(() => {
    const safeVertices = vertices.length ? vertices : [{ x: 0, y: 0 }];
    const minX = Math.min(...safeVertices.map((vertex) => vertex.x)) - PADDING_MM;
    const maxX = Math.max(...safeVertices.map((vertex) => vertex.x)) + PADDING_MM;
    const minY = Math.min(...safeVertices.map((vertex) => vertex.y)) - PADDING_MM;
    const maxY = Math.max(...safeVertices.map((vertex) => vertex.y)) + PADDING_MM;
    const width = Math.max(maxX - minX, 1000);
    const height = Math.max(maxY - minY, 1000);
    const scale = Math.min(CANVAS_WIDTH / width, CANVAS_HEIGHT / height);
    const drawnWidth = width * scale;
    const drawnHeight = height * scale;
    return {
      minX,
      maxY,
      scale,
      offsetX: (CANVAS_WIDTH - drawnWidth) / 2,
      offsetY: (CANVAS_HEIGHT - drawnHeight) / 2,
    };
  }, [vertices]);

  const toScreen = (point: Point2D) => ({
    x: bounds.offsetX + (point.x - bounds.minX) * bounds.scale,
    y: bounds.offsetY + (bounds.maxY - point.y) * bounds.scale,
  });

  const fromPointer = (event: ReactPointerEvent<SVGSVGElement>): Point2D => {
    const rectangle = event.currentTarget.getBoundingClientRect();
    const screenX = (event.clientX - rectangle.left) * CANVAS_WIDTH / rectangle.width;
    const screenY = (event.clientY - rectangle.top) * CANVAS_HEIGHT / rectangle.height;
    return {
      x: snap(bounds.minX + (screenX - bounds.offsetX) / bounds.scale, snapEnabled),
      y: snap(bounds.maxY - (screenY - bounds.offsetY) / bounds.scale, snapEnabled),
    };
  };

  const markChanged = () => {
    setDirty(true);
    setValidation(null);
    setValidationError(null);
    setAcknowledged(false);
  };

  const commitVertices = (next: Point2D[]) => {
    setHistory((current) => [...current.slice(-29), cloneVertices(vertices)]);
    setVertices(next);
    setCoordinateInput(coordinateText(next));
    markChanged();
  };

  const updateVertex = (index: number, next: Point2D, recordHistory = true) => {
    const updated = vertices.map((vertex, vertexIndex) => vertexIndex === index ? next : vertex);
    if (recordHistory) commitVertices(updated);
    else {
      setVertices(updated);
      setCoordinateInput(coordinateText(updated));
      markChanged();
    }
  };

  const undo = () => {
    const previous = history.at(-1);
    if (!previous) return;
    setVertices(cloneVertices(previous));
    setCoordinateInput(coordinateText(previous));
    setHistory((current) => current.slice(0, -1));
    setSelectedVertex(null);
    setSelectedWall(null);
    markChanged();
  };

  const applyTemplate = (template: keyof typeof TEMPLATES) => {
    commitVertices(cloneVertices(TEMPLATES[template]));
    setSelectedVertex(0);
    setSelectedWall(null);
    setMode("SELECT");
  };

  const newOutline = () => {
    setHistory((current) => [...current.slice(-29), cloneVertices(vertices)]);
    setVertices([]);
    setCoordinateInput("");
    setSelectedVertex(null);
    setSelectedWall(null);
    setMode("DRAW");
    setClearDependents(true);
    markChanged();
  };

  const addAfterSelected = () => {
    if (vertices.length < 2) return;
    const index = selectedVertex ?? vertices.length - 1;
    const nextIndex = (index + 1) % vertices.length;
    const midpoint = {
      x: snap((vertices[index].x + vertices[nextIndex].x) / 2, snapEnabled),
      y: snap((vertices[index].y + vertices[nextIndex].y) / 2, snapEnabled),
    };
    const updated = [...vertices];
    updated.splice(nextIndex, 0, midpoint);
    commitVertices(updated);
    setSelectedVertex(nextIndex);
  };

  const deleteSelected = () => {
    if (selectedVertex === null || vertices.length <= 3) return;
    commitVertices(vertices.filter((_, index) => index !== selectedVertex));
    setSelectedVertex(null);
  };

  const applyCoordinateInput = () => {
    try {
      const parsed = parseCoordinateText(coordinateInput);
      commitVertices(parsed);
      setCoordinateError(null);
      setMode("SELECT");
    } catch (error) {
      setCoordinateError(error instanceof Error ? error.message : "Coordinates could not be parsed.");
    }
  };

  const setSelectedWallLength = () => {
    if (selectedWall === null) return;
    const requested = Number(wallLengthInput);
    if (!Number.isFinite(requested) || requested <= 0) {
      setValidationError("Wall length must be a positive finite millimetre value.");
      return;
    }
    const start = vertices[selectedWall];
    const endIndex = (selectedWall + 1) % vertices.length;
    const end = vertices[endIndex];
    const length = Math.hypot(end.x - start.x, end.y - start.y);
    if (length === 0) return;
    const nextEnd = {
      x: snap(start.x + (end.x - start.x) / length * requested, snapEnabled),
      y: snap(start.y + (end.y - start.y) / length * requested, snapEnabled),
    };
    updateVertex(endIndex, nextEnd);
    setWallLengthInput("");
  };

  const makeDraft = (): Room => ({
    ...room,
    version: room.version + (dirty ? 1 : 0),
    vertices,
    wall_height: {
      ...room.wall_height,
      value: wallHeight,
      verified: wallHeight === room.wall_height.value && room.wall_height.verified,
      source_type: "USER_MEASURED",
    },
    wall_thickness: {
      ...room.wall_thickness,
      value: wallThickness,
      verified: wallThickness === room.wall_thickness.value && room.wall_thickness.verified,
      source_type: "USER_MEASURED",
    },
    openings: clearDependents ? [] : room.openings,
    obstacles: clearDependents ? [] : room.obstacles,
  });

  const validate = async () => {
    setValidationError(null);
    setValidation(null);
    if (vertices.length < 3) {
      setValidationError("The internal boundary requires at least three vertices.");
      return;
    }
    try {
      const response = await fetch(`${apiUrl}/rooms/validate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(makeDraft()),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.detail ?? `Validation returned ${response.status}`);
      setValidation(payload as RoomValidationResponse);
    } catch (error) {
      setValidationError(error instanceof Error ? error.message : "Room validation failed.");
    }
  };

  const save = async () => {
    if (!validation || (validation.invalidations.length > 0 && !acknowledged)) return;
    setSaving(true);
    setValidationError(null);
    try {
      const draft = makeDraft();
      const response = await fetch(`${apiUrl}/rooms/${draft.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(draft),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.detail ?? `Save returned ${response.status}`);
      onApply(payload as Room);
    } catch (error) {
      setValidationError(error instanceof Error ? error.message : "Room could not be saved.");
    } finally {
      setSaving(false);
    }
  };

  const polygonPoints = vertices.map((vertex) => {
    const point = toScreen(vertex);
    return `${point.x},${point.y}`;
  }).join(" ");

  const gridLines = Array.from({ length: 17 }, (_, index) => index * CANVAS_WIDTH / 16);

  return (
    <section className="editor-page">
      <div className="editor-intro">
        <div><span className="eyebrow">Finished internal boundary · millimetres</span><h1>Draw the bathroom floor plan</h1></div>
        <p>The polygon is the finished inside face of the walls. Wall thickness is generated outward and never reduces the entered room.</p>
      </div>

      <div className="editor-layout">
        <aside className="editor-tools">
          <section className="tool-section">
            <div className="tool-heading"><span>1</span><h2>Start or edit</h2></div>
            <div className="button-grid">
              <button onClick={() => applyTemplate("RECTANGLE")}>Rectangle</button>
              <button onClick={() => applyTemplate("L_SHAPE")}>L-shape</button>
              <button onClick={newOutline}>New outline</button>
              <button onClick={undo} disabled={!history.length}>Undo</button>
            </div>
            <div className="mode-switch" role="group" aria-label="Editor mode">
              <button className={mode === "SELECT" ? "active" : ""} onClick={() => setMode("SELECT")}>Select & move</button>
              <button className={mode === "DRAW" ? "active" : ""} onClick={() => setMode("DRAW")}>Add corners</button>
            </div>
            <label className="check-row"><input type="checkbox" checked={snapEnabled} onChange={(event) => setSnapEnabled(event.target.checked)} /><span>Snap to {SNAP_MM} mm grid</span></label>
          </section>

          <section className="tool-section">
            <div className="tool-heading"><span>2</span><h2>Room properties</h2></div>
            <label className="field"><span>Wall height <small>mm</small></span><input type="number" min="1" max="100000" value={wallHeight} onChange={(event) => { setWallHeight(Number(event.target.value)); markChanged(); }} /></label>
            <label className="field"><span>Wall thickness <small>mm</small></span><input type="number" min="1" max="2000" value={wallThickness} onChange={(event) => { setWallThickness(Number(event.target.value)); markChanged(); }} /></label>
          </section>

          {selectedVertex !== null && vertices[selectedVertex] && (
            <section className="tool-section selected-properties">
              <div className="tool-heading"><span>V{selectedVertex + 1}</span><h2>Selected corner</h2></div>
              <div className="coordinate-fields">
                <label className="field"><span>X <small>mm</small></span><input type="number" value={vertices[selectedVertex].x} onChange={(event) => updateVertex(selectedVertex, { ...vertices[selectedVertex], x: Number(event.target.value) })} /></label>
                <label className="field"><span>Y <small>mm</small></span><input type="number" value={vertices[selectedVertex].y} onChange={(event) => updateVertex(selectedVertex, { ...vertices[selectedVertex], y: Number(event.target.value) })} /></label>
              </div>
              <div className="button-grid"><button onClick={addAfterSelected}>Add corner after</button><button className="danger-button" onClick={deleteSelected} disabled={vertices.length <= 3}>Delete corner</button></div>
            </section>
          )}

          {selectedWall !== null && vertices.length >= 2 && (
            <section className="tool-section selected-properties">
              <div className="tool-heading"><span>W{selectedWall + 1}</span><h2>Selected wall</h2></div>
              <p className="tool-note">Changing length keeps the wall direction and moves its endpoint. The adjoining wall changes explicitly.</p>
              <label className="field"><span>New length <small>mm</small></span><input type="number" min="1" value={wallLengthInput} placeholder={Math.hypot(vertices[(selectedWall + 1) % vertices.length].x - vertices[selectedWall].x, vertices[(selectedWall + 1) % vertices.length].y - vertices[selectedWall].y).toFixed(1)} onChange={(event) => setWallLengthInput(event.target.value)} /></label>
              <button className="primary-small" onClick={setSelectedWallLength}>Apply wall length</button>
            </section>
          )}
        </aside>

        <div className="drawing-column">
          <div className="drawing-toolbar">
            <span>{mode === "DRAW" ? "Click the grid to add corners in counter-clockwise order." : "Drag a numbered corner or click a wall to inspect it."}</span>
            <strong>{vertices.length} vertices</strong>
          </div>
          <svg
            className={`floor-canvas mode-${mode.toLowerCase()}`}
            viewBox={`0 0 ${CANVAS_WIDTH} ${CANVAS_HEIGHT}`}
            role="img"
            aria-label="Interactive bathroom floor-plan polygon"
            onPointerDown={(event) => {
              if (mode !== "DRAW" || event.target !== event.currentTarget) return;
              const point = fromPointer(event);
              commitVertices([...vertices, point]);
              setSelectedVertex(vertices.length);
            }}
            onPointerMove={(event) => {
              const index = draggingVertex.current;
              if (index === null) return;
              updateVertex(index, fromPointer(event), false);
            }}
            onPointerUp={() => {
              if (draggingVertex.current !== null && dragStart.current) {
                setHistory((current) => [...current.slice(-29), dragStart.current as Point2D[]]);
              }
              draggingVertex.current = null;
              dragStart.current = null;
            }}
          >
            <rect width={CANVAS_WIDTH} height={CANVAS_HEIGHT} className="canvas-background" />
            <g className="plan-grid" aria-hidden>
              {gridLines.map((position) => <line key={`vertical-${position}`} x1={position} y1={0} x2={position} y2={CANVAS_HEIGHT} />)}
              {gridLines.map((position) => <line key={`horizontal-${position}`} x1={0} y1={position * CANVAS_HEIGHT / CANVAS_WIDTH} x2={CANVAS_WIDTH} y2={position * CANVAS_HEIGHT / CANVAS_WIDTH} />)}
            </g>
            {vertices.length >= 3 && <polygon points={polygonPoints} className="room-polygon" />}
            {vertices.map((vertex, index) => {
              const start = toScreen(vertex);
              const end = toScreen(vertices[(index + 1) % vertices.length] ?? vertex);
              const length = Math.hypot((vertices[(index + 1) % vertices.length]?.x ?? vertex.x) - vertex.x, (vertices[(index + 1) % vertices.length]?.y ?? vertex.y) - vertex.y);
              return (
                <g key={`wall-${index}`}>
                  {vertices.length > 1 && (
                    <>
                      <line className={selectedWall === index ? "wall-line selected" : "wall-line"} x1={start.x} y1={start.y} x2={end.x} y2={end.y} onPointerDown={(event) => { event.stopPropagation(); setSelectedWall(index); setSelectedVertex(null); setMode("SELECT"); }} />
                      <text className="wall-label" x={(start.x + end.x) / 2} y={(start.y + end.y) / 2 - 8}>{length.toFixed(0)} mm</text>
                    </>
                  )}
                  <circle
                    className={selectedVertex === index ? "vertex-handle selected" : "vertex-handle"}
                    cx={start.x}
                    cy={start.y}
                    r={selectedVertex === index ? 12 : 10}
                    onPointerDown={(event) => {
                      event.stopPropagation();
                      setSelectedVertex(index);
                      setSelectedWall(null);
                      setMode("SELECT");
                      dragStart.current = cloneVertices(vertices);
                      draggingVertex.current = index;
                      event.currentTarget.setPointerCapture(event.pointerId);
                    }}
                  />
                  <text className="vertex-label" x={start.x} y={start.y + 3}>{index + 1}</text>
                </g>
              );
            })}
          </svg>
          <div className="drawing-scale"><span>Coordinates and dimensions are authoritative millimetres</span><span>Grid display auto-fits the current polygon</span></div>
        </div>

        <aside className="coordinate-panel">
          <section className="tool-section">
            <div className="tool-heading"><span>3</span><h2>Enter coordinates</h2></div>
            <p className="tool-note">One X,Y pair per line, ordered counter-clockwise. This is the fastest route from a measured sketch.</p>
            <textarea value={coordinateInput} onChange={(event) => setCoordinateInput(event.target.value)} spellCheck={false} aria-label="Room polygon coordinates in millimetres" />
            {coordinateError && <p className="inline-error">{coordinateError}</p>}
            <button className="primary-small" onClick={applyCoordinateInput}>Replace polygon</button>
          </section>

          <section className="tool-section validation-section">
            <div className="tool-heading"><span>4</span><h2>Validate & save</h2></div>
            <label className="check-row"><input type="checkbox" checked={clearDependents} onChange={(event) => { setClearDependents(event.target.checked); markChanged(); }} /><span>Start as a clean room: remove current doors, windows and obstacles</span></label>
            <button className="validate-button" onClick={validate}>Validate geometry</button>
            {validationError && <div className="validation-fail"><strong>INVALID</strong><p>{validationError}</p></div>}
            {validation && (
              <div className="validation-pass">
                <div><strong>VALID · CCW</strong><span>{(validation.area_mm2 / 1_000_000).toFixed(2)} m² · {(validation.perimeter_mm / 1000).toFixed(2)} m perimeter</span></div>
                <ul>{validation.warnings.map((warning) => <li key={warning}>{warning}</li>)}</ul>
                {validation.invalidations.length > 0 && (
                  <div className="invalidation-list">
                    <strong>{validation.invalidations.length} dependent item{validation.invalidations.length === 1 ? "" : "s"} require review</strong>
                    {validation.invalidations.map((item) => <p key={`${item.entity_type}-${item.entity_id}`}><code>{item.entity_id}</code> {item.reason}</p>)}
                    <label className="check-row"><input type="checkbox" checked={acknowledged} onChange={(event) => setAcknowledged(event.target.checked)} /><span>I understand these engineering items must be reverified.</span></label>
                  </div>
                )}
              </div>
            )}
            <div className="save-actions"><button onClick={onCancel}>Cancel</button><button className="save-button" onClick={save} disabled={!validation || saving || (validation.invalidations.length > 0 && !acknowledged)}>{saving ? "Saving…" : "Save room revision"}</button></div>
          </section>
        </aside>
      </div>
    </section>
  );
}
