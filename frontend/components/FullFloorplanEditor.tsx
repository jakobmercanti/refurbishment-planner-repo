"use client";

import { type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent, useEffect, useEffectEvent, useMemo, useRef, useState } from "react";
import { DisplayNumberInput } from "@/components/DisplayNumberInput";
import { createFloorPlanViewport, floorPlanFromClient, floorPlanToScreen, FLOOR_PLAN_CANVAS_HEIGHT, FLOOR_PLAN_CANVAS_WIDTH, FloorPlanCanvas, scaleFloorPlanViewport, type FloorPlanViewport } from "@/components/FloorPlanCanvas";
import { FloorPlanOpeningDimensions, FloorPlanOpeningSymbol, type FloorPlanOpeningGraphic } from "@/components/FloorPlanOpeningGraphics";
import { formatArea, formatLength, formatMeasurementText, UNIT_LABEL, type DisplayUnits } from "@/lib/units";
import type { Obstacle, Opening, Point2D, ProjectFloorplanResponse, Room, RoomValidationResponse } from "@/lib/types";

type Wall = { id: string; points: Point2D[] };
type NamedOutline = { id: string; name: string; vertices: Point2D[]; sourceWallId: string; sourceWallIds?: string[] };
type Tool = "SELECT" | "DRAW" | "ADD_CORNERS" | "REMOVE" | "MEASURE" | "ADD_MEASURE";
type SegmentSelection = { wallId: string; segmentIndex: number };
type PointSelection = { wallId: string; pointIndex: number };
type MeasurementReference = ({ kind: "WALL" } & SegmentSelection) | ({ kind: "POINT" } & PointSelection);
type MeasurementDirection = "NORMAL" | "HORIZONTAL" | "VERTICAL";
type CustomMeasurement = { id: string; first: MeasurementReference; second: MeasurementReference; offset: number; direction?: MeasurementDirection };
type GeometryContextMenu = ({ kind: "WALL" } & SegmentSelection | { kind: "POINT" } & PointSelection) & { x: number; y: number };
type MeasurementContextMenu = { id: string; custom: boolean; x: number; y: number };
type OpeningContextMenu = { id: string; x: number; y: number };
type FixtureContextMenu = { id: string; x: number; y: number };
type FullOpening = {
  id: string; kind: "DOOR" | "WINDOW"; wallId: string; segmentIndex: number;
  offset: number; width: number; height: number; sill: number;
  hingeSide: "START" | "END"; doorType: "SINGLE" | "DOUBLE"; opensInward: boolean;
};
type Snapshot = { walls: Wall[]; openings: FullOpening[]; measurements: CustomMeasurement[]; dimensionOffsets: Record<string, number>; hiddenDimensions: string[] };
type PersistedFloorplan = Snapshot & { canvasSize: { width: number; height: number }; rooms: NamedOutline[]; selectedRoomId: string | null; snapEnabled?: boolean; snapSize?: number; squaredWalls?: boolean; wallHeight?: number; wallThickness?: number };
interface Props { apiUrl: string; displayUnits: DisplayUnits; floorplanStyle: "DEFAULT" | "TRADITIONAL"; exportRequest: number; activeRoomName?: string; fixtures?: Obstacle[]; onFixturesChange?: (fixtures: Obstacle[]) => void; onOpenRoom: (name: string, vertices: Point2D[], openings: Opening[], wallHeight: number, wallThickness: number) => void; }

const DEFAULT_SIZE = { width: 1100, height: 700 };
const SNAP = 50;
const STORAGE_KEY = "renovation-fit:complete-floorplan:v2";
const RECTANGLE_TEMPLATE: Point2D[] = [{ x: 0, y: 0 }, { x: 2400, y: 0 }, { x: 2400, y: 1800 }, { x: 0, y: 1800 }];
const L_SHAPE_TEMPLATES: Array<{ id: string; name: string; preview: string; points: Point2D[] }> = [
  { id: "NOTCH_TOP_RIGHT", name: "Notch top right", preview: "polygon(0 0, 69% 0, 69% 36%, 100% 36%, 100% 100%, 0 100%)", points: [{ x: 0, y: 0 }, { x: 3200, y: 0 }, { x: 3200, y: 1800 }, { x: 2200, y: 1800 }, { x: 2200, y: 2800 }, { x: 0, y: 2800 }] },
  { id: "NOTCH_BOTTOM_RIGHT", name: "Notch bottom right", preview: "polygon(0 0, 100% 0, 100% 64%, 69% 64%, 69% 100%, 0 100%)", points: [{ x: 0, y: 0 }, { x: 2200, y: 0 }, { x: 2200, y: 1000 }, { x: 3200, y: 1000 }, { x: 3200, y: 2800 }, { x: 0, y: 2800 }] },
  { id: "NOTCH_TOP_LEFT", name: "Notch top left", preview: "polygon(31% 0, 100% 0, 100% 100%, 0 100%, 0 36%, 31% 36%)", points: [{ x: 0, y: 0 }, { x: 3200, y: 0 }, { x: 3200, y: 2800 }, { x: 1000, y: 2800 }, { x: 1000, y: 1800 }, { x: 0, y: 1800 }] },
  { id: "NOTCH_BOTTOM_LEFT", name: "Notch bottom left", preview: "polygon(0 0, 100% 0, 100% 100%, 31% 100%, 31% 64%, 0 64%)", points: [{ x: 1000, y: 0 }, { x: 3200, y: 0 }, { x: 3200, y: 2800 }, { x: 0, y: 2800 }, { x: 0, y: 1000 }, { x: 1000, y: 1000 }] },
];
const cloneWalls = (walls: Wall[]) => walls.map((wall) => ({ ...wall, points: wall.points.map((point) => ({ ...point })) }));
const cloneOpenings = (openings: FullOpening[]) => openings.map((opening) => ({ ...opening }));
const cloneMeasurements = (measurements: CustomMeasurement[]) => measurements.map((measurement) => ({ ...measurement, first: { ...measurement.first }, second: { ...measurement.second } }));
const samePoint = (a: Point2D, b: Point2D, tolerance = 1) => Math.hypot(a.x - b.x, a.y - b.y) <= tolerance;
const MIN_ENCLOSED_AREA_MM2 = 10_000;

function signedPolygonArea(points: Point2D[]): number {
  return points.reduce((area, point, index) => {
    const next = points[(index + 1) % points.length];
    return area + point.x * next.y - next.x * point.y;
  }, 0) / 2;
}

function counterClockwiseVertices(points: Point2D[]): Point2D[] {
  const vertices = points.map((point) => ({ ...point }));
  return signedPolygonArea(vertices) < 0 ? vertices.reverse() : vertices;
}

function hasMinimumEnclosedArea(points: Point2D[]): boolean {
  const closed = points.length >= 4 && samePoint(points[0], points.at(-1)!);
  if (!closed) return true;
  const outline = points.slice(0, -1);
  const twiceArea = outline.reduce((total, point, index) => {
    const next = outline[(index + 1) % outline.length];
    return total + point.x * next.y - next.x * point.y;
  }, 0);
  return Math.abs(twiceArea) / 2 >= MIN_ENCLOSED_AREA_MM2;
}

function hasOnlyOrthogonalSegments(points: Point2D[]): boolean {
  const tolerance = 0.001;
  return points.slice(0, -1).every((start, index) => {
    const end = points[index + 1];
    return Math.abs(end.x - start.x) <= tolerance || Math.abs(end.y - start.y) <= tolerance;
  });
}

const segmentLength = (wall: Wall, index: number) => Math.hypot(wall.points[index + 1].x - wall.points[index].x, wall.points[index + 1].y - wall.points[index].y);
const parentKey = (wallId: string, segmentIndex: number) => `${wallId}::${segmentIndex}`;

function pointOnSegment(point: Point2D, start: Point2D, end: Point2D): { point: Point2D; along: number } {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const lengthSquared = dx * dx + dy * dy;
  if (!lengthSquared) return { point: { ...start }, along: 0 };
  const along = Math.max(0, Math.min(1, ((point.x - start.x) * dx + (point.y - start.y) * dy) / lengthSquared));
  return { point: { x: start.x + dx * along, y: start.y + dy * along }, along };
}

function snapPoint(point: Point2D, walls: Wall[], enabled: boolean, increment: number): Point2D {
  const nearby = walls.flatMap((wall) => wall.points).find((candidate) => Math.hypot(candidate.x - point.x, candidate.y - point.y) <= 14);
  return nearby ?? (enabled ? { x: Math.round(point.x / increment) * increment, y: Math.round(point.y / increment) * increment } : point);
}

function squareWallPoints(points: Point2D[]): Point2D[] {
  if (points.length < 2) return points.map((point) => ({ ...point }));
  const closed = samePoint(points[0], points.at(-1)!);
  const core = closed ? points.slice(0, -1) : points;
  if (core.length < 2) return points.map((point) => ({ ...point }));
  const firstHorizontal = Math.abs(core[1].x - core[0].x) >= Math.abs(core[1].y - core[0].y);
  const alternating = closed && core.length % 2 === 0;
  const squared = [{ ...core[0] }];
  for (let index = 1; index < core.length; index += 1) {
    const source = core[index]; const previous = squared[index - 1];
    const horizontal = alternating ? (index % 2 === 1 ? firstHorizontal : !firstHorizontal) : Math.abs(source.x - previous.x) >= Math.abs(source.y - previous.y);
    squared.push(horizontal ? { x: source.x, y: previous.y } : { x: previous.x, y: source.y });
  }
  if (alternating) { const last = squared.length - 1; squared[last] = firstHorizontal ? { ...squared[last], x: squared[0].x } : { ...squared[last], y: squared[0].y }; }
  return closed ? [...squared, { ...squared[0] }] : squared;
}

function squareDrawPoint(from: Point2D, requested: Point2D): Point2D {
  return Math.abs(requested.x - from.x) >= Math.abs(requested.y - from.y)
    ? { x: requested.x, y: from.y }
    : { x: from.x, y: requested.y };
}

function orthogonalPathTo(points: Point2D[], target: Point2D): Point2D[] {
  const last = points.at(-1);
  if (!last || samePoint(last, target)) return points;
  if (last.x === target.x || last.y === target.y) return [...points, target];
  const horizontalFirst = Math.abs(target.x - last.x) >= Math.abs(target.y - last.y);
  const turn = horizontalFirst ? { x: target.x, y: last.y } : { x: last.x, y: target.y };
  return [...points, turn, target];
}

function moveSquaredWallPoint(points: Point2D[], index: number, next: Point2D): Point2D[] {
  const closed = points.length > 2 && samePoint(points[0], points.at(-1)!);
  const core = closed ? points.slice(0, -1) : points;
  if (!core[index]) return points.map((point) => ({ ...point }));
  const squared = core.map((point) => ({ ...point }));
  squared[index] = { ...next };
  (["x", "y"] as const).forEach((axis) => {
    const usesVerticalWall = axis === "x";
    const queue = [index]; const visited = new Set<number>(queue);
    while (queue.length) {
      const current = queue.shift()!;
      const candidates = [
        ...(current > 0 || closed ? [{ point: (current - 1 + core.length) % core.length, segment: (current - 1 + core.length) % core.length }] : []),
        ...(current < core.length - 1 || closed ? [{ point: (current + 1) % core.length, segment: current }] : []),
      ];
      for (const candidate of candidates) {
        const start = core[candidate.segment]; const end = core[(candidate.segment + 1) % core.length];
        const horizontal = Math.abs(end.x - start.x) >= Math.abs(end.y - start.y);
        if ((usesVerticalWall && horizontal) || (!usesVerticalWall && !horizontal) || visited.has(candidate.point)) continue;
        squared[candidate.point][axis] = next[axis]; visited.add(candidate.point); queue.push(candidate.point);
      }
    }
  });
  return closed ? [...squared, { ...squared[0] }] : squared;
}

