import { type ElectricalConnection, type ElectricalLayoutData } from "./electricalLayout";
import { routeElectricalConnections, type ElectricalRouteOptions } from "./electricalAutoRouting";
import type { Obstacle, Point2D } from "./types";

export interface ElectricalCrossing {
  key: string;
  position: Point2D;
  connectionIds: [string, string];
  connected: boolean;
  sharedEndpoint: boolean;
  canJoin: boolean;
  direction: Point2D;
  otherDirection: Point2D;
  segmentIndices: [number, number];
}
const cross = (a: Point2D, b: Point2D) => a.x * b.y - a.y * b.x;
const sub = (a: Point2D, b: Point2D) => ({ x: a.x - b.x, y: a.y - b.y });
const near = (a: Point2D, b: Point2D) => Math.hypot(a.x - b.x, a.y - b.y) < 0.01;
const unit = (p: Point2D) => { const length = Math.hypot(p.x, p.y); return { x: p.x / length, y: p.y / length }; };

/** Geometry detects crossings only. Circuit membership never implies an electrical junction. */
export function electricalCrossings(layout: ElectricalLayoutData, fixtures: readonly Obstacle[], resolveEndpoint?: (connection: ElectricalConnection, side: "from" | "to", fixture: Obstacle) => Point2D, routeOptions: ElectricalRouteOptions = {}, resolvedPaths?: ReadonlyMap<string, Point2D[]>): ElectricalCrossing[] {
  const devices = new Map(fixtures.map(item => [item.id, item]));
  const terminal = (connection: ElectricalConnection, side: "from" | "to") => {
    const fixture = devices.get(side === "from" ? connection.fromId : connection.toId)!;
    return resolveEndpoint?.(connection, side, fixture) ?? fixture.center;
  };
  const paths = resolvedPaths ?? routeElectricalConnections(layout, fixtures, { ...routeOptions, endpoint: resolveEndpoint });
  const routes = layout.connections.flatMap(connection => {
    const from = devices.get(connection.fromId), to = devices.get(connection.toId);
    return from && to && paths.has(connection.id) ? [{ connection, points: paths.get(connection.id)! }] : [];
  });
  const crossings = new Map<string, ElectricalCrossing>();
  // A readable terminal moves with zoom; joining still belongs to the stored world route.
  const modelRoutes = resolveEndpoint && layout.junctions?.length ? electricalCrossings(layout, fixtures) : [];
  const modelCrossings = new Map(modelRoutes.map(c => [JSON.stringify([...c.connectionIds, ...c.segmentIndices]), c]));
  const modelPairs = new Map<string, ElectricalCrossing[]>();
  modelRoutes.forEach(c => { const pair = JSON.stringify(c.connectionIds);modelPairs.set(pair, [...(modelPairs.get(pair) ?? []), c]); });
  const endpoint = (connection: ElectricalConnection, point: Point2D) => {
    if (near(terminal(connection, "from"), point)) return [connection.fromId, connection.fromSwitchGang ?? 1].join(":");
    if (near(terminal(connection, "to"), point)) return [connection.toId, connection.toSwitchGang ?? 1].join(":");
    return null;
  };
  for (let a = 0; a < routes.length; a++) for (let b = a + 1; b < routes.length; b++) {
    const first = routes[a], second = routes[b];
    for (let i = 1; i < first.points.length; i++) for (let j = 1; j < second.points.length; j++) {
      const p = first.points[i - 1], q = second.points[j - 1];
      const r = sub(first.points[i], p), s = sub(second.points[j], q), denominator = cross(r, s);
      if (Math.abs(denominator) < 1e-8) continue; // Parallel/overlapping legs are not crossing junctions.
      const t = cross(sub(q, p), s) / denominator, u = cross(sub(q, p), r) / denominator;
      if (t < -1e-8 || t > 1 + 1e-8 || u < -1e-8 || u > 1 + 1e-8) continue;
      const position = { x: p.x + t * r.x, y: p.y + t * r.y };
      const ids: [string, string] = [first.connection.id, second.connection.id];
      const key = JSON.stringify([...ids, Number(position.x.toFixed(3)), Number(position.y.toFixed(3))]);
      const fromEndpoint = endpoint(first.connection, position), toEndpoint = endpoint(second.connection, position);
      const sharedEndpoint = Boolean(fromEndpoint && fromEndpoint === toEndpoint && first.connection.circuitId === second.connection.circuitId);
      // Independent terminals can share one symbol centre. That is not a wire crossing.
      if (fromEndpoint && toEndpoint && !sharedEndpoint) continue;
      const segmentIndices: [number, number] = [i - 1, j - 1];
      const candidates = modelPairs.get(JSON.stringify(ids));
      // Orthogonal routing can gain a bend when readable ports replace aligned centres.
      const model = resolveEndpoint ? modelCrossings.get(JSON.stringify([...ids, ...segmentIndices])) ?? (candidates?.length === 1 ? candidates[0] : null) : null;
      const canJoin = first.connection.circuitId === second.connection.circuitId && !fromEndpoint && !toEndpoint;
      const connected = sharedEndpoint || (canJoin && ((layout.junctions ?? []).some(junction => ids.every(id => junction.connectionIds.includes(id)) && near(junction.position, position)) || Boolean(model?.connected)));
      crossings.set(key, { key, position, connectionIds: ids, connected, sharedEndpoint, canJoin, direction: unit(r), otherDirection: unit(s), segmentIndices });
    }
  }
  // A saved join is still explicit when automatic routing turns the crossing
  // into a shared/collinear leg. Parallel geometry alone must never create one.
  for (const junction of layout.junctions ?? []) {
    const joinedRoutes = routes.filter(r => junction.connectionIds.includes(r.connection.id));
    const segmentAt = (points: Point2D[]) => points.findIndex((p, i) => {
      const q = points[i + 1]; if (!q) return false;
      const length = Math.hypot(q.x - p.x, q.y - p.y); if (length < 1e-8) return false;
      return Math.abs(cross(sub(junction.position, p), sub(q, p))) / length < .01 &&
        junction.position.x >= Math.min(p.x, q.x) - .01 && junction.position.x <= Math.max(p.x, q.x) + .01 && junction.position.y >= Math.min(p.y, q.y) - .01 && junction.position.y <= Math.max(p.y, q.y) + .01;
    });
    for (let a = 0; a < joinedRoutes.length; a++) for (let b = a + 1; b < joinedRoutes.length; b++) {
      const first = joinedRoutes[a], second = joinedRoutes[b], i = segmentAt(first.points), j = segmentAt(second.points);
      if (i < 0 || j < 0 || first.connection.circuitId !== second.connection.circuitId || endpoint(first.connection, junction.position) || endpoint(second.connection, junction.position)) continue;
      const ids: [string, string] = [first.connection.id, second.connection.id];
      const key = JSON.stringify([...ids, Number(junction.position.x.toFixed(3)), Number(junction.position.y.toFixed(3))]);
      crossings.set(key, { key, position: junction.position, connectionIds: ids, connected: true, sharedEndpoint: false, canJoin: true, direction: unit(sub(first.points[i + 1], first.points[i])), otherDirection: unit(sub(second.points[j + 1], second.points[j])), segmentIndices: [i, j] });
    }
  }
  return [...crossings.values()];
}

/** Screen-space hop, purely illustrative; authoritative pipe/cable routes remain in millimetres. */
export function crossingBridgePath(centre: Point2D, direction: Point2D, radius = 7): string {
  const start = { x: centre.x - direction.x * radius, y: centre.y - direction.y * radius };
  const end = { x: centre.x + direction.x * radius, y: centre.y + direction.y * radius };
  return `M${start.x},${start.y} A${radius},${radius} 0 0 1 ${end.x},${end.y}`;
}
