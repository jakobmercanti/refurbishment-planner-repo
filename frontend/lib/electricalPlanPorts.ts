import { electricalDevicePlanSize } from "./electricalPlanSymbols";
import { switchGangCount } from "./electricalSimulation";
import type { ElectricalConnection } from "./electricalLayout";
import type { Obstacle, Point2D } from "./types";

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
