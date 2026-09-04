export type WallDragPoint = { x: number; y: number };
export type WallDragAttachment = { wallId: string; segmentIndex: number; along: number; hideCorner?: boolean };
export type WallDragWall = { id: string; points: WallDragPoint[]; attachments?: Record<number, WallDragAttachment>; thicknessOverridesMm?: Record<number, number>; lengthOverridesMm?: Record<number, number>; cornerNumbers?: Record<number, number> };

export type MaterializedWallSelection = {
  walls: WallDragWall[];
  wallId: string;
  segmentIndex: number;
  sourceSegmentIndex: number;
  splitAlong: number[];
};

export type IndependentWallSegment = {
  walls: WallDragWall[];
  segmentIndex: number;
  detachedPointIndex?: number;
  keepDetachedPointHidden?: boolean;
  detachedEndPointIndex?: number;
  keepDetachedEndPointHidden?: boolean;
};

const AUTO_BRIDGE_PREFIX = "auto-wall-bridge";
const CONNECTION_TOLERANCE_MM = 1;
const ORTHOGONAL_TOLERANCE_MM = 0.001;
const LENGTH_OVERRIDE_TOLERANCE_MM = 0.01;

/**
 * Keep user-entered wall dimensions authoritative after another edit changes
 * the surrounding topology. The endpoint is moved along the segment's current
 * direction and every coincident copy is moved with it, so a locked dimension
 * cannot turn a connected corner into a detached wall endpoint.
 */
export function enforceWallLengthOverrides(walls: WallDragWall[]): WallDragWall[] {
  const nextWalls = walls.map((wall) => ({
    ...wall,
    points: wall.points.map((point) => ({ ...point })),
    attachments: wall.attachments ? Object.fromEntries(Object.entries(wall.attachments).map(([index, attachment]) => [index, { ...attachment }])) : undefined,
    lengthOverridesMm: wall.lengthOverridesMm ? { ...wall.lengthOverridesMm } : undefined,
  }));

  nextWalls.forEach((wall) => {
    const overrides = wall.lengthOverridesMm;
    if (!overrides) return;
    const closed = wall.points.length > 2 && samePoint(wall.points[0], wall.points.at(-1)!);
    Object.entries(overrides).sort(([first], [second]) => Number(first) - Number(second)).forEach(([rawIndex, targetLength]) => {
      const segmentIndex = Number(rawIndex);
      if (!Number.isInteger(segmentIndex) || segmentIndex < 0 || !Number.isFinite(targetLength) || targetLength <= 0) return;
      const endIndex = closed && segmentIndex + 1 === wall.points.length - 1 ? 0 : segmentIndex + 1;
      const start = wall.points[segmentIndex];
      const end = wall.points[endIndex];
      if (!start || !end) return;
      const dx = end.x - start.x;
      const dy = end.y - start.y;
      const length = Math.hypot(dx, dy);
      if (!length || Math.abs(length - targetLength) <= LENGTH_OVERRIDE_TOLERANCE_MM) return;
      const target = { x: start.x + dx / length * targetLength, y: start.y + dy / length * targetLength };
      const previousEnd = { ...end };
      nextWalls.forEach((candidateWall) => {
        candidateWall.points.forEach((point, pointIndex) => {
          const attachment = candidateWall.attachments?.[pointIndex];
          const followsLockedEndpoint = attachment?.wallId === wall.id
            && attachment.segmentIndex === segmentIndex
            && attachment.along >= 1 - CONNECTION_TOLERANCE_MM / Math.max(1, length);
          if (samePoint(point, previousEnd) || followsLockedEndpoint) candidateWall.points[pointIndex] = { ...target };
        });
      });
    });
  });
  return nextWalls;
}

/**
 * Apply locked lengths only when the resulting geometry is still orthogonal.
 * A squared plan can have mutually incompatible manual lengths (for example,
 * a narrower upper room joined to a wider lower room). In that case the
 * ordinary override pass would move an endpoint along a diagonal and silently
 * break the user's "horizontal or vertical" constraint. Returning null lets
 * the editor reject that frame and keep the previous geometry intact.
 */
export function enforceWallLengthOverridesPreservingOrthogonality(walls: WallDragWall[]): WallDragWall[] | null {
  const enforced = enforceWallLengthOverrides(walls);
  const orthogonal = enforced.every((wall) => wall.points.slice(0, -1).every((start, index) => {
    const end = wall.points[index + 1];
    return Boolean(end) && (Math.abs(end.x - start.x) <= ORTHOGONAL_TOLERANCE_MM || Math.abs(end.y - start.y) <= ORTHOGONAL_TOLERANCE_MM);
  }));
  return orthogonal ? enforced : null;
}

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

/**
 * Legacy drawings may not have explicit junction attachments. Infer one only
 * when the point is effectively on the host segment; nearby parallel walls
 * must remain independent when either wall is dragged.
 */
export function isPreciseWallJunction(point: WallDragPoint, start: WallDragPoint, end: WallDragPoint, tolerance = 5): boolean {
  return projectOnSegment(point, start, end).distance <= tolerance;
}

function remapSegmentIndexAfterSplit(segmentIndex: number, sourceSegmentIndex: number, insertedCount: number): number {
  return segmentIndex > sourceSegmentIndex ? segmentIndex + insertedCount : segmentIndex;
}

function subsegmentForAlong(boundaries: number[], along: number, preferredIndex?: number): number {
  const boundaryIndex = boundaries.findIndex((boundary, index) => index > 0 && index < boundaries.length - 1 && Math.abs(boundary - along) <= 1e-6);
  if (boundaryIndex >= 0 && preferredIndex !== undefined && (preferredIndex === boundaryIndex - 1 || preferredIndex === boundaryIndex)) return preferredIndex;
  return Math.max(0, Math.min(boundaries.length - 2, boundaries.findIndex((boundary, index) => index < boundaries.length - 1 && along <= boundaries[index + 1] + 1e-6)));
}

/**
 * Turn visible T-junctions into real editable wall vertices before selection.
 * The room graph already treats these points as corners, but leaving the host
 * wall unsplit makes a click below the junction select and move the full run.
 */
export function materializeWallJunctionsForSelection(
  walls: WallDragWall[],
  wallId: string,
  segmentIndex: number,
  selectionPoint: WallDragPoint,
): MaterializedWallSelection {
  const host = walls.find((wall) => wall.id === wallId);
  const start = host?.points[segmentIndex];
  const end = host?.points[segmentIndex + 1];
  if (!host || !start || !end) return { walls, wallId, segmentIndex, sourceSegmentIndex: segmentIndex, splitAlong: [] };

  const splitAlong = walls.flatMap((wall) => wall.id === wallId ? [] : wall.points.flatMap((point, pointIndex) => {
    if (wall.attachments?.[pointIndex]?.hideCorner) return [];
    const projection = projectOnSegment(point, start, end);
    return projection.distance <= CONNECTION_TOLERANCE_MM && projection.along > 1e-6 && projection.along < 1 - 1e-6 ? [projection.along] : [];
  })).sort((first, second) => first - second).filter((along, index, values) => index === 0 || Math.abs(along - values[index - 1]) > 1e-6);
  if (!splitAlong.length) return { walls, wallId, segmentIndex, sourceSegmentIndex: segmentIndex, splitAlong: [] };

  const boundaries = [0, ...splitAlong, 1];
  const selectedAlong = projectOnSegment(selectionPoint, start, end).along;
  const selectedSubsegment = boundaries.slice(0, -1).reduce((closest, lower, index) => {
    const midpoint = (lower + boundaries[index + 1]) / 2;
    const closestMidpoint = (boundaries[closest] + boundaries[closest + 1]) / 2;
    return Math.abs(selectedAlong - midpoint) < Math.abs(selectedAlong - closestMidpoint) ? index : closest;
  }, 0);
  const insertedCount = splitAlong.length;
  const nextWalls = walls.map((wall) => {
    if (wall.id === wallId) {
      const inserted = splitAlong.map((along) => ({ x: start.x + (end.x - start.x) * along, y: start.y + (end.y - start.y) * along }));
      const points = [...wall.points.slice(0, segmentIndex + 1), ...inserted, ...wall.points.slice(segmentIndex + 1)];
      const existingCornerNumbers = wall.cornerNumbers ? Object.fromEntries(Object.entries(wall.cornerNumbers).map(([rawIndex, number]) => {
        const pointIndex = Number(rawIndex);
        return [pointIndex > segmentIndex ? pointIndex + insertedCount : pointIndex, number];
      })) : {};
      let nextCornerNumber = Math.max(0, ...walls.flatMap((candidate) => Object.values(candidate.cornerNumbers ?? {}))) + 1;
      const insertedAttachments: Record<number, WallDragAttachment> = {};
      inserted.forEach((point, index) => {
        const connected = walls.flatMap((candidate) => candidate.id === wallId ? [] : candidate.points.map((candidatePoint, pointIndex) => ({ candidatePoint, pointIndex, candidate })))
          .find(({ candidatePoint, pointIndex, candidate }) => samePoint(candidatePoint, point) && !candidate.attachments?.[pointIndex]?.hideCorner);
        const connectedNumber = connected?.candidate.cornerNumbers?.[connected.pointIndex];
        existingCornerNumbers[segmentIndex + 1 + index] = connectedNumber ?? nextCornerNumber++;
        if (connectedNumber !== undefined) insertedAttachments[segmentIndex + 1 + index] = { wallId, segmentIndex, along: 1, hideCorner: true };
      });
      const attachments = wall.attachments ? Object.fromEntries(Object.entries(wall.attachments).map(([rawIndex, attachment]) => {
        const pointIndex = Number(rawIndex);
        return [pointIndex > segmentIndex ? pointIndex + insertedCount : pointIndex, { ...attachment }];
      })) : undefined;
      const mergedAttachments = Object.keys(insertedAttachments).length ? { ...attachments, ...insertedAttachments } : attachments;
      const thicknessOverridesMm = wall.thicknessOverridesMm ? Object.entries(wall.thicknessOverridesMm).reduce<Record<number, number>>((result, [rawIndex, thickness]) => {
        const sourceIndex = Number(rawIndex);
        if (sourceIndex < segmentIndex) result[sourceIndex] = thickness;
        else if (sourceIndex === segmentIndex) boundaries.slice(0, -1).forEach((_, index) => { result[segmentIndex + index] = thickness; });
        else result[sourceIndex + insertedCount] = thickness;
        return result;
      }, {}) : undefined;
      const lengthOverridesMm = wall.lengthOverridesMm ? Object.entries(wall.lengthOverridesMm).reduce<Record<number, number>>((result, [rawIndex, length]) => {
        const sourceIndex = Number(rawIndex);
        if (sourceIndex < segmentIndex) result[sourceIndex] = length;
        else if (sourceIndex === segmentIndex) boundaries.slice(0, -1).forEach((_, index) => { result[segmentIndex + index] = length * (boundaries[index + 1] - boundaries[index]); });
        else result[sourceIndex + insertedCount] = length;
        return result;
      }, {}) : undefined;
      return { ...wall, points, attachments: mergedAttachments, thicknessOverridesMm, lengthOverridesMm, cornerNumbers: existingCornerNumbers };
    }

    const attachments = wall.attachments ? Object.fromEntries(Object.entries(wall.attachments).map(([rawPointIndex, attachment]) => {
      if (attachment.wallId !== wallId) return [rawPointIndex, { ...attachment }];
      if (attachment.segmentIndex !== segmentIndex) return [rawPointIndex, { ...attachment, segmentIndex: remapSegmentIndexAfterSplit(attachment.segmentIndex, segmentIndex, insertedCount) }];
      const point = wall.points[Number(rawPointIndex)];
      const along = point ? projectOnSegment(point, start, end).along : attachment.along;
      const subsegment = subsegmentForAlong(boundaries, along, selectedSubsegment);
      const lower = boundaries[subsegment];
      const upper = boundaries[subsegment + 1];
      return [rawPointIndex, { ...attachment, segmentIndex: segmentIndex + subsegment, along: (along - lower) / (upper - lower) }];
    })) : undefined;
    return { ...wall, attachments };
  });

  return { walls: nextWalls, wallId, segmentIndex: segmentIndex + selectedSubsegment, sourceSegmentIndex: segmentIndex, splitAlong };
}

function parallelSegments(firstStart: WallDragPoint, firstEnd: WallDragPoint, secondStart: WallDragPoint, secondEnd: WallDragPoint): boolean {
  const firstLength = Math.hypot(firstEnd.x - firstStart.x, firstEnd.y - firstStart.y);
  const secondLength = Math.hypot(secondEnd.x - secondStart.x, secondEnd.y - secondStart.y);
  if (!firstLength || !secondLength) return false;
  const dot = ((firstEnd.x - firstStart.x) * (secondEnd.x - secondStart.x)
    + (firstEnd.y - firstStart.y) * (secondEnd.y - secondStart.y)) / (firstLength * secondLength);
  return Math.abs(dot) >= .995;
}

function straightRunPointIndices(points: WallDragPoint[], pointIndex: number, referenceStart: WallDragPoint, referenceEnd: WallDragPoint): number[] {
  const closed = points.length > 2 && samePoint(points[0], points.at(-1)!);
  const core = closed ? points.slice(0, -1) : points;
  if (!core[pointIndex] || core.length < 2) return [pointIndex];
  const run = new Set<number>([pointIndex]);
  for (const direction of [-1, 1] as const) {
    let current = pointIndex;
    for (let count = 0; count < core.length; count += 1) {
      const segmentIndex = direction === 1 ? current : current - 1;
      if (!closed && (segmentIndex < 0 || segmentIndex >= core.length - 1)) break;
      const normalizedSegmentIndex = (segmentIndex + core.length) % core.length;
      const nextPointIndex = direction === 1 ? (current + 1) % core.length : (current - 1 + core.length) % core.length;
      const start = core[normalizedSegmentIndex];
      const end = core[(normalizedSegmentIndex + 1) % core.length];
      if (!start || !end || !parallelSegments(start, end, referenceStart, referenceEnd)) break;
      run.add(nextPointIndex);
      current = nextPointIndex;
      if (current === pointIndex) break;
    }
  }
  return [...run];
}

