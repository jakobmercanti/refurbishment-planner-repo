"use client";

import {
  type PointerEvent as ReactPointerEvent,
  useMemo,
  useRef,
  useState,
  useEffect,
} from "react";
import { DisplayNumberInput } from "@/components/DisplayNumberInput";
import {
  createFloorPlanViewport,
  floorPlanFromClient,
  floorPlanToScreen,
  scaleFloorPlanViewport,
  FLOOR_PLAN_CANVAS_HEIGHT,
  FLOOR_PLAN_CANVAS_WIDTH,
  FLOOR_PLAN_PADDING,
  FloorPlanCanvas,
} from "@/components/FloorPlanCanvas";
import { formatArea, formatLength, formatMeasurementText, fromDisplayNumber, toDisplayNumber, UNIT_LABEL, type DisplayUnits } from "@/lib/units";
import type {
  Opening,
  Point2D,
  Room,
  RoomValidationResponse,
} from "@/lib/types";

const CANVAS_WIDTH = FLOOR_PLAN_CANVAS_WIDTH;
const CANVAS_HEIGHT = FLOOR_PLAN_CANVAS_HEIGHT;
const PADDING_MM = FLOOR_PLAN_PADDING;
const SNAP_MM = 50;
const MIN_ENCLOSED_AREA_MM2 = 10_000;

const RECTANGLE_TEMPLATE: Point2D[] = [
  { x: 0, y: 0 },
  { x: 2400, y: 0 },
  { x: 2400, y: 1800 },
  { x: 0, y: 1800 },
];

const L_SHAPE_TEMPLATES: Array<{ id: string; name: string; preview: string; vertices: Point2D[] }> = [
  { id: "NOTCH_TOP_RIGHT", name: "Notch top right", preview: "polygon(0 0, 69% 0, 69% 36%, 100% 36%, 100% 100%, 0 100%)", vertices: [
    { x: 0, y: 0 }, { x: 3200, y: 0 }, { x: 3200, y: 1800 }, { x: 2200, y: 1800 }, { x: 2200, y: 2800 }, { x: 0, y: 2800 },
  ] },
  { id: "NOTCH_BOTTOM_RIGHT", name: "Notch bottom right", preview: "polygon(0 0, 100% 0, 100% 64%, 69% 64%, 69% 100%, 0 100%)", vertices: [
    { x: 0, y: 0 }, { x: 2200, y: 0 }, { x: 2200, y: 1000 }, { x: 3200, y: 1000 }, { x: 3200, y: 2800 }, { x: 0, y: 2800 },
  ] },
  { id: "NOTCH_TOP_LEFT", name: "Notch top left", preview: "polygon(31% 0, 100% 0, 100% 100%, 0 100%, 0 36%, 31% 36%)", vertices: [
    { x: 0, y: 0 }, { x: 3200, y: 0 }, { x: 3200, y: 2800 }, { x: 1000, y: 2800 }, { x: 1000, y: 1800 }, { x: 0, y: 1800 },
  ] },
  { id: "NOTCH_BOTTOM_LEFT", name: "Notch bottom left", preview: "polygon(0 0, 100% 0, 100% 100%, 31% 100%, 31% 64%, 0 64%)", vertices: [
    { x: 1000, y: 0 }, { x: 3200, y: 0 }, { x: 3200, y: 2800 }, { x: 0, y: 2800 }, { x: 0, y: 1000 }, { x: 1000, y: 1000 },
  ] },
];

type EditorSnapshot = { vertices: Point2D[]; openings: Opening[] };

interface FloorPlanEditorProps {
  room: Room;
  apiUrl: string;
  displayUnits: DisplayUnits;
  onApply: (room: Room) => void;
  onCancel: () => void;
  /** Lets the complete-floorplan shell share this exact editor and keep its draft live. */
  onDraftChange?: (room: Room) => void;
  onSaveOverride?: (room: Room) => void;
  heading?: string;
  eyebrow?: string;
}

function cloneVertices(vertices: Point2D[]): Point2D[] {
  return vertices.map((vertex) => ({ ...vertex }));
}

function cloneOpenings(openings: Opening[]): Opening[] {
  return openings.map((opening) => ({ ...opening, width: { ...opening.width }, height: { ...opening.height } }));
}

function hasMinimumEnclosedArea(vertices: Point2D[]): boolean {
  if (vertices.length < 3) return true;
  const twiceArea = vertices.reduce((total, point, index) => {
    const next = vertices[(index + 1) % vertices.length];
    return total + point.x * next.y - next.x * point.y;
  }, 0);
  return Math.abs(twiceArea) / 2 >= MIN_ENCLOSED_AREA_MM2;
}

function snap(value: number, enabled: boolean, increment = SNAP_MM): number {
  return enabled ? Math.round(value / increment) * increment : Math.round(value * 10) / 10;
}

function squareVertices(vertices: Point2D[]): Point2D[] {
  if (vertices.length < 2) return cloneVertices(vertices);
  const firstHorizontal = Math.abs(vertices[1].x - vertices[0].x) >= Math.abs(vertices[1].y - vertices[0].y);
  const alternating = vertices.length % 2 === 0;
  const squared = [{ ...vertices[0] }];
  for (let index = 1; index < vertices.length; index += 1) {
    const previous = squared[index - 1];
    const source = vertices[index];
    const horizontal = alternating ? (index % 2 === 1 ? firstHorizontal : !firstHorizontal) : Math.abs(source.x - previous.x) >= Math.abs(source.y - previous.y);
    squared.push(horizontal ? { x: source.x, y: previous.y } : { x: previous.x, y: source.y });
  }
  // A closed orthogonal polygon has an even number of corners. Align the last
  // point to the first so its closing wall is orthogonal too.
  if (alternating) {
    const last = squared.length - 1;
    squared[last] = firstHorizontal ? { ...squared[last], x: squared[0].x } : { ...squared[last], y: squared[0].y };
  }
  return squared;
}

function moveSquaredVertex(vertices: Point2D[], index: number, next: Point2D): Point2D[] {
  if (vertices.length < 3) return vertices.map((point, pointIndex) => pointIndex === index ? { ...next } : { ...point });
  const squared = cloneVertices(vertices);
  squared[index] = { ...next };
  // Preserve each existing wall's orientation. Horizontal walls share Y and
  // vertical walls share X, so a dragged coordinate propagates only through
  // the connected walls that require that same coordinate.
  (["x", "y"] as const).forEach((axis) => {
    const usesVerticalWall = axis === "x";
    const queue = [index]; const visited = new Set<number>(queue);
    while (queue.length) {
      const current = queue.shift()!;
      const candidates = [
        { point: (current - 1 + vertices.length) % vertices.length, segment: (current - 1 + vertices.length) % vertices.length },
        { point: (current + 1) % vertices.length, segment: current },
      ];
      for (const candidate of candidates) {
        const start = vertices[candidate.segment]; const end = vertices[(candidate.segment + 1) % vertices.length];
        const horizontal = Math.abs(end.x - start.x) >= Math.abs(end.y - start.y);
        if ((usesVerticalWall && horizontal) || (!usesVerticalWall && !horizontal) || visited.has(candidate.point)) continue;
        squared[candidate.point][axis] = next[axis]; visited.add(candidate.point); queue.push(candidate.point);
      }
    }
  });
  return squared;
}

function swingArcPath(centre: Point2D, start: Point2D, end: Point2D): string {
  const startVector = { x: start.x - centre.x, y: start.y - centre.y };
  const endVector = { x: end.x - centre.x, y: end.y - centre.y };
  const radius = Math.hypot(startVector.x, startVector.y);
  const cross = startVector.x * endVector.y - startVector.y * endVector.x;
  return `M ${start.x} ${start.y} A ${radius} ${radius} 0 0 ${cross >= 0 ? 1 : 0} ${end.x} ${end.y}`;
}