function closedRooms(walls: Wall[], height: number): NamedOutline[] {
  type SourceSegment = { start: Point2D; end: Point2D; wallId: string };
  type GraphEdge = { first: string; second: string; wallIds: Set<string> };
  const tolerance = 0.5;
  const keyFor = (point: Point2D) => `${Math.round(point.x / tolerance)}:${Math.round(point.y / tolerance)}`;
  const segments: SourceSegment[] = walls.flatMap((wall) => wall.points.slice(0, -1).map((start, index) => ({ start, end: wall.points[index + 1], wallId: wall.id })).filter(({ start, end }) => !samePoint(start, end, tolerance)));
  const nodes = new Map<string, Point2D>();
  const addNode = (point: Point2D) => { const key = keyFor(point); if (!nodes.has(key)) nodes.set(key, { ...point }); return key; };
  segments.forEach(({ start, end }) => { addNode(start); addNode(end); });

  // Add crossings, then split every source segment at crossings and at wall-run endpoints.
  for (let firstIndex = 0; firstIndex < segments.length; firstIndex += 1) {
    const first = segments[firstIndex];
    for (let secondIndex = firstIndex + 1; secondIndex < segments.length; secondIndex += 1) {
      const second = segments[secondIndex];
      const firstVector = { x: first.end.x - first.start.x, y: first.end.y - first.start.y };
      const secondVector = { x: second.end.x - second.start.x, y: second.end.y - second.start.y };
      const denominator = firstVector.x * secondVector.y - firstVector.y * secondVector.x;
      if (Math.abs(denominator) <= 1e-9) continue;
      const delta = { x: second.start.x - first.start.x, y: second.start.y - first.start.y };
      const firstAlong = (delta.x * secondVector.y - delta.y * secondVector.x) / denominator;
      const secondAlong = (delta.x * firstVector.y - delta.y * firstVector.x) / denominator;
      if (firstAlong < -1e-6 || firstAlong > 1 + 1e-6 || secondAlong < -1e-6 || secondAlong > 1 + 1e-6) continue;
      addNode({ x: first.start.x + firstVector.x * firstAlong, y: first.start.y + firstVector.y * firstAlong });
    }
  }

  const edges = new Map<string, GraphEdge>();
  segments.forEach((segment) => {
    const splitPoints = [...nodes.entries()].map(([key, point]) => ({ key, point, projection: pointOnSegment(point, segment.start, segment.end) }))
      .filter(({ point, projection }) => samePoint(point, projection.point, tolerance))
      .sort((first, second) => first.projection.along - second.projection.along);
    for (let index = 0; index < splitPoints.length - 1; index += 1) {
      const first = splitPoints[index].key; const second = splitPoints[index + 1].key;
      if (first === second) continue;
      const edgeKey = [first, second].sort().join("|");
      const edge = edges.get(edgeKey) ?? { first, second, wallIds: new Set<string>() };
      edge.wallIds.add(segment.wallId); edges.set(edgeKey, edge);
    }
  });

  const neighbours = new Map<string, Set<string>>();
  edges.forEach(({ first, second }) => {
    if (!neighbours.has(first)) neighbours.set(first, new Set());
    if (!neighbours.has(second)) neighbours.set(second, new Set());
    neighbours.get(first)!.add(second); neighbours.get(second)!.add(first);
  });
  const visited = new Set<string>();
  const faces: { keys: string[]; area: number; wallIds: Set<string> }[] = [];
  const directedKey = (from: string, to: string) => `${from}>${to}`;

  // Follow each half-edge clockwise around the screen-coordinate graph. Positive-area
  // cycles are bounded room faces; the unbounded exterior is traversed in reverse.
  edges.forEach(({ first, second }) => {
    [[first, second], [second, first]].forEach(([initialFrom, initialTo]) => {
      if (visited.has(directedKey(initialFrom, initialTo))) return;
      const faceKeys: string[] = []; const faceWallIds = new Set<string>();
      let from = initialFrom; let to = initialTo; let complete = false;
      for (let step = 0; step <= edges.size * 2; step += 1) {
        const halfEdge = directedKey(from, to);
        if (visited.has(halfEdge)) { complete = from === initialFrom && to === initialTo; break; }
        visited.add(halfEdge); faceKeys.push(from);
        const edge = edges.get([from, to].sort().join("|")); edge?.wallIds.forEach((wallId) => faceWallIds.add(wallId));
        const centre = nodes.get(to)!;
        const ordered = [...(neighbours.get(to) ?? [])].sort((firstKey, secondKey) => {
          const firstPoint = nodes.get(firstKey)!; const secondPoint = nodes.get(secondKey)!;
          return Math.atan2(firstPoint.y - centre.y, firstPoint.x - centre.x) - Math.atan2(secondPoint.y - centre.y, secondPoint.x - centre.x);
        });
        const reverseIndex = ordered.indexOf(from);
        if (reverseIndex < 0 || !ordered.length) break;
        const next = ordered[(reverseIndex - 1 + ordered.length) % ordered.length];
        from = to; to = next;
        if (from === initialFrom && to === initialTo) { complete = true; break; }
      }
      if (!complete || faceKeys.length < 3) return;
      const area = faceKeys.reduce((total, key, index) => {
        const point = nodes.get(key)!; const next = nodes.get(faceKeys[(index + 1) % faceKeys.length])!;
        return total + point.x * next.y - next.x * point.y;
      }, 0) / 2;
      if (area >= MIN_ENCLOSED_AREA_MM2) faces.push({ keys: faceKeys, area, wallIds: faceWallIds });
    });
  });

  return faces.sort((first, second) => second.area - first.area).map((face, index) => {
    const sourceWallIds = [...face.wallIds];
    return {
      id: `project-room-${index + 1}`,
      name: `Room ${index + 1}`,
      sourceWallId: sourceWallIds[0] ?? "",
      sourceWallIds,
      vertices: counterClockwiseVertices(face.keys.map((key) => { const point = nodes.get(key)!; return { x: point.x, y: height - point.y }; })),
    };
  });
}

function roomCentre(room: NamedOutline): Point2D {
  return room.vertices.reduce((total, point) => ({ x: total.x + point.x / room.vertices.length, y: total.y + point.y / room.vertices.length }), { x: 0, y: 0 });
}

function roomVisualCentre(points: Point2D[]): Point2D {
  let twiceArea = 0; let x = 0; let y = 0;
  points.forEach((point, index) => {
    const next = points[(index + 1) % points.length]; const cross = point.x * next.y - next.x * point.y;
    twiceArea += cross; x += (point.x + next.x) * cross; y += (point.y + next.y) * cross;
  });
  if (Math.abs(twiceArea) < 1e-9) return roomCentre({ vertices: points } as NamedOutline);
  return { x: x / (3 * twiceArea), y: y / (3 * twiceArea) };
}

function reconcileRooms(current: NamedOutline[], detected: NamedOutline[]): NamedOutline[] {
  const available = [...current];
  const usedNames = new Set(current.map((room) => room.name));
  let nextRoomNumber = 1;
  const nextName = () => {
    while (usedNames.has(`Room ${nextRoomNumber}`)) nextRoomNumber += 1;
    const name = `Room ${nextRoomNumber}`; usedNames.add(name); nextRoomNumber += 1; return name;
  };
  return detected.map((room) => {
    const centre = roomCentre(room); const sourceIds = room.sourceWallIds ?? [room.sourceWallId];
    const candidates = available.map((candidate, index) => {
      const candidateSources = candidate.sourceWallIds ?? [candidate.sourceWallId]; const candidateCentre = roomCentre(candidate);
      const sharesWall = sourceIds.some((wallId) => candidateSources.includes(wallId));
      return { candidate, index, sharesWall, distance: Math.hypot(centre.x - candidateCentre.x, centre.y - candidateCentre.y) };
    }).filter((candidate) => candidate.sharesWall).sort((first, second) => first.distance - second.distance);
    const match = candidates[0];
    if (!match) return { ...room, id: crypto.randomUUID(), name: nextName() };
    available.splice(match.index, 1);
    return { ...room, id: match.candidate.id, name: match.candidate.name };
  });
}

function roomOpenings(room: NamedOutline, openings: FullOpening[], walls: Wall[]): Opening[] {
  const measurement = (value: number) => ({ value, uncertainty_mm: 5, verified: false, source_type: "USER_MEASURED" });
  const roomEdges = room.vertices.map((start, index) => ({ start, end: room.vertices[(index + 1) % room.vertices.length], index }));
  return openings.flatMap((opening) => {
    const wall = walls.find((item) => item.id === opening.wallId); const start = wall?.points[opening.segmentIndex]; const end = wall?.points[opening.segmentIndex + 1];
    if (!start || !end) return [];
    const segmentLengthMm = Math.hypot(end.x - start.x, end.y - start.y); if (!segmentLengthMm) return [];
    const unit = { x: (end.x - start.x) / segmentLengthMm, y: (end.y - start.y) / segmentLengthMm };
    const openingStart = { x: start.x + unit.x * opening.offset, y: start.y + unit.y * opening.offset };
    const openingEnd = { x: openingStart.x + unit.x * opening.width, y: openingStart.y + unit.y * opening.width };
    const edge = roomEdges.find((candidate) => {
      const startProjection = pointOnSegment(openingStart, candidate.start, candidate.end); const endProjection = pointOnSegment(openingEnd, candidate.start, candidate.end);
      return Math.hypot(openingStart.x - startProjection.point.x, openingStart.y - startProjection.point.y) <= 1 && Math.hypot(openingEnd.x - endProjection.point.x, openingEnd.y - endProjection.point.y) <= 1;
    });
    if (!edge) return [];
    const edgeDx = edge.end.x - edge.start.x; const edgeDy = edge.end.y - edge.start.y; const segmentDx = end.x - start.x; const segmentDy = end.y - start.y;
    const edgeLength = Math.hypot(edgeDx, edgeDy); const startProjection = pointOnSegment(openingStart, edge.start, edge.end);
    const offset = edgeDx * segmentDx + edgeDy * segmentDy >= 0 ? startProjection.along * edgeLength : edgeLength - startProjection.along * edgeLength - opening.width;
    return [{ id: opening.id, kind: opening.kind, parent_wall_id: `wall-${String(edge.index + 1).padStart(3, "0")}`, offset_mm: Math.max(0, offset), width: measurement(opening.width), height: measurement(opening.height), sill_height_mm: opening.kind === "WINDOW" ? opening.sill : 0, ...(opening.kind === "DOOR" ? { hinge_side: opening.hingeSide, door_type: opening.doorType, swing_angle_deg: 90, opens_inward: opening.opensInward } : {}) }];
  });
}

