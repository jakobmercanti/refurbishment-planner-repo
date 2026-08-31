export type WallDragPoint = { x: number; y: number };
export type WallDragAttachment = { wallId: string; segmentIndex: number; along: number; hideCorner?: boolean };
export type WallDragWall = { id: string; points: WallDragPoint[]; attachments?: Record<number, WallDragAttachment> };

const AUTO_BRIDGE_PREFIX = "auto-wall-bridge";
const CONNECTION_TOLERANCE_MM = 1;

function samePoint(first: WallDragPoint, second: WallDragPoint, tolerance = CONNECTION_TOLERANCE_MM): boolean {
  return Math.hypot(first.x - second.x, first.y - second.y) <= tolerance;
}

function projectOnSegment(point: WallDragPoint, start: WallDragPoint, end: WallDragPoint): { point: WallDragPoint; along: number; distance: number } {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const lengthSquared = dx * dx + dy * dy;
  const along = lengthSquared ? Math.max(0, Math.min(1, ((point.x - start.x) * dx + (point.y - start.y) * dy) / lengthSquared)) : 0;
  const projected = { x: start.x + dx * along, y: start.y + dy * along };
  return { point: projected, along, distance: Math.hypot(point.x - projected.x, point.y - projected.y) };
}

function segmentExists(walls: WallDragWall[], start: WallDragPoint, end: WallDragPoint): boolean {
  return walls.some((wall) => wall.points.slice(0, -1).some((point, segmentIndex) => {
    const next = wall.points[segmentIndex + 1];
    return (samePoint(point, start) && samePoint(next, end)) || (samePoint(point, end) && samePoint(next, start));
  }));
}

export function retainDraggedWallConnections(
  baselineWalls: WallDragWall[],
  candidateWalls: WallDragWall[],
  draggedWallId: string,
  draggedSegmentIndex: number,
): WallDragWall[] {
  const baselineDraggedWall = baselineWalls.find((wall) => wall.id === draggedWallId);
  const candidateDraggedWall = candidateWalls.find((wall) => wall.id === draggedWallId);
  if (!baselineDraggedWall || !candidateDraggedWall) return candidateWalls;

  const bridgeFamily = `${AUTO_BRIDGE_PREFIX}:${draggedWallId}:${draggedSegmentIndex}:`;
  const repaired = candidateWalls.filter((wall) => !wall.id.startsWith(bridgeFamily));
  const endpointIndices = [...new Set([draggedSegmentIndex, draggedSegmentIndex + 1])];

  endpointIndices.forEach((pointIndex) => {
    const originalPoint = baselineDraggedWall.points[pointIndex];
    const movedPoint = candidateDraggedWall.points[pointIndex];
    if (!originalPoint || !movedPoint || samePoint(originalPoint, movedPoint, .001)) return;

    const explicitAttachment = baselineDraggedWall.attachments?.[pointIndex];
    const inferredHost = baselineWalls.flatMap((wall) => {
      if (wall.id === draggedWallId || wall.id.startsWith(AUTO_BRIDGE_PREFIX)) return [];
      return wall.points.slice(0, -1).flatMap((start, segmentIndex) => {
        const end = wall.points[segmentIndex + 1];
        const projection = projectOnSegment(originalPoint, start, end);
        return projection.distance <= CONNECTION_TOLERANCE_MM ? [{ wallId: wall.id, segmentIndex, along: projection.along }] : [];
      });
    })[0];
    const connection = explicitAttachment && explicitAttachment.wallId !== draggedWallId ? explicitAttachment : inferredHost;
    if (!connection) return;

    const hostWall = repaired.find((wall) => wall.id === connection.wallId);
    const hostStart = hostWall?.points[connection.segmentIndex];
    const hostEnd = hostWall?.points[connection.segmentIndex + 1];
    if (!hostWall || !hostStart || !hostEnd) return;

    const projection = projectOnSegment(movedPoint, hostStart, hostEnd);
    if (projection.distance <= CONNECTION_TOLERANCE_MM || segmentExists(repaired, projection.point, movedPoint)) return;

    const bridgeId = `${bridgeFamily}${pointIndex}:${connection.wallId}:${connection.segmentIndex}`;
    repaired.push({
      id: bridgeId,
      points: [{ ...projection.point }, { ...movedPoint }],
      attachments: {
        0: { wallId: connection.wallId, segmentIndex: connection.segmentIndex, along: projection.along, hideCorner: true },
        1: { wallId: draggedWallId, segmentIndex: draggedSegmentIndex, along: pointIndex === draggedSegmentIndex ? 0 : 1, hideCorner: true },
      },
    });
  });

  return repaired;
}
