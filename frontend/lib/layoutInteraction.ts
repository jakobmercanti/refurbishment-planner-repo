import type { Obstacle, Point2D } from "@/lib/types";

interface NearestWall {
  point: Point2D;
  inward: Point2D;
  angleDeg: number;
}

function nearestWall(vertices: Point2D[], requested: Point2D): NearestWall | null {
  let best: (NearestWall & { distance: number }) | null = null;
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
      best = {
        distance,
        point: projected,
        inward: { x: -direction.y, y: direction.x },
        angleDeg: Math.atan2(direction.y, direction.x) * 180 / Math.PI,
      };
    }
  }
  return best;
}

export function alignObstacleToNearestWall(obstacle: Obstacle, vertices: Point2D[], requested: Point2D): Obstacle {
  const wall = nearestWall(vertices, requested);
  if (!wall) return { ...obstacle, center: requested };
  const rotationDeg = (wall.angleDeg + 180 + 360) % 360;
  const support = obstacle.dimensions.depth.value / 2;
  return {
    ...obstacle,
    center: {
      x: wall.point.x + wall.inward.x * support,
      y: wall.point.y + wall.inward.y * support,
    },
    rotation_deg: rotationDeg,
  };
}

export function snapObstacleToNearestWall(obstacle: Obstacle, vertices: Point2D[], requested: Point2D): Point2D {
  return alignObstacleToNearestWall(obstacle, vertices, requested).center;
}
