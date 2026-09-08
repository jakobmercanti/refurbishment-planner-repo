"use client";

import { type CSSProperties, type KeyboardEvent as ReactKeyboardEvent, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent, type WheelEvent as ReactWheelEvent, useCallback, useEffect, useEffectEvent, useMemo, useRef, useState } from "react";
import { CatalogueFixtureEditor } from "@/components/CatalogueFixtureEditor";
import { OpeningPreview } from "@/components/OpeningPreview";
import { Popup } from "@/components/Popup";
import { FloorPlanFixtureDimensions, nearestFixtureWallSpan } from "@/components/FloorPlanFixtureDimensions";
import { FixturePlanSymbol } from "@/components/FixturePlanSymbol";
import { alignObstacleToNearestWall } from "@/lib/layoutInteraction";
import { DisplayNumberInput } from "@/components/DisplayNumberInput";
import { createFloorPlanViewport, floorPlanFromClient, floorPlanToScreen, FLOOR_PLAN_CANVAS_HEIGHT, FLOOR_PLAN_CANVAS_WIDTH, FloorPlanCanvas, scaleFloorPlanViewport, type FloorPlanViewport } from "@/components/FloorPlanCanvas";
import { FloorPlanOpeningDimensions, FloorPlanOpeningSymbol, type FloorPlanOpeningGraphic } from "@/components/FloorPlanOpeningGraphics";
import { filledToolbarDock, FloatingToolbar } from "@/components/FloatingToolbar";
import { ToolbarContextMenu } from "@/components/ToolbarContextMenu";
import { closestValidOpeningOffset, cornerOffsetsOnWallSegment, isOpeningPlacementValid } from "@/lib/openingPlacement";
import { translateWallAndAttachedOpenings } from "@/lib/openingWallDrag";
import { closedRooms as detectClosedRooms } from "@/lib/roomDetection";
import { addRoomOutsideWall, removeRoomBoundary } from "@/lib/roomOperations";
import { needsWallThicknessOverride } from "@/lib/wallThickness";
import { formatLength, UNIT_LABEL, type DisplayUnits } from "@/lib/units";
import { FLOORPLAN_STYLE_OPTIONS, floorplanStyleClass, floorplanStyleCss, floorplanStyleLabel, type FloorplanStyle } from "@/lib/floorplanStyles";
import { FloorplanAtmosphere } from "@/components/FloorplanAtmosphere";
import { appendWallRunPreservingExistingWalls, constrainSquaredCornerTarget, constrainTranslatedWallDistance, enforceWallLengthOverrides, enforceWallLengthOverridesPreservingOrthogonality, followTerminatingEndpointsOnTranslatedSegments, isPreciseWallJunction, materializeWallIntersections, materializeWallJunctionsForSelection, preserveUnrelatedParallelWallSegments, preserveUnrelatedWallGeometry, reanchorAttachedWallEndpoints, reanchorAutoWallBridges, retainDraggedWallConnections, separateParallelSegmentEndForDrag, separateParallelSegmentStartForDrag, translateHostSegmentWithDraggedEndpoint, translateIncidentWallRunsForCorner, translateStraightWallRunForCorner, type MaterializedWallSelection } from "@/lib/wallDragGeometry";
import type { CatalogueItem, Obstacle, Opening, Point2D, Room } from "@/lib/types";
import { FLOORPLAN_TOOLBARS, type ToolbarId, type ToolbarVisibility } from "@/lib/toolbars";

type WallAttachment = { wallId: string; segmentIndex: number; along: number; hideCorner?: boolean };
type Wall = { id: string; points: Point2D[]; attachments?: Record<number, WallAttachment>; thicknessOverridesMm?: Record<number, number>; lengthOverridesMm?: Record<number, number>; cornerNumbers?: Record<number, number> };
type NamedOutline = { id: string; name: string; vertices: Point2D[]; sourceWallId: string; sourceWallIds?: string[]; colourIndex?: number };
type Tool = "SELECT" | "DRAW" | "ADD_CORNERS" | "REMOVE" | "MEASURE" | "ADD_MEASURE";
type SegmentSelection = { wallId: string; segmentIndex: number };
type PointSelection = { wallId: string; pointIndex: number };
type PendingOutlineAction = "EMPTY" | "RECTANGLE" | "L_SHAPE";
type MeasurementReference = ({ kind: "WALL" } & SegmentSelection) | ({ kind: "POINT" } & PointSelection);
type MeasurementDirection = "NORMAL" | "HORIZONTAL" | "VERTICAL";
type CustomMeasurement = { id: string; first: MeasurementReference; second: MeasurementReference; offset: number; direction?: MeasurementDirection };
type GeometryContextMenu = ({ kind: "WALL" } & SegmentSelection | { kind: "POINT" } & PointSelection) & { x: number; y: number };
type MeasurementContextMenu = { id: string; custom: boolean; x: number; y: number };
type OpeningContextMenu = { id: string; x: number; y: number };
type OpeningMeasurementContextMenu = { id: string; section: number; x: number; y: number };
type FixtureContextMenu = { id: string; x: number; y: number };
type FixtureMeasurementContextMenu = { id: string; section: 0 | 1 | 2; x: number; y: number };
type ExportStyle = "CURRENT" | FloorplanStyle;
type ExportFormat = "PDF" | "PNG" | "JPG";
type SaveFileHandle = { createWritable: () => Promise<{ write: (data: Blob) => Promise<void>; close: () => Promise<void> }> };
type FullOpening = {
  id: string; kind: "DOOR" | "WINDOW"; wallId: string; segmentIndex: number;
  offset: number; width: number; height: number; sill: number;
  hingeSide: "START" | "END"; doorType: "SINGLE" | "DOUBLE"; opensInward: boolean; catalogueItemId?: string;
};
type Snapshot = { walls: Wall[]; openings: FullOpening[]; measurements: CustomMeasurement[]; dimensionOffsets: Record<string, number>; hiddenDimensions: string[]; wallThickness?: number; rooms?: NamedOutline[]; selectedRoomId?: string | null };
type WallDrag = { wallId: string; segmentIndex: number; before: Snapshot; historyBefore: Snapshot; points: Point2D[]; pointerStart: Point2D; detachedPointIndices: number[]; keepDetachedPointIndices: number[] };
type PersistedFloorplan = Snapshot & { canvasSize: { width: number; height: number }; rooms: NamedOutline[]; selectedRoomId: string | null; snapEnabled?: boolean; snapSize?: number; squaredWalls?: boolean; wallHeight?: number; wallThickness?: number };
interface Props { projectRooms?: Room[]; onPlanRoomChange?: (room: Room) => void; onPlanRoomsChange?: (rooms: Room[]) => void; apiUrl: string; displayUnits: DisplayUnits; floorplanStyle: FloorplanStyle; exportRequest: number; importFile?: File | null; activeSourceRoomId?: string; fixtures?: Obstacle[]; onFixturesChange?: (fixtures: Obstacle[]) => void; toolbarVisibility: ToolbarVisibility; onToggleToolbar: (id: ToolbarId) => void; toolbarLayoutResetKey: number; fillToolbarLayout: boolean; }

const DEFAULT_SIZE = { width: 1100, height: 700 };
const isPdfFile = (file: File) => file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf");
function readImageDimensions(url: string): Promise<{ width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => {
      if (!image.naturalWidth || !image.naturalHeight) {
        reject(new Error("The drawing could not be loaded."));
        return;
      }
      resolve({ width: image.naturalWidth, height: image.naturalHeight });
    };
    image.onerror = () => reject(new Error("The drawing could not be loaded."));
    image.src = url;
  });
}
const DEFAULT_SNAP_MM = 50;
const DEFAULT_WALL_THICKNESS_MM = 50;
const MIN_WALL_CLEARANCE_MM = 200;
const MAX_DEFAULT_MEASUREMENT_OFFSET_MM = 200;
const DEFAULT_CUSTOM_MEASUREMENT_OFFSET_SCREEN = 48;
const MEASUREMENT_LABEL_GAP_SCREEN = 10;
const defaultMeasurementOffset = (maximumScreenOffset: number, scale: number) => Math.max(0, Math.min(maximumScreenOffset, MAX_DEFAULT_MEASUREMENT_OFFSET_MM * Math.max(0, scale) - MEASUREMENT_LABEL_GAP_SCREEN));
// An opening belongs to one wall segment, never to a corner where two segments
// meet. This keeps the graphical gap, door swing and exported room geometry
// unambiguous after a room is edited.
const OPENING_CORNER_CLEARANCE_MM = 50;
const STORAGE_KEY = "renovation-fit:complete-floorplan:v2";
const RECTANGLE_TEMPLATE: Point2D[] = [{ x: 0, y: 0 }, { x: 2400, y: 0 }, { x: 2400, y: 1800 }, { x: 0, y: 1800 }];
const L_SHAPE_TEMPLATES: Array<{ id: string; name: string; preview: string; points: Point2D[] }> = [
  { id: "NOTCH_TOP_RIGHT", name: "Notch top right", preview: "polygon(0 0, 69% 0, 69% 36%, 100% 36%, 100% 100%, 0 100%)", points: [{ x: 0, y: 0 }, { x: 3200, y: 0 }, { x: 3200, y: 1800 }, { x: 2200, y: 1800 }, { x: 2200, y: 2800 }, { x: 0, y: 2800 }] },
  { id: "NOTCH_BOTTOM_RIGHT", name: "Notch bottom right", preview: "polygon(0 0, 100% 0, 100% 64%, 69% 64%, 69% 100%, 0 100%)", points: [{ x: 0, y: 0 }, { x: 2200, y: 0 }, { x: 2200, y: 1000 }, { x: 3200, y: 1000 }, { x: 3200, y: 2800 }, { x: 0, y: 2800 }] },
  { id: "NOTCH_TOP_LEFT", name: "Notch top left", preview: "polygon(31% 0, 100% 0, 100% 100%, 0 100%, 0 36%, 31% 36%)", points: [{ x: 0, y: 0 }, { x: 3200, y: 0 }, { x: 3200, y: 2800 }, { x: 1000, y: 2800 }, { x: 1000, y: 1800 }, { x: 0, y: 1800 }] },
  { id: "NOTCH_BOTTOM_LEFT", name: "Notch bottom left", preview: "polygon(0 0, 100% 0, 100% 100%, 31% 100%, 31% 64%, 0 64%)", points: [{ x: 1000, y: 0 }, { x: 3200, y: 0 }, { x: 3200, y: 2800 }, { x: 0, y: 2800 }, { x: 0, y: 1000 }, { x: 1000, y: 1000 }] },
];
const cloneWalls = (walls: Wall[]) => walls.map((wall) => ({ ...wall, points: wall.points.map((point) => ({ ...point })), attachments: wall.attachments ? Object.fromEntries(Object.entries(wall.attachments).map(([index, attachment]) => [index, { ...attachment }])) : undefined, thicknessOverridesMm: wall.thicknessOverridesMm ? { ...wall.thicknessOverridesMm } : undefined, lengthOverridesMm: wall.lengthOverridesMm ? { ...wall.lengthOverridesMm } : undefined, cornerNumbers: wall.cornerNumbers ? { ...wall.cornerNumbers } : undefined }));
const wallThicknessForSegment = (wall: Wall, segmentIndex: number, defaultThicknessMm: number) => wall.thicknessOverridesMm?.[segmentIndex] ?? defaultThicknessMm;
const remapSegmentThicknessOverrides = (overrides: Record<number, number> | undefined, sourceIndices: number[]) => {
  if (!overrides) return undefined;
  const next = sourceIndices.reduce<Record<number, number>>((result, sourceIndex, targetIndex) => {
    const thicknessMm = overrides[sourceIndex];
    if (thicknessMm !== undefined) result[targetIndex] = thicknessMm;
    return result;
  }, {});
  return Object.keys(next).length ? next : undefined;
};
const remapSegmentLengthOverrides = (overrides: Record<number, number> | undefined, sourceIndices: number[]) => {
  if (!overrides) return undefined;
  const next = sourceIndices.reduce<Record<number, number>>((result, sourceIndex, targetIndex) => {
    const lengthMm = overrides[sourceIndex];
    if (lengthMm !== undefined) result[targetIndex] = lengthMm;
    return result;
  }, {});
  return Object.keys(next).length ? next : undefined;
};
const splitSegmentLengthOverride = (overrides: Record<number, number> | undefined, segmentIndex: number, along: number) => {
  if (!overrides) return undefined;
  const next: Record<number, number> = {};
  Object.entries(overrides).forEach(([rawIndex, lengthMm]) => {
    const sourceIndex = Number(rawIndex);
    if (sourceIndex < segmentIndex) next[sourceIndex] = lengthMm;
    else if (sourceIndex === segmentIndex) {
      next[sourceIndex] = lengthMm * along;
      next[sourceIndex + 1] = lengthMm * (1 - along);
    } else next[sourceIndex + 1] = lengthMm;
  });
  return Object.keys(next).length ? next : undefined;
};
const cloneOpenings = (openings: FullOpening[]) => openings.map((opening) => ({ ...opening }));
const cloneMeasurements = (measurements: CustomMeasurement[]) => measurements.map((measurement) => ({ ...measurement, first: { ...measurement.first }, second: { ...measurement.second } }));
const samePoint = (a: Point2D, b: Point2D, tolerance = 1) => Math.hypot(a.x - b.x, a.y - b.y) <= tolerance;
type WallRenderSegment = { segmentIndex: number; start: Point2D; end: Point2D; thicknessMm: number; visualThicknessMm: number };
type WallVisualRun = { segments: WallRenderSegment[]; points: Point2D[]; thicknessMm: number; closed: boolean };
const sameVisualThickness = (first: WallRenderSegment, second: WallRenderSegment) => Math.abs(first.visualThicknessMm - second.visualThicknessMm) <= .001;
function buildWallVisualRuns(segments: WallRenderSegment[], closed: boolean): WallVisualRun[] {
  if (!segments.length) return [];
  const runs: WallVisualRun[] = [];
  let current: WallVisualRun = { segments: [segments[0]], points: [segments[0].start, segments[0].end], thicknessMm: segments[0].visualThicknessMm, closed: false };
  segments.slice(1).forEach((segment) => {
    if (sameVisualThickness(current.segments.at(-1)!, segment)) {
      current.segments.push(segment);
      current.points.push(segment.end);
      return;
    }
    runs.push(current);
    current = { segments: [segment], points: [segment.start, segment.end], thicknessMm: segment.visualThicknessMm, closed: false };
  });
  runs.push(current);
  if (closed && runs.length > 1 && sameVisualThickness(runs[0].segments[0], runs.at(-1)!.segments.at(-1)!)) {
    const first = runs.shift()!;
    const last = runs.pop()!;
    runs.unshift({ segments: [...last.segments, ...first.segments], points: [...last.points, ...first.points.slice(1)], thicknessMm: last.thicknessMm, closed: false });
  }
  if (closed && runs.length === 1) runs[0].closed = true;
  return runs;
}
const MIN_ENCLOSED_AREA_MM2 = 10_000;
const FLOORPLAN_EXPORT_WIDTH = 1640;
const FLOORPLAN_EXPORT_HEIGHT = 1120;
const FLOORPLAN_EXPORT_ATTRIBUTION = "Made using freefloorplan3d.com";
const FLOORPLAN_EXPORT_ATTRIBUTION_URL = "https://freefloorplan3d.com";

const FLOORPLAN_EXPORT_BASE_CSS = `
.floor-canvas{display:block;width:100%;height:100%;min-height:0!important;background:#eef1ed}
.canvas-background{fill:#eef1ed}.plan-grid line{stroke:#d9dfda;stroke-width:1}.room-polygon{fill:#fff;stroke:none}
 .wall-body{stroke:#183d34;stroke-width:var(--wall-stroke-width,10px);stroke-linecap:square}.wall-line{stroke:#fff;stroke-width:var(--wall-inner-stroke-width,4px);stroke-linecap:square}.wall-interaction-line{display:none}.wall-thickness-label{fill:#183d34;font:700 9px ui-monospace,monospace;text-anchor:middle;dominant-baseline:central;paint-order:stroke;stroke:#fff;stroke-width:4px}
.wall-dimension{color:#68756f}.wall-dimension.manual-measurement{color:#1678bd}.wall-dimension.manual-measurement .manual-measurement-value{fill:currentColor}.dimension-line,.dimension-extension,.dimension-tick{stroke:currentColor;stroke-width:1}.dimension-extension{opacity:.62}.dimension-tick{stroke-width:1.3}
.wall-label{fill:#44514b;font:650 10px ui-monospace,monospace;text-anchor:middle;dominant-baseline:central;paint-order:stroke;stroke:#fff;stroke-width:5px}
.export-room-name{fill:#233e37;font:700 10px Arial,sans-serif;text-anchor:middle;dominant-baseline:central}
.vertex-handle{fill:#fff;stroke:#183d34;stroke-width:4}.vertex-label{fill:#17221e;font:700 8px ui-monospace,monospace;text-anchor:middle}
.opening-gap{stroke:#fff;stroke-width:var(--opening-gap-width,14px)}.opening-jamb{stroke:#233e37;stroke-width:2.5;stroke-linecap:square}.door-closed-line{stroke:#8e9a95;stroke-width:1.2;stroke-dasharray:4 3}.door-leaf{stroke:#4caf8a;stroke-width:3;stroke-linecap:square}.door-swing{fill:none;stroke:#4caf8a;stroke-width:1.5;stroke-dasharray:4 2}
.opening-dimension{color:#4caf8a}.opening-dimension-label{fill:#328064;font:650 9px ui-monospace,monospace;text-anchor:middle;dominant-baseline:central;paint-order:stroke;stroke:#fff;stroke-width:5px}.window-dimension{color:#2589d8}.window-dimension .opening-dimension-label{fill:#1672b8}.fixture-dimension{color:#b45309;pointer-events:none}.fixture-dimension-label{fill:currentColor;font:650 9px ui-monospace,monospace;text-anchor:middle;dominant-baseline:central;paint-order:stroke;stroke:#fff;stroke-width:5px}.window-frame{stroke:#287fb8;stroke-width:2.6;stroke-linecap:square}.window-core{stroke:#76acd0;stroke-width:1.2}.window-jamb{stroke:#287fb8}
 .vertex-layer,.full-room-highlight,.corner-connect-hit,.measurement-hit,.opening-hit,.opening-hit-area,.opening-swing-hit,.wall-interaction-line{display:none}
`;

function floorplanExportCss(style: FloorplanStyle) {
  return `${FLOORPLAN_EXPORT_BASE_CSS}\n${floorplanStyleCss(style)}`;
}

function drawFloorplanAttribution(context: CanvasRenderingContext2D, width: number, height: number) {
  const scale = width / FLOORPLAN_EXPORT_WIDTH;
  const margin = 12 * scale;
  context.save();
  context.font = `600 ${7.5 * scale}px Arial, sans-serif`;
  context.textAlign = "right";
  context.textBaseline = "bottom";
  context.lineJoin = "round";
  context.lineWidth = 3 * scale;
  context.strokeStyle = "#fff";
  context.fillStyle = "#68756f";
  context.strokeText(FLOORPLAN_EXPORT_ATTRIBUTION, width - margin, height - margin);
  context.fillText(FLOORPLAN_EXPORT_ATTRIBUTION, width - margin, height - margin);
  context.restore();
}

function floorplanPdfBlobFromJpeg(bytes: ArrayBuffer, width: number, height: number) {
  const encoder = new TextEncoder();
  const pageWidth = Math.max(72, width * 72 / 96);
  const pageHeight = Math.max(72, height * 72 / 96);
  const content = `q\n${pageWidth} 0 0 ${pageHeight} 0 0 cm\n/Im0 Do\nQ\n`;
  const attributionLinkWidth = 155;
  const attributionLinkHeight = 18;
  const attributionLinkX = Math.max(0, pageWidth - attributionLinkWidth - 8);
  const parts: Uint8Array<ArrayBuffer>[] = [];
  let length = 0;
  const push = (value: string | Uint8Array) => { const source = typeof value === "string" ? encoder.encode(value) : value; const next = new Uint8Array(source.byteLength); next.set(source); parts.push(next); length += next.byteLength; };
  const offsets: number[] = [0];
  push("%PDF-1.4\n%\xFF\xFF\xFF\xFF\n");
  const object = (id: number, body: string) => { offsets[id] = length; push(`${id} 0 obj\n${body}\nendobj\n`); };
  object(1, "<< /Type /Catalog /Pages 2 0 R >>"); object(2, "<< /Type /Pages /Kids [3 0 R] /Count 1 >>"); object(3, `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pageWidth} ${pageHeight}] /Resources << /XObject << /Im0 4 0 R >> >> /Contents 5 0 R /Annots [6 0 R] >>`);
  offsets[4] = length; push(`4 0 obj\n<< /Type /XObject /Subtype /Image /Width ${width} /Height ${height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${bytes.byteLength} >>\nstream\n`); push(new Uint8Array(bytes)); push("\nendstream\nendobj\n");
  const contentBytes = encoder.encode(content); object(5, `<< /Length ${contentBytes.length} >>\nstream\n${content}endstream`);
  object(6, `<< /Type /Annot /Subtype /Link /Rect [${attributionLinkX} 0 ${pageWidth - 8} ${attributionLinkHeight}] /Border [0 0 0] /A << /S /URI /URI (${FLOORPLAN_EXPORT_ATTRIBUTION_URL}) >> >>`);
  const xref = length;
  push("xref\n0 7\n0000000000 65535 f \n");
  for (let id = 1; id <= 6; id += 1) push(`${String(offsets[id]).padStart(10, "0")} 00000 n \n`);
  push(`trailer\n<< /Size 7 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`);
  return new Blob(parts, { type: "application/pdf" });
}

function synchronizeConnectedJunctions(baselineWalls: Wall[], candidateWalls: Wall[], squaredWalls: boolean, preferredWallId: string, detachedEndpointIndices: number[] = []): Wall[] {
  type JunctionReference = { wallId: string; pointIndex: number; point: Point2D };
  const groups: JunctionReference[][] = [];
  baselineWalls.forEach((wall) => {
    const closed = samePoint(wall.points[0], wall.points.at(-1)!);
    wall.points.slice(0, closed ? -1 : undefined).forEach((point, pointIndex) => {
      const reference = { wallId: wall.id, pointIndex, point };
      const group = groups.find((items) => samePoint(items[0].point, point));
      if (group) group.push(reference); else groups.push([reference]);
    });
  });
  const synchronized = cloneWalls(candidateWalls);
  const maximumPasses = baselineWalls.reduce((total, wall) => total + wall.points.length, 0) + 1;
  for (let pass = 0; pass < maximumPasses; pass += 1) {
    let updated = false;
    for (const group of groups) {
      // A separate wall which terminates at the endpoint of a translated segment
      // must remain at its original junction. The bridge-repair pass will join it
      // to the moved endpoint. Pulling it along here would stretch that wall and
      // leave the room graph open instead of creating the required return wall.
      if (group.some((reference) => reference.wallId === preferredWallId && detachedEndpointIndices.includes(reference.pointIndex))) continue;
      const changed = group.flatMap((reference) => {
        const wall = synchronized.find((item) => item.id === reference.wallId);
        const point = wall?.points[reference.pointIndex];
        if (!point || samePoint(point, reference.point, .001)) return [];
        return [{ reference, point, distance: Math.hypot(point.x - reference.point.x, point.y - reference.point.y) }];
      }).sort((first, second) => Number(second.reference.wallId === preferredWallId) - Number(first.reference.wallId === preferredWallId) || second.distance - first.distance);
      if (!changed.length) continue;
      const target = changed[0].point;
      for (const reference of group) {
        const wallIndex = synchronized.findIndex((item) => item.id === reference.wallId);
        if (wallIndex < 0 || samePoint(synchronized[wallIndex].points[reference.pointIndex], target, .001)) continue;
        const wall = synchronized[wallIndex];
        const closed = samePoint(wall.points[0], wall.points.at(-1)!);
        const points = squaredWalls ? moveSquaredWallPoint(wall.points, reference.pointIndex, target) : wall.points.map((point, pointIndex) => pointIndex === reference.pointIndex ? { ...target } : { ...point });
        if (!squaredWalls && closed && reference.pointIndex === 0) points[points.length - 1] = { ...target };
        synchronized[wallIndex] = { ...wall, points };
        updated = true;
      }
    }
    if (!updated) break;
  }
  return synchronized;
}

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
const wallLengthForSegment = (wall: Wall, index: number) => wall.lengthOverridesMm?.[index] ?? segmentLength(wall, index);
const parentKey = (wallId: string, segmentIndex: number) => `${wallId}::${segmentIndex}`;

