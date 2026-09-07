export type OpeningWallDragPoint = { x: number; y: number };
export type OpeningWallDragWall = { id: string; points: OpeningWallDragPoint[] };
export type OpeningWallDragOpening = { id: string; wallId: string; segmentIndex: number; offset: number; width: number };

function samePoint(first: OpeningWallDragPoint, second: OpeningWallDragPoint) {
  return Math.hypot(first.x - second.x, first.y - second.y) <= .001;
}

/**
 * Translate a selected wall segment and keep openings on its adjoining wall
 * segments anchored to the endpoint that is travelling with the drag.
 */
export function translateWallAndAttachedOpenings<TWall extends OpeningWallDragWall, TOpening extends OpeningWallDragOpening>(
  walls: TWall[],
  openings: TOpening[],
  wallId: string,
  segmentIndex: number,
  normal: OpeningWallDragPoint,
  distance: number,
): { walls: TWall[]; openings: TOpening[] } {
  const sourceWall = walls.find((wall) => wall.id === wallId);
  if (!sourceWall || !sourceWall.points[segmentIndex + 1]) return { walls, openings };

  const movedPoints = sourceWall.points.map((point) => ({ ...point }));
  const movedIndices = [segmentIndex, segmentIndex + 1];
  movedIndices.forEach((index) => {
    const point = movedPoints[index];
    if (point) movedPoints[index] = { x: point.x + normal.x * distance, y: point.y + normal.y * distance };
  });
  if (samePoint(sourceWall.points[0], sourceWall.points.at(-1)!)) {
    if (segmentIndex === 0) movedPoints[movedPoints.length - 1] = { ...movedPoints[0] };
    if (segmentIndex + 1 === movedPoints.length - 1) movedPoints[0] = { ...movedPoints.at(-1)! };
  }

  const translatedWall = { ...sourceWall, points: movedPoints } as TWall;
  const translatedWalls = walls.map((wall) => wall.id === wallId ? translatedWall : wall);
  const translatedOpenings = openings.map((opening) => {
    if (opening.wallId !== wallId) return opening;
    const start = sourceWall.points[opening.segmentIndex];
    const end = sourceWall.points[opening.segmentIndex + 1];
    const movedStart = movedPoints[opening.segmentIndex];
    const movedEnd = movedPoints[opening.segmentIndex + 1];
    if (!start || !end || !movedStart || !movedEnd) return opening;
    const length = Math.hypot(end.x - start.x, end.y - start.y);
    if (!length) return opening;
    const tangent = { x: (end.x - start.x) / length, y: (end.y - start.y) / length };
    const endShift = (movedEnd.x - end.x) * tangent.x + (movedEnd.y - end.y) * tangent.y;
    // An opening on a segment whose end moves should keep its physical
    // clearance to that moving corner, rather than being consumed by it.
    return Math.abs(endShift) <= .001 ? opening : { ...opening, offset: opening.offset + endShift } as TOpening;
  });
  return { walls: translatedWalls, openings: translatedOpenings };
}