/**
 * A branch endpoint on the middle of a closed room side is a structural
 * junction, even when an older drawing or an in-flight split has no explicit
 * attachment record for it. True room corners are deliberately excluded: they
 * may need a bridge when a user moves an adjoining wall away from the corner.
 */
function closedRoomSideConnectionAtPoint(
  walls: WallDragWall[],
  branchWallId: string,
  point: WallDragPoint,
  preferred?: WallDragAttachment,
): WallDragAttachment | undefined {
  const candidates = walls.flatMap((host) => {
    const closed = host.points.length > 2 && samePoint(host.points[0], host.points.at(-1)!);
    if (!closed || host.id === branchWallId || host.id.startsWith(AUTO_BRIDGE_PREFIX)) return [];
    return host.points.slice(0, -1).flatMap((start, segmentIndex) => {
      const end = host.points[segmentIndex + 1];
      if (!end) return [];
      const projection = projectOnSegment(point, start, end);
      if (projection.distance > CONNECTION_TOLERANCE_MM) return [];
      const interior = projection.along > .001 && projection.along < .999;
      const vertexIndex = projection.along <= .001 ? segmentIndex : segmentIndex + 1;
      const materializedVertex = !interior && straightRunPointIndices(host.points, vertexIndex, start, end).length >= 3;
      return interior || materializedVertex
        ? [{ wallId: host.id, segmentIndex, along: projection.along }]
        : [];
    });
  });
  if (!candidates.length) return undefined;
  return candidates.find((candidate) => candidate.wallId === preferred?.wallId && candidate.segmentIndex === preferred.segmentIndex) ?? candidates[0];
}

/**
 * A wall translation must not pull an unrelated parallel run along with it.
 *
 * Shared corners are synchronised separately, but squared-room propagation can
 * still move another wall's lower/upper side when the selected side is moved.
 * Restore parallel segments which do not terminate directly on either endpoint
 * of the selected segment. This keeps a wall such as 6–5 fixed while the
 * selected 4–9 segment is translated, without changing genuine endpoint
 * connections or the selected segment itself. The unrelated side can live on
 * the same closed wall run (as it does for a room outline) or on another wall.
 */
export function preserveUnrelatedParallelWallSegments(
  baselineWalls: WallDragWall[],
  candidateWalls: WallDragWall[],
  movedWallId: string,
  movedSegmentIndex: number,
): WallDragWall[] {
  const baselineDragged = baselineWalls.find((wall) => wall.id === movedWallId);
  const selectedStart = baselineDragged?.points[movedSegmentIndex];
  const selectedEnd = baselineDragged?.points[movedSegmentIndex + 1];
  if (!baselineDragged || !selectedStart || !selectedEnd) return candidateWalls;

  return candidateWalls.map((candidateWall) => {
    if (candidateWall.id.startsWith(AUTO_BRIDGE_PREFIX)) return candidateWall;
    const baselineWall = baselineWalls.find((wall) => wall.id === candidateWall.id);
    if (!baselineWall) return candidateWall;
    const closed = baselineWall.points.length > 2 && samePoint(baselineWall.points[0], baselineWall.points.at(-1)!);
    const lastSegmentIndex = baselineWall.points.length - 2;
    const points = candidateWall.points.map((point) => ({ ...point }));
    let changed = false;

    baselineWall.points.slice(0, -1).forEach((baselineStart, segmentIndex) => {
      const baselineEnd = baselineWall.points[segmentIndex + 1];
      const candidateStart = points[segmentIndex];
      const candidateEnd = points[segmentIndex + 1];
      if (!baselineEnd || !candidateStart || !candidateEnd) return;
      if (!parallelSegments(baselineStart, baselineEnd, selectedStart, selectedEnd)) return;
      if (samePoint(baselineStart, selectedStart) || samePoint(baselineStart, selectedEnd)
        || samePoint(baselineEnd, selectedStart) || samePoint(baselineEnd, selectedEnd)) return;
      if (samePoint(candidateStart, baselineStart, .001) && samePoint(candidateEnd, baselineEnd, .001)) return;

      points[segmentIndex] = { ...baselineStart };
      points[segmentIndex + 1] = { ...baselineEnd };
      changed = true;
      // The final segment of a closed wall ends at the duplicated first point.
      // Keep that duplicate in sync with the restored segment endpoint.
      if (closed && segmentIndex === lastSegmentIndex) points[0] = { ...baselineEnd };
      // The first segment starts at the duplicated first point's counterpart.
      // Restore the closing duplicate too when that segment is the unrelated
      // parallel run, otherwise the closed wall would be left open.
      if (closed && segmentIndex === 0) points[points.length - 1] = { ...baselineStart };
    });

    return changed ? { ...candidateWall, points } : candidateWall;
  });
}

/**
 * A wall drag is scoped to the selected segment. Repair passes intentionally
 * inspect the whole wall graph so they can recreate a bridge at a moved
 * junction, but that broad inspection must not turn an unrelated wall into a
 * moving participant. Keep only points which are explicitly anchored to the
 * selected segment (or are an unannotated, perpendicular T-junction) and
 * restore every other existing point from the drag-start snapshot.
 *
 * Auto-bridge walls are deliberately excluded: they are the topology repair
 * created by the drag and must remain available after unrelated walls are
 * restored.
 */
export function preserveUnrelatedWallGeometry(
  baselineWalls: WallDragWall[],
  candidateWalls: WallDragWall[],
  movedWallId: string,
  movedSegmentIndex: number,
): WallDragWall[] {
  const baselineDragged = baselineWalls.find((wall) => wall.id === movedWallId);
  const selectedStart = baselineDragged?.points[movedSegmentIndex];
  const selectedEnd = baselineDragged?.points[movedSegmentIndex + 1];
  if (!baselineDragged || !selectedStart || !selectedEnd) return candidateWalls;

  const hasPerpendicularLeg = (wall: WallDragWall, pointIndex: number): boolean => {
    const closed = wall.points.length > 2 && samePoint(wall.points[0], wall.points.at(-1)!);
    const core = closed ? wall.points.slice(0, -1) : wall.points;
    const point = core[pointIndex];
    if (!point) return false;
    const neighbours = [
      ...(pointIndex > 0 || closed ? [core[(pointIndex - 1 + core.length) % core.length]] : []),
      ...(pointIndex < core.length - 1 || closed ? [core[pointIndex + 1]] : []),
    ];
    const hostLength = Math.hypot(selectedEnd.x - selectedStart.x, selectedEnd.y - selectedStart.y);
    if (!hostLength) return false;
    return neighbours.some((neighbour) => {
      if (!neighbour) return false;
      const length = Math.hypot(neighbour.x - point.x, neighbour.y - point.y);
      if (!length) return false;
      const alignment = Math.abs(((neighbour.x - point.x) / length) * ((selectedEnd.x - selectedStart.x) / hostLength)
        + ((neighbour.y - point.y) / length) * ((selectedEnd.y - selectedStart.y) / hostLength));
      return alignment < .995;
    });
  };

  return candidateWalls.map((candidateWall) => {
    if (candidateWall.id === movedWallId || candidateWall.id.startsWith(AUTO_BRIDGE_PREFIX)) return candidateWall;
    const baselineWall = baselineWalls.find((wall) => wall.id === candidateWall.id);
    if (!baselineWall) return candidateWall;

    const allowedPointIndexes = new Set<number>();
    Object.entries(baselineWall.attachments ?? {}).forEach(([rawIndex, attachment]) => {
      const pointIndex = Number(rawIndex);
      if (attachment.wallId === movedWallId && attachment.segmentIndex === movedSegmentIndex) allowedPointIndexes.add(pointIndex);
    });
    const closed = baselineWall.points.length > 2 && samePoint(baselineWall.points[0], baselineWall.points.at(-1)!);
    // A newly drawn adjoining run can remember the shared corner through the
    // *other* segment incident to that corner (for example, corner 3 points
    // at the room's top edge rather than the side being dragged).  In that
    // case its endpoint attachment does not name the selected segment, even
    // though the endpoint is the same physical junction.  Treat coincident
    // endpoints as connected as well; otherwise this repair pass restores the
    // endpoint from the drag-start snapshot and leaves the adjoining wall
    // truncated when the selected side translates.
    if (!closed) {
      baselineWall.points.forEach((point, pointIndex) => {
        const endpoint = pointIndex === 0 || pointIndex === baselineWall.points.length - 1;
        if (endpoint && (samePoint(point, selectedStart, .001) || samePoint(point, selectedEnd, .001))) allowedPointIndexes.add(pointIndex);
      });
    }
    // A shared endpoint between two closed room runs is a real junction, not
    // an unrelated corner. The synchronization pass moves that point on every
    // incident room; restoring it here would reopen the neighbouring room at
    // the exact failure mode seen when dragging wall 2–3.
    if (closed) {
      baselineWall.points.slice(0, -1).forEach((point, pointIndex) => {
        if (samePoint(point, selectedStart, .001) || samePoint(point, selectedEnd, .001)) allowedPointIndexes.add(pointIndex);
      });
    }
    baselineWall.points.slice(0, closed ? -1 : undefined).forEach((point, pointIndex) => {
      const projection = projectOnSegment(point, selectedStart, selectedEnd);
      const interior = projection.along > .001 && projection.along < .999;
      if (interior && projection.distance <= CONNECTION_TOLERANCE_MM && hasPerpendicularLeg(baselineWall, pointIndex)) allowedPointIndexes.add(pointIndex);
    });

    const changed = candidateWall.points.length !== baselineWall.points.length
      || candidateWall.points.some((point, pointIndex) => !samePoint(point, baselineWall.points[pointIndex], .001));
    // A split or inserted point on an unrelated wall is still an unrelated
    // mutation. Restore the complete drag-start wall before considering any
    // attached-point exceptions.
    if (allowedPointIndexes.size === 0) {
      return changed ? {
        ...baselineWall,
        points: baselineWall.points.map((point) => ({ ...point })),
        attachments: baselineWall.attachments ? Object.fromEntries(Object.entries(baselineWall.attachments).map(([index, attachment]) => [index, { ...attachment }])) : undefined,
        thicknessOverridesMm: baselineWall.thicknessOverridesMm ? { ...baselineWall.thicknessOverridesMm } : undefined,
        lengthOverridesMm: baselineWall.lengthOverridesMm ? { ...baselineWall.lengthOverridesMm } : undefined,
        cornerNumbers: baselineWall.cornerNumbers ? { ...baselineWall.cornerNumbers } : undefined,
      } : candidateWall;
    }
    if (candidateWall.points.length !== baselineWall.points.length) return candidateWall;
    if (!changed) return candidateWall;

    const points = baselineWall.points.map((point, pointIndex) => allowedPointIndexes.has(pointIndex)
      ? { ...candidateWall.points[pointIndex] }
      : { ...point });
    const attachments: Record<number, WallDragAttachment> = { ...baselineWall.attachments };
    allowedPointIndexes.forEach((pointIndex) => {
      const candidateAttachment = candidateWall.attachments?.[pointIndex];
      if (candidateAttachment) attachments[pointIndex] = { ...candidateAttachment };
    });
    if (closed) {
      const uniqueLast = baselineWall.points.length - 1;
      points[uniqueLast] = allowedPointIndexes.has(0) || allowedPointIndexes.has(uniqueLast)
        ? { ...points[0] }
        : { ...baselineWall.points[uniqueLast] };
    }
    return {
      ...baselineWall,
      points,
      attachments: Object.keys(attachments).length ? attachments : undefined,
      thicknessOverridesMm: baselineWall.thicknessOverridesMm ? { ...baselineWall.thicknessOverridesMm } : undefined,
      lengthOverridesMm: baselineWall.lengthOverridesMm ? { ...baselineWall.lengthOverridesMm } : undefined,
      cornerNumbers: baselineWall.cornerNumbers ? { ...baselineWall.cornerNumbers } : undefined,
    };
  });
}

/** Translate an already materialized straight wall run when its junction corner is dragged. */
export function translateStraightWallRunForCorner(
  baselineWalls: WallDragWall[],
  candidateWalls: WallDragWall[],
  wallId: string,
  pointIndex: number,
): WallDragWall[] {
  const baselineWall = baselineWalls.find((wall) => wall.id === wallId);
  const candidateWall = candidateWalls.find((wall) => wall.id === wallId);
  const baselinePoint = baselineWall?.points[pointIndex];
  const candidatePoint = candidateWall?.points[pointIndex];
  if (!baselineWall || !candidateWall || !baselinePoint || !candidatePoint) return candidateWalls;
  const delta = { x: candidatePoint.x - baselinePoint.x, y: candidatePoint.y - baselinePoint.y };
  if (Math.hypot(delta.x, delta.y) <= CONNECTION_TOLERANCE_MM) return candidateWalls;
  const previous = baselineWall.points[pointIndex - 1];
  const next = baselineWall.points[pointIndex + 1];
  if (!previous || !next || !parallelSegments(previous, baselinePoint, baselinePoint, next)) return candidateWalls;
  const pointIndices = straightRunPointIndices(baselineWall.points, pointIndex, previous, baselinePoint);
  if (pointIndices.length < 3) return candidateWalls;
  return candidateWalls.map((wall) => {
    if (wall.id !== wallId) return wall;
    const points = wall.points.map((point, index) => pointIndices.includes(index)
      ? { x: baselineWall.points[index].x + delta.x, y: baselineWall.points[index].y + delta.y }
      : { ...point });
    if (samePoint(wall.points[0], wall.points.at(-1)!)) points[points.length - 1] = { ...points[0] };
    return { ...wall, points };
  });
}

/**
 * Give a translated segment its own start corner when the preceding segment
 * runs parallel to it. Without this small return segment, moving the shared
 * point would make the preceding wall diagonal (and the orthogonal editor
 * quite correctly reject the entire drag). The original point stays at the
 * junction while the duplicate carries the existing corner identity.
 */
