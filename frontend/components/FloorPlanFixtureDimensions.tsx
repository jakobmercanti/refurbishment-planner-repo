import type { MouseEvent as ReactMouseEvent, PointerEvent as ReactPointerEvent } from "react";
import type { Obstacle, Point2D } from "@/lib/types";
import { formatLength, type DisplayUnits } from "@/lib/units";

type BoundaryWall = { id: string; points: Point2D[] };

export type FixtureWallSpan = {
  wallId: string;
  segmentIndex: number;
  wallStart: Point2D;
  wallEnd: Point2D;
  elementStart: Point2D;
  elementEnd: Point2D;
  elementCentre: Point2D;
  startOffsetMm: number;
  widthMm: number;
  endOffsetMm: number;
};

function fixtureCorners(obstacle: Obstacle): Point2D[] {
  const angle = obstacle.rotation_deg * Math.PI / 180;
  const cosine = Math.cos(angle);
  const sine = Math.sin(angle);
  const halfWidth = obstacle.dimensions.width.value / 2;
  const halfDepth = obstacle.dimensions.depth.value / 2;
  return ([-1, 1] as const).flatMap((widthSide) => ([-1, 1] as const).map((depthSide) => {
    const localX = widthSide * halfWidth;
    const localY = depthSide * halfDepth;
    return {
      x: obstacle.center.x + localX * cosine + localY * sine,
      y: obstacle.center.y + localX * sine - localY * cosine,
    };
  }));
}

/** Finds the boundary wall that the element is closest to and projects its footprint onto that wall. */
export function nearestFixtureWallSpan(obstacle: Obstacle, walls: BoundaryWall[]): FixtureWallSpan | null {
  const corners = fixtureCorners(obstacle);
  const candidates = walls.flatMap((wall) => wall.points.slice(0, -1).flatMap((wallStart, segmentIndex) => {
    const wallEnd = wall.points[segmentIndex + 1];
    if (!wallEnd) return [];
    const dx = wallEnd.x - wallStart.x;
    const dy = wallEnd.y - wallStart.y;
    const length = Math.hypot(dx, dy);
    if (!length) return [];
    const direction = { x: dx / length, y: dy / length };
    const centreAlong = (obstacle.center.x - wallStart.x) * direction.x + (obstacle.center.y - wallStart.y) * direction.y;
    const closestAlong = Math.max(0, Math.min(length, centreAlong));
    const closestPoint = { x: wallStart.x + direction.x * closestAlong, y: wallStart.y + direction.y * closestAlong };
    const cornerAlong = corners.map((corner) => (corner.x - wallStart.x) * direction.x + (corner.y - wallStart.y) * direction.y);
    const elementStartAlong = Math.max(0, Math.min(length, Math.min(...cornerAlong)));
    const elementEndAlong = Math.max(0, Math.min(length, Math.max(...cornerAlong)));
    if (elementEndAlong <= elementStartAlong) return [];
    return [{
      wallId: wall.id,
      segmentIndex,
      wallStart,
      wallEnd,
      elementStart: { x: wallStart.x + direction.x * elementStartAlong, y: wallStart.y + direction.y * elementStartAlong },
      elementEnd: { x: wallStart.x + direction.x * elementEndAlong, y: wallStart.y + direction.y * elementEndAlong },
      elementCentre: obstacle.center,
      startOffsetMm: elementStartAlong,
      widthMm: elementEndAlong - elementStartAlong,
      endOffsetMm: length - elementEndAlong,
      distance: Math.hypot(obstacle.center.x - closestPoint.x, obstacle.center.y - closestPoint.y),
    }];
  }));
  return candidates.sort((first, second) => first.distance - second.distance)[0] ?? null;
}

