import type { MouseEvent as ReactMouseEvent, PointerEvent as ReactPointerEvent } from "react";
import { formatLength, type DisplayUnits } from "@/lib/units";
import type { Point2D } from "@/lib/types";

export type FloorPlanOpeningGraphic = {
  id: string;
  kind: "DOOR" | "WINDOW";
  offset: number;
  width: number;
  doorType?: "SINGLE" | "DOUBLE";
  hingeSide?: "START" | "END";
  opensInward?: boolean;
};

type OpeningProps = {
  opening: FloorPlanOpeningGraphic;
  wallStart: Point2D;
  wallEnd: Point2D;
  toScreen: (point: Point2D) => Point2D;
  displayUnits: DisplayUnits;
  selected?: boolean;
  onPointerDown?: (event: ReactPointerEvent<SVGElement>) => void;
  onContextMenu?: (event: ReactMouseEvent<SVGGElement>) => void;
};

function arcPath(centre: Point2D, start: Point2D, end: Point2D): string {
  const radius = Math.hypot(start.x - centre.x, start.y - centre.y);
  const cross = (start.x - centre.x) * (end.y - centre.y) - (start.y - centre.y) * (end.x - centre.x);
  return `M ${start.x} ${start.y} A ${radius} ${radius} 0 0 ${cross >= 0 ? 1 : 0} ${end.x} ${end.y}`;
}

function sectorPath(centre: Point2D, start: Point2D, end: Point2D): string {
  const arc = arcPath(centre, start, end).replace(/^M [^A]+A\s*/, "A ");
  return `M ${centre.x} ${centre.y} L ${start.x} ${start.y} ${arc} Z`;
}

function geometry(opening: FloorPlanOpeningGraphic, wallStart: Point2D, wallEnd: Point2D, toScreen: (point: Point2D) => Point2D) {
  const dx = wallEnd.x - wallStart.x; const dy = wallEnd.y - wallStart.y;
  const wallLength = Math.hypot(dx, dy);
  if (!wallLength || opening.offset + opening.width > wallLength) return null;
  const unit = { x: dx / wallLength, y: dy / wallLength };
  const startModel = { x: wallStart.x + unit.x * opening.offset, y: wallStart.y + unit.y * opening.offset };
  const endModel = { x: startModel.x + unit.x * opening.width, y: startModel.y + unit.y * opening.width };
  const start = toScreen(startModel); const end = toScreen(endModel);
  const pixelLength = Math.hypot(end.x - start.x, end.y - start.y) || 1;
  const tangent = { x: (end.x - start.x) / pixelLength, y: (end.y - start.y) / pixelLength };
  const perpendicular = { x: -tangent.y, y: tangent.x };
  const inwardSign = opening.opensInward === false ? -1 : 1;
  const modelNormal = { x: -unit.y * inwardSign, y: unit.x * inwardSign };
  return { wallLength, unit, startModel, endModel, start, end, tangent, perpendicular, modelNormal };
}

