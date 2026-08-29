"use client";

import {
  type PointerEvent as ReactPointerEvent,
  useMemo,
  useRef,
  useState,
  useEffect,
} from "react";
import { DisplayNumberInput } from "@/components/DisplayNumberInput";
import { formatArea, formatLength, formatMeasurementText, fromDisplayNumber, toDisplayNumber, UNIT_LABEL, type DisplayUnits } from "@/lib/units";
import type {
  Opening,
  Point2D,
  Room,
  RoomValidationResponse,
} from "@/lib/types";

const CANVAS_WIDTH = 820;
const CANVAS_HEIGHT = 560;
const PADDING_MM = 400;
const SNAP_MM = 50;

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

interface FloorPlanEditorProps {
  room: Room;
  apiUrl: string;
  displayUnits: DisplayUnits;
  onApply: (room: Room) => void;
  onCancel: () => void;
}

function cloneVertices(vertices: Point2D[]): Point2D[] {
  return vertices.map((vertex) => ({ ...vertex }));
}

function coordinateText(vertices: Point2D[], units: DisplayUnits): string {
  return vertices.map((vertex) => `${toDisplayNumber(vertex.x, units).toFixed(units === "MM" ? 0 : 2)}, ${toDisplayNumber(vertex.y, units).toFixed(units === "MM" ? 0 : 2)}`).join("\n");
}

function parseCoordinateText(value: string, units: DisplayUnits): Point2D[] {
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
      return { x: fromDisplayNumber(x, units), y: fromDisplayNumber(y, units) };
    });
  if (points.length < 3) throw new Error("Enter at least three vertices.");
  return points;
}

