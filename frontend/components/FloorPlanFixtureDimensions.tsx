import type { MouseEvent as ReactMouseEvent, PointerEvent as ReactPointerEvent } from "react";
import type { Obstacle, Point2D } from "@/lib/types";
import { formatLength, type DisplayUnits } from "@/lib/units";

export type FixtureDimensionSection = 0 | 1;

type BoundaryWall = { id: string; points: Point2D[] };

type FixtureRoomSpacingProps = {
  obstacle: Obstacle;
  roomVertices: Point2D[];
  toScreen: (point: Point2D) => Point2D;
  displayUnits: DisplayUnits;
  viewportScale?: number;
  axisFilter?: ReadonlyArray<"X" | "Y">;
};

/** The selected element's projection onto its nearest wall. */
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
  return ([-1, 1] as const).flatMap((widthSide) => ([-1, 1] as const).map((depthSide) => ({
    x: obstacle.center.x + widthSide * halfWidth * cosine + depthSide * halfDepth * sine,
    y: obstacle.center.y + widthSide * halfWidth * sine - depthSide * halfDepth * cosine,
  })));
}

function lineIntervals(vertices: Point2D[], lineAxis: "x" | "y", coordinate: number): Array<[number, number]> {
  if (vertices.length < 3 || !Number.isFinite(coordinate)) return [];
  const alongAxis = lineAxis === "x" ? "y" : "x";
  const intersections: number[] = [];
  for (let index = 0; index < vertices.length; index += 1) {
    const start = vertices[index];
    const end = vertices[(index + 1) % vertices.length];
    const startLine = start[lineAxis];
    const endLine = end[lineAxis];
    if (Math.abs(endLine - startLine) < 1e-9) continue;
    // A half-open edge rule avoids counting a polygon corner twice when the
    // dimension rail passes directly through a vertex.
    const lower = Math.min(startLine, endLine);
    const upper = Math.max(startLine, endLine);
    if (coordinate < lower - 1e-6 || coordinate >= upper - 1e-6) continue;
    const ratio = (coordinate - startLine) / (endLine - startLine);
    intersections.push(start[alongAxis] + (end[alongAxis] - start[alongAxis]) * ratio);
  }
  intersections.sort((first, second) => first - second);
  const intervals: Array<[number, number]> = [];
  for (let index = 0; index + 1 < intersections.length; index += 2) {
    const first = intersections[index];
    const second = intersections[index + 1];
    if (second - first > 1e-6) intervals.push([first, second]);
  }
  return intervals;
}

function intervalForRange(vertices: Point2D[], lineAxis: "x" | "y", coordinate: number, rangeStart: number, rangeEnd: number): [number, number] | null {
  const low = Math.min(rangeStart, rangeEnd);
  const high = Math.max(rangeStart, rangeEnd);
  const intervals = lineIntervals(vertices, lineAxis, coordinate);
  return intervals
    .filter(([start, end]) => start <= low + 1e-3 && end >= high - 1e-3)
    .sort((first, second) => (Math.abs((first[0] + first[1]) / 2 - (low + high) / 2) - Math.abs((second[0] + second[1]) / 2 - (low + high) / 2)))[0]
    ?? null;
}

type RoomRail = { coordinate: number; interval: [number, number]; side: "before" | "after"; score: number };