export function separateParallelSegmentStartForDrag(
  walls: WallDragWall[],
  wallId: string,
  segmentIndex: number,
): IndependentWallSegment {
  const wall = walls.find((candidate) => candidate.id === wallId);
  const start = wall?.points[segmentIndex];
  const end = wall?.points[segmentIndex + 1];
  if (!wall || !start || !end || segmentIndex <= 0) return { walls, segmentIndex };
  const previousStart = wall.points[segmentIndex - 1];
  if (!previousStart || !parallelSegments(previousStart, start, start, end)) return { walls, segmentIndex };

  const insertedIndex = segmentIndex + 1;
  const points = [
    ...wall.points.slice(0, insertedIndex),
    { ...start },
    ...wall.points.slice(insertedIndex),
  ];
  const cornerNumbers = wall.cornerNumbers
    ? Object.fromEntries(Object.entries(wall.cornerNumbers).map(([rawIndex, number]) => {
      const pointIndex = Number(rawIndex);
      return [pointIndex >= insertedIndex ? pointIndex + 1 : pointIndex, number];
    }))
    : undefined;
  const existingNumber = cornerNumbers?.[segmentIndex];
  const connected = walls.flatMap((candidate) => candidate.id === wallId ? [] : candidate.points.map((candidatePoint, pointIndex) => ({ candidatePoint, pointIndex, candidate })))
    .find(({ candidatePoint, pointIndex, candidate }) => samePoint(candidatePoint, start) && !candidate.attachments?.[pointIndex]?.hideCorner);
  const connectedNumber = connected?.candidate.cornerNumbers?.[connected.pointIndex];
  let keepDetachedPointHidden = false;
  if (cornerNumbers && existingNumber !== undefined) {
    const nextNumber = Math.max(0, ...walls.flatMap((candidate) => Object.values(candidate.cornerNumbers ?? {}))) + 1;
    cornerNumbers[segmentIndex] = nextNumber;
    cornerNumbers[insertedIndex] = connectedNumber ?? existingNumber;
    keepDetachedPointHidden = connectedNumber !== undefined;
  }
  const attachments = wall.attachments
    ? Object.fromEntries(Object.entries(wall.attachments).map(([rawIndex, attachment]) => {
      const pointIndex = Number(rawIndex);
      return [pointIndex >= insertedIndex ? pointIndex + 1 : pointIndex, { ...attachment }];
    }))
    : {};
  // Hide the duplicate until it actually moves; otherwise pointer-down would
  // briefly render two labels at the same location. If another wall already
  // owns this junction it remains hidden because that wall carries the label.
  if (attachments[segmentIndex]) attachments[segmentIndex] = { ...attachments[segmentIndex], hideCorner: false };
  attachments[insertedIndex] = { wallId, segmentIndex, along: 1, hideCorner: true };
  const thicknessOverridesMm = wall.thicknessOverridesMm
    ? Object.entries(wall.thicknessOverridesMm).reduce<Record<number, number>>((result, [rawIndex, thickness]) => {
      const index = Number(rawIndex);
      if (index < segmentIndex) result[index] = thickness;
      else if (index === segmentIndex) { result[index] = thickness; result[index + 1] = thickness; }
      else result[index + 1] = thickness;
      return result;
    }, {})
    : undefined;
  const lengthOverridesMm = wall.lengthOverridesMm
    ? Object.entries(wall.lengthOverridesMm).reduce<Record<number, number>>((result, [rawIndex, length]) => {
      const index = Number(rawIndex);
      if (index < segmentIndex) result[index] = length;
      else result[index + 1] = length;
      return result;
    }, {})
    : undefined;
  const nextWalls = walls.map((candidate) => candidate.id === wallId
    ? { ...candidate, points, cornerNumbers, attachments, thicknessOverridesMm, lengthOverridesMm }
    : candidate);
  return { walls: nextWalls, segmentIndex: insertedIndex, detachedPointIndex: insertedIndex, keepDetachedPointHidden };
}

/** Mirror the start separation for a segment whose following wall runs parallel. */
export function separateParallelSegmentEndForDrag(
  walls: WallDragWall[],
  wallId: string,
  segmentIndex: number,
): IndependentWallSegment {
  const wall = walls.find((candidate) => candidate.id === wallId);
  const start = wall?.points[segmentIndex];
  const end = wall?.points[segmentIndex + 1];
  const nextEnd = wall?.points[segmentIndex + 2];
  if (!wall || !start || !end || !nextEnd || !parallelSegments(start, end, end, nextEnd)) return { walls, segmentIndex };

  const insertedIndex = segmentIndex + 1;
  const points = [
    ...wall.points.slice(0, insertedIndex),
    { ...end },
    ...wall.points.slice(insertedIndex),
  ];
  const cornerNumbers = wall.cornerNumbers
    ? Object.fromEntries(Object.entries(wall.cornerNumbers).map(([rawIndex, number]) => {
      const pointIndex = Number(rawIndex);
      return [pointIndex >= insertedIndex ? pointIndex + 1 : pointIndex, number];
    }))
    : undefined;
  const existingNumber = cornerNumbers?.[insertedIndex + 1];
  const connected = walls.flatMap((candidate) => candidate.id === wallId ? [] : candidate.points.map((candidatePoint, pointIndex) => ({ candidatePoint, pointIndex, candidate })))
    .find(({ candidatePoint, pointIndex, candidate }) => samePoint(candidatePoint, end) && !candidate.attachments?.[pointIndex]?.hideCorner);
  const connectedNumber = connected?.candidate.cornerNumbers?.[connected.pointIndex];
  let keepDetachedEndPointHidden = false;
  if (cornerNumbers && existingNumber !== undefined) {
    const nextNumber = Math.max(0, ...walls.flatMap((candidate) => Object.values(candidate.cornerNumbers ?? {}))) + 1;
    cornerNumbers[insertedIndex + 1] = nextNumber;
    cornerNumbers[insertedIndex] = connectedNumber ?? existingNumber;
    keepDetachedEndPointHidden = connectedNumber !== undefined;
  }
  const attachments = wall.attachments
    ? Object.fromEntries(Object.entries(wall.attachments).map(([rawIndex, attachment]) => {
      const pointIndex = Number(rawIndex);
      return [pointIndex >= insertedIndex ? pointIndex + 1 : pointIndex, { ...attachment }];
    }))
    : {};
  if (attachments[insertedIndex + 1]) attachments[insertedIndex + 1] = { ...attachments[insertedIndex + 1], hideCorner: false };
  attachments[insertedIndex] = { wallId, segmentIndex, along: 0, hideCorner: true };
  const thicknessOverridesMm = wall.thicknessOverridesMm
    ? Object.entries(wall.thicknessOverridesMm).reduce<Record<number, number>>((result, [rawIndex, thickness]) => {
      const index = Number(rawIndex);
      if (index <= segmentIndex) {
        result[index] = thickness;
        if (index === segmentIndex) result[index + 1] = thickness;
      } else result[index + 1] = thickness;
      return result;
    }, {})
    : undefined;
  const lengthOverridesMm = wall.lengthOverridesMm
    ? Object.entries(wall.lengthOverridesMm).reduce<Record<number, number>>((result, [rawIndex, length]) => {
      const index = Number(rawIndex);
      if (index <= segmentIndex) result[index] = length;
      else result[index + 1] = length;
      return result;
    }, {})
    : undefined;
  const nextWalls = walls.map((candidate) => candidate.id === wallId
    ? { ...candidate, points, cornerNumbers, attachments, thicknessOverridesMm, lengthOverridesMm }
    : candidate);
  return { walls: nextWalls, segmentIndex, detachedEndPointIndex: insertedIndex, keepDetachedEndPointHidden };
}

/** Limit a perpendicular wall translation before it reaches a parallel wall. */
export function constrainTranslatedWallDistance(
  baselineWalls: WallDragWall[],
  wallId: string,
  segmentIndex: number,
  requestedDistance: number,
  minimumClearance: number,
): number {
  const draggedWall = baselineWalls.find((wall) => wall.id === wallId);
  const start = draggedWall?.points[segmentIndex];
  const end = draggedWall?.points[segmentIndex + 1];
  if (!draggedWall || !start || !end || !requestedDistance) return requestedDistance;
  const length = Math.hypot(end.x - start.x, end.y - start.y);
  if (!length) return requestedDistance;
  const tangent = { x: (end.x - start.x) / length, y: (end.y - start.y) / length };
  const normal = { x: -tangent.y, y: tangent.x };
  let constrainedDistance = requestedDistance;

  for (const wall of baselineWalls) {
    wall.points.slice(0, -1).forEach((candidateStart, candidateSegmentIndex) => {
      if (wall.id === wallId && candidateSegmentIndex === segmentIndex) return;
      const candidateEnd = wall.points[candidateSegmentIndex + 1];
      if (!candidateEnd || samePoint(candidateStart, start) || samePoint(candidateStart, end) || samePoint(candidateEnd, start) || samePoint(candidateEnd, end)) return;
      const candidateLength = Math.hypot(candidateEnd.x - candidateStart.x, candidateEnd.y - candidateStart.y);
      if (!candidateLength) return;
      const candidateTangent = { x: (candidateEnd.x - candidateStart.x) / candidateLength, y: (candidateEnd.y - candidateStart.y) / candidateLength };
      if (Math.abs(tangent.x * candidateTangent.x + tangent.y * candidateTangent.y) < .995) return;
      const candidateAlongStart = (candidateStart.x - start.x) * tangent.x + (candidateStart.y - start.y) * tangent.y;
      const candidateAlongEnd = (candidateEnd.x - start.x) * tangent.x + (candidateEnd.y - start.y) * tangent.y;
      const overlap = Math.min(length, Math.max(candidateAlongStart, candidateAlongEnd)) - Math.max(0, Math.min(candidateAlongStart, candidateAlongEnd));
      if (overlap <= 1) return;
      const offset = ((candidateStart.x - start.x) * normal.x + (candidateStart.y - start.y) * normal.y + (candidateEnd.x - start.x) * normal.x + (candidateEnd.y - start.y) * normal.y) / 2;
      if (requestedDistance * offset <= 0) return;
      if (Math.abs(offset) <= minimumClearance) { constrainedDistance = 0; return; }
      const stoppingDistance = offset - Math.sign(offset) * minimumClearance;
      if (Math.abs(constrainedDistance) > Math.abs(stoppingDistance)) constrainedDistance = stoppingDistance;
    });
  }
  return constrainedDistance;
}

/** Apply translated-segment clearance limits to the target of a squared corner drag. */
export function constrainSquaredCornerTarget(
  baselineWalls: WallDragWall[],
  wallId: string,
  pointIndex: number,
  candidatePoints: WallDragPoint[],
  requestedTarget: WallDragPoint,
  minimumClearance: number,
): WallDragPoint {
  const wall = baselineWalls.find((candidate) => candidate.id === wallId);
  const originalPoint = wall?.points[pointIndex];
  if (!wall || !originalPoint) return requestedTarget;
  const axisTargets: Record<"x" | "y", number[]> = { x: [requestedTarget.x], y: [requestedTarget.y] };

  // A squared corner drag resizes the two wall segments which meet at the
  // selected point.  Clearance against a parallel wall is not enough here:
  // when the corner is dragged past either neighbouring junction, one of
  // those incident segments collapses and the outline can fold through the
  // opposite wall before the translated-segment check sees an overlap. Keep
  // every incident segment on its original side of the corner and at least
  // the requested clearance long.  This is evaluated from the drag-start
  // topology and therefore also covers fast pointer samples.
  if (minimumClearance > 0) {
    const closed = wall.points.length > 2 && samePoint(wall.points[0], wall.points.at(-1)!);
    const incidentSegments = new Set<number>();
    if (pointIndex > 0) incidentSegments.add(pointIndex - 1);
    if (pointIndex < wall.points.length - 1) incidentSegments.add(pointIndex);
    if (closed && pointIndex === 0) incidentSegments.add(wall.points.length - 2);
    incidentSegments.forEach((segmentIndex) => {
      const start = wall.points[segmentIndex];
      const end = wall.points[segmentIndex + 1];
      const candidateStart = candidatePoints[segmentIndex];
      const candidateEnd = candidatePoints[segmentIndex + 1];
      if (!start || !end || !candidateStart || !candidateEnd) return;
      const selectedIsStart = segmentIndex === pointIndex;
      const selectedIsEnd = segmentIndex + 1 === pointIndex;
      if (!selectedIsStart && !selectedIsEnd) return;
      const horizontal = Math.abs(end.x - start.x) >= Math.abs(end.y - start.y);
      const axis = horizontal ? "x" : "y";
      const baselineSelected = selectedIsStart ? start : end;
      const baselineOther = selectedIsStart ? end : start;
      const direction = Math.sign(baselineOther[axis] - baselineSelected[axis]);
      if (!direction) return;
      const candidateSelected = selectedIsStart ? candidateStart : candidateEnd;
      const candidateOther = selectedIsStart ? candidateEnd : candidateStart;
      const available = (candidateOther[axis] - candidateSelected[axis]) * direction;
      if (available + 0.001 >= minimumClearance) return;
      const boundedSelected = candidateOther[axis] - direction * minimumClearance;
      axisTargets[axis].push(requestedTarget[axis] + boundedSelected - candidateSelected[axis]);
    });
  }

  wall.points.slice(0, -1).forEach((start, segmentIndex) => {
    const end = wall.points[segmentIndex + 1];
    const movedStart = candidatePoints[segmentIndex];
    const movedEnd = candidatePoints[segmentIndex + 1];
    if (!end || !movedStart || !movedEnd) return;
    const startDelta = { x: movedStart.x - start.x, y: movedStart.y - start.y };
    const endDelta = { x: movedEnd.x - end.x, y: movedEnd.y - end.y };
    const length = Math.hypot(end.x - start.x, end.y - start.y);
    if (!length) return;
    const tangent = { x: (end.x - start.x) / length, y: (end.y - start.y) / length };
    const normal = { x: -tangent.y, y: tangent.x };
    const startNormalDistance = startDelta.x * normal.x + startDelta.y * normal.y;
    const endNormalDistance = endDelta.x * normal.x + endDelta.y * normal.y;
    // A corner drag can translate a segment normally while also shortening or
    // lengthening it tangentially. Compare only the normal component so slight
    // sideways pointer movement cannot disable penetration clearance.
    if (Math.abs(startNormalDistance) <= .001 || Math.abs(startNormalDistance - endNormalDistance) > .001) return;
    const requestedDistance = startNormalDistance;
    const distance = constrainTranslatedWallDistance(baselineWalls, wallId, segmentIndex, requestedDistance, minimumClearance);
    const correction = distance - requestedDistance;
    const axis = Math.abs(normal.x) >= Math.abs(normal.y) ? "x" : "y";
    axisTargets[axis].push(requestedTarget[axis] + normal[axis] * correction);
  });

  // The dragged corner can be the endpoint of a separate connector wall. In
  // that case the source wall only resizes tangentially, while the connector
  // is translated normally by junction synchronisation. Apply the same
  // clearance rule to every incident connector (including restored plans that
  // predate automatic bridge metadata) so moving corner 10 cannot push its
  // vertical leg through wall 2-5.
  baselineWalls.forEach((connectedWall) => {
    if (connectedWall.id === wallId) return;
    connectedWall.points.slice(0, -1).forEach((start, segmentIndex) => {
      const end = connectedWall.points[segmentIndex + 1];
      if (!end || (!samePoint(start, originalPoint) && !samePoint(end, originalPoint))) return;
      const length = Math.hypot(end.x - start.x, end.y - start.y);
      if (!length) return;
      const tangent = { x: (end.x - start.x) / length, y: (end.y - start.y) / length };
      const normal = { x: -tangent.y, y: tangent.x };
      const requestedDistance = (requestedTarget.x - originalPoint.x) * normal.x
        + (requestedTarget.y - originalPoint.y) * normal.y;
      if (Math.abs(requestedDistance) <= .001) return;
      const distance = constrainTranslatedWallDistance(baselineWalls, connectedWall.id, segmentIndex, requestedDistance, minimumClearance);
      const correction = distance - requestedDistance;
      const axis = Math.abs(normal.x) >= Math.abs(normal.y) ? "x" : "y";
      axisTargets[axis].push(requestedTarget[axis] + normal[axis] * correction);
    });
  });
  return {
    x: axisTargets.x.reduce((closest, target) => Math.abs(target - originalPoint.x) < Math.abs(closest - originalPoint.x) ? target : closest),
    y: axisTargets.y.reduce((closest, target) => Math.abs(target - originalPoint.y) < Math.abs(closest - originalPoint.y) ? target : closest),
  };
}

