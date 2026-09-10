import type { CSSProperties, MouseEvent as ReactMouseEvent, PointerEvent as ReactPointerEvent } from "react";
import { openingRenderWidths } from "@/lib/openingRendering";
import { formatLength, type DisplayUnits } from "@/lib/units";
import type { Point2D } from "@/lib/types";
import { windowPlanVertices } from "@/lib/architecturalModels";
import { doorRepresentation } from "@/lib/doorModels";
import doorPlanSymbols from "@/lib/doorPlanSymbols.json";

export type FloorPlanOpeningGraphic = {
  id: string;
  kind: "DOOR" | "WINDOW";
  offset: number;
  width: number;
  doorType?: "SINGLE" | "DOUBLE";
  hingeSide?: "START" | "END";
  opensInward?: boolean;
  colorHex?: string;
  windowPaneCount?: 1 | 2 | 3;
  representationKey?: string;
  windowDepthMm?: number;
};

type OpeningProps = {
  opening: FloorPlanOpeningGraphic;
  wallStart: Point2D;
  wallEnd: Point2D;
  toScreen: (point: Point2D) => Point2D;
  displayUnits: DisplayUnits;
  selected?: boolean;
  wallThicknessScreen?: number;
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

export function FloorPlanOpeningSymbol({ opening, wallStart, wallEnd, toScreen, displayUnits, selected = false, wallThicknessScreen, onPointerDown, onContextMenu }: OpeningProps) {
  const shape = geometry(opening, wallStart, wallEnd, toScreen);
  if (!shape) return null;
  const { startModel, endModel, start, end, perpendicular, modelNormal } = shape;
  const { gapWidth, jambHalf } = openingRenderWidths(wallThicknessScreen);
  const style = { "--opening-gap-width": `${gapWidth}px`, ...(opening.colorHex ? { "--door-colour": opening.colorHex, "--window-colour": opening.colorHex, ...(opening.kind === "WINDOW" ? { color: opening.colorHex } : {}) } : {}) } as CSSProperties;
  const className = selected ? " selected" : "";
  if (opening.kind === "WINDOW") {
    const family = opening.representationKey ?? "window-single-pane";
    if (family === "window-bay" || family === "window-bow") {
      const scale = Math.hypot(end.x - start.x, end.y - start.y) / opening.width;
      const depth = Math.max(1, opening.windowDepthMm ?? (family === "window-bay" ? 650 : 700)) * scale;
      const span = opening.width * scale;
      const vertices = windowPlanVertices(family, span, depth);
      const points = (shift: number) => vertices.map(([x, z]) => {
        const along = x + span / 2, outward = z - depth / 2 + shift;
        return `${start.x + shape.tangent.x * along + perpendicular.x * outward},${start.y + shape.tangent.y * along + perpendicular.y * outward}`;
      }).join(" ");
      return <g style={style} className={`opening-symbol window-symbol pickable-opening${className}`} onPointerDown={onPointerDown} onContextMenu={onContextMenu}>
        <title>{`${family.slice(7)} window ${formatLength(opening.width, displayUnits)}`}</title>
        <line className="opening-hit" x1={start.x} y1={start.y} x2={end.x} y2={end.y} />
        <line className="opening-gap" x1={start.x} y1={start.y} x2={end.x} y2={end.y} />
        <polygon points={points(0)} fill="white" stroke="none" />
        {[-2, 0, 2].map(shift => <polyline key={shift} points={points(shift)} fill="none" stroke="currentColor" strokeWidth={shift === 0 ? .6 : 1.2} />)}
        {vertices.map(([x, z], i) => <circle key={i} cx={start.x + shape.tangent.x * (x + span / 2) + perpendicular.x * (z - depth / 2)} cy={start.y + shape.tangent.y * (x + span / 2) + perpendicular.y * (z - depth / 2)} r={2} fill="currentColor" />)}
      </g>;
    }
    const paneCount = Math.max(1, Math.min(3, opening.windowPaneCount ?? 1));
    const paneLines = Array.from({ length: paneCount - 1 }, (_, index) => {
      const ratio = (index + 1) / paneCount;
      const point = { x: start.x + (end.x - start.x) * ratio, y: start.y + (end.y - start.y) * ratio };
      return <line key={`window-pane-${index}`} className="window-pane" x1={point.x - perpendicular.x * 6} y1={point.y - perpendicular.y * 6} x2={point.x + perpendicular.x * 6} y2={point.y + perpendicular.y * 6} />;
    });
    return <g style={style} className={`opening-symbol window-symbol pickable-opening${className}`} onPointerDown={onPointerDown} onContextMenu={onContextMenu}>
      <title>{`${paneCount}-pane window ${formatLength(opening.width, displayUnits)} — drag along or between walls`}</title>
      <line className="opening-hit" x1={start.x} y1={start.y} x2={end.x} y2={end.y} />
      <line className="opening-gap" x1={start.x} y1={start.y} x2={end.x} y2={end.y} />
      <line className="window-frame" x1={start.x + perpendicular.x * 4} y1={start.y + perpendicular.y * 4} x2={end.x + perpendicular.x * 4} y2={end.y + perpendicular.y * 4} />
      <line className="window-frame" x1={start.x - perpendicular.x * 4} y1={start.y - perpendicular.y * 4} x2={end.x - perpendicular.x * 4} y2={end.y - perpendicular.y * 4} />
      <line className="window-core" x1={start.x} y1={start.y} x2={end.x} y2={end.y} />
      {paneLines}
      {family === "window-sash" && <line className="window-core" x1={start.x + perpendicular.x * 2} y1={start.y + perpendicular.y * 2} x2={end.x + perpendicular.x * 2} y2={end.y + perpendicular.y * 2} />}
      {family === "window-casement" && <>
        <path d={`M${start.x} ${start.y} l${(end.x-start.x)*.4 + perpendicular.x*12} ${(end.y-start.y)*.4 + perpendicular.y*12} M${end.x} ${end.y} l${(start.x-end.x)*.4 + perpendicular.x*12} ${(start.y-end.y)*.4 + perpendicular.y*12}`} fill="none" stroke="currentColor" strokeWidth="1" />
      </>}
      <line className="opening-jamb window-jamb" x1={start.x - perpendicular.x * jambHalf} y1={start.y - perpendicular.y * jambHalf} x2={start.x + perpendicular.x * jambHalf} y2={start.y + perpendicular.y * jambHalf} />
      <line className="opening-jamb window-jamb" x1={end.x - perpendicular.x * jambHalf} y1={end.y - perpendicular.y * jambHalf} x2={end.x + perpendicular.x * jambHalf} y2={end.y + perpendicular.y * jambHalf} />
    </g>;
  }

  if (opening.representationKey?.startsWith("door-")) {
    const key = doorRepresentation(opening.representationKey, opening.doorType);
    const drawing = (doorPlanSymbols as Record<string, { height: number; paths: { d: string; fill: string; dash: boolean; weight: number }[] }>)[key];
    const normalEnd = toScreen({ x: startModel.x + modelNormal.x * opening.width, y: startModel.y + modelNormal.y * opening.width });
    const mirror = opening.hingeSide === "END" ? -1 : 1;
    return <g style={style} className={`opening-symbol door-symbol pickable-opening${className}`} onPointerDown={onPointerDown} onContextMenu={onContextMenu}>
      <title>{`${key.replaceAll("-", " ")} ${formatLength(opening.width, displayUnits)}`}</title>
      <line className="opening-hit" x1={start.x} y1={start.y} x2={end.x} y2={end.y} />
      <line className="opening-gap" x1={start.x} y1={start.y} x2={end.x} y2={end.y} />
      <g transform={`matrix(${(end.x-start.x)/1000} ${(end.y-start.y)/1000} ${(normalEnd.x-start.x)/1000} ${(normalEnd.y-start.y)/1000} ${start.x} ${start.y})`}>
        <g transform={mirror < 0 ? "translate(1000 0) scale(-1 1)" : undefined}>
          <rect x={0} y={-30} width={1000} height={drawing.height + 40} fill="transparent" stroke="none" />
          {drawing.paths.map((path, i) => <path key={i} d={path.d} fill={path.fill} stroke="currentColor" strokeWidth={path.weight} strokeDasharray={path.dash ? "22 14" : undefined} />)}
        </g>
      </g>
    </g>;
  }
  const centre = { x: (start.x + end.x) / 2, y: (start.y + end.y) / 2 };
  if (opening.doorType === "DOUBLE") {
    const half = opening.width / 2;
    const firstLeaf = toScreen({ x: startModel.x + modelNormal.x * half, y: startModel.y + modelNormal.y * half });
    const secondLeaf = toScreen({ x: endModel.x + modelNormal.x * half, y: endModel.y + modelNormal.y * half });
    return <g style={style} className={`opening-symbol double-door-symbol pickable-opening${className}`} onPointerDown={onPointerDown} onContextMenu={onContextMenu}>
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
  return <g style={style} className={`opening-symbol door-symbol pickable-opening${className}`} onPointerDown={onPointerDown} onContextMenu={onContextMenu}>
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

type DimensionProps = OpeningProps & { wallCentre: Point2D; lane: number; hiddenMeasurementIds?: ReadonlyArray<string>; onMeasurementPointerDown?: (event: ReactPointerEvent<SVGGElement>, section: number) => void; onMeasurementContextMenu?: (event: ReactMouseEvent<SVGGElement>, section: number) => void; onMeasurementDoubleClick?: (event: ReactMouseEvent<SVGGElement>, section: number) => void };

export function FloorPlanOpeningDimensions({ opening, wallStart, wallEnd, wallCentre, lane, toScreen, displayUnits, hiddenMeasurementIds = [], onMeasurementPointerDown, onMeasurementContextMenu, onMeasurementDoubleClick }: DimensionProps) {
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
  const hasMeasurementActions = Boolean(onMeasurementPointerDown || onMeasurementContextMenu || onMeasurementDoubleClick);
  return <g className={`opening-dimension ${opening.kind === "WINDOW" ? "window-dimension" : ""} ${hasMeasurementActions ? "measurement-context-target" : ""} ${onMeasurementPointerDown ? "measurement-removal-target" : ""}`} aria-label={`${opening.kind === "WINDOW" ? "Window" : "Door"} dimensions`} onPointerDown={(event) => { if (hasMeasurementActions) event.stopPropagation(); }}>
    {values.map((value, index) => {
      const measurementId = `opening:${opening.id}:${index}`;
      if (hiddenMeasurementIds.includes(measurementId)) return null;
      const first = points[index]; const second = points[index + 1];
      const label = { x: (first.x + second.x) / 2 + outward.x * 9, y: (first.y + second.y) / 2 + outward.y * 9 };
      return <g key={index} onPointerDown={(event) => onMeasurementPointerDown?.(event, index)} onContextMenu={(event) => onMeasurementContextMenu?.(event, index)} onDoubleClick={(event) => onMeasurementDoubleClick?.(event, index)}><line className="measurement-hit" x1={first.x} y1={first.y} x2={second.x} y2={second.y} /><line className="dimension-extension" x1={first.x - outward.x * 5} y1={first.y - outward.y * 5} x2={first.x + outward.x * 3} y2={first.y + outward.y * 3} /><line className="dimension-extension" x1={second.x - outward.x * 5} y1={second.y - outward.y * 5} x2={second.x + outward.x * 3} y2={second.y + outward.y * 3} /><line className="dimension-line" x1={first.x} y1={first.y} x2={second.x} y2={second.y} /><line className="dimension-tick" x1={first.x - shape.tangent.x * 3 - outward.x * 3} y1={first.y - shape.tangent.y * 3 - outward.y * 3} x2={first.x + shape.tangent.x * 3 + outward.x * 3} y2={first.y + shape.tangent.y * 3 + outward.y * 3} /><line className="dimension-tick" x1={second.x - shape.tangent.x * 3 - outward.x * 3} y1={second.y - shape.tangent.y * 3 - outward.y * 3} x2={second.x + shape.tangent.x * 3 + outward.x * 3} y2={second.y + shape.tangent.y * 3 + outward.y * 3} /><text className="opening-dimension-label" x={label.x} y={label.y}>{formatLength(value, displayUnits)}</text></g>;
    })}
  </g>;
}