function railInterval(vertices: Point2D[], lineAxis: "x" | "y", desiredCoordinate: number, fallbackCoordinate: number, rangeStart: number, rangeEnd: number, side: "before" | "after"): RoomRail | null {
  const low = Math.min(rangeStart, rangeEnd);
  const high = Math.max(rangeStart, rangeEnd);
  const candidates = [desiredCoordinate, ...Array.from({ length: 24 }, (_, index) => desiredCoordinate + (fallbackCoordinate - desiredCoordinate) * (index + 1) / 24), fallbackCoordinate];
  const boundaryCoordinates = vertices.map((point) => point[lineAxis]);
  const boundaryMin = Math.min(...boundaryCoordinates);
  const boundaryMax = Math.max(...boundaryCoordinates);
  const valid = candidates.flatMap((coordinate): RoomRail[] => {
    if (side === "before" && coordinate > low - 1e-3) return [];
    if (side === "after" && coordinate < high + 1e-3) return [];
    const interval = intervalForRange(vertices, lineAxis, coordinate, rangeStart, rangeEnd);
    if (!interval) return [];
    const boundaryClearance = Math.max(0, Math.min(coordinate - boundaryMin, boundaryMax - coordinate));
    const elementClearance = side === "before" ? low - coordinate : coordinate - high;
    return [{ coordinate, interval, side, score: Math.min(boundaryClearance, Math.max(0, elementClearance)) }];
  });
  return valid.sort((first, second) => second.score - first.score || Math.abs(first.coordinate - desiredCoordinate) - Math.abs(second.coordinate - desiredCoordinate))[0] ?? null;
}

/** Finds the boundary wall closest to the element and its three wall-span values. */
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
  obstacle: Obstacle;
  measurementId: string;
  lane?: number;
  toScreen: (point: Point2D) => Point2D;
  displayUnits: DisplayUnits;
  hiddenMeasurementIds?: ReadonlyArray<string>;
  onMeasurementPointerDown?: (event: ReactPointerEvent<SVGGElement>, section: FixtureDimensionSection) => void;
  onMeasurementContextMenu?: (event: ReactMouseEvent<SVGGElement>, section: FixtureDimensionSection) => void;
  onMeasurementDoubleClick?: (event: ReactMouseEvent<SVGGElement>, section: FixtureDimensionSection) => void;
};

