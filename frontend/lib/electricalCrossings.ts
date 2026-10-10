import { electricalConnectionPoints, type ElectricalConnection, type ElectricalLayoutData } from "./electricalLayout";
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
}
const cross = (a: Point2D, b: Point2D) => a.x * b.y - a.y * b.x;
const sub = (a: Point2D, b: Point2D) => ({ x: a.x - b.x, y: a.y - b.y });
const near = (a: Point2D, b: Point2D) => Math.hypot(a.x - b.x, a.y - b.y) < 0.01;
const unit = (p: Point2D) => { const length = Math.hypot(p.x, p.y); return { x: p.x / length, y: p.y / length }; };

/** Geometry detects crossings only. Circuit membership never implies an electrical junction. */
export function electricalCrossings(layout: ElectricalLayoutData, fixtures: readonly Obstacle[]): ElectricalCrossing[] {
  const devices = new Map(fixtures.map(item => [item.id, item]));
  const routes = layout.connections.flatMap(connection => {
    const from = devices.get(connection.fromId), to = devices.get(connection.toId);
    return from && to ? [{ connection, points: electricalConnectionPoints(connection, from.center, to.center, layout.forceOrthogonalRouting) }] : [];
  });
  const crossings = new Map<string, ElectricalCrossing>();
  const endpoint = (connection: ElectricalConnection, point: Point2D) => {
    if (near(devices.get(connection.fromId)!.center, point)) return [connection.fromId, connection.fromSwitchGang ?? 1].join(":");
    if (near(devices.get(connection.toId)!.center, point)) return [connection.toId, connection.toSwitchGang ?? 1].join(":");
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
      const canJoin = first.connection.circuitId === second.connection.circuitId && !fromEndpoint && !toEndpoint;
      const connected = sharedEndpoint || (canJoin && (layout.junctions ?? []).some(junction => ids.every(id => junction.connectionIds.includes(id)) && near(junction.position, position)));
      crossings.set(key, { key, position, connectionIds: ids, connected, sharedEndpoint, canJoin, direction: unit(r), otherDirection: unit(s) });
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