function swingSectorPath(centre: Point2D, start: Point2D, end: Point2D): string {
  const startVector = { x: start.x - centre.x, y: start.y - centre.y };
  const endVector = { x: end.x - centre.x, y: end.y - centre.y };
  const radius = Math.hypot(startVector.x, startVector.y);
  const cross = startVector.x * endVector.y - startVector.y * endVector.x;
  return `M ${centre.x} ${centre.y} L ${start.x} ${start.y} A ${radius} ${radius} 0 0 ${cross >= 0 ? 1 : 0} ${end.x} ${end.y} Z`;
}

function projectToSegment(point: Point2D, start: Point2D, end: Point2D): { distance: number; along: number } {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const lengthSquared = dx * dx + dy * dy;
  if (lengthSquared === 0) return { distance: Math.hypot(point.x - start.x, point.y - start.y), along: 0 };
  const rawAlong = ((point.x - start.x) * dx + (point.y - start.y) * dy) / lengthSquared;
  const along = Math.max(0, Math.min(1, rawAlong));
  return {
    distance: Math.hypot(point.x - (start.x + dx * along), point.y - (start.y + dy * along)),
    along,
  };
}

export function FloorPlanEditor({ room, apiUrl, displayUnits, onApply, onCancel, onDraftChange, onSaveOverride, heading = "Draw the bathroom floor plan", eyebrow = "Finished internal boundary" }: FloorPlanEditorProps) {
  const [vertices, setVertices] = useState<Point2D[]>(() => cloneVertices(room.vertices));
  const [history, setHistory] = useState<EditorSnapshot[]>([]);
  const [future, setFuture] = useState<EditorSnapshot[]>([]);
  const [selectedVertex, setSelectedVertex] = useState<number | null>(0);
  const [selectedWall, setSelectedWall] = useState<number | null>(null);
  const [lShapePickerOpen, setLShapePickerOpen] = useState(false);
  const [mode, setMode] = useState<"SELECT" | "DRAW">("SELECT");
  const [snapEnabled, setSnapEnabled] = useState(true);
  const [snapSize, setSnapSize] = useState(SNAP_MM);
  const [squaredWalls, setSquaredWalls] = useState(false);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState<Point2D>({ x: 0, y: 0 });
  const [wallHeight, setWallHeight] = useState(room.wall_height.value);
  const [wallThickness, setWallThickness] = useState(room.wall_thickness.value);
  const [openings, setOpenings] = useState<Opening[]>(() => room.openings.map((opening) => ({ ...opening })));
  const [openingKind, setOpeningKind] = useState<"DOOR" | "WINDOW">("DOOR");
  const [doorType, setDoorType] = useState<"SINGLE" | "DOUBLE">("SINGLE");
  const [openingWallId, setOpeningWallId] = useState("wall-001");
  const [openingOffset, setOpeningOffset] = useState(200);
  const [openingWidth, setOpeningWidth] = useState(800);
  const [openingHeight, setOpeningHeight] = useState(2040);
  const [windowSill, setWindowSill] = useState(900);
  const [hingeSide, setHingeSide] = useState<"START" | "END">("START");
  const [opensInward, setOpensInward] = useState(true);
  const [openingError, setOpeningError] = useState<string | null>(null);
  const [editingOpeningId, setEditingOpeningId] = useState<string | null>(null);
  const [validation, setValidation] = useState<RoomValidationResponse | null>(null);
  const [validationError, setValidationError] = useState<string | null>(null);
  const [acknowledged, setAcknowledged] = useState(false);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [wallLengthInput, setWallLengthInput] = useState("");
  const dragStart = useRef<Point2D[] | null>(null);
  const draggingVertex = useRef<number | null>(null);
  const draggingWall = useRef<number | null>(null);
  const draggingOpening = useRef<string | null>(null);
  const openingDragStart = useRef<Opening[] | null>(null);
  const dragPointerStart = useRef<Point2D | null>(null);
  const panDrag = useRef<{ clientX: number; clientY: number; pan: Point2D } | null>(null);

  useEffect(() => {
    const leaveCornerMode = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || mode !== "DRAW") return;
      setMode("SELECT");
      setSelectedWall(null);
    };
    window.addEventListener("keydown", leaveCornerMode);
    return () => window.removeEventListener("keydown", leaveCornerMode);
  }, [mode]);

  const bounds = useMemo(() => {
    const safeVertices = vertices.length ? vertices : [{ x: 0, y: 0 }];
    const visiblePoints = cloneVertices(safeVertices);

    openings.forEach((opening) => {
      if (opening.kind !== "DOOR" || opening.opens_inward !== false || vertices.length < 2) return;
      const wallIndex = Number(opening.parent_wall_id.split("-")[1]) - 1;
      const wallStart = vertices[wallIndex];
      const wallEnd = vertices[(wallIndex + 1) % vertices.length];
      if (!wallStart || !wallEnd) return;

      const dx = wallEnd.x - wallStart.x;
      const dy = wallEnd.y - wallStart.y;
      const wallLength = Math.hypot(dx, dy);
      if (wallLength === 0) return;

      const unitX = dx / wallLength;
      const unitY = dy / wallLength;
      const outwardNormal = { x: unitY, y: -unitX };
      const openingStart = {
        x: wallStart.x + unitX * opening.offset_mm,
        y: wallStart.y + unitY * opening.offset_mm,
      };
      const openingEnd = {
        x: openingStart.x + unitX * opening.width.value,
        y: openingStart.y + unitY * opening.width.value,
      };

      if (opening.door_type === "DOUBLE") {
        const leafLength = opening.width.value / 2;
        visiblePoints.push(
          { x: openingStart.x + outwardNormal.x * leafLength, y: openingStart.y + outwardNormal.y * leafLength },
          { x: openingEnd.x + outwardNormal.x * leafLength, y: openingEnd.y + outwardNormal.y * leafLength },
        );
        return;
      }

      const hinge = opening.hinge_side === "END" ? openingEnd : openingStart;
      visiblePoints.push({
        x: hinge.x + outwardNormal.x * opening.width.value,
        y: hinge.y + outwardNormal.y * opening.width.value,
      });
    });

    return createFloorPlanViewport(visiblePoints, PADDING_MM);
  }, [vertices, openings]);

  const [dragBounds, setDragBounds] = useState<typeof bounds | null>(null);
  const zoomedBounds = scaleFloorPlanViewport(dragBounds ?? bounds, zoom);
  const activeBounds = { ...zoomedBounds, offsetX: zoomedBounds.offsetX + pan.x, offsetY: zoomedBounds.offsetY + pan.y };

  const toScreen = (point: Point2D) => floorPlanToScreen(point, activeBounds);

  const fromClientPoint = (clientX: number, clientY: number, svg: SVGSVGElement, applySnap = true): Point2D => {
    const point = floorPlanFromClient(clientX, clientY, svg, activeBounds);
    return {
      x: snap(point.x, applySnap && snapEnabled, snapSize),
      y: snap(point.y, applySnap && snapEnabled, snapSize),
    };
  };

  const fromPointer = (event: ReactPointerEvent<SVGSVGElement>): Point2D =>
    fromClientPoint(event.clientX, event.clientY, event.currentTarget);

  const beginPan = (event: ReactPointerEvent<SVGSVGElement>) => {
    if (event.button !== 1) return;
    event.preventDefault();
    event.stopPropagation();
    panDrag.current = { clientX: event.clientX, clientY: event.clientY, pan: { ...pan } };
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const movePan = (event: ReactPointerEvent<SVGSVGElement>) => {
    const start = panDrag.current;
    if (!start) return false;
    const rect = event.currentTarget.getBoundingClientRect();
    setPan({
      x: start.pan.x + (event.clientX - start.clientX) * FLOOR_PLAN_CANVAS_WIDTH / rect.width,
      y: start.pan.y + (event.clientY - start.clientY) * FLOOR_PLAN_CANVAS_HEIGHT / rect.height,
    });
    return true;
  };

  const markChanged = () => {
    setDirty(true);
    setValidation(null);
    setValidationError(null);
    setAcknowledged(false);
  };

  const snapshot = (): EditorSnapshot => ({ vertices: cloneVertices(vertices), openings: cloneOpenings(openings) });
  const restoreSnapshot = (value: EditorSnapshot) => {
    setVertices(cloneVertices(value.vertices));
    setOpenings(cloneOpenings(value.openings));
  };

  const commitVertices = (next: Point2D[], alreadySquared = false) => {
    setHistory((current) => [...current.slice(-29), snapshot()]);
    setFuture([]);
    setVertices(squaredWalls && !alreadySquared ? squareVertices(next) : next);
    markChanged();
  };

  const updateVertex = (index: number, next: Point2D, recordHistory = true) => {
    const updated = squaredWalls ? moveSquaredVertex(vertices, index, next) : vertices.map((vertex, vertexIndex) => vertexIndex === index ? next : vertex);
    if (!hasMinimumEnclosedArea(updated)) return;
    if (recordHistory) commitVertices(updated, squaredWalls);
    else {
      setVertices(updated);
      markChanged();
    }
  };

  const undo = () => {
    const previous = history.at(-1);
    if (!previous) return;
    setFuture((current) => [snapshot(), ...current].slice(0, 30));
    restoreSnapshot(previous);
    setHistory((current) => current.slice(0, -1));
    setSelectedVertex(null);
    setSelectedWall(null);
    markChanged();
  };

  const redo = () => {
    const next = future[0];
    if (!next) return;
    setHistory((current) => [...current.slice(-29), snapshot()]);
    setFuture((current) => current.slice(1));
    restoreSnapshot(next);
    setSelectedVertex(null);
    setSelectedWall(null);
    markChanged();
  };

  const finishDragging = () => {
    if (panDrag.current) { panDrag.current = null; return; }
    if (draggingOpening.current !== null) {
      const openingStart = openingDragStart.current;
      if (openingStart) {
        setHistory((current) => [...current.slice(-29), { vertices: cloneVertices(vertices), openings: cloneOpenings(openingStart) }]);
        setFuture([]);
      }
      draggingOpening.current = null;
      openingDragStart.current = null;
      setDragBounds(null);
      return;
    }
    const startVertices = dragStart.current;
    if ((draggingVertex.current !== null || draggingWall.current !== null) && startVertices) {
      setHistory((current) => [...current.slice(-29), { vertices: cloneVertices(startVertices), openings: cloneOpenings(openings) }]);
      setFuture([]);
    }
    draggingVertex.current = null;
    draggingWall.current = null;
    dragStart.current = null;
    dragPointerStart.current = null;
    setDragBounds(null);
  };

  const cancelDragging = () => {
    if (panDrag.current) { panDrag.current = null; return; }
    if (draggingOpening.current !== null) {
      if (openingDragStart.current) setOpenings(openingDragStart.current.map((opening) => ({ ...opening })));
      draggingOpening.current = null;
      openingDragStart.current = null;
      setDragBounds(null);
      return;
    }
    const startVertices = dragStart.current;
    if (startVertices) {
      setVertices(cloneVertices(startVertices));
    }
    draggingVertex.current = null;
    draggingWall.current = null;
    dragStart.current = null;
    dragPointerStart.current = null;
    setDragBounds(null);
  };

  const applyTemplate = (template: Point2D[]) => {
    commitVertices(cloneVertices(template));
    // A template is a fresh room boundary. Openings belong to the previous
    // outline and must never be carried onto unrelated walls.
    setOpenings([]);
    setEditingOpeningId(null);
    setSelectedVertex(0);
    setSelectedWall(null);
    setMode("SELECT");
    setLShapePickerOpen(false);
  };

  const newOutline = () => {
    setLShapePickerOpen(false);
    setHistory((current) => [...current.slice(-29), snapshot()]);
    setFuture([]);
    setVertices([]);
    setOpenings([]);
    setEditingOpeningId(null);
    setSelectedVertex(null);
    setSelectedWall(null);
    setMode("DRAW");
    markChanged();
  };

  const insertCornerOnWall = (wallIndex: number, requested: Point2D) => {
    if (vertices.length < 2) return;
    const start = vertices[wallIndex];
    const endIndex = (wallIndex + 1) % vertices.length;
    const end = vertices[endIndex];
    if (!start || !end) return;
    const { along } = projectToSegment(requested, start, end);
    // Do not create an almost-duplicate vertex at either existing endpoint.
    if (along <= 0.015 || along >= 0.985) return;
    const inserted = {
      x: start.x + (end.x - start.x) * along,
      y: start.y + (end.y - start.y) * along,
    };
    const updated = [...vertices];
    updated.splice(endIndex, 0, inserted);
    commitVertices(updated);
    setSelectedVertex(endIndex);
    // Keep the newly-created second segment active so several clicks can add
    // successive corners along the selected wall without reselecting it.
    setSelectedWall(endIndex);
  };

  const addAfterSelected = () => {
    if (vertices.length < 2) return;
    const index = selectedVertex ?? vertices.length - 1;
    const nextIndex = (index + 1) % vertices.length;
    const midpoint = {
      x: snap((vertices[index].x + vertices[nextIndex].x) / 2, snapEnabled, snapSize),
      y: snap((vertices[index].y + vertices[nextIndex].y) / 2, snapEnabled, snapSize),
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

  const setSelectedWallLength = () => {
    if (selectedWall === null) return;
    const requested = fromDisplayNumber(Number(wallLengthInput), displayUnits);
    if (!Number.isFinite(requested) || requested <= 0) {
      setValidationError(`Wall length must be a positive finite ${UNIT_LABEL[displayUnits]} value.`);
      return;
    }
    const start = vertices[selectedWall];
    const endIndex = (selectedWall + 1) % vertices.length;
    const end = vertices[endIndex];
    const length = Math.hypot(end.x - start.x, end.y - start.y);
    if (length === 0) return;
    const nextEnd = {
      x: snap(start.x + (end.x - start.x) / length * requested, snapEnabled, snapSize),
      y: snap(start.y + (end.y - start.y) / length * requested, snapEnabled, snapSize),
    };
    updateVertex(endIndex, nextEnd);
    setWallLengthInput("");
  };

  const saveOpening = () => {
    setOpeningError(null);
    const wallIndex = Number(openingWallId.split("-")[1]) - 1;
    const start = vertices[wallIndex];
    const end = vertices[(wallIndex + 1) % vertices.length];
    if (!start || !end) {
      setOpeningError("Choose a wall from the current room outline.");
      return;
    }
    const wallLength = Math.hypot(end.x - start.x, end.y - start.y);
    if (![openingOffset, openingWidth, openingHeight].every(Number.isFinite) || openingOffset < 0 || openingWidth <= 0 || openingHeight <= 0) {
      setOpeningError(`Offset, width, and height must be valid positive ${UNIT_LABEL[displayUnits]} values.`);
      return;
    }
    if (openingOffset + openingWidth > wallLength) {
      setOpeningError(`The opening ends at ${formatLength(openingOffset + openingWidth, displayUnits)}, beyond this ${formatLength(wallLength, displayUnits)} wall.`);
      return;
    }
    const overlapsExisting = openings.some((opening) => (
      opening.id !== editingOpeningId
      && opening.parent_wall_id === openingWallId
      && openingOffset < opening.offset_mm + opening.width.value
      && openingOffset + openingWidth > opening.offset_mm
    ));
    if (overlapsExisting) {
      setOpeningError("This opening overlaps another door or window on the selected wall.");
      return;
    }
    if (openingKind === "WINDOW" && (!Number.isFinite(windowSill) || windowSill < 0)) {
      setOpeningError("Window sill height must be zero or greater.");
      return;
    }
    const measurement = (value: number) => ({
      value,
      uncertainty_mm: 5,
      verified: false,
      source_type: "USER_MEASURED",
    });
    const opening: Opening = {
      id: editingOpeningId ?? `${openingKind === "DOOR" ? "door" : "window"}-${crypto.randomUUID().slice(0, 8)}`,
      kind: openingKind,
      parent_wall_id: openingWallId,
      offset_mm: openingOffset,
      width: measurement(openingWidth),
      height: measurement(openingHeight),
      sill_height_mm: openingKind === "WINDOW" ? windowSill : 0,
      reveal_depth_mm: wallThickness,
      ...(openingKind === "DOOR" ? {
        hinge_side: hingeSide,
        door_type: doorType,
        swing_angle_deg: 90,
        opens_inward: opensInward,
      } : {}),
    };
    setHistory((current) => [...current.slice(-29), snapshot()]);
    setFuture([]);
    setOpenings((current) => editingOpeningId
      ? current.map((item) => item.id === editingOpeningId ? opening : item)
      : [...current, opening]);
    setEditingOpeningId(null);
    markChanged();
  };

  const editOpening = (opening: Opening, selectParentWall = true) => {
    setEditingOpeningId(opening.id);
    setOpeningKind(opening.kind === "WINDOW" ? "WINDOW" : "DOOR");
    setDoorType(opening.door_type === "DOUBLE" ? "DOUBLE" : "SINGLE");
    setOpeningWallId(opening.parent_wall_id);
    setOpeningOffset(opening.offset_mm);
    setOpeningWidth(opening.width.value);
    setOpeningHeight(opening.height.value);
    setWindowSill(opening.sill_height_mm);
    setHingeSide(opening.hinge_side === "END" ? "END" : "START");
    setOpensInward(opening.opens_inward !== false);
    setOpeningError(null);
    const wallIndex = Number(opening.parent_wall_id.split("-")[1]) - 1;
    setSelectedWall(selectParentWall ? wallIndex : null);
    setSelectedVertex(null);
  };

  const startOpeningDrag = (event: ReactPointerEvent<SVGGElement>, opening: Opening) => {
    event.stopPropagation();
    editOpening(opening, false);
    setMode("SELECT");
    openingDragStart.current = openings.map((item) => ({ ...item }));
    draggingOpening.current = opening.id;
    draggingVertex.current = null;
    draggingWall.current = null;
    setDragBounds(bounds);
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const moveOpeningDrag = (event: ReactPointerEvent<SVGSVGElement>) => {
    const openingId = draggingOpening.current;
    if (!openingId) return false;
    const opening = openings.find((item) => item.id === openingId);
    if (!opening) return true;
    const pointer = fromClientPoint(event.clientX, event.clientY, event.currentTarget, false);
    const nearestWall = vertices.slice(0, -1).map((wallStart, index) => {
      const wallEnd = vertices[(index + 1) % vertices.length];
      return { index, projection: projectToSegment(pointer, wallStart, wallEnd) };
    }).concat(vertices.length > 1 ? [{
      index: vertices.length - 1,
      projection: projectToSegment(pointer, vertices[vertices.length - 1], vertices[0]),
    }] : []).sort((first, second) => first.projection.distance - second.projection.distance)[0];
    if (!nearestWall) return true;
    const wallIndex = nearestWall.index;
    const wallStart = vertices[wallIndex];
    const wallEnd = vertices[(wallIndex + 1) % vertices.length];
    if (!wallStart || !wallEnd) return true;
    const dx = wallEnd.x - wallStart.x;
    const dy = wallEnd.y - wallStart.y;
    const wallLength = Math.hypot(dx, dy);
    if (wallLength <= opening.width.value) return true;
    const unitX = dx / wallLength;
    const unitY = dy / wallLength;
    const requested = snap((pointer.x - wallStart.x) * unitX + (pointer.y - wallStart.y) * unitY - opening.width.value / 2, snapEnabled, snapSize);
    const maximum = wallLength - opening.width.value;
    const nextWallId = `wall-${String(wallIndex + 1).padStart(3, "0")}`;
    const blockers = openings.filter((item) => item.id !== opening.id && item.parent_wall_id === nextWallId);
    const candidates = [Math.max(0, Math.min(maximum, requested)), 0, maximum, ...blockers.flatMap((item) => [item.offset_mm + item.width.value, item.offset_mm - opening.width.value])]
      .filter((value) => value >= 0 && value <= maximum)
      .filter((value) => blockers.every((item) => value + opening.width.value <= item.offset_mm || value >= item.offset_mm + item.width.value));
    const nextOffset = (candidates.length ? candidates : [opening.offset_mm]).sort((first, second) => Math.abs(first - requested) - Math.abs(second - requested))[0];
    setOpenings((current) => current.map((item) => item.id === opening.id
      ? { ...item, parent_wall_id: nextWallId, offset_mm: nextOffset }
      : item));
    setOpeningWallId(nextWallId);
    setOpeningOffset(nextOffset);
    markChanged();
    return true;
  };

  const cancelOpeningEdit = () => {
    setEditingOpeningId(null);
    setOpeningError(null);
  };

  const removeOpening = (openingId: string) => {
    setHistory((current) => [...current.slice(-29), snapshot()]);
    setFuture([]);
    setOpenings((current) => current.filter((opening) => opening.id !== openingId));
    if (editingOpeningId === openingId) cancelOpeningEdit();
    markChanged();
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
    openings,
    obstacles: room.obstacles,
  });

  useEffect(() => {
    if (!onDraftChange) return;
    onDraftChange(makeDraft());
  // A full-plan editor owns this callback and deliberately receives the live draft.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vertices, openings, wallHeight, wallThickness]);

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
      setValidationError(formatMeasurementText(error instanceof Error ? error.message : "Room validation failed.", displayUnits));
    }
  };

  const save = async () => {
    if (!validation || (validation.invalidations.length > 0 && !acknowledged)) return;
    if (onSaveOverride) {
      const draft = makeDraft();
      onSaveOverride(draft);
      onApply(draft);
      return;
    }
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
      setValidationError(formatMeasurementText(error instanceof Error ? error.message : "Room could not be saved.", displayUnits));
    } finally {
      setSaving(false);
    }
  };

  const polygonPoints = vertices.map((vertex) => {
    const point = toScreen(vertex);
    return `${point.x},${point.y}`;
  }).join(" ");

  return (
    <section className="editor-page">
      <div className="editor-intro">
        <div><span className="eyebrow">{eyebrow} · {UNIT_LABEL[displayUnits]}</span><h1>{heading}</h1></div>
        <p>The polygon is the finished inside face of the walls. Wall thickness is generated outward and never reduces the entered room.</p>
      </div>

      <div className="editor-layout">
        <aside className="editor-tools">
          <section className="tool-section">
            <div className="tool-heading"><span>1</span><h2>Start or edit</h2></div>
            <div className="button-grid">
              <button onClick={() => applyTemplate(RECTANGLE_TEMPLATE)}>Rectangle</button>
              <button className={lShapePickerOpen ? "active" : ""} aria-expanded={lShapePickerOpen} aria-controls="l-shape-picker" onClick={() => setLShapePickerOpen((current) => !current)}>L-shape</button>
              <button onClick={newOutline}>New outline</button>
              <button className={mode === "SELECT" ? "active" : ""} onClick={() => setMode("SELECT")}>Select & move</button>
            </div>
            <div className="button-grid editor-history-row">
              <button onClick={undo} disabled={!history.length}>Undo</button>
              <button onClick={redo} disabled={!future.length}>Redo</button>
            </div>
            {lShapePickerOpen && <div className="l-shape-picker" id="l-shape-picker">
              <div><span>Choose the L orientation</span><button type="button" aria-label="Close L-shape chooser" onClick={() => setLShapePickerOpen(false)}>×</button></div>
              <p>Select the position of the internal notch. You can resize every wall afterwards.</p>
              <div className="l-shape-options">{L_SHAPE_TEMPLATES.map((template) => <button key={template.id} type="button" onClick={() => applyTemplate(template.vertices)}><span className="l-shape-thumbnail"><i style={{ clipPath: template.preview }} /></span><strong>{template.name}</strong></button>)}</div>
            </div>}
            <div className="mode-switch corner-mode-row" role="group" aria-label="Editor mode">
              <button className={mode === "DRAW" ? "active" : ""} onClick={() => { setMode("DRAW"); setSelectedVertex(null); setSelectedWall((current) => current ?? 0); }}>Add corners</button>
              <button className="danger-button" onClick={deleteSelected} disabled={selectedVertex === null || vertices.length <= 3}>Remove corner</button>
            </div>
            <div className="plan-constraint-controls">
              <label className="snap-control-row"><input type="checkbox" checked={snapEnabled} onChange={(event) => setSnapEnabled(event.target.checked)} /><span>Snap to grid – <small>{UNIT_LABEL[displayUnits]}</small></span><DisplayNumberInput className="snap-size-input" minMm={1} valueMm={snapSize} units={displayUnits} disabled={!snapEnabled} onMmChange={setSnapSize} /></label>
              <label className="check-row square-walls-control"><input type="checkbox" checked={squaredWalls} onChange={(event) => { const next = event.target.checked; setSquaredWalls(next); if (next) commitVertices(squareVertices(vertices)); }} /><span><strong>Square walls</strong><small>Keep every wall horizontal or vertical while editing.</small></span></label>
            </div>
          </section>

          <section className="tool-section">
            <div className="tool-heading"><span>2</span><h2>Room properties</h2></div>
            <div className="coordinate-fields room-measurements">
              <label className="field"><span>Wall height <small>{UNIT_LABEL[displayUnits]}</small></span><DisplayNumberInput minMm={1} maxMm={100000} valueMm={wallHeight} units={displayUnits} onMmChange={(value) => { setWallHeight(value); markChanged(); }} /></label>
              <label className="field"><span>Wall thickness <small>{UNIT_LABEL[displayUnits]}</small></span><DisplayNumberInput minMm={1} maxMm={2000} valueMm={wallThickness} units={displayUnits} onMmChange={(value) => { setWallThickness(value); markChanged(); }} /></label>
            </div>
          </section>

          <section className="tool-section opening-section">
            <div className="tool-heading"><span>{editingOpeningId ? "↻" : "+"}</span><h2>{editingOpeningId ? "Update opening" : "Add doors & windows"}</h2></div>
            {editingOpeningId && <p className="editing-notice">Editing <code>{editingOpeningId}</code>. Change any parameter and apply the update.</p>}
            <div className="mode-switch" role="group" aria-label="Opening type">
              <button className={openingKind === "DOOR" ? "active" : ""} onClick={() => { setOpeningKind("DOOR"); setOpeningHeight(2040); }}>Door</button>
              <button className={openingKind === "WINDOW" ? "active" : ""} onClick={() => { setOpeningKind("WINDOW"); setOpeningHeight(900); }}>Window</button>
            </div>
            <label className="field"><span>Parent wall</span>
              <select value={openingWallId} onChange={(event) => setOpeningWallId(event.target.value)}>
                {vertices.map((_, index) => <option key={`opening-wall-${index}`} value={`wall-${String(index + 1).padStart(3, "0")}`}>Wall {index + 1}</option>)}
              </select>
            </label>
            <div className="coordinate-fields">
              <label className="field"><span>Offset <small>{UNIT_LABEL[displayUnits]}</small></span><DisplayNumberInput minMm={0} valueMm={openingOffset} units={displayUnits} onMmChange={setOpeningOffset} /></label>
              <label className="field"><span>Width <small>{UNIT_LABEL[displayUnits]}</small></span><DisplayNumberInput minMm={1} valueMm={openingWidth} units={displayUnits} onMmChange={setOpeningWidth} /></label>
              <label className="field"><span>Height <small>{UNIT_LABEL[displayUnits]}</small></span><DisplayNumberInput minMm={1} valueMm={openingHeight} units={displayUnits} onMmChange={setOpeningHeight} /></label>
              {openingKind === "WINDOW" && <label className="field"><span>Sill height <small>{UNIT_LABEL[displayUnits]}</small></span><DisplayNumberInput minMm={0} valueMm={windowSill} units={displayUnits} onMmChange={setWindowSill} /></label>}
            </div>
            {openingKind === "DOOR" && (
              <>
                <label className="check-row double-door-choice"><input type="checkbox" checked={doorType === "DOUBLE"} onChange={(event) => { const isDouble = event.target.checked; setDoorType(isDouble ? "DOUBLE" : "SINGLE"); if (isDouble && openingWidth < 1200) setOpeningWidth(1600); }} /><span><strong>Double door</strong> — two leaves meeting at the centre</span></label>
                <div className="coordinate-fields">
                  <label className="field"><span>Hinge side</span><select value={hingeSide} onChange={(event) => setHingeSide(event.target.value as "START" | "END")} disabled={doorType === "DOUBLE"}><option value="START">Wall start</option><option value="END">Wall end</option></select></label>
                  <label className="field"><span>Opening direction</span><select value={opensInward ? "INWARD" : "OUTWARD"} onChange={(event) => setOpensInward(event.target.value === "INWARD")}><option value="INWARD">Into room</option><option value="OUTWARD">Out of room</option></select></label>
                </div>
              </>
            )}
            {openingError && <p className="inline-error">{openingError}</p>}
            <div className="opening-form-actions">
              {editingOpeningId && <button onClick={cancelOpeningEdit}>Cancel edit</button>}
              <button className="primary-small" onClick={saveOpening}>{editingOpeningId ? "Update" : "Add"} {openingKind === "DOOR" ? doorType === "DOUBLE" ? "double door" : "single door" : "window"}</button>
            </div>
            {openings.length > 0 && (
              <div className="opening-list">
                {openings.map((opening) => <div key={opening.id} className={editingOpeningId === opening.id ? "editing" : ""}><span className={`opening-chip ${opening.kind.toLowerCase()}`}>{opening.kind === "DOOR" ? opening.door_type === "DOUBLE" ? "DOUBLE DOOR" : "DOOR" : "WINDOW"}</span><p>{opening.parent_wall_id.replace("wall-", "W")} · {formatLength(opening.width.value, displayUnits)}</p><button className="edit-opening" onClick={() => editOpening(opening)}>Edit</button><button className="remove-opening" onClick={() => removeOpening(opening.id)} aria-label={`Remove ${opening.id}`}>×</button></div>)}
              </div>
            )}
          </section>

          {selectedVertex !== null && vertices[selectedVertex] && (
            <section className="tool-section selected-properties">
              <div className="tool-heading"><span>V{selectedVertex + 1}</span><h2>Selected corner</h2></div>
              <div className="coordinate-fields">
                <label className="field"><span>X <small>{UNIT_LABEL[displayUnits]}</small></span><DisplayNumberInput valueMm={vertices[selectedVertex].x} units={displayUnits} onMmChange={(value) => updateVertex(selectedVertex, { ...vertices[selectedVertex], x: value })} /></label>
                <label className="field"><span>Y <small>{UNIT_LABEL[displayUnits]}</small></span><DisplayNumberInput valueMm={vertices[selectedVertex].y} units={displayUnits} onMmChange={(value) => updateVertex(selectedVertex, { ...vertices[selectedVertex], y: value })} /></label>
              </div>
              <div className="button-grid"><button onClick={addAfterSelected}>Add corner after</button><button className="danger-button" onClick={deleteSelected} disabled={vertices.length <= 3}>Delete corner</button></div>
            </section>
          )}

          {selectedWall !== null && vertices.length >= 2 && (
            <section className="tool-section selected-properties">
              <div className="tool-heading"><span>W{selectedWall + 1}</span><h2>Selected wall</h2></div>
              <p className="tool-note">Drag the wall to move it parallel, or enter a new length to move its endpoint. Adjoining walls update automatically.</p>
              <label className="field"><span>New length <small>{UNIT_LABEL[displayUnits]}</small></span><input type="number" min="0" value={wallLengthInput} placeholder={toDisplayNumber(Math.hypot(vertices[(selectedWall + 1) % vertices.length].x - vertices[selectedWall].x, vertices[(selectedWall + 1) % vertices.length].y - vertices[selectedWall].y), displayUnits).toFixed(1)} onChange={(event) => setWallLengthInput(event.target.value)} /></label>
              <button className="primary-small" onClick={setSelectedWallLength}>Apply wall length</button>
            </section>
          )}
        </aside>

        <div className="drawing-column">
          <div className="resizable-floorplan-window">
          <div className="drawing-toolbar">
            <span>{mode === "DRAW" ? "Click the selected wall to insert corners precisely where you click." : "Drag a numbered corner or wall to reshape the room."}</span>
            <div className="drawing-zoom" role="group" aria-label="Drawing zoom"><button type="button" aria-label="Zoom out" onClick={() => setZoom((current) => Math.max(.5, current - .2))}>−</button><button type="button" aria-label="Reset zoom and pan" onClick={() => { setZoom(1); setPan({ x: 0, y: 0 }); }}>{Math.round(zoom * 100)}%</button><button type="button" aria-label="Zoom in" onClick={() => setZoom((current) => Math.min(3, current + .2))}>+</button></div>
            <strong>{vertices.length} vertices</strong>
          </div>
          <FloorPlanCanvas
            className={`mode-${mode.toLowerCase()}`}
            role="img"
            aria-label="Interactive bathroom floor-plan polygon"
            onPointerDownCapture={beginPan}
            onPointerDown={(event) => {
              if (event.target !== event.currentTarget) return;
              if (mode === "SELECT") {
                setSelectedVertex(null);
                setSelectedWall(null);
                setWallLengthInput("");
                cancelOpeningEdit();
                return;
              }
              const point = fromPointer(event);
              insertCornerOnWall(selectedWall ?? 0, point);
            }}
            onPointerMove={(event) => {
              if (movePan(event)) return;
              if (moveOpeningDrag(event)) return;
              const vertexIndex = draggingVertex.current;
              if (vertexIndex !== null) {
                updateVertex(vertexIndex, fromPointer(event), false);
                return;
              }

              const wallIndex = draggingWall.current;
              const startVertices = dragStart.current;
              const pointerStart = dragPointerStart.current;
              if (wallIndex === null || !startVertices || !pointerStart) return;

              const wallStart = startVertices[wallIndex];
              const wallEnd = startVertices[(wallIndex + 1) % startVertices.length];
              const dx = wallEnd.x - wallStart.x;
              const dy = wallEnd.y - wallStart.y;
              const length = Math.hypot(dx, dy);
              if (length === 0) return;

              const pointer = fromClientPoint(event.clientX, event.clientY, event.currentTarget, false);
              const normalX = -dy / length;
              const normalY = dx / length;
              const rawDistance = (pointer.x - pointerStart.x) * normalX + (pointer.y - pointerStart.y) * normalY;
              const distance = snap(rawDistance, snapEnabled, snapSize);
              const updated = cloneVertices(startVertices);
              updated[wallIndex] = {
                x: wallStart.x + normalX * distance,
                y: wallStart.y + normalY * distance,
              };
              const endIndex = (wallIndex + 1) % startVertices.length;
              updated[endIndex] = {
                x: wallEnd.x + normalX * distance,
                y: wallEnd.y + normalY * distance,
              };
              if (hasMinimumEnclosedArea(updated)) {
                setVertices(updated);
                markChanged();
              }
            }}
            onPointerUp={finishDragging}
            onPointerCancel={cancelDragging}
          >
            {vertices.length >= 3 && <polygon points={polygonPoints} className="room-polygon" />}
            {vertices.map((vertex, index) => {
              const start = toScreen(vertex);
              const end = toScreen(vertices[(index + 1) % vertices.length] ?? vertex);
              const length = Math.hypot((vertices[(index + 1) % vertices.length]?.x ?? vertex.x) - vertex.x, (vertices[(index + 1) % vertices.length]?.y ?? vertex.y) - vertex.y);
              const screenLength = Math.hypot(end.x - start.x, end.y - start.y) || 1;
              const screenTangent = { x: (end.x - start.x) / screenLength, y: (end.y - start.y) / screenLength };
              const outward = { x: -screenTangent.y, y: screenTangent.x };
              const wallId = `wall-${String(index + 1).padStart(3, "0")}`;
              const wallOpenings = openings.filter((opening) => opening.parent_wall_id === wallId && (opening.kind === "DOOR" || opening.kind === "WINDOW"));
              const outwardDoorDepth = openings
                .filter((opening) => opening.parent_wall_id === wallId && opening.kind === "DOOR" && opening.opens_inward === false)
                .reduce((maximum, opening) => Math.max(maximum, opening.door_type === "DOUBLE" ? opening.width.value / 2 : opening.width.value), 0);
              const openingDimensionGap = 24;
              // Keep the authoritative wall dimension outside the door-relative
              // dimensions, and move it farther out when an outward swing needs room.
              const requestedDimensionOffset = 78 + wallOpenings.length * openingDimensionGap + outwardDoorDepth * activeBounds.scale;
              const edgePadding = 18;
              const offsetLimit = [
                outward.x > 0 ? (CANVAS_WIDTH - edgePadding - start.x) / outward.x : outward.x < 0 ? (edgePadding - start.x) / outward.x : Number.POSITIVE_INFINITY,
                outward.y > 0 ? (CANVAS_HEIGHT - edgePadding - start.y) / outward.y : outward.y < 0 ? (edgePadding - start.y) / outward.y : Number.POSITIVE_INFINITY,
              ].filter((value) => value >= 0).reduce((minimum, value) => Math.min(minimum, value), Number.POSITIVE_INFINITY);
              const dimensionOffset = Math.max(12, Math.min(requestedDimensionOffset, offsetLimit));
              // Keep every dimension outside the wall. The authoritative wall
              // lane is deliberately farther out, with opening lanes tucked
              // between it and the wall at consistent spacing.
              const dimensionSide = 1;
              const dimensionStart = { x: start.x + outward.x * dimensionOffset, y: start.y + outward.y * dimensionOffset };
              const dimensionEnd = { x: end.x + outward.x * dimensionOffset, y: end.y + outward.y * dimensionOffset };
              const dimensionLabel = {
                x: (dimensionStart.x + dimensionEnd.x) / 2 + outward.x * 10,
                y: (dimensionStart.y + dimensionEnd.y) / 2 + outward.y * 10,
              };
              return (
                <g key={`wall-${index}`}>
                  {vertices.length > 1 && (
                    <>
                      <line className="wall-body" x1={start.x} y1={start.y} x2={end.x} y2={end.y} />
                      <line
                        className={selectedWall === index ? "wall-line selected" : "wall-line"}
                        x1={start.x}
                        y1={start.y}
                        x2={end.x}
                        y2={end.y}
                        onPointerDown={(event) => {
                          event.stopPropagation();
                          const svg = event.currentTarget.ownerSVGElement;
                          if (!svg) return;
                          if (mode === "DRAW") {
                            insertCornerOnWall(index, fromClientPoint(event.clientX, event.clientY, svg, false));
                            return;
                          }
                          setSelectedWall(index);
                          setSelectedVertex(null);
                          setOpeningWallId(`wall-${String(index + 1).padStart(3, "0")}`);
                          setMode("SELECT");
                          dragStart.current = cloneVertices(vertices);
                          setDragBounds(bounds);
                          dragPointerStart.current = fromClientPoint(event.clientX, event.clientY, svg, false);
                          draggingVertex.current = null;
                          draggingWall.current = index;
                          event.currentTarget.setPointerCapture(event.pointerId);
                        }}
                      />
                      <g className="wall-dimension" aria-hidden>
                        <line className="dimension-extension" x1={start.x + outward.x * 7} y1={start.y + outward.y * 7} x2={dimensionStart.x + outward.x * 4} y2={dimensionStart.y + outward.y * 4} />
                        <line className="dimension-extension" x1={end.x + outward.x * 7} y1={end.y + outward.y * 7} x2={dimensionEnd.x + outward.x * 4} y2={dimensionEnd.y + outward.y * 4} />
                        <line className="dimension-line" x1={dimensionStart.x} y1={dimensionStart.y} x2={dimensionEnd.x} y2={dimensionEnd.y} />
                        <line className="dimension-tick" x1={dimensionStart.x - screenTangent.x * 4 + outward.x * 4} y1={dimensionStart.y - screenTangent.y * 4 + outward.y * 4} x2={dimensionStart.x + screenTangent.x * 4 - outward.x * 4} y2={dimensionStart.y + screenTangent.y * 4 - outward.y * 4} />
                        <line className="dimension-tick" x1={dimensionEnd.x - screenTangent.x * 4 + outward.x * 4} y1={dimensionEnd.y - screenTangent.y * 4 + outward.y * 4} x2={dimensionEnd.x + screenTangent.x * 4 - outward.x * 4} y2={dimensionEnd.y + screenTangent.y * 4 - outward.y * 4} />
                        <text className="wall-label" x={dimensionLabel.x} y={dimensionLabel.y}>{formatLength(length, displayUnits)}</text>
                      </g>
                      {wallOpenings.map((opening, openingIndex) => {
                        const wallStart = vertex;
                        const wallEnd = vertices[(index + 1) % vertices.length] ?? vertex;
                        const modelUnit = { x: (wallEnd.x - wallStart.x) / length, y: (wallEnd.y - wallStart.y) / length };
                        const doorStartModel = { x: wallStart.x + modelUnit.x * opening.offset_mm, y: wallStart.y + modelUnit.y * opening.offset_mm };
                        const doorEndModel = { x: wallStart.x + modelUnit.x * (opening.offset_mm + opening.width.value), y: wallStart.y + modelUnit.y * (opening.offset_mm + opening.width.value) };
                        const firstOpeningLane = Math.max(18, dimensionOffset - 34 - Math.max(0, wallOpenings.length - 1) * openingDimensionGap);
                        const rowOffset = dimensionSide * (firstOpeningLane + openingIndex * openingDimensionGap);
                        const points = [start, toScreen(doorStartModel), toScreen(doorEndModel), end].map((point) => ({ x: point.x + outward.x * rowOffset, y: point.y + outward.y * rowOffset }));
                        const values = [opening.offset_mm, opening.width.value, Math.max(0, length - opening.offset_mm - opening.width.value)];
                        return <g key={`opening-dimensions-${opening.id}`} className={`opening-dimension ${opening.kind === "WINDOW" ? "window-dimension" : ""}`} aria-label={`${opening.kind === "WINDOW" ? "Window" : "Door"} dimensions: ${formatLength(opening.width.value, displayUnits)} wide, ${formatLength(opening.offset_mm, displayUnits)} from wall start, ${formatLength(values[2], displayUnits)} to wall end`}>
                          {values.map((value, segmentIndex) => {
                            const first = points[segmentIndex];
                            const second = points[segmentIndex + 1];
                            const label = { x: (first.x + second.x) / 2 + outward.x * 9, y: (first.y + second.y) / 2 + outward.y * 9 };
                            return <g key={`${opening.id}-segment-${segmentIndex}`}>
                              <line className="dimension-extension" x1={first.x - outward.x * 5} y1={first.y - outward.y * 5} x2={first.x + outward.x * 3} y2={first.y + outward.y * 3} />
                              <line className="dimension-extension" x1={second.x - outward.x * 5} y1={second.y - outward.y * 5} x2={second.x + outward.x * 3} y2={second.y + outward.y * 3} />
                              <line className="dimension-line" x1={first.x} y1={first.y} x2={second.x} y2={second.y} />
                              <line className="dimension-tick" x1={first.x - screenTangent.x * 3 - outward.x * 3} y1={first.y - screenTangent.y * 3 - outward.y * 3} x2={first.x + screenTangent.x * 3 + outward.x * 3} y2={first.y + screenTangent.y * 3 + outward.y * 3} />
                              <line className="dimension-tick" x1={second.x - screenTangent.x * 3 - outward.x * 3} y1={second.y - screenTangent.y * 3 - outward.y * 3} x2={second.x + screenTangent.x * 3 + outward.x * 3} y2={second.y + screenTangent.y * 3 + outward.y * 3} />
                              <text className="opening-dimension-label" x={label.x} y={label.y}>{formatLength(value, displayUnits)}</text>
                            </g>;
                          })}
                        </g>;
                      })}
                    </>
                  )}
                </g>
              );
            })}
            {openings.map((opening) => {
              const wallIndex = Number(opening.parent_wall_id.split("-")[1]) - 1;
              const wallStart = vertices[wallIndex];
              const wallEnd = vertices[(wallIndex + 1) % vertices.length];
              if (!wallStart || !wallEnd) return null;
              const dx = wallEnd.x - wallStart.x;
              const dy = wallEnd.y - wallStart.y;
              const wallLength = Math.hypot(dx, dy);
              if (wallLength === 0) return null;
              const unitX = dx / wallLength;
              const unitY = dy / wallLength;
              const openingStartModel = { x: wallStart.x + unitX * opening.offset_mm, y: wallStart.y + unitY * opening.offset_mm };
              const openingEndModel = { x: openingStartModel.x + unitX * opening.width.value, y: openingStartModel.y + unitY * opening.width.value };
              const openingStart = toScreen(openingStartModel);
              const openingEnd = toScreen(openingEndModel);
              const centre = { x: (openingStart.x + openingEnd.x) / 2, y: (openingStart.y + openingEnd.y) / 2 };
              const openingPixelLength = Math.hypot(openingEnd.x - openingStart.x, openingEnd.y - openingStart.y) || 1;
              const openingTangent = { x: (openingEnd.x - openingStart.x) / openingPixelLength, y: (openingEnd.y - openingStart.y) / openingPixelLength };
              const openingPerpendicular = { x: -openingTangent.y, y: openingTangent.x };
              const jambHalf = 7;
              const openingClass = editingOpeningId === opening.id ? " selected" : "";
              if (opening.kind === "WINDOW") {
                const frameOffset = 4;
                return (
                  <g key={opening.id} className={`opening-symbol window-symbol pickable-opening${openingClass}`} onPointerDown={(event) => startOpeningDrag(event, opening)}>
                    <title>{`Window ${formatLength(opening.width.value, displayUnits)} — drag along wall`}</title>
                    <line className="opening-hit" x1={openingStart.x} y1={openingStart.y} x2={openingEnd.x} y2={openingEnd.y} />
                    <line className="opening-gap" x1={openingStart.x} y1={openingStart.y} x2={openingEnd.x} y2={openingEnd.y} />
                    <line className="window-frame" x1={openingStart.x + openingPerpendicular.x * frameOffset} y1={openingStart.y + openingPerpendicular.y * frameOffset} x2={openingEnd.x + openingPerpendicular.x * frameOffset} y2={openingEnd.y + openingPerpendicular.y * frameOffset} />
                    <line className="window-frame" x1={openingStart.x - openingPerpendicular.x * frameOffset} y1={openingStart.y - openingPerpendicular.y * frameOffset} x2={openingEnd.x - openingPerpendicular.x * frameOffset} y2={openingEnd.y - openingPerpendicular.y * frameOffset} />
                    <line className="window-core" x1={openingStart.x} y1={openingStart.y} x2={openingEnd.x} y2={openingEnd.y} />
                    <line className="opening-jamb window-jamb" x1={openingStart.x - openingPerpendicular.x * jambHalf} y1={openingStart.y - openingPerpendicular.y * jambHalf} x2={openingStart.x + openingPerpendicular.x * jambHalf} y2={openingStart.y + openingPerpendicular.y * jambHalf} />
                    <line className="opening-jamb window-jamb" x1={openingEnd.x - openingPerpendicular.x * jambHalf} y1={openingEnd.y - openingPerpendicular.y * jambHalf} x2={openingEnd.x + openingPerpendicular.x * jambHalf} y2={openingEnd.y + openingPerpendicular.y * jambHalf} />
                  </g>
                );
              }
              const inwardSign = opening.opens_inward === false ? -1 : 1;
              const normal = { x: -unitY * inwardSign, y: unitX * inwardSign };
              if (opening.door_type === "DOUBLE") {
                const halfWidth = opening.width.value / 2;
                const firstLeafEnd = toScreen({ x: openingStartModel.x + normal.x * halfWidth, y: openingStartModel.y + normal.y * halfWidth });
                const secondLeafEnd = toScreen({ x: openingEndModel.x + normal.x * halfWidth, y: openingEndModel.y + normal.y * halfWidth });
                return (
                  <g key={opening.id} className={`opening-symbol double-door-symbol pickable-opening${openingClass}`} onPointerDown={(event) => startOpeningDrag(event, opening)}>
                    <title>{`Double door ${formatLength(opening.width.value, displayUnits)} — drag along wall`}</title>
                    <path className="opening-hit-area" d={`${swingSectorPath(openingStart, centre, firstLeafEnd)} ${swingSectorPath(openingEnd, centre, secondLeafEnd)}`} />
                    <line className="opening-hit" x1={openingStart.x} y1={openingStart.y} x2={openingEnd.x} y2={openingEnd.y} />
                    <line className="opening-hit" x1={openingStart.x} y1={openingStart.y} x2={firstLeafEnd.x} y2={firstLeafEnd.y} />
                    <line className="opening-hit" x1={openingEnd.x} y1={openingEnd.y} x2={secondLeafEnd.x} y2={secondLeafEnd.y} />
                    <path className="opening-swing-hit" d={swingArcPath(openingStart, centre, firstLeafEnd)} />
                    <path className="opening-swing-hit" d={swingArcPath(openingEnd, centre, secondLeafEnd)} />
                    <line className="opening-gap" x1={openingStart.x} y1={openingStart.y} x2={openingEnd.x} y2={openingEnd.y} />
                    <line className="door-closed-line" x1={openingStart.x} y1={openingStart.y} x2={openingEnd.x} y2={openingEnd.y} />
                    <line className="opening-jamb" x1={openingStart.x - openingPerpendicular.x * jambHalf} y1={openingStart.y - openingPerpendicular.y * jambHalf} x2={openingStart.x + openingPerpendicular.x * jambHalf} y2={openingStart.y + openingPerpendicular.y * jambHalf} />
                    <line className="opening-jamb" x1={openingEnd.x - openingPerpendicular.x * jambHalf} y1={openingEnd.y - openingPerpendicular.y * jambHalf} x2={openingEnd.x + openingPerpendicular.x * jambHalf} y2={openingEnd.y + openingPerpendicular.y * jambHalf} />
                    <line className="door-leaf" x1={openingStart.x} y1={openingStart.y} x2={firstLeafEnd.x} y2={firstLeafEnd.y} />
                    <line className="door-leaf" x1={openingEnd.x} y1={openingEnd.y} x2={secondLeafEnd.x} y2={secondLeafEnd.y} />
                    <path className="door-swing" d={swingArcPath(openingStart, centre, firstLeafEnd)} />
                    <path className="door-swing" d={swingArcPath(openingEnd, centre, secondLeafEnd)} />
                  </g>
                );
              }
              const hingeAtStart = opening.hinge_side !== "END";
              const hinge = hingeAtStart ? openingStartModel : openingEndModel;
              const leafEnd = toScreen({ x: hinge.x + normal.x * opening.width.value, y: hinge.y + normal.y * opening.width.value });
              const hingeScreen = hingeAtStart ? openingStart : openingEnd;
              const closedLeafEnd = hingeAtStart ? openingEnd : openingStart;
              return (
                <g key={opening.id} className={`opening-symbol door-symbol pickable-opening${openingClass}`} onPointerDown={(event) => startOpeningDrag(event, opening)}>
                  <title>{`Door ${formatLength(opening.width.value, displayUnits)} — drag along wall`}</title>
                  <path className="opening-hit-area" d={swingSectorPath(hingeScreen, closedLeafEnd, leafEnd)} />
                  <line className="opening-hit" x1={openingStart.x} y1={openingStart.y} x2={openingEnd.x} y2={openingEnd.y} />
                  <line className="opening-hit" x1={hingeScreen.x} y1={hingeScreen.y} x2={leafEnd.x} y2={leafEnd.y} />
                  <path className="opening-swing-hit" d={swingArcPath(hingeScreen, closedLeafEnd, leafEnd)} />
                  <line className="opening-gap" x1={openingStart.x} y1={openingStart.y} x2={openingEnd.x} y2={openingEnd.y} />
                  <line className="door-closed-line" x1={openingStart.x} y1={openingStart.y} x2={openingEnd.x} y2={openingEnd.y} />
                  <line className="opening-jamb" x1={openingStart.x - openingPerpendicular.x * jambHalf} y1={openingStart.y - openingPerpendicular.y * jambHalf} x2={openingStart.x + openingPerpendicular.x * jambHalf} y2={openingStart.y + openingPerpendicular.y * jambHalf} />
                  <line className="opening-jamb" x1={openingEnd.x - openingPerpendicular.x * jambHalf} y1={openingEnd.y - openingPerpendicular.y * jambHalf} x2={openingEnd.x + openingPerpendicular.x * jambHalf} y2={openingEnd.y + openingPerpendicular.y * jambHalf} />
                  <line className="door-leaf" x1={hingeScreen.x} y1={hingeScreen.y} x2={leafEnd.x} y2={leafEnd.y} />
                  <path className="door-swing" d={swingArcPath(hingeScreen, closedLeafEnd, leafEnd)} />
                </g>
              );
            })}
            <g className="vertex-layer">
              {vertices.map((vertex, index) => {
                const point = toScreen(vertex);
                return <g key={`vertex-${index}`}>
                  <circle
                    className={selectedVertex === index ? "vertex-handle selected" : "vertex-handle"}
                    cx={point.x}
                    cy={point.y}
                    r={selectedVertex === index ? 12 : 10}
                    onPointerDown={(event) => {
                      event.stopPropagation();
                      setSelectedVertex(index);
                      setSelectedWall(null);
                      setMode("SELECT");
                      dragStart.current = cloneVertices(vertices);
                      setDragBounds(bounds);
                      draggingVertex.current = index;
                      draggingWall.current = null;
                      event.currentTarget.setPointerCapture(event.pointerId);
                    }}
                  />
                  <text className="vertex-label" x={point.x} y={point.y + 3}>{index + 1}</text>
                </g>;
              })}
            </g>
          </FloorPlanCanvas>
          <div className="drawing-scale"><span>Coordinates and dimensions shown in {UNIT_LABEL[displayUnits]} · calculations remain millimetre-authoritative</span><span>Grid display auto-fits the current polygon</span></div>
          </div>
        </div>

        <aside className="coordinate-panel">
          <section className="tool-section">
            <div className="tool-heading"><span>3</span><h2>Enter coordinates</h2></div>
            <p className="tool-note">Each fixed corner label matches the numbered point on the drawing. Edit only the X and Y values.</p>
            <div className="coordinate-input-list" aria-label={`Room polygon coordinates in ${UNIT_LABEL[displayUnits]}`}>
              {vertices.map((vertex, index) => <div key={`coordinate-${index}`}><span className="coordinate-prefix">{index + 1} -</span><DisplayNumberInput aria-label={`Corner ${index + 1} X coordinate`} valueMm={vertex.x} units={displayUnits} onMmChange={(value) => updateVertex(index, { ...vertices[index], x: value })} /><span className="coordinate-comma">,</span><DisplayNumberInput aria-label={`Corner ${index + 1} Y coordinate`} valueMm={vertex.y} units={displayUnits} onMmChange={(value) => updateVertex(index, { ...vertices[index], y: value })} /></div>)}
            </div>
          </section>

          <section className="tool-section validation-section">
            <div className="tool-heading"><span>4</span><h2>Validate & save</h2></div>
            <button className="validate-button" onClick={validate}>Validate geometry</button>
            {validationError && <div className="validation-fail"><strong>INVALID</strong><p>{validationError}</p></div>}
            {validation && (
              <div className="validation-pass">
                <div><strong>VALID · CCW</strong><span>{formatArea(validation.area_mm2, displayUnits)} · {formatLength(validation.perimeter_mm, displayUnits)} perimeter</span></div>
                <ul>{validation.warnings.map((warning) => <li key={warning}>{formatMeasurementText(warning, displayUnits)}</li>)}</ul>
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