export function FullFloorplanEditor({ apiUrl, displayUnits, floorplanStyle, exportRequest, activeRoomName, fixtures = [], onFixturesChange, onOpenRoom }: Props) {
  const [walls, setWalls] = useState<Wall[]>([]);
  const [openings, setOpenings] = useState<FullOpening[]>([]);
  const [history, setHistory] = useState<Snapshot[]>([]);
  const [future, setFuture] = useState<Snapshot[]>([]);
  const [draft, setDraft] = useState<Point2D[]>([]);
  const [tool, setTool] = useState<Tool>("SELECT");
  const [lShapePickerOpen, setLShapePickerOpen] = useState(false);
  const [snapEnabled, setSnapEnabled] = useState(true);
  const [snapSize, setSnapSize] = useState(SNAP);
  const [squaredWalls, setSquaredWalls] = useState(false);
  const [wallHeight, setWallHeight] = useState(2400);
  const [wallThickness, setWallThickness] = useState(100);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState<Point2D>({ x: 0, y: 0 });
  const [selectedSegment, setSelectedSegment] = useState<SegmentSelection | null>(null);
  const [selectedPoint, setSelectedPoint] = useState<PointSelection | null>(null);
  const [wallLengthInput, setWallLengthInput] = useState<number | null>(null);
  const [sourceFile, setSourceFile] = useState<File | null>(null);
  const [sourceUrl, setSourceUrl] = useState<string | null>(null);
  const [canvasSize, setCanvasSize] = useState(DEFAULT_SIZE);
  const [importing, setImporting] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);
  const [rooms, setRooms] = useState<NamedOutline[]>([]);
  const [selectedRoomId, setSelectedRoomId] = useState<string | null>(null);
  const [roomValidation, setRoomValidation] = useState<RoomValidationResponse | null>(null);
  const [roomValidationError, setRoomValidationError] = useState<string | null>(null);
  const [roomSaving, setRoomSaving] = useState(false);
  const [openingKind, setOpeningKind] = useState<"DOOR" | "WINDOW">("DOOR");
  const [openingParent, setOpeningParent] = useState("");
  const [openingOffset, setOpeningOffset] = useState(100);
  const [openingWidth, setOpeningWidth] = useState(800);
  const [openingHeight, setOpeningHeight] = useState(2040);
  const [windowSill, setWindowSill] = useState(900);
  const [doorType, setDoorType] = useState<"SINGLE" | "DOUBLE">("SINGLE");
  const [hingeSide, setHingeSide] = useState<"START" | "END">("START");
  const [opensInward, setOpensInward] = useState(true);
  const [openingError, setOpeningError] = useState<string | null>(null);
  const [selectedOpeningId, setSelectedOpeningId] = useState<string | null>(null);
  const [measurements, setMeasurements] = useState<CustomMeasurement[]>([]);
  const [dimensionOffsets, setDimensionOffsets] = useState<Record<string, number>>({});
  const [hiddenDimensions, setHiddenDimensions] = useState<string[]>([]);
  const [measurementDraft, setMeasurementDraft] = useState<MeasurementReference[]>([]);
  const [selectedMeasurement, setSelectedMeasurement] = useState<string | null>(null);
  const [measurementEditEnabled, setMeasurementEditEnabled] = useState(false);
  const [contextMenu, setContextMenu] = useState<GeometryContextMenu | null>(null);
  const [measurementContextMenu, setMeasurementContextMenu] = useState<MeasurementContextMenu | null>(null);
  const [openingContextMenu, setOpeningContextMenu] = useState<OpeningContextMenu | null>(null);
  const [fixtureContextMenu, setFixtureContextMenu] = useState<FixtureContextMenu | null>(null);
  const [exportOpen, setExportOpen] = useState(false);
  const [exportStyle, setExportStyle] = useState<"CURRENT" | "TRADITIONAL" | "MODERN" | "CREATIVE">("CURRENT");
  const [exportFormat, setExportFormat] = useState<"PDF" | "PNG" | "JPG">("PDF");
  const [restored, setRestored] = useState(false);
  const [lockedViewport, setLockedViewport] = useState<FloorPlanViewport | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const editorRoot = useRef<HTMLElement>(null);
  const pointDrag = useRef<{ selection: PointSelection; before: Snapshot } | null>(null);
  const wallDrag = useRef<{ wallId: string; segmentIndex: number; before: Snapshot; points: Point2D[]; pointerStart: Point2D } | null>(null);
  const openingDrag = useRef<{ openingId: string; before: Snapshot } | null>(null);
  const measurementDrag = useRef<{ id: string; custom: boolean; pointerStart: Point2D; offset: number; normal: Point2D; before: Snapshot } | null>(null);
  const panDrag = useRef<{ clientX: number; clientY: number; pan: Point2D } | null>(null);
  const fixtureDrag = useRef<{ id: string; before: Point2D } | null>(null);

  const selectedRoom = useMemo(() => rooms.find((room) => room.id === selectedRoomId) ?? rooms[0] ?? null, [rooms, selectedRoomId]);
  const visibleFixtures = selectedRoom?.name === activeRoomName ? fixtures : [];
  const segmentOptions = useMemo(() => walls.flatMap((wall, wallIndex) => wall.points.slice(0, -1).map((_, segmentIndex) => ({ key: parentKey(wall.id, segmentIndex), label: `Wall ${wallIndex + 1}.${segmentIndex + 1}`, wall, segmentIndex }))), [walls]);
  const selectedWall = selectedSegment ? walls.find((wall) => wall.id === selectedSegment.wallId) ?? null : null;
  const selectedPointWall = selectedPoint ? walls.find((wall) => wall.id === selectedPoint.wallId) ?? null : null;
  const selectedPointValue = selectedPointWall && selectedPoint ? selectedPointWall.points[selectedPoint.pointIndex] : null;
  const coordinateWall = selectedWall ?? walls[0] ?? null;
  const coordinatePoints = coordinateWall?.points.slice(0, samePoint(coordinateWall.points[0], coordinateWall.points.at(-1)!) ? -1 : undefined) ?? [];
  const detectedRooms = useMemo(() => closedRooms(walls, canvasSize.height), [canvasSize.height, walls]);
  const wallVertexStarts = useMemo(() => {
    const starts = new Map<string, number>(); let next = 1;
    walls.forEach((wall) => { starts.set(wall.id, next); next += wall.points.length - (samePoint(wall.points[0], wall.points.at(-1)!) ? 1 : 0); });
    return starts;
  }, [walls]);
  const coordinateStart = coordinateWall ? wallVertexStarts.get(coordinateWall.id) ?? 1 : 1;
  const viewport = useMemo(() => {
    const geometry = [...walls.flatMap((wall) => wall.points), ...draft];
    const points = sourceUrl ? [...geometry, { x: 0, y: 0 }, { x: canvasSize.width, y: canvasSize.height }] : geometry;
    const xs = points.map((point) => point.x); const ys = points.map((point) => point.y);
    const span = points.length > 1 ? Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys)) : 1000;
    return createFloorPlanViewport(points, Math.max(120, span * .17));
  }, [canvasSize.height, canvasSize.width, draft, sourceUrl, walls]);
  const zoomedViewport = scaleFloorPlanViewport(lockedViewport ?? viewport, zoom);
  const activeViewport = { ...zoomedViewport, offsetX: zoomedViewport.offsetX + pan.x, offsetY: zoomedViewport.offsetY + pan.y };
  const toScreen = (point: Point2D) => floorPlanToScreen(point, activeViewport);

  useEffect(() => () => { if (sourceUrl) URL.revokeObjectURL(sourceUrl); }, [sourceUrl]);

  useEffect(() => { if (exportRequest > 0) queueMicrotask(() => setExportOpen(true)); }, [exportRequest]);
  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const saved = JSON.parse(raw) as PersistedFloorplan;
        const savedSquaredWalls = saved.squaredWalls ?? false;
        const savedWalls = cloneWalls(saved.walls ?? []);
        setWalls(savedSquaredWalls ? savedWalls.map((wall) => ({ ...wall, points: squareWallPoints(wall.points) })) : savedWalls);
        setOpenings(cloneOpenings(saved.openings ?? []));
        setMeasurements(cloneMeasurements(saved.measurements ?? [])); setDimensionOffsets(saved.dimensionOffsets ?? {}); setHiddenDimensions(saved.hiddenDimensions ?? []);
        setCanvasSize(saved.canvasSize ?? DEFAULT_SIZE);
        setRooms(saved.rooms ?? []); setSelectedRoomId(saved.selectedRoomId ?? null);
        setSnapEnabled(saved.snapEnabled ?? true); setSnapSize(saved.snapSize ?? SNAP); setSquaredWalls(savedSquaredWalls); setWallHeight(saved.wallHeight ?? 2400); setWallThickness(saved.wallThickness ?? 100);
      }
    } catch { /* Ignore a damaged browser draft and start clean. */ }
    setRestored(true);
  }, []);
  useEffect(() => {
    if (!restored) return;
    const value: PersistedFloorplan = { walls, openings, measurements, dimensionOffsets, hiddenDimensions, canvasSize, rooms, selectedRoomId, snapEnabled, snapSize, squaredWalls, wallHeight, wallThickness };
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(value));
  }, [canvasSize, dimensionOffsets, hiddenDimensions, measurements, openings, restored, rooms, selectedRoomId, snapEnabled, snapSize, squaredWalls, wallHeight, wallThickness, walls]);

  useEffect(() => {
    if (!restored) return;
    setRooms((current) => reconcileRooms(current, detectedRooms));
    setRoomValidation(null); setRoomValidationError(null);
  }, [detectedRooms, restored]);

  useEffect(() => {
    setSelectedRoomId((current) => rooms.some((room) => room.id === current) ? current : rooms[0]?.id ?? null);
  }, [rooms]);
  /* eslint-enable react-hooks/set-state-in-effect */

  const commitActiveDraft = useEffectEvent(() => commitDraft());
  const undoLastOperation = useEffectEvent(() => undo());
  useEffect(() => {
    const finishActiveTool = (event: KeyboardEvent) => {
      if (!editorRoot.current || editorRoot.current.closest("[hidden]")) return;
      if (!event.repeat && !event.shiftKey && !event.altKey && (event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "z") {
        event.preventDefault();
        undoLastOperation();
        return;
      }
      if (tool === "DRAW" && (event.key === "Enter" || event.key === "Escape")) {
        event.preventDefault();
        commitActiveDraft();
        return;
      }
      if (event.key === "Escape" && tool === "ADD_CORNERS") {
        setTool("SELECT");
        setSelectedSegment(null);
        setSelectedPoint(null);
        setLockedViewport(null);
      }
      if (event.key === "Escape" && tool === "ADD_MEASURE") {
        setTool("SELECT"); setMeasurementDraft([]); setSelectedMeasurement(null); setMeasurementContextMenu(null);
      }
    };
    window.addEventListener("keydown", finishActiveTool);
    return () => window.removeEventListener("keydown", finishActiveTool);
  }, [tool]);

  useEffect(() => {
    if (!contextMenu) return;
    const dismiss = (event: PointerEvent) => {
      const target = event.target;
      if (target instanceof Element && target.closest(".floorplan-context-menu")) return;
      setContextMenu(null);
    };
    const dismissWithKeyboard = (event: KeyboardEvent) => { if (event.key === "Escape") setContextMenu(null); };
    const dismissOnBlur = () => setContextMenu(null);
    window.addEventListener("pointerdown", dismiss);
    window.addEventListener("keydown", dismissWithKeyboard);
    window.addEventListener("blur", dismissOnBlur);
    return () => {
      window.removeEventListener("pointerdown", dismiss);
      window.removeEventListener("keydown", dismissWithKeyboard);
      window.removeEventListener("blur", dismissOnBlur);
    };
  }, [contextMenu]);

  function snapshot(): Snapshot { return { walls: cloneWalls(walls), openings: cloneOpenings(openings), measurements: cloneMeasurements(measurements), dimensionOffsets: { ...dimensionOffsets }, hiddenDimensions: [...hiddenDimensions] }; }
  function invalidateRoomValidation() { setRoomValidation(null); setRoomValidationError(null); }
  function record(before = snapshot()) { setHistory((current) => [...current.slice(-29), before]); setFuture([]); invalidateRoomValidation(); }
  function restore(value: Snapshot) { setWalls(cloneWalls(value.walls)); setOpenings(cloneOpenings(value.openings)); setMeasurements(cloneMeasurements(value.measurements ?? [])); setDimensionOffsets({ ...(value.dimensionOffsets ?? {}) }); setHiddenDimensions([...(value.hiddenDimensions ?? [])]); setDraft([]); setMeasurementDraft([]); setSelectedMeasurement(null); setSelectedSegment(null); setSelectedPoint(null); invalidateRoomValidation(); }
  function undo() { const previous = history.at(-1); if (!previous) return; setFuture((current) => [snapshot(), ...current].slice(0, 30)); setHistory((current) => current.slice(0, -1)); restore(previous); }
  function redo() { const next = future[0]; if (!next) return; setHistory((current) => [...current.slice(-29), snapshot()]); setFuture((current) => current.slice(1)); restore(next); }

  function canvasPoint(event: ReactPointerEvent<SVGSVGElement>, attachToWalls = true): Point2D {
    return canvasPointFromClient(event.clientX, event.clientY, event.currentTarget, attachToWalls);
  }

  function screenPointFromClient(clientX: number, clientY: number, svg: SVGSVGElement): Point2D {
    const rect = svg.getBoundingClientRect();
    return { x: (clientX - rect.left) * FLOOR_PLAN_CANVAS_WIDTH / rect.width, y: (clientY - rect.top) * FLOOR_PLAN_CANVAS_HEIGHT / rect.height };
  }

  function resolveMeasurementReference(reference: MeasurementReference): Point2D | null {
    const wall = walls.find((item) => item.id === reference.wallId);
    if (!wall) return null;
    if (reference.kind === "POINT") return wall.points[reference.pointIndex] ?? null;
    const start = wall.points[reference.segmentIndex]; const end = wall.points[reference.segmentIndex + 1];
    return start && end ? { x: (start.x + end.x) / 2, y: (start.y + end.y) / 2 } : null;
  }

  function addMeasurementReference(reference: MeasurementReference) {
    if (tool !== "ADD_MEASURE") return;
    const first = measurementDraft[0];
    if (!first || first.kind !== reference.kind) { setMeasurementDraft([reference]); return; }
    const sameReference = first.wallId === reference.wallId && (first.kind === "POINT" ? first.pointIndex === (reference as PointSelection).pointIndex : first.segmentIndex === (reference as SegmentSelection).segmentIndex);
    if (sameReference) return;
    const id = crypto.randomUUID(); record();
    setMeasurements((current) => [...current, { id, first, second: reference, offset: 48 }]);
    setMeasurementDraft([]); setSelectedMeasurement(`custom:${id}`); setMeasurementEditEnabled(true); setTool("MEASURE");
  }

  function beginMeasurementDrag(event: ReactPointerEvent<SVGGElement>, id: string, custom: boolean, offset: number, normal: Point2D) {
    if (!measurementEditEnabled || event.button !== 0) return;
    const svg = event.currentTarget.ownerSVGElement; if (!svg) return;
    event.preventDefault(); event.stopPropagation(); event.currentTarget.setPointerCapture(event.pointerId);
    measurementDrag.current = { id, custom, offset, normal, pointerStart: screenPointFromClient(event.clientX, event.clientY, svg), before: snapshot() };
    setSelectedMeasurement(`${custom ? "custom" : "auto"}:${id}`);
  }

  function openMeasurementContextMenu(event: ReactMouseEvent<SVGGElement>, id: string) {
    if (!measurementEditEnabled) return;
    event.preventDefault(); event.stopPropagation();
    setContextMenu(null); setSelectedMeasurement(`custom:${id}`);
    setMeasurementContextMenu({ id, custom: true, x: event.clientX, y: event.clientY });
  }

  function setMeasurementDirection(id: string, direction: MeasurementDirection) {
    const measurement = measurements.find((item) => item.id === id);
    if (!measurement || (measurement.direction ?? "NORMAL") === direction) { setMeasurementContextMenu(null); return; }
    record();
    setMeasurements((current) => current.map((item) => item.id === id ? { ...item, direction } : item));
    setMeasurementContextMenu(null);
  }

  function changeCustomMeasurementValue(id: string) {
    const measurement = measurements.find((item) => item.id === id); if (!measurement) return;
    const first = resolveMeasurementReference(measurement.first); const second = resolveMeasurementReference(measurement.second); const current = first && second ? Math.hypot(second.x - first.x, second.y - first.y) : 0;
    const entered = window.prompt("New measurement value (mm)", current ? String(Math.round(current * 10) / 10) : ""); const value = Number(entered);
    if (!first || !second || !Number.isFinite(value) || value <= 0 || !current) { setMeasurementContextMenu(null); return; }
    if (measurement.second.kind === "POINT") {
      const next = { x: first.x + (second.x - first.x) * value / current, y: first.y + (second.y - first.y) * value / current };
      updateCoordinatePoint(measurement.second.wallId, measurement.second.pointIndex, next);
    } else {
      const wall = walls.find((item) => item.id === measurement.second.wallId); const start = wall?.points[measurement.second.segmentIndex]; const end = wall?.points[measurement.second.segmentIndex + 1]; const length = start && end ? Math.hypot(end.x - start.x, end.y - start.y) : 0;
      if (wall && start && end && length) updateCoordinatePoint(wall.id, measurement.second.segmentIndex + 1, { x: start.x + (end.x - start.x) * value / length, y: start.y + (end.y - start.y) * value / length });
    }
    setMeasurementContextMenu(null);
  }

  function openAutoMeasurementContextMenu(event: ReactMouseEvent<SVGGElement>, selection: SegmentSelection) {
    if (!measurementEditEnabled) return;
    event.preventDefault(); event.stopPropagation(); setContextMenu(null); setSelectedMeasurement(`auto:${selection.wallId}:${selection.segmentIndex}`);
    setMeasurementContextMenu({ id: `${selection.wallId}:${selection.segmentIndex}`, custom: false, x: event.clientX, y: event.clientY });
  }

  function deleteSelectedMeasurement() {
    if (!selectedMeasurement) return;
    record();
    if (selectedMeasurement.startsWith("custom:")) setMeasurements((current) => current.filter((measurement) => measurement.id !== selectedMeasurement.slice(7)));
    else setHiddenDimensions((current) => [...new Set([...current, selectedMeasurement.slice(5)])]);
    setSelectedMeasurement(null);
  }

  function deleteMeasurement(id: string, custom: boolean) {
    setSelectedMeasurement(`${custom ? "custom" : "auto"}:${id}`);
    record();
    if (custom) setMeasurements((current) => current.filter((measurement) => measurement.id !== id));
    else setHiddenDimensions((current) => [...new Set([...current, id])]);
    setMeasurementContextMenu(null); setSelectedMeasurement(null);
  }

  function beginFixtureDrag(event: ReactPointerEvent<SVGRectElement>, fixture: Obstacle) {
    if (!onFixturesChange || event.button !== 0) return;
    if (!window.confirm(`Move ${fixture.name} in the floorplan and update its position in the 3D viewer as well?`)) return;
    event.preventDefault(); event.stopPropagation(); event.currentTarget.setPointerCapture(event.pointerId);
    fixtureDrag.current = { id: fixture.id, before: { ...fixture.center } };
  }

  function moveFixture(event: ReactPointerEvent<SVGSVGElement>): boolean {
    const active = fixtureDrag.current;
    if (!active || !onFixturesChange) return false;
    const next = canvasPoint(event, false); const snapped = snapEnabled ? { x: Math.round(next.x / snapSize) * snapSize, y: Math.round(next.y / snapSize) * snapSize } : next;
    onFixturesChange(fixtures.map((fixture) => fixture.id === active.id ? { ...fixture, center: snapped } : fixture));
    return true;
  }

  function openFixtureContextMenu(event: ReactMouseEvent<SVGRectElement>, fixture: Obstacle) {
    if (!onFixturesChange) return;
    event.preventDefault(); event.stopPropagation(); setFixtureContextMenu({ id: fixture.id, x: Math.max(8, Math.min(event.clientX, window.innerWidth - 244)), y: Math.max(8, Math.min(event.clientY, window.innerHeight - 180)) });
  }

  function updateFixture(id: string, update: (fixture: Obstacle) => Obstacle) {
    if (!onFixturesChange) return;
    onFixturesChange(fixtures.map((fixture) => fixture.id === id ? update(fixture) : fixture));
  }

  function beginPan(event: ReactPointerEvent<SVGSVGElement>) {
    if (event.button !== 1) return;
    event.preventDefault(); event.stopPropagation();
    panDrag.current = { clientX: event.clientX, clientY: event.clientY, pan: { ...pan } };
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function canvasPointFromClient(clientX: number, clientY: number, svg: SVGSVGElement, attachToWalls = true): Point2D {
    const mapped = floorPlanFromClient(clientX, clientY, svg, activeViewport);
    const gridPoint = snapEnabled ? { x: Math.round(mapped.x / snapSize) * snapSize, y: Math.round(mapped.y / snapSize) * snapSize } : mapped;
    return attachToWalls ? snapPoint(gridPoint, walls, snapEnabled, snapSize) : gridPoint;
  }

  function commitDraft(points = draft) {
    if (points.length >= 2) { record(); setWalls((current) => [...current, { id: crypto.randomUUID(), points: squaredWalls ? squareWallPoints(points) : points }]); }
    setDraft([]); setTool("SELECT"); setLockedViewport(null); setSelectedSegment(null); setSelectedPoint(null);
  }

  function connectDraftToWall(wallId: string, segmentIndex: number, requested: Point2D) {
    const wall = walls.find((item) => item.id === wallId);
    const start = wall?.points[segmentIndex]; const end = wall?.points[segmentIndex + 1];
    if (!start || !end) return;
    const point = pointOnSegment(requested, start, end).point;
    if (draft.length) commitDraft(squaredWalls ? orthogonalPathTo(draft, point) : [...draft, point]);
    else setDraft([point]);
    setSelectedSegment({ wallId, segmentIndex }); setSelectedPoint(null);
  }

  function clearImportedDrawing() {
    if (sourceUrl) URL.revokeObjectURL(sourceUrl);
    setSourceUrl(null); setSourceFile(null); setCanvasSize(DEFAULT_SIZE); setImportError(null);
  }

  function applyTemplate(points: Point2D[]) {
    record();
    clearImportedDrawing();
    const outline = [...points.map((point) => ({ ...point })), { ...points[0] }];
    setWalls([{ id: crypto.randomUUID(), points: squaredWalls ? squareWallPoints(outline) : outline }]);
    setOpenings([]); setMeasurements([]); setDimensionOffsets({}); setHiddenDimensions([]); setRooms([]); setSelectedRoomId(null); setDraft([]); setTool("SELECT"); setSelectedSegment(null); setSelectedPoint(null); setLockedViewport(null); setLShapePickerOpen(false);
  }

  function newOutline() {
    record();
    clearImportedDrawing();
    setWalls([]); setOpenings([]); setMeasurements([]); setDimensionOffsets({}); setHiddenDimensions([]); setRooms([]); setSelectedRoomId(null); setDraft([]); setTool("DRAW"); setSelectedSegment(null); setSelectedPoint(null); setLockedViewport(viewport); setLShapePickerOpen(false);
  }

  function removeSegment(wallId: string, segmentIndex: number) {
    const wall = walls.find((item) => item.id === wallId);
    if (!wall || !wall.points[segmentIndex + 1]) return;
    const closed = samePoint(wall.points[0], wall.points.at(-1)!);
    record();
    if (closed) {
      const core = wall.points.slice(0, -1);
      const count = core.length;
      const remaining = Array.from({ length: count }, (_, index) => core[(segmentIndex + 1 + index) % count]);
      setWalls((current) => current.map((item) => item.id === wallId ? { ...item, points: remaining.map((point) => ({ ...point })) } : item));
      setOpenings((current) => current.filter((opening) => !(opening.wallId === wallId && opening.segmentIndex === segmentIndex)).map((opening) => {
        if (opening.wallId !== wallId) return opening;
        return { ...opening, segmentIndex: (opening.segmentIndex - (segmentIndex + 1) + count) % count };
      }));
    } else {
      const firstRun = wall.points.slice(0, segmentIndex + 1);
      const secondRun = wall.points.slice(segmentIndex + 1);
      const secondId = crypto.randomUUID();
      setWalls((current) => current.flatMap((item) => item.id !== wallId ? [item] : [
        ...(firstRun.length >= 2 ? [{ ...item, points: firstRun.map((point) => ({ ...point })) }] : []),
        ...(secondRun.length >= 2 ? [{ id: secondId, points: secondRun.map((point) => ({ ...point })) }] : []),
      ]));
      setOpenings((current) => current.filter((opening) => !(opening.wallId === wallId && opening.segmentIndex === segmentIndex)).map((opening) => {
        if (opening.wallId !== wallId || opening.segmentIndex < segmentIndex) return opening;
        return { ...opening, wallId: secondId, segmentIndex: opening.segmentIndex - segmentIndex - 1 };
      }));
    }
    setSelectedSegment(null); setSelectedPoint(null); setOpeningParent("");
  }

  function insertPointAt(wallId: string, segmentIndex: number, requested?: Point2D) {
    const wall = walls.find((item) => item.id === wallId);
    if (!wall) return;
    const start = wall.points[segmentIndex]; const end = wall.points[segmentIndex + 1];
    if (!start || !end) return;
    const projected = pointOnSegment(requested ?? { x: (start.x + end.x) / 2, y: (start.y + end.y) / 2 }, start, end);
    if (projected.along <= .015 || projected.along >= .985) return;
    const inserted = projected.point;
    record();
    setWalls((current) => current.map((item) => {
      if (item.id !== wallId) return item;
      const points = [...item.points.slice(0, segmentIndex + 1), inserted, ...item.points.slice(segmentIndex + 1)];
      return { ...item, points: squaredWalls ? squareWallPoints(points) : points };
    }));
    setOpenings((current) => current.filter((opening) => !(opening.wallId === wallId && opening.segmentIndex === segmentIndex)).map((opening) => opening.wallId === wallId && opening.segmentIndex > segmentIndex ? { ...opening, segmentIndex: opening.segmentIndex + 1 } : opening));
    setSelectedPoint({ wallId, pointIndex: segmentIndex + 1 });
    setSelectedSegment({ wallId, segmentIndex: segmentIndex + 1 });
  }

  function insertPoint() {
    if (!selectedSegment) return;
    insertPointAt(selectedSegment.wallId, selectedSegment.segmentIndex);
  }

  function insertPointAfterSelected() {
    if (!selectedPoint || !selectedPointWall) return;
    const closed = samePoint(selectedPointWall.points[0], selectedPointWall.points.at(-1)!);
    const lastUniqueIndex = selectedPointWall.points.length - (closed ? 2 : 1);
    if (!closed && selectedPoint.pointIndex >= lastUniqueIndex) return;
    insertPointAt(selectedPoint.wallId, selectedPoint.pointIndex);
  }

  function applySelectedWallLength() {
    if (!selectedSegment || !selectedWall) return;
    const start = selectedWall.points[selectedSegment.segmentIndex]; const end = selectedWall.points[selectedSegment.segmentIndex + 1];
    const currentLength = start && end ? Math.hypot(end.x - start.x, end.y - start.y) : 0;
    const requested = wallLengthInput ?? currentLength;
    if (!start || !end || !currentLength || !Number.isFinite(requested) || requested <= 0) return;
    const next = { x: start.x + (end.x - start.x) / currentLength * requested, y: start.y + (end.y - start.y) / currentLength * requested };
    const closed = samePoint(selectedWall.points[0], selectedWall.points.at(-1)!);
    const endIndex = closed && selectedSegment.segmentIndex + 1 === selectedWall.points.length - 1 ? 0 : selectedSegment.segmentIndex + 1;
    updateCoordinatePoint(selectedWall.id, endIndex, next);
    setWallLengthInput(null);
  }

  function deletePointAt(selection: PointSelection) {
    const wall = walls.find((item) => item.id === selection.wallId); if (!wall) return;
    const closed = samePoint(wall.points[0], wall.points.at(-1)!); const unique = closed ? wall.points.length - 1 : wall.points.length;
    if (unique <= (closed ? 3 : 2)) return;
    record();
    setWalls((current) => current.map((item) => {
      if (item.id !== wall.id) return item;
      const core = closed ? item.points.slice(0, -1) : [...item.points]; core.splice(selection.pointIndex, 1);
      const points = closed ? [...core, { ...core[0] }] : core;
      return { ...item, points: squaredWalls ? squareWallPoints(points) : points };
    }));
    setOpenings((current) => current.filter((opening) => opening.wallId !== wall.id)); setSelectedPoint(null); setSelectedSegment(null);
  }

  function deletePoint() {
    if (selectedPoint) deletePointAt(selectedPoint);
  }

  function openWallContextMenu(event: ReactMouseEvent<SVGLineElement>, selection: SegmentSelection) {
    if (tool !== "SELECT") return;
    event.preventDefault(); event.stopPropagation();
    setSelectedSegment(selection); setSelectedPoint(null); setSelectedOpeningId(null); setWallLengthInput(null);
    setOpeningParent(parentKey(selection.wallId, selection.segmentIndex));
    setContextMenu({ kind: "WALL", ...selection, x: Math.max(8, Math.min(event.clientX, window.innerWidth - 190)), y: Math.max(8, Math.min(event.clientY, window.innerHeight - 112)) });
  }

  function openPointContextMenu(event: ReactMouseEvent<SVGCircleElement>, selection: PointSelection) {
    if (tool !== "SELECT") return;
    event.preventDefault(); event.stopPropagation();
    setSelectedPoint(selection); setSelectedSegment(null); setSelectedOpeningId(null);
    setContextMenu({ kind: "POINT", ...selection, x: Math.max(8, Math.min(event.clientX, window.innerWidth - 190)), y: Math.max(8, Math.min(event.clientY, window.innerHeight - 112)) });
  }

  function beginPointDrag(event: ReactPointerEvent<SVGCircleElement>, selection: PointSelection) {
    if (tool !== "SELECT" || event.button !== 0) return;
    event.stopPropagation(); event.currentTarget.setPointerCapture(event.pointerId);
    pointDrag.current = { selection, before: snapshot() }; setLockedViewport(viewport); setSelectedPoint(selection); setSelectedSegment(null);
  }

  function beginWallDrag(event: ReactPointerEvent<SVGLineElement>, wall: Wall, segmentIndex: number) {
    if (tool !== "SELECT" || event.button !== 0) return;
    const svg = event.currentTarget.ownerSVGElement; if (!svg) return;
    event.stopPropagation(); event.currentTarget.setPointerCapture(event.pointerId);
    wallDrag.current = { wallId: wall.id, segmentIndex, before: snapshot(), points: wall.points.map((point) => ({ ...point })), pointerStart: canvasPointFromClient(event.clientX, event.clientY, svg, false) };
    setLockedViewport(viewport); setSelectedSegment({ wallId: wall.id, segmentIndex }); setSelectedPoint(null); setSelectedOpeningId(null); setWallLengthInput(null); setOpeningParent(parentKey(wall.id, segmentIndex));
  }

  function beginOpeningDrag(event: ReactPointerEvent<SVGElement>, opening: FullOpening) {
    if (event.button !== 0) return;
    event.stopPropagation(); event.currentTarget.setPointerCapture(event.pointerId);
    openingDrag.current = { openingId: opening.id, before: snapshot() }; selectOpeningForEdit(opening);
  }

  function selectOpeningForEdit(opening: FullOpening) {
    setTool("SELECT"); setLockedViewport(viewport); setSelectedOpeningId(opening.id); setSelectedPoint(null);
    setSelectedSegment({ wallId: opening.wallId, segmentIndex: opening.segmentIndex }); setOpeningParent(parentKey(opening.wallId, opening.segmentIndex));
    setOpeningKind(opening.kind); setOpeningOffset(opening.offset); setOpeningWidth(opening.width); setOpeningHeight(opening.height); setWindowSill(opening.sill);
    setDoorType(opening.doorType); setHingeSide(opening.hingeSide); setOpensInward(opening.opensInward); setOpeningError(null);
  }

  function openOpeningContextMenu(event: ReactMouseEvent<SVGGElement>, opening: FullOpening) {
    event.preventDefault(); event.stopPropagation(); selectOpeningForEdit(opening); setContextMenu(null); setMeasurementContextMenu(null);
    setOpeningContextMenu({ id: opening.id, x: Math.max(8, Math.min(event.clientX, window.innerWidth - 190)), y: Math.max(8, Math.min(event.clientY, window.innerHeight - 112)) });
  }

  function deleteOpeningById(id: string) {
    record(); setOpenings((current) => current.filter((opening) => opening.id !== id)); if (selectedOpeningId === id) setSelectedOpeningId(null);
  }

  function moveOpening(event: ReactPointerEvent<SVGSVGElement>): boolean {
    const active = openingDrag.current;
    if (!active) return false;
    const opening = openings.find((item) => item.id === active.openingId);
    if (!opening) return true;
    const pointer = canvasPoint(event, false);
    const nearest = walls.flatMap((wall) => wall.points.slice(0, -1).map((start, segmentIndex) => {
      const end = wall.points[segmentIndex + 1]; const projection = pointOnSegment(pointer, start, end); const length = segmentLength(wall, segmentIndex);
      return { wall, segmentIndex, projection, length, distance: Math.hypot(pointer.x - projection.point.x, pointer.y - projection.point.y) };
    })).filter((item) => item.length >= opening.width).sort((first, second) => first.distance - second.distance)[0];
    if (!nearest) return true;
    const maximum = nearest.length - opening.width;
    const rawOffset = nearest.projection.along * nearest.length - opening.width / 2;
    const requested = snapEnabled ? Math.round(rawOffset / snapSize) * snapSize : Math.round(rawOffset * 10) / 10;
    const blockers = openings.filter((item) => item.id !== opening.id && item.wallId === nearest.wall.id && item.segmentIndex === nearest.segmentIndex);
    const candidates = [Math.max(0, Math.min(maximum, requested)), 0, maximum, ...blockers.flatMap((item) => [item.offset + item.width, item.offset - opening.width])]
      .filter((value) => value >= 0 && value <= maximum)
      .filter((value) => blockers.every((item) => value + opening.width <= item.offset || value >= item.offset + item.width));
    const nextOffset = (candidates.length ? candidates : [opening.offset]).sort((first, second) => Math.abs(first - requested) - Math.abs(second - requested))[0];
    setOpenings((current) => current.map((item) => item.id === opening.id ? { ...item, wallId: nearest.wall.id, segmentIndex: nearest.segmentIndex, offset: nextOffset } : item));
    setSelectedSegment({ wallId: nearest.wall.id, segmentIndex: nearest.segmentIndex }); setOpeningParent(parentKey(nearest.wall.id, nearest.segmentIndex)); setOpeningOffset(nextOffset);
    return true;
  }

  function movePoint(event: ReactPointerEvent<SVGSVGElement>) {
    const panStart = panDrag.current;
    if (panStart) {
      const rect = event.currentTarget.getBoundingClientRect();
      setPan({ x: panStart.pan.x + (event.clientX - panStart.clientX) * FLOOR_PLAN_CANVAS_WIDTH / rect.width, y: panStart.pan.y + (event.clientY - panStart.clientY) * FLOOR_PLAN_CANVAS_HEIGHT / rect.height });
      return;
    }
    const activeMeasurement = measurementDrag.current;
    if (activeMeasurement) {
      const pointer = screenPointFromClient(event.clientX, event.clientY, event.currentTarget);
      const distance = activeMeasurement.offset + (pointer.x - activeMeasurement.pointerStart.x) * activeMeasurement.normal.x + (pointer.y - activeMeasurement.pointerStart.y) * activeMeasurement.normal.y;
      if (activeMeasurement.custom) setMeasurements((current) => current.map((measurement) => measurement.id === activeMeasurement.id ? { ...measurement, offset: distance } : measurement));
      else setDimensionOffsets((current) => ({ ...current, [activeMeasurement.id]: distance }));
      return;
    }
    if (moveFixture(event)) return;
    if (moveOpening(event)) return;
    const activeWall = wallDrag.current;
    if (activeWall) {
      const start = activeWall.points[activeWall.segmentIndex]; const endIndex = activeWall.segmentIndex + 1; const end = activeWall.points[endIndex];
      if (!start || !end) return;
      const dx = end.x - start.x; const dy = end.y - start.y; const length = Math.hypot(dx, dy); if (!length) return;
      const pointer = canvasPoint(event, false); const normal = { x: -dy / length, y: dx / length };
      const rawDistance = (pointer.x - activeWall.pointerStart.x) * normal.x + (pointer.y - activeWall.pointerStart.y) * normal.y;
      const distance = snapEnabled ? Math.round(rawDistance / snapSize) * snapSize : Math.round(rawDistance * 10) / 10;
      const attachmentTolerance = snapEnabled ? Math.max(4, snapSize * 0.25) : 4;
      setWalls((current) => {
        const nextWalls = current.map((wall) => {
        if (wall.id === activeWall.wallId) {
          const points = activeWall.points.map((point) => ({ ...point })); const closed = samePoint(points[0], points.at(-1)!);
          points[activeWall.segmentIndex] = { x: start.x + normal.x * distance, y: start.y + normal.y * distance };
          points[endIndex] = { x: end.x + normal.x * distance, y: end.y + normal.y * distance };
          if (closed && activeWall.segmentIndex === 0) points[points.length - 1] = { ...points[0] };
          if (closed && endIndex === points.length - 1) points[0] = { ...points[endIndex] };
          return { ...wall, points };
        }
        // Move every corner anchored on the original segment too. This preserves connected
        // room boundaries when a shared wall is translated rather than opening a gap.
        const points = wall.points.map((point) => {
          const projection = pointOnSegment(point, start, end);
          return Math.hypot(point.x - projection.point.x, point.y - projection.point.y) <= attachmentTolerance ? { x: point.x + normal.x * distance, y: point.y + normal.y * distance } : { ...point };
        });
          return { ...wall, points };
        }).map((wall) => ({ ...wall, points: samePoint(wall.points[0], wall.points.at(-1)!) ? [...wall.points.slice(0, -1), { ...wall.points[0] }] : wall.points }));
        const preservesConstraints = nextWalls.every((wall) => (!squaredWalls || hasOnlyOrthogonalSegments(wall.points)) && (wall.id !== activeWall.wallId || hasMinimumEnclosedArea(wall.points)));
        return preservesConstraints ? nextWalls : current;
      });
      return;
    }
    if (!pointDrag.current) return;
    const { selection } = pointDrag.current; const next = canvasPoint(event, false);
    setWalls((current) => current.map((wall) => {
      if (wall.id !== selection.wallId) return wall;
      if (squaredWalls) {
        const points = moveSquaredWallPoint(wall.points, selection.pointIndex, next);
        return hasMinimumEnclosedArea(points) ? { ...wall, points } : wall;
      }
      const points = wall.points.map((point) => ({ ...point })); const closed = samePoint(points[0], points.at(-1)!);
      points[selection.pointIndex] = next; if (closed && selection.pointIndex === 0) points[points.length - 1] = { ...next };
      return hasMinimumEnclosedArea(points) ? { ...wall, points } : wall;
    }));
  }

  function finishPointDrag() {
    if (panDrag.current) { panDrag.current = null; return; }
    if (measurementDrag.current) { const before = measurementDrag.current.before; measurementDrag.current = null; record(before); return; }
    if (fixtureDrag.current) { fixtureDrag.current = null; return; }
    if (openingDrag.current) { const before = openingDrag.current.before; openingDrag.current = null; setLockedViewport(null); record(before); return; }
    if (wallDrag.current) { const before = wallDrag.current.before; wallDrag.current = null; setLockedViewport(null); record(before); return; }
    if (!pointDrag.current) return;
    const before = pointDrag.current.before; pointDrag.current = null; setLockedViewport(null); record(before);
    setOpenings((current) => current.filter((opening) => {
      const wall = walls.find((item) => item.id === opening.wallId);
      return Boolean(wall && wall.points[opening.segmentIndex + 1] && opening.offset + opening.width <= segmentLength(wall, opening.segmentIndex));
    }));
  }

  function selectSegment(wallId: string, segmentIndex: number) {
    if (tool === "REMOVE") { removeSegment(wallId, segmentIndex); return; }
    if (tool === "ADD_CORNERS") { setSelectedSegment({ wallId, segmentIndex }); setSelectedPoint(null); return; }
    if (tool !== "SELECT") return;
    setSelectedSegment({ wallId, segmentIndex }); setSelectedPoint(null); setWallLengthInput(null); setOpeningParent(parentKey(wallId, segmentIndex));
  }

  function updateCoordinatePoint(wallId: string, pointIndex: number, next: Point2D) {
    record();
    setWalls((current) => current.map((wall) => {
      if (wall.id !== wallId) return wall;
      const closed = samePoint(wall.points[0], wall.points.at(-1)!);
      if (squaredWalls) {
        const points = moveSquaredWallPoint(wall.points, pointIndex, next);
        return hasMinimumEnclosedArea(points) ? { ...wall, points } : wall;
      }
      const points = wall.points.map((point) => ({ ...point }));
      points[pointIndex] = { ...next };
      if (closed && pointIndex === 0) points[points.length - 1] = { ...next };
      return hasMinimumEnclosedArea(points) ? { ...wall, points } : wall;
    }));
  }

  function resetOpeningForm(kind = openingKind) {
    setOpeningKind(kind); setOpeningOffset(100); setOpeningWidth(800); setOpeningHeight(kind === "DOOR" ? 2040 : 900); setWindowSill(900);
    setDoorType("SINGLE"); setHingeSide("START"); setOpensInward(true); setOpeningError(null);
    setOpeningParent(selectedSegment ? parentKey(selectedSegment.wallId, selectedSegment.segmentIndex) : "");
  }

  function saveOpening() {
    setOpeningError(null);
    const option = segmentOptions.find((item) => item.key === openingParent);
    if (!option) { setOpeningError("Select a wall in the drawing first."); return; }
    const length = segmentLength(option.wall, option.segmentIndex);
    if (openingWidth <= 0 || openingOffset < 0 || openingOffset + openingWidth > length) { setOpeningError(`The opening must fit within this ${formatLength(length, displayUnits)} wall.`); return; }
    if (openings.some((item) => item.id !== selectedOpeningId && item.wallId === option.wall.id && item.segmentIndex === option.segmentIndex && openingOffset < item.offset + item.width && openingOffset + openingWidth > item.offset)) { setOpeningError("This opening overlaps another door or window."); return; }
    record();
    const nextOpening: Omit<FullOpening, "id"> = { kind: openingKind, wallId: option.wall.id, segmentIndex: option.segmentIndex, offset: openingOffset, width: openingWidth, height: openingHeight, sill: openingKind === "WINDOW" ? windowSill : 0, hingeSide, doorType, opensInward };
    if (selectedOpeningId) setOpenings((current) => current.map((item) => item.id === selectedOpeningId ? { ...nextOpening, id: item.id } : item));
    else setOpenings((current) => [...current, { ...nextOpening, id: crypto.randomUUID() }]);
    setSelectedOpeningId(null); resetOpeningForm(nextOpening.kind);
  }

  function cancelOpeningEdit() {
    setSelectedOpeningId(null); resetOpeningForm();
  }

  async function importDrawing(file?: File) {
    if (!file) return;
    setSourceFile(file); if (sourceUrl) URL.revokeObjectURL(sourceUrl); setSourceUrl(URL.createObjectURL(file)); setImporting(true); setImportError(null);
    try {
      const response = await fetch(`${apiUrl}/project-floorplan/detect`, { method: "POST", headers: { "Content-Type": file.type || "application/octet-stream", "X-Filename": file.name, "X-Gap-Closure": "0.15" }, body: await file.arrayBuffer() });
      const payload = await response.json() as ProjectFloorplanResponse | { detail?: string };
      if (!response.ok) throw new Error("detail" in payload ? payload.detail : "The drawing could not be recognised.");
      const result = payload as ProjectFloorplanResponse; record(); setCanvasSize({ width: result.source_width_px, height: result.source_height_px });
      setWalls(result.rooms.map((room) => {
        const points = [...room.vertices.map((point) => ({ x: point.x, y: result.source_height_px - point.y })), { x: room.vertices[0].x, y: result.source_height_px - room.vertices[0].y }];
        return { id: room.id, points: squaredWalls ? squareWallPoints(points) : points };
      }));
      setOpenings([]); setMeasurements([]); setDimensionOffsets({}); setHiddenDimensions([]); setRooms([]); setSelectedRoomId(null); setTool("SELECT"); setSelectedSegment(null); setSelectedPoint(null);
    } catch (reason) { setImportError(reason instanceof Error ? reason.message : "The drawing could not be recognised."); }
    finally { setImporting(false); }
  }

  function selectedRoomDraft(): Room | null {
    if (!selectedRoom) return null;
    const roomId = /^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(selectedRoom.id) ? selectedRoom.id : crypto.randomUUID();
    const normalizedRoom = { ...selectedRoom, vertices: counterClockwiseVertices(selectedRoom.vertices) };
    return { id: roomId, name: normalizedRoom.name, version: 1, vertices: normalizedRoom.vertices, wall_height: { value: wallHeight, uncertainty_mm: 5, verified: false, source_type: "USER_MEASURED" }, wall_thickness: { value: wallThickness, uncertainty_mm: 5, verified: false, source_type: "USER_MEASURED" }, openings: roomOpenings(normalizedRoom, openings, walls), obstacles: [], person_mockup: null };
  }

  async function validateSelectedRoom() {
    const draftRoom = selectedRoomDraft(); setRoomValidation(null); setRoomValidationError(null);
    if (!draftRoom) { setRoomValidationError("Select a recognised room first."); return; }
    try {
      const response = await fetch(`${apiUrl}/rooms/validate`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(draftRoom) });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.detail ?? `Validation returned ${response.status}`);
      setRoomValidation(payload as RoomValidationResponse);
    } catch (error) { setRoomValidationError(formatMeasurementText(error instanceof Error ? error.message : "Room validation failed.", displayUnits)); }
  }

  async function saveSelectedRoom() {
    const draftRoom = selectedRoomDraft(); if (!draftRoom || !roomValidation) return;
    setRoomSaving(true); setRoomValidationError(null);
    try {
      const response = await fetch(`${apiUrl}/rooms/${draftRoom.id}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(draftRoom) });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.detail ?? `Save returned ${response.status}`);
      setRooms((current) => current.map((room) => room.id === selectedRoom?.id ? { ...room, id: (payload as Room).id, name: (payload as Room).name } : room));
      setSelectedRoomId((payload as Room).id);
    } catch (error) { setRoomValidationError(formatMeasurementText(error instanceof Error ? error.message : "Room could not be saved.", displayUnits)); }
    finally { setRoomSaving(false); }
  }

  function clearRoomValidation() { setRoomValidation(null); setRoomValidationError(null); }

  const help = tool === "DRAW" ? "Click an existing wall to start or finish a connected wall run. Double-click, right-click, Enter, or Esc also confirms the run and exits Add wall." : tool === "ADD_CORNERS" ? "Click a wall to insert a corner exactly at that position. The selected wall stays active for further corners." : tool === "REMOVE" ? "Click one wall segment to remove only the portion between its two corners. Use Undo if needed." : tool === "ADD_MEASURE" ? `${measurementDraft.length ? "Now select a second matching" : "Select the first"} wall or corner to add a measurement.` : measurementEditEnabled ? "Drag any measurement to reposition it, or right-click it to edit or delete it." : "Click a wall to select it, or drag any numbered corner to reshape the floorplan.";
  const vertexCount = walls.reduce((total, wall) => total + wall.points.length - (samePoint(wall.points[0], wall.points.at(-1)!) ? 1 : 0), 0);
  const sourceTopLeft = toScreen({ x: 0, y: canvasSize.height }); const sourceBottomRight = toScreen({ x: canvasSize.width, y: 0 });

  const openingPanel = <section className="tool-section full-plan-openings-panel" aria-label="Doors and windows">
    <div className="tool-heading"><span>+</span><h2>Add doors & windows</h2></div><p className="tool-note">Choose a wall, then add or remove openings without leaving the plan.</p>
    <div className="mode-switch" role="group" aria-label="Full floorplan opening type"><button className={openingKind === "DOOR" ? "active" : ""} onClick={() => { setOpeningKind("DOOR"); setOpeningHeight(2040); }}>Door</button><button className={openingKind === "WINDOW" ? "active" : ""} onClick={() => { setOpeningKind("WINDOW"); setOpeningHeight(900); }}>Window</button></div>
    <label className="field"><span>Parent wall</span><select value={openingParent} onChange={(event) => setOpeningParent(event.target.value)}><option value="">Select a wall…</option>{segmentOptions.map((item) => <option key={item.key} value={item.key}>{item.label}</option>)}</select></label>
    <div className="coordinate-fields"><label className="field"><span>Offset <small>{UNIT_LABEL[displayUnits]}</small></span><DisplayNumberInput minMm={0} valueMm={openingOffset} units={displayUnits} onMmChange={setOpeningOffset} /></label><label className="field"><span>Width <small>{UNIT_LABEL[displayUnits]}</small></span><DisplayNumberInput minMm={1} valueMm={openingWidth} units={displayUnits} onMmChange={setOpeningWidth} /></label><label className="field"><span>Height <small>{UNIT_LABEL[displayUnits]}</small></span><DisplayNumberInput minMm={1} valueMm={openingHeight} units={displayUnits} onMmChange={setOpeningHeight} /></label>{openingKind === "WINDOW" && <label className="field"><span>Sill <small>{UNIT_LABEL[displayUnits]}</small></span><DisplayNumberInput minMm={0} valueMm={windowSill} units={displayUnits} onMmChange={setWindowSill} /></label>}</div>
    {openingKind === "DOOR" && <><label className="check-row double-door-choice"><input type="checkbox" checked={doorType === "DOUBLE"} onChange={(event) => setDoorType(event.target.checked ? "DOUBLE" : "SINGLE")} /><span><strong>Double door</strong></span></label><div className="coordinate-fields"><label className="field"><span>Hinge side</span><select value={hingeSide} disabled={doorType === "DOUBLE"} onChange={(event) => setHingeSide(event.target.value as "START" | "END")}><option value="START">Wall start</option><option value="END">Wall end</option></select></label><label className="field"><span>Direction</span><select value={opensInward ? "IN" : "OUT"} onChange={(event) => setOpensInward(event.target.value === "IN")}><option value="IN">Into room</option><option value="OUT">Out of room</option></select></label></div></>}
    {openingError && <p className="inline-error">{openingError}</p>}<div className="opening-form-actions">{selectedOpeningId && <button onClick={cancelOpeningEdit}>Cancel edit</button>}<button className="primary-small" onClick={saveOpening}>{selectedOpeningId ? `Update ${openingKind.toLowerCase()}` : `Add ${openingKind === "DOOR" ? doorType === "DOUBLE" ? "double door" : "door" : "window"}`}</button></div>
    {openings.length > 0 && <div className="full-opening-list">{openings.map((opening, index) => <div key={opening.id} className={selectedOpeningId === opening.id ? "editing" : ""}><span className={`opening-chip ${opening.kind.toLowerCase()}`}>{opening.kind}</span><small>{`${opening.kind === "DOOR" ? "D" : "W"}${String(index + 1).padStart(3, "0")} · ${formatLength(opening.width, displayUnits)}`}</small><button className="edit-opening" type="button" onClick={() => selectOpeningForEdit(opening)}>Edit</button><button aria-label={`Remove ${opening.kind.toLowerCase()}`} onClick={() => deleteOpeningById(opening.id)}>×</button></div>)}</div>}
  </section>;

  function exportSvgMarkup(styleChoice = exportStyle) {
    const source = editorRoot.current?.querySelector<SVGSVGElement>(".floor-canvas");
    if (!source) return null;
    const clone = source.cloneNode(true) as SVGSVGElement;
    clone.setAttribute("xmlns", "http://www.w3.org/2000/svg"); clone.setAttribute("width", "1640"); clone.setAttribute("height", "1120");
    const style = styleChoice === "TRADITIONAL" ? ".plan-grid{display:none}.wall-body,.wall-line,.opening-gap,.opening-jamb,.door-leaf,.door-swing,.window-frame,.window-core,.window-jamb{stroke:#111!important}.wall-line{stroke-width:5!important}.canvas-background{fill:#fff!important}.full-room-highlight{display:none}.wall-label,.opening-dimension-label{fill:#111!important}" : styleChoice === "MODERN" ? ".canvas-background{fill:#f7faf9}.plan-grid{opacity:.25}.wall-line{stroke:#155d55}.wall-label,.opening-dimension-label{font-family:Arial,sans-serif!important}" : styleChoice === "CREATIVE" ? ".canvas-background{fill:#fff8ed}.plan-grid{stroke:#d7b77e!important}.wall-line{stroke:#75572d}.full-room-highlight polygon{fill-opacity:.28!important}" : "";
    return new XMLSerializer().serializeToString(clone).replace(">", `><style>${style}</style>`);
  }

  async function exportFloorplan() {
    const markup = exportSvgMarkup();
    if (!markup) return;
    const svgBlob = new Blob([markup], { type: "image/svg+xml;charset=utf-8" });
    const save = async (blob: Blob, extension: string) => {
      const picker = (window as Window & { showSaveFilePicker?: (options: unknown) => Promise<{ createWritable: () => Promise<{ write: (data: Blob) => Promise<void>; close: () => Promise<void> }> }> }).showSaveFilePicker;
      if (picker) {
        try { const handle = await picker({ suggestedName: `floorplan-${exportStyle.toLowerCase()}.${extension}`, types: [{ description: `Floorplan ${extension.toUpperCase()}`, accept: { [blob.type]: [`.${extension}`] } }] }); const writable = await handle.createWritable(); await writable.write(blob); await writable.close(); return; } catch (error) { if (error instanceof DOMException && error.name === "AbortError") return; }
      }
      const url = URL.createObjectURL(blob); const link = document.createElement("a"); link.href = url; link.download = `floorplan-${exportStyle.toLowerCase()}.${extension}`; link.click(); URL.revokeObjectURL(url);
    };
    if (exportFormat === "PDF") {
      const printWindow = window.open("", "_blank", "noopener,noreferrer");
      if (!printWindow) return;
      printWindow.document.write(`<html><head><title>Floorplan export</title><style>body{margin:0;display:grid;place-items:center;background:white}svg{width:100%;height:auto}</style></head><body>${markup}<script>window.onload=()=>window.print()</script></body></html>`); printWindow.document.close(); return;
    }
    const image = new Image(); const url = URL.createObjectURL(svgBlob);
    image.onload = () => { const canvas = document.createElement("canvas"); canvas.width = 1640; canvas.height = 1120; const context = canvas.getContext("2d"); context?.drawImage(image, 0, 0, canvas.width, canvas.height); canvas.toBlob((blob) => { if (blob) void save(blob, exportFormat.toLowerCase()); URL.revokeObjectURL(url); }, exportFormat === "JPG" ? "image/jpeg" : "image/png", .95); };
    image.src = url;
  }

  const exportPreviewMarkup = exportOpen ? exportSvgMarkup() : null;

  return <section ref={editorRoot} className={`editor-page full-plan-page ${floorplanStyle === "TRADITIONAL" ? "traditional-floorplan" : ""}`}>
    {exportOpen && <div className="modal-backdrop floorplan-export-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setExportOpen(false); }}><section className={`floorplan-export-dialog export-style-${exportStyle.toLowerCase()}`} role="dialog" aria-modal="true" aria-labelledby="floorplan-export-title"><header><div><span className="eyebrow">Floorplan export</span><h2 id="floorplan-export-title">Preview and save</h2></div><button type="button" className="modal-close" onClick={() => setExportOpen(false)}>×</button></header><div className="export-style-preview"><span>Preview</span><strong>{exportStyle === "CURRENT" ? (floorplanStyle === "TRADITIONAL" ? "Current traditional view" : "Current default view") : `${exportStyle[0]}${exportStyle.slice(1).toLowerCase()} drawing`}</strong>{exportPreviewMarkup && <div className="export-svg-preview" dangerouslySetInnerHTML={{ __html: exportPreviewMarkup }} />}</div><label className="field"><span>Drawing style</span><select value={exportStyle} onChange={(event) => setExportStyle(event.target.value as typeof exportStyle)}><option value="CURRENT">Current style</option><option value="TRADITIONAL">Traditional style</option><option value="MODERN">Modern style</option><option value="CREATIVE">Creative style</option></select></label><label className="field"><span>File format</span><select value={exportFormat} onChange={(event) => setExportFormat(event.target.value as typeof exportFormat)}><option value="PDF">PDF</option><option value="JPG">JPG</option><option value="PNG">PNG</option></select></label><footer><button type="button" onClick={() => setExportOpen(false)}>Cancel</button><button className="primary" type="button" onClick={() => { void exportFloorplan(); setExportOpen(false); }}>Save as {exportFormat}</button></footer></section></div>}
    {measurementContextMenu && <div className="floorplan-context-menu" role="menu" aria-label="Measurement actions" style={{ left: measurementContextMenu.x, top: measurementContextMenu.y }} onContextMenu={(event) => event.preventDefault()}>
      <strong>{measurementContextMenu.custom ? "Measurement" : "Wall measurement"}</strong>
      {measurementContextMenu.custom && <><button type="button" role="menuitem" onClick={() => changeCustomMeasurementValue(measurementContextMenu.id)}>Change measurement value…</button>
      <button type="button" role="menuitem" onClick={() => setMeasurementDirection(measurementContextMenu.id, "NORMAL")}>Normal direction</button>
      <button type="button" role="menuitem" onClick={() => setMeasurementDirection(measurementContextMenu.id, "HORIZONTAL")}>Horizontal dimension only</button>
      <button type="button" role="menuitem" onClick={() => setMeasurementDirection(measurementContextMenu.id, "VERTICAL")}>Vertical dimension only</button></>}
      <button type="button" role="menuitem" className="danger-button" onClick={() => deleteMeasurement(measurementContextMenu.id, measurementContextMenu.custom)}>{measurementContextMenu.custom ? "Delete measurement" : "Hide measurement"}</button>
    </div>}
    {openingContextMenu && <div className="floorplan-context-menu" role="menu" aria-label="Opening actions" style={{ left: openingContextMenu.x, top: openingContextMenu.y }} onContextMenu={(event) => event.preventDefault()}>
      <strong>{openings.find((opening) => opening.id === openingContextMenu.id)?.kind === "WINDOW" ? "Window" : "Door"}</strong>
      <button type="button" role="menuitem" onClick={() => { setOpeningContextMenu(null); }}>Edit values</button>
      <button type="button" role="menuitem" className="danger-button" onClick={() => { const id = openingContextMenu.id; setOpeningContextMenu(null); deleteOpeningById(id); }}>Delete opening</button>
    </div>}
    {fixtureContextMenu && (() => { const fixture = fixtures.find((item) => item.id === fixtureContextMenu.id); return fixture ? <div className="floorplan-context-menu floorplan-value-menu" role="menu" aria-label="Fixture values" style={{ left: fixtureContextMenu.x, top: fixtureContextMenu.y }} onContextMenu={(event) => event.preventDefault()}><strong>{fixture.name}</strong><div className="context-coordinate-fields"><label>X <small>{UNIT_LABEL[displayUnits]}</small><DisplayNumberInput valueMm={fixture.center.x} units={displayUnits} onMmChange={(value) => updateFixture(fixture.id, (item) => ({ ...item, center: { ...item.center, x: value } }))} /></label><label>Y <small>{UNIT_LABEL[displayUnits]}</small><DisplayNumberInput valueMm={fixture.center.y} units={displayUnits} onMmChange={(value) => updateFixture(fixture.id, (item) => ({ ...item, center: { ...item.center, y: value } }))} /></label><label>Width <small>{UNIT_LABEL[displayUnits]}</small><DisplayNumberInput minMm={1} valueMm={fixture.dimensions.width.value} units={displayUnits} onMmChange={(value) => updateFixture(fixture.id, (item) => ({ ...item, dimensions: { ...item.dimensions, width: { ...item.dimensions.width, value } } }))} /></label><label>Depth <small>{UNIT_LABEL[displayUnits]}</small><DisplayNumberInput minMm={1} valueMm={fixture.dimensions.depth.value} units={displayUnits} onMmChange={(value) => updateFixture(fixture.id, (item) => ({ ...item, dimensions: { ...item.dimensions, depth: { ...item.dimensions.depth, value } } }))} /></label></div><button type="button" role="menuitem" onClick={() => setFixtureContextMenu(null)}>Done</button></div> : null; })()}
    {contextMenu && <div className="floorplan-context-menu floorplan-value-menu" role="menu" aria-label={`${contextMenu.kind === "WALL" ? "Wall" : "Corner"} actions`} style={{ left: contextMenu.x, top: contextMenu.y }} onContextMenu={(event) => event.preventDefault()}>
      <strong>{contextMenu.kind === "WALL" ? "Wall" : "Corner"}</strong>
      {contextMenu.kind === "WALL" && selectedWall && <><label>Wall length <small>{UNIT_LABEL[displayUnits]}</small><DisplayNumberInput minMm={1} valueMm={wallLengthInput ?? segmentLength(selectedWall, contextMenu.segmentIndex)} units={displayUnits} onMmChange={setWallLengthInput} /></label><button type="button" role="menuitem" onClick={() => { applySelectedWallLength(); setContextMenu(null); }}>Apply wall length</button><button type="button" role="menuitem" className="danger-button" onClick={() => { const target = contextMenu; setContextMenu(null); removeSegment(target.wallId, target.segmentIndex); }}>Delete wall segment</button></>}
      {contextMenu.kind === "POINT" && selectedPointWall && selectedPointValue && <><div className="context-coordinate-fields"><label>X <small>{UNIT_LABEL[displayUnits]}</small><DisplayNumberInput valueMm={selectedPointValue.x} units={displayUnits} onMmChange={(value) => updateCoordinatePoint(contextMenu.wallId, contextMenu.pointIndex, { ...selectedPointValue, x: value })} /></label><label>Y <small>{UNIT_LABEL[displayUnits]}</small><DisplayNumberInput valueMm={selectedPointValue.y} units={displayUnits} onMmChange={(value) => updateCoordinatePoint(contextMenu.wallId, contextMenu.pointIndex, { ...selectedPointValue, y: value })} /></label></div><button type="button" role="menuitem" onClick={() => setContextMenu(null)}>Done</button><button type="button" role="menuitem" className="danger-button" onClick={() => { const target = contextMenu; setContextMenu(null); deletePointAt(target); }}>Delete corner</button></>}
    </div>}
    <div className="editor-intro"><h1>Draw the complete floorplan</h1><p className="editor-context-help">{help}</p></div>
    <div className="editor-layout full-plan-layout">
      <aside className="editor-tools full-plan-controls">
        <section className="tool-section"><div className="tool-heading"><span>1</span><h2>Build floorplan</h2></div>
          <div className="button-grid">
            <button onClick={() => applyTemplate(RECTANGLE_TEMPLATE)}>Rectangle</button>
            <button className={lShapePickerOpen ? "active" : ""} aria-expanded={lShapePickerOpen} aria-controls="full-l-shape-picker" onClick={() => setLShapePickerOpen((current) => !current)}>L-shape</button>
            <button onClick={newOutline}>New outline</button>
            <button className={tool === "SELECT" ? "active" : ""} onClick={() => { setTool("SELECT"); setDraft([]); setLockedViewport(null); }}>Modify</button>
          </div>
          {lShapePickerOpen && <div className="l-shape-picker" id="full-l-shape-picker"><div><span>Choose the L orientation</span><button type="button" aria-label="Close L-shape chooser" onClick={() => setLShapePickerOpen(false)}>×</button></div><p>Select the position of the internal notch. You can reshape every wall afterwards.</p><div className="l-shape-options">{L_SHAPE_TEMPLATES.map((template) => <button key={template.id} type="button" onClick={() => applyTemplate(template.points)}><span className="l-shape-thumbnail"><i style={{ clipPath: template.preview }} /></span><strong>{template.name}</strong></button>)}</div></div>}
          <div className="button-grid editor-history-row"><button title="Undo last operation (Ctrl+Z)" onClick={undo} disabled={!history.length}>↶ Undo</button><button onClick={redo} disabled={!future.length}>↷ Redo</button></div>
          <div className="button-grid full-plan-action-row" role="group" aria-label="Wall tools"><button className={tool === "DRAW" ? "active" : ""} onClick={() => { setTool("DRAW"); setDraft([]); setLockedViewport(viewport); setSelectedSegment(null); setSelectedPoint(null); }}>Add wall</button><button className={tool === "REMOVE" ? "active danger-button" : "danger-button"} onClick={() => { if (selectedSegment) { removeSegment(selectedSegment.wallId, selectedSegment.segmentIndex); return; } setTool("REMOVE"); setDraft([]); setLockedViewport(null); setSelectedPoint(null); }}>Remove wall</button></div>
          <div className="button-grid full-plan-action-row" role="group" aria-label="Corner tools"><button className={tool === "ADD_CORNERS" ? "active" : ""} onClick={() => { const firstWall = walls[0]; setTool("ADD_CORNERS"); setDraft([]); setLockedViewport(viewport); setSelectedPoint(null); setSelectedSegment((current) => current ?? (firstWall ? { wallId: firstWall.id, segmentIndex: 0 } : null)); }}>Add corners</button><button className="danger-button" disabled={!selectedPoint} onClick={deletePoint}>Remove corner</button></div>
          <div className="plan-constraint-controls">
            <label className="snap-control-row"><input type="checkbox" checked={snapEnabled} onChange={(event) => setSnapEnabled(event.target.checked)} /><span>Snap to grid – <small>{UNIT_LABEL[displayUnits]}</small></span><DisplayNumberInput className="snap-size-input" minMm={1} valueMm={snapSize} units={displayUnits} disabled={!snapEnabled} onMmChange={setSnapSize} /></label>
            <label className="check-row square-walls-control"><input type="checkbox" checked={squaredWalls} onChange={(event) => { const next = event.target.checked; setSquaredWalls(next); if (next) { record(); setWalls((current) => current.map((wall) => ({ ...wall, points: squareWallPoints(wall.points) }))); } }} /><span><strong>Square walls</strong><small>Keep every wall horizontal or vertical while editing.</small></span></label>
            <div className="measurement-mode-row"><label className="check-row measurement-edit-toggle"><input type="checkbox" checked={measurementEditEnabled} onChange={(event) => { setMeasurementEditEnabled(event.target.checked); setMeasurementDraft([]); setSelectedMeasurement(null); setMeasurementContextMenu(null); setTool(event.target.checked ? "MEASURE" : "SELECT"); }} /><span><strong>Edit measurements</strong><small>Drag or right-click any measurement to edit or delete it.</small></span></label><div className="button-grid measurement-action-row"><button type="button" className={tool === "ADD_MEASURE" ? "active" : ""} onClick={() => { setTool("ADD_MEASURE"); setMeasurementEditEnabled(false); setMeasurementDraft([]); setSelectedMeasurement(null); setSelectedSegment(null); setSelectedPoint(null); }}>Add measurement</button><button type="button" onClick={() => { if (hiddenDimensions.length) record(); setHiddenDimensions([]); }}>Show all measurements</button></div></div>
          </div>
          <p className={`full-plan-help ${tool === "REMOVE" ? "danger-help" : ""}`}>{help}</p>
          {measurementEditEnabled && selectedMeasurement && <div className="selected-properties measurement-properties"><div className="tool-heading"><span>M</span><h2>Selected measurement</h2></div><p className="tool-note">Drag this measurement on the drawing, right-click it for actions, or remove it.</p><button className="danger-button" onClick={deleteSelectedMeasurement}>Delete measurement</button></div>}
          {tool === "SELECT" && selectedSegment && selectedWall && <div className="selected-properties"><div className="tool-heading"><span>W{walls.findIndex((wall) => wall.id === selectedWall.id) + 1}.{selectedSegment.segmentIndex + 1}</span><h2>Selected wall</h2></div><p className="tool-note">Enter a new length to move the wall endpoint. Adjoining walls update automatically.</p><label className="field"><span>New length <small>{UNIT_LABEL[displayUnits]}</small></span><DisplayNumberInput minMm={1} valueMm={wallLengthInput ?? segmentLength(selectedWall, selectedSegment.segmentIndex)} units={displayUnits} onMmChange={setWallLengthInput} /></label><button className="primary-small" onClick={applySelectedWallLength}>Apply wall length</button><div className="button-grid"><button onClick={insertPoint}>Add point at midpoint</button><button className="danger-button" onClick={() => removeSegment(selectedWall.id, selectedSegment.segmentIndex)}>Remove wall segment</button></div></div>}
          {tool === "SELECT" && selectedPoint && selectedPointWall && selectedPointValue && <div className="selected-properties"><div className="tool-heading"><span>V{(wallVertexStarts.get(selectedPointWall.id) ?? 1) + selectedPoint.pointIndex}</span><h2>Selected corner</h2></div><div className="coordinate-fields"><label className="field"><span>X <small>{UNIT_LABEL[displayUnits]}</small></span><DisplayNumberInput valueMm={selectedPointValue.x} units={displayUnits} onMmChange={(value) => updateCoordinatePoint(selectedPointWall.id, selectedPoint.pointIndex, { ...selectedPointValue, x: value })} /></label><label className="field"><span>Y <small>{UNIT_LABEL[displayUnits]}</small></span><DisplayNumberInput valueMm={selectedPointValue.y} units={displayUnits} onMmChange={(value) => updateCoordinatePoint(selectedPointWall.id, selectedPoint.pointIndex, { ...selectedPointValue, y: value })} /></label></div><div className="button-grid"><button onClick={insertPointAfterSelected} disabled={!samePoint(selectedPointWall.points[0], selectedPointWall.points.at(-1)!) && selectedPoint.pointIndex >= selectedPointWall.points.length - 1}>Add corner after</button><button className="danger-button" onClick={deletePoint}>Delete corner</button></div></div>}
        </section>
        <section className="tool-section"><div className="tool-heading"><span>2</span><h2>Overall properties</h2></div><div className="coordinate-fields room-measurements"><label className="field"><span>Wall height <small>{UNIT_LABEL[displayUnits]}</small></span><DisplayNumberInput minMm={1} maxMm={100000} valueMm={wallHeight} units={displayUnits} onMmChange={setWallHeight} /></label><label className="field"><span>Wall thickness <small>{UNIT_LABEL[displayUnits]}</small></span><DisplayNumberInput minMm={1} maxMm={2000} valueMm={wallThickness} units={displayUnits} onMmChange={setWallThickness} /></label></div></section>
        <section className="tool-section"><div className="tool-heading"><span>3</span><h2>Import drawing</h2></div><p className="tool-note">Use a PDF, PNG, JPG, or WEBP as an editable tracing reference.</p><button className="primary-small secondary-action" onClick={() => fileInput.current?.click()}>{importing ? "Importing…" : "Import PDF or image"}</button><input ref={fileInput} hidden type="file" accept="application/pdf,image/png,image/jpeg,image/webp" onChange={(event) => { void importDrawing(event.target.files?.[0]); event.target.value = ""; }} />{sourceFile && <><small>{sourceFile.name}</small><button className="danger-button secondary-action" type="button" onClick={clearImportedDrawing}>Remove imported drawing</button></>}{importError && <p className="project-error">{importError}</p>}</section>
      </aside>

      <main className="drawing-column full-plan-drawing">
        <div className="resizable-floorplan-window">
        <div className="drawing-toolbar"><div className="drawing-zoom" role="group" aria-label="Drawing zoom"><button type="button" aria-label="Zoom out" onClick={() => setZoom((current) => Math.max(.5, current - .2))}>−</button><button type="button" aria-label="Reset zoom to 100%" onClick={() => setZoom(1)}>{Math.round(zoom * 100)}%</button><button type="button" aria-label="Zoom in" onClick={() => setZoom((current) => Math.min(3, current + .2))}>+</button><button type="button" className="fit-view-button" onClick={() => { setZoom(1); setPan({ x: 0, y: 0 }); setLockedViewport(null); }}>Fit</button></div><strong>{vertexCount} vertices · {walls.length} wall run{walls.length === 1 ? "" : "s"}</strong></div>
        <div className="full-plan-canvas">{sourceUrl && sourceFile?.type === "application/pdf" && <embed src={sourceUrl} type="application/pdf" />}
          <FloorPlanCanvas className={`mode-${tool.toLowerCase()}`} showGrid={!sourceUrl} underlay={Boolean(sourceUrl)} role="img" aria-label="Interactive complete building floorplan" onPointerDownCapture={beginPan} onPointerMove={movePoint} onPointerUp={finishPointDrag} onPointerCancel={finishPointDrag} onPointerDown={(event) => {
            if (tool === "ADD_CORNERS" && event.button === 0 && event.detail <= 1) { if (selectedSegment) insertPointAt(selectedSegment.wallId, selectedSegment.segmentIndex, canvasPoint(event, false)); return; }
            if (tool !== "DRAW" || event.button !== 0 || event.detail > 1) { if (event.target === event.currentTarget && tool === "SELECT") { setSelectedSegment(null); setSelectedPoint(null); setSelectedOpeningId(null); setOpeningParent(""); setOpeningError(null); } return; }
            const requested = canvasPoint(event); const point = squaredWalls && draft.length ? squareDrawPoint(draft.at(-1)!, requested) : requested; const touches = walls.some((wall) => wall.points.some((candidate) => samePoint(candidate, requested, 14))); const closes = draft.length >= 3 && samePoint(requested, draft[0], 16);
            if ((touches && draft.length) || closes) { commitDraft(squaredWalls ? orthogonalPathTo(draft, closes ? draft[0] : requested) : [...draft, closes ? draft[0] : point]); return; }
            setDraft((current) => current.length && squaredWalls ? [...current, squareDrawPoint(current.at(-1)!, requested)] : [...current, requested]);
          }} onDoubleClick={(event) => { if (tool !== "DRAW") return; event.preventDefault(); commitDraft(); }} onContextMenu={(event) => { if (tool !== "DRAW") return; event.preventDefault(); commitDraft(); }}>
            {sourceUrl && sourceFile?.type !== "application/pdf" && <image href={sourceUrl} x={sourceTopLeft.x} y={sourceTopLeft.y} width={sourceBottomRight.x - sourceTopLeft.x} height={sourceBottomRight.y - sourceTopLeft.y} preserveAspectRatio="none" className="full-plan-source-image" />}
            {walls.length === 0 && draft.length === 0 && <g className="full-plan-empty"><text x="410" y="270">Start with Add wall or import an existing drawing</text><text x="410" y="292">The editor uses consistent scale, dimensions, and draggable handles.</text></g>}
            {detectedRooms.map((room) => { const outline = room.vertices.map((point) => toScreen({ x: point.x, y: canvasSize.height - point.y })); return <polygon key={`room-background-${room.id}`} points={outline.map((point) => `${point.x},${point.y}`).join(" ")} className="room-polygon" />; })}
            {rooms.map((room, index) => {
              const outline = room.vertices.map((point) => toScreen({ x: point.x, y: canvasSize.height - point.y })); const visualCentre = roomVisualCentre(room.vertices); const centre = toScreen({ x: visualCentre.x, y: canvasSize.height - visualCentre.y });
              return <g key={`room-highlight-${room.id}`} className={`full-room-highlight room-colour-${index % 6} ${selectedRoomId === room.id ? "selected" : ""}`} onPointerDown={(event) => { event.stopPropagation(); setSelectedRoomId(room.id); }}><polygon points={outline.map((point) => `${point.x},${point.y}`).join(" ")} /><foreignObject className="room-name-editor" x={centre.x - 82} y={centre.y - 17} width="164" height="34"><input aria-label={`Name ${room.name}`} value={room.name} onPointerDown={(event) => { event.stopPropagation(); setSelectedRoomId(room.id); }} onChange={(event) => { const name = event.target.value; setRooms((current) => current.map((item) => item.id === room.id ? { ...item, name } : item)); setRoomValidation(null); }} /></foreignObject></g>;
            })}
            {visibleFixtures.map((fixture) => {
              const width = fixture.dimensions.width.value; const depth = fixture.dimensions.depth.value;
              const topLeft = toScreen({ x: fixture.center.x - width / 2, y: fixture.center.y + depth / 2 }); const bottomRight = toScreen({ x: fixture.center.x + width / 2, y: fixture.center.y - depth / 2 });
              const centre = toScreen(fixture.center); const label = `${formatLength(width, displayUnits)} × ${formatLength(depth, displayUnits)}`;
              return <g key={`fixture-${fixture.id}`} className="floorplan-fixture" onPointerDown={(event) => event.stopPropagation()}><rect x={topLeft.x} y={topLeft.y} width={bottomRight.x - topLeft.x} height={bottomRight.y - topLeft.y} onPointerDown={(event) => beginFixtureDrag(event, fixture)} onContextMenu={(event) => openFixtureContextMenu(event, fixture)} /><text x={centre.x} y={centre.y - 3}>{fixture.name}</text><text className="floorplan-fixture-dimension" x={centre.x} y={centre.y + 10}>{label}</text></g>;
            })}
            {walls.map((wall) => {
              const closed = samePoint(wall.points[0], wall.points.at(-1)!); const modelPoints = closed ? wall.points.slice(0, -1) : wall.points; const screenPoints = modelPoints.map(toScreen); const centre = screenPoints.reduce((total, point) => ({ x: total.x + point.x / screenPoints.length, y: total.y + point.y / screenPoints.length }), { x: 0, y: 0 });
              const dimensions = wall.points.slice(0, -1).map((modelStart, segmentIndex) => {
                const modelEnd = wall.points[segmentIndex + 1]; const length = Math.hypot(modelEnd.x - modelStart.x, modelEnd.y - modelStart.y) || 1; const start = toScreen(modelStart); const end = toScreen(modelEnd); const screenLength = Math.hypot(end.x - start.x, end.y - start.y) || 1; const tangent = { x: (end.x - start.x) / screenLength, y: (end.y - start.y) / screenLength }; const candidate = { x: -tangent.y, y: tangent.x }; const midpoint = { x: (start.x + end.x) / 2, y: (start.y + end.y) / 2 }; const dot = (midpoint.x - centre.x) * candidate.x + (midpoint.y - centre.y) * candidate.y; const outward = dot >= 0 ? candidate : { x: -candidate.x, y: -candidate.y }; const dimensionId = `${wall.id}:${segmentIndex}`; if (hiddenDimensions.includes(dimensionId)) return null; const offset = dimensionOffsets[dimensionId] ?? 78; const first = { x: start.x + outward.x * offset, y: start.y + outward.y * offset }; const second = { x: end.x + outward.x * offset, y: end.y + outward.y * offset }; const label = { x: (first.x + second.x) / 2 + outward.x * 10, y: (first.y + second.y) / 2 + outward.y * 10 };
                return <g key={`${wall.id}-dimension-${segmentIndex}`} className={`wall-dimension measurement-item ${tool === "MEASURE" ? "editable" : ""} ${selectedMeasurement === `auto:${dimensionId}` ? "selected" : ""}`} onPointerDown={(event) => beginMeasurementDrag(event, dimensionId, false, offset, outward)} onContextMenu={(event) => openAutoMeasurementContextMenu(event, { wallId: wall.id, segmentIndex })}><line className="measurement-hit" x1={first.x} y1={first.y} x2={second.x} y2={second.y} /><line className="dimension-extension" x1={start.x + outward.x * 7} y1={start.y + outward.y * 7} x2={first.x + outward.x * 4} y2={first.y + outward.y * 4} /><line className="dimension-extension" x1={end.x + outward.x * 7} y1={end.y + outward.y * 7} x2={second.x + outward.x * 4} y2={second.y + outward.y * 4} /><line className="dimension-line" x1={first.x} y1={first.y} x2={second.x} y2={second.y} /><line className="dimension-tick" x1={first.x - tangent.x * 4 + outward.x * 4} y1={first.y - tangent.y * 4 + outward.y * 4} x2={first.x + tangent.x * 4 - outward.x * 4} y2={first.y + tangent.y * 4 - outward.y * 4} /><line className="dimension-tick" x1={second.x - tangent.x * 4 + outward.x * 4} y1={second.y - tangent.y * 4 + outward.y * 4} x2={second.x + tangent.x * 4 - outward.x * 4} y2={second.y + tangent.y * 4 - outward.y * 4} /><text className="wall-label" x={label.x} y={label.y}>{formatLength(length, displayUnits)}</text></g>;
              });
              return <g key={wall.id} className={tool === "REMOVE" ? "removable" : ""}>{wall.points.slice(0, -1).map((modelStart, segmentIndex) => { const start = toScreen(modelStart); const end = toScreen(wall.points[segmentIndex + 1]); const selection = { wallId: wall.id, segmentIndex }; const chosen = measurementDraft.some((reference) => reference.kind === "WALL" && reference.wallId === wall.id && reference.segmentIndex === segmentIndex); return <g key={`${wall.id}-segment-${segmentIndex}`}><line className="wall-body" x1={start.x} y1={start.y} x2={end.x} y2={end.y} /><line className={`wall-line ${selectedSegment?.wallId === wall.id && selectedSegment.segmentIndex === segmentIndex ? "selected" : ""} ${chosen ? "measurement-chosen" : ""}`} x1={start.x} y1={start.y} x2={end.x} y2={end.y} onContextMenu={(event) => openWallContextMenu(event, selection)} onPointerDown={(event) => { event.stopPropagation(); const svg = event.currentTarget.ownerSVGElement; if (tool === "DRAW" && svg) { connectDraftToWall(wall.id, segmentIndex, canvasPointFromClient(event.clientX, event.clientY, svg, false)); return; } if (tool === "ADD_CORNERS" && svg) { insertPointAt(wall.id, segmentIndex, canvasPointFromClient(event.clientX, event.clientY, svg, false)); return; } if (tool === "ADD_MEASURE") { addMeasurementReference({ kind: "WALL", ...selection }); return; } if (tool === "SELECT") { beginWallDrag(event, wall, segmentIndex); return; } selectSegment(wall.id, segmentIndex); }} /></g>; })}{dimensions}</g>;
            })}
            {measurements.map((measurement) => {
              const modelStart = resolveMeasurementReference(measurement.first); const modelEnd = resolveMeasurementReference(measurement.second);
              if (!modelStart || !modelEnd) return null;
              const start = toScreen(modelStart); const end = toScreen(modelEnd); const direction = measurement.direction ?? "NORMAL";
              const screenLength = Math.hypot(end.x - start.x, end.y - start.y); const normalLength = Math.hypot(modelEnd.x - modelStart.x, modelEnd.y - modelStart.y);
              if (!screenLength || !normalLength) return null;
              const normalTangent = { x: (end.x - start.x) / screenLength, y: (end.y - start.y) / screenLength }; const normalNormal = { x: -normalTangent.y, y: normalTangent.x };
              const tangent = direction === "HORIZONTAL" ? { x: 1, y: 0 } : direction === "VERTICAL" ? { x: 0, y: 1 } : normalTangent;
              const normal = direction === "HORIZONTAL" ? { x: 0, y: -1 } : direction === "VERTICAL" ? { x: 1, y: 0 } : normalNormal;
              const baseline = direction === "HORIZONTAL" ? (start.y + end.y) / 2 + normal.y * measurement.offset : direction === "VERTICAL" ? (start.x + end.x) / 2 + normal.x * measurement.offset : null;
              const first = direction === "HORIZONTAL" ? { x: start.x, y: baseline! } : direction === "VERTICAL" ? { x: baseline!, y: start.y } : { x: start.x + normal.x * measurement.offset, y: start.y + normal.y * measurement.offset };
              const second = direction === "HORIZONTAL" ? { x: end.x, y: baseline! } : direction === "VERTICAL" ? { x: baseline!, y: end.y } : { x: end.x + normal.x * measurement.offset, y: end.y + normal.y * measurement.offset };
              const length = direction === "HORIZONTAL" ? Math.abs(modelEnd.x - modelStart.x) : direction === "VERTICAL" ? Math.abs(modelEnd.y - modelStart.y) : normalLength;
              const label = { x: (first.x + second.x) / 2 + normal.x * 10, y: (first.y + second.y) / 2 + normal.y * 10 };
              return <g key={measurement.id} className={`wall-dimension custom-measurement measurement-item ${tool === "MEASURE" ? "editable" : ""} ${selectedMeasurement === `custom:${measurement.id}` ? "selected" : ""}`} onPointerDown={(event) => beginMeasurementDrag(event, measurement.id, true, measurement.offset, normal)} onContextMenu={(event) => openMeasurementContextMenu(event, measurement.id)}><line className="measurement-hit" x1={first.x} y1={first.y} x2={second.x} y2={second.y} /><line className="dimension-extension" x1={start.x} y1={start.y} x2={first.x} y2={first.y} /><line className="dimension-extension" x1={end.x} y1={end.y} x2={second.x} y2={second.y} /><line className="dimension-line" x1={first.x} y1={first.y} x2={second.x} y2={second.y} /><line className="dimension-tick" x1={first.x - tangent.x * 4 + normal.x * 4} y1={first.y - tangent.y * 4 + normal.y * 4} x2={first.x + tangent.x * 4 - normal.x * 4} y2={first.y + tangent.y * 4 - normal.y * 4} /><line className="dimension-tick" x1={second.x - tangent.x * 4 + normal.x * 4} y1={second.y - tangent.y * 4 + normal.y * 4} x2={second.x + tangent.x * 4 - normal.x * 4} y2={second.y + tangent.y * 4 - normal.y * 4} /><text className="wall-label" x={label.x} y={label.y}>{formatLength(length, displayUnits)}</text></g>;
            })}
            {draft.length > 0 && <polyline points={draft.map(toScreen).map((point) => `${point.x},${point.y}`).join(" ")} className="full-wall-draft" />}
            {openings.map((opening) => {
              const wall = walls.find((item) => item.id === opening.wallId); const wallStart = wall?.points[opening.segmentIndex]; const wallEnd = wall?.points[opening.segmentIndex + 1];
              if (!wall || !wallStart || !wallEnd) return null;
              const wallPoints = samePoint(wall.points[0], wall.points.at(-1)!) ? wall.points.slice(0, -1) : wall.points;
              const wallCentre = wallPoints.reduce((total, point) => ({ x: total.x + point.x / wallPoints.length, y: total.y + point.y / wallPoints.length }), { x: 0, y: 0 });
              const lane = openings.filter((item) => item.wallId === opening.wallId && item.segmentIndex === opening.segmentIndex).findIndex((item) => item.id === opening.id);
              const graphic: FloorPlanOpeningGraphic = { id: opening.id, kind: opening.kind, offset: opening.offset, width: opening.width, doorType: opening.doorType, hingeSide: opening.hingeSide, opensInward: opening.opensInward };
              return <FloorPlanOpeningDimensions key={`opening-dimensions-${opening.id}`} opening={graphic} wallStart={wallStart} wallEnd={wallEnd} wallCentre={wallCentre} lane={lane} toScreen={toScreen} displayUnits={displayUnits} />;
            })}
            {openings.map((opening) => {
              const wall = walls.find((item) => item.id === opening.wallId); const wallStart = wall?.points[opening.segmentIndex]; const wallEnd = wall?.points[opening.segmentIndex + 1];
              if (!wall || !wallStart || !wallEnd) return null;
              const graphic: FloorPlanOpeningGraphic = { id: opening.id, kind: opening.kind, offset: opening.offset, width: opening.width, doorType: opening.doorType, hingeSide: opening.hingeSide, opensInward: opening.opensInward };
              return <FloorPlanOpeningSymbol key={opening.id} opening={graphic} wallStart={wallStart} wallEnd={wallEnd} toScreen={toScreen} displayUnits={displayUnits} selected={selectedOpeningId === opening.id} onPointerDown={(event) => beginOpeningDrag(event, opening)} onContextMenu={(event) => openOpeningContextMenu(event, opening)} />;
            })}
            <g className="vertex-layer">{walls.flatMap((wall) => { const closed = samePoint(wall.points[0], wall.points.at(-1)!); const firstNumber = wallVertexStarts.get(wall.id) ?? 1; return wall.points.slice(0, closed ? -1 : undefined).map((modelPoint, pointIndex) => { const point = toScreen(modelPoint); const selection = { wallId: wall.id, pointIndex }; const chosen = measurementDraft.some((reference) => reference.kind === "POINT" && reference.wallId === wall.id && reference.pointIndex === pointIndex); return <g key={`${wall.id}-point-${pointIndex}`}><circle cx={point.x} cy={point.y} r={selectedPoint?.wallId === wall.id && selectedPoint.pointIndex === pointIndex ? "12" : "10"} className={`vertex-handle full-plan-vertex ${tool === "SELECT" || tool === "ADD_MEASURE" ? "editable" : ""} ${selectedPoint?.wallId === wall.id && selectedPoint.pointIndex === pointIndex ? "selected" : ""} ${chosen ? "measurement-chosen" : ""}`} onContextMenu={(event) => openPointContextMenu(event, selection)} onPointerDown={(event) => { if (tool === "ADD_MEASURE") { event.stopPropagation(); addMeasurementReference({ kind: "POINT", ...selection }); return; } beginPointDrag(event, selection); }} /><text className="vertex-label" x={point.x} y={point.y + 3}>{firstNumber + pointIndex}</text></g>; }); })}</g>
            {draft.map((modelPoint, index) => { const point = toScreen(modelPoint); return <circle key={`draft-${index}`} cx={point.x} cy={point.y} r="7" className="full-plan-draft-node" />; })}
          </FloorPlanCanvas>
        </div><div className="drawing-scale"><span>Coordinates and dimensions shown in {UNIT_LABEL[displayUnits]} · calculations remain millimetre-authoritative</span><span>Shared floorplan engine auto-fits the complete plan</span></div>
        </div>
      </main>

      <aside className="coordinate-panel full-plan-side-column">
        <section className="tool-section"><div className="tool-heading"><span>4</span><h2>Coordinates</h2></div><p className="tool-note">{coordinateWall ? "Each fixed corner label matches the numbered point on the drawing. Edit only the X and Y values." : "Add a wall run to edit its numbered corner coordinates."}</p><div className="coordinate-input-list" aria-label={`Selected wall coordinates in ${UNIT_LABEL[displayUnits]}`}>{coordinateWall && coordinatePoints.map((point, index) => { const cornerNumber = coordinateStart + index; return <div key={`${coordinateWall.id}-coordinate-${index}`}><span className="coordinate-prefix">{cornerNumber} -</span><DisplayNumberInput aria-label={`Corner ${cornerNumber} X coordinate`} valueMm={point.x} units={displayUnits} onMmChange={(value) => updateCoordinatePoint(coordinateWall.id, index, { ...point, x: value })} /><span className="coordinate-comma">,</span><DisplayNumberInput aria-label={`Corner ${cornerNumber} Y coordinate`} valueMm={point.y} units={displayUnits} onMmChange={(value) => updateCoordinatePoint(coordinateWall.id, index, { ...point, y: value })} /></div>; })}</div></section>
        <section className="tool-section full-plan-rooms"><div className="tool-heading"><span>5</span><h2>Rooms & 3D viewer</h2></div><p className="tool-note">Closed rooms appear here automatically. Rename them on the plan or below, then choose which room to view in 3D.</p>{rooms.length === 0 ? <p className="inline-status">No closed rooms yet.</p> : <><label className="field"><span>Room to edit and view</span><select value={selectedRoom?.id ?? ""} onChange={(event) => { setSelectedRoomId(event.target.value); clearRoomValidation(); }}>{rooms.map((room) => <option key={room.id} value={room.id}>{room.name}</option>)}</select></label>{selectedRoom && <label className="field"><span>Room name</span><input value={selectedRoom.name} onChange={(event) => { setRooms((current) => current.map((room) => room.id === selectedRoom.id ? { ...room, name: event.target.value } : room)); setRoomValidation(null); }} /></label>}<button className="primary-small secondary-action" disabled={!selectedRoom} onClick={() => selectedRoom && onOpenRoom(selectedRoom.name, selectedRoom.vertices, roomOpenings(selectedRoom, openings, walls), wallHeight, wallThickness)}>Open selected room in 3D viewer</button><button className="validate-button" onClick={validateSelectedRoom}>Validate geometry</button>{roomValidationError && <div className="validation-fail"><strong>INVALID</strong><p>{roomValidationError}</p></div>}{roomValidation && <div className="validation-pass"><div><strong>VALID · CCW</strong><span>{formatArea(roomValidation.area_mm2, displayUnits)} · {formatLength(roomValidation.perimeter_mm, displayUnits)} perimeter</span></div><ul>{roomValidation.warnings.map((warning) => <li key={warning}>{formatMeasurementText(warning, displayUnits)}</li>)}</ul></div>}<div className="save-actions"><button onClick={clearRoomValidation}>Clear validation</button><button className="save-button" disabled={!roomValidation || roomSaving} onClick={saveSelectedRoom}>{roomSaving ? "Saving…" : "Save room revision"}</button></div></>}</section>
        {openingPanel}
      </aside>
    </div>
  </section>;
}