function redundantHeightDimensionIds(walls: Wall[], roomCount: number): Set<string> {
  if (roomCount < 2) return new Set();
  const tolerance = 1;
  const vertical = walls.flatMap((wall) => wall.points.slice(0, -1).flatMap((start, segmentIndex) => {
    const end = wall.points[segmentIndex + 1];
    if (!end || wall.lengthOverridesMm?.[segmentIndex] !== undefined || Math.abs(end.x - start.x) > tolerance || Math.abs(end.y - start.y) <= tolerance) return [];
    return [{ id: `${wall.id}:${segmentIndex}`, x: start.x, minY: Math.min(start.y, end.y), maxY: Math.max(start.y, end.y) }];
  }));
  const horizontal = walls.flatMap((wall) => wall.points.slice(0, -1).flatMap((start, segmentIndex) => {
    const end = wall.points[segmentIndex + 1];
    if (!end || Math.abs(end.y - start.y) > tolerance || Math.abs(end.x - start.x) <= tolerance) return [];
    return [{ y: start.y, minX: Math.min(start.x, end.x), maxX: Math.max(start.x, end.x) }];
  }));
  const parent = new Map(vertical.map((segment) => [segment.id, segment.id]));
  const find = (id: string): string => {
    const root = parent.get(id);
    if (!root || root === id) return id;
    const resolved = find(root); parent.set(id, resolved); return resolved;
  };
  const join = (first: string, second: string) => { const firstRoot = find(first); const secondRoot = find(second); if (firstRoot !== secondRoot) parent.set(secondRoot, firstRoot); };
  const sameSpan = (first: typeof vertical[number], second: typeof vertical[number]) => Math.abs(first.minY - second.minY) <= tolerance && Math.abs(first.maxY - second.maxY) <= tolerance;
  const bridged = (first: typeof vertical[number], second: typeof vertical[number]) => horizontal.some((segment) => {
    const minX = Math.min(first.x, second.x); const maxX = Math.max(first.x, second.x);
    return (Math.abs(segment.y - first.minY) <= tolerance || Math.abs(segment.y - first.maxY) <= tolerance) && segment.minX <= minX + tolerance && segment.maxX >= maxX - tolerance;
  });
  for (let firstIndex = 0; firstIndex < vertical.length; firstIndex += 1) {
    for (let secondIndex = firstIndex + 1; secondIndex < vertical.length; secondIndex += 1) {
      if (sameSpan(vertical[firstIndex], vertical[secondIndex]) && bridged(vertical[firstIndex], vertical[secondIndex])) join(vertical[firstIndex].id, vertical[secondIndex].id);
    }
  }
  const groups = new Map<string, typeof vertical>();
  vertical.forEach((segment) => { const root = find(segment.id); groups.set(root, [...(groups.get(root) ?? []), segment]); });
  return new Set([...groups.values()].flatMap((group) => group.sort((first, second) => first.x - second.x).slice(1).map((segment) => segment.id)));
}

function assignStableCornerNumbers(walls: Wall[], fallbackStarts = new Map<string, number>()): Wall[] {
  let nextNumber = Math.max(0, ...walls.flatMap((wall) => Object.values(wall.cornerNumbers ?? {}))) + 1;
  return walls.map((wall) => {
    const closed = samePoint(wall.points[0], wall.points.at(-1)!);
    const lastUniqueIndex = wall.points.length - (closed ? 1 : 0);
    const numbers = { ...wall.cornerNumbers };
    const fallbackStart = fallbackStarts.get(wall.id);
    let visibleIndex = 0;
    for (let pointIndex = 0; pointIndex < lastUniqueIndex; pointIndex += 1) {
      if (wall.attachments?.[pointIndex]?.hideCorner) continue;
      if (numbers[pointIndex] === undefined) numbers[pointIndex] = fallbackStart === undefined ? nextNumber++ : fallbackStart + visibleIndex;
      visibleIndex += 1;
    }
    return { ...wall, cornerNumbers: numbers };
  });
}

function remapSnapshotForMaterializedSelection(snapshot: Snapshot, materialized: MaterializedWallSelection): Snapshot {
  if (!materialized.splitAlong.length) return snapshot;
  const sourceWall = snapshot.walls.find((wall) => wall.id === materialized.wallId);
  if (!sourceWall) return { ...snapshot, walls: materialized.walls as Wall[] };
  const wallId = sourceWall.id;
  const sourceSegmentIndex = materialized.sourceSegmentIndex;
  const insertedCount = materialized.splitAlong.length;
  const sourceStart = sourceWall.points[sourceSegmentIndex];
  const sourceEnd = sourceWall.points[sourceSegmentIndex + 1];
  const sourceLength = Math.hypot(sourceEnd.x - sourceStart.x, sourceEnd.y - sourceStart.y) || 1;
  const boundaries = [0, ...materialized.splitAlong, 1];
  const remapSegment = (segmentIndex: number, along = .5) => {
    if (segmentIndex < sourceSegmentIndex) return { segmentIndex, along };
    if (segmentIndex > sourceSegmentIndex) return { segmentIndex: segmentIndex + insertedCount, along };
    const subsegment = Math.max(0, Math.min(boundaries.length - 2, boundaries.findIndex((_, index) => index < boundaries.length - 1 && along <= boundaries[index + 1] + 1e-6)));
    return { segmentIndex: sourceSegmentIndex + subsegment, along: (along - boundaries[subsegment]) / (boundaries[subsegment + 1] - boundaries[subsegment]) };
  };
  const remapReference = (reference: MeasurementReference): MeasurementReference => {
    if (reference.wallId !== wallId) return { ...reference };
    if (reference.kind === "POINT") return { ...reference, pointIndex: reference.pointIndex > sourceSegmentIndex ? reference.pointIndex + insertedCount : reference.pointIndex };
    return { ...reference, segmentIndex: reference.segmentIndex === sourceSegmentIndex ? materialized.segmentIndex : remapSegment(reference.segmentIndex).segmentIndex };
  };
  const remapDimensionId = (id: string) => {
    const separator = id.lastIndexOf(":");
    if (separator < 0 || id.slice(0, separator) !== wallId) return [id];
    const segmentIndex = Number(id.slice(separator + 1));
    if (segmentIndex !== sourceSegmentIndex) return [`${wallId}:${remapSegment(segmentIndex).segmentIndex}`];
    return boundaries.slice(0, -1).map((_, index) => `${wallId}:${sourceSegmentIndex + index}`);
  };
  return {
    ...snapshot,
    walls: materialized.walls as Wall[],
    openings: snapshot.openings.map((opening) => {
      if (opening.wallId !== wallId) return { ...opening };
      const mapped = remapSegment(opening.segmentIndex, opening.segmentIndex === sourceSegmentIndex ? (opening.offset + opening.width / 2) / sourceLength : .5);
      return { ...opening, segmentIndex: mapped.segmentIndex, offset: opening.segmentIndex === sourceSegmentIndex ? opening.offset - boundaries[mapped.segmentIndex - sourceSegmentIndex] * sourceLength : opening.offset };
    }),
    measurements: snapshot.measurements.map((measurement) => ({ ...measurement, first: remapReference(measurement.first), second: remapReference(measurement.second) })),
    dimensionOffsets: Object.fromEntries(Object.entries(snapshot.dimensionOffsets).flatMap(([id, offset]) => remapDimensionId(id).map((nextId) => [nextId, offset]))),
    hiddenDimensions: snapshot.hiddenDimensions.flatMap(remapDimensionId),
  };
}

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

