export type OpeningWallDragPoint = { x: number; y: number };
export type OpeningWallDragWall = { id: string; points: OpeningWallDragPoint[]; cornerNumbers?: Record<number, number> };
export type OpeningWallDragOpening = { id: string; wallId: string; segmentIndex: number; offset: number; width: number };

function samePoint(first: OpeningWallDragPoint, second: OpeningWallDragPoint) {
  return Math.hypot(first.x - second.x, first.y - second.y) <= .001;
}

/**
 * Keep an opening on the same physical wall span after a drag materializes a
 * junction and inserts a point before its stored segment index.
 */
export function remapOpeningsAfterWallDrag<TWall extends OpeningWallDragWall, TOpening extends OpeningWallDragOpening>(
  beforeWalls: TWall[],
  nextWalls: TWall[],
  openings: TOpening[],
): TOpening[] {
  return openings.map((opening) => {
    const beforeWall = beforeWalls.find((wall) => wall.id === opening.wallId);
    const nextWall = nextWalls.find((wall) => wall.id === opening.wallId);
    if (!beforeWall || !nextWall) return opening;
    const beforeClosed = samePoint(beforeWall.points[0], beforeWall.points.at(-1)!);
    const beforeStartIndex = opening.segmentIndex;
    const beforeEndIndex = beforeClosed && beforeStartIndex + 1 === beforeWall.points.length - 1 ? 0 : beforeStartIndex + 1;
    if (!beforeWall.points[beforeStartIndex] || !beforeWall.points[beforeEndIndex]) return opening;

    const startNumber = beforeWall.cornerNumbers?.[beforeStartIndex];
    const endNumber = beforeWall.cornerNumbers?.[beforeEndIndex];
    if (startNumber === undefined || endNumber === undefined || !nextWall.cornerNumbers) return opening;
    const nextStartIndex = Number(Object.entries(nextWall.cornerNumbers).find(([, number]) => number === startNumber)?.[0]);
    const nextEndIndex = Number(Object.entries(nextWall.cornerNumbers).find(([, number]) => number === endNumber)?.[0]);
    const nextClosed = samePoint(nextWall.points[0], nextWall.points.at(-1)!);
    const nextUniqueCount = nextClosed ? nextWall.points.length - 1 : nextWall.points.length;
    if (!Number.isInteger(nextStartIndex) || !Number.isInteger(nextEndIndex) || nextStartIndex < 0 || nextEndIndex < 0 || nextStartIndex >= nextUniqueCount || nextEndIndex >= nextUniqueCount) return opening;

    const path: Array<{ segmentIndex: number; length: number }> = [];
    let cursor = nextStartIndex;
    for (let step = 0; step <= nextUniqueCount; step += 1) {
      if (cursor === nextEndIndex) break;
      const nextIndex = cursor + 1 < nextUniqueCount ? cursor + 1 : (nextClosed ? 0 : nextUniqueCount);
      const start = nextWall.points[cursor];
      const end = nextWall.points[nextIndex];
      if (!start || !end) return opening;
      const length = Math.hypot(end.x - start.x, end.y - start.y);
      if (!length) return opening;
      path.push({ segmentIndex: cursor, length });
      cursor = nextIndex;
    }
    if (cursor !== nextEndIndex || !path.length) return opening;

    const openingStart = Math.max(0, opening.offset);
    const openingEnd = openingStart + Math.max(0, opening.width);
    let distance = 0;
    const target = path.find((segment) => {
      const fits = openingStart >= distance - .01 && openingEnd <= distance + segment.length + .01;
      if (!fits) distance += segment.length;
      return fits;
    });
    if (!target) return opening;
    return { ...opening, segmentIndex: target.segmentIndex, offset: Math.max(0, openingStart - distance) } as TOpening;
  });
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
