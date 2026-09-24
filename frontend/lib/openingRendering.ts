import type { Point2D } from "./types";

/** Screen-only widths: clear both thin wall outlines and span the full wall with jambs. */
export function openingRenderWidths(wallThicknessScreen = 10) {
  const thickness = Number.isFinite(wallThicknessScreen) ? Math.max(0, wallThicknessScreen) : 10;
  return { gapWidth: Math.max(14, thickness + 4), jambHalf: Math.max(7, thickness / 2 + 2) };
}

/** Returns the screen-space normal that points away from the room centre. */
export function outwardNormalForRoom(perpendicular: Point2D, wallMidpoint: Point2D, roomCentre?: Point2D): Point2D {
  if (!roomCentre) return perpendicular;
  const roomSide = (roomCentre.x - wallMidpoint.x) * perpendicular.x + (roomCentre.y - wallMidpoint.y) * perpendicular.y;
  return roomSide > 0
    ? { x: perpendicular.x === 0 ? 0 : -perpendicular.x, y: perpendicular.y === 0 ? 0 : -perpendicular.y }
    : perpendicular;
}