export function FloorPlanOpeningSymbol({ opening, wallStart, wallEnd, toScreen, displayUnits, selected = false, onPointerDown, onContextMenu }: OpeningProps) {
  const shape = geometry(opening, wallStart, wallEnd, toScreen);
  if (!shape) return null;
  const { startModel, endModel, start, end, perpendicular, modelNormal } = shape;
  const jambHalf = 7;
  const className = selected ? " selected" : "";
  if (opening.kind === "WINDOW") {
    return <g className={`opening-symbol window-symbol pickable-opening${className}`} onPointerDown={onPointerDown} onContextMenu={onContextMenu}>
      <title>{`Window ${formatLength(opening.width, displayUnits)} — drag along or between walls`}</title>
      <line className="opening-hit" x1={start.x} y1={start.y} x2={end.x} y2={end.y} />
      <line className="opening-gap" x1={start.x} y1={start.y} x2={end.x} y2={end.y} />
      <line className="window-frame" x1={start.x + perpendicular.x * 4} y1={start.y + perpendicular.y * 4} x2={end.x + perpendicular.x * 4} y2={end.y + perpendicular.y * 4} />
      <line className="window-frame" x1={start.x - perpendicular.x * 4} y1={start.y - perpendicular.y * 4} x2={end.x - perpendicular.x * 4} y2={end.y - perpendicular.y * 4} />
      <line className="window-core" x1={start.x} y1={start.y} x2={end.x} y2={end.y} />
      <line className="opening-jamb window-jamb" x1={start.x - perpendicular.x * jambHalf} y1={start.y - perpendicular.y * jambHalf} x2={start.x + perpendicular.x * jambHalf} y2={start.y + perpendicular.y * jambHalf} />
      <line className="opening-jamb window-jamb" x1={end.x - perpendicular.x * jambHalf} y1={end.y - perpendicular.y * jambHalf} x2={end.x + perpendicular.x * jambHalf} y2={end.y + perpendicular.y * jambHalf} />
    </g>;
  }

  const centre = { x: (start.x + end.x) / 2, y: (start.y + end.y) / 2 };
  if (opening.doorType === "DOUBLE") {
    const half = opening.width / 2;
    const firstLeaf = toScreen({ x: startModel.x + modelNormal.x * half, y: startModel.y + modelNormal.y * half });
    const secondLeaf = toScreen({ x: endModel.x + modelNormal.x * half, y: endModel.y + modelNormal.y * half });
    return <g className={`opening-symbol double-door-symbol pickable-opening${className}`} onPointerDown={onPointerDown} onContextMenu={onContextMenu}>
      <title>{`Double door ${formatLength(opening.width, displayUnits)} — drag along or between walls`}</title>
      <path className="opening-hit-area" d={`${sectorPath(start, centre, firstLeaf)} ${sectorPath(end, centre, secondLeaf)}`} />
      <line className="opening-hit" x1={start.x} y1={start.y} x2={end.x} y2={end.y} />
      <line className="opening-hit" x1={start.x} y1={start.y} x2={firstLeaf.x} y2={firstLeaf.y} />
      <line className="opening-hit" x1={end.x} y1={end.y} x2={secondLeaf.x} y2={secondLeaf.y} />
      <path className="opening-swing-hit" d={arcPath(start, centre, firstLeaf)} />
      <path className="opening-swing-hit" d={arcPath(end, centre, secondLeaf)} />
      <line className="opening-gap" x1={start.x} y1={start.y} x2={end.x} y2={end.y} />
      <line className="door-closed-line" x1={start.x} y1={start.y} x2={end.x} y2={end.y} />
      <line className="opening-jamb" x1={start.x - perpendicular.x * jambHalf} y1={start.y - perpendicular.y * jambHalf} x2={start.x + perpendicular.x * jambHalf} y2={start.y + perpendicular.y * jambHalf} />
      <line className="opening-jamb" x1={end.x - perpendicular.x * jambHalf} y1={end.y - perpendicular.y * jambHalf} x2={end.x + perpendicular.x * jambHalf} y2={end.y + perpendicular.y * jambHalf} />
      <line className="door-leaf" x1={start.x} y1={start.y} x2={firstLeaf.x} y2={firstLeaf.y} /><line className="door-leaf" x1={end.x} y1={end.y} x2={secondLeaf.x} y2={secondLeaf.y} />
      <path className="door-swing" d={arcPath(start, centre, firstLeaf)} /><path className="door-swing" d={arcPath(end, centre, secondLeaf)} />
    </g>;
  }

  const hingeAtStart = opening.hingeSide !== "END";
  const hingeModel = hingeAtStart ? startModel : endModel;
  const hinge = hingeAtStart ? start : end; const closedEnd = hingeAtStart ? end : start;
  const leaf = toScreen({ x: hingeModel.x + modelNormal.x * opening.width, y: hingeModel.y + modelNormal.y * opening.width });
  return <g className={`opening-symbol door-symbol pickable-opening${className}`} onPointerDown={onPointerDown} onContextMenu={onContextMenu}>
    <title>{`Door ${formatLength(opening.width, displayUnits)} — drag along or between walls`}</title>
    <path className="opening-hit-area" d={sectorPath(hinge, closedEnd, leaf)} />
    <line className="opening-hit" x1={start.x} y1={start.y} x2={end.x} y2={end.y} />
    <line className="opening-hit" x1={hinge.x} y1={hinge.y} x2={leaf.x} y2={leaf.y} />
    <path className="opening-swing-hit" d={arcPath(hinge, closedEnd, leaf)} />
    <line className="opening-gap" x1={start.x} y1={start.y} x2={end.x} y2={end.y} />
    <line className="door-closed-line" x1={start.x} y1={start.y} x2={end.x} y2={end.y} />
    <line className="opening-jamb" x1={start.x - perpendicular.x * jambHalf} y1={start.y - perpendicular.y * jambHalf} x2={start.x + perpendicular.x * jambHalf} y2={start.y + perpendicular.y * jambHalf} />
    <line className="opening-jamb" x1={end.x - perpendicular.x * jambHalf} y1={end.y - perpendicular.y * jambHalf} x2={end.x + perpendicular.x * jambHalf} y2={end.y + perpendicular.y * jambHalf} />
    <line className="door-leaf" x1={hinge.x} y1={hinge.y} x2={leaf.x} y2={leaf.y} />
    <path className="door-swing" d={arcPath(hinge, closedEnd, leaf)} />
  </g>;
}

