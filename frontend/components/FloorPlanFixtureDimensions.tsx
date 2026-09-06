import type { Point2D } from "@/lib/types";
import { formatLength, type DisplayUnits } from "@/lib/units";

type FixtureDimensionProps = {
  centre: Point2D;
  width: number;
  depth: number;
  rotationDeg: number;
  scale: number;
  toScreen: (point: Point2D) => Point2D;
  displayUnits: DisplayUnits;
};

function rotatePoint(point: Point2D, centre: Point2D, rotationDeg: number): Point2D {
  const angle = rotationDeg * Math.PI / 180;
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  const localX = point.x - centre.x;
  const localY = point.y - centre.y;
  return {
    x: centre.x + localX * cos - localY * sin,
    y: centre.y + localX * sin + localY * cos,
  };
}

function pointOnFixture(centre: Point2D, x: number, y: number, rotationDeg: number): Point2D {
  return rotatePoint({ x: centre.x + x, y: centre.y + y }, centre, rotationDeg);
}

function dimensionLine(edgeStart: Point2D, edgeEnd: Point2D, dimensionStart: Point2D, dimensionEnd: Point2D, value: number, displayUnits: DisplayUnits, key: string) {
  const length = Math.hypot(dimensionEnd.x - dimensionStart.x, dimensionEnd.y - dimensionStart.y) || 1;
  const tangent = { x: (dimensionEnd.x - dimensionStart.x) / length, y: (dimensionEnd.y - dimensionStart.y) / length };
  const midpoint = { x: (dimensionStart.x + dimensionEnd.x) / 2, y: (dimensionStart.y + dimensionEnd.y) / 2 };
  const outwardVector = { x: midpoint.x - (edgeStart.x + edgeEnd.x) / 2, y: midpoint.y - (edgeStart.y + edgeEnd.y) / 2 };
  const outwardLength = Math.hypot(outwardVector.x, outwardVector.y) || 1;
  const outward = { x: outwardVector.x / outwardLength, y: outwardVector.y / outwardLength };
  const label = { x: midpoint.x + outward.x * 9, y: midpoint.y + outward.y * 9 };
  return <g key={key}>
    <line className="dimension-extension" x1={edgeStart.x} y1={edgeStart.y} x2={dimensionStart.x} y2={dimensionStart.y} />
    <line className="dimension-extension" x1={edgeEnd.x} y1={edgeEnd.y} x2={dimensionEnd.x} y2={dimensionEnd.y} />
    <line className="dimension-line" x1={dimensionStart.x} y1={dimensionStart.y} x2={dimensionEnd.x} y2={dimensionEnd.y} />
    <line className="dimension-tick" x1={dimensionStart.x - tangent.x * 3 - outward.x * 3} y1={dimensionStart.y - tangent.y * 3 - outward.y * 3} x2={dimensionStart.x + tangent.x * 3 + outward.x * 3} y2={dimensionStart.y + tangent.y * 3 + outward.y * 3} />
    <line className="dimension-tick" x1={dimensionEnd.x - tangent.x * 3 - outward.x * 3} y1={dimensionEnd.y - tangent.y * 3 - outward.y * 3} x2={dimensionEnd.x + tangent.x * 3 + outward.x * 3} y2={dimensionEnd.y + tangent.y * 3 + outward.y * 3} />
    <text className="fixture-dimension-label" x={label.x} y={label.y}>{formatLength(value, displayUnits)}</text>
  </g>;
}

export function FloorPlanFixtureDimensions({ centre, width, depth, rotationDeg, scale, toScreen, displayUnits }: FixtureDimensionProps) {
  const offset = 28 / Math.max(scale, 0.001);
  const widthEdgeStart = toScreen(pointOnFixture(centre, -width / 2, depth / 2, rotationDeg));
  const widthEdgeEnd = toScreen(pointOnFixture(centre, width / 2, depth / 2, rotationDeg));
  const widthDimensionStart = toScreen(pointOnFixture(centre, -width / 2, depth / 2 + offset, rotationDeg));
  const widthDimensionEnd = toScreen(pointOnFixture(centre, width / 2, depth / 2 + offset, rotationDeg));
  const depthEdgeStart = toScreen(pointOnFixture(centre, width / 2, -depth / 2, rotationDeg));
  const depthEdgeEnd = toScreen(pointOnFixture(centre, width / 2, depth / 2, rotationDeg));
  const depthDimensionStart = toScreen(pointOnFixture(centre, width / 2 + offset, -depth / 2, rotationDeg));
  const depthDimensionEnd = toScreen(pointOnFixture(centre, width / 2 + offset, depth / 2, rotationDeg));

  return <g className="fixture-dimension" aria-label={`Element dimensions: ${formatLength(width, displayUnits)} by ${formatLength(depth, displayUnits)}`}>
    {dimensionLine(widthEdgeStart, widthEdgeEnd, widthDimensionStart, widthDimensionEnd, width, displayUnits, "width")}
    {dimensionLine(depthEdgeStart, depthEdgeEnd, depthDimensionStart, depthDimensionEnd, depth, displayUnits, "depth")}
  </g>;
}