/**
 * A wall endpoint may terminate at the middle of a perpendicular host wall.
 * Dragging that endpoint normal to the host means the host wall is being moved,
 * not detached. Translate the complete host segment so the junction remains a
 * single corner and no synthetic bridge is needed.
 */
export function translateHostSegmentWithDraggedEndpoint(
  baselineWalls: WallDragWall[],
  candidateWalls: WallDragWall[],
  draggedWallId: string,
  draggedPointIndex: number,
): WallDragWall[] {
  const baselineDragged = baselineWalls.find((wall) => wall.id === draggedWallId);
  const candidateDragged = candidateWalls.find((wall) => wall.id === draggedWallId);
  const baselinePoint = baselineDragged?.points[draggedPointIndex];
  const candidatePoint = candidateDragged?.points[draggedPointIndex];
  if (!baselineDragged || !candidateDragged || !baselinePoint || !candidatePoint) return candidateWalls;
  const delta = { x: candidatePoint.x - baselinePoint.x, y: candidatePoint.y - baselinePoint.y };
  const deltaLength = Math.hypot(delta.x, delta.y);
  if (deltaLength <= CONNECTION_TOLERANCE_MM) return candidateWalls;

  const adjacentPoints = [baselineDragged.points[draggedPointIndex - 1], baselineDragged.points[draggedPointIndex + 1]].filter((point): point is WallDragPoint => Boolean(point));
  const explicit = baselineDragged.attachments?.[draggedPointIndex];
  const draggedClosed = baselineDragged.points.length > 2 && samePoint(baselineDragged.points[0], baselineDragged.points.at(-1)!);
  // A T junction on a closed room side is materialized as a room vertex. When
  // that vertex is dragged, the room side is translated first; keep an
  // explicitly attached open wall endpoint with it before the
  // connection-repair stage can split the wall at its former endpoint.
  const explicitHost = explicit && explicit.wallId !== draggedWallId ? baselineWalls.find((wall) => wall.id === explicit.wallId) : undefined;
  const previous = baselineDragged.points[draggedPointIndex - 1];
  const next = baselineDragged.points[draggedPointIndex + 1];
  const roomRun = previous && next && parallelSegments(previous, baselinePoint, baselinePoint, next)
    ? straightRunPointIndices(baselineDragged.points, draggedPointIndex, previous, baselinePoint)
    : [];
  const roomRunFollowed = roomRun.length >= 3 && roomRun.every((index) => {
    const baselineRunPoint = baselineDragged.points[index];
    const candidateRunPoint = candidateDragged.points[index];
    return Boolean(candidateRunPoint)
      && Math.hypot(candidateRunPoint.x - baselineRunPoint.x - delta.x, candidateRunPoint.y - baselineRunPoint.y - delta.y) <= CONNECTION_TOLERANCE_MM;
  });
  const attachedOpenBranch = [explicitHost, ...baselineWalls]
    .filter((wall): wall is WallDragWall => Boolean(wall && wall.id !== draggedWallId && !samePoint(wall.points[0], wall.points.at(-1)!)))
    .find((wall) => samePoint(wall.points[0], baselinePoint) || samePoint(wall.points.at(-1)!, baselinePoint));
  if (draggedClosed && attachedOpenBranch && roomRunFollowed) {
    const branchEndpointIndex = samePoint(attachedOpenBranch.points[0], baselinePoint) ? 0 : attachedOpenBranch.points.length - 1;
    return candidateWalls.map((wall) => wall.id !== attachedOpenBranch.id ? wall : {
      ...wall,
      points: wall.points.map((point, index) => index === branchEndpointIndex
        ? { x: point.x + delta.x, y: point.y + delta.y }
        : { ...point }),
    });
  }
  const inferredConnections = baselineWalls.flatMap((wall) => {
    if (wall.id === draggedWallId || wall.id.startsWith(AUTO_BRIDGE_PREFIX)) return [];
    return wall.points.slice(0, -1).flatMap((start, segmentIndex) => {
      const end = wall.points[segmentIndex + 1];
      if (!end) return [];
      const projection = projectOnSegment(baselinePoint, start, end);
      return projection.distance <= CONNECTION_TOLERANCE_MM
        ? [{ wallId: wall.id, segmentIndex, along: projection.along }]
        : [];
    });
  });
  // Attachments are persisted across wall splits and older plans may retain a
  // segment index that no longer contains the endpoint. Keep the explicit
  // anchor when it is valid, but fall back to the precise geometric junction
  // instead of treating a stale anchor as a detached corner.
  const connections = [
    ...(explicit && explicit.wallId !== draggedWallId ? [explicit] : []),
    ...inferredConnections.filter((candidate) => !explicit || candidate.wallId !== explicit.wallId || candidate.segmentIndex !== explicit.segmentIndex),
  ];

  const connection = connections.find((candidate) => {
    const host = baselineWalls.find((wall) => wall.id === candidate.wallId);
    const start = host?.points[candidate.segmentIndex];
    const end = host?.points[candidate.segmentIndex + 1];
    if (!host || !start || !end) return false;
    const projection = projectOnSegment(baselinePoint, start, end);
    if (projection.distance > CONNECTION_TOLERANCE_MM) return false;
    const hostLength = Math.hypot(end.x - start.x, end.y - start.y);
    if (!hostLength) return false;
    const tangent = { x: (end.x - start.x) / hostLength, y: (end.y - start.y) / hostLength };
    if (Math.abs(delta.x * tangent.x + delta.y * tangent.y) > deltaLength * .01) return false;
    const hasPerpendicularLeg = adjacentPoints.some((point) => {
      const legLength = Math.hypot(point.x - baselinePoint.x, point.y - baselinePoint.y);
      return legLength > CONNECTION_TOLERANCE_MM && Math.abs(((point.x - baselinePoint.x) * tangent.x + (point.y - baselinePoint.y) * tangent.y) / legLength) < .1;
    });
    if (!hasPerpendicularLeg) return false;
    if (projection.along > .001 && projection.along < .999) return true;

    // Once the host has been materialized at a T junction, the dragged
    // endpoint is coincident with a host vertex instead of lying in the
    // interior of a host segment. A perpendicular branch drag should still
    // translate the complete straight host run, not create a bridge and a
    // duplicate corner at the old junction.
    const hostPointIndex = projection.along <= .001 ? candidate.segmentIndex : candidate.segmentIndex + 1;
    const run = straightRunPointIndices(host.points, hostPointIndex, start, end);
    return run.length > 1;
  });
  if (!connection) return candidateWalls;

  // A closed outline corner which is already a host endpoint is a real room
  // corner. Keep that host fixed and let the repair pass add a connector if the
  // dragged outline moves away from it. Interior junctions are different: the
  // host segment can follow the dragged corner without creating a wall stub in
  // the room being edited.
  const connectionHost = baselineWalls.find((wall) => wall.id === connection.wallId);
  const connectionStart = connectionHost?.points[connection.segmentIndex];
  const connectionEnd = connectionHost?.points[connection.segmentIndex + 1];
  const connectionProjection = connectionStart && connectionEnd ? projectOnSegment(baselinePoint, connectionStart, connectionEnd) : null;
  const hostClosed = Boolean(connectionHost && connectionHost.points.length > 2 && samePoint(connectionHost.points[0], connectionHost.points.at(-1)!));
  const projectionIsInterior = Boolean(connectionProjection && connectionProjection.along > .001 && connectionProjection.along < .999);
  const hostPointIndex = connectionProjection
    ? connectionProjection.along <= .001 ? connection.segmentIndex : connection.segmentIndex + 1
    : null;
  const hostPointAttachment = hostPointIndex === null ? undefined : connectionHost?.attachments?.[hostPointIndex];
  // A previous drag may already have materialized this T junction on the host.
  // Such a hidden host vertex is still the movable branch junction; do not
  // mistake it for an immutable room corner on the next drag frame.
  const isMaterializedHostJunction = Boolean(hostClosed && !projectionIsInterior && hostPointAttachment?.hideCorner
    && hostPointAttachment.wallId === connectionHost?.id);
  const movableHostConnection = projectionIsInterior || isMaterializedHostJunction;
  if (draggedClosed && (!hostClosed || !movableHostConnection)) return candidateWalls;

  // When a closed outline corner is also an interior junction on another
  // closed room, the perpendicular branch at that corner is a wall in its own
  // right. Move that complete branch with the corner so dragging corner 5
  // translates wall 5-6 (both endpoints), instead of shortening it and
  // manufacturing a duplicate corner at the old junction.
  let draggedRunPointIndices: number[] = [];
  if (hostClosed && movableHostConnection && connectionStart && connectionEnd) {
    const hostLength = Math.hypot(connectionEnd.x - connectionStart.x, connectionEnd.y - connectionStart.y);
    if (hostLength > CONNECTION_TOLERANCE_MM) {
      const hostTangent = { x: (connectionEnd.x - connectionStart.x) / hostLength, y: (connectionEnd.y - connectionStart.y) / hostLength };
      const coreLength = draggedClosed ? baselineDragged.points.length - 1 : baselineDragged.points.length;
      const normalizedPointIndex = draggedPointIndex === coreLength ? 0 : draggedPointIndex;
      const adjacentSegments: number[] = [];
      if (draggedClosed || normalizedPointIndex > 0) adjacentSegments.push(normalizedPointIndex - 1);
      if (normalizedPointIndex < coreLength - 1) adjacentSegments.push(normalizedPointIndex);
      const perpendicularSegment = adjacentSegments.find((segmentIndex) => {
        const start = baselineDragged.points[segmentIndex];
        const end = baselineDragged.points[segmentIndex + 1] ?? (segmentIndex === coreLength - 1 ? baselineDragged.points[0] : undefined);
        if (!start || !end) return false;
        const length = Math.hypot(end.x - start.x, end.y - start.y);
        if (length <= CONNECTION_TOLERANCE_MM) return false;
        const dot = ((end.x - start.x) * hostTangent.x + (end.y - start.y) * hostTangent.y) / length;
        return Math.abs(dot) <= .01;
      });
      if (perpendicularSegment !== undefined) {
        const referenceStart = baselineDragged.points[perpendicularSegment];
        const referenceEnd = baselineDragged.points[perpendicularSegment + 1] ?? baselineDragged.points[0];
        if (referenceStart && referenceEnd) {
          const run = straightRunPointIndices(baselineDragged.points, perpendicularSegment, referenceStart, referenceEnd);
          // An open wall can be a longer polyline. Translating every point in
          // the straight branch would also move the preceding perpendicular
          // leg (7–8 in the 8–9 case), turning it diagonal or pulling an
          // unrelated wall along. A complete branch translation is safe for a
          // standalone two-point wall, or when every other run point is free
          // of a non-parallel leg. Closed outlines retain their established
          // full-run behaviour because their squared corner propagation keeps
          // both adjoining sides coherent.
          const hasExternalNonParallelLeg = (runPointIndex: number) => {
            const point = baselineDragged.points[runPointIndex];
            if (!point) return false;
            return baselineWalls.some((hostWall) => {
              if (hostWall.id === draggedWallId || hostWall.id.startsWith(AUTO_BRIDGE_PREFIX)) return false;
              return hostWall.points.slice(0, -1).some((hostStart, hostSegmentIndex) => {
                const hostEnd = hostWall.points[hostSegmentIndex + 1];
                return Boolean(hostEnd)
                  && projectOnSegment(point, hostStart, hostEnd).distance <= CONNECTION_TOLERANCE_MM
                  && !parallelSegments(hostStart, hostEnd, referenceStart, referenceEnd);
              });
            });
          };
          const openRunIsSafe = draggedClosed || run.every((runPointIndex) => runPointIndex === draggedPointIndex
            || (!hasNonParallelConnectedLeg(baselineDragged, runPointIndex, referenceStart, referenceEnd)
              && !hasExternalNonParallelLeg(runPointIndex)));
          if (openRunIsSafe) draggedRunPointIndices = run;
        }
      }
    }
  }

  return candidateWalls.map((wall) => {
    if (wall.id === draggedWallId) {
      const points = draggedRunPointIndices.length
        ? wall.points.map((point, index) => draggedRunPointIndices.includes(index)
          ? { x: baselineDragged.points[index].x + delta.x, y: baselineDragged.points[index].y + delta.y }
          : { ...point })
        : wall.points.map((point) => ({ ...point }));
      if (draggedClosed && samePoint(wall.points[0], wall.points.at(-1)!)) {
        if (draggedRunPointIndices.includes(0) && points.length > 1) points[points.length - 1] = { ...points[0] };
        else if (draggedRunPointIndices.includes(points.length - 1)) points[0] = { ...points[points.length - 1] };
      }
      return { ...wall, points, attachments: { ...wall.attachments, [draggedPointIndex]: { ...wall.attachments?.[draggedPointIndex], ...connection } } };
    }
    if (wall.id !== connection.wallId) return wall;
    const hostStart = wall.points[connection.segmentIndex];
    const hostEnd = wall.points[connection.segmentIndex + 1];
    if (!hostStart || !hostEnd) return wall;
    const projection = projectOnSegment(baselinePoint, hostStart, hostEnd);
    const hostPointIndex = projection.along <= .001 ? connection.segmentIndex : connection.segmentIndex + 1;
    const pointIndices = straightRunPointIndices(wall.points, projection.along > .001 && projection.along < .999 ? connection.segmentIndex : hostPointIndex, hostStart, hostEnd);
    const points = wall.points.map((point, index) => pointIndices.includes(index)
      ? { x: point.x + delta.x, y: point.y + delta.y }
      : { ...point });
    if (samePoint(wall.points[0], wall.points.at(-1)!)) {
      if (pointIndices.includes(0) && points.length > 1) points[points.length - 1] = { ...points[0] };
      else if (pointIndices.includes(points.length - 1)) points[0] = { ...points[points.length - 1] };
    }
    return { ...wall, points };
  });
}

