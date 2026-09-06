import type { Point2D, Room } from "./types";

const POINT_TOLERANCE_MM = 0.5;
const PARAMETER_TOLERANCE = 1e-6;

export interface RenderedWall {
  room: Room;
  index: number;
  start: Point2D;
  end: Point2D;
  sourceOffsetMm: number;
  sourceLengthMm: number;
  capStart: boolean;
  capEnd: boolean;
}

interface CandidateWall {
  room: Room;
  index: number;
  start: Point2D;
  end: Point2D;
  length: number;
  hasOpening: boolean;
}

interface AtomicWall extends CandidateWall {
  from: number;
  to: number;
}

function pointKey(point: Point2D): string {
  return `${Math.round(point.x / POINT_TOLERANCE_MM)}:${Math.round(point.y / POINT_TOLERANCE_MM)}`;
}

function distance(first: Point2D, second: Point2D): number {
  return Math.hypot(first.x - second.x, first.y - second.y);
}

function pointAt(start: Point2D, end: Point2D, along: number): Point2D {
  return { x: start.x + (end.x - start.x) * along, y: start.y + (end.y - start.y) * along };
}

function projection(point: Point2D, start: Point2D, end: Point2D): number {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const lengthSquared = dx * dx + dy * dy;
  if (lengthSquared <= PARAMETER_TOLERANCE) return 0;
  return ((point.x - start.x) * dx + (point.y - start.y) * dy) / lengthSquared;
}

function pointOnSegment(point: Point2D, start: Point2D, end: Point2D): boolean {
  const along = projection(point, start, end);
  return along >= -PARAMETER_TOLERANCE
    && along <= 1 + PARAMETER_TOLERANCE
    && distance(point, pointAt(start, end, Math.max(0, Math.min(1, along)))) <= POINT_TOLERANCE_MM;
}

function lineIntersection(first: CandidateWall, second: CandidateWall): { firstAlong: number; secondAlong: number } | null {
  const firstVector = { x: first.end.x - first.start.x, y: first.end.y - first.start.y };
  const secondVector = { x: second.end.x - second.start.x, y: second.end.y - second.start.y };
  const denominator = firstVector.x * secondVector.y - firstVector.y * secondVector.x;
  if (Math.abs(denominator) <= PARAMETER_TOLERANCE) return null;
  const delta = { x: second.start.x - first.start.x, y: second.start.y - first.start.y };
  return {
    firstAlong: (delta.x * secondVector.y - delta.y * secondVector.x) / denominator,
    secondAlong: (delta.x * firstVector.y - delta.y * firstVector.x) / denominator,
  };
}

function uniqueParameters(parameters: number[]): number[] {
  return parameters
    .map((parameter) => Math.max(0, Math.min(1, parameter)))
    .sort((first, second) => first - second)
    .filter((parameter, index, sorted) => index === 0 || parameter - sorted[index - 1] > PARAMETER_TOLERANCE);
}

function exactSegmentKey(start: Point2D, end: Point2D): string {
  return [pointKey(start), pointKey(end)].sort().join("|");
}

function chooseSource(current: CandidateWall | undefined, candidate: CandidateWall): CandidateWall {
  if (!current || (candidate.hasOpening && !current.hasOpening)) return candidate;
  return current;
}

function incidentNeighbourKeys(walls: AtomicWall[]): Map<string, Set<string>> {
  const neighbours = new Map<string, Set<string>>();
  walls.forEach((wall) => {
    const startKey = pointKey(wall.start);
    const endKey = pointKey(wall.end);
    if (!neighbours.has(startKey)) neighbours.set(startKey, new Set());
    if (!neighbours.has(endKey)) neighbours.set(endKey, new Set());
    neighbours.get(startKey)!.add(endKey);
    neighbours.get(endKey)!.add(startKey);
  });
  return neighbours;
}

/**
 * Convert room boundaries into the non-overlapping atomic wall spans used by
 * the 3D viewer. Room faces can share only part of a boundary, so exact-edge
 * deduplication is not enough: every overlap endpoint must become a trim point.
 */