function orthogonalIntersectionOnSegment(from: Point2D, requested: Point2D, start: Point2D, end: Point2D): Point2D | null {
  const dx = end.x - start.x; const dy = end.y - start.y;
  const candidates: Point2D[] = [];
  if (Math.abs(dy) > 1e-9) {
    const along = (from.y - start.y) / dy;
    if (along >= 0 && along <= 1) candidates.push({ x: start.x + dx * along, y: from.y });
  }
  if (Math.abs(dx) > 1e-9) {
    const along = (from.x - start.x) / dx;
    if (along >= 0 && along <= 1) candidates.push({ x: from.x, y: start.y + dy * along });
  }
  return candidates.sort((first, second) => Math.hypot(first.x - requested.x, first.y - requested.y) - Math.hypot(second.x - requested.x, second.y - requested.y))[0] ?? null;
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

function hasPerpendicularConnectedLeg(points: Point2D[], index: number, hostStart: Point2D, hostEnd: Point2D): boolean {
  const closed = points.length > 2 && samePoint(points[0], points.at(-1)!);
  const core = closed ? points.slice(0, -1) : points;
  const point = core[index];
  const hostLength = Math.hypot(hostEnd.x - hostStart.x, hostEnd.y - hostStart.y);
  if (!point || !hostLength) return false;
  const hostDirection = { x: (hostEnd.x - hostStart.x) / hostLength, y: (hostEnd.y - hostStart.y) / hostLength };
  const neighbours = [
    ...(index > 0 || closed ? [core[(index - 1 + core.length) % core.length]] : []),
    ...(index < core.length - 1 || closed ? [core[(index + 1) % core.length]] : []),
  ];
  return neighbours.some((neighbour) => {
    const length = Math.hypot(neighbour.x - point.x, neighbour.y - point.y);
    if (!length) return false;
    const alignment = Math.abs(((neighbour.x - point.x) / length) * hostDirection.x + ((neighbour.y - point.y) / length) * hostDirection.y);
    return alignment < .995;
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
  const available = current.map((room, index) => ({ ...room, colourIndex: room.colourIndex ?? index % 6 }));
  const sourceIdsFor = (room: NamedOutline) => new Set([...(room.sourceWallIds ?? []), room.sourceWallId].filter(Boolean));
  const currentSources = current.map(sourceIdsFor);
  const detectedSources = detected.map(sourceIdsFor);
  const assignedCurrent = new Set<number>();
  const assignedDetected = new Set<number>();
  const matches = new Map<number, number>();
  const centreDistance = (first: NamedOutline, second: NamedOutline) => {
    const firstCentre = roomCentre(first); const secondCentre = roomCentre(second);
    return Math.hypot(firstCentre.x - secondCentre.x, firstCentre.y - secondCentre.y);
  };
  // Prefer an exact source-wall-set match. A new exterior room shares its
  // selected wall with the existing room, so a loose first-match can otherwise
  // steal the existing room's name and make the old room appear renamed.
  const exactPairs: Array<{ currentIndex: number; detectedIndex: number; distance: number }> = [];
  currentSources.forEach((sources, currentIndex) => detectedSources.forEach((candidateSources, detectedIndex) => {
    if (sources.size === 0 || sources.size !== candidateSources.size || [...sources].some((source) => !candidateSources.has(source))) return;
    exactPairs.push({ currentIndex, detectedIndex, distance: centreDistance(current[currentIndex], detected[detectedIndex]) });
  }));
  exactPairs.sort((first, second) => first.distance - second.distance);
  exactPairs.forEach(({ currentIndex, detectedIndex }) => {
    if (assignedCurrent.has(currentIndex) || assignedDetected.has(detectedIndex)) return;
    assignedCurrent.add(currentIndex); assignedDetected.add(detectedIndex); matches.set(detectedIndex, currentIndex);
  });
  // If a wall edit changes the source set, retain the closest one-to-one
  // source-wall match before treating a detected room as genuinely new.
  const overlapPairs: Array<{ currentIndex: number; detectedIndex: number; overlap: number; distance: number }> = [];
  currentSources.forEach((sources, currentIndex) => detectedSources.forEach((candidateSources, detectedIndex) => {
    if (assignedCurrent.has(currentIndex) || assignedDetected.has(detectedIndex)) return;
    const overlap = [...sources].filter((source) => candidateSources.has(source)).length;
    if (!overlap) return;
    overlapPairs.push({ currentIndex, detectedIndex, overlap, distance: centreDistance(current[currentIndex], detected[detectedIndex]) });
  }));
  overlapPairs.sort((first, second) => second.overlap - first.overlap || first.distance - second.distance);
  overlapPairs.forEach(({ currentIndex, detectedIndex }) => {
    if (assignedCurrent.has(currentIndex) || assignedDetected.has(detectedIndex)) return;
    assignedCurrent.add(currentIndex); assignedDetected.add(detectedIndex); matches.set(detectedIndex, currentIndex);
  });
  const usedNames = new Set(current.map((room) => room.name.trim().toLowerCase()));
  const usedColours = new Set(available.map((room) => room.colourIndex));
  let nextRoomNumber = Math.max(0, ...current.map((room) => Number(room.name.match(/^Room\s+(\d+)$/i)?.[1] ?? 0))) + 1;
  let nextColour = 0;
  const nextName = () => {
    while (usedNames.has(`room ${nextRoomNumber}`)) nextRoomNumber += 1;
    const name = `Room ${nextRoomNumber}`; usedNames.add(name.toLowerCase()); nextRoomNumber += 1; return name;
  };
  const nextColourIndex = () => {
    for (let attempt = 0; attempt < 6; attempt += 1) {
      const colour = (nextColour + attempt) % 6;
      if (!usedColours.has(colour)) { usedColours.add(colour); nextColour = colour + 1; return colour; }
    }
    const colour = nextColour % 6; nextColour += 1; return colour;
  };
  return detected.map((room, detectedIndex) => {
    const currentIndex = matches.get(detectedIndex);
    const match = currentIndex === undefined ? null : available[currentIndex];
    if (!match) return { ...room, id: crypto.randomUUID(), name: nextName(), colourIndex: nextColourIndex() };
    return { ...room, id: match.id, name: match.name, colourIndex: match.colourIndex };
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
    return [{ id: opening.id, kind: opening.kind, parent_wall_id: `wall-${String(edge.index + 1).padStart(3, "0")}`, offset_mm: Math.max(0, offset), width: measurement(opening.width), height: measurement(opening.height), sill_height_mm: opening.kind === "WINDOW" ? opening.sill : 0, ...(opening.kind === "DOOR" ? { hinge_side: opening.hingeSide, door_type: opening.doorType, swing_angle_deg: 90, opens_inward: opening.opensInward } : {}), ...(opening.catalogueItemId ? { metadata: { catalogue_item_id: opening.catalogueItemId } } : {}) }];
  });
}

function roomWallThicknessOverrides(room: NamedOutline, walls: Wall[], defaultThicknessMm: number): Record<string, number> {
  const toleranceMm = 1;
  const overrides: Record<string, number> = {};
  room.vertices.forEach((start, roomEdgeIndex) => {
    const end = room.vertices[(roomEdgeIndex + 1) % room.vertices.length];
    const source = walls.flatMap((wall) => wall.points.slice(0, -1).map((segmentStart, segmentIndex) => ({ wall, segmentIndex, segmentStart, segmentEnd: wall.points[segmentIndex + 1] })))
      .find((segment) => {
        const startProjection = pointOnSegment(start, segment.segmentStart, segment.segmentEnd);
        const endProjection = pointOnSegment(end, segment.segmentStart, segment.segmentEnd);
        return Math.hypot(start.x - startProjection.point.x, start.y - startProjection.point.y) <= toleranceMm
          && Math.hypot(end.x - endProjection.point.x, end.y - endProjection.point.y) <= toleranceMm;
      });
    if (!source) return;
    const thicknessMm = wallThicknessForSegment(source.wall, source.segmentIndex, defaultThicknessMm);
    if (Math.abs(thicknessMm - defaultThicknessMm) > 1e-6) overrides[`wall-${String(roomEdgeIndex + 1).padStart(3, "0")}`] = thicknessMm;
  });
  return overrides;
}

export function FullFloorplanEditor({ projectRooms = [], onPlanRoomChange, onPlanRoomsChange, apiUrl, displayUnits, floorplanStyle, exportRequest, importFile, activeSourceRoomId, fixtures: currentFixtures = [], onFixturesChange: currentOnFixturesChange, toolbarVisibility, onToggleToolbar, toolbarLayoutResetKey, fillToolbarLayout }: Props) {
  const [walls, setWalls] = useState<Wall[]>([]);
  const [openings, setOpenings] = useState<FullOpening[]>([]);
  const [history, setHistory] = useState<Snapshot[]>([]);
  const [future, setFuture] = useState<Snapshot[]>([]);
  const [draft, setDraft] = useState<Point2D[]>([]);
  const [tool, setTool] = useState<Tool>("SELECT");
  const [lShapePickerOpen, setLShapePickerOpen] = useState(false);
  const [pendingOutlineAction, setPendingOutlineAction] = useState<PendingOutlineAction | null>(null);
  const [pendingRoomRemovalId, setPendingRoomRemovalId] = useState<string | null>(null);
  const [snapEnabled, setSnapEnabled] = useState(true);
  const [snapSize, setSnapSize] = useState(DEFAULT_SNAP_MM);
  const [squaredWalls, setSquaredWalls] = useState(false);
  const [wallHeight, setWallHeight] = useState(2400);
  const [wallThickness, setWallThickness] = useState(DEFAULT_WALL_THICKNESS_MM);
  const [zoom, setZoom] = useState(1);
  const [showGrid, setShowGrid] = useState(true);
  const [showWallThickness, setShowWallThickness] = useState(true);
  const [pan, setPan] = useState<Point2D>({ x: 0, y: 0 });
  const [selectedSegment, setSelectedSegment] = useState<SegmentSelection | null>(null);
  const [selectedPoint, setSelectedPoint] = useState<PointSelection | null>(null);
  const [hoveredCorner, setHoveredCorner] = useState<PointSelection | null>(null);
  const [hoveredSegment, setHoveredSegment] = useState<SegmentSelection | null>(null);
  const [wallLengthInput, setWallLengthInput] = useState<number | null>(null);
  const [wallThicknessInput, setWallThicknessInput] = useState<{ key: string; value: number } | null>(null);
  const [defaultWallThicknessInput, setDefaultWallThicknessInput] = useState<number | null>(null);
  const [showMeasurements, setShowMeasurements] = useState(true);
  const [showDoorWindowMeasurements, setShowDoorWindowMeasurements] = useState(true);
  const [showElementMeasurements, setShowElementMeasurements] = useState(true);
  const [addRoomPanelOpen, setAddRoomPanelOpen] = useState(false);
  const [roomDepthInput, setRoomDepthInput] = useState(2000);
  const [roomActionError, setRoomActionError] = useState<string | null>(null);
  const [measurementLengthInput, setMeasurementLengthInput] = useState<number | null>(null);
  const [sourceFile, setSourceFile] = useState<File | null>(null);
  const [sourceUrl, setSourceUrl] = useState<string | null>(null);
  const [canvasSize, setCanvasSize] = useState(DEFAULT_SIZE);
  const [importing, setImporting] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);
  const [rooms, setRooms] = useState<NamedOutline[]>([]);
  const [selectedRoomId, setSelectedRoomId] = useState<string | null>(null);
  const [elementTab, setElementTab] = useState<"DOOR" | "WINDOW" | "FURNITURE">("DOOR");
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
  const [openingCatalogueItems, setOpeningCatalogueItems] = useState<CatalogueItem[]>([]);
  const [openingCatalogueError, setOpeningCatalogueError] = useState<string | null>(null);
  const [openingCatalogueId, setOpeningCatalogueId] = useState("");
  const [measurements, setMeasurements] = useState<CustomMeasurement[]>([]);
  const [dimensionOffsets, setDimensionOffsets] = useState<Record<string, number>>({});
  const [hiddenDimensions, setHiddenDimensions] = useState<string[]>([]);
  const [measurementDraft, setMeasurementDraft] = useState<MeasurementReference[]>([]);
  const [selectedMeasurement, setSelectedMeasurement] = useState<string | null>(null);
  const [measurementEditEnabled, setMeasurementEditEnabled] = useState(false);
  const [showRoomNames, setShowRoomNames] = useState(true);
  const [contextMenu, setContextMenu] = useState<GeometryContextMenu | null>(null);
  const [measurementContextMenu, setMeasurementContextMenu] = useState<MeasurementContextMenu | null>(null);
  const [openingContextMenu, setOpeningContextMenu] = useState<OpeningContextMenu | null>(null);
  const [openingMeasurementContextMenu, setOpeningMeasurementContextMenu] = useState<OpeningMeasurementContextMenu | null>(null);
  const [openingMeasurementValueInput, setOpeningMeasurementValueInput] = useState<number | null>(null);
  const [openingMeasurementError, setOpeningMeasurementError] = useState<string | null>(null);
  const [fixtureContextMenu, setFixtureContextMenu] = useState<FixtureContextMenu | null>(null);
  const [fixtureMeasurementContextMenu, setFixtureMeasurementContextMenu] = useState<FixtureMeasurementContextMenu | null>(null);
  const [fixtureMeasurementValueInput, setFixtureMeasurementValueInput] = useState<number | null>(null);
  const [fixtureMeasurementError, setFixtureMeasurementError] = useState<string | null>(null);
  const [toolbarContextMenu, setToolbarContextMenu] = useState<{ x: number; y: number } | null>(null);
  const [exportOpen, setExportOpen] = useState(false);
  const [exportStyle, setExportStyle] = useState<ExportStyle>("CURRENT");
  const [exportFormat, setExportFormat] = useState<ExportFormat>("PDF");
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);
  const [restored, setRestored] = useState(false);
  const [lockedViewport, setLockedViewport] = useState<FloorPlanViewport | null>(null);
  const editorRoot = useRef<HTMLElement>(null);
  const coordinateRowRefs = useRef<Map<string, HTMLDivElement>>(new Map());
  const pointDrag = useRef<{ selection: PointSelection; before: Snapshot } | null>(null);
  const wallDrag = useRef<WallDrag | null>(null);
  const draftStartAttachment = useRef<WallAttachment | null>(null);
  const openingDrag = useRef<{ openingId: string; before: Snapshot } | null>(null);
  const measurementDrag = useRef<{ id: string; custom: boolean; pointerStart: Point2D; offset: number; normal: Point2D; before: Snapshot } | null>(null);
  const panDrag = useRef<{ clientX: number; clientY: number; pan: Point2D } | null>(null);
  const fixtureDrag = useRef<{ id: string; before: Point2D } | null>(null);
  const backgroundImportId = useRef(0);

  useEffect(() => {
    const controller = new AbortController();
    const refresh = () => {
      void fetch(`${apiUrl}/catalog/items`, { signal: controller.signal, cache: "no-store" })
        .then((response) => response.ok ? response.json() as Promise<CatalogueItem[]> : Promise.reject(new Error("Object catalogue is unavailable.")))
        .then((records) => {
          setOpeningCatalogueItems(records.filter((item) => item.fixture_kind === "DOOR" || item.fixture_kind === "WINDOW"));
          setOpeningCatalogueError(null);
        })
        .catch((reason) => { if (!controller.signal.aborted) setOpeningCatalogueError(reason instanceof Error ? reason.message : "Object catalogue is unavailable."); });
    };
    refresh();
    window.addEventListener("focus", refresh);
    window.addEventListener("catalogue-changed", refresh);
    return () => { controller.abort(); window.removeEventListener("focus", refresh); window.removeEventListener("catalogue-changed", refresh); };
  }, [apiUrl]);

  function setWallsRespectingMeasurements(next: Wall[] | ((current: Wall[]) => Wall[]), preserveOrthogonal = squaredWalls, keepProposedOnConflict = false) {
    setWalls((current) => {
      const proposed = typeof next === "function" ? next(current) : next;
      const enforced = preserveOrthogonal
        ? enforceWallLengthOverridesPreservingOrthogonality(proposed)
        : enforceWallLengthOverrides(proposed);
      if (enforced === null) return keepProposedOnConflict ? proposed : current;
      const nextWalls = enforced as Wall[];
      return JSON.stringify(current) === JSON.stringify(nextWalls) ? current : nextWalls;
    });
  }

  const selectedRoom = useMemo(() => rooms.find((room) => room.id === selectedRoomId) ?? rooms[0] ?? null, [rooms, selectedRoomId]);
  const storedRoom = projectRooms.find(room => room.source_floorplan_room_id === selectedRoom?.id);
  const fixtures = storedRoom?.obstacles ?? (selectedRoom?.id === activeSourceRoomId ? currentFixtures : []);
  const visibleFixtures = [...projectRooms.filter(room => rooms.some(outline => outline.id === room.source_floorplan_room_id) && room.source_floorplan_room_id !== selectedRoom?.id).flatMap(room => room.obstacles), ...fixtures];
  const openingCatalogueForKind = useMemo(() => openingCatalogueItems.filter((item) => item.fixture_kind === openingKind), [openingCatalogueItems, openingKind]);
  const activeOpeningCatalogueItem = openingCatalogueForKind.find((item) => item.id === openingCatalogueId)
    ?? openingCatalogueForKind.find((item) => item.is_default)
    ?? openingCatalogueForKind[0];
  function defaultOpeningCatalogueItem(kind: "DOOR" | "WINDOW") {
    return openingCatalogueItems.find((item) => item.fixture_kind === kind && item.is_default)
      ?? openingCatalogueItems.find((item) => item.fixture_kind === kind);
  }
  function catalogueItemForOpening(opening: FullOpening) {
    return opening.catalogueItemId ? openingCatalogueItems.find((item) => item.id === opening.catalogueItemId) : undefined;
  }
  function applyOpeningCatalogueItem(item?: CatalogueItem) {
    if (!item || (item.fixture_kind !== "DOOR" && item.fixture_kind !== "WINDOW")) return;
    setOpeningCatalogueId(item.id);
    setOpeningWidth(item.width_mm);
    setOpeningHeight(item.height_mm);
    if (item.fixture_kind === "WINDOW") setWindowSill(Math.min(1200, Math.max(0, item.height_mm)) || 900);
    if (item.fixture_kind === "DOOR") setDoorType(item.subcategory.toLowerCase().includes("double") ? "DOUBLE" : "SINGLE");
  }
  function selectOpeningKind(kind: "DOOR" | "WINDOW") {
    setElementTab(kind);
    setOpeningKind(kind);
    const item = defaultOpeningCatalogueItem(kind);
    if (item) applyOpeningCatalogueItem(item);
    else {
      setOpeningCatalogueId("");
      setOpeningWidth(800);
      setOpeningHeight(kind === "DOOR" ? 2040 : 900);
      if (kind === "WINDOW") setWindowSill(900);
      if (kind === "DOOR") setDoorType("SINGLE");
    }
  }
  function windowPaneCountFor(opening: FullOpening) {
    const item = catalogueItemForOpening(opening);
    const label = `${item?.subcategory ?? ""} ${item?.name ?? ""} ${item?.representation_key ?? ""}`.toLowerCase();
    return label.includes("triple") ? 3 : label.includes("double") ? 2 : 1;
  }
  const roomDraftForOutline = useCallback((outline: NamedOutline): Room => {
    const stored = projectRooms.find(room => room.source_floorplan_room_id === outline.id);
    const normalized = { ...outline, vertices: counterClockwiseVertices(outline.vertices) };
    return {
      id: stored?.id ?? outline.id,
      source_floorplan_room_id: outline.id,
      name: normalized.name,
      version: stored?.version ?? 1,
      vertices: normalized.vertices,
      wall_height: { value: wallHeight, uncertainty_mm: 5, verified: false, source_type: "USER_MEASURED" },
      wall_thickness: { value: wallThickness, uncertainty_mm: 5, verified: false, source_type: "USER_MEASURED" },
      wall_thickness_overrides_mm: roomWallThicknessOverrides(normalized, walls, wallThickness),
      openings: roomOpenings(normalized, openings, walls),
      obstacles: stored?.obstacles ?? (outline.id === activeSourceRoomId ? currentFixtures : []),
      person_mockup: stored?.person_mockup ?? null,
      finishes: stored?.finishes,
    };
  }, [activeSourceRoomId, currentFixtures, openings, projectRooms, wallHeight, wallThickness, walls]);
  const planRooms = useMemo(() => rooms.map(roomDraftForOutline), [roomDraftForOutline, rooms]);
  const planRoomsSignature = useMemo(() => JSON.stringify(planRooms), [planRooms]);
  const publishedPlanRooms = useRef("");
  const publishPlanRooms = useEffectEvent((next: Room[]) => onPlanRoomsChange?.(next));
  useEffect(() => {
    if (!restored || publishedPlanRooms.current === planRoomsSignature) return;
    publishedPlanRooms.current = planRoomsSignature;
    publishPlanRooms(planRooms);
  }, [planRooms, planRoomsSignature, restored]);
  function onFixturesChange(next: Obstacle[]) {
    const draft = selectedRoomDraft();
    if (draft && onPlanRoomChange) onPlanRoomChange({ ...draft, ...storedRoom, id: storedRoom?.id ?? draft.id, source_floorplan_room_id: selectedRoom!.id, vertices: draft.vertices, openings: draft.openings, obstacles: next, version: (storedRoom?.version ?? 0) + 1 });
    else currentOnFixturesChange?.(next);
  }
  const segmentOptions = useMemo(() => walls.flatMap((wall, wallIndex) => wall.points.slice(0, -1).map((_, segmentIndex) => ({ key: parentKey(wall.id, segmentIndex), label: `Wall ${wallIndex + 1}.${segmentIndex + 1}`, wall, segmentIndex }))), [walls]);
  const selectedWall = selectedSegment ? walls.find((wall) => wall.id === selectedSegment.wallId) ?? null : null;
  const selectedPointWall = selectedPoint ? walls.find((wall) => wall.id === selectedPoint.wallId) ?? null : null;
  const selectedPointValue = selectedPointWall && selectedPoint ? selectedPointWall.points[selectedPoint.pointIndex] : null;
  const detectedRooms = useMemo(() => detectClosedRooms(walls), [walls]);
  const wallVertexStarts = useMemo(() => {
    const starts = new Map<string, number>(); let next = 1;
    walls.forEach((wall) => { starts.set(wall.id, next); next += wall.points.slice(0, samePoint(wall.points[0], wall.points.at(-1)!) ? -1 : undefined).filter((_, index) => !wall.attachments?.[index]?.hideCorner).length; });
    return starts;
  }, [walls]);
  const coordinateEntries = walls.flatMap((wall) => {
    const closed = samePoint(wall.points[0], wall.points.at(-1)!);
    const points = wall.points.slice(0, closed ? -1 : undefined);
    const start = wallVertexStarts.get(wall.id) ?? 1;
    return points.map((point, pointIndex) => ({ point, pointIndex })).filter(({ pointIndex }) => !wall.attachments?.[pointIndex]?.hideCorner).map(({ point, pointIndex }, visibleIndex) => ({ wall, point, pointIndex, cornerNumber: wall.cornerNumbers?.[pointIndex] ?? start + visibleIndex }));
  });
  const coordinatesToolbarOpen = toolbarVisibility["floorplan-coordinates"];
  useEffect(() => {
    if (!coordinatesToolbarOpen || !selectedPoint) return;
    coordinateRowRefs.current.get(`${selectedPoint.wallId}:${selectedPoint.pointIndex}`)?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [coordinatesToolbarOpen, selectedPoint]);
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
  const actualGridSizeMm = Number.isFinite(snapSize) && snapSize > 0 ? snapSize : DEFAULT_SNAP_MM;
  const gridOrigin = toScreen({ x: 0, y: 0 });
  const gridSpacing = actualGridSizeMm * activeViewport.scale;
  const zoomWithWheel = (event: ReactWheelEvent<SVGSVGElement>) => {
    event.preventDefault();
    if (event.deltaY === 0) return;
    const factor = event.deltaY > 0 ? 0.9 : 1.1;
    setZoom((current) => Math.max(.5, Math.min(3, current * factor)));
  };

  useEffect(() => () => { if (sourceUrl) URL.revokeObjectURL(sourceUrl); }, [sourceUrl]);

  useEffect(() => { if (exportRequest > 0) queueMicrotask(() => { setExportError(null); setExportOpen(true); }); }, [exportRequest]);
  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const saved = JSON.parse(raw) as PersistedFloorplan;
        const savedSquaredWalls = saved.squaredWalls ?? false;
        const savedWalls = cloneWalls(saved.walls ?? []);
        setWallsRespectingMeasurements(savedSquaredWalls ? savedWalls.map((wall) => ({ ...wall, points: squareWallPoints(wall.points) })) : savedWalls, savedSquaredWalls, savedSquaredWalls);
        setOpenings(cloneOpenings(saved.openings ?? []));
        setMeasurements(cloneMeasurements(saved.measurements ?? [])); setDimensionOffsets(saved.dimensionOffsets ?? {}); setHiddenDimensions(saved.hiddenDimensions ?? []);
        setCanvasSize(saved.canvasSize ?? DEFAULT_SIZE);
        setRooms(saved.rooms ?? []); setSelectedRoomId(saved.selectedRoomId ?? null);
        setSnapEnabled(saved.snapEnabled ?? true); setSnapSize(saved.snapSize ?? DEFAULT_SNAP_MM); setSquaredWalls(savedSquaredWalls); setWallHeight(saved.wallHeight ?? 2400); setWallThickness(saved.wallThickness ?? DEFAULT_WALL_THICKNESS_MM);
      }
    } catch { /* Ignore a damaged browser draft and start clean. */ }
    setRestored(true);
  // This is a mount-only restore; re-running it when the setter closure changes would overwrite edits.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    if (!restored) return;
    const value: PersistedFloorplan = { walls, openings, measurements, dimensionOffsets, hiddenDimensions, canvasSize, rooms, selectedRoomId, snapEnabled, snapSize, squaredWalls, wallHeight, wallThickness };
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(value));
  }, [canvasSize, dimensionOffsets, hiddenDimensions, measurements, openings, restored, rooms, selectedRoomId, snapEnabled, snapSize, squaredWalls, wallHeight, wallThickness, walls]);

  useEffect(() => {
    if (!restored) return;
    setRooms((current) => reconcileRooms(current, detectedRooms));
  }, [detectedRooms, restored]);

  useEffect(() => {
    setSelectedRoomId((current) => rooms.some((room) => room.id === current) ? current : rooms[0]?.id ?? null);
  }, [rooms]);
  /* eslint-enable react-hooks/set-state-in-effect */

  const commitActiveDraft = useEffectEvent(() => commitDraft());
  const undoLastOperation = useEffectEvent(() => undo());
  const redoLastOperation = useEffectEvent(() => redo());
  useEffect(() => {
    const finishActiveTool = (event: KeyboardEvent) => {
      if (!editorRoot.current || editorRoot.current.closest("[hidden]")) return;
      if (!event.repeat && !event.shiftKey && !event.altKey && (event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "z") {
        event.preventDefault();
        undoLastOperation();
        return;
      }
      if (!event.repeat && !event.shiftKey && !event.altKey && (event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "y") {
        event.preventDefault();
        redoLastOperation();
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
    if (!contextMenu && !measurementContextMenu && !openingContextMenu && !openingMeasurementContextMenu && !fixtureContextMenu && !fixtureMeasurementContextMenu && !toolbarContextMenu) return;
    const dismiss = (event: PointerEvent) => {
      const target = event.target;
      if (target instanceof Element && target.closest(".floorplan-context-menu")) return;
      if (target instanceof Element && target.closest(".toolbar-context-menu")) return;
      if (target instanceof Element && target.closest(".measurement-context-target")) return;
      setContextMenu(null);
      setMeasurementContextMenu(null);
      setOpeningContextMenu(null);
      setOpeningMeasurementContextMenu(null);
      setFixtureContextMenu(null);
      setFixtureMeasurementContextMenu(null);
      setFixtureMeasurementValueInput(null);
      setFixtureMeasurementError(null);
      setToolbarContextMenu(null);
      setSelectedMeasurement(null);
    };
    const dismissWithKeyboard = (event: KeyboardEvent) => {
      if (event.key !== "Escape" && event.key !== "Enter" && event.key !== "Return") return;
      event.preventDefault();
      setContextMenu(null); setMeasurementContextMenu(null); setOpeningContextMenu(null); setOpeningMeasurementContextMenu(null); setFixtureContextMenu(null); setFixtureMeasurementContextMenu(null); setFixtureMeasurementValueInput(null); setFixtureMeasurementError(null); setToolbarContextMenu(null); setSelectedMeasurement(null);
    };
    const dismissOnBlur = () => { setContextMenu(null); setMeasurementContextMenu(null); setOpeningContextMenu(null); setOpeningMeasurementContextMenu(null); setFixtureContextMenu(null); setFixtureMeasurementContextMenu(null); setFixtureMeasurementValueInput(null); setFixtureMeasurementError(null); setToolbarContextMenu(null); setSelectedMeasurement(null); };
    window.addEventListener("pointerdown", dismiss);
    window.addEventListener("keydown", dismissWithKeyboard);
    window.addEventListener("blur", dismissOnBlur);
    return () => {
      window.removeEventListener("pointerdown", dismiss);
      window.removeEventListener("keydown", dismissWithKeyboard);
      window.removeEventListener("blur", dismissOnBlur);
    };
  }, [contextMenu, fixtureContextMenu, fixtureMeasurementContextMenu, measurementContextMenu, openingContextMenu, openingMeasurementContextMenu, toolbarContextMenu]);

  function snapshot(): Snapshot { return { wallThickness, rooms: rooms.map((room) => ({ ...room, vertices: room.vertices.map((point) => ({ ...point })) })), selectedRoomId, walls: cloneWalls(walls), openings: cloneOpenings(openings), measurements: cloneMeasurements(measurements), dimensionOffsets: { ...dimensionOffsets }, hiddenDimensions: [...hiddenDimensions] }; }
  function record(before = snapshot()) { setHistory((current) => [...current.slice(-29), before]); setFuture([]); }
  function restore(value: Snapshot) { setDefaultWallThicknessInput(null); setWallThicknessInput(null); setWalls(cloneWalls(value.walls)); if (value.wallThickness !== undefined) setWallThickness(value.wallThickness); if (value.rooms) setRooms(value.rooms); setSelectedRoomId(value.selectedRoomId ?? null); setOpenings(cloneOpenings(value.openings)); setMeasurements(cloneMeasurements(value.measurements ?? [])); setDimensionOffsets({ ...(value.dimensionOffsets ?? {}) }); setHiddenDimensions([...(value.hiddenDimensions ?? [])]); setDraft([]); setMeasurementDraft([]); setSelectedMeasurement(null); setSelectedSegment(null); setSelectedPoint(null); }
  function undo() { const previous = history.at(-1); if (!previous) return; setFuture((current) => [snapshot(), ...current].slice(0, 30)); setHistory((current) => current.slice(0, -1)); restore(previous); }
  function redo() { const next = future[0]; if (!next) return; setHistory((current) => [...current.slice(-29), snapshot()]); setFuture((current) => current.slice(1)); restore(next); }

  function moveCornerPreservingTopology(baseline: Wall[], selection: PointSelection, next: Point2D): Wall[] {
    const source = baseline.find((wall) => wall.id === selection.wallId);
    if (!source) return baseline;
    const requestedPoints = squaredWalls ? moveSquaredWallPoint(source.points, selection.pointIndex, next) : source.points.map((point, pointIndex) => pointIndex === selection.pointIndex ? { ...next } : { ...point });
    const constrainedNext = squaredWalls
      ? constrainSquaredCornerTarget(baseline, source.id, selection.pointIndex, requestedPoints, next, Math.max(MIN_WALL_CLEARANCE_MM, snapEnabled ? snapSize : 0))
      : { ...next };
    const candidate = baseline.map((wall) => {
      if (wall.id !== selection.wallId) return { ...wall, points: wall.points.map((point) => ({ ...point })) };
      const closed = samePoint(wall.points[0], wall.points.at(-1)!);
      const points = squaredWalls ? moveSquaredWallPoint(wall.points, selection.pointIndex, constrainedNext) : wall.points.map((point, pointIndex) => pointIndex === selection.pointIndex ? { ...constrainedNext } : { ...point });
      if (closed && selection.pointIndex === 0) points[points.length - 1] = { ...points[0] };
      return hasMinimumEnclosedArea(points) ? { ...wall, points } : { ...wall, points: wall.points.map((point) => ({ ...point })) };
    });
    const translatedRun = translateStraightWallRunForCorner(baseline, candidate, selection.wallId, selection.pointIndex);
    const hostTranslated = translateHostSegmentWithDraggedEndpoint(baseline, translatedRun, selection.wallId, selection.pointIndex);
    const incidentTranslated = translateIncidentWallRunsForCorner(baseline, hostTranslated, selection.wallId, selection.pointIndex);
    const synchronized = reanchorAutoWallBridges(synchronizeConnectedJunctions(baseline, incidentTranslated, squaredWalls, selection.wallId), selection.wallId);
    const adjacentSegmentIndex = Math.max(0, Math.min(source.points.length - 2, selection.pointIndex));
    const connectedEndpoints = followTerminatingEndpointsOnTranslatedSegments(baseline, synchronized, selection.wallId);
    const anchoredEndpoints = reanchorAttachedWallEndpoints(connectedEndpoints, selection.wallId);
    const repaired = reanchorAutoWallBridges(retainDraggedWallConnections(baseline, anchoredEndpoints, selection.wallId, adjacentSegmentIndex), selection.wallId);
    return repaired.every((wall) => (!squaredWalls || hasOnlyOrthogonalSegments(wall.points)) && (wall.id !== selection.wallId || hasMinimumEnclosedArea(wall.points))) ? repaired : baseline;
  }

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
    setMeasurements((current) => [...current, { id, first, second: reference, offset: defaultMeasurementOffset(DEFAULT_CUSTOM_MEASUREMENT_OFFSET_SCREEN, activeViewport.scale) }]);
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
    event.preventDefault(); event.stopPropagation();
    setContextMenu(null); setOpeningMeasurementContextMenu(null); setFixtureMeasurementContextMenu(null); setMeasurementLengthInput(null); setSelectedMeasurement(`custom:${id}`);
    setMeasurementContextMenu({ id, custom: true, x: event.clientX, y: event.clientY });
  }

  function setMeasurementDirection(id: string, direction: MeasurementDirection) {
    const measurement = measurements.find((item) => item.id === id);
    if (!measurement || (measurement.direction ?? "NORMAL") === direction) { setMeasurementContextMenu(null); return; }
    record();
    setMeasurements((current) => current.map((item) => item.id === id ? { ...item, direction } : item));
    setMeasurementContextMenu(null);
  }

  function openAutoMeasurementContextMenu(event: ReactMouseEvent<SVGGElement>, selection: SegmentSelection) {
    event.preventDefault(); event.stopPropagation(); setContextMenu(null); setOpeningMeasurementContextMenu(null); setFixtureMeasurementContextMenu(null);
    const wall = walls.find((item) => item.id === selection.wallId);
    setMeasurementLengthInput(wall ? Math.round(wallLengthForSegment(wall, selection.segmentIndex) * 10) / 10 : null);
    setSelectedMeasurement(`auto:${selection.wallId}:${selection.segmentIndex}`);
    setMeasurementContextMenu({ id: `${selection.wallId}:${selection.segmentIndex}`, custom: false, x: event.clientX, y: event.clientY });
  }

  function applyAutoMeasurementValue(id: string) {
    const separator = id.lastIndexOf(":");
    const wallId = id.slice(0, separator); const segmentIndex = Number(id.slice(separator + 1));
    const wall = walls.find((item) => item.id === wallId); const start = wall?.points[segmentIndex]; const end = wall?.points[segmentIndex + 1];
    const current = start && end ? Math.hypot(end.x - start.x, end.y - start.y) : 0;
    const value = Number(measurementLengthInput);
    if (!wall || !start || !end || !current || !Number.isFinite(value) || value <= 0) return;
    const next = { x: start.x + (end.x - start.x) * value / current, y: start.y + (end.y - start.y) * value / current };
    const closed = samePoint(wall.points[0], wall.points.at(-1)!);
    const endIndex = closed && segmentIndex + 1 === wall.points.length - 1 ? 0 : segmentIndex + 1;
    updateCoordinatePoint(wallId, endIndex, next, { segmentIndex, lengthMm: value });
    setMeasurementContextMenu(null); setMeasurementLengthInput(null);
  }

  function closeAutoMeasurementValueMenu() {
    setMeasurementContextMenu(null); setMeasurementLengthInput(null);
  }

  function closeOpeningMeasurementValueMenu() {
    setOpeningMeasurementContextMenu(null); setOpeningMeasurementValueInput(null); setOpeningMeasurementError(null);
  }

  function closeFixtureMeasurementValueMenu() {
    setFixtureMeasurementContextMenu(null); setFixtureMeasurementValueInput(null); setFixtureMeasurementError(null);
  }

  function handleMeasurementValueMenuKeyDown(event: ReactKeyboardEvent<HTMLElement>, onApply: () => void, onCancel: () => void) {
    if (event.key === "Enter") {
      event.preventDefault(); onApply();
    } else if (event.key === "Escape") {
      event.preventDefault(); onCancel();
    }
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
    setMeasurementContextMenu(null); setMeasurementLengthInput(null); setSelectedMeasurement(null);
  }

  function beginFixtureDrag(event: ReactPointerEvent<SVGElement>, fixture: Obstacle) {
    if (!onFixturesChange || event.button !== 0) return;
    event.preventDefault(); event.stopPropagation(); event.currentTarget.setPointerCapture(event.pointerId);
    const owner = projectRooms.find(room => room.obstacles.some(item => item.id === fixture.id));
    if (owner?.source_floorplan_room_id) setSelectedRoomId(owner.source_floorplan_room_id);
    fixtureDrag.current = { id: fixture.id, before: { ...fixture.center } };
  }

  function moveFixture(event: ReactPointerEvent<SVGSVGElement>): boolean {
    const active = fixtureDrag.current;
    if (!active || !onFixturesChange) return false;
    const next = canvasPoint(event, false); const snapped = snapEnabled ? { x: Math.round(next.x / snapSize) * snapSize, y: Math.round(next.y / snapSize) * snapSize } : next;
    onFixturesChange(fixtures.map((fixture) => fixture.id === active.id ? (fixture.wall_lock && selectedRoom ? alignObstacleToNearestWall({ ...fixture, center: snapped }, counterClockwiseVertices(selectedRoom.vertices), snapped) : { ...fixture, center: snapped }) : fixture));
    return true;
  }

  function openFixtureContextMenu(event: ReactMouseEvent<SVGElement>, fixture: Obstacle) {
    if (!onFixturesChange) return;
    const owner = projectRooms.find(room => room.obstacles.some(item => item.id === fixture.id));
    if (owner?.source_floorplan_room_id) setSelectedRoomId(owner.source_floorplan_room_id);
    event.preventDefault(); event.stopPropagation(); setFixtureMeasurementContextMenu(null); setFixtureContextMenu({ id: fixture.id, x: Math.max(8, Math.min(event.clientX, window.innerWidth - 244)), y: Math.max(8, Math.min(event.clientY, window.innerHeight - 180)) });
  }

  function fixtureMeasurementValue(fixture: Obstacle, section: number, geometry = walls): number {
    const span = nearestFixtureWallSpan(fixture, geometry);
    if (!span) return 0;
    if (section === 0) return span.startOffsetMm;
    if (section === 1) return span.widthMm;
    return span.endOffsetMm;
  }

  function openFixtureMeasurementContextMenu(event: ReactMouseEvent<SVGGElement>, fixture: Obstacle, rawSection: number) {
    if (!measurementEditEnabled || !onFixturesChange) return;
    const span = nearestFixtureWallSpan(fixture, walls);
    if (!span) return;
    const section = Math.max(0, Math.min(2, Math.trunc(rawSection))) as 0 | 1 | 2;
    const owner = projectRooms.find(room => room.obstacles.some(item => item.id === fixture.id));
    if (owner?.source_floorplan_room_id) setSelectedRoomId(owner.source_floorplan_room_id);
    event.preventDefault(); event.stopPropagation();
    setContextMenu(null); setMeasurementContextMenu(null); setOpeningContextMenu(null); setOpeningMeasurementContextMenu(null); setFixtureContextMenu(null); setFixtureMeasurementContextMenu(null);
    setFixtureMeasurementValueInput(Math.round(fixtureMeasurementValue(fixture, section) * 10) / 10);
    setFixtureMeasurementError(null);
    setFixtureMeasurementContextMenu({ id: fixture.id, section, x: Math.max(8, Math.min(event.clientX, window.innerWidth - 250)), y: Math.max(8, Math.min(event.clientY, window.innerHeight - 180)) });
  }

  function updateFixture(id: string, update: (fixture: Obstacle) => Obstacle) {
    if (!onFixturesChange) return;
    onFixturesChange(fixtures.map((fixture) => {
      if (fixture.id !== id) return fixture;
      const next = update(fixture);
      return next.wall_lock && selectedRoom ? alignObstacleToNearestWall(next, counterClockwiseVertices(selectedRoom.vertices), next.center) : next;
    }));
  }

  function applyFixtureMeasurementValue() {
    const menu = fixtureMeasurementContextMenu;
    const fixture = menu ? fixtures.find((item) => item.id === menu.id) : null;
    const span = fixture ? nearestFixtureWallSpan(fixture, walls) : null;
    if (!menu || !fixture || !span) return;
    const value = fixtureMeasurementValueInput ?? fixtureMeasurementValue(fixture, menu.section);
    const wallLength = Math.hypot(span.wallEnd.x - span.wallStart.x, span.wallEnd.y - span.wallStart.y);
    if (!Number.isFinite(value) || value < 0 || !wallLength) {
      setFixtureMeasurementError("Enter a non-negative length.");
      return;
    }

    const tangent = { x: (span.wallEnd.x - span.wallStart.x) / wallLength, y: (span.wallEnd.y - span.wallStart.y) / wallLength };
    if (menu.section === 1) {
      if (value <= 0) {
        setFixtureMeasurementError("Element width must be greater than zero.");
        return;
      }
      const angle = fixture.rotation_deg * Math.PI / 180;
      const widthAxis = { x: Math.cos(angle), y: Math.sin(angle) };
      const depthAxis = { x: Math.sin(angle), y: -Math.cos(angle) };
      const widthProjection = Math.abs(widthAxis.x * tangent.x + widthAxis.y * tangent.y);
      const depthProjection = Math.abs(depthAxis.x * tangent.x + depthAxis.y * tangent.y);
      const editWidthDimension = widthProjection >= depthProjection;
      const editedProjection = editWidthDimension ? widthProjection : depthProjection;
      const fixedContribution = editWidthDimension ? fixture.dimensions.depth.value * depthProjection : fixture.dimensions.width.value * widthProjection;
      const editedDimension = (value - fixedContribution) / editedProjection;
      const centreAlong = (fixture.center.x - span.wallStart.x) * tangent.x + (fixture.center.y - span.wallStart.y) * tangent.y;
      const targetStart = centreAlong - value / 2;
      if (!Number.isFinite(editedDimension) || editedDimension <= 0 || editedProjection <= 0.001 || targetStart < 0 || targetStart + value > wallLength) {
        setFixtureMeasurementError("The element width must fit between the wall corners for its current rotation.");
        return;
      }
      updateFixture(fixture.id, (item) => ({ ...item, dimensions: { ...item.dimensions, [editWidthDimension ? "width" : "depth"]: { ...item.dimensions[editWidthDimension ? "width" : "depth"], value: editedDimension } } }));
    } else {
      const targetStart = menu.section === 0 ? value : wallLength - value - span.widthMm;
      if (targetStart < 0 || targetStart + span.widthMm > wallLength) {
        setFixtureMeasurementError("The element must remain between the wall corners.");
        return;
      }
      const distance = targetStart - span.startOffsetMm;
      updateFixture(fixture.id, (item) => ({ ...item, center: { x: item.center.x + tangent.x * distance, y: item.center.y + tangent.y * distance } }));
    }
    setFixtureMeasurementContextMenu(null); setFixtureMeasurementValueInput(null); setFixtureMeasurementError(null);
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

  function commitDraft(points = draft, endAttachment?: WallAttachment) {
    // Draft points have already been squared as they are drawn. Re-squaring here can
    // move an attached endpoint away from its host and manufacture a short wall stub.
    const shapedPoints = points.reduce<Point2D[]>((result, point) => {
      if (!result.length || !samePoint(result.at(-1)!, point, 0.5)) result.push({ ...point });
      return result;
    }, []);
    if (shapedPoints.length >= 2) {
      record();
      const attachments: Record<number, WallAttachment> = {};
      if (draftStartAttachment.current) attachments[0] = { ...draftStartAttachment.current };
      // An attached endpoint is still the corner that closes the new wall. Keep its
      // label visible; the attachment itself prevents it from drifting off its host.
      if (endAttachment) attachments[shapedPoints.length - 1] = { ...endAttachment };
      // A connected draft can start or finish in the middle of an existing
      // wall.  Keep that host run intact and materialize the junction instead
      // of leaving two partially overlapping runs whose visible union appears
      // truncated.  The materializer only inserts junction vertices; it never
      // removes or shortens an existing endpoint.
      setWallsRespectingMeasurements((current) => appendWallRunPreservingExistingWalls(current, {
        id: crypto.randomUUID(),
        points: shapedPoints,
        attachments: Object.keys(attachments).length ? attachments : undefined,
      }));
    }
    draftStartAttachment.current = null; setDraft([]); setHoveredCorner(null); setTool("SELECT"); setLockedViewport(null); setSelectedSegment(null); setSelectedPoint(null);
  }

  function connectDraftToWall(wallId: string, segmentIndex: number, requested: Point2D, alignClosingCorner = false) {
    const wall = walls.find((item) => item.id === wallId);
    const start = wall?.points[segmentIndex]; const end = wall?.points[segmentIndex + 1];
    if (!start || !end) return;
    // A corner click is authoritative. The orthogonal intersection helper is useful
    // for finishing on the middle of a wall, but at an endpoint it can replace the
    // clicked corner with a nearby point derived from the preceding draft segment.
    const directIntersection = !alignClosingCorner && squaredWalls && draft.length ? orthogonalIntersectionOnSegment(draft.at(-1)!, requested, start, end) : null;
    const projected = alignClosingCorner ? { ...requested } : directIntersection ?? pointOnSegment(requested, start, end).point;
    // Finishing on an existing wall endpoint must reuse that endpoint. Without this
    // small snap, a close click can leave a tiny sliver and create an unwanted extra
    // numbered corner beside the existing junction.
    const endpointTolerance = snapEnabled ? Math.max(8, snapSize * 0.5) : 8;
    const touchesStart = Math.hypot(projected.x - start.x, projected.y - start.y) <= endpointTolerance;
    const touchesEnd = Math.hypot(projected.x - end.x, projected.y - end.y) <= endpointTolerance;
    const point = touchesStart ? { ...start } : touchesEnd ? { ...end } : projected;
    const attachment = { wallId, segmentIndex, along: pointOnSegment(point, start, end).along, hideCorner: touchesStart || touchesEnd };
    if (draft.length) {
      // Picking a real corner is an explicit request to close at that corner. Align
      // the last draft point even when free-angle drawing is enabled, so the final
      // segment finishes flush instead of preserving a near-miss below/alongside it.
      const alignedDraft = alignClosingCorner ? alignDraftToCorner(draft, point) : draft;
      commitDraft(squaredWalls ? orthogonalPathTo(alignedDraft, point) : [...alignedDraft, point], attachment);
    }
    else {
      // Keep the user's current view when the first point starts a wall. The
      // point is mapped using this viewport, so locking the same viewport
      // prevents the draft from triggering an automatic fit/jump.
      setLockedViewport(viewport); draftStartAttachment.current = attachment; setDraft([point]);
    }
    setSelectedSegment({ wallId, segmentIndex }); setSelectedPoint(null);
  }

  function connectDraftToCorner(selection: PointSelection) {
    const wall = walls.find((item) => item.id === selection.wallId);
    const point = wall?.points[selection.pointIndex];
    if (!wall || !point) return;
    const segmentIndex = wall.points[selection.pointIndex + 1] ? selection.pointIndex : selection.pointIndex - 1;
    if (segmentIndex < 0) return;
    setHoveredCorner(null);
    connectDraftToWall(selection.wallId, segmentIndex, point, true);
  }

  function alignDraftToCorner(points: Point2D[], corner: Point2D): Point2D[] {
    const last = points.at(-1);
    if (!last || last.x === corner.x || last.y === corner.y) return points;
    const horizontalConnection = Math.abs(corner.x - last.x) >= Math.abs(corner.y - last.y);
    const aligned = horizontalConnection ? { ...last, y: corner.y } : { ...last, x: corner.x };
    return [...points.slice(0, -1), aligned];
  }

  function findWallSegmentNear(point: Point2D): SegmentSelection | null {
    const tolerance = snapEnabled ? Math.max(35, snapSize) : 35;
    let closest: (SegmentSelection & { distance: number }) | null = null;
    walls.forEach((wall) => wall.points.slice(0, -1).forEach((start, segmentIndex) => {
      const end = wall.points[segmentIndex + 1];
      const projected = pointOnSegment(point, start, end).point;
      const distance = Math.hypot(point.x - projected.x, point.y - projected.y);
      if (distance <= tolerance && (!closest || distance < closest.distance)) closest = { wallId: wall.id, segmentIndex, distance };
    }));
    return closest;
  }

  function findCornerNear(point: Point2D): PointSelection | null {
    const tolerance = snapEnabled ? Math.max(40, snapSize * 2) : 40;
    let closest: (PointSelection & { distance: number }) | null = null;
    walls.forEach((wall) => wall.points.slice(0, samePoint(wall.points[0], wall.points.at(-1)!) ? -1 : undefined).forEach((corner, pointIndex) => {
      if (wall.attachments?.[pointIndex]?.hideCorner) return;
      const distance = Math.hypot(point.x - corner.x, point.y - corner.y);
      if (distance <= tolerance && (!closest || distance < closest.distance)) closest = { wallId: wall.id, pointIndex, distance };
    }));
    return closest;
  }

  function clearImportedDrawing() {
    backgroundImportId.current += 1;
    if (sourceUrl) URL.revokeObjectURL(sourceUrl);
    setSourceUrl(null); setSourceFile(null); setCanvasSize(DEFAULT_SIZE); setImporting(false); setImportError(null);
  }

  function applyTemplate(points: Point2D[]) {
    record();
    clearImportedDrawing();
    const outline = [...points.map((point) => ({ ...point })), { ...points[0] }];
    setWallsRespectingMeasurements([{ id: crypto.randomUUID(), points: squaredWalls ? squareWallPoints(outline) : outline }]);
    setOpenings([]); setMeasurements([]); setDimensionOffsets({}); setHiddenDimensions([]); setRooms([]); setSelectedRoomId(null); setDraft([]); setTool("SELECT"); setSelectedSegment(null); setSelectedPoint(null); setLockedViewport(null); setLShapePickerOpen(false);
  }

  function newOutline() {
    record();
    clearImportedDrawing();
    setWallsRespectingMeasurements([]); setOpenings([]); setMeasurements([]); setDimensionOffsets({}); setHiddenDimensions([]); setRooms([]); setSelectedRoomId(null); setDraft([]); setTool("DRAW"); setSelectedSegment(null); setSelectedPoint(null); setZoom(1); setPan({ x: 0, y: 0 }); setLockedViewport(null); setLShapePickerOpen(false);
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
      const sourceSegmentIndices = Array.from({ length: count - 1 }, (_, index) => (segmentIndex + 1 + index) % count);
      setWallsRespectingMeasurements((current) => current.map((item) => item.id === wallId ? { ...item, points: remaining.map((point) => ({ ...point })), thicknessOverridesMm: remapSegmentThicknessOverrides(item.thicknessOverridesMm, sourceSegmentIndices), lengthOverridesMm: remapSegmentLengthOverrides(item.lengthOverridesMm, sourceSegmentIndices) } : item));
      setOpenings((current) => current.filter((opening) => !(opening.wallId === wallId && opening.segmentIndex === segmentIndex)).map((opening) => {
        if (opening.wallId !== wallId) return opening;
        return { ...opening, segmentIndex: (opening.segmentIndex - (segmentIndex + 1) + count) % count };
      }));
    } else {
      const firstRun = wall.points.slice(0, segmentIndex + 1);
      const secondRun = wall.points.slice(segmentIndex + 1);
      const secondId = crypto.randomUUID();
      setWallsRespectingMeasurements((current) => current.flatMap((item) => item.id !== wallId ? [item] : [
        ...(firstRun.length >= 2 ? [{ ...item, points: firstRun.map((point) => ({ ...point })), thicknessOverridesMm: remapSegmentThicknessOverrides(item.thicknessOverridesMm, Array.from({ length: firstRun.length - 1 }, (_, index) => index)), lengthOverridesMm: remapSegmentLengthOverrides(item.lengthOverridesMm, Array.from({ length: firstRun.length - 1 }, (_, index) => index)) }] : []),
        ...(secondRun.length >= 2 ? [{ id: secondId, points: secondRun.map((point) => ({ ...point })), thicknessOverridesMm: remapSegmentThicknessOverrides(item.thicknessOverridesMm, Array.from({ length: secondRun.length - 1 }, (_, index) => segmentIndex + 1 + index)), lengthOverridesMm: remapSegmentLengthOverrides(item.lengthOverridesMm, Array.from({ length: secondRun.length - 1 }, (_, index) => segmentIndex + 1 + index)) }] : []),
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
    setWallsRespectingMeasurements((current) => current.map((item) => {
      if (item.id !== wallId) return item;
      const points = [...item.points.slice(0, segmentIndex + 1), inserted, ...item.points.slice(segmentIndex + 1)];
      const thicknessOverridesMm = item.thicknessOverridesMm ? Object.entries(item.thicknessOverridesMm).reduce<Record<number, number>>((next, [key, thicknessMm]) => {
        const index = Number(key);
        if (index < segmentIndex) next[index] = thicknessMm;
        else if (index === segmentIndex) { next[index] = thicknessMm; next[index + 1] = thicknessMm; }
        else next[index + 1] = thicknessMm;
        return next;
      }, {}) : undefined;
      return { ...item, points: squaredWalls ? squareWallPoints(points) : points, thicknessOverridesMm, lengthOverridesMm: splitSegmentLengthOverride(item.lengthOverridesMm, segmentIndex, projected.along) };
    }));
    setOpenings((current) => current.filter((opening) => !(opening.wallId === wallId && opening.segmentIndex === segmentIndex)).map((opening) => opening.wallId === wallId && opening.segmentIndex > segmentIndex ? { ...opening, segmentIndex: opening.segmentIndex + 1 } : opening));
    setSelectedPoint({ wallId, pointIndex: segmentIndex + 1 });
    setSelectedSegment({ wallId, segmentIndex: segmentIndex + 1 });
  }

  function addSelectedRoom() {
    if (!selectedSegment) { setRoomActionError("Select a boundary wall to create a new room on the outside of it"); return; }
    const result = addRoomOutsideWall(walls, selectedSegment, crypto.randomUUID(), roomDepthInput);
    if (result.error) { setRoomActionError(result.error); return; }
    record(); setWalls(result.walls as Wall[]); setRoomActionError(null); setAddRoomPanelOpen(false);
  }

  function requestRemoveSelectedRoom() {
    if (selectedRoom) setPendingRoomRemovalId(selectedRoom.id);
  }

  function removeSelectedRoom() {
    const room = pendingRoomRemovalId ? rooms.find((item) => item.id === pendingRoomRemovalId) : null;
    setPendingRoomRemovalId(null);
    if (!room) return;
    const result = removeRoomBoundary(walls, room.vertices);
    const remapReference = (reference: MeasurementReference): MeasurementReference | null => {
      if (reference.kind === "POINT") { const mapped = result.pointMap[`${reference.wallId}:${reference.pointIndex}`]; return mapped ? { kind: "POINT", ...mapped } : null; }
      const mapped = result.segmentMap[`${reference.wallId}:${reference.segmentIndex}`];
      // A whole-wall measurement cannot truthfully refer to only one fragment.
      return mapped?.length === 1 && mapped[0].from === 0 && mapped[0].to === 1 ? { kind: "WALL", wallId: mapped[0].wallId, segmentIndex: mapped[0].segmentIndex } : null;
    };
    record();
    setOpenings(openings.flatMap((opening) => {
      const wall = walls.find((item) => item.id === opening.wallId);
      const start = wall?.points[opening.segmentIndex], end = wall?.points[opening.segmentIndex + 1];
      if (!start || !end) return [];
      const length = Math.hypot(end.x - start.x, end.y - start.y);
      const mapped = result.segmentMap[`${opening.wallId}:${opening.segmentIndex}`]?.find((part) => opening.offset >= part.from * length - .001 && opening.offset + opening.width <= part.to * length + .001);
      return mapped ? [{ ...opening, wallId: mapped.wallId, segmentIndex: mapped.segmentIndex, offset: opening.offset - mapped.from * length }] : [];
    }));
    setMeasurements(measurements.flatMap((measurement) => { const first = remapReference(measurement.first), second = remapReference(measurement.second); return first && second ? [{ ...measurement, first, second }] : []; }));
    const remapDimensionId = (id: string) => (result.segmentMap[id] ?? []).map((part) => `${part.wallId}:${part.segmentIndex}`);
    setDimensionOffsets(Object.fromEntries(Object.entries(dimensionOffsets).flatMap(([id, offset]) => remapDimensionId(id).map((key) => [key, offset]))));
    setHiddenDimensions(hiddenDimensions.flatMap(remapDimensionId));
    const remainingRooms = rooms.filter((item) => item.id !== room.id).map((item) => ({ ...item, sourceWallIds: [...new Set((item.sourceWallIds ?? [item.sourceWallId]).flatMap((id) => walls.find((wall) => wall.id === id)?.points.slice(0, -1).flatMap((_, index) => (result.segmentMap[`${id}:${index}`] ?? []).map((part) => part.wallId)) ?? []))] }));
    setRooms(remainingRooms); setWalls(result.walls as Wall[]); setSelectedRoomId(remainingRooms[0]?.id ?? null);
    setSelectedSegment(null); setSelectedPoint(null); setSelectedOpeningId(null); setSelectedMeasurement(null); setMeasurementDraft([]); setRoomActionError(null);
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
    updateCoordinatePoint(selectedWall.id, endIndex, next, { segmentIndex: selectedSegment.segmentIndex, lengthMm: requested });
    setWallLengthInput(null);
  }

  function setSelectedWallThickness(wallId: string, segmentIndex: number, thicknessMm: number) {
    const wall = walls.find((item) => item.id === wallId);
    if (!wall || !needsWallThicknessOverride(wall.thicknessOverridesMm?.[segmentIndex], thicknessMm)) return;
    record();
    setWallsRespectingMeasurements((current) => current.map((wall) => wall.id !== wallId ? wall : { ...wall, thicknessOverridesMm: { ...wall.thicknessOverridesMm, [segmentIndex]: thicknessMm } }));
  }

  function resetSelectedWallThickness(wallId: string, segmentIndex: number) {
    setWallThicknessInput(null);
    const wall = walls.find((item) => item.id === wallId);
    if (!wall?.thicknessOverridesMm || wall.thicknessOverridesMm[segmentIndex] === undefined) return;
    record();
    setWallsRespectingMeasurements((current) => current.map((item) => {
      if (item.id !== wallId) return item;
      const thicknessOverridesMm = { ...item.thicknessOverridesMm };
      delete thicknessOverridesMm[segmentIndex];
      return { ...item, thicknessOverridesMm: Object.keys(thicknessOverridesMm).length ? thicknessOverridesMm : undefined };
    }));
  }

  function deletePointAt(selection: PointSelection) {
    const wall = walls.find((item) => item.id === selection.wallId); if (!wall) return;
    const closed = samePoint(wall.points[0], wall.points.at(-1)!); const unique = closed ? wall.points.length - 1 : wall.points.length;
    if (unique <= (closed ? 3 : 2)) return;
    record();
    setWallsRespectingMeasurements((current) => current.map((item) => {
      if (item.id !== wall.id) return item;
      const core = closed ? item.points.slice(0, -1) : [...item.points]; core.splice(selection.pointIndex, 1);
      const points = closed ? [...core, { ...core[0] }] : core;
      const segmentCount = item.points.length - 1;
      const sourceSegmentIndices = closed
        ? Array.from({ length: points.length - 1 }, (_, index) => {
            if (selection.pointIndex === 0) return index === points.length - 2 ? segmentCount - 1 : index + 1;
            return index < selection.pointIndex - 1 ? index : index === selection.pointIndex - 1 ? index : index + 1;
          })
        : Array.from({ length: Math.max(0, points.length - 1) }, (_, index) => index < selection.pointIndex ? index : index + 1);
      return { ...item, points: squaredWalls ? squareWallPoints(points) : points, thicknessOverridesMm: remapSegmentThicknessOverrides(item.thicknessOverridesMm, sourceSegmentIndices), lengthOverridesMm: remapSegmentLengthOverrides(item.lengthOverridesMm, sourceSegmentIndices) };
    }));
    setOpenings((current) => current.filter((opening) => opening.wallId !== wall.id)); setSelectedPoint(null); setSelectedSegment(null);
  }

  function deletePoint() {
    if (selectedPoint) deletePointAt(selectedPoint);
  }

  function openWallContextMenu(event: ReactMouseEvent<SVGLineElement>, selection: SegmentSelection) {
    event.preventDefault(); event.stopPropagation();
    setSelectedSegment(selection); setSelectedPoint(null); setSelectedOpeningId(null); setWallLengthInput(null);
    setOpeningParent(parentKey(selection.wallId, selection.segmentIndex));
    setContextMenu({ kind: "WALL", ...selection, x: Math.max(8, Math.min(event.clientX, window.innerWidth - 190)), y: Math.max(8, Math.min(event.clientY, window.innerHeight - 112)) });
  }

  function openPointContextMenu(event: ReactMouseEvent<SVGCircleElement>, selection: PointSelection) {
    event.preventDefault(); event.stopPropagation();
    setSelectedPoint(selection); setSelectedSegment(null); setSelectedOpeningId(null);
    setContextMenu({ kind: "POINT", ...selection, x: Math.max(8, Math.min(event.clientX, window.innerWidth - 190)), y: Math.max(8, Math.min(event.clientY, window.innerHeight - 112)) });
  }

  function beginPointDrag(event: ReactPointerEvent<SVGCircleElement>, selection: PointSelection) {
    if ((tool !== "SELECT" && tool !== "MEASURE") || event.button !== 0) return;
    event.stopPropagation(); event.currentTarget.setPointerCapture(event.pointerId);
    pointDrag.current = { selection, before: snapshot() }; setLockedViewport(viewport); setSelectedPoint(selection); setSelectedSegment(null);
  }

  function beginWallDrag(event: ReactPointerEvent<SVGLineElement>, wall: Wall, segmentIndex: number) {
    if (tool !== "SELECT" && tool !== "MEASURE" || event.button !== 0) return;
    const svg = event.currentTarget.ownerSVGElement; if (!svg) return;
    const pointerStart = canvasPointFromClient(event.clientX, event.clientY, svg, false);
    const rawHistoryBefore = snapshot();
    const historyBefore = { ...rawHistoryBefore, walls: assignStableCornerNumbers(rawHistoryBefore.walls, wallVertexStarts) };
    const materialized = materializeWallJunctionsForSelection(historyBefore.walls, wall.id, segmentIndex, pointerStart);
    const materializedSnapshot = remapSnapshotForMaterializedSelection(historyBefore, materialized);
    const separatedStart = separateParallelSegmentStartForDrag(materializedSnapshot.walls, wall.id, materialized.segmentIndex);
    const separatedEnd = separateParallelSegmentEndForDrag(separatedStart.walls, wall.id, separatedStart.segmentIndex);
    const detachedPointIndices = [separatedStart.detachedPointIndex, separatedEnd.detachedEndPointIndex].filter((pointIndex): pointIndex is number => pointIndex !== undefined);
    const keepDetachedPointIndices = [
      ...(separatedStart.keepDetachedPointHidden && separatedStart.detachedPointIndex !== undefined ? [separatedStart.detachedPointIndex] : []),
      ...(separatedEnd.keepDetachedEndPointHidden && separatedEnd.detachedEndPointIndex !== undefined ? [separatedEnd.detachedEndPointIndex] : []),
    ];
    const before = { ...materializedSnapshot, walls: separatedEnd.walls as Wall[] };
    const selectedWall = before.walls.find((candidate) => candidate.id === wall.id);
    if (!selectedWall) return;
    event.stopPropagation(); svg.setPointerCapture(event.pointerId);
    wallDrag.current = { wallId: wall.id, segmentIndex: separatedEnd.segmentIndex, detachedPointIndices, keepDetachedPointIndices, before, historyBefore, points: selectedWall.points.map((point) => ({ ...point })), pointerStart };
    if (materialized.splitAlong.length || detachedPointIndices.length) {
      setWallsRespectingMeasurements(cloneWalls(before.walls)); setOpenings(cloneOpenings(before.openings)); setMeasurements(cloneMeasurements(before.measurements));
      setDimensionOffsets({ ...before.dimensionOffsets }); setHiddenDimensions([...before.hiddenDimensions]);
    }
    setLockedViewport(viewport); setSelectedSegment({ wallId: wall.id, segmentIndex: separatedEnd.segmentIndex }); setSelectedPoint(null); setSelectedOpeningId(null); setWallLengthInput(null); setOpeningParent(parentKey(wall.id, separatedEnd.segmentIndex));
  }

  function beginOpeningDrag(event: ReactPointerEvent<SVGElement>, opening: FullOpening) {
    if (event.button !== 0) return;
    event.stopPropagation(); event.currentTarget.setPointerCapture(event.pointerId);
    openingDrag.current = { openingId: opening.id, before: snapshot() }; selectOpeningForEdit(opening);
  }

  function selectOpeningForEdit(opening: FullOpening) {
    setElementTab(opening.kind);
    setTool("SELECT"); setLockedViewport(viewport); setSelectedOpeningId(opening.id); setSelectedPoint(null);
    setSelectedSegment({ wallId: opening.wallId, segmentIndex: opening.segmentIndex }); setOpeningParent(parentKey(opening.wallId, opening.segmentIndex));
    setOpeningKind(opening.kind); setOpeningCatalogueId(opening.catalogueItemId ?? ""); setOpeningOffset(opening.offset); setOpeningWidth(opening.width); setOpeningHeight(opening.height); setWindowSill(opening.sill);
    setDoorType(opening.doorType); setHingeSide(opening.hingeSide); setOpensInward(opening.opensInward); setOpeningError(null);
  }

  function requestOutlineAction(action: PendingOutlineAction) {
    setLShapePickerOpen(false);
    setPendingOutlineAction(action);
  }

  function confirmOutlineAction() {
    const action = pendingOutlineAction;
    setPendingOutlineAction(null);
    if (action === "EMPTY") newOutline();
    else if (action === "RECTANGLE") applyTemplate(RECTANGLE_TEMPLATE);
    else if (action === "L_SHAPE") setLShapePickerOpen(true);
  }

  function openOpeningContextMenu(event: ReactMouseEvent<SVGGElement>, opening: FullOpening) {
    event.preventDefault(); event.stopPropagation(); selectOpeningForEdit(opening); setContextMenu(null); setMeasurementContextMenu(null);
    setOpeningContextMenu({ id: opening.id, x: Math.max(8, Math.min(event.clientX, window.innerWidth - 190)), y: Math.max(8, Math.min(event.clientY, window.innerHeight - 112)) });
  }

  function openingMeasurementValue(opening: FullOpening, section: number): number {
    const wall = walls.find((item) => item.id === opening.wallId);
    const length = wall && wall.points[opening.segmentIndex + 1] ? segmentLength(wall, opening.segmentIndex) : 0;
    if (section === 0) return opening.offset;
    if (section === 1) return opening.width;
    return Math.max(0, length - opening.offset - opening.width);
  }

  function openOpeningMeasurementContextMenu(event: ReactMouseEvent<SVGGElement>, opening: FullOpening, section: number) {
    if (!measurementEditEnabled) return;
    event.preventDefault(); event.stopPropagation();
    setContextMenu(null); setMeasurementContextMenu(null); setOpeningContextMenu(null); setFixtureMeasurementContextMenu(null); setOpeningMeasurementError(null);
    setOpeningMeasurementValueInput(openingMeasurementValue(opening, section));
    setOpeningMeasurementContextMenu({ id: opening.id, section, x: Math.max(8, Math.min(event.clientX, window.innerWidth - 250)), y: Math.max(8, Math.min(event.clientY, window.innerHeight - 180)) });
  }

  function applyOpeningMeasurementValue() {
    const menu = openingMeasurementContextMenu;
    const opening = menu ? openings.find((item) => item.id === menu.id) : null;
    if (!menu || !opening) return;
    const value = openingMeasurementValueInput ?? openingMeasurementValue(opening, menu.section);
    if (!Number.isFinite(value) || value < 0) { setOpeningMeasurementError("Enter a non-negative length."); return; }
    const wall = walls.find((item) => item.id === opening.wallId);
    const length = wall && wall.points[opening.segmentIndex + 1] ? segmentLength(wall, opening.segmentIndex) : 0;
    const candidate = menu.section === 0 ? { ...opening, offset: value }
      : menu.section === 1 ? { ...opening, width: value }
        : { ...opening, offset: length - opening.width - value };
    if (candidate.width <= 0 || !openingPlacementIsValid(candidate)) {
      setOpeningMeasurementError(`The resulting opening must remain ${formatLength(OPENING_CORNER_CLEARANCE_MM, displayUnits)} clear of every corner and junction.`);
      return;
    }
    record();
    setOpenings((current) => current.map((item) => item.id === candidate.id ? candidate : item));
    setOpeningOffset(candidate.offset); setOpeningWidth(candidate.width); setOpeningMeasurementContextMenu(null); setOpeningMeasurementError(null);
  }

  function deleteOpeningById(id: string) {
    record(); setOpenings((current) => current.filter((opening) => opening.id !== id)); if (selectedOpeningId === id) setSelectedOpeningId(null);
  }

  function openingCornerOffsets(wall: Wall, segmentIndex: number): number[] {
    const start = wall.points[segmentIndex]; const end = wall.points[segmentIndex + 1];
    if (!start || !end) return [];
    return cornerOffsetsOnWallSegment(start, end, walls.flatMap((candidateWall) => candidateWall.points));
  }

  function openingPlacementIsValid(opening: Pick<FullOpening, "id" | "wallId" | "segmentIndex" | "offset" | "width">, geometry = walls, allOpenings = openings): boolean {
    const wall = geometry.find((item) => item.id === opening.wallId);
    if (!wall || !wall.points[opening.segmentIndex + 1]) return false;
    const length = segmentLength(wall, opening.segmentIndex);
    const corners = cornerOffsetsOnWallSegment(wall.points[opening.segmentIndex], wall.points[opening.segmentIndex + 1], geometry.flatMap((candidateWall) => candidateWall.points));
    const blockers = allOpenings.filter((item) => item.id !== opening.id && item.wallId === opening.wallId && item.segmentIndex === opening.segmentIndex);
    return isOpeningPlacementValid(opening.offset, opening.width, length, corners, blockers, OPENING_CORNER_CLEARANCE_MM);
  }

  function constrainWallTranslationForOpenings(active: WallDrag, normal: Point2D, requestedDistance: number): { distance: number; openings: FullOpening[] } {
    const translate = (distance: number) => translateWallAndAttachedOpenings(active.before.walls, active.before.openings, active.wallId, active.segmentIndex, normal, distance);
    const isValid = (distance: number) => {
      const candidate = translate(distance);
      return candidate.openings.filter((opening) => opening.wallId === active.wallId).every((opening) => openingPlacementIsValid(opening, candidate.walls, candidate.openings));
    };
    if (!requestedDistance || isValid(requestedDistance)) {
      const candidate = translate(requestedDistance);
      return { distance: requestedDistance, openings: candidate.openings };
    }
    if (!isValid(0)) return { distance: 0, openings: active.before.openings };
    const direction = Math.sign(requestedDistance);
    let allowed = 0;
    let blocked = Math.abs(requestedDistance);
    // Opening validity is continuous for a straight wall translation. Find the
    // exact clearance boundary rather than dropping the drag frame that first
    // crossed it, which keeps the wall motion smooth with or without snapping.
    for (let iteration = 0; iteration < 32; iteration++) {
      const candidateDistance = direction * (allowed + blocked) / 2;
      if (isValid(candidateDistance)) allowed = Math.abs(candidateDistance);
      else blocked = Math.abs(candidateDistance);
    }
    const distance = direction * allowed;
    return { distance, openings: translate(distance).openings };
  }

  function moveOpening(event: ReactPointerEvent<SVGSVGElement>): boolean {
    const active = openingDrag.current;
    if (!active) return false;
    const opening = openings.find((item) => item.id === active.openingId);
    if (!opening) return true;
    const pointer = canvasPoint(event, false);
    const nearest = walls.flatMap((wall) => wall.points.slice(0, -1).map((start, segmentIndex) => {
      const end = wall.points[segmentIndex + 1]; const projection = pointOnSegment(pointer, start, end); const length = segmentLength(wall, segmentIndex);
      const rawOffset = projection.along * length - opening.width / 2;
      const requested = snapEnabled ? Math.round(rawOffset / snapSize) * snapSize : Math.round(rawOffset * 10) / 10;
      const blockers = openings.filter((item) => item.id !== opening.id && item.wallId === wall.id && item.segmentIndex === segmentIndex);
      const offset = closestValidOpeningOffset(requested, opening.width, length, openingCornerOffsets(wall, segmentIndex), blockers, OPENING_CORNER_CLEARANCE_MM);
      return { wall, segmentIndex, distance: Math.hypot(pointer.x - projection.point.x, pointer.y - projection.point.y), offset };
    })).filter((item): item is { wall: Wall; segmentIndex: number; distance: number; offset: number } => item.offset !== null).sort((first, second) => first.distance - second.distance)[0];
    if (!nearest) return true;
    setOpenings((current) => current.map((item) => item.id === opening.id ? { ...item, wallId: nearest.wall.id, segmentIndex: nearest.segmentIndex, offset: nearest.offset } : item));
    setSelectedSegment({ wallId: nearest.wall.id, segmentIndex: nearest.segmentIndex }); setOpeningParent(parentKey(nearest.wall.id, nearest.segmentIndex)); setOpeningOffset(nearest.offset);
    return true;
  }

  function movePoint(event: ReactPointerEvent<SVGSVGElement>) {
    const panStart = panDrag.current;
    if (panStart) {
      const rect = event.currentTarget.getBoundingClientRect();
      setPan({ x: panStart.pan.x + (event.clientX - panStart.clientX) * FLOOR_PLAN_CANVAS_WIDTH / rect.width, y: panStart.pan.y + (event.clientY - panStart.clientY) * FLOOR_PLAN_CANVAS_HEIGHT / rect.height });
      return;
    }
    if (tool === "DRAW" && !measurementDrag.current && !fixtureDrag.current && !openingDrag.current && !wallDrag.current && !pointDrag.current) {
      const hovered = findCornerNear(canvasPoint(event, false));
      setHoveredCorner((current) => current?.wallId === hovered?.wallId && current?.pointIndex === hovered?.pointIndex ? current : hovered);
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
      const requestedDistance = snapEnabled ? Math.round(rawDistance / snapSize) * snapSize : Math.round(rawDistance * 10) / 10;
      const wallClearanceDistance = constrainTranslatedWallDistance(activeWall.before.walls, activeWall.wallId, activeWall.segmentIndex, requestedDistance, Math.max(MIN_WALL_CLEARANCE_MM, snapEnabled ? snapSize : 0));
      const openingConstrained = constrainWallTranslationForOpenings(activeWall, normal, wallClearanceDistance);
      const distance = openingConstrained.distance;
      const movedStart = { x: start.x + normal.x * distance, y: start.y + normal.y * distance };
      const movedEnd = { x: end.x + normal.x * distance, y: end.y + normal.y * distance };
      // Repair small gaps left by earlier snapped edits and keep projected
      // junction endpoints rigidly attached during every wall translation.
      setWallsRespectingMeasurements((current) => {
        // Pointer-down can materialize a T-junction into a new wall vertex.
        // Build every drag frame from that normalized snapshot rather than the
        // pre-render state, which may still contain the original unsplit line.
        const nextWalls = activeWall.before.walls.map((wall) => {
        if (wall.id === activeWall.wallId) {
          const points = activeWall.points.map((point) => ({ ...point })); const closed = samePoint(points[0], points.at(-1)!);
          points[activeWall.segmentIndex] = { ...movedStart };
          points[endIndex] = { ...movedEnd };
          if (closed && activeWall.segmentIndex === 0) points[points.length - 1] = { ...points[0] };
          if (closed && endIndex === points.length - 1) points[0] = { ...points[endIndex] };
          const attachments = { ...wall.attachments };
          if (Math.abs(distance) > 1) {
            for (const pointIndex of activeWall.detachedPointIndices) {
              if (!activeWall.keepDetachedPointIndices.includes(pointIndex)) delete attachments[pointIndex];
            }
          }
          return { ...wall, points, attachments: Object.keys(attachments).length ? attachments : undefined };
        }
        // Explicit anchors are created when a wall starts or finishes on this segment.
        // Resolve every anchored point from the host segment itself instead of moving it
        // from its previous coordinates. That keeps a junction rigid and repairs a
        // legacy corner that has already drifted slightly away from its host wall.
        // Always identify connections from the drag-start snapshot. After the first
        // pointer update a connected point has already moved away from its original
        // coordinate, so comparing the live geometry on later updates loses the
        // junction and lets the selected wall continue moving on its own.
        const baselineWall = activeWall.before.walls.find((item) => item.id === wall.id) ?? wall;
        const attachments = { ...baselineWall.attachments };
        let points = baselineWall.points.map((point) => ({ ...point }));
        const closed = samePoint(baselineWall.points[0], baselineWall.points.at(-1)!);
        baselineWall.points.forEach((point, pointIndex) => {
          // A closed floorplan can contain the same physical junction in several
          // wall runs. Move every coincident corner, including interior points;
          // restricting this to run endpoints leaves the other wall behind and
          // visibly opens the room.
          if (closed && pointIndex === baselineWall.points.length - 1) return;
          const sharedTarget = samePoint(point, start) ? movedStart : samePoint(point, end) ? movedEnd : null;
          if (sharedTarget) {
            // Keep another wall's terminating endpoint in place. It is not an
            // interior anchor on the translated segment; retainDraggedWallConnections
            // adds the perpendicular bridge from this fixed junction to the moved
            // endpoint after all walls have been updated.
            return;
          }
          const attachment = baselineWall.attachments?.[pointIndex];
          if (attachment?.wallId === activeWall.wallId && attachment.segmentIndex === activeWall.segmentIndex) {
            const along = Math.max(0, Math.min(1, attachment.along));
            const target = { x: start.x + (end.x - start.x) * along + normal.x * distance, y: start.y + (end.y - start.y) * along + normal.y * distance };
            points = squaredWalls ? moveSquaredWallPoint(points, pointIndex, target) : points.map((candidate, index) => index === pointIndex ? target : candidate);
            return;
          }
          // A connected corner can be an interior point of a wall run (a T or
          // multi-room junction), not only a run endpoint. Keep its perpendicular
          // leg attached to the moving host segment so a wall is never left open.
          // Use a tight physical tolerance: a nearby, deliberately separate wall
          // must never be pulled onto the selected wall.
          if (hasPerpendicularConnectedLeg(baselineWall.points, pointIndex, start, end) && isPreciseWallJunction(point, start, end)) {
            const along = pointOnSegment(point, start, end).along;
            attachments[pointIndex] = { wallId: activeWall.wallId, segmentIndex: activeWall.segmentIndex, along };
            const target = { x: start.x + (end.x - start.x) * along + normal.x * distance, y: start.y + (end.y - start.y) * along + normal.y * distance };
            points = squaredWalls ? moveSquaredWallPoint(points, pointIndex, target) : points.map((candidate, index) => index === pointIndex ? target : candidate);
          }
        });
        return { ...wall, points, attachments: Object.keys(attachments).length ? attachments : undefined };
        }).map((wall) => ({ ...wall, points: samePoint(wall.points[0], wall.points.at(-1)!) ? [...wall.points.slice(0, -1), { ...wall.points[0] }] : wall.points }));
        const synchronizedWalls = reanchorAutoWallBridges(synchronizeConnectedJunctions(activeWall.before.walls, nextWalls, squaredWalls, activeWall.wallId, [activeWall.segmentIndex, endIndex]), activeWall.wallId);
        const fixedParallelWalls = preserveUnrelatedParallelWallSegments(activeWall.before.walls, synchronizedWalls, activeWall.wallId, activeWall.segmentIndex);
        const followedWalls = reanchorAttachedWallEndpoints(followTerminatingEndpointsOnTranslatedSegments(activeWall.before.walls, fixedParallelWalls, activeWall.wallId), activeWall.wallId);
        // Connections can point in either direction. When the selected wall's own
        // endpoint was attached to another wall, moving it beyond that host's end
        // needs a real bridge segment; otherwise the enclosing room graph opens.
        const connectedWalls = reanchorAutoWallBridges(retainDraggedWallConnections(activeWall.before.walls, followedWalls, activeWall.wallId, activeWall.segmentIndex), activeWall.wallId);
        const repairedParallelWalls = reanchorAutoWallBridges(preserveUnrelatedParallelWallSegments(activeWall.before.walls, connectedWalls, activeWall.wallId, activeWall.segmentIndex), activeWall.wallId);
        // The bridge repair above may inspect and temporarily translate the
        // entire graph. Restore existing walls which have no direct connection
        // to the dragged segment, then reanchor bridge endpoints without the
        // host-propagation step that could move those restored walls again.
        const isolatedWalls = preserveUnrelatedWallGeometry(activeWall.before.walls, repairedParallelWalls, activeWall.wallId, activeWall.segmentIndex);
        const finalWalls = materializeWallIntersections(reanchorAutoWallBridges(isolatedWalls, activeWall.wallId, false));
        const preservesConstraints = finalWalls.every((wall) => (!squaredWalls || hasOnlyOrthogonalSegments(wall.points)) && (wall.id !== activeWall.wallId || hasMinimumEnclosedArea(wall.points)));
        if (preservesConstraints) return assignStableCornerNumbers(finalWalls);

        // A translated open run can be rejected by the broad repair passes
        // when its attached room endpoint is also a shared corner.  Preserve
        // the direct segment translation as a safe fallback, reconnect it to
        // its drag-start hosts, and materialize any resulting T junctions.
        // This keeps a wall drag from silently becoming a no-op while retaining
        // the orthogonal and minimum-area guarantees above.
        const directCandidate = materializeWallIntersections(reanchorAutoWallBridges(
          retainDraggedWallConnections(activeWall.before.walls, nextWalls, activeWall.wallId, activeWall.segmentIndex),
          activeWall.wallId,
        ));
        const directConstraints = directCandidate.every((wall) => (!squaredWalls || hasOnlyOrthogonalSegments(wall.points)) && (wall.id !== activeWall.wallId || hasMinimumEnclosedArea(wall.points)));
        return directConstraints ? assignStableCornerNumbers(directCandidate) : current;
      });
      setOpenings(openingConstrained.openings);
      return;
    }
    if (!pointDrag.current) return;
    const activePoint = pointDrag.current;
    const { selection } = activePoint; const next = canvasPoint(event, false);
    // Work from the drag-start topology each frame. Updating only the clicked
    // point leaves coincident corners and attached wall runs behind, which opens
    // otherwise closed rooms. The repair pass preserves direct junctions and
    // creates a short bridging wall only when an endpoint has genuinely moved
    // off the wall it was attached to.
    setWallsRespectingMeasurements(() => moveCornerPreservingTopology(activePoint.before.walls, selection, next));
  }

  function finishPointDrag() {
    if (panDrag.current) { panDrag.current = null; return; }
    if (measurementDrag.current) { const before = measurementDrag.current.before; measurementDrag.current = null; record(before); return; }
    if (fixtureDrag.current) { fixtureDrag.current = null; return; }
    if (openingDrag.current) { const before = openingDrag.current.before; openingDrag.current = null; setLockedViewport(null); record(before); return; }
    if (wallDrag.current) { const before = wallDrag.current.historyBefore; wallDrag.current = null; setLockedViewport(null); record(before); return; }
    if (!pointDrag.current) return;
    const before = pointDrag.current.before; pointDrag.current = null; setLockedViewport(null); record(before);
    setOpenings((current) => current.filter((opening) => openingPlacementIsValid(opening, walls, current)));
  }

  function selectSegment(wallId: string, segmentIndex: number) {
    if (tool === "REMOVE") { removeSegment(wallId, segmentIndex); return; }
    if (tool === "ADD_CORNERS") { setSelectedSegment({ wallId, segmentIndex }); setSelectedPoint(null); return; }
    if (tool !== "SELECT") return;
    setSelectedSegment({ wallId, segmentIndex }); setSelectedPoint(null); setWallLengthInput(null); setOpeningParent(parentKey(wallId, segmentIndex));
  }

  function updateCoordinatePoint(wallId: string, pointIndex: number, next: Point2D, lengthOverride?: { segmentIndex: number; lengthMm: number }) {
    record();
    setWallsRespectingMeasurements((current) => {
      const moved = moveCornerPreservingTopology(current, { wallId, pointIndex }, next);
      if (!lengthOverride) return moved;
      return moved.map((wall) => wall.id === wallId ? { ...wall, lengthOverridesMm: { ...wall.lengthOverridesMm, [lengthOverride.segmentIndex]: lengthOverride.lengthMm } } : wall);
    });
  }

  function resetOpeningForm(kind = openingKind) {
    const item = defaultOpeningCatalogueItem(kind);
    setOpeningKind(kind); setOpeningCatalogueId(item?.id ?? ""); setOpeningOffset(100); setOpeningWidth(item?.width_mm ?? 800); setOpeningHeight(item?.height_mm ?? (kind === "DOOR" ? 2040 : 900)); setWindowSill(item?.fixture_kind === "WINDOW" ? Math.min(1200, Math.max(0, item.height_mm)) || 900 : 900);
    setDoorType(item?.fixture_kind === "DOOR" && item.subcategory.toLowerCase().includes("double") ? "DOUBLE" : "SINGLE"); setHingeSide("START"); setOpensInward(true); setOpeningError(null);
    setOpeningParent(selectedSegment ? parentKey(selectedSegment.wallId, selectedSegment.segmentIndex) : "");
  }

  function saveOpening() {
    setOpeningError(null);
    const option = segmentOptions.find((item) => item.key === openingParent);
    if (!option) { setOpeningError("Select a wall in the drawing first."); return; }
    const length = segmentLength(option.wall, option.segmentIndex);
    const corners = openingCornerOffsets(option.wall, option.segmentIndex);
    const blockers = openings.filter((item) => item.id !== selectedOpeningId && item.wallId === option.wall.id && item.segmentIndex === option.segmentIndex);
    if (!isOpeningPlacementValid(openingOffset, openingWidth, length, corners, [], OPENING_CORNER_CLEARANCE_MM)) { setOpeningError(`The opening must stay on its wall and at least ${formatLength(OPENING_CORNER_CLEARANCE_MM, displayUnits)} clear of every wall corner or junction.`); return; }
    // A new opening can inherit an occupied offset after selection or dragging.
    const offset = selectedOpeningId
      ? (isOpeningPlacementValid(openingOffset, openingWidth, length, corners, blockers, OPENING_CORNER_CLEARANCE_MM) ? openingOffset : null)
      : closestValidOpeningOffset(openingOffset, openingWidth, length, corners, blockers, OPENING_CORNER_CLEARANCE_MM);
    if (offset === null) { setOpeningError(selectedOpeningId ? "This opening overlaps another door or window. Choose a different offset." : "There is not enough free space on this wall for another opening of this width."); return; }
    record();
    const nextOpening: Omit<FullOpening, "id"> = { kind: openingKind, wallId: option.wall.id, segmentIndex: option.segmentIndex, offset, width: openingWidth, height: openingHeight, sill: openingKind === "WINDOW" ? windowSill : 0, hingeSide, doorType, opensInward, catalogueItemId: activeOpeningCatalogueItem?.id };
    if (selectedOpeningId) setOpenings((current) => current.map((item) => item.id === selectedOpeningId ? { ...nextOpening, id: item.id } : item));
    else setOpenings((current) => [...current, { ...nextOpening, id: crypto.randomUUID() }]);
    // Keep the selected catalogue variant and dimensions for repeated additions.
    // Resetting to the first default could silently change a single door to double.
    setSelectedOpeningId(null);
    setOpeningParent(option.key);
    setOpeningOffset(closestValidOpeningOffset(offset + openingWidth, openingWidth, length, corners, [...blockers, nextOpening], OPENING_CORNER_CLEARANCE_MM) ?? offset);
  }

  function cancelOpeningEdit() {
    setSelectedOpeningId(null); resetOpeningForm();
  }

  async function importDrawing(file?: File) {
    if (!file) return;
    const nextUrl = URL.createObjectURL(file);
    const importId = backgroundImportId.current + 1;
    backgroundImportId.current = importId;
    if (sourceUrl) URL.revokeObjectURL(sourceUrl);
    setSourceFile(file); setSourceUrl(nextUrl); setCanvasSize(DEFAULT_SIZE); setImporting(true); setImportError(null);
    if (isPdfFile(file)) {
      setImporting(false);
      return;
    }
    try {
      const dimensions = await readImageDimensions(nextUrl);
      if (backgroundImportId.current !== importId) {
        URL.revokeObjectURL(nextUrl);
        return;
      }
      setCanvasSize(dimensions);
    } catch (reason) {
      if (backgroundImportId.current !== importId) {
        URL.revokeObjectURL(nextUrl);
        return;
      }
      URL.revokeObjectURL(nextUrl);
      setSourceUrl(null); setSourceFile(null); setImportError(reason instanceof Error ? reason.message : "The drawing could not be loaded.");
    } finally {
      if (backgroundImportId.current === importId) setImporting(false);
    }
  }

  const processImportedDrawing = useEffectEvent((file: File) => importDrawing(file));
  useEffect(() => {
    if (!importFile) return;
    queueMicrotask(() => { void processImportedDrawing(importFile); });
  }, [importFile]);

  function selectedRoomDraft(): Room | null {
    return selectedRoom ? roomDraftForOutline(selectedRoom) : null;
  }

  const help = tool === "DRAW" ? "Click an existing wall or highlighted corner to start or finish a connected wall run. Existing corners are reused. Double-click, right-click, Enter, or Esc also confirms the run and exits Add wall." : tool === "ADD_CORNERS" ? "Click a wall to insert a corner exactly at that position. The selected wall stays active for further corners." : tool === "REMOVE" ? "Click one wall segment to remove only the portion between its two corners. Use Undo if needed." : tool === "ADD_MEASURE" ? `${measurementDraft.length ? "Now select a second matching" : "Select the first"} wall or corner to add a measurement.` : measurementEditEnabled ? "Drag measurements to reposition them, or drag a wall to reshape the plan. Right-click for direction or delete actions." : "Click a wall to select it, or drag any numbered corner to reshape the floorplan.";
  const vertexCount = walls.reduce((total, wall) => total + wall.points.slice(0, samePoint(wall.points[0], wall.points.at(-1)!) ? -1 : undefined).filter((_, index) => !wall.attachments?.[index]?.hideCorner).length, 0);
  const sourceTopLeft = toScreen({ x: 0, y: canvasSize.height }); const sourceBottomRight = toScreen({ x: canvasSize.width, y: 0 }); const sourceIsPdf = sourceFile ? isPdfFile(sourceFile) : false;

  const openingPanel = <section className="tool-section full-plan-openings-panel" aria-label="Add elements">
    <div className="mode-switch element-tabs" role="tablist" aria-label="Element type">{(["DOOR", "WINDOW", "FURNITURE"] as const).map(tab => <button key={tab} role="tab" aria-selected={elementTab === tab} className={elementTab === tab ? "active" : ""} onClick={() => tab === "FURNITURE" ? setElementTab(tab) : selectOpeningKind(tab)}>{tab === "FURNITURE" ? "Elements" : tab[0] + tab.slice(1).toLowerCase()}</button>)}</div>
    {elementTab === "FURNITURE" ? (selectedRoom ? <CatalogueFixtureEditor key={selectedRoom.id} apiUrl={apiUrl} room={selectedRoomDraft()!} displayUnits={displayUnits} onChange={onFixturesChange} /> : <p>Select or draw a closed room to add elements.</p>) : <>
    <p className="tool-note">Choose a wall, select a catalogue variant, then add or remove openings without leaving the plan.</p>
    <label className="field opening-catalogue-select"><span>{openingKind === "DOOR" ? "Door type" : "Window type"}</span><select aria-label={openingKind === "DOOR" ? "Door type" : "Window type"} value={activeOpeningCatalogueItem?.id ?? ""} onChange={(event) => applyOpeningCatalogueItem(openingCatalogueForKind.find((item) => item.id === event.target.value))}>{openingCatalogueForKind.length === 0 && <option value="">Loading catalogue variants…</option>}{openingCatalogueForKind.map((item) => <option key={item.id} value={item.id}>{item.subcategory} · {item.name}</option>)}</select></label>
    {activeOpeningCatalogueItem && <OpeningPreview item={activeOpeningCatalogueItem} kind={openingKind} doorType={doorType} width={openingWidth} height={openingHeight} />}
    {openingCatalogueError && <p className="inline-error">{openingCatalogueError}</p>}
    <div className="coordinate-fields opening-fields"><label className="field"><span>Parent wall</span><select value={openingParent} onChange={(event) => setOpeningParent(event.target.value)}><option value="">Select a wall…</option>{segmentOptions.map((item) => <option key={item.key} value={item.key}>{item.label}</option>)}</select></label>
    <label className="field"><span>Offset <small>{UNIT_LABEL[displayUnits]}</small></span><DisplayNumberInput minMm={0} valueMm={openingOffset} units={displayUnits} onMmChange={setOpeningOffset} /></label><label className="field"><span>Height <small>{UNIT_LABEL[displayUnits]}</small></span><DisplayNumberInput minMm={1} valueMm={openingHeight} units={displayUnits} onMmChange={setOpeningHeight} /></label><label className="field"><span>Width <small>{UNIT_LABEL[displayUnits]}</small></span><DisplayNumberInput minMm={1} valueMm={openingWidth} units={displayUnits} onMmChange={setOpeningWidth} /></label>{openingKind === "WINDOW" && <label className="field"><span>Sill <small>{UNIT_LABEL[displayUnits]}</small></span><DisplayNumberInput minMm={0} valueMm={windowSill} units={displayUnits} onMmChange={setWindowSill} /></label>}</div>
    {openingKind === "DOOR" && <div className="coordinate-fields"><label className="field"><span>Hinge side</span><select value={hingeSide} disabled={doorType === "DOUBLE"} onChange={(event) => setHingeSide(event.target.value as "START" | "END")}><option value="START">Wall start</option><option value="END">Wall end</option></select></label><label className="field"><span>Direction</span><select value={opensInward ? "IN" : "OUT"} onChange={(event) => setOpensInward(event.target.value === "IN")}><option value="IN">Into room</option><option value="OUT">Out of room</option></select></label></div>}
    {openingError && <p className="inline-error">{openingError}</p>}<div className="opening-form-actions">{selectedOpeningId && <button onClick={cancelOpeningEdit}>Cancel edit</button>}<button className="primary-small" onClick={saveOpening}>{selectedOpeningId ? `Update ${openingKind.toLowerCase()}` : `Add ${openingKind.toLowerCase()}`}</button></div>
    {openings.length > 0 && <div className="full-opening-list">{openings.map((opening, index) => { const item = catalogueItemForOpening(opening); return <div key={opening.id} className={selectedOpeningId === opening.id ? "editing" : ""}><span className={`opening-chip ${opening.kind.toLowerCase()}`}>{opening.kind}</span><small title={item?.name}>{item?.name ?? `${opening.kind === "DOOR" ? "Door" : "Window"} ${String(index + 1).padStart(3, "0")}`} · {formatLength(opening.width, displayUnits)}</small><button className="edit-opening" type="button" onClick={() => selectOpeningForEdit(opening)}>Edit</button><button aria-label={`Remove ${opening.kind.toLowerCase()}`} onClick={() => deleteOpeningById(opening.id)}>×</button></div>; })}</div>}
    </>}
  </section>;

  function exportSvgMarkup(styleChoice: ExportStyle = exportStyle, includeAttribution = true) {
    const source = Array.from(editorRoot.current?.querySelectorAll<SVGSVGElement>(".floor-canvas") ?? []).find((canvas) => !canvas.closest(".export-svg-preview"));
    if (!source) return null;
    const clone = source.cloneNode(true) as SVGSVGElement;
    clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");
    clone.setAttribute("width", String(FLOORPLAN_EXPORT_WIDTH));
    clone.setAttribute("height", String(FLOORPLAN_EXPORT_HEIGHT));
    clone.style.removeProperty("min-height");
    clone.style.removeProperty("height");
    clone.querySelectorAll<SVGForeignObjectElement>("foreignObject.room-name-editor").forEach((editor) => {
      const input = editor.querySelector<HTMLInputElement>("input");
      const label = document.createElementNS("http://www.w3.org/2000/svg", "text");
      const x = Number(editor.getAttribute("x") ?? "0") + Number(editor.getAttribute("width") ?? "0") / 2;
      const y = Number(editor.getAttribute("y") ?? "0") + Number(editor.getAttribute("height") ?? "0") / 2;
      label.setAttribute("class", "export-room-name"); label.setAttribute("x", String(x)); label.setAttribute("y", String(y));
      label.textContent = input?.value ?? input?.getAttribute("value") ?? "Room";
      editor.replaceWith(label);
    });
    clone.querySelectorAll(".full-plan-source-image").forEach((element) => element.remove());
    clone.querySelectorAll(".corner-connect-hit,.measurement-hit,.opening-hit,.opening-hit-area,.opening-swing-hit").forEach((element) => element.remove());
    if (includeAttribution) {
      const [viewBoxX = 0, viewBoxY = 0, viewBoxWidth = FLOORPLAN_EXPORT_WIDTH, viewBoxHeight = FLOORPLAN_EXPORT_HEIGHT] = (clone.getAttribute("viewBox") ?? "")
        .trim()
        .split(/[\s,]+/)
        .map(Number)
        .filter(Number.isFinite);
      const attributionLink = document.createElementNS("http://www.w3.org/2000/svg", "a");
      attributionLink.setAttribute("href", FLOORPLAN_EXPORT_ATTRIBUTION_URL);
      attributionLink.setAttributeNS("http://www.w3.org/1999/xlink", "xlink:href", FLOORPLAN_EXPORT_ATTRIBUTION_URL);
      attributionLink.setAttribute("aria-label", FLOORPLAN_EXPORT_ATTRIBUTION);
      const attribution = document.createElementNS("http://www.w3.org/2000/svg", "text");
      attribution.setAttribute("x", String(viewBoxX + viewBoxWidth - 12));
      attribution.setAttribute("y", String(viewBoxY + viewBoxHeight - 10));
      attribution.setAttribute("text-anchor", "end");
      attribution.setAttribute("fill", "#68756f");
      attribution.setAttribute("font-family", "Arial,sans-serif");
      attribution.setAttribute("font-size", "7.5");
      attribution.setAttribute("font-weight", "600");
      attribution.setAttribute("paint-order", "stroke");
      attribution.setAttribute("stroke", "#fff");
      attribution.setAttribute("stroke-width", "3");
      attribution.setAttribute("stroke-linejoin", "round");
      attribution.textContent = FLOORPLAN_EXPORT_ATTRIBUTION;
      attributionLink.appendChild(attribution);
      clone.appendChild(attributionLink);
    }
    const style = document.createElementNS("http://www.w3.org/2000/svg", "style");
    const effectiveStyle = styleChoice === "CURRENT" ? floorplanStyle : styleChoice;
    clone.classList.remove(...FLOORPLAN_STYLE_OPTIONS.map((option) => floorplanStyleClass(option.value)).filter(Boolean));
    clone.querySelectorAll(".coloured-fixture-symbol").forEach((symbol) => {
      const selectedClass = effectiveStyle === "MODERN" ? "symbol-modern" : effectiveStyle === "CREATIVE" ? "symbol-creative" : "symbol-default";
      symbol.querySelectorAll(".symbol-default,.symbol-modern,.symbol-creative").forEach((image) => {
        if (!image.classList.contains(selectedClass)) image.remove();
        else (image as SVGElement).style.display = "inline";
      });
      symbol.classList.remove("coloured-fixture-symbol");
    });
    clone.querySelectorAll(".styled-room-floors,.creative-garden,.creative-floor-wash").forEach((element) => {
      if (effectiveStyle === "CREATIVE" || (effectiveStyle === "MODERN" && element.classList.contains("styled-room-floors"))) (element as SVGElement).style.display = "inline";
      else element.remove();
    });
    const styleClass = floorplanStyleClass(effectiveStyle);
    if (styleClass) clone.classList.add(styleClass);
    // The preview sits inside the app's stylesheet; make this standalone export
    // stylesheet authoritative so it renders exactly like the saved SVG raster.
    style.textContent = floorplanExportCss(effectiveStyle).replace(/!important/g, "").replace(/:([^;{}]+)([;}])/g, ":$1 !important$2");
    clone.insertBefore(style, clone.firstChild);
    return new XMLSerializer().serializeToString(clone);
  }

  async function exportFloorplan() {
    setExporting(true); setExportError(null);
    try {
      const markup = exportSvgMarkup(exportStyle, false);
      if (!markup) throw new Error("The floorplan canvas is unavailable. Close this dialog and try again.");
      const extension = exportFormat.toLowerCase();
      const mimeType = exportFormat === "PDF" ? "application/pdf" : exportFormat === "JPG" ? "image/jpeg" : "image/png";
      const picker = (window as Window & { showSaveFilePicker?: (options: { suggestedName: string; types: Array<{ description: string; accept: Record<string, string[]> }> }) => Promise<SaveFileHandle> }).showSaveFilePicker;
      let destination: SaveFileHandle | null = null;
      // Request the location before rasterisation, while the Save click still has a user gesture.
      try {
        destination = picker ? await picker({ suggestedName: `floorplan-${exportStyle.toLowerCase()}.${extension}`, types: [{ description: `Floorplan ${exportFormat}`, accept: { [mimeType]: [`.${extension}`] } }] }) : null;
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") return;
        throw new Error("Could not select that save location. Please try again.");
      }
      const image = await new Promise<HTMLImageElement>((resolve, reject) => {
        const next = new Image();
        const timeout = window.setTimeout(() => reject(new Error("The floorplan image took too long to render. Please try again.")), 10_000);
        next.onload = () => { window.clearTimeout(timeout); resolve(next); };
        next.onerror = () => { window.clearTimeout(timeout); reject(new Error("The floorplan preview could not be rendered.")); };
        next.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(markup)}`;
      });
      const canvas = document.createElement("canvas"); canvas.width = FLOORPLAN_EXPORT_WIDTH; canvas.height = FLOORPLAN_EXPORT_HEIGHT;
      const context = canvas.getContext("2d");
      if (!context) throw new Error("The browser could not create an export canvas.");
      context.fillStyle = "#ffffff"; context.fillRect(0, 0, canvas.width, canvas.height); context.drawImage(image, 0, 0, canvas.width, canvas.height); drawFloorplanAttribution(context, canvas.width, canvas.height);
      const imageMime = exportFormat === "PNG" ? "image/png" : "image/jpeg";
      const imageBlob = await new Promise<Blob>((resolve, reject) => canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error("The image export could not be created.")), imageMime, .95));
      const output = exportFormat === "PDF" ? floorplanPdfBlobFromJpeg(await imageBlob.arrayBuffer(), canvas.width, canvas.height) : imageBlob;
      if (destination) { const writable = await destination.createWritable(); await writable.write(output); await writable.close(); } else { const url = URL.createObjectURL(output); const link = document.createElement("a"); link.href = url; link.download = `floorplan-${exportStyle.toLowerCase()}.${extension}`; link.click(); window.setTimeout(() => URL.revokeObjectURL(url), 1000); }
      setExportOpen(false);
    } catch (error) {
      setExportError(error instanceof Error ? error.message : "The floorplan export could not be created.");
    } finally { setExporting(false); }
  }

  const exportPreviewMarkup = exportOpen ? exportSvgMarkup() : null;
  const liveStyleCss = floorplanStyleCss(floorplanStyle);
  const exportStyleLabel = exportStyle === "CURRENT"
    ? `Current ${floorplanStyleLabel(floorplanStyle).toLowerCase()}`
    : `${floorplanStyleLabel(exportStyle).replace(/ style$/, "")} drawing`;
  const floorplanLeftDockIds = ["floorplan-build", "floorplan-properties", "floorplan-coordinates"].filter((id) => toolbarVisibility[id as ToolbarId]);
  const floorplanRightDockIds = ["floorplan-view", "floorplan-openings"].filter((id) => toolbarVisibility[id as ToolbarId]);
  const floorplanDock = (side: "LEFT" | "RIGHT", visibleIds: string[], activeId: string) => filledToolbarDock(side, visibleIds, activeId);
  const redundantHeightDimensions = redundantHeightDimensionIds(walls, rooms.length);
  const fixtureWallSpans = visibleFixtures.map((fixture) => ({ fixture, span: nearestFixtureWallSpan(fixture, walls) }));
  const wallVisualPaths = walls.flatMap((wall) => {
    const closed = samePoint(wall.points[0], wall.points.at(-1)!);
    const segments = wall.points.slice(0, -1).map((point, segmentIndex): WallRenderSegment => ({
      segmentIndex, start: toScreen(point), end: toScreen(wall.points[segmentIndex + 1]),
      thicknessMm: wallThicknessForSegment(wall, segmentIndex, wallThickness),
      visualThicknessMm: showWallThickness ? wallThicknessForSegment(wall, segmentIndex, wallThickness) : 0,
    }));
    return buildWallVisualRuns(segments, closed).map((run, index) => ({
      key: `${wall.id}:${index}`,
      width: showWallThickness ? Math.max(0, run.thicknessMm * activeViewport.scale) : 4,
      path: `${run.points.map((point, index) => `${index === 0 ? "M" : "L"} ${point.x} ${point.y}`).join(" ")}${run.closed ? " Z" : ""}`,
    }));
  });

  return <section ref={editorRoot} className={`editor-page full-plan-page ${floorplanStyleClass(floorplanStyle)}`.trim()}>
    {liveStyleCss && <style data-floorplan-style={floorplanStyle} dangerouslySetInnerHTML={{ __html: liveStyleCss }} />}
    <Popup open={pendingOutlineAction !== null} title="Start a new outline?" message="This will delete everything in the current floorplan and start a new outline. Do you want to continue?" onConfirm={confirmOutlineAction} onCancel={() => setPendingOutlineAction(null)} />
    <Popup open={pendingRoomRemovalId !== null} title="Remove room?" message={`${rooms.find((room) => room.id === pendingRoomRemovalId)?.name ?? "This room"} will be removed. Shared walls belonging to neighbouring rooms will be kept.`} confirmLabel="Remove room" onConfirm={removeSelectedRoom} onCancel={() => setPendingRoomRemovalId(null)} />
    {exportOpen && <div className="modal-backdrop floorplan-export-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !exporting) setExportOpen(false); }}><section className={`floorplan-export-dialog export-style-${exportStyle.toLowerCase()}`} role="dialog" aria-modal="true" aria-labelledby="floorplan-export-title"><header><div><span className="eyebrow">Floorplan export</span><h2 id="floorplan-export-title">Preview and save</h2></div><button type="button" className="modal-close" disabled={exporting} onClick={() => setExportOpen(false)}>×</button></header><div className="export-style-preview"><span>Preview</span><strong>{exportStyleLabel}</strong>{exportPreviewMarkup && <div className="export-svg-preview" dangerouslySetInnerHTML={{ __html: exportPreviewMarkup }} />}</div><label className="field"><span>Drawing style</span><select value={exportStyle} disabled={exporting} onChange={(event) => setExportStyle(event.target.value as ExportStyle)}><option value="CURRENT">Current style</option>{FLOORPLAN_STYLE_OPTIONS.filter((option) => option.value !== "DEFAULT").map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label><label className="field"><span>File format</span><select value={exportFormat} disabled={exporting} onChange={(event) => setExportFormat(event.target.value as ExportFormat)}><option value="PDF">PDF</option><option value="JPG">JPG</option><option value="PNG">PNG</option></select></label>{exportError && <p className="inline-error">{exportError}</p>}<footer><button type="button" disabled={exporting} onClick={() => setExportOpen(false)}>Cancel</button><button className="primary" type="button" disabled={exporting} onClick={() => { void exportFloorplan(); }}>{exporting ? "Preparing export…" : `Save as ${exportFormat}`}</button></footer></section></div>}
    {measurementContextMenu && <div className={`floorplan-context-menu ${measurementContextMenu.custom ? "" : "floorplan-value-menu measurement-value-menu"}`} role="menu" aria-label="Measurement actions" style={{ left: measurementContextMenu.x, top: measurementContextMenu.y }} onContextMenu={(event) => event.preventDefault()}>
      <strong>{measurementContextMenu.custom ? "Measurement" : "Wall measurement"}</strong>
      {measurementContextMenu.custom && <><button type="button" role="menuitem" onClick={() => setMeasurementDirection(measurementContextMenu.id, "NORMAL")}>Normal direction</button>
      <button type="button" role="menuitem" onClick={() => setMeasurementDirection(measurementContextMenu.id, "HORIZONTAL")}>Horizontal dimension only</button>
      <button type="button" role="menuitem" onClick={() => setMeasurementDirection(measurementContextMenu.id, "VERTICAL")}>Vertical dimension only</button></>}
      {!measurementContextMenu.custom && (() => {
        const separator = measurementContextMenu.id.lastIndexOf(":");
        const wall = walls.find((item) => item.id === measurementContextMenu.id.slice(0, separator));
        const segmentIndex = Number(measurementContextMenu.id.slice(separator + 1));
        const currentLength = wall ? wallLengthForSegment(wall, segmentIndex) : 0;
        return <><label>Wall length <small>{UNIT_LABEL[displayUnits]}</small><DisplayNumberInput minMm={1} valueMm={measurementLengthInput ?? currentLength} units={displayUnits} onMmChange={setMeasurementLengthInput} onKeyDown={(event) => handleMeasurementValueMenuKeyDown(event, () => applyAutoMeasurementValue(measurementContextMenu.id), closeAutoMeasurementValueMenu)} /></label><button type="button" role="menuitem" onClick={() => applyAutoMeasurementValue(measurementContextMenu.id)}>Apply wall length</button></>;
      })()}
      <button type="button" role="menuitem" className="danger-button" onClick={() => deleteMeasurement(measurementContextMenu.id, measurementContextMenu.custom)}>{measurementContextMenu.custom ? "Delete measurement" : "Hide measurement"}</button>
    </div>}
    {openingMeasurementContextMenu && (() => { const opening = openings.find((item) => item.id === openingMeasurementContextMenu.id); const labels = ["Distance from wall start", "Opening width", "Distance to wall end"]; return opening ? <div className="floorplan-context-menu floorplan-value-menu measurement-value-menu" role="menu" aria-label="Opening measurement value" style={{ left: openingMeasurementContextMenu.x, top: openingMeasurementContextMenu.y }} onContextMenu={(event) => event.preventDefault()}><strong>{opening.kind === "WINDOW" ? "Window" : "Door"} measurement</strong><label>{labels[openingMeasurementContextMenu.section]} <small>{UNIT_LABEL[displayUnits]}</small><DisplayNumberInput minMm={0} valueMm={openingMeasurementValueInput ?? openingMeasurementValue(opening, openingMeasurementContextMenu.section)} units={displayUnits} onMmChange={setOpeningMeasurementValueInput} onKeyDown={(event) => handleMeasurementValueMenuKeyDown(event, applyOpeningMeasurementValue, closeOpeningMeasurementValueMenu)} /></label>{openingMeasurementError && <p className="inline-error">{openingMeasurementError}</p>}<button type="button" role="menuitem" onClick={applyOpeningMeasurementValue}>Apply value</button></div> : null; })()}
    {fixtureMeasurementContextMenu && (() => { const fixture = fixtures.find((item) => item.id === fixtureMeasurementContextMenu.id); const labels = ["Distance from wall start", "Element width", "Distance to wall end"]; return fixture ? <div className="floorplan-context-menu floorplan-value-menu measurement-value-menu" role="menu" aria-label="Element measurement value" style={{ left: fixtureMeasurementContextMenu.x, top: fixtureMeasurementContextMenu.y }} onContextMenu={(event) => event.preventDefault()}><strong>{fixture.name} measurement</strong><label>{labels[fixtureMeasurementContextMenu.section]} <small>{UNIT_LABEL[displayUnits]}</small><DisplayNumberInput minMm={fixtureMeasurementContextMenu.section === 1 ? 1 : 0} valueMm={fixtureMeasurementValueInput ?? fixtureMeasurementValue(fixture, fixtureMeasurementContextMenu.section)} units={displayUnits} onMmChange={setFixtureMeasurementValueInput} onKeyDown={(event) => handleMeasurementValueMenuKeyDown(event, applyFixtureMeasurementValue, closeFixtureMeasurementValueMenu)} /></label>{fixtureMeasurementError && <p className="inline-error">{fixtureMeasurementError}</p>}<button type="button" role="menuitem" onClick={applyFixtureMeasurementValue}>Apply value</button></div> : null; })()}
    {openingContextMenu && <div className="floorplan-context-menu" role="menu" aria-label="Opening actions" style={{ left: openingContextMenu.x, top: openingContextMenu.y }} onContextMenu={(event) => event.preventDefault()}>
      <strong>{openings.find((opening) => opening.id === openingContextMenu.id)?.kind === "WINDOW" ? "Window" : "Door"}</strong>
      <button type="button" role="menuitem" onClick={() => { setOpeningContextMenu(null); }}>Edit values</button>
      <button type="button" role="menuitem" className="danger-button" onClick={() => { const id = openingContextMenu.id; setOpeningContextMenu(null); deleteOpeningById(id); }}>Delete opening</button>
    </div>}
    {fixtureContextMenu && (() => { const fixture = fixtures.find((item) => item.id === fixtureContextMenu.id); return fixture ? <div className="floorplan-context-menu floorplan-value-menu" role="menu" aria-label="Fixture values" style={{ left: fixtureContextMenu.x, top: fixtureContextMenu.y }} onContextMenu={(event) => event.preventDefault()}><strong>{fixture.name}</strong><div className="context-coordinate-fields"><label>X <small>{UNIT_LABEL[displayUnits]}</small><DisplayNumberInput valueMm={fixture.center.x} units={displayUnits} onMmChange={(value) => updateFixture(fixture.id, (item) => ({ ...item, center: { ...item.center, x: value } }))} /></label><label>Y <small>{UNIT_LABEL[displayUnits]}</small><DisplayNumberInput valueMm={fixture.center.y} units={displayUnits} onMmChange={(value) => updateFixture(fixture.id, (item) => ({ ...item, center: { ...item.center, y: value } }))} /></label><label>Width <small>{UNIT_LABEL[displayUnits]}</small><DisplayNumberInput minMm={1} valueMm={fixture.dimensions.width.value} units={displayUnits} onMmChange={(value) => updateFixture(fixture.id, (item) => ({ ...item, dimensions: { ...item.dimensions, width: { ...item.dimensions.width, value } } }))} /></label><label>Depth <small>{UNIT_LABEL[displayUnits]}</small><DisplayNumberInput minMm={1} valueMm={fixture.dimensions.depth.value} units={displayUnits} onMmChange={(value) => updateFixture(fixture.id, (item) => ({ ...item, dimensions: { ...item.dimensions, depth: { ...item.dimensions.depth, value } } }))} /></label></div><button type="button" role="menuitem" onClick={() => setFixtureContextMenu(null)}>Done</button></div> : null; })()}
    {contextMenu && <div className="floorplan-context-menu floorplan-value-menu" role="menu" aria-label={`${contextMenu.kind === "WALL" ? "Wall" : "Corner"} actions`} style={{ left: contextMenu.x, top: contextMenu.y }} onContextMenu={(event) => event.preventDefault()}>
      <strong>{contextMenu.kind === "WALL" ? "Wall" : "Corner"}</strong>
      {contextMenu.kind === "WALL" && selectedWall && <><label>Wall length <small>{UNIT_LABEL[displayUnits]}</small><DisplayNumberInput minMm={1} valueMm={wallLengthInput ?? wallLengthForSegment(selectedWall, contextMenu.segmentIndex)} units={displayUnits} onMmChange={setWallLengthInput} /></label><button type="button" role="menuitem" onClick={() => { applySelectedWallLength(); setContextMenu(null); }}>Apply wall length</button><label>Wall thickness <small>{UNIT_LABEL[displayUnits]}</small><DisplayNumberInput minMm={1} maxMm={2000} valueMm={wallThicknessInput?.key === `${contextMenu.wallId}:${contextMenu.segmentIndex}` ? wallThicknessInput.value : wallThicknessForSegment(selectedWall, contextMenu.segmentIndex, wallThickness)} units={displayUnits} onMmChange={(value) => setWallThicknessInput({ key: `${contextMenu.wallId}:${contextMenu.segmentIndex}`, value })} /></label><button type="button" role="menuitem" onClick={() => { setSelectedWallThickness(contextMenu.wallId, contextMenu.segmentIndex, wallThicknessInput?.key === `${contextMenu.wallId}:${contextMenu.segmentIndex}` ? wallThicknessInput.value : wallThicknessForSegment(selectedWall, contextMenu.segmentIndex, wallThickness)); setContextMenu(null); }}>Apply wall thickness</button><small className="context-help">Defaults to overall {formatLength(wallThickness, displayUnits)}.</small><button type="button" role="menuitem" onClick={() => resetSelectedWallThickness(contextMenu.wallId, contextMenu.segmentIndex)} disabled={selectedWall.thicknessOverridesMm?.[contextMenu.segmentIndex] === undefined}>Use overall thickness</button><button type="button" role="menuitem" className="danger-button" onClick={() => { const target = contextMenu; setContextMenu(null); removeSegment(target.wallId, target.segmentIndex); }}>Delete wall segment</button></>}
      {contextMenu.kind === "POINT" && selectedPointWall && selectedPointValue && <><div className="context-coordinate-fields"><label>X <small>{UNIT_LABEL[displayUnits]}</small><DisplayNumberInput valueMm={selectedPointValue.x} units={displayUnits} onMmChange={(value) => updateCoordinatePoint(contextMenu.wallId, contextMenu.pointIndex, { ...selectedPointValue, x: value })} /></label><label>Y <small>{UNIT_LABEL[displayUnits]}</small><DisplayNumberInput valueMm={selectedPointValue.y} units={displayUnits} onMmChange={(value) => updateCoordinatePoint(contextMenu.wallId, contextMenu.pointIndex, { ...selectedPointValue, y: value })} /></label></div><button type="button" role="menuitem" onClick={() => setContextMenu(null)}>Done</button><button type="button" role="menuitem" className="danger-button" onClick={() => { const target = contextMenu; setContextMenu(null); deletePointAt(target); }}>Delete corner</button></>}
    </div>}
    {toolbarContextMenu && <ToolbarContextMenu x={toolbarContextMenu.x} y={toolbarContextMenu.y} toolbars={FLOORPLAN_TOOLBARS} visibility={toolbarVisibility} onToggle={onToggleToolbar} onClose={() => setToolbarContextMenu(null)} />}
    <div className="editor-intro"><h1>Draw the complete floorplan</h1><p className="editor-context-help">{help}</p></div>
    <div className="editor-layout full-plan-layout">
      <aside className="editor-tools full-plan-controls">
        {toolbarVisibility["floorplan-build"] && <FloatingToolbar title="Build floorplan" defaultPosition={{ x: 16, y: 58 }} dock={fillToolbarLayout ? floorplanDock("LEFT", floorplanLeftDockIds, "floorplan-build") : { side: "LEFT", slot: 0, slots: 4 }} layoutResetKey={toolbarLayoutResetKey} maxHeight={Math.max(360, FLOOR_PLAN_CANVAS_HEIGHT - 74)} onClose={() => onToggleToolbar("floorplan-build")}>
        <section className="tool-section">
          <div className="button-grid">
            <button onClick={() => requestOutlineAction("EMPTY")}>New outline</button>
            <button className={tool === "SELECT" && !addRoomPanelOpen ? "active" : ""} onClick={() => { setAddRoomPanelOpen(false); setTool("SELECT"); setDraft([]); setLockedViewport(null); }}>Modify</button>
            <button onClick={() => requestOutlineAction("RECTANGLE")}>Rectangle</button>
            <button className={lShapePickerOpen ? "active" : ""} aria-expanded={lShapePickerOpen} aria-controls="full-l-shape-picker" onClick={() => lShapePickerOpen ? setLShapePickerOpen(false) : requestOutlineAction("L_SHAPE")}>L-shape</button>
          </div>
          {lShapePickerOpen && <div className="l-shape-picker" id="full-l-shape-picker"><div><span>Choose the L orientation</span><button type="button" aria-label="Close L-shape chooser" onClick={() => setLShapePickerOpen(false)}>×</button></div><p>Select the position of the internal notch. You can reshape every wall afterwards.</p><div className="l-shape-options">{L_SHAPE_TEMPLATES.map((template) => <button key={template.id} type="button" onClick={() => applyTemplate(template.points)}><span className="l-shape-thumbnail"><i style={{ clipPath: template.preview }} /></span><strong>{template.name}</strong></button>)}</div></div>}
          <div className="full-plan-action-divider" aria-hidden="true" />
          <div className="button-grid full-plan-action-row" role="group" aria-label="Wall tools"><button className={tool === "DRAW" ? "active" : ""} onClick={() => { setTool("DRAW"); setDraft([]); setLockedViewport(null); setSelectedSegment(null); setSelectedPoint(null); }}>Add wall</button><button className={tool === "REMOVE" ? "active danger-button" : "danger-button"} onClick={() => { if (selectedSegment) { removeSegment(selectedSegment.wallId, selectedSegment.segmentIndex); return; } setTool("REMOVE"); setDraft([]); setLockedViewport(null); setSelectedPoint(null); }}>Remove wall</button></div>
          <div className="button-grid full-plan-action-row" role="group" aria-label="Corner tools"><button className={tool === "ADD_CORNERS" ? "active" : ""} onClick={() => { const firstWall = walls[0]; setTool("ADD_CORNERS"); setDraft([]); setLockedViewport(viewport); setSelectedPoint(null); setSelectedSegment((current) => current ?? (firstWall ? { wallId: firstWall.id, segmentIndex: 0 } : null)); }}>Add corners</button><button className="danger-button" disabled={!selectedPoint} onClick={deletePoint}>Remove corner</button></div>
          <div className="full-plan-action-divider" aria-hidden="true" />
          <div className="button-grid full-plan-action-row" role="group" aria-label="Room tools"><button className={addRoomPanelOpen ? "active" : ""} aria-pressed={addRoomPanelOpen} onClick={() => { setAddRoomPanelOpen((current) => !current); setTool("SELECT"); setRoomActionError(null); }}>Add room</button><button className="danger-button" disabled={!selectedRoom} onClick={requestRemoveSelectedRoom}>Remove room</button></div>
          {addRoomPanelOpen && <div className="room-action-panel"><p>Select a boundary wall to create a new room on the outside of it</p><label className="field"><span>Room depth ({UNIT_LABEL[displayUnits]})</span><DisplayNumberInput minMm={200} valueMm={roomDepthInput} units={displayUnits} onMmChange={setRoomDepthInput} /></label><button className="review-style-button" aria-label="Apply Add room" onClick={addSelectedRoom}>Add room</button></div>}
          {roomActionError && <p className="inline-error" role="alert">{roomActionError}</p>}
          <div className="button-grid editor-history-row"><button title="Undo last operation (Ctrl+Z)" onClick={undo} disabled={!history.length}>↶ Undo</button><button title="Redo last operation (Ctrl+Y)" onClick={redo} disabled={!future.length}>↷ Redo</button></div>
          <div className="plan-constraint-controls">
            <label className="snap-control-row"><input type="checkbox" checked={snapEnabled} onChange={(event) => setSnapEnabled(event.target.checked)} /><span><span>Snap to grid</span><small>– {UNIT_LABEL[displayUnits]}</small></span><DisplayNumberInput className="snap-size-input" minMm={1} valueMm={snapSize} units={displayUnits} disabled={!snapEnabled} onMmChange={setSnapSize} /></label>
            <label className="check-row square-walls-control"><input type="checkbox" checked={squaredWalls} onChange={(event) => { const next = event.target.checked; setSquaredWalls(next); if (next) { record(); setWallsRespectingMeasurements((current) => current.map((wall) => ({ ...wall, points: squareWallPoints(wall.points) })), true, true); } }} /><span>Keep walls horizontal or vertical</span></label>
            <div className="measurement-mode-row"><label className="check-row measurement-edit-toggle"><input type="checkbox" checked={measurementEditEnabled} onChange={(event) => { setMeasurementEditEnabled(event.target.checked); setMeasurementDraft([]); setSelectedMeasurement(null); setMeasurementContextMenu(null); setTool(event.target.checked ? "MEASURE" : "SELECT"); }} /><span>Edit measurements</span></label><div className="button-grid measurement-action-row"><button type="button" className={tool === "ADD_MEASURE" ? "active" : ""} onClick={() => { setTool("ADD_MEASURE"); setMeasurementEditEnabled(false); setMeasurementDraft([]); setSelectedMeasurement(null); setSelectedSegment(null); setSelectedPoint(null); }}>Add measurement</button></div></div>
          </div>
          {measurementEditEnabled && selectedMeasurement && <div className="selected-properties measurement-properties"><div className="tool-heading"><span>M</span><h2>Selected measurement</h2></div><p className="tool-note">Drag this measurement on the drawing, right-click it for actions, or remove it.</p><button className="danger-button" onClick={deleteSelectedMeasurement}>Delete measurement</button></div>}
          {tool === "SELECT" && selectedSegment && selectedWall && <div className="selected-properties">
            <label className="field"><span>Select a wall and define new length below ({UNIT_LABEL[displayUnits]})</span><div className="field-action-row"><DisplayNumberInput minMm={1} valueMm={wallLengthInput ?? wallLengthForSegment(selectedWall, selectedSegment.segmentIndex)} units={displayUnits} onMmChange={setWallLengthInput} /><button className="review-style-button" onClick={applySelectedWallLength}>Apply wall length</button></div></label>
            <label className="field"><span>Select a wall and define the new wall thickness ({UNIT_LABEL[displayUnits]})</span><div className="field-action-row"><DisplayNumberInput minMm={1} maxMm={2000} valueMm={wallThicknessInput?.key === `${selectedWall.id}:${selectedSegment.segmentIndex}` ? wallThicknessInput.value : wallThicknessForSegment(selectedWall, selectedSegment.segmentIndex, wallThickness)} units={displayUnits} onMmChange={(value) => setWallThicknessInput({ key: `${selectedWall.id}:${selectedSegment.segmentIndex}`, value })} /><button className="review-style-button" onClick={() => setSelectedWallThickness(selectedWall.id, selectedSegment.segmentIndex, wallThicknessInput?.key === `${selectedWall.id}:${selectedSegment.segmentIndex}` ? wallThicknessInput.value : wallThicknessForSegment(selectedWall, selectedSegment.segmentIndex, wallThickness))}>Apply wall thickness</button></div></label>
            <button className="review-style-button" type="button" disabled={selectedWall.thicknessOverridesMm?.[selectedSegment.segmentIndex] === undefined} onClick={() => { resetSelectedWallThickness(selectedWall.id, selectedSegment.segmentIndex); setWallThicknessInput(null); }}>Use default thickness</button>
          </div>}
          {tool === "SELECT" && selectedPoint && selectedPointWall && selectedPointValue && <div className="selected-properties"><div className="tool-heading"><span>V{(wallVertexStarts.get(selectedPointWall.id) ?? 1) + selectedPoint.pointIndex}</span><h2>Selected corner</h2></div><div className="coordinate-fields"><label className="field"><span>X <small>{UNIT_LABEL[displayUnits]}</small></span><DisplayNumberInput valueMm={selectedPointValue.x} units={displayUnits} onMmChange={(value) => updateCoordinatePoint(selectedPointWall.id, selectedPoint.pointIndex, { ...selectedPointValue, x: value })} /></label><label className="field"><span>Y <small>{UNIT_LABEL[displayUnits]}</small></span><DisplayNumberInput valueMm={selectedPointValue.y} units={displayUnits} onMmChange={(value) => updateCoordinatePoint(selectedPointWall.id, selectedPoint.pointIndex, { ...selectedPointValue, y: value })} /></label></div><div className="button-grid"><button onClick={insertPointAfterSelected} disabled={!samePoint(selectedPointWall.points[0], selectedPointWall.points.at(-1)!) && selectedPoint.pointIndex >= selectedPointWall.points.length - 1}>Add corner after</button><button className="danger-button" onClick={deletePoint}>Delete corner</button></div></div>}
        </section></FloatingToolbar>}
          {toolbarVisibility["floorplan-properties"] && <FloatingToolbar title="Overall properties" defaultPosition={{ x: 364, y: 58 }} dock={fillToolbarLayout ? floorplanDock("LEFT", floorplanLeftDockIds, "floorplan-properties") : { side: "LEFT", slot: 1, slots: 4 }} layoutResetKey={toolbarLayoutResetKey} maxHeight={260} onClose={() => onToggleToolbar("floorplan-properties")}>
        <section className="tool-section"><div className="coordinate-fields room-measurements"><label className="field"><span>Wall height ({UNIT_LABEL[displayUnits]})</span><DisplayNumberInput minMm={1} maxMm={100000} valueMm={wallHeight} units={displayUnits} onMmChange={setWallHeight} /></label></div><label className="field"><span>Default wall thickness ({UNIT_LABEL[displayUnits]})</span><div className="field-action-row default-wall-thickness-row"><DisplayNumberInput minMm={1} maxMm={2000} valueMm={defaultWallThicknessInput ?? wallThickness} units={displayUnits} onMmChange={setDefaultWallThicknessInput} /><button className="review-style-button" onClick={() => { record(); setWallThickness(defaultWallThicknessInput ?? wallThickness); setDefaultWallThicknessInput(null); }}>Define default</button></div></label></section>
        </FloatingToolbar>}
      </aside>

      <main className="drawing-column full-plan-drawing">
        <div className="resizable-floorplan-window">
         {toolbarVisibility["floorplan-view"] && <FloatingToolbar title="View properties" defaultPosition={{ x: 364, y: 16 }} dock={fillToolbarLayout ? floorplanDock("RIGHT", floorplanRightDockIds, "floorplan-view") : { side: "RIGHT", slot: 0, slots: 3 }} layoutResetKey={toolbarLayoutResetKey} maxHeight={320} onClose={() => onToggleToolbar("floorplan-view")}><div className="drawing-toolbar floating-canvas-navigation"><div className="drawing-zoom" role="group" aria-label="Floorplan view properties"><button type="button" aria-label="Zoom out" onClick={() => setZoom((current) => Math.max(.5, current - .2))}>−</button><button type="button" aria-label="Reset zoom to 100%" onClick={() => setZoom(1)}>{Math.round(zoom * 100)}%</button><button type="button" aria-label="Zoom in" onClick={() => setZoom((current) => Math.min(3, current + .2))}>+</button><button type="button" className="fit-view-button" onClick={() => { setZoom(1); setPan({ x: 0, y: 0 }); setLockedViewport(null); }}>Fit</button></div><div className="view-property-grid-row" role="group" aria-label="Grid settings"><button type="button" className={showGrid ? "active" : ""} aria-pressed={showGrid} onClick={() => setShowGrid((current) => !current)}>Grid</button><label className="view-property-grid-size"><span>Grid size <small>{UNIT_LABEL[displayUnits]}</small></span><DisplayNumberInput aria-label={`Grid size (${UNIT_LABEL[displayUnits]})`} className="view-grid-size-input" minMm={1} valueMm={actualGridSizeMm} units={displayUnits} onMmChange={setSnapSize} /></label></div><div className="view-property-toggle-row" role="group" aria-label="Floorplan display options"><label className="view-property-checkbox"><input type="checkbox" checked={showRoomNames} onChange={(event) => setShowRoomNames(event.target.checked)} /><span>Show/Hide room names</span></label><label className="view-property-checkbox"><input type="checkbox" checked={showMeasurements} onChange={(event) => { const enabled = event.target.checked; setShowMeasurements(enabled); if (enabled) { setShowDoorWindowMeasurements(true); setShowElementMeasurements(true); } }} /><span>Show/Hide all measurements</span></label></div><div className="view-property-toggle-row" role="group" aria-label="Opening and element measurement options"><label className="view-property-checkbox"><input type="checkbox" checked={showDoorWindowMeasurements} onChange={(event) => setShowDoorWindowMeasurements(event.target.checked)} /><span>Show/Hide Door and Windows measurements</span></label><label className="view-property-checkbox"><input type="checkbox" checked={showElementMeasurements} onChange={(event) => setShowElementMeasurements(event.target.checked)} /><span>Show/Hide Elements measurements</span></label></div><label className="view-property-checkbox"><input type="checkbox" checked={showWallThickness} onChange={(event) => setShowWallThickness(event.target.checked)} /><span>Show wall thickness</span></label><strong>{vertexCount} vertices · {walls.length} wall run{walls.length === 1 ? "" : "s"}</strong><button type="button" className="review-style-button floorplan-background-action" disabled={!sourceUrl} onClick={clearImportedDrawing}>Remove background image</button></div></FloatingToolbar>}
         <div className="full-plan-canvas">{(importing || importError) && <div className={`floorplan-import-status ${importError ? "error" : ""}`} role={importError ? "alert" : "status"}>{importing ? "Importing drawing…" : importError}</div>}{sourceUrl && sourceIsPdf && <embed src={sourceUrl} type="application/pdf" />}
          <FloorPlanCanvas className={`mode-${tool.toLowerCase()}`} showGrid={showGrid} gridSpacing={gridSpacing} gridOrigin={gridOrigin} underlay={Boolean(sourceUrl)} role="img" aria-label="Interactive complete building floorplan" onWheel={zoomWithWheel} onPointerDownCapture={beginPan} onPointerMove={movePoint} onPointerUp={finishPointDrag} onPointerCancel={finishPointDrag} onPointerDown={(event) => {
            if (tool === "ADD_CORNERS" && event.button === 0 && event.detail <= 1) { if (selectedSegment) insertPointAt(selectedSegment.wallId, selectedSegment.segmentIndex, canvasPoint(event, false)); return; }
            if (tool !== "DRAW" || event.button !== 0 || event.detail > 1) { if (event.target === event.currentTarget && tool === "SELECT") { setSelectedSegment(null); setSelectedPoint(null); setSelectedOpeningId(null); setOpeningParent(""); setOpeningError(null); setSelectedMeasurement(null); } return; }
            const rawRequested = canvasPoint(event, false); const cornerHit = findCornerNear(rawRequested);
            if (cornerHit) { connectDraftToCorner(cornerHit); return; }
            const requested = canvasPoint(event); const closes = draft.length >= 3 && samePoint(requested, draft[0], 16);
            if (closes) { commitDraft(squaredWalls ? orthogonalPathTo(draft, draft[0]) : [...draft, draft[0]]); return; }
            const wallHit = findWallSegmentNear(canvasPoint(event, false));
            if (wallHit) { connectDraftToWall(wallHit.wallId, wallHit.segmentIndex, canvasPoint(event, false)); return; }
            if (!draft.length) setLockedViewport(viewport);
            setDraft((current) => current.length && squaredWalls ? [...current, squareDrawPoint(current.at(-1)!, requested)] : [...current, requested]);
          }} onDoubleClick={(event) => { if (tool !== "DRAW") return; event.preventDefault(); commitDraft(); }} onContextMenu={(event) => { const target = event.target; const background = target === event.currentTarget || (target instanceof SVGElement && target.classList.contains("canvas-background")); if (!background) return; event.preventDefault(); if (tool === "DRAW") { commitDraft(); return; } setSelectedSegment(null); setSelectedPoint(null); setSelectedOpeningId(null); setSelectedMeasurement(null); setContextMenu(null); setToolbarContextMenu({ x: Math.max(8, Math.min(event.clientX, window.innerWidth - 480)), y: Math.max(8, Math.min(event.clientY, window.innerHeight - 330)) }); }}>
             {sourceUrl && !sourceIsPdf && <image href={sourceUrl} x={sourceTopLeft.x} y={sourceTopLeft.y} width={sourceBottomRight.x - sourceTopLeft.x} height={sourceBottomRight.y - sourceTopLeft.y} preserveAspectRatio="none" className="full-plan-source-image" />}
            {walls.length === 0 && draft.length === 0 && <g className="full-plan-empty"><text x="410" y="270">Start with Add wall or import a drawing as a background reference</text><text x="410" y="292">The editor uses consistent scale, dimensions, and draggable handles.</text></g>}
            {detectedRooms.map((room) => { const outline = room.vertices.map(toScreen); return <polygon key={`room-background-${room.id}`} points={outline.map((point) => `${point.x},${point.y}`).join(" ")} className="room-polygon" />; })}
            <FloorplanAtmosphere rooms={planRooms} toScreen={toScreen} />
            {rooms.map((room, index) => {
              const outline = room.vertices.map(toScreen); const visualCentre = roomVisualCentre(room.vertices); const centre = toScreen(visualCentre);
              return <g key={`room-highlight-${room.id}`} className={`full-room-highlight room-colour-${room.colourIndex ?? index % 6} ${selectedRoomId === room.id ? "selected" : ""}`} onPointerDown={(event) => { if (tool !== "DRAW") { event.stopPropagation(); setSelectedRoomId(room.id); } }}><polygon points={outline.map((point) => `${point.x},${point.y}`).join(" ")} />{showRoomNames && <foreignObject className="room-name-editor" x={centre.x - 82} y={centre.y - 17} width="164" height="34"><input aria-label={`Name ${room.name}`} value={room.name} onPointerDown={(event) => { if (tool !== "DRAW") { event.stopPropagation(); setSelectedRoomId(room.id); } }} onChange={(event) => { const name = event.target.value; setRooms((current) => current.map((item) => item.id === room.id ? { ...item, name } : item)); }} /></foreignObject>}</g>;
            })}
            {fixtureWallSpans.map(({ fixture, span }, fixtureIndex) => {
              const width = fixture.dimensions.width.value; const depth = fixture.dimensions.depth.value;
              const topLeft = toScreen({ x: fixture.center.x - width / 2, y: fixture.center.y + depth / 2 }); const bottomRight = toScreen({ x: fixture.center.x + width / 2, y: fixture.center.y - depth / 2 });
              const centre = toScreen(fixture.center);
              const lane = span ? fixtureWallSpans.slice(0, fixtureIndex).filter((item) => item.span?.wallId === span.wallId && item.span.segmentIndex === span.segmentIndex).length : 0;
              return <g key={`fixture-${fixture.id}`} className="floorplan-fixture" onPointerDown={(event) => beginFixtureDrag(event, fixture)} onContextMenu={(event) => openFixtureContextMenu(event, fixture)}><FixturePlanSymbol obstacle={fixture} x={centre.x} y={centre.y} width={bottomRight.x - topLeft.x} depth={bottomRight.y - topLeft.y} />{showMeasurements && showElementMeasurements && span && <FloorPlanFixtureDimensions span={span} lane={lane} toScreen={toScreen} displayUnits={displayUnits} onMeasurementContextMenu={measurementEditEnabled ? (event, section) => openFixtureMeasurementContextMenu(event, fixture, section) : undefined} onMeasurementDoubleClick={measurementEditEnabled ? (event, section) => openFixtureMeasurementContextMenu(event, fixture, section) : undefined} />}</g>;
            })}
            <g pointerEvents="none">
              {["outline", "fill"].map((layer) => <g key={layer}>{wallVisualPaths.map((run) =>
                <path key={run.key} className={layer === "outline" ? "wall-body" : "wall-line"} style={{ "--wall-stroke-width": `${run.width + 2}px`, "--wall-inner-stroke-width": `${run.width}px` } as CSSProperties} d={run.path} fill="none" strokeLinecap="square" strokeLinejoin="miter" pointerEvents="none" />
              )}</g>)}
            </g>
            {walls.map((wall) => {
              const closed = samePoint(wall.points[0], wall.points.at(-1)!); const modelPoints = closed ? wall.points.slice(0, -1) : wall.points; const screenPoints = modelPoints.map(toScreen); const centre = screenPoints.reduce((total, point) => ({ x: total.x + point.x / screenPoints.length, y: total.y + point.y / screenPoints.length }), { x: 0, y: 0 });
              const wallSegments = wall.points.slice(0, -1).map((modelStart, segmentIndex): WallRenderSegment => { const start = toScreen(modelStart); const end = toScreen(wall.points[segmentIndex + 1]); const thicknessMm = wallThicknessForSegment(wall, segmentIndex, wallThickness); return { segmentIndex, start, end, thicknessMm, visualThicknessMm: showWallThickness ? thicknessMm : 0 }; });

              const dimensions = wall.points.slice(0, -1).map((modelStart, segmentIndex) => {
                const modelEnd = wall.points[segmentIndex + 1]; const length = wallLengthForSegment(wall, segmentIndex); const start = toScreen(modelStart); const end = toScreen(modelEnd); const screenLength = Math.hypot(end.x - start.x, end.y - start.y) || 1; const tangent = { x: (end.x - start.x) / screenLength, y: (end.y - start.y) / screenLength }; const candidate = { x: -tangent.y, y: tangent.x }; const midpoint = { x: (start.x + end.x) / 2, y: (start.y + end.y) / 2 }; const dot = (midpoint.x - centre.x) * candidate.x + (midpoint.y - centre.y) * candidate.y; const outward = dot >= 0 ? candidate : { x: -candidate.x, y: -candidate.y }; const dimensionId = `${wall.id}:${segmentIndex}`; if (hiddenDimensions.includes(dimensionId) || redundantHeightDimensions.has(dimensionId)) return null; const offset = dimensionOffsets[dimensionId] ?? Math.max(32, (200 + (showWallThickness ? wallThicknessForSegment(wall, segmentIndex, wallThickness) / 2 : 0)) * activeViewport.scale); const first = { x: start.x + outward.x * offset, y: start.y + outward.y * offset }; const second = { x: end.x + outward.x * offset, y: end.y + outward.y * offset }; const label = { x: (first.x + second.x) / 2 + outward.x * MEASUREMENT_LABEL_GAP_SCREEN, y: (first.y + second.y) / 2 + outward.y * MEASUREMENT_LABEL_GAP_SCREEN }; const manual = wall.lengthOverridesMm?.[segmentIndex] !== undefined;
                return <g key={`${wall.id}-dimension-${segmentIndex}`} className={`wall-dimension measurement-item measurement-context-target ${manual ? "manual-measurement" : ""} ${tool === "MEASURE" ? "editable" : ""} ${selectedMeasurement === `auto:${dimensionId}` ? "selected" : ""}`} onPointerDown={(event) => beginMeasurementDrag(event, dimensionId, false, offset, outward)} onContextMenu={(event) => openAutoMeasurementContextMenu(event, { wallId: wall.id, segmentIndex })}><line className="measurement-hit" x1={first.x} y1={first.y} x2={second.x} y2={second.y} /><line className="dimension-extension" x1={start.x + outward.x * 7} y1={start.y + outward.y * 7} x2={first.x + outward.x * 4} y2={first.y + outward.y * 4} /><line className="dimension-extension" x1={end.x + outward.x * 7} y1={end.y + outward.y * 7} x2={second.x + outward.x * 4} y2={second.y + outward.y * 4} /><line className="dimension-line" x1={first.x} y1={first.y} x2={second.x} y2={second.y} /><line className="dimension-tick" x1={first.x - tangent.x * 4 + outward.x * 4} y1={first.y - tangent.y * 4 + outward.y * 4} x2={first.x + tangent.x * 4 - outward.x * 4} y2={first.y + tangent.y * 4 - outward.y * 4} /><line className="dimension-tick" x1={second.x - tangent.x * 4 + outward.x * 4} y1={second.y - tangent.y * 4 + outward.y * 4} x2={second.x + tangent.x * 4 - outward.x * 4} y2={second.y + tangent.y * 4 - outward.y * 4} /><text className={`wall-label ${manual ? "manual-measurement-value" : ""}`} x={label.x} y={label.y}>{formatLength(length, displayUnits)}</text></g>;
              });
              return (
                <g key={wall.id} className={tool === "REMOVE" ? "removable" : ""}>
                  {wallSegments.map(({ segmentIndex, start, end, thicknessMm }) => {
                    const selection = { wallId: wall.id, segmentIndex };
                    const chosen = measurementDraft.some((reference) => reference.kind === "WALL" && reference.wallId === wall.id && reference.segmentIndex === segmentIndex);
                    const isOverride = showMeasurements && showWallThickness && wall.thicknessOverridesMm?.[segmentIndex] !== undefined;
                    const innerStrokeWidth = showWallThickness ? Math.max(0, thicknessMm * activeViewport.scale) : 4;
                    const strokeWidth = innerStrokeWidth + 2;
                    const screenLength = Math.hypot(end.x - start.x, end.y - start.y) || 1;
                    const normal = { x: -(end.y - start.y) / screenLength, y: (end.x - start.x) / screenLength };
                    const label = { x: (start.x + end.x) / 2 + normal.x * (strokeWidth / 2 + 14), y: (start.y + end.y) / 2 + normal.y * (strokeWidth / 2 + 14) };
                    const selected = selectedSegment?.wallId === wall.id && selectedSegment.segmentIndex === segmentIndex;
                    const hovered = hoveredSegment?.wallId === wall.id && hoveredSegment.segmentIndex === segmentIndex;
                    const wallStyle = { "--wall-stroke-width": `${strokeWidth}px`, "--wall-inner-stroke-width": `${innerStrokeWidth}px`, "--wall-hit-stroke-width": `${Math.max(strokeWidth, 24)}px` } as CSSProperties;
                    return <g key={`${wall.id}-segment-${segmentIndex}`}>
                      {(selected || hovered || chosen) && <line className={`wall-selection-line ${chosen ? "measurement-chosen" : ""}`} style={wallStyle} x1={start.x} y1={start.y} x2={end.x} y2={end.y} />}
                      <line className="wall-interaction-line" style={wallStyle} x1={start.x} y1={start.y} x2={end.x} y2={end.y} onPointerEnter={() => setHoveredSegment(selection)} onPointerLeave={() => setHoveredSegment((current) => current?.wallId === wall.id && current.segmentIndex === segmentIndex ? null : current)} onContextMenu={(event) => openWallContextMenu(event, selection)} onPointerDown={(event) => { event.stopPropagation(); const svg = event.currentTarget.ownerSVGElement; if (tool === "DRAW" && svg) { connectDraftToWall(wall.id, segmentIndex, canvasPointFromClient(event.clientX, event.clientY, svg, false)); return; } if (tool === "ADD_CORNERS" && svg) { insertPointAt(wall.id, segmentIndex, canvasPointFromClient(event.clientX, event.clientY, svg, false)); return; } if (tool === "ADD_MEASURE") { addMeasurementReference({ kind: "WALL", ...selection }); return; } if (tool === "SELECT" || tool === "MEASURE") { beginWallDrag(event, wall, segmentIndex); return; } selectSegment(wall.id, segmentIndex); }} />
                      {isOverride && <text className="wall-thickness-label" x={label.x} y={label.y}>{`${formatLength(thicknessMm, displayUnits)} thick`}</text>}
                    </g>;
                  })}
                  {showMeasurements && dimensions}
                </g>
              );
            })}
            {showMeasurements && measurements.map((measurement) => {
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
              const label = { x: (first.x + second.x) / 2 + normal.x * MEASUREMENT_LABEL_GAP_SCREEN, y: (first.y + second.y) / 2 + normal.y * MEASUREMENT_LABEL_GAP_SCREEN };
              return <g key={measurement.id} className={`wall-dimension custom-measurement measurement-item measurement-context-target ${tool === "MEASURE" ? "editable" : ""} ${selectedMeasurement === `custom:${measurement.id}` ? "selected" : ""}`} onPointerDown={(event) => beginMeasurementDrag(event, measurement.id, true, measurement.offset, normal)} onContextMenu={(event) => openMeasurementContextMenu(event, measurement.id)}><line className="measurement-hit" x1={first.x} y1={first.y} x2={second.x} y2={second.y} /><line className="dimension-extension" x1={start.x} y1={start.y} x2={first.x} y2={first.y} /><line className="dimension-extension" x1={end.x} y1={end.y} x2={second.x} y2={second.y} /><line className="dimension-line" x1={first.x} y1={first.y} x2={second.x} y2={second.y} /><line className="dimension-tick" x1={first.x - tangent.x * 4 + normal.x * 4} y1={first.y - tangent.y * 4 + normal.y * 4} x2={first.x + tangent.x * 4 - normal.x * 4} y2={first.y + tangent.y * 4 - normal.y * 4} /><line className="dimension-tick" x1={second.x - tangent.x * 4 + normal.x * 4} y1={second.y - tangent.y * 4 + normal.y * 4} x2={second.x + tangent.x * 4 - normal.x * 4} y2={second.y + tangent.y * 4 - normal.y * 4} /><text className="wall-label" x={label.x} y={label.y}>{formatLength(length, displayUnits)}</text></g>;
            })}
            {draft.length > 0 && <polyline points={draft.map(toScreen).map((point) => `${point.x},${point.y}`).join(" ")} className="full-wall-draft" />}
            {openings.map((opening) => {
              const wall = walls.find((item) => item.id === opening.wallId); const wallStart = wall?.points[opening.segmentIndex]; const wallEnd = wall?.points[opening.segmentIndex + 1];
              if (!wall || !wallStart || !wallEnd) return null;
              const wallPoints = samePoint(wall.points[0], wall.points.at(-1)!) ? wall.points.slice(0, -1) : wall.points;
              const wallCentre = wallPoints.reduce((total, point) => ({ x: total.x + point.x / wallPoints.length, y: total.y + point.y / wallPoints.length }), { x: 0, y: 0 });
              const lane = openings.filter((item) => item.wallId === opening.wallId && item.segmentIndex === opening.segmentIndex).findIndex((item) => item.id === opening.id);
              const graphic: FloorPlanOpeningGraphic = { id: opening.id, kind: opening.kind, offset: opening.offset, width: opening.width, doorType: opening.doorType, hingeSide: opening.hingeSide, opensInward: opening.opensInward, windowPaneCount: opening.kind === "WINDOW" ? windowPaneCountFor(opening) : undefined };
              return showMeasurements && showDoorWindowMeasurements && <FloorPlanOpeningDimensions key={`opening-dimensions-${opening.id}`} opening={graphic} wallStart={wallStart} wallEnd={wallEnd} wallCentre={wallCentre} lane={lane} toScreen={toScreen} displayUnits={displayUnits} onMeasurementContextMenu={measurementEditEnabled ? (event, section) => openOpeningMeasurementContextMenu(event, opening, section) : undefined} onMeasurementDoubleClick={measurementEditEnabled ? (event, section) => openOpeningMeasurementContextMenu(event, opening, section) : undefined} />;
            })}
            {openings.map((opening) => {
              const wall = walls.find((item) => item.id === opening.wallId); const wallStart = wall?.points[opening.segmentIndex]; const wallEnd = wall?.points[opening.segmentIndex + 1];
              if (!wall || !wallStart || !wallEnd) return null;
              const graphic: FloorPlanOpeningGraphic = { id: opening.id, kind: opening.kind, offset: opening.offset, width: opening.width, doorType: opening.doorType, hingeSide: opening.hingeSide, opensInward: opening.opensInward, windowPaneCount: opening.kind === "WINDOW" ? windowPaneCountFor(opening) : undefined };
              return <FloorPlanOpeningSymbol key={opening.id} opening={graphic} wallThicknessScreen={showWallThickness ? wallThicknessForSegment(wall, opening.segmentIndex, wallThickness) * activeViewport.scale : 10} wallStart={wallStart} wallEnd={wallEnd} toScreen={toScreen} displayUnits={displayUnits} selected={selectedOpeningId === opening.id} onPointerDown={(event) => beginOpeningDrag(event, opening)} onContextMenu={(event) => openOpeningContextMenu(event, opening)} />;
            })}
            <g className="vertex-layer">{walls.flatMap((wall) => { const closed = samePoint(wall.points[0], wall.points.at(-1)!); const firstNumber = wallVertexStarts.get(wall.id) ?? 1; return wall.points.slice(0, closed ? -1 : undefined).map((modelPoint, pointIndex) => ({ modelPoint, pointIndex })).filter(({ pointIndex }) => !wall.attachments?.[pointIndex]?.hideCorner).map(({ modelPoint, pointIndex }, visibleIndex) => { const point = toScreen(modelPoint); const selection = { wallId: wall.id, pointIndex }; const chosen = measurementDraft.some((reference) => reference.kind === "POINT" && reference.wallId === wall.id && reference.pointIndex === pointIndex); const reusable = tool === "DRAW" && hoveredCorner?.wallId === wall.id && hoveredCorner.pointIndex === pointIndex; const clearHoveredCorner = () => { if (tool === "DRAW") setHoveredCorner((current) => current?.wallId === wall.id && current.pointIndex === pointIndex ? null : current); }; return <g key={`${wall.id}-point-${pointIndex}`}><circle cx={point.x} cy={point.y} r={selectedPoint?.wallId === wall.id && selectedPoint.pointIndex === pointIndex ? "12" : "10"} className={`vertex-handle full-plan-vertex ${tool === "SELECT" || tool === "ADD_MEASURE" ? "editable" : ""} ${reusable ? "draw-connect-target" : ""} ${selectedPoint?.wallId === wall.id && selectedPoint.pointIndex === pointIndex ? "selected" : ""} ${chosen ? "measurement-chosen" : ""}`} onPointerEnter={() => { if (tool === "DRAW") setHoveredCorner(selection); }} onPointerLeave={clearHoveredCorner} onContextMenu={(event) => openPointContextMenu(event, selection)} onPointerDown={(event) => { if (tool === "DRAW" && event.button === 0) { event.stopPropagation(); connectDraftToCorner(selection); return; } if (tool === "ADD_MEASURE") { event.stopPropagation(); addMeasurementReference({ kind: "POINT", ...selection }); return; } beginPointDrag(event, selection); }} /><text className="vertex-label" x={point.x} y={point.y + 3}>{wall.cornerNumbers?.[pointIndex] ?? firstNumber + visibleIndex}</text>{tool === "DRAW" && <circle cx={point.x} cy={point.y} r="22" className="corner-connect-hit" onPointerEnter={() => setHoveredCorner(selection)} onPointerLeave={clearHoveredCorner} onPointerMove={(event) => event.stopPropagation()} onPointerDown={(event) => { if (event.button === 0) { event.stopPropagation(); connectDraftToCorner(selection); } }} />}</g>; }); })}</g>
            {draft.map((modelPoint, index) => { const point = toScreen(modelPoint); return <circle key={`draft-${index}`} cx={point.x} cy={point.y} r="7" className="full-plan-draft-node" />; })}
          </FloorPlanCanvas>
        </div><div className="drawing-scale"><span>Coordinates and dimensions shown in {UNIT_LABEL[displayUnits]} · calculations remain millimetre-authoritative</span><span>Shared floorplan engine auto-fits the complete plan</span></div>
        </div>
      </main>

      <aside className="coordinate-panel full-plan-side-column">
        {toolbarVisibility["floorplan-coordinates"] && <FloatingToolbar title="Coordinates" defaultPosition={{ x: 662, y: 58 }} dock={fillToolbarLayout ? floorplanDock("LEFT", floorplanLeftDockIds, "floorplan-coordinates") : { side: "LEFT", slot: 3, slots: 4 }} layoutResetKey={toolbarLayoutResetKey} maxHeight={450} onClose={() => onToggleToolbar("floorplan-coordinates")}>
        <section className="tool-section"><p className="tool-note">Modify any X, Y corner coordinates here to update the drawing</p><div className="coordinate-input-list" aria-label={`Floorplan coordinates in ${UNIT_LABEL[displayUnits]}`}><div className="coordinate-table-heading"><span>Corner ID</span><span>X</span><span>Y</span></div>{coordinateEntries.map(({ wall, point, pointIndex, cornerNumber }) => { const rowKey = `${wall.id}:${pointIndex}`; const selected = selectedPoint?.wallId === wall.id && selectedPoint.pointIndex === pointIndex; return <div key={`${wall.id}-coordinate-${pointIndex}`} ref={(element) => { if (element) coordinateRowRefs.current.set(rowKey, element); else coordinateRowRefs.current.delete(rowKey); }} className={`coordinate-row ${selected ? "selected" : ""}`} onClick={() => { setSelectedPoint({ wallId: wall.id, pointIndex }); setSelectedSegment(null); }}><span className="coordinate-prefix">{cornerNumber}</span><DisplayNumberInput aria-label={`Corner ${cornerNumber} X coordinate`} valueMm={point.x} units={displayUnits} onMmChange={(value) => updateCoordinatePoint(wall.id, pointIndex, { ...point, x: value })} /><DisplayNumberInput aria-label={`Corner ${cornerNumber} Y coordinate`} valueMm={point.y} units={displayUnits} onMmChange={(value) => updateCoordinatePoint(wall.id, pointIndex, { ...point, y: value })} /></div>; })}</div></section>
        </FloatingToolbar>}
        {toolbarVisibility["floorplan-openings"] && <FloatingToolbar title="Add elements" defaultPosition={{ x: 662, y: 370 }} dock={fillToolbarLayout ? floorplanDock("RIGHT", floorplanRightDockIds, "floorplan-openings") : { side: "RIGHT", slot: 2, slots: 3 }} layoutResetKey={toolbarLayoutResetKey} maxHeight={520} onClose={() => onToggleToolbar("floorplan-openings")}>{openingPanel}</FloatingToolbar>}
      </aside>
    </div>
  </section>;
}