/**
 * Keep every wall run incident to a dragged corner on the same moving
 * junction.  Pointer events can skip the intermediate frame in which the
 * endpoint attachment is inferred (especially during a fast drag), leaving
 * the selected point ahead of its host and causing the repair pass to insert
 * an unnecessary bridge/corner.  Recover the relationship directly from the
 * drag-start geometry so a corner can never move on its own.
 */
export function translateIncidentWallRunsForCorner(
  baselineWalls: WallDragWall[],
  candidateWalls: WallDragWall[],
  draggedWallId: string,
  draggedPointIndex: number,
): WallDragWall[] {
  const dragged = baselineWalls.find((wall) => wall.id === draggedWallId);
  const candidateDragged = candidateWalls.find((wall) => wall.id === draggedWallId);
  const baselinePoint = dragged?.points[draggedPointIndex];
  const candidatePoint = candidateDragged?.points[draggedPointIndex];
  if (!dragged || !candidateDragged || !baselinePoint || !candidatePoint) return candidateWalls;
  const delta = { x: candidatePoint.x - baselinePoint.x, y: candidatePoint.y - baselinePoint.y };
  if (Math.hypot(delta.x, delta.y) <= CONNECTION_TOLERANCE_MM) return candidateWalls;

  const translated = candidateWalls.map((wall) => ({ ...wall, points: wall.points.map((point) => ({ ...point })) }));
  baselineWalls.forEach((baselineWall) => {
    if (baselineWall.id === draggedWallId || baselineWall.id.startsWith(AUTO_BRIDGE_PREFIX)) return;
    const candidateWall = translated.find((wall) => wall.id === baselineWall.id);
    if (!candidateWall) return;
    const closed = baselineWall.points.length > 2 && samePoint(baselineWall.points[0], baselineWall.points.at(-1)!);
    const coreLength = closed ? baselineWall.points.length - 1 : baselineWall.points.length;
    baselineWall.points.slice(0, -1).forEach((start, segmentIndex) => {
      const end = baselineWall.points[segmentIndex + 1];
      if (!end) return;
      const projection = projectOnSegment(baselinePoint, start, end);
      if (projection.distance > CONNECTION_TOLERANCE_MM) return;
      const length = Math.hypot(end.x - start.x, end.y - start.y);
      if (length <= CONNECTION_TOLERANCE_MM) return;
      const tangent = { x: (end.x - start.x) / length, y: (end.y - start.y) / length };
      // A corner translated along a host is not a host-side drag. Restrict
      // this recovery to the normal component, while allowing pointer jitter
      // and fast diagonal samples around an otherwise perpendicular drag.
      const normalDistance = delta.x * -tangent.y + delta.y * tangent.x;
      if (Math.abs(normalDistance) <= CONNECTION_TOLERANCE_MM) return;

      const pointIndex = projection.along <= .001
        ? segmentIndex
        : projection.along >= .999 ? segmentIndex + 1 : segmentIndex;
      const run = straightRunPointIndices(baselineWall.points, pointIndex, start, end)
        .filter((index) => index >= 0 && index < coreLength);
      if (!run.length) return;

      // Do not pull a host which has a true room corner at this point. An
      // interior projection or a materialized, collinear host vertex is the
      // structural junction that should follow the dragged corner. For an
      // unmaterialized interior projection the complete segment run is safe.
      const interior = projection.along > .001 && projection.along < .999;
      const materialized = !interior && run.length >= 3;
      if (!interior && !materialized) return;

      const follows = run.every((index) => {
        const current = candidateWall.points[index];
        const original = baselineWall.points[index];
        return Boolean(current && original)
          && Math.hypot(current.x - original.x - delta.x, current.y - original.y - delta.y) <= CONNECTION_TOLERANCE_MM;
      });
      if (!follows) {
        run.forEach((index) => {
          const original = baselineWall.points[index];
          candidateWall.points[index] = { x: original.x + delta.x, y: original.y + delta.y };
        });
        if (closed && run.includes(0)) candidateWall.points[candidateWall.points.length - 1] = { ...candidateWall.points[0] };
        if (closed && run.includes(candidateWall.points.length - 1)) candidateWall.points[0] = { ...candidateWall.points[candidateWall.points.length - 1] };
      }
    });
  });
  return translated;
}

/**
 * Keep ordinary wall endpoints on their declared host segment after another
 * constraint has moved or clamped that host. This is deliberately separate
 * from auto-bridge reanchoring: user-created wall runs carry the attachment
 * that defines the intended junction and must not become a detached corner
 * merely because a fast pointer drag overshoots the host's clearance limit.
 */
export function reanchorAttachedWallEndpoints(walls: WallDragWall[]): WallDragWall[] {
  return walls.map((wall) => {
    const isClosed = wall.points.length > 2 && samePoint(wall.points[0], wall.points.at(-1)!);
    if (wall.id.startsWith(AUTO_BRIDGE_PREFIX) || isClosed || !wall.attachments) return wall;
    let changed = false;
    const points = wall.points.map((point) => ({ ...point }));
    Object.entries(wall.attachments).forEach(([rawIndex, attachment]) => {
      const pointIndex = Number(rawIndex);
      const point = points[pointIndex];
      // A materialized room vertex can carry the reciprocal attachment to the
      // branch that terminates on it. Reanchoring that vertex to the branch
      // would reverse the intended host relationship and split the junction.
      // Only an endpoint of an open wall is allowed to follow its host.
      if (pointIndex !== 0 && pointIndex !== points.length - 1) return;
      const host = walls.find((candidate) => candidate.id === attachment.wallId);
      const start = host?.points[attachment.segmentIndex];
      const end = host?.points[attachment.segmentIndex + 1];
      if (!point || !host || !start || !end || host.id === wall.id) return;
      const anchored = attachment.along <= .001 ? { ...start }
        : attachment.along >= .999 ? { ...end }
          : projectOnSegment(point, start, end).point;
      if (!samePoint(point, anchored, .001)) {
        points[pointIndex] = anchored;
        changed = true;
      }
    });
    return changed ? { ...wall, points } : wall;
  });
}

/**
 * Materialize every visible endpoint which lands in the middle of another
 * wall.  Wall drags can move an attached run without giving the host a point
 * at the new T-junction; leaving that point implicit makes the drawing look
 * connected while the editable wall graph still contains a crossing.  Keep
 * the source endpoint visible and add a hidden duplicate to the host so the
 * two runs share one physical corner without rendering two labels.
 */
export function materializeWallIntersections(walls: WallDragWall[]): WallDragWall[] {
  let nextWalls: WallDragWall[] = walls.map((wall) => ({
    ...wall,
    points: wall.points.map((point) => ({ ...point })),
    attachments: wall.attachments ? Object.fromEntries(Object.entries(wall.attachments).map(([index, attachment]) => [index, { ...attachment }])) : undefined,
    thicknessOverridesMm: wall.thicknessOverridesMm ? { ...wall.thicknessOverridesMm } : undefined,
    lengthOverridesMm: wall.lengthOverridesMm ? { ...wall.lengthOverridesMm } : undefined,
    cornerNumbers: wall.cornerNumbers ? { ...wall.cornerNumbers } : undefined,
  }));
  let nextCornerNumber = Math.max(0, ...nextWalls.flatMap((wall) => Object.values(wall.cornerNumbers ?? {}))) + 1;
  const maximumPasses = Math.max(1, nextWalls.reduce((total, wall) => total + wall.points.length, 0) * 2);

  for (let pass = 0; pass < maximumPasses; pass += 1) {
    let inserted = false;
    for (const sourceWall of nextWalls) {
      const sourceClosed = sourceWall.points.length > 2 && samePoint(sourceWall.points[0], sourceWall.points.at(-1)!);
      const sourceLimit = sourceWall.points.length - (sourceClosed ? 1 : 0);
      for (let sourcePointIndex = 0; sourcePointIndex < sourceLimit; sourcePointIndex += 1) {
        const sourceAttachment = sourceWall.attachments?.[sourcePointIndex];
        if (sourceAttachment?.hideCorner) {
          // A connected endpoint is hidden while it coincides with the host's
          // endpoint.  Once that host endpoint has moved into the interior of
          // the host segment, keep the endpoint visible and materialize the
          // new T-junction instead of leaving an uneditable crossing.
          const sourcePoint = sourceWall.points[sourcePointIndex];
          const movedIntoHost = sourcePoint && nextWalls.some((candidateWall) => {
            if (candidateWall.id === sourceWall.id || candidateWall.id.startsWith(AUTO_BRIDGE_PREFIX)) return false;
            return candidateWall.points.slice(0, -1).some((hostStart, hostSegmentIndex) => {
              const hostEnd = candidateWall.points[hostSegmentIndex + 1];
              if (!hostEnd) return false;
              const projection = projectOnSegment(sourcePoint, hostStart, hostEnd);
              return projection.distance <= CONNECTION_TOLERANCE_MM
                && projection.along > 1e-6
                && projection.along < 1 - 1e-6;
            });
          });
          if (!movedIntoHost) continue;
          sourceWall.attachments = { ...sourceWall.attachments, [sourcePointIndex]: { ...sourceAttachment, hideCorner: false } };
        }
        const sourcePoint = sourceWall.points[sourcePointIndex];
        if (!sourcePoint) continue;

        for (const hostWall of nextWalls) {
          if (hostWall.id === sourceWall.id || hostWall.id.startsWith(AUTO_BRIDGE_PREFIX)) continue;
          const hostClosed = hostWall.points.length > 2 && samePoint(hostWall.points[0], hostWall.points.at(-1)!);
          for (let hostSegmentIndex = 0; hostSegmentIndex < hostWall.points.length - 1; hostSegmentIndex += 1) {
            const hostStart = hostWall.points[hostSegmentIndex];
            const hostEnd = hostWall.points[hostSegmentIndex + 1];
            if (!hostStart || !hostEnd) continue;
            const projection = projectOnSegment(sourcePoint, hostStart, hostEnd);
            if (projection.distance > CONNECTION_TOLERANCE_MM || projection.along <= 1e-6 || projection.along >= 1 - 1e-6) continue;
            if (hostWall.points.some((point) => samePoint(point, projection.point))) continue;

            const insertionIndex = hostSegmentIndex + 1;
            const core = hostClosed ? hostWall.points.slice(0, -1) : hostWall.points;
            const points = [...core.slice(0, insertionIndex), { ...projection.point }, ...core.slice(insertionIndex)];
            if (hostClosed) points.push({ ...points[0] });

            const attachments: Record<number, WallDragAttachment> = {};
            Object.entries(hostWall.attachments ?? {}).forEach(([rawIndex, attachment]) => {
              const index = Number(rawIndex);
              attachments[index >= insertionIndex ? index + 1 : index] = { ...attachment };
            });
            attachments[insertionIndex] = { wallId: hostWall.id, segmentIndex: hostSegmentIndex, along: 1, hideCorner: true };

            const thicknessOverridesMm: Record<number, number> = {};
            Object.entries(hostWall.thicknessOverridesMm ?? {}).forEach(([rawIndex, thickness]) => {
              const index = Number(rawIndex);
              if (index < hostSegmentIndex) thicknessOverridesMm[index] = thickness;
              else if (index === hostSegmentIndex) { thicknessOverridesMm[index] = thickness; thicknessOverridesMm[index + 1] = thickness; }
              else thicknessOverridesMm[index + 1] = thickness;
            });
            const lengthOverridesMm: Record<number, number> = {};
            Object.entries(hostWall.lengthOverridesMm ?? {}).forEach(([rawIndex, length]) => {
              const index = Number(rawIndex);
              if (index < hostSegmentIndex) lengthOverridesMm[index] = length;
              else if (index === hostSegmentIndex) { lengthOverridesMm[index] = length * projection.along; lengthOverridesMm[index + 1] = length * (1 - projection.along); }
              else lengthOverridesMm[index + 1] = length;
            });
            const cornerNumbers = hostWall.cornerNumbers
              ? Object.fromEntries(Object.entries(hostWall.cornerNumbers).map(([rawIndex, number]) => {
                const index = Number(rawIndex);
                return [index >= insertionIndex ? index + 1 : index, number];
              }))
              : {};
            cornerNumbers[insertionIndex] = sourceWall.cornerNumbers?.[sourcePointIndex] ?? nextCornerNumber++;

            // The host may already carry attachments to this segment. Split
            // those ratios before replacing the host wall so open branches do
            // not drift when the new corner is inserted.
            nextWalls = remapAttachmentsToSplitHost(nextWalls, hostWall.id, hostSegmentIndex, projection.along);
            const hostIndex = nextWalls.findIndex((wall) => wall.id === hostWall.id);
            if (hostIndex >= 0) {
              nextWalls[hostIndex] = {
                ...nextWalls[hostIndex],
                points,
                attachments: Object.keys(attachments).length ? attachments : undefined,
                thicknessOverridesMm: Object.keys(thicknessOverridesMm).length ? thicknessOverridesMm : undefined,
                lengthOverridesMm: Object.keys(lengthOverridesMm).length ? lengthOverridesMm : undefined,
                cornerNumbers: Object.keys(cornerNumbers).length ? cornerNumbers : undefined,
              };
            }
            inserted = true;
            break;
          }
          if (inserted) break;
        }
        if (inserted) break;
      }
      if (inserted) break;
    }
    if (!inserted) break;
  }
  return nextWalls;
}

