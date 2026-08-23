import type { Obstacle, Point2D } from "@/lib/types";

const WALL_SAFETY_MARGIN_MM = 20;

function pointInPolygon(point: Point2D, vertices: Point2D[]) {
  let inside = false;
  for (let index = 0, previous = vertices.length - 1; index < vertices.length; previous = index, index += 1) {
    const currentPoint = vertices[index];
    const previousPoint = vertices[previous];
    const crosses = (currentPoint.y > point.y) !== (previousPoint.y > point.y)
      && point.x < (previousPoint.x - currentPoint.x) * (point.y - currentPoint.y)
      / (previousPoint.y - currentPoint.y) + currentPoint.x;
    if (crosses) inside = !inside;
  }
  return inside;
}

function obstacleCorners(obstacle: Obstacle, center: Point2D, rotationDeg: number) {
  const angle = rotationDeg * Math.PI / 180;
  const cosine = Math.cos(angle);
  const sine = Math.sin(angle);
  const halfWidth = obstacle.dimensions.width.value / 2;
  const halfDepth = obstacle.dimensions.depth.value / 2;
  return ([-1, 1] as const).flatMap((widthSide) => ([-1, 1] as const).map((depthSide) => {
    const localX = widthSide * halfWidth;
    const localY = depthSide * halfDepth;
    return {
      x: center.x + localX * cosine + localY * sine,
      y: center.y + localX * sine - localY * cosine,
    };
  }));
}

export function alignObstacleToNearestWall(obstacle: Obstacle, vertices: Point2D[], requested: Point2D): Obstacle {
  const candidates = vertices.flatMap((start, index) => {
    const end = vertices[(index + 1) % vertices.length];
    const dx = end.x - start.x;
    const dy = end.y - start.y;
    const length = Math.hypot(dx, dy);
    if (length <= 0) return [];
    const direction = { x: dx / length, y: dy / length };
    const inward = { x: -direction.y, y: direction.x };
    const endAllowance = Math.min(obstacle.dimensions.width.value / 2 + WALL_SAFETY_MARGIN_MM, length / 2);
    const requestedAlong = (requested.x - start.x) * direction.x + (requested.y - start.y) * direction.y;
    const along = Math.max(endAllowance, Math.min(length - endAllowance, requestedAlong));
    const wallPoint = { x: start.x + direction.x * along, y: start.y + direction.y * along };
    const rotationDeg = (Math.atan2(direction.y, direction.x) * 180 / Math.PI + 180 + 360) % 360;
    const support = obstacle.dimensions.depth.value / 2 + WALL_SAFETY_MARGIN_MM;
    const center = { x: wallPoint.x + inward.x * support, y: wallPoint.y + inward.y * support };
    const valid = obstacleCorners(obstacle, center, rotationDeg).every((corner) => pointInPolygon(corner, vertices));
    if (!valid) return [];
    return [{ center, rotationDeg, distance: Math.hypot(requested.x - wallPoint.x, requested.y - wallPoint.y) }];
  });
  const best = candidates.sort((first, second) => first.distance - second.distance)[0];
  if (!best) return { ...obstacle };
  return { ...obstacle, center: best.center, rotation_deg: best.rotationDeg };
}

export function snapObstacleToNearestWall(obstacle: Obstacle, vertices: Point2D[], requested: Point2D): Point2D {
  return alignObstacleToNearestWall(obstacle, vertices, requested).center;
}