type DimensionProps = OpeningProps & { wallCentre: Point2D; lane: number; onMeasurementContextMenu?: (event: ReactMouseEvent<SVGGElement>, section: number) => void };

export function FloorPlanOpeningDimensions({ opening, wallStart, wallEnd, wallCentre, lane, toScreen, displayUnits, onMeasurementContextMenu }: DimensionProps) {
  const shape = geometry(opening, wallStart, wallEnd, toScreen);
  if (!shape) return null;
  const start = toScreen(wallStart); const end = toScreen(wallEnd); const centre = toScreen(wallCentre);
  const candidate = { x: -shape.tangent.y, y: shape.tangent.x };
  const midpoint = { x: (start.x + end.x) / 2, y: (start.y + end.y) / 2 };
  const dot = (midpoint.x - centre.x) * candidate.x + (midpoint.y - centre.y) * candidate.y;
  const outward = dot >= 0 ? candidate : { x: -candidate.x, y: -candidate.y };
  const rowOffset = 34 + lane * 20;
  const points = [start, shape.start, shape.end, end].map((point) => ({ x: point.x + outward.x * rowOffset, y: point.y + outward.y * rowOffset }));
  const values = [opening.offset, opening.width, Math.max(0, shape.wallLength - opening.offset - opening.width)];
  return <g className={`opening-dimension ${opening.kind === "WINDOW" ? "window-dimension" : ""} ${onMeasurementContextMenu ? "measurement-context-target" : ""}`} aria-label={`${opening.kind === "WINDOW" ? "Window" : "Door"} dimensions`}>
    {values.map((value, index) => {
      const first = points[index]; const second = points[index + 1];
      const label = { x: (first.x + second.x) / 2 + outward.x * 9, y: (first.y + second.y) / 2 + outward.y * 9 };
      return <g key={index} onContextMenu={(event) => onMeasurementContextMenu?.(event, index)}><line className="dimension-extension" x1={first.x - outward.x * 5} y1={first.y - outward.y * 5} x2={first.x + outward.x * 3} y2={first.y + outward.y * 3} /><line className="dimension-extension" x1={second.x - outward.x * 5} y1={second.y - outward.y * 5} x2={second.x + outward.x * 3} y2={second.y + outward.y * 3} /><line className="dimension-line" x1={first.x} y1={first.y} x2={second.x} y2={second.y} /><line className="dimension-tick" x1={first.x - shape.tangent.x * 3 - outward.x * 3} y1={first.y - shape.tangent.y * 3 - outward.y * 3} x2={first.x + shape.tangent.x * 3 + outward.x * 3} y2={first.y + shape.tangent.y * 3 + outward.y * 3} /><line className="dimension-tick" x1={second.x - shape.tangent.x * 3 - outward.x * 3} y1={second.y - shape.tangent.y * 3 - outward.y * 3} x2={second.x + shape.tangent.x * 3 + outward.x * 3} y2={second.y + shape.tangent.y * 3 + outward.y * 3} /><text className="opening-dimension-label" x={label.x} y={label.y}>{formatLength(value, displayUnits)}</text></g>;
    })}
  </g>;
}