/**
 * Add a newly drawn wall run without losing the span of any existing run.
 *
 * Connected drafts are allowed to terminate on the middle of another wall.
 * Normalising the complete set after the append records that junction on the
 * host wall while cloning every original endpoint, so an adjoining room can
 * never make a previously continuous wall appear truncated.
 */
export function appendWallRunPreservingExistingWalls(walls: WallDragWall[], wall: WallDragWall): WallDragWall[] {
  return materializeWallIntersections([...walls, wall]);
}

/**
 * Bridge points are projections onto their two host segments. They must be
 * recalculated from the current hosts after any later drag; moving only their
 * original coordinates leaves an apparently detached corner at a T junction.
 */
export function reanchorAutoWallBridges(walls: WallDragWall[], activelyDraggedWallId?: string, propagateHostEndpoints = true): WallDragWall[] {
  let anchored = walls;
  for (let pass = 0; pass <= walls.length; pass += 1) {
    let propagationChanged = false;
    const propagated = anchored.slice();

    // If a host moves perpendicular to a straight connector, carry that
    // translation through to an open host endpoint on the other side. This
    // keeps previously materialized connector walls at the same physical
    // junction while the host is resized or translated.
    if (propagateHostEndpoints) anchored.forEach((bridge) => {
      if (!bridge.id.startsWith(AUTO_BRIDGE_PREFIX) || bridge.id === activelyDraggedWallId || !bridge.attachments) return;
      const entries = Object.entries(bridge.attachments).sort(([first], [second]) => Number(first) - Number(second));
      if (entries.length !== 2) return;
      const straightConnector = bridge.points.every((point) => Math.abs(point.x - bridge.points[0].x) <= .001)
        || bridge.points.every((point) => Math.abs(point.y - bridge.points[0].y) <= .001);
      if (!straightConnector) return;
      const resolved = entries.map(([rawIndex, attachment]) => {
        const pointIndex = Number(rawIndex);
        const point = bridge.points[pointIndex];
        const host = anchored.find((candidate) => candidate.id === attachment.wallId);
        const start = host?.points[attachment.segmentIndex];
        const end = host?.points[attachment.segmentIndex + 1];
        if (!point || !host || !start || !end) return null;
        const target = attachment.along <= .001 ? start : attachment.along >= .999 ? end : projectOnSegment(point, start, end).point;
        return { pointIndex, point, target, attachment, host };
      });
      const firstResolved = resolved[0];
      const secondResolved = resolved[1];
      if (!firstResolved || !secondResolved) return;
      const endpoints = [firstResolved, secondResolved];
      const movements = endpoints.map((item) => ({ x: item.target.x - item.point.x, y: item.target.y - item.point.y }));
      const moved = movements.map((delta) => Math.hypot(delta.x, delta.y) > CONNECTION_TOLERANCE_MM);
      if (moved[0] === moved[1]) return;
      const movingIndex = moved[0] ? 0 : 1;
      const stationaryIndex = movingIndex === 0 ? 1 : 0;
      const delta = movements[movingIndex];
      const bridgeStart = bridge.points[endpoints[0].pointIndex];
      const bridgeEnd = bridge.points[endpoints[1].pointIndex];
      const bridgeLength = Math.hypot(bridgeEnd.x - bridgeStart.x, bridgeEnd.y - bridgeStart.y);
      const deltaLength = Math.hypot(delta.x, delta.y);
      if (!bridgeLength || !deltaLength || Math.abs(delta.x * (bridgeEnd.x - bridgeStart.x) + delta.y * (bridgeEnd.y - bridgeStart.y)) > bridgeLength * deltaLength * .01) return;
      const stationary = stationaryIndex === 0 ? firstResolved : secondResolved;
      if (samePoint(stationary.host.points[0], stationary.host.points.at(-1)!)) return;
      const hostEndpointIndex = stationary.attachment.along <= .001 ? stationary.attachment.segmentIndex
        : stationary.attachment.along >= .999 ? stationary.attachment.segmentIndex + 1
          : null;
      if (hostEndpointIndex === null || (hostEndpointIndex !== 0 && hostEndpointIndex !== stationary.host.points.length - 1)) return;
      const hostIndex = propagated.findIndex((wall) => wall.id === stationary.host.id);
      if (hostIndex < 0) return;
      const points = propagated[hostIndex].points.map((point) => ({ ...point }));
      points[hostEndpointIndex] = { x: points[hostEndpointIndex].x + delta.x, y: points[hostEndpointIndex].y + delta.y };
      propagated[hostIndex] = { ...propagated[hostIndex], points };
      propagationChanged = true;
    });

    let passChanged = propagationChanged;
    const nextWalls = propagated.map((wall) => {
      if (!wall.id.startsWith(AUTO_BRIDGE_PREFIX) || wall.id === activelyDraggedWallId || !wall.attachments) return wall;
      let points = wall.points.map((point) => ({ ...point }));
      let attachments = { ...wall.attachments };
      let changed = false;
      const attachedEndpoints = Object.entries(wall.attachments).sort(([first], [second]) => Number(first) - Number(second));
      attachedEndpoints.forEach(([rawIndex, attachment]) => {
        const pointIndex = Number(rawIndex);
        const host = propagated.find((candidate) => candidate.id === attachment.wallId);
        const start = host?.points[attachment.segmentIndex];
        const end = host?.points[attachment.segmentIndex + 1];
        if (!start || !end || !points[pointIndex]) return;
        // Preserve the junction's physical position along a resized host. A stored
        // ratio is only valid while the host length is unchanged; applying it after
        // a resize makes side walls slide vertically for no geometric reason.
        const projection = attachment.along <= .001
          ? { point: { ...start }, along: 0, distance: Math.hypot(points[pointIndex].x - start.x, points[pointIndex].y - start.y) }
          : attachment.along >= .999
            ? { point: { ...end }, along: 1, distance: Math.hypot(points[pointIndex].x - end.x, points[pointIndex].y - end.y) }
            : projectOnSegment(points[pointIndex], start, end);
        const next = projection.point;
        if (!samePoint(points[pointIndex], next, .001)) {
          points[pointIndex] = next;
          changed = true;
        }
        if (Math.abs(attachment.along - projection.along) > 1e-9) {
          attachments[pointIndex] = { ...attachment, along: projection.along };
          changed = true;
        }
      });

      // A connector whose hosts no longer line up must remain orthogonal. Turn
      // it into an L and leave the elbow unattached so it becomes a real,
      // numbered corner instead of an invisible bend or a diagonal wall.
      if (attachedEndpoints.length === 2) {
        const [firstEntry, lastEntry] = attachedEndpoints;
        const firstIndex = Number(firstEntry[0]);
        const lastIndex = Number(lastEntry[0]);
        const first = points[firstIndex];
        const last = points[lastIndex];
        if (first && last) {
          const oldFirst = wall.points[firstIndex];
          const oldLast = wall.points[lastIndex];
          const aligned = Math.abs(first.x - last.x) <= .001 || Math.abs(first.y - last.y) <= .001;
          if (aligned) {
            const straightPoints = [{ ...first }, { ...last }];
            if (points.length !== 2 || !samePoint(points[0], straightPoints[0], .001) || !samePoint(points[1], straightPoints[1], .001)) changed = true;
            points = straightPoints;
            attachments = { 0: firstEntry[1], 1: lastEntry[1] };
          } else {
            const oldNext = wall.points[firstIndex + 1];
            const hadElbow = wall.points.length > 2 && oldNext;
            const oldHorizontal = hadElbow
              ? Math.abs(oldNext.x - oldFirst.x) >= Math.abs(oldNext.y - oldFirst.y)
              : Math.abs(oldLast.x - oldFirst.x) >= Math.abs(oldLast.y - oldFirst.y);
            const startMovement = Math.hypot(first.x - oldFirst.x, first.y - oldFirst.y);
            const endMovement = Math.hypot(last.x - oldLast.x, last.y - oldLast.y);
            const firstLegHorizontal = hadElbow ? oldHorizontal : startMovement > endMovement ? !oldHorizontal : oldHorizontal;
            const elbow = firstLegHorizontal ? { x: last.x, y: first.y } : { x: first.x, y: last.y };
            const elbowPoints = [{ ...first }, elbow, { ...last }];
            if (points.length !== 3 || elbowPoints.some((point, index) => !samePoint(point, points[index], .001))) changed = true;
            points = elbowPoints;
            attachments = { 0: firstEntry[1], 2: lastEntry[1] };
          }
        }
      }
      if (changed) passChanged = true;
      return changed ? { ...wall, points, attachments } : wall;
    });
    anchored = nextWalls;
    if (!passChanged) break;
  }
  return anchored;
}

function segmentExists(walls: WallDragWall[], start: WallDragPoint, end: WallDragPoint, excludedWallId?: string): boolean {
  return walls.some((wall) => wall.points.slice(0, -1).some((point, segmentIndex) => {
    if (wall.id === excludedWallId) return false;
    const next = wall.points[segmentIndex + 1];
    return (samePoint(point, start) && samePoint(next, end)) || (samePoint(point, end) && samePoint(next, start));
  }));
}

/**
 * Return true when an existing wall path already covers the whole proposed
 * connector. Exact endpoint equality is not enough here: a host wall may have
 * been split at a newly materialized junction, leaving several collinear
 * subsegments which together cover the connector. Adding another wall in that
 * case creates an overlapping phantom segment and can confuse room detection.
 */
function segmentCoveredByExistingWall(walls: WallDragWall[], start: WallDragPoint, end: WallDragPoint, excludedWallId?: string): boolean {
  if (segmentExists(walls, start, end, excludedWallId)) return true;
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const length = Math.hypot(dx, dy);
  if (length <= CONNECTION_TOLERANCE_MM) return true;
  const direction = { x: dx / length, y: dy / length };
  const normalizedTolerance = CONNECTION_TOLERANCE_MM / length;
  const intervals: Array<[number, number]> = [];

  walls.forEach((wall) => {
    if (wall.id === excludedWallId) return;
    wall.points.slice(0, -1).forEach((segmentStart, segmentIndex) => {
      const segmentEnd = wall.points[segmentIndex + 1];
      if (!segmentEnd) return;
      const segmentDx = segmentEnd.x - segmentStart.x;
      const segmentDy = segmentEnd.y - segmentStart.y;
      if (Math.hypot(segmentDx, segmentDy) <= CONNECTION_TOLERANCE_MM) return;
      const startCross = Math.abs((segmentStart.x - start.x) * direction.y - (segmentStart.y - start.y) * direction.x);
      const endCross = Math.abs((segmentEnd.x - start.x) * direction.y - (segmentEnd.y - start.y) * direction.x);
      if (startCross > CONNECTION_TOLERANCE_MM || endCross > CONNECTION_TOLERANCE_MM) return;
      const first = (segmentStart.x - start.x) * direction.x + (segmentStart.y - start.y) * direction.y;
      const second = (segmentEnd.x - start.x) * direction.x + (segmentEnd.y - start.y) * direction.y;
      const lower = Math.max(0, Math.min(first, second) / length);
      const upper = Math.min(1, Math.max(first, second) / length);
      if (upper >= lower - normalizedTolerance) intervals.push([lower, upper]);
    });
  });

  intervals.sort((first, second) => first[0] - second[0]);
  let coveredUntil = 0;
  for (const [lower, upper] of intervals) {
    if (lower > coveredUntil + normalizedTolerance) return false;
    coveredUntil = Math.max(coveredUntil, upper);
    if (coveredUntil >= 1 - normalizedTolerance) return true;
  }
  return coveredUntil >= 1 - normalizedTolerance;
}

function connectionSegmentIndex(wall: WallDragWall, pointIndex: number): number {
  const lastSegmentIndex = wall.points.length - 2;
  return Math.max(0, Math.min(lastSegmentIndex, pointIndex >= wall.points.length - 1 ? pointIndex - 1 : pointIndex));
}

/**
 * A dragged endpoint that lands inside its host segment is a real T-junction.
 * Materialize that junction on the host so later drags keep a numbered corner
 * and never leave a wall crossing a segment without a vertex.
 */