export function buildRenderedWalls(rooms: Room[]): RenderedWall[] {
  const uniqueByKey = new Map<string, CandidateWall>();
  rooms.forEach((room) => {
    room.vertices.forEach((start, index) => {
      const end = room.vertices[(index + 1) % room.vertices.length];
      const length = distance(start, end);
      if (length <= POINT_TOLERANCE_MM) return;
      const candidate: CandidateWall = {
        room,
        index,
        start,
        end,
        length,
        hasOpening: room.openings.some((opening) => opening.parent_wall_id === `wall-${String(index + 1).padStart(3, "0")}`),
      };
      const key = exactSegmentKey(start, end);
      uniqueByKey.set(key, chooseSource(uniqueByKey.get(key), candidate));
    });
  });

  const candidates = [...uniqueByKey.values()];
  const parameters = candidates.map(() => [0, 1]);
  candidates.forEach((first, firstIndex) => {
    candidates.forEach((second, secondIndex) => {
      if (firstIndex === secondIndex) return;
      const intersection = lineIntersection(first, second);
      if (intersection
        && intersection.firstAlong >= -PARAMETER_TOLERANCE
        && intersection.firstAlong <= 1 + PARAMETER_TOLERANCE
        && intersection.secondAlong >= -PARAMETER_TOLERANCE
        && intersection.secondAlong <= 1 + PARAMETER_TOLERANCE) {
        parameters[firstIndex].push(intersection.firstAlong);
      }
      if (pointOnSegment(second.start, first.start, first.end)) parameters[firstIndex].push(projection(second.start, first.start, first.end));
      if (pointOnSegment(second.end, first.start, first.end)) parameters[firstIndex].push(projection(second.end, first.start, first.end));
    });
  });

  const atomic: AtomicWall[] = [];
  candidates.forEach((candidate, candidateIndex) => {
    const cuts = uniqueParameters(parameters[candidateIndex]);
    for (let index = 0; index < cuts.length - 1; index += 1) {
      const from = cuts[index];
      const to = cuts[index + 1];
      if (to - from <= PARAMETER_TOLERANCE) continue;
      const start = pointAt(candidate.start, candidate.end, from);
      const end = pointAt(candidate.start, candidate.end, to);
      const midpoint = pointAt(candidate.start, candidate.end, (from + to) / 2);
      const source = candidates.find((other) => other !== candidate && pointOnSegment(midpoint, other.start, other.end));
      // A shared span is represented once. Prefer the source that owns an
      // opening, otherwise retain the first room boundary that contributed it.
      if (source && source.hasOpening && !candidate.hasOpening) continue;
      atomic.push({
        ...candidate,
        start,
        end,
        from: from * candidate.length,
        to: to * candidate.length,
      });
    }
  });

  const atomicByKey = new Map<string, AtomicWall>();
  atomic.forEach((wall) => {
    const key = exactSegmentKey(wall.start, wall.end);
    const current = atomicByKey.get(key);
    if (!current || (wall.hasOpening && !current.hasOpening)) atomicByKey.set(key, wall);
  });
  const deduplicated = [...atomicByKey.values()];
  const neighbours = incidentNeighbourKeys(deduplicated);
  const junctions = new Set([...neighbours.entries()]
    .filter(([, connected]) => connected.size > 2)
    .map(([key]) => key));

  return deduplicated.map((wall) => {
    const startKey = pointKey(wall.start);
    const endKey = pointKey(wall.end);
    return {
      room: wall.room,
      index: wall.index,
      start: wall.start,
      end: wall.end,
      sourceOffsetMm: wall.from,
      sourceLengthMm: wall.length,
      // A span split from a longer edge, or a real T/cross junction, gets a
      // flat cap. Only untouched two-edge corners retain the room mitre.
      capStart: wall.from > POINT_TOLERANCE_MM || junctions.has(startKey),
      capEnd: wall.to < wall.length - POINT_TOLERANCE_MM || junctions.has(endKey),
    };
  });
}
