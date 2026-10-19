"use client";
import { FixturePlanSymbol } from "./FixturePlanSymbol";
import { FloorPlanOpeningSymbol } from "./FloorPlanOpeningGraphics";
import type { PlacementCandidate, PlacementRequest } from "@/lib/elementPlacement";
import type { Point2D } from "@/lib/types";
import type { DisplayUnits } from "@/lib/units";
import { electricalPlanPresentation } from "@/lib/electricalPlanSymbols";
import { isElectricalObstacle } from "@/lib/electricalLayout";
import { isHeatingElement } from "@/lib/heatingElements";
import { heatingPlanSize } from "@/lib/heatingPresentation";

export function PlacementPreview2D({ request, point, candidate, toScreen, units, electricalMode = false, heatingMode = false, zoom = 1 }: { request: PlacementRequest; point: Point2D; candidate: PlacementCandidate | null; toScreen: (point: Point2D)=>Point2D; units: DisplayUnits; electricalMode?: boolean; heatingMode?: boolean; zoom?: number }) {
  const obstacle=candidate?.obstacle??{...request.obstacle,center:point};
  const center=toScreen(obstacle.center), origin=toScreen({x:0,y:0}), extents=toScreen({x:obstacle.dimensions.width.value,y:obstacle.dimensions.depth.value});
  const footprintWidth=Math.abs(extents.x-origin.x),footprintDepth=Math.abs(extents.y-origin.y),colour=candidate?"#18775b":"#ba3d38";
  const heating = !request.opening && isHeatingElement(obstacle);
  const { width, depth, zoom: symbolZoom } = !request.opening && isElectricalObstacle(obstacle)
    ? electricalPlanPresentation(obstacle.representation_key, footprintWidth, footprintDepth, electricalMode, zoom)
    : { ...(heating ? heatingPlanSize(footprintWidth, footprintDepth, heatingMode) : { width: footprintWidth, depth: footprintDepth }), zoom: 1 };
  const wall=candidate?.opening??{start:{x:point.x-obstacle.dimensions.width.value/2,y:point.y},end:{x:point.x+obstacle.dimensions.width.value/2,y:point.y},offset:0,thickness:obstacle.dimensions.depth.value};
  return <g pointerEvents="none" className="placement-preview" aria-hidden="true">
    <g opacity={.68} transform={`translate(${center.x} ${center.y}) scale(${symbolZoom}) translate(${-center.x} ${-center.y})`}>{request.opening ? <FloorPlanOpeningSymbol opening={{...request.opening,id:"placement-preview",width:obstacle.dimensions.width.value,offset:wall.offset,representationKey:obstacle.representation_key,colorHex:obstacle.color_hex,windowDepthMm:obstacle.dimensions.depth.value}} wallStart={wall.start} wallEnd={wall.end} toScreen={toScreen} displayUnits={units} /> : <FixturePlanSymbol obstacle={obstacle} x={center.x} y={center.y} width={width} depth={depth} symbolSize={{width,depth}} electricalMode={electricalMode} />}</g>
    <rect x={-width*symbolZoom/2} y={-depth*symbolZoom/2} width={width*symbolZoom} height={depth*symbolZoom} transform={`translate(${center.x} ${center.y}) rotate(${-obstacle.rotation_deg})`} fill="none" stroke={colour} strokeWidth={2} strokeDasharray="5 3" vectorEffect="non-scaling-stroke" />
    <text x={center.x+14} y={center.y-14} fill={colour} stroke="white" strokeWidth={3} paintOrder="stroke" fontSize={12} fontFamily="sans-serif">{candidate ? "Click to place" : request.opening ? "Move to a free wall" : "Move inside a room with enough space"}</text>
  </g>;
}