function materializeJunctionCorner(
  baselineHost: WallDragWall,
  candidateHost: WallDragWall,
  segmentIndex: number,
  point: WallDragPoint,
  along: number,
  walls: WallDragWall[],
): { wall: WallDragWall; inserted: boolean } {
  const baselineStart = baselineHost.points[segmentIndex];
  const baselineEnd = baselineHost.points[segmentIndex + 1];
  const length = baselineStart && baselineEnd ? Math.hypot(baselineEnd.x - baselineStart.x, baselineEnd.y - baselineStart.y) : 0;
  const endpointTolerance = CONNECTION_TOLERANCE_MM / Math.max(1, length);
  if (!baselineStart || !baselineEnd || along <= endpointTolerance || along >= 1 - endpointTolerance) return { wall: candidateHost, inserted: false };

  // A drag is evaluated frame by frame. Reuse the extra host point created on
  // the previous frame instead of appending another point on every frame.
  const existingIndex = candidateHost.points.length > baselineHost.points.length
    ? candidateHost.points.findIndex((candidate, index) => {
      if (index === 0 || index === candidateHost.points.length - 1) return false;
      if (baselineHost.points.some((original) => samePoint(original, candidate))) return false;
      return projectOnSegment(candidate, baselineStart, baselineEnd).distance <= CONNECTION_TOLERANCE_MM;
    })
    : -1;
  if (existingIndex >= 0) {
    const points = candidateHost.points.map((candidate, index) => index === existingIndex ? { ...point } : { ...candidate });
    return { wall: { ...candidateHost, points }, inserted: false };
  }

  const closed = candidateHost.points.length > 2 && samePoint(candidateHost.points[0], candidateHost.points.at(-1)!);
  const core = closed ? candidateHost.points.slice(0, -1) : candidateHost.points;
  const insertionIndex = Math.max(0, Math.min(core.length, segmentIndex + 1));
  const points = [...core.slice(0, insertionIndex), { ...point }, ...core.slice(insertionIndex)];
  if (closed) points.push({ ...points[0] });

  const attachments: Record<number, WallDragAttachment> = {};
  Object.entries(candidateHost.attachments ?? {}).forEach(([key, attachment]) => {
    const index = Number(key);
    attachments[index >= insertionIndex ? index + 1 : index] = { ...attachment };
  });

  const thicknessOverridesMm: Record<number, number> = {};
  Object.entries(candidateHost.thicknessOverridesMm ?? {}).forEach(([key, thickness]) => {
    const index = Number(key);
    if (index < segmentIndex) thicknessOverridesMm[index] = thickness;
    else if (index === segmentIndex) {
      thicknessOverridesMm[index] = thickness;
      thicknessOverridesMm[index + 1] = thickness;
    } else thicknessOverridesMm[index + 1] = thickness;
  });

  const lengthOverridesMm: Record<number, number> = {};
  Object.entries(candidateHost.lengthOverridesMm ?? {}).forEach(([key, targetLength]) => {
    const index = Number(key);
    if (index < segmentIndex) lengthOverridesMm[index] = targetLength;
    else if (index === segmentIndex) {
      lengthOverridesMm[index] = targetLength * along;
      lengthOverridesMm[index + 1] = targetLength * (1 - along);
    } else lengthOverridesMm[index + 1] = targetLength;
  });

  const cornerNumbers = candidateHost.cornerNumbers
    ? Object.fromEntries(Object.entries(candidateHost.cornerNumbers).map(([key, number]) => {
      const index = Number(key);
      return [index >= insertionIndex ? index + 1 : index, number];
    }))
    : undefined;
  const connected = walls
    .filter((wall) => wall.id !== candidateHost.id && !wall.id.startsWith(AUTO_BRIDGE_PREFIX))
    .flatMap((wall) => wall.points.map((candidate, pointIndex) => ({ wall, candidate, pointIndex })))
    .find(({ wall, candidate, pointIndex }) => samePoint(candidate, point) && !wall.attachments?.[pointIndex]?.hideCorner);
  if (connected) {
    attachments[insertionIndex] = { wallId: candidateHost.id, segmentIndex, along: 1, hideCorner: true };
    if (cornerNumbers && connected.wall.cornerNumbers?.[connected.pointIndex] !== undefined) cornerNumbers[insertionIndex] = connected.wall.cornerNumbers[connected.pointIndex];
  }

  return {
    wall: {
      ...candidateHost,
      points,
      attachments: Object.keys(attachments).length ? attachments : undefined,
      thicknessOverridesMm: Object.keys(thicknessOverridesMm).length ? thicknessOverridesMm : undefined,
      lengthOverridesMm: Object.keys(lengthOverridesMm).length ? lengthOverridesMm : undefined,
      cornerNumbers,
    },
    inserted: true,
  };
}

function remapAttachmentsToSplitHost(
  walls: WallDragWall[],
  hostId: string,
  segmentIndex: number,
  along: number,
): WallDragWall[] {
  return walls.map((wall) => {
    if (!wall.attachments) return wall;
    const attachments = Object.fromEntries(Object.entries(wall.attachments).map(([key, attachment]) => {
      if (attachment.wallId !== hostId) return [key, { ...attachment }];
      if (attachment.segmentIndex < segmentIndex) return [key, { ...attachment }];
      if (attachment.segmentIndex > segmentIndex) return [key, { ...attachment, segmentIndex: attachment.segmentIndex + 1 }];
      if (attachment.along <= along) return [key, { ...attachment, along: along ? attachment.along / along : 0 }];
      return [key, { ...attachment, segmentIndex: segmentIndex + 1, along: along < 1 ? (attachment.along - along) / (1 - along) : 1 }];
    }));
    return { ...wall, attachments };
  });
}

function hasVisibleCornerAt(walls: WallDragWall[], point: WallDragPoint): boolean {
  return walls.some((wall) => !wall.id.startsWith(AUTO_BRIDGE_PREFIX) && wall.points.some((candidate, pointIndex) => {
    if (!samePoint(candidate, point)) return false;
    return !wall.attachments?.[pointIndex]?.hideCorner;
  }));
}

function hasNonParallelConnectedLeg(wall: WallDragWall, pointIndex: number, hostStart: WallDragPoint, hostEnd: WallDragPoint): boolean {
  const closed = wall.points.length > 2 && samePoint(wall.points[0], wall.points.at(-1)!);
  const core = closed ? wall.points.slice(0, -1) : wall.points;
  const point = core[pointIndex];
  if (!point) return false;
  const neighbours = [
    ...(pointIndex > 0 || closed ? [core[(pointIndex - 1 + core.length) % core.length]] : []),
    ...(pointIndex < core.length - 1 || closed ? [core[(pointIndex + 1) % core.length]] : []),
  ];
  return neighbours.some((neighbour) => {
    if (!neighbour) return false;
    const length = Math.hypot(neighbour.x - point.x, neighbour.y - point.y);
    return length > CONNECTION_TOLERANCE_MM && !parallelSegments(point, neighbour, hostStart, hostEnd);
  });
}

/**
 * A two-wall L junction is a continuous corner, not a detachable branch.
 * When the endpoint of the dragged wall moves, resize the other open wall so
 * it continues to end at that endpoint. A closed outline, an interior point,
 * or a junction with three or more incident segments is deliberately not
 * followed: those need a bridge to preserve every existing wall run.
 */
function unbranchedHostEndpointIndex(
  baselineWalls: WallDragWall[],
  draggedWallId: string,
  draggedPointIndex: number,
  connection: WallDragAttachment,
  originalPoint: WallDragPoint,
): number | null {
  const draggedWall = baselineWalls.find((wall) => wall.id === draggedWallId);
  const hostWall = baselineWalls.find((wall) => wall.id === connection.wallId);
  if (!draggedWall || !hostWall || samePoint(hostWall.points[0], hostWall.points.at(-1)!)) return null;
  if (draggedPointIndex !== 0 && draggedPointIndex !== draggedWall.points.length - 1) return null;

  const endpointIndex = samePoint(hostWall.points[0], originalPoint)
    ? 0
    : samePoint(hostWall.points.at(-1)!, originalPoint)
      ? hostWall.points.length - 1
      : null;
  if (endpointIndex === null) return null;

  let incidentSegments = 0;
  baselineWalls.forEach((wall) => {
    // The selected bridge is a real incident segment for this calculation.
    // Other derived bridges are ignored so they cannot make an ordinary
    // two-wall corner appear artificially branched.
    if (wall.id.startsWith(AUTO_BRIDGE_PREFIX) && wall.id !== draggedWallId) return;
    wall.points.slice(0, -1).forEach((start, segmentIndex) => {
      const end = wall.points[segmentIndex + 1];
      if (end && (samePoint(start, originalPoint) || samePoint(end, originalPoint))) incidentSegments += 1;
    });
  });
  return incidentSegments === 2 ? endpointIndex : null;
}

/**
 * When reshaping a squared room from a corner, one of its sides can translate
 * without changing length. Open walls that terminate part-way along that side
 * are part of the same junction and must follow it, rather than becoming a
 * separate bridging wall and an extra corner.
 */
export function followTerminatingEndpointsOnTranslatedSegments(
  baselineWalls: WallDragWall[],
  candidateWalls: WallDragWall[],
  movedWallId: string,
): WallDragWall[] {
  const baselineHost = baselineWalls.find((wall) => wall.id === movedWallId);
  const candidateHost = candidateWalls.find((wall) => wall.id === movedWallId);
  if (!baselineHost || !candidateHost) return candidateWalls;

  const translatedSegments = baselineHost.points.slice(0, -1).flatMap((baselineStart, segmentIndex) => {
    const baselineEnd = baselineHost.points[segmentIndex + 1];
    const candidateStart = candidateHost.points[segmentIndex];
    const candidateEnd = candidateHost.points[segmentIndex + 1];
    if (!baselineEnd || !candidateStart || !candidateEnd) return [];
    const length = Math.hypot(baselineEnd.x - baselineStart.x, baselineEnd.y - baselineStart.y);
    if (!length) return [];
    const normal = { x: -(baselineEnd.y - baselineStart.y) / length, y: (baselineEnd.x - baselineStart.x) / length };
    const startDelta = { x: candidateStart.x - baselineStart.x, y: candidateStart.y - baselineStart.y };
    const endDelta = { x: candidateEnd.x - baselineEnd.x, y: candidateEnd.y - baselineEnd.y };
    const startNormalDistance = startDelta.x * normal.x + startDelta.y * normal.y;
    const endNormalDistance = endDelta.x * normal.x + endDelta.y * normal.y;
    const movedNormally = Math.abs(startNormalDistance) > CONNECTION_TOLERANCE_MM;
    const sameNormalTranslation = Math.abs(startNormalDistance - endNormalDistance) <= CONNECTION_TOLERANCE_MM;
    return movedNormally && sameNormalTranslation ? [{ segmentIndex, baselineStart, baselineEnd, candidateStart, candidateEnd }] : [];
  });
  if (!translatedSegments.length) return candidateWalls;

  return candidateWalls.map((candidateWall) => {
    if (candidateWall.id === movedWallId || candidateWall.id.startsWith(AUTO_BRIDGE_PREFIX)) return candidateWall;
    const baselineWall = baselineWalls.find((wall) => wall.id === candidateWall.id);
    const closed = baselineWall && samePoint(baselineWall.points[0], baselineWall.points.at(-1)!);
    if (!baselineWall || closed) return candidateWall;

    let changed = false;
    const points = candidateWall.points.map((point) => ({ ...point }));
    const attachments = { ...candidateWall.attachments };
    for (const pointIndex of [...new Set([0, baselineWall.points.length - 1])]) {
      const baselinePoint = baselineWall.points[pointIndex];
      if (!baselinePoint) continue;
      const segment = translatedSegments.find((item) => projectOnSegment(baselinePoint, item.baselineStart, item.baselineEnd).distance <= CONNECTION_TOLERANCE_MM);
      if (!segment) continue;
      const baselineProjection = projectOnSegment(baselinePoint, segment.baselineStart, segment.baselineEnd);
      const candidateProjection = projectOnSegment(baselinePoint, segment.candidateStart, segment.candidateEnd);
      if (samePoint(points[pointIndex], candidateProjection.point, .001)) continue;
      points[pointIndex] = candidateProjection.point;
      attachments[pointIndex] = { ...attachments[pointIndex], wallId: movedWallId, segmentIndex: segment.segmentIndex, along: baselineProjection.along };
      changed = true;
    }
    return changed ? { ...candidateWall, points, attachments } : candidateWall;
  });
}

