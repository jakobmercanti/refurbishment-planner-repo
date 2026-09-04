import type { Point2D } from "./types";

export type RoomDetectionWall = { id: string; points: Point2D[] };
export type DetectedRoom = {
  id: string;
  name: string;
  vertices: Point2D[];
  sourceWallId: string;
  sourceWallIds?: string[];
};

const MIN_ENCLOSED_AREA_MM2 = 10_000;

const samePoint = (first: Point2D, second: Point2D, tolerance = 1) =>
  Math.hypot(first.x - second.x, first.y - second.y) <= tolerance;

function signedPolygonArea(points: Point2D[]): number {
  return points.reduce((area, point, index) => {
    const next = points[(index + 1) % points.length];
    return area + point.x * next.y - next.x * point.y;
  }, 0) / 2;
}

function counterClockwiseVertices(points: Point2D[]): Point2D[] {
  const vertices = points.map((point) => ({ ...point }));
  return signedPolygonArea(vertices) < 0 ? vertices.reverse() : vertices;
}

function pointOnSegment(point: Point2D, start: Point2D, end: Point2D): { point: Point2D; along: number } {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const lengthSquared = dx * dx + dy * dy;
  if (!lengthSquared) return { point: { ...start }, along: 0 };
  const along = Math.max(0, Math.min(1, ((point.x - start.x) * dx + (point.y - start.y) * dy) / lengthSquared));
  return { point: { x: start.x + dx * along, y: start.y + dy * along }, along };
}

function pointInsidePolygon(point: Point2D, polygon: Point2D[]): boolean {
  let inside = false;
  for (let index = 0, previous = polygon.length - 1; index < polygon.length; previous = index, index += 1) {
    const current = polygon[index];
    const before = polygon[previous];
    const crosses = (current.y > point.y) !== (before.y > point.y);
    if (crosses && point.x < (before.x - current.x) * (point.y - current.y) / (before.y - current.y) + current.x) inside = !inside;
  }
  return inside;
}

function pointInsideOrOnPolygon(point: Point2D, polygon: Point2D[], tolerance = 0.5): boolean {
  if (pointInsidePolygon(point, polygon)) return true;
  return polygon.some((start, index) => {
    const end = polygon[(index + 1) % polygon.length];
    const projected = pointOnSegment(point, start, end).point;
    return Math.hypot(point.x - projected.x, point.y - projected.y) <= tolerance;
  });
}

function polygonArea(points: Point2D[]): number {
  return Math.abs(points.reduce((total, point, index) => {
    const next = points[(index + 1) % points.length];
    return total + point.x * next.y - next.x * point.y;
  }, 0) / 2);
}

function samePolygon(first: Point2D[], second: Point2D[], tolerance = 0.5): boolean {
  const firstArea = polygonArea(first);
  const secondArea = polygonArea(second);
  const areaTolerance = Math.max(tolerance * tolerance, Math.max(firstArea, secondArea) * 1e-6);
  if (Math.abs(firstArea - secondArea) > areaTolerance) return false;
  return first.every((point) => pointInsideOrOnPolygon(point, second, tolerance))
    && second.every((point) => pointInsideOrOnPolygon(point, first, tolerance));
}

