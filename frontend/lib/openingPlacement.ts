export type OpeningInterval = { offset: number; width: number };
export type OpeningPlacementPoint = { x: number; y: number };

function inRange(value: number, minimum: number, maximum: number) {
  return value >= minimum - .001 && value <= maximum + .001;
}

/** Return every wall vertex that lies on a host wall segment, in millimetres from its start. */
export function cornerOffsetsOnWallSegment(start: OpeningPlacementPoint, end: OpeningPlacementPoint, points: OpeningPlacementPoint[]): number[] {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const length = Math.hypot(dx, dy);
  if (!length) return [];
  const lengthSquared = length * length;
  return points.map((point) => {
    const along = Math.max(0, Math.min(1, ((point.x - start.x) * dx + (point.y - start.y) * dy) / lengthSquared));
    const projected = { x: start.x + dx * along, y: start.y + dy * along };
    return Math.hypot(point.x - projected.x, point.y - projected.y) <= 1 ? along * length : null;
  }).filter((offset): offset is number => offset !== null)
    .filter((offset, index, offsets) => offsets.findIndex((candidate) => Math.abs(candidate - offset) <= .001) === index)
    .sort((first, second) => first - second);
}

/** Whether a whole opening interval is clear of wall corners and other openings. */
export function isOpeningPlacementValid(
  offset: number,
  width: number,
  length: number,
  cornerOffsets: number[],
  otherOpenings: OpeningInterval[],
  clearanceMm: number,
): boolean {
  if (width <= 0 || !inRange(offset, 0, length - width)) return false;
  if (cornerOffsets.some((cornerOffset) => !(offset + width <= cornerOffset - clearanceMm || offset >= cornerOffset + clearanceMm))) return false;
  return otherOpenings.every((opening) => offset + width <= opening.offset || offset >= opening.offset + opening.width);
}

/** Find the closest permitted position while retaining the opening fully on its wall. */
export function closestValidOpeningOffset(
  requestedOffset: number,
  width: number,
  length: number,
  cornerOffsets: number[],
  otherOpenings: OpeningInterval[],
  clearanceMm: number,
): number | null {
  const maximum = length - width;
  if (width <= 0 || maximum < 0) return null;
  const candidates = [
    Math.max(0, Math.min(maximum, requestedOffset)),
    ...cornerOffsets.flatMap((cornerOffset) => [cornerOffset - clearanceMm - width, cornerOffset + clearanceMm]),
    ...otherOpenings.flatMap((opening) => [opening.offset - width, opening.offset + opening.width]),
  ].filter((value, index, values) => inRange(value, 0, maximum) && values.findIndex((candidate) => Math.abs(candidate - value) < .001) === index)
    .filter((value) => isOpeningPlacementValid(value, width, length, cornerOffsets, otherOpenings, clearanceMm));
  return candidates.sort((first, second) => Math.abs(first - requestedOffset) - Math.abs(second - requestedOffset))[0] ?? null;
}
