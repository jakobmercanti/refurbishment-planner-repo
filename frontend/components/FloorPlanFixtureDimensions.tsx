import type { MouseEvent as ReactMouseEvent, PointerEvent as ReactPointerEvent } from "react";
import type { Obstacle, Point2D } from "@/lib/types";
import { formatLength, type DisplayUnits } from "@/lib/units";

export type FixtureDimensionSection = 0 | 1;

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
