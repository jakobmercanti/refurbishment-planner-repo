import type { Obstacle, Point2D } from "@/lib/types";

export function snapObstacleToNearestWall(obstacle: Obstacle, vertices: Point2D[], requested: Point2D): Point2D {
  let best: { distance: number; point: Point2D; inward: Point2D } | null = null;
  for (let index = 0; index < vertices.length; index += 1) {
    const start = vertices[index];
    const end = vertices[(index + 1) % vertices.length];
    const dx = end.x - start.x;
    const dy = end.y - start.y;
    const length = Math.hypot(dx, dy);
    if (length <= 0) continue;
    const direction = { x: dx / length, y: dy / length };
    const along = Math.max(0, Math.min(length, (requested.x - start.x) * direction.x + (requested.y - start.y) * direction.y));
    const projected = { x: start.x + direction.x * along, y: start.y + direction.y * along };
    const distance = Math.hypot(requested.x - projected.x, requested.y - projected.y);
    if (!best || distance < best.distance) {
      best = { distance, point: projected, inward: { x: -direction.y, y: direction.x } };
    }
  }
  if (!best) return requested;
  const nearest = best as { distance: number; point: Point2D; inward: Point2D };

  const rotation = obstacle.rotation_deg * Math.PI / 180;
  const localWidth = { x: Math.cos(rotation), y: Math.sin(rotation) };
  const localDepth = { x: -Math.sin(rotation), y: Math.cos(rotation) };
  const halfWidth = obstacle.dimensions.width.value / 2;
  const halfDepth = obstacle.dimensions.depth.value / 2;
  const support = Math.abs(nearest.inward.x * localWidth.x + nearest.inward.y * localWidth.y) * halfWidth
    + Math.abs(nearest.inward.x * localDepth.x + nearest.inward.y * localDepth.y) * halfDepth;
  return {
    x: nearest.point.x + nearest.inward.x * support,
    y: nearest.point.y + nearest.inward.y * support,
  };
}
