import { electricalDevicePlanSize } from "./electricalPlanSymbols";
import { switchGangCount } from "./electricalSimulation";
import type { ElectricalConnection } from "./electricalLayout";
import type { Obstacle, Point2D } from "./types";
import type { ElectricalRouteBounds, ElectricalRouteOptions } from "./electricalAutoRouting";

export const GANG_BADGE_WIDTH = 22, GANG_BADGE_HEIGHT = 18, GANG_BADGE_PITCH = 30;
export const gangBadgePosition = (count: number, index: number, depth: number) => ({ x: (index - (count - 1) / 2) * GANG_BADGE_PITCH, y: depth / 2 + 15 });

/** Display terminal only. Physical dimensions and stored connection endpoints remain unchanged. */
export function electricalPlanEndpoint(connection: ElectricalConnection, side: "from" | "to", fixture: Obstacle,
  toScreen: (p: Point2D) => Point2D, active: boolean, zoom = 1): Point2D {
  const count = switchGangCount(fixture.representation_key);
  if (!active || !count) return fixture.center;
  const origin = toScreen(fixture.center), xAxis = toScreen({ x: fixture.center.x + 1, y: fixture.center.y }), yAxis = toScreen({ x: fixture.center.x, y: fixture.center.y + 1 });
  const a = xAxis.x - origin.x, b = yAxis.x - origin.x, c = xAxis.y - origin.y, d = yAxis.y - origin.y, det = a * d - b * c;
  if (Math.abs(det) < 1e-12) return fixture.center;
  const size = electricalDevicePlanSize(fixture.representation_key, Math.hypot(a, c) * fixture.dimensions.width.value / zoom, Math.hypot(b, d) * fixture.dimensions.depth.value / zoom, true);
  const gang = (side === "from" ? connection.fromSwitchGang : connection.toSwitchGang) ?? 1;
  const index = Math.max(0, Math.min(count - 1, gang - 1));
  const badge = gangBadgePosition(count, index, Math.max(size.depth, 26));
  const local = count > 1 ? { x: badge.x, y: badge.y + 14 } : { x: 0, y: Math.max(size.depth, 26) / 2 + 4 };
  const angle = -fixture.rotation_deg * Math.PI / 180;
  const x = (local.x * Math.cos(angle) - local.y * Math.sin(angle)) * zoom, y = (local.x * Math.sin(angle) + local.y * Math.cos(angle)) * zoom;
  return { x: fixture.center.x + (d * x - b * y) / det, y: fixture.center.y + (a * y - c * x) / det };
}

/** Same readable symbol envelope used by the SVG, expressed back in plan mm.
 * Zoom cancels at this boundary: fitting geometry is never enlarged in storage. */
export function electricalPlanRouteOptions(fixtures: readonly Obstacle[], toScreen: (p: Point2D) => Point2D, active: boolean, zoom = 1): ElectricalRouteOptions {
  // Screen transform subtraction can differ by ~1e-10 between zooms. Quantise
  // presentation-only envelopes to six decimal places so equal-cost routes stay stable.
  const stable = (value: number) => Math.round(value * 1e6) / 1e6;
  const bounds = new Map<string, ElectricalRouteBounds>();
  const origin = toScreen({ x: 0, y: 0 }), px = toScreen({ x: 1, y: 0 }), py = toScreen({ x: 0, y: 1 });
  const a = px.x - origin.x, b = py.x - origin.x, c = px.y - origin.y, d = py.y - origin.y, det = a * d - b * c;
  if (Math.abs(det) < 1e-12) return {};
  const scale = Math.hypot(a, c), symbolZoom = active ? zoom : 1;
  if (active) for (const fixture of fixtures) {
    const size = electricalDevicePlanSize(fixture.representation_key, scale * fixture.dimensions.width.value / symbolZoom, Math.hypot(b, d) * fixture.dimensions.depth.value / symbolZoom, true);
    const width = Math.max(44, Math.max(26, size.width) + 12), depth = Math.max(44, Math.max(26, size.depth) + 12);
    const angle = -fixture.rotation_deg * Math.PI / 180, count = switchGangCount(fixture.representation_key);
    const rotate = (p: Point2D) => ({ x: p.x * Math.cos(angle) - p.y * Math.sin(angle), y: p.x * Math.sin(angle) + p.y * Math.cos(angle) });
    const points = [-1, 1].flatMap(x => [-1, 1].map(y => rotate({ x: x * width / 2, y: y * depth / 2 })));
    if (count > 1) for (let i = 0; i < count; i++) {
      const badge = gangBadgePosition(count, i, Math.max(size.depth, 26));
      for (const x of [-1, 1]) for (const y of [-1, 1]) points.push(rotate({ x: badge.x + x * GANG_BADGE_WIDTH / 2, y: badge.y + y * GANG_BADGE_HEIGHT / 2 }));
    }
    const top = Math.min(...points.map(p => p.y));
    // Keep other fittings' reference labels clear too, not just their white plates.
    points.push({ x: -18, y: top - 25 }, { x: 18, y: top });
    const world = points.map(p => ({ x: fixture.center.x + (d * p.x - b * p.y) * symbolZoom / det, y: fixture.center.y + (a * p.y - c * p.x) * symbolZoom / det }));
    bounds.set(fixture.id, { left: stable(Math.min(...world.map(p => p.x))), right: stable(Math.max(...world.map(p => p.x))), bottom: stable(Math.min(...world.map(p => p.y))), top: stable(Math.max(...world.map(p => p.y))) });
  }
  return { endpoint: (connection, side, fixture) => { const p = electricalPlanEndpoint(connection, side, fixture, toScreen, active, symbolZoom); return p === fixture.center ? p : { x: stable(p.x), y: stable(p.y) }; }, bounds, clearanceMm: stable(Math.max(1, 8 * symbolZoom / scale)) };
}