/** Renders the selected element's true local X (width) and Y (depth) dimensions. */
export function FloorPlanFixtureDimensions({ obstacle, measurementId, lane = 0, toScreen, displayUnits, hiddenMeasurementIds = [], onMeasurementPointerDown, onMeasurementContextMenu, onMeasurementDoubleClick }: FixtureDimensionProps) {
  const angle = obstacle.rotation_deg * Math.PI / 180;
  const widthAxis = { x: Math.cos(angle), y: Math.sin(angle) };
  const depthAxis = { x: Math.sin(angle), y: -Math.cos(angle) };
  const centre = obstacle.center;
  const width = obstacle.dimensions.width.value;
  const depth = obstacle.dimensions.depth.value;
  const modelPoints = (axis: Point2D, length: number): [Point2D, Point2D] => [
    { x: centre.x - axis.x * length / 2, y: centre.y - axis.y * length / 2 },
    { x: centre.x + axis.x * length / 2, y: centre.y + axis.y * length / 2 },
  ];
  const axisDimensions = [
    { points: modelPoints(widthAxis, width), value: width, label: "X width", offsetNormal: { x: 0, y: -1 } },
    { points: modelPoints(depthAxis, depth), value: depth, label: "Y depth", offsetNormal: { x: 1, y: 0 } },
  ];
  const rowOffset = 28 + lane * 18;
  const hasMeasurementActions = Boolean(onMeasurementPointerDown || onMeasurementContextMenu || onMeasurementDoubleClick);

  return <g className={`fixture-dimension ${hasMeasurementActions ? "measurement-context-target" : ""} ${onMeasurementPointerDown ? "measurement-removal-target" : ""}`} aria-label={`Element dimensions: ${axisDimensions.map(({ label, value }) => `${label} ${formatLength(value, displayUnits)}`).join(", ")}`} onPointerDown={(event: ReactPointerEvent<SVGGElement>) => { if (hasMeasurementActions) event.stopPropagation(); }}>
    {axisDimensions.map(({ points: modelPointsForAxis, value, label: axisLabel, offsetNormal }, index) => {
      const first = toScreen(modelPointsForAxis[0]);
      const second = toScreen(modelPointsForAxis[1]);
      const tangentLength = Math.hypot(second.x - first.x, second.y - first.y) || 1;
      const tangent = { x: (second.x - first.x) / tangentLength, y: (second.y - first.y) / tangentLength };
      const normal = offsetNormal;
      const offset = rowOffset + (index === 1 ? 8 : 0);
      const dimensionFirst = { x: first.x + normal.x * offset, y: first.y + normal.y * offset };
      const dimensionSecond = { x: second.x + normal.x * offset, y: second.y + normal.y * offset };
      const labelPoint = { x: (dimensionFirst.x + dimensionSecond.x) / 2 + normal.x * 10, y: (dimensionFirst.y + dimensionSecond.y) / 2 + normal.y * 10 };
      const measurementKey = `fixture:${measurementId}:${index}`;
      if (hiddenMeasurementIds.includes(measurementKey)) return null;
      return <g key={axisLabel} onPointerDown={(event) => onMeasurementPointerDown?.(event, index as FixtureDimensionSection)} onContextMenu={(event) => onMeasurementContextMenu?.(event, index as FixtureDimensionSection)} onDoubleClick={(event) => onMeasurementDoubleClick?.(event, index as FixtureDimensionSection)}>
        <line className="measurement-hit" x1={dimensionFirst.x} y1={dimensionFirst.y} x2={dimensionSecond.x} y2={dimensionSecond.y} />
        <line className="dimension-extension" x1={first.x} y1={first.y} x2={dimensionFirst.x} y2={dimensionFirst.y} />
        <line className="dimension-extension" x1={second.x} y1={second.y} x2={dimensionSecond.x} y2={dimensionSecond.y} />
        <line className="dimension-line" x1={dimensionFirst.x} y1={dimensionFirst.y} x2={dimensionSecond.x} y2={dimensionSecond.y} />
        <line className="dimension-tick" x1={dimensionFirst.x - tangent.x * 3 - normal.x * 3} y1={dimensionFirst.y - tangent.y * 3 - normal.y * 3} x2={dimensionFirst.x + tangent.x * 3 + normal.x * 3} y2={dimensionFirst.y + tangent.y * 3 + normal.y * 3} />
        <line className="dimension-tick" x1={dimensionSecond.x - tangent.x * 3 - normal.x * 3} y1={dimensionSecond.y - tangent.y * 3 - normal.y * 3} x2={dimensionSecond.x + tangent.x * 3 + normal.x * 3} y2={dimensionSecond.y + tangent.y * 3 + normal.y * 3} />
        <text className="fixture-dimension-label" x={labelPoint.x} y={labelPoint.y}>{`${axisLabel}: ${formatLength(value, displayUnits)}`}</text>
      </g>;
    })}
  </g>;
}

type FixtureSpacingDimensionProps = {
  span: FixtureWallSpan;
  toScreen: (point: Point2D) => Point2D;
  displayUnits: DisplayUnits;
  lane?: number;
};

/** Renders wall-relative spacing while leaving the element's local dimensions intact. */
export function FloorPlanFixtureSpacingDimensions({ span, toScreen, displayUnits, lane = 0, wallDimensionOffset }: FixtureSpacingDimensionProps & { wallDimensionOffset?: number }) {
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
  // Wall dimensions already occupy the first lane outside the wall. Keep
  // fixture-to-wall spacing on a separate outer lane so labels never sit on
  // top of the existing wall measurements.
  const rowOffset = Math.max(64, (wallDimensionOffset ?? 0) + 28) + lane * 20;
  const points = [wallStart, elementStart, elementEnd, wallEnd].map((point) => ({ x: point.x + outward.x * rowOffset, y: point.y + outward.y * rowOffset }));
  const values = [span.startOffsetMm, span.widthMm, span.endOffsetMm];

  return <g className="fixture-dimension fixture-spacing-dimension" aria-label={`Element clearances: ${formatLength(span.startOffsetMm, displayUnits)}, ${formatLength(span.endOffsetMm, displayUnits)}`}>
    {values.map((value, index) => {
      // The object's own X-width/Y-depth dimensions are rendered separately.
      // Keep the clearance rails, but do not repeat the same size on this rail.
      if (index === 1) return null;
      const first = points[index];
      const second = points[index + 1];
      const label = { x: (first.x + second.x) / 2 + outward.x * 9, y: (first.y + second.y) / 2 + outward.y * 9 };
      return <g key={index}>
        <line className="dimension-extension" x1={first.x - outward.x * 5} y1={first.y - outward.y * 5} x2={first.x + outward.x * 3} y2={first.y + outward.y * 3} />
        <line className="dimension-extension" x1={second.x - outward.x * 5} y1={second.y - outward.y * 5} x2={second.x + outward.x * 3} y2={second.y + outward.y * 3} />
        <line className="dimension-line" x1={first.x} y1={first.y} x2={second.x} y2={second.y} />
        <line className="dimension-tick" x1={first.x - tangent.x * 3 - outward.x * 3} y1={first.y - tangent.y * 3 - outward.y * 3} x2={first.x + tangent.x * 3 + outward.x * 3} y2={first.y + tangent.y * 3 + outward.y * 3} />
        <line className="dimension-tick" x1={second.x - tangent.x * 3 - outward.x * 3} y1={second.y - tangent.y * 3 - outward.y * 3} x2={second.x + tangent.x * 3 + outward.x * 3} y2={second.y + tangent.y * 3 + outward.y * 3} />
        <text className="fixture-dimension-label" x={label.x} y={label.y}>{formatLength(value, displayUnits)}</text>
      </g>;
    })}
  </g>;
}