type FixtureDimensionProps = {
  span: FixtureWallSpan;
  lane?: number;
  toScreen: (point: Point2D) => Point2D;
  displayUnits: DisplayUnits;
  onMeasurementContextMenu?: (event: ReactMouseEvent<SVGGElement>, section: number) => void;
  onMeasurementDoubleClick?: (event: ReactMouseEvent<SVGGElement>, section: number) => void;
};

export function FloorPlanFixtureDimensions({ span, lane = 0, toScreen, displayUnits, onMeasurementContextMenu, onMeasurementDoubleClick }: FixtureDimensionProps) {
  const wallStart = toScreen(span.wallStart);
  const wallEnd = toScreen(span.wallEnd);
  const elementStart = toScreen(span.elementStart);
  const elementEnd = toScreen(span.elementEnd);
  const elementCentre = toScreen(span.elementCentre);
  const pixelLength = Math.hypot(wallEnd.x - wallStart.x, wallEnd.y - wallStart.y) || 1;
  const tangent = { x: (wallEnd.x - wallStart.x) / pixelLength, y: (wallEnd.y - wallStart.y) / pixelLength };
  const candidate = { x: -tangent.y, y: tangent.x };
  const wallMidpoint = { x: (wallStart.x + wallEnd.x) / 2, y: (wallStart.y + wallEnd.y) / 2 };
  const outwardDot = (elementCentre.x - wallMidpoint.x) * candidate.x + (elementCentre.y - wallMidpoint.y) * candidate.y;
  const outward = outwardDot >= 0 ? { x: -candidate.x, y: -candidate.y } : candidate;
  const rowOffset = 34 + lane * 20;
  const points = [wallStart, elementStart, elementEnd, wallEnd].map((point) => ({ x: point.x + outward.x * rowOffset, y: point.y + outward.y * rowOffset }));
  const values = [span.startOffsetMm, span.widthMm, span.endOffsetMm];
  const labels = ["Distance from wall start", "Element width", "Distance to wall end"];
  const hasMeasurementActions = Boolean(onMeasurementContextMenu || onMeasurementDoubleClick);

  return <g className={`fixture-dimension ${hasMeasurementActions ? "measurement-context-target" : ""}`} aria-label={`Element dimensions: ${labels.map((label, index) => `${label} ${formatLength(values[index], displayUnits)}`).join(", ")}`} onPointerDown={(event: ReactPointerEvent<SVGGElement>) => { if (hasMeasurementActions) event.stopPropagation(); }}>
    {values.map((value, index) => {
      const first = points[index]; const second = points[index + 1];
      const label = { x: (first.x + second.x) / 2 + outward.x * 9, y: (first.y + second.y) / 2 + outward.y * 9 };
      return <g key={index} onContextMenu={(event) => onMeasurementContextMenu?.(event, index)} onDoubleClick={(event) => onMeasurementDoubleClick?.(event, index)}><line className="dimension-extension" x1={first.x - outward.x * 5} y1={first.y - outward.y * 5} x2={first.x + outward.x * 3} y2={first.y + outward.y * 3} /><line className="dimension-extension" x1={second.x - outward.x * 5} y1={second.y - outward.y * 5} x2={second.x + outward.x * 3} y2={second.y + outward.y * 3} /><line className="dimension-line" x1={first.x} y1={first.y} x2={second.x} y2={second.y} /><line className="dimension-tick" x1={first.x - tangent.x * 3 - outward.x * 3} y1={first.y - tangent.y * 3 - outward.y * 3} x2={first.x + tangent.x * 3 + outward.x * 3} y2={first.y + tangent.y * 3 + outward.y * 3} /><line className="dimension-tick" x1={second.x - tangent.x * 3 - outward.x * 3} y1={second.y - tangent.y * 3 - outward.y * 3} x2={second.x + tangent.x * 3 + outward.x * 3} y2={second.y + tangent.y * 3 + outward.y * 3} /><text className="fixture-dimension-label" x={label.x} y={label.y}>{formatLength(value, displayUnits)}</text></g>;
    })}
  </g>;
}
