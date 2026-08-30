"use client";

import type { Point2D } from "@/lib/types";
import type { ReactNode, SVGProps } from "react";

export const FLOOR_PLAN_CANVAS_WIDTH = 820;
export const FLOOR_PLAN_CANVAS_HEIGHT = 560;
export const FLOOR_PLAN_PADDING = 400;

export type FloorPlanViewport = {
  minX: number;
  maxY: number;
  scale: number;
  offsetX: number;
  offsetY: number;
};

export function createFloorPlanViewport(
  points: Point2D[],
  padding = FLOOR_PLAN_PADDING,
): FloorPlanViewport {
  const safePoints = points.length ? points : [{ x: 0, y: 0 }];
  const minX = Math.min(...safePoints.map((point) => point.x)) - padding;
  const maxX = Math.max(...safePoints.map((point) => point.x)) + padding;
  const minY = Math.min(...safePoints.map((point) => point.y)) - padding;
  const maxY = Math.max(...safePoints.map((point) => point.y)) + padding;
  const width = Math.max(maxX - minX, 1000);
  const height = Math.max(maxY - minY, 1000);
  const scale = Math.min(FLOOR_PLAN_CANVAS_WIDTH / width, FLOOR_PLAN_CANVAS_HEIGHT / height);

  return {
    minX,
    maxY,
    scale,
    offsetX: (FLOOR_PLAN_CANVAS_WIDTH - width * scale) / 2,
    offsetY: (FLOOR_PLAN_CANVAS_HEIGHT - height * scale) / 2,
  };
}

/** Scales a viewport about the centre of the shared drawing surface. */
export function scaleFloorPlanViewport(viewport: FloorPlanViewport, zoom: number): FloorPlanViewport {
  const safeZoom = Math.max(.35, Math.min(3, zoom));
  return {
    ...viewport,
    scale: viewport.scale * safeZoom,
    offsetX: FLOOR_PLAN_CANVAS_WIDTH / 2 - (FLOOR_PLAN_CANVAS_WIDTH / 2 - viewport.offsetX) * safeZoom,
    offsetY: FLOOR_PLAN_CANVAS_HEIGHT / 2 - (FLOOR_PLAN_CANVAS_HEIGHT / 2 - viewport.offsetY) * safeZoom,
  };
}

export function floorPlanToScreen(point: Point2D, viewport: FloorPlanViewport): Point2D {
  return {
    x: viewport.offsetX + (point.x - viewport.minX) * viewport.scale,
    y: viewport.offsetY + (viewport.maxY - point.y) * viewport.scale,
  };
}

export function floorPlanFromClient(
  clientX: number,
  clientY: number,
  svg: SVGSVGElement,
  viewport: FloorPlanViewport,
): Point2D {
  const rectangle = svg.getBoundingClientRect();
  const screenX = (clientX - rectangle.left) * FLOOR_PLAN_CANVAS_WIDTH / rectangle.width;
  const screenY = (clientY - rectangle.top) * FLOOR_PLAN_CANVAS_HEIGHT / rectangle.height;
  return {
    x: viewport.minX + (screenX - viewport.offsetX) / viewport.scale,
    y: viewport.maxY - (screenY - viewport.offsetY) / viewport.scale,
  };
}

interface FloorPlanCanvasProps extends Omit<SVGProps<SVGSVGElement>, "viewBox"> {
  children: ReactNode;
  showGrid?: boolean;
  underlay?: boolean;
}

/** Canonical SVG surface for the floorplan editor. */
export function FloorPlanCanvas({ children, className = "", showGrid = true, underlay = false, ...props }: FloorPlanCanvasProps) {
  const gridLines = Array.from({ length: 17 }, (_, index) => index * FLOOR_PLAN_CANVAS_WIDTH / 16);

  return <svg
    {...props}
    className={`floor-canvas ${className}`.trim()}
    viewBox={`0 0 ${FLOOR_PLAN_CANVAS_WIDTH} ${FLOOR_PLAN_CANVAS_HEIGHT}`}
  >
    <rect width={FLOOR_PLAN_CANVAS_WIDTH} height={FLOOR_PLAN_CANVAS_HEIGHT} className={`canvas-background${underlay ? " underlay" : ""}`} />
    {showGrid && <g className="plan-grid" aria-hidden>
      {gridLines.map((position) => <line key={`vertical-${position}`} x1={position} y1={0} x2={position} y2={FLOOR_PLAN_CANVAS_HEIGHT} />)}
      {gridLines.map((position) => <line key={`horizontal-${position}`} x1={0} y1={position * FLOOR_PLAN_CANVAS_HEIGHT / FLOOR_PLAN_CANVAS_WIDTH} x2={FLOOR_PLAN_CANVAS_WIDTH} y2={position * FLOOR_PLAN_CANVAS_HEIGHT / FLOOR_PLAN_CANVAS_WIDTH} />)}
    </g>}
    {children}
  </svg>;
}
