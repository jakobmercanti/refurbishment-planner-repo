"use client";

import type { Point2D } from "@/lib/types";
import { useEffect, useRef, useState, type ReactNode, type SVGProps } from "react";

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
  const [viewBoxX = 0, viewBoxY = 0, viewBoxWidth = FLOOR_PLAN_CANVAS_WIDTH, viewBoxHeight = FLOOR_PLAN_CANVAS_HEIGHT] = (svg.getAttribute("viewBox") ?? "")
    .trim()
    .split(/[\s,]+/)
    .map(Number)
    .filter(Number.isFinite);
  // SVG preserves its viewBox aspect ratio by default. The editor is resizable,
  // so using the outer SVG rectangle maps clicks in the letterboxed area to a
  // different drawing point. Map through the rendered viewBox instead.
  const clientWidth = svg.clientWidth || rectangle.width;
  const clientHeight = svg.clientHeight || rectangle.height;
  const scale = Math.min(clientWidth / viewBoxWidth, clientHeight / viewBoxHeight);
  const contentLeft = rectangle.left + svg.clientLeft + (clientWidth - viewBoxWidth * scale) / 2;
  const contentTop = rectangle.top + svg.clientTop + (clientHeight - viewBoxHeight * scale) / 2;
  const screenX = viewBoxX + (clientX - contentLeft) / scale;
  const screenY = viewBoxY + (clientY - contentTop) / scale;
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
  const svgRef = useRef<SVGSVGElement>(null);
  const [surfaceSize, setSurfaceSize] = useState({ width: FLOOR_PLAN_CANVAS_WIDTH, height: FLOOR_PLAN_CANVAS_HEIGHT });
  const canvasAspect = FLOOR_PLAN_CANVAS_WIDTH / FLOOR_PLAN_CANVAS_HEIGHT;
  const surfaceAspect = surfaceSize.width > 0 && surfaceSize.height > 0 ? surfaceSize.width / surfaceSize.height : canvasAspect;
  const viewBoxWidth = surfaceAspect > canvasAspect ? FLOOR_PLAN_CANVAS_HEIGHT * surfaceAspect : FLOOR_PLAN_CANVAS_WIDTH;
  const viewBoxHeight = surfaceAspect < canvasAspect ? FLOOR_PLAN_CANVAS_WIDTH / surfaceAspect : FLOOR_PLAN_CANVAS_HEIGHT;
  const viewBoxX = (FLOOR_PLAN_CANVAS_WIDTH - viewBoxWidth) / 2;
  const viewBoxY = (FLOOR_PLAN_CANVAS_HEIGHT - viewBoxHeight) / 2;
  const gridSpacing = FLOOR_PLAN_CANVAS_WIDTH / 16;
  const gridLines = (start: number, end: number) => {
    const first = Math.floor(start / gridSpacing) * gridSpacing;
    const count = Math.ceil((end - first) / gridSpacing) + 1;
    return Array.from({ length: count }, (_, index) => first + index * gridSpacing);
  };
  const verticalLines = gridLines(viewBoxX, viewBoxX + viewBoxWidth);
  const horizontalLines = gridLines(viewBoxY, viewBoxY + viewBoxHeight);

  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    const surface = svg;
    function updateSurfaceSize() {
      const bounds = surface.getBoundingClientRect();
      setSurfaceSize((current) => current.width === bounds.width && current.height === bounds.height ? current : { width: bounds.width, height: bounds.height });
    }
    updateSurfaceSize();
    const observer = new ResizeObserver(updateSurfaceSize);
    observer.observe(surface);
    return () => observer.disconnect();
  }, []);

  return <svg
    {...props}
    ref={svgRef}
    className={`floor-canvas ${className}`.trim()}
    viewBox={`${viewBoxX} ${viewBoxY} ${viewBoxWidth} ${viewBoxHeight}`}
  >
    <rect x={viewBoxX} y={viewBoxY} width={viewBoxWidth} height={viewBoxHeight} className={`canvas-background${underlay ? " underlay" : ""}`} />
    {showGrid && <g className="plan-grid" aria-hidden>
      {verticalLines.map((position) => <line key={`vertical-${position}`} x1={position} y1={viewBoxY} x2={position} y2={viewBoxY + viewBoxHeight} />)}
      {horizontalLines.map((position) => <line key={`horizontal-${position}`} x1={viewBoxX} y1={position} x2={viewBoxX + viewBoxWidth} y2={position} />)}
    </g>}
    {children}
  </svg>;
}