/**
 * Renders room clearances around a floating element. The element's existing
 * width/depth dimensions provide the middle values, so this only labels the
 * left/right X and top/bottom Y gaps. Polygon intersections keep concave rooms
 * tied to the actual room section containing the item.
 */
export function FloorPlanFixtureRoomSpacingDimensions({ obstacle, roomVertices, toScreen, displayUnits, viewportScale = 0.1, axisFilter }: FixtureRoomSpacingProps) {
  const corners = fixtureCorners(obstacle);
  if (corners.length < 4 || roomVertices.length < 3) return null;
  const minX = Math.min(...corners.map((point) => point.x));
  const maxX = Math.max(...corners.map((point) => point.x));
  const minY = Math.min(...corners.map((point) => point.y));
  const maxY = Math.max(...corners.map((point) => point.y));
  const centreX = obstacle.center.x;
  const centreY = obstacle.center.y;
  // Keep the room rails a predictable distance from the element in screen
  // space. Using the viewport scale here avoids a low zoom pulling the rail
  // back into the element's own dimension labels.
  const railOffsetMm = Math.max(160, 68 / Math.max(viewportScale, 0.0001));
  const horizontal = [
    railInterval(roomVertices, "y", minY - railOffsetMm, centreY, minX, maxX, "before"),
    railInterval(roomVertices, "y", maxY + railOffsetMm, centreY, minX, maxX, "after"),
  ].filter((rail): rail is RoomRail => Boolean(rail)).sort((first, second) => second.score - first.score)[0] ?? null;
  const vertical = [
    railInterval(roomVertices, "x", minX - railOffsetMm, centreX, minY, maxY, "before"),
    railInterval(roomVertices, "x", maxX + railOffsetMm, centreX, minY, maxY, "after"),
  ].filter((rail): rail is RoomRail => Boolean(rail)).sort((first, second) => second.score - first.score)[0] ?? null;
  if (!horizontal && !vertical) return null;

  const axes = [
    horizontal && {
      axis: "X",
      points: [
        { x: horizontal.interval[0], y: horizontal.coordinate },
        { x: minX, y: horizontal.coordinate },
        { x: maxX, y: horizontal.coordinate },
        { x: horizontal.interval[1], y: horizontal.coordinate },
      ],
      anchors: [{ x: minX, y: horizontal.side === "before" ? minY : maxY }, { x: maxX, y: horizontal.side === "before" ? minY : maxY }],
      values: [minX - horizontal.interval[0], maxX - minX, horizontal.interval[1] - maxX],
      labels: ["X left clearance", "X span", "X right clearance"],
      side: horizontal.side,
    },
    vertical && {
      axis: "Y",
      points: [
        { x: vertical.coordinate, y: vertical.interval[1] },
        { x: vertical.coordinate, y: maxY },
        { x: vertical.coordinate, y: minY },
        { x: vertical.coordinate, y: vertical.interval[0] },
      ],
      anchors: [{ x: vertical.side === "before" ? minX : maxX, y: maxY }, { x: vertical.side === "before" ? minX : maxX, y: minY }],
      values: [vertical.interval[1] - maxY, maxY - minY, minY - vertical.interval[0]],
      labels: ["Y top clearance", "Y span", "Y bottom clearance"],
      side: vertical.side,
    },
  ].filter((axis): axis is { axis: "X" | "Y"; points: Point2D[]; anchors: Point2D[]; values: number[]; labels: string[]; side: "before" | "after" } => Boolean(axis));
  const visibleAxes = axisFilter ? axes.filter((axis) => axisFilter.includes(axis.axis)) : axes;
  if (visibleAxes.length === 0) return null;

  const renderAxis = (axis: { axis: string; points: Point2D[]; anchors: Point2D[]; values: number[]; labels: string[]; side: "before" | "after" }) => {
    const screenPoints = axis.points.map(toScreen);
    const screenAnchors = axis.anchors.map(toScreen);
    const tangentLength = Math.hypot(screenPoints[3].x - screenPoints[0].x, screenPoints[3].y - screenPoints[0].y) || 1;
    const tangent = { x: (screenPoints[3].x - screenPoints[0].x) / tangentLength, y: (screenPoints[3].y - screenPoints[0].y) / tangentLength };
    const screenNormal = axis.axis === "X"
      ? (axis.side === "before" ? { x: 0, y: 1 } : { x: 0, y: -1 })
      : (axis.side === "before" ? { x: -1, y: 0 } : { x: 1, y: 0 });
    return <g key={axis.axis} className="fixture-room-spacing-axis" aria-label={`${axis.axis} room spacing`}>
      {screenAnchors.map((anchor, index) => {
        const railPoint = screenPoints[index + 1];
        return <line key={`anchor-${index}`} className="dimension-extension" x1={anchor.x} y1={anchor.y} x2={railPoint.x} y2={railPoint.y} />;
      })}
      {axis.values.map((value, index) => {
        // The local object dimension in FloorPlanFixtureDimensions is the
        // central measurement. Only the two room clearances belong on this rail.
        if (index === 1) return null;
        const first = screenPoints[index];
        const second = screenPoints[index + 1];
        const labelPoint = { x: (first.x + second.x) / 2 + screenNormal.x * 10, y: (first.y + second.y) / 2 + screenNormal.y * 10 };
        return <g key={`${axis.axis}-${index}`}>
          <line className="dimension-line" x1={first.x} y1={first.y} x2={second.x} y2={second.y} />
          <line className="dimension-tick" x1={first.x - tangent.x * 3 - screenNormal.x * 3} y1={first.y - tangent.y * 3 - screenNormal.y * 3} x2={first.x + tangent.x * 3 + screenNormal.x * 3} y2={first.y + tangent.y * 3 + screenNormal.y * 3} />
          <line className="dimension-tick" x1={second.x - tangent.x * 3 - screenNormal.x * 3} y1={second.y - tangent.y * 3 - screenNormal.y * 3} x2={second.x + tangent.x * 3 + screenNormal.x * 3} y2={second.y + tangent.y * 3 + screenNormal.y * 3} />
          <text className="fixture-dimension-label" x={labelPoint.x} y={labelPoint.y}>{`${axis.labels[index]}: ${formatLength(Math.max(0, value), displayUnits)}`}</text>
        </g>;
      })}
    </g>;
  };

  return <g className="fixture-dimension fixture-room-spacing" aria-label={`Floating element clearances: ${visibleAxes.flatMap((axis) => [0, 2].map((index) => `${axis.labels[index]} ${formatLength(Math.max(0, axis.values[index]), displayUnits)}`)).join(", ")}`}>
    {visibleAxes.map(renderAxis)}
  </g>;
}