export function retainDraggedWallConnections(
  baselineWalls: WallDragWall[],
  candidateWalls: WallDragWall[],
  draggedWallId: string,
  draggedSegmentIndex: number,
): WallDragWall[] {
  const baselineDraggedWall = baselineWalls.find((wall) => wall.id === draggedWallId);
  if (!baselineDraggedWall) return candidateWalls;

  const bridgeFamily = `${AUTO_BRIDGE_PREFIX}:${draggedWallId}:${draggedSegmentIndex}:`;
  // Existing bridges are persistent topology. Removing the bridge family here
  // makes the connector disappear on the next drag because the original walls
  // no longer meet directly and therefore cannot infer the old junction again.
  const repaired = candidateWalls.map((wall) => ({ ...wall, points: wall.points.map((point) => ({ ...point })) }));

  // A drag may materialize a room-side junction, remap its indexes, and then
  // hit a clearance limit in the same pointer update. Do not rely on the
  // transient candidate attachment surviving all of those transformations.
  // Re-establish every open endpoint's original connection to a closed room
  // before checking for bridges. The connection is inferred from the baseline
  // geometry when metadata has been dropped by an in-flight wall split;
  // otherwise an overshot endpoint is mistaken for an interior crossing and
  // this function creates a phantom corner.
  baselineWalls.forEach((baselineWall) => {
    const baselineClosed = baselineWall.points.length > 2 && samePoint(baselineWall.points[0], baselineWall.points.at(-1)!);
    // Short two-point walls are independent return walls. Moving a room side
    // past one must create a bridge, not drag that separate wall with it.
    // The attached outside outline in this interaction is a multi-segment run.
    if (baselineClosed || baselineWall.points.length < 3 || baselineWall.id.startsWith(AUTO_BRIDGE_PREFIX)) return;
    const candidateWall = repaired.find((wall) => wall.id === baselineWall.id);
    if (!candidateWall) return;
    [0, baselineWall.points.length - 1].forEach((pointIndex) => {
      const originalPoint = baselineWall.points[pointIndex];
      if (!originalPoint) return;
      const connection = closedRoomSideConnectionAtPoint(baselineWalls, baselineWall.id, originalPoint, baselineWall.attachments?.[pointIndex]);
      if (!connection) return;
      const candidateHost = repaired.find((wall) => wall.id === connection.wallId);
      const candidateStart = candidateHost?.points[connection.segmentIndex];
      const candidateEnd = candidateHost?.points[connection.segmentIndex + 1];
      if (!candidateStart || !candidateEnd) return;
      const point = candidateWall.points[pointIndex];
      if (!point) return;
      candidateWall.points[pointIndex] = projectOnSegment(point, candidateStart, candidateEnd).point;
    });
  });

  const candidateDraggedWall = repaired.find((wall) => wall.id === draggedWallId);
  if (!candidateDraggedWall) return candidateWalls;
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
    const explicitHost = explicitAttachment && explicitAttachment.wallId !== draggedWallId
      ? baselineWalls.find((wall) => wall.id === explicitAttachment.wallId)
      : undefined;
    const explicitStart = explicitHost?.points[explicitAttachment?.segmentIndex ?? -1];
    const explicitEnd = explicitHost?.points[(explicitAttachment?.segmentIndex ?? -1) + 1];
    const explicitIsValid = Boolean(explicitAttachment && explicitStart && explicitEnd
      && projectOnSegment(originalPoint, explicitStart, explicitEnd).distance <= CONNECTION_TOLERANCE_MM);
    const connection = explicitIsValid ? explicitAttachment : inferredHost;
    if (!connection) return;

    const hostWall = repaired.find((wall) => wall.id === connection.wallId);
    const hostStart = hostWall?.points[connection.segmentIndex];
    const hostEnd = hostWall?.points[connection.segmentIndex + 1];
    if (!hostWall || !hostStart || !hostEnd) return;

    const hostEndpointIndex = unbranchedHostEndpointIndex(baselineWalls, draggedWallId, pointIndex, connection, originalPoint);
    if (hostEndpointIndex !== null) {
      const hostIndex = repaired.findIndex((wall) => wall.id === connection.wallId);
      if (hostIndex >= 0) {
        const points = repaired[hostIndex].points.map((point) => ({ ...point }));
        points[hostEndpointIndex] = { ...movedPoint };
        repaired[hostIndex] = { ...repaired[hostIndex], points };
      }
      return;
    }

    const projection = projectOnSegment(movedPoint, hostStart, hostEnd);
    if (projection.distance <= CONNECTION_TOLERANCE_MM) {
      // `translateHostSegmentWithDraggedEndpoint` may already have moved this
      // host segment by exactly the dragged endpoint delta. In that case the
      // endpoint is still a valid interior junction on the translated wall;
      // splitting it again would manufacture an extra (often visible) corner
      // for what should remain one continuous wall.
      const baselineHost = baselineWalls.find((wall) => wall.id === connection.wallId);
      const baselineHostStart = baselineHost?.points[connection.segmentIndex];
      const baselineHostEnd = baselineHost?.points[connection.segmentIndex + 1];
      const movedDelta = { x: movedPoint.x - originalPoint.x, y: movedPoint.y - originalPoint.y };
      const hostStartDelta = baselineHostStart
        ? { x: hostStart.x - baselineHostStart.x, y: hostStart.y - baselineHostStart.y }
        : null;
      const hostEndDelta = baselineHostEnd
        ? { x: hostEnd.x - baselineHostEnd.x, y: hostEnd.y - baselineHostEnd.y }
        : null;
      const hostFollowed = [hostStartDelta, hostEndDelta].some((delta) => delta !== null
        && Math.hypot(delta.x - movedDelta.x, delta.y - movedDelta.y) <= CONNECTION_TOLERANCE_MM
        && Math.hypot(delta.x, delta.y) > CONNECTION_TOLERANCE_MM);
      if (hostFollowed) return;
      const hostLength = Math.hypot(hostEnd.x - hostStart.x, hostEnd.y - hostStart.y);
      const endpointTolerance = CONNECTION_TOLERANCE_MM / Math.max(1, hostLength);
      if (projection.along > endpointTolerance && projection.along < 1 - endpointTolerance) {
        const materialized = materializeJunctionCorner(baselineHost ?? hostWall, hostWall, connection.segmentIndex, projection.point, projection.along, repaired);
        const hostIndex = repaired.findIndex((wall) => wall.id === connection.wallId);
        if (hostIndex >= 0) repaired.splice(hostIndex, 1, materialized.wall);
        if (materialized.inserted) repaired.splice(0, repaired.length, ...remapAttachmentsToSplitHost(repaired, connection.wallId, connection.segmentIndex, projection.along));
      }
      return;
    }
    if (segmentCoveredByExistingWall(repaired, projection.point, movedPoint, draggedWallId)) return;

    const bridgeId = `${bridgeFamily}${pointIndex}:${connection.wallId}:${connection.segmentIndex}`;
    const bridge: WallDragWall = {
      id: bridgeId,
      points: [{ ...projection.point }, { ...movedPoint }],
      attachments: {
        // At an interior projection the bridge creates a real T junction, so
        // show its corner. Existing host corners stay the single visible handle.
        0: { wallId: connection.wallId, segmentIndex: connection.segmentIndex, along: projection.along, hideCorner: hasVisibleCornerAt(repaired, projection.point) },
        1: { wallId: draggedWallId, segmentIndex: draggedSegmentIndex, along: pointIndex === draggedSegmentIndex ? 0 : 1, hideCorner: hasVisibleCornerAt(repaired, movedPoint) },
      },
    };
    const bridgeIndex = repaired.findIndex((wall) => wall.id === bridgeId);
    if (bridgeIndex >= 0) repaired[bridgeIndex] = bridge; else repaired.push(bridge);
  });

  // Moving one segment of a closed room also changes its two neighbouring
  // segments. Other walls can terminate partway along either neighbour (for
  // example, walls 1–10 and 2–5 in the floorplan). If the dragged endpoint
  // moves past such a junction, retain a bridge instead of leaving the room
  // graph open.
  baselineDraggedWall.points.slice(0, -1).forEach((baselineStart, segmentIndex) => {
    const baselineEnd = baselineDraggedWall.points[segmentIndex + 1];
    const candidateStart = candidateDraggedWall.points[segmentIndex];
    const candidateEnd = candidateDraggedWall.points[segmentIndex + 1];
    if (!baselineEnd || !candidateStart || !candidateEnd) return;
    if (samePoint(baselineStart, candidateStart, .001) && samePoint(baselineEnd, candidateEnd, .001)) return;

    baselineWalls.forEach((baselineWall) => {
      if (baselineWall.id === draggedWallId || baselineWall.id.startsWith(AUTO_BRIDGE_PREFIX)) return;
      const candidateWall = repaired.find((wall) => wall.id === baselineWall.id);
      if (!candidateWall) return;
      const closed = samePoint(baselineWall.points[0], baselineWall.points.at(-1)!);
      baselineWall.points.slice(0, closed ? -1 : undefined).forEach((baselinePoint, pointIndex) => {
        const lastUniqueIndex = baselineWall.points.length - (closed ? 2 : 1);
        // A joining wall terminates at this junction. Do not turn every corner
        // on a closed room outline into a bridge when two walls merely overlap.
        if (pointIndex !== 0 && pointIndex !== lastUniqueIndex) return;
        const baselineProjection = projectOnSegment(baselinePoint, baselineStart, baselineEnd);
        if (baselineProjection.distance > CONNECTION_TOLERANCE_MM) return;
        const candidatePoint = candidateWall.points[pointIndex];
        if (!candidatePoint) return;
        const candidateProjection = projectOnSegment(candidatePoint, candidateStart, candidateEnd);
        if (candidateProjection.distance <= CONNECTION_TOLERANCE_MM || segmentCoveredByExistingWall(repaired, candidateProjection.point, candidatePoint, draggedWallId)) return;

        // If the host wall was translated with the dragged interior junction,
        // its endpoint has already followed the same delta as one endpoint of
        // this changed segment. It remains connected through the moved host;
        // adding another bridge here would draw a free-standing wall stub.
        const startDelta = { x: candidateStart.x - baselineStart.x, y: candidateStart.y - baselineStart.y };
        const endDelta = { x: candidateEnd.x - baselineEnd.x, y: candidateEnd.y - baselineEnd.y };
        const hostDelta = { x: candidatePoint.x - baselinePoint.x, y: candidatePoint.y - baselinePoint.y };
        const followsChangedEndpoint = [startDelta, endDelta].some((delta) => Math.hypot(delta.x - hostDelta.x, delta.y - hostDelta.y) <= CONNECTION_TOLERANCE_MM && Math.hypot(delta.x, delta.y) > CONNECTION_TOLERANCE_MM);
        if (followsChangedEndpoint) return;

        const bridgeId = `${bridgeFamily}junction:${segmentIndex}:${baselineWall.id}:${pointIndex}`;
        const hostSegmentIndex = connectionSegmentIndex(candidateWall, pointIndex);
        const bridge: WallDragWall = {
          id: bridgeId,
          points: [{ ...candidateProjection.point }, { ...candidatePoint }],
          attachments: {
            0: { wallId: draggedWallId, segmentIndex, along: candidateProjection.along, hideCorner: hasVisibleCornerAt(repaired, candidateProjection.point) },
            1: { wallId: baselineWall.id, segmentIndex: hostSegmentIndex, along: pointIndex > hostSegmentIndex ? 1 : 0, hideCorner: hasVisibleCornerAt(repaired, candidatePoint) },
          },
        };
        const bridgeIndex = repaired.findIndex((wall) => wall.id === bridgeId);
        if (bridgeIndex >= 0) repaired[bridgeIndex] = bridge; else repaired.push(bridge);
      });
    });
  });

  // Squared corner movement can translate an adjacent point on the selected
  // wall as well as the clicked point. That point may be an interior junction
  // on another room wall (corner 5 on the 4–1 side in the 6-down scenario),
  // so checking only the other wall's run endpoints misses the return wall.
  // Preserve the connection for every moved selected-wall point that has a
  // non-parallel leg at the original junction.
  baselineDraggedWall.points.slice(0, -1).forEach((baselinePoint, pointIndex) => {
    const movedPoint = candidateDraggedWall.points[pointIndex];
    if (!movedPoint || samePoint(baselinePoint, movedPoint, .001)) return;
    baselineWalls.forEach((baselineHostWall) => {
      if (baselineHostWall.id === draggedWallId || baselineHostWall.id.startsWith(AUTO_BRIDGE_PREFIX)) return;
      const candidateHostWall = repaired.find((wall) => wall.id === baselineHostWall.id);
      if (!candidateHostWall) return;
      baselineHostWall.points.slice(0, -1).forEach((baselineHostStart, hostSegmentIndex) => {
        const baselineHostEnd = baselineHostWall.points[hostSegmentIndex + 1];
        const candidateHostStart = candidateHostWall.points[hostSegmentIndex];
        const candidateHostEnd = candidateHostWall.points[hostSegmentIndex + 1];
        if (!baselineHostEnd || !candidateHostStart || !candidateHostEnd) return;
        const baselineProjection = projectOnSegment(baselinePoint, baselineHostStart, baselineHostEnd);
        if (baselineProjection.distance > CONNECTION_TOLERANCE_MM || !hasNonParallelConnectedLeg(baselineDraggedWall, pointIndex, baselineHostStart, baselineHostEnd)) return;
        const candidateProjection = projectOnSegment(movedPoint, candidateHostStart, candidateHostEnd);
        if (candidateProjection.distance <= CONNECTION_TOLERANCE_MM || segmentCoveredByExistingWall(repaired, candidateProjection.point, movedPoint, draggedWallId)) return;

        const sourceDelta = { x: movedPoint.x - baselinePoint.x, y: movedPoint.y - baselinePoint.y };
        const hostStartDelta = { x: candidateHostStart.x - baselineHostStart.x, y: candidateHostStart.y - baselineHostStart.y };
        const hostEndDelta = { x: candidateHostEnd.x - baselineHostEnd.x, y: candidateHostEnd.y - baselineHostEnd.y };
        const followsHost = [hostStartDelta, hostEndDelta].some((delta) => Math.hypot(delta.x - sourceDelta.x, delta.y - sourceDelta.y) <= CONNECTION_TOLERANCE_MM && Math.hypot(delta.x, delta.y) > CONNECTION_TOLERANCE_MM);
        if (followsHost) return;

        const sourceSegmentIndex = connectionSegmentIndex(candidateDraggedWall, pointIndex);
        const bridgeId = `${bridgeFamily}point:${pointIndex}:${baselineHostWall.id}:${hostSegmentIndex}`;
        const bridge: WallDragWall = {
          id: bridgeId,
          points: [{ ...candidateProjection.point }, { ...movedPoint }],
          attachments: {
            0: { wallId: baselineHostWall.id, segmentIndex: hostSegmentIndex, along: candidateProjection.along, hideCorner: hasVisibleCornerAt(repaired, candidateProjection.point) },
            1: { wallId: draggedWallId, segmentIndex: sourceSegmentIndex, along: pointIndex > sourceSegmentIndex ? 1 : 0, hideCorner: hasVisibleCornerAt(repaired, movedPoint) },
          },
        };
        const bridgeIndex = repaired.findIndex((wall) => wall.id === bridgeId);
        if (bridgeIndex >= 0) repaired[bridgeIndex] = bridge; else repaired.push(bridge);
      });
    });
  });

  return repaired;
}