/** Detect bounded room faces from wall runs, splitting edges at all junctions. */
export function closedRooms(walls: RoomDetectionWall[]): DetectedRoom[] {
  type SourceSegment = { start: Point2D; end: Point2D; wallId: string };
  type GraphEdge = { first: string; second: string; wallIds: Set<string> };
  const tolerance = 0.5;
  const keyFor = (point: Point2D) => `${Math.round(point.x / tolerance)}:${Math.round(point.y / tolerance)}`;
  const segments: SourceSegment[] = walls.flatMap((wall) => wall.points.slice(0, -1).map((start, index) => ({ start, end: wall.points[index + 1], wallId: wall.id })).filter(({ start, end }) => !samePoint(start, end, tolerance)));
  const nodes = new Map<string, Point2D>();
  const addNode = (point: Point2D) => { const key = keyFor(point); if (!nodes.has(key)) nodes.set(key, { ...point }); return key; };
  segments.forEach(({ start, end }) => { addNode(start); addNode(end); });

  // Add crossings, then split every source segment at crossings and at wall-run endpoints.
  for (let firstIndex = 0; firstIndex < segments.length; firstIndex += 1) {
    const first = segments[firstIndex];
    for (let secondIndex = firstIndex + 1; secondIndex < segments.length; secondIndex += 1) {
      const second = segments[secondIndex];
      const firstVector = { x: first.end.x - first.start.x, y: first.end.y - first.start.y };
      const secondVector = { x: second.end.x - second.start.x, y: second.end.y - second.start.y };
      const denominator = firstVector.x * secondVector.y - firstVector.y * secondVector.x;
      if (Math.abs(denominator) <= 1e-9) continue;
      const delta = { x: second.start.x - first.start.x, y: second.start.y - first.start.y };
      const firstAlong = (delta.x * secondVector.y - delta.y * secondVector.x) / denominator;
      const secondAlong = (delta.x * firstVector.y - delta.y * firstVector.x) / denominator;
      if (firstAlong < -1e-6 || firstAlong > 1 + 1e-6 || secondAlong < -1e-6 || secondAlong > 1 + 1e-6) continue;
      addNode({ x: first.start.x + firstVector.x * firstAlong, y: first.start.y + firstVector.y * firstAlong });
    }
  }

  const edges = new Map<string, GraphEdge>();
  segments.forEach((segment) => {
    const splitPoints = [...nodes.entries()].map(([key, point]) => ({ key, point, projection: pointOnSegment(point, segment.start, segment.end) }))
      .filter(({ point, projection }) => samePoint(point, projection.point, tolerance))
      .sort((first, second) => first.projection.along - second.projection.along);
    for (let index = 0; index < splitPoints.length - 1; index += 1) {
      const first = splitPoints[index].key;
      const second = splitPoints[index + 1].key;
      if (first === second) continue;
      const edgeKey = [first, second].sort().join("|");
      const edge = edges.get(edgeKey) ?? { first, second, wallIds: new Set<string>() };
      edge.wallIds.add(segment.wallId);
      edges.set(edgeKey, edge);
    }
  });

  const neighbours = new Map<string, Set<string>>();
  edges.forEach(({ first, second }) => {
    if (!neighbours.has(first)) neighbours.set(first, new Set());
    if (!neighbours.has(second)) neighbours.set(second, new Set());
    neighbours.get(first)!.add(second);
    neighbours.get(second)!.add(first);
  });
  const visited = new Set<string>();
  const faces: { keys: string[]; area: number; wallIds: Set<string> }[] = [];
  const directedKey = (from: string, to: string) => `${from}>${to}`;

  // Follow each half-edge clockwise around the Cartesian plan graph. Positive-area
  // cycles are bounded room faces; the unbounded exterior is traversed in reverse.
  edges.forEach(({ first, second }) => {
    [[first, second], [second, first]].forEach(([initialFrom, initialTo]) => {
      if (visited.has(directedKey(initialFrom, initialTo))) return;
      const faceKeys: string[] = [];
      const faceWallIds = new Set<string>();
      let from = initialFrom;
      let to = initialTo;
      let complete = false;
      for (let step = 0; step <= edges.size * 2; step += 1) {
        const halfEdge = directedKey(from, to);
        if (visited.has(halfEdge)) { complete = from === initialFrom && to === initialTo; break; }
        visited.add(halfEdge);
        faceKeys.push(from);
        const edge = edges.get([from, to].sort().join("|"));
        edge?.wallIds.forEach((wallId) => faceWallIds.add(wallId));
        const centre = nodes.get(to)!;
        const ordered = [...(neighbours.get(to) ?? [])].sort((firstKey, secondKey) => {
          const firstPoint = nodes.get(firstKey)!;
          const secondPoint = nodes.get(secondKey)!;
          return Math.atan2(firstPoint.y - centre.y, firstPoint.x - centre.x) - Math.atan2(secondPoint.y - centre.y, secondPoint.x - centre.x);
        });
        const reverseIndex = ordered.indexOf(from);
        if (reverseIndex < 0 || !ordered.length) break;
        const next = ordered[(reverseIndex - 1 + ordered.length) % ordered.length];
        from = to;
        to = next;
        if (from === initialFrom && to === initialTo) { complete = true; break; }
      }
      if (!complete || faceKeys.length < 3) return;
      const area = faceKeys.reduce((total, key, index) => {
        const point = nodes.get(key)!;
        const next = nodes.get(faceKeys[(index + 1) % faceKeys.length])!;
        return total + point.x * next.y - next.x * point.y;
      }, 0) / 2;
      if (area >= MIN_ENCLOSED_AREA_MM2) faces.push({ keys: faceKeys, area, wallIds: faceWallIds });
    });
  });

  const closedWallRoomEntries = walls.flatMap((wall) => {
    if (!samePoint(wall.points[0], wall.points.at(-1)!)) return [];
    const planVertices = wall.points.slice(0, -1).map((point) => ({ ...point }));
    if (planVertices.length < 3) return [];
    return [{
      id: `closed-wall-${wall.id}`,
      name: "",
      sourceWallId: wall.id,
      sourceWallIds: [wall.id],
      planVertices,
      vertices: counterClockwiseVertices(planVertices),
    }];
  });

  const graphRooms = faces.sort((first, second) => second.area - first.area).map((face, index) => {
    const sourceWallIds = [...face.wallIds];
    return {
      id: `project-room-${index + 1}`,
      name: `Room ${index + 1}`,
      sourceWallId: sourceWallIds[0] ?? "",
      sourceWallIds,
      vertices: counterClockwiseVertices(face.keys.map((key) => ({ ...nodes.get(key)! }))),
    };
  });

  // A closed wall run is the initial room outline. Suppress it only when the
  // bounded graph faces fully partition its *interior*. An adjoining exterior
  // room also shares some of the outline's edges, but must leave the original
  // room intact.
  const subdividedWallIds = new Set(closedWallRoomEntries
    .filter((closedRoom) => {
      const interiorFaces = graphRooms.filter((room) =>
        room.sourceWallIds.includes(closedRoom.sourceWallId)
        && !samePolygon(room.vertices, closedRoom.planVertices)
        && room.vertices.every((vertex) => pointInsideOrOnPolygon(vertex, closedRoom.planVertices, tolerance))
      );
      const interiorArea = interiorFaces.reduce((total, room) => total + polygonArea(room.vertices), 0);
      const closedArea = polygonArea(closedRoom.planVertices);
      const areaTolerance = Math.max(tolerance * tolerance, closedArea * 1e-6);
      return interiorFaces.length > 0 && Math.abs(interiorArea - closedArea) <= areaTolerance;
    })
    .map((closedRoom) => closedRoom.sourceWallId));
  const extraGraphRooms = graphRooms.filter((room) =>
    !closedWallRoomEntries.some((closedRoom) => samePolygon(room.vertices, closedRoom.planVertices))
  );
  const closedWallRooms: DetectedRoom[] = closedWallRoomEntries
    .filter((room) => !subdividedWallIds.has(room.sourceWallId))
    .map((room) => ({ id: room.id, name: room.name, sourceWallId: room.sourceWallId, sourceWallIds: room.sourceWallIds, vertices: room.vertices }));
  return [...closedWallRooms, ...extraGraphRooms];
}