function snap(value: number, enabled: boolean): number {
  return enabled ? Math.round(value / SNAP_MM) * SNAP_MM : Math.round(value * 10) / 10;
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

export function FloorPlanEditor({ room, apiUrl, displayUnits, onApply, onCancel }: FloorPlanEditorProps) {
  const [vertices, setVertices] = useState<Point2D[]>(() => cloneVertices(room.vertices));
  const [history, setHistory] = useState<Point2D[][]>([]);
  const [selectedVertex, setSelectedVertex] = useState<number | null>(0);
  const [selectedWall, setSelectedWall] = useState<number | null>(null);
  const [lShapePickerOpen, setLShapePickerOpen] = useState(false);
  const [mode, setMode] = useState<"SELECT" | "DRAW">("SELECT");
  const [snapEnabled, setSnapEnabled] = useState(true);
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
  const [coordinateInput, setCoordinateInput] = useState(() => coordinateText(room.vertices, displayUnits));
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
  const draggingWall = useRef<number | null>(null);
  const draggingOpening = useRef<string | null>(null);
  const openingDragStart = useRef<Opening[] | null>(null);
  const dragPointerStart = useRef<Point2D | null>(null);

  // Coordinate text is an editable draft; reformat it only when the display unit changes.
  /* eslint-disable react-hooks/set-state-in-effect, react-hooks/exhaustive-deps */
  useEffect(() => {
    setCoordinateInput(coordinateText(vertices, displayUnits));
  }, [displayUnits]);
  /* eslint-enable react-hooks/set-state-in-effect, react-hooks/exhaustive-deps */

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

    const minX = Math.min(...visiblePoints.map((point) => point.x)) - PADDING_MM;
    const maxX = Math.max(...visiblePoints.map((point) => point.x)) + PADDING_MM;
    const minY = Math.min(...visiblePoints.map((point) => point.y)) - PADDING_MM;
    const maxY = Math.max(...visiblePoints.map((point) => point.y)) + PADDING_MM;
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
  }, [vertices, openings]);

  const [dragBounds, setDragBounds] = useState<typeof bounds | null>(null);
  const activeBounds = dragBounds ?? bounds;

  const toScreen = (point: Point2D) => ({
    x: activeBounds.offsetX + (point.x - activeBounds.minX) * activeBounds.scale,
    y: activeBounds.offsetY + (activeBounds.maxY - point.y) * activeBounds.scale,
  });

  const fromClientPoint = (clientX: number, clientY: number, svg: SVGSVGElement, applySnap = true): Point2D => {
    const rectangle = svg.getBoundingClientRect();
    const screenX = (clientX - rectangle.left) * CANVAS_WIDTH / rectangle.width;
    const screenY = (clientY - rectangle.top) * CANVAS_HEIGHT / rectangle.height;
    return {
      x: snap(activeBounds.minX + (screenX - activeBounds.offsetX) / activeBounds.scale, applySnap && snapEnabled),
      y: snap(activeBounds.maxY - (screenY - activeBounds.offsetY) / activeBounds.scale, applySnap && snapEnabled),
    };
  };

  const fromPointer = (event: ReactPointerEvent<SVGSVGElement>): Point2D =>
    fromClientPoint(event.clientX, event.clientY, event.currentTarget);

  const markChanged = () => {
    setDirty(true);
    setValidation(null);
    setValidationError(null);
    setAcknowledged(false);
  };

  const commitVertices = (next: Point2D[]) => {
    setHistory((current) => [...current.slice(-29), cloneVertices(vertices)]);
    setVertices(next);
    setCoordinateInput(coordinateText(next, displayUnits));
    markChanged();
  };

  const updateVertex = (index: number, next: Point2D, recordHistory = true) => {
    const updated = vertices.map((vertex, vertexIndex) => vertexIndex === index ? next : vertex);
    if (recordHistory) commitVertices(updated);
    else {
      setVertices(updated);
      setCoordinateInput(coordinateText(updated, displayUnits));
      markChanged();
    }
  };

  const undo = () => {
    const previous = history.at(-1);
    if (!previous) return;
    setVertices(cloneVertices(previous));
    setCoordinateInput(coordinateText(previous, displayUnits));
    setHistory((current) => current.slice(0, -1));
    setSelectedVertex(null);
    setSelectedWall(null);
    markChanged();
  };

  const finishDragging = () => {
    if (draggingOpening.current !== null) {
      draggingOpening.current = null;
      openingDragStart.current = null;
      setDragBounds(null);
      return;
    }
    const startVertices = dragStart.current;
    if ((draggingVertex.current !== null || draggingWall.current !== null) && startVertices) {
      setHistory((current) => [...current.slice(-29), cloneVertices(startVertices)]);
    }
    draggingVertex.current = null;
    draggingWall.current = null;
    dragStart.current = null;
    dragPointerStart.current = null;
    setDragBounds(null);
  };

  const cancelDragging = () => {
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
      setCoordinateInput(coordinateText(startVertices, displayUnits));
    }
    draggingVertex.current = null;
    draggingWall.current = null;
    dragStart.current = null;
    dragPointerStart.current = null;
    setDragBounds(null);
  };

  const applyTemplate = (template: Point2D[]) => {
    commitVertices(cloneVertices(template));
    setSelectedVertex(0);
    setSelectedWall(null);
    setMode("SELECT");
    setLShapePickerOpen(false);
  };

  const newOutline = () => {
    setLShapePickerOpen(false);
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
      const parsed = parseCoordinateText(coordinateInput, displayUnits);
      commitVertices(parsed);
      setCoordinateError(null);
      setMode("SELECT");
    } catch (error) {
      setCoordinateError(error instanceof Error ? error.message : "Coordinates could not be parsed.");
    }
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
      x: snap(start.x + (end.x - start.x) / length * requested, snapEnabled),
      y: snap(start.y + (end.y - start.y) / length * requested, snapEnabled),
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
    setOpenings((current) => editingOpeningId
      ? current.map((item) => item.id === editingOpeningId ? opening : item)
      : [...current, opening]);
    setEditingOpeningId(null);
    setClearDependents(false);
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
    const requested = snap((pointer.x - wallStart.x) * unitX + (pointer.y - wallStart.y) * unitY - opening.width.value / 2, snapEnabled);
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
    openings: clearDependents ? [] : openings,
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
      setValidationError(formatMeasurementText(error instanceof Error ? error.message : "Room validation failed.", displayUnits));
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
      setValidationError(formatMeasurementText(error instanceof Error ? error.message : "Room could not be saved.", displayUnits));
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
        <div><span className="eyebrow">Finished internal boundary · {UNIT_LABEL[displayUnits]}</span><h1>Draw the bathroom floor plan</h1></div>
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
              <button onClick={undo} disabled={!history.length}>Undo</button>
            </div>
            {lShapePickerOpen && <div className="l-shape-picker" id="l-shape-picker">
              <div><span>Choose the L orientation</span><button type="button" aria-label="Close L-shape chooser" onClick={() => setLShapePickerOpen(false)}>×</button></div>
              <p>Select the position of the internal notch. You can resize every wall afterwards.</p>
              <div className="l-shape-options">{L_SHAPE_TEMPLATES.map((template) => <button key={template.id} type="button" onClick={() => applyTemplate(template.vertices)}><span className="l-shape-thumbnail"><i style={{ clipPath: template.preview }} /></span><strong>{template.name}</strong></button>)}</div>
            </div>}
            <div className="mode-switch" role="group" aria-label="Editor mode">
              <button className={mode === "SELECT" ? "active" : ""} onClick={() => setMode("SELECT")}>Select & move</button>
              <button className={mode === "DRAW" ? "active" : ""} onClick={() => setMode("DRAW")}>Add corners</button>
            </div>
            <label className="check-row"><input type="checkbox" checked={snapEnabled} onChange={(event) => setSnapEnabled(event.target.checked)} /><span>Snap to {formatLength(SNAP_MM, displayUnits)} grid</span></label>
          </section>

          <section className="tool-section">
            <div className="tool-heading"><span>2</span><h2>Room properties</h2></div>
            <label className="field"><span>Wall height <small>{UNIT_LABEL[displayUnits]}</small></span><DisplayNumberInput minMm={1} maxMm={100000} valueMm={wallHeight} units={displayUnits} onMmChange={(value) => { setWallHeight(value); markChanged(); }} /></label>
            <label className="field"><span>Wall thickness <small>{UNIT_LABEL[displayUnits]}</small></span><DisplayNumberInput minMm={1} maxMm={2000} valueMm={wallThickness} units={displayUnits} onMmChange={(value) => { setWallThickness(value); markChanged(); }} /></label>
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
          <div className="drawing-toolbar">
            <span>{mode === "DRAW" ? "Click the grid to add corners in counter-clockwise order." : "Drag a numbered corner or wall to reshape the room."}</span>
            <strong>{vertices.length} vertices</strong>
          </div>
          <svg
            className={`floor-canvas mode-${mode.toLowerCase()}`}
            viewBox={`0 0 ${CANVAS_WIDTH} ${CANVAS_HEIGHT}`}
            role="img"
            aria-label="Interactive bathroom floor-plan polygon"
            onPointerDown={(event) => {
              if (event.target !== event.currentTarget) return;
              if (mode === "SELECT") {
                setSelectedVertex(null);
                setSelectedWall(null);
                setWallLengthInput("");
                return;
              }
              const point = fromPointer(event);
              commitVertices([...vertices, point]);
              setSelectedVertex(vertices.length);
            }}
            onPointerMove={(event) => {
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
              const distance = snap(rawDistance, snapEnabled);
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
              setVertices(updated);
              setCoordinateInput(coordinateText(updated, displayUnits));
              markChanged();
            }}
            onPointerUp={finishDragging}
            onPointerCancel={cancelDragging}
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
          </svg>
          <div className="drawing-scale"><span>Coordinates and dimensions shown in {UNIT_LABEL[displayUnits]} · calculations remain millimetre-authoritative</span><span>Grid display auto-fits the current polygon</span></div>
        </div>

        <aside className="coordinate-panel">
          <section className="tool-section">
            <div className="tool-heading"><span>3</span><h2>Enter coordinates</h2></div>
            <p className="tool-note">One X,Y pair per line, ordered counter-clockwise. This is the fastest route from a measured sketch.</p>
            <textarea value={coordinateInput} onChange={(event) => setCoordinateInput(event.target.value)} spellCheck={false} aria-label={`Room polygon coordinates in ${UNIT_LABEL[displayUnits]}`} />
            {coordinateError && <p className="inline-error">{coordinateError}</p>}
            <button className="primary-small" onClick={applyCoordinateInput}>Replace polygon</button>
          </section>

          <section className="tool-section validation-section">
            <div className="tool-heading"><span>4</span><h2>Validate & save</h2></div>
            <label className="check-row"><input type="checkbox" checked={clearDependents} onChange={(event) => { const checked = event.target.checked; setClearDependents(checked); if (checked) { setOpenings([]); cancelOpeningEdit(); } markChanged(); }} /><span>Start as a clean room: remove current doors, windows and obstacles</span></label>
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
