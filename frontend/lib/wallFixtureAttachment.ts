import { obstacleFootprint } from "./elementPlacement";
import { isHeatingElement } from "./heatingElements";
import type { Obstacle, Point2D } from "./types";

export type WallFixtureAttachment = {
  fixtureId: string;
  wallId: string;
  segmentIndex: number;
  along: number;
  normalOffsetMm: number;
  rotationOffsetDeg: number;
};

type AttachmentWall = { id: string; points: Point2D[] };
type WallThicknessForSegment = (wallId: string, segmentIndex: number) => number;

const ATTACHMENT_TOLERANCE_MM = 25;
const normalizeDegrees = (degrees: number) => ((degrees + 180) % 360 + 360) % 360 - 180;

function distanceToSegment(point: Point2D, start: Point2D, end: Point2D) {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const squaredLength = dx * dx + dy * dy;
  const along = squaredLength
    ? Math.max(0, Math.min(1, ((point.x - start.x) * dx + (point.y - start.y) * dy) / squaredLength))
    : 0;
  return Math.hypot(point.x - (start.x + dx * along), point.y - (start.y + dy * along));
}

/** Captures stable local positions for wall-locked and physically wall-mounted fixtures. */
export function captureWallFixtureAttachments(
  fixtures: Obstacle[],
  walls: AttachmentWall[],
  wallThicknessForSegment: WallThicknessForSegment,
): WallFixtureAttachment[] {
  return fixtures.flatMap((fixture) => {
    let nearestWallId: string | null = null;
    let nearestSegmentIndex = -1;
    let nearestDistance = Number.POSITIVE_INFINITY;
    walls.forEach((wall) => wall.points.slice(0, -1).forEach((start, index) => {
      const end = wall.points[index + 1];
      if (!end) return;
      const candidateDistance = distanceToSegment(fixture.center, start, end);
      if (candidateDistance < nearestDistance - 1e-6) {
        nearestWallId = wall.id;
        nearestSegmentIndex = index;
        nearestDistance = candidateDistance;
      }
    }));
    if (!nearestWallId) return [];

    const hostWall = walls.find((wall) => wall.id === nearestWallId);
    const start = hostWall?.points[nearestSegmentIndex];
    const end = hostWall?.points[nearestSegmentIndex + 1];
    if (!hostWall || !start || !end) return [];
    const dx = end.x - start.x;
    const dy = end.y - start.y;
    const length = Math.hypot(dx, dy);
    if (length <= 1e-6) return [];
    const tangent = { x: dx / length, y: dy / length };
    const normal = { x: -tangent.y, y: tangent.x };
    const corners = obstacleFootprint(fixture);
    const tangentReach = Math.max(...corners.map((point) => Math.abs((point.x - fixture.center.x) * tangent.x + (point.y - fixture.center.y) * tangent.y)));
    const normalReach = Math.max(...corners.map((point) => Math.abs((point.x - fixture.center.x) * normal.x + (point.y - fixture.center.y) * normal.y)));
    const relative = { x: fixture.center.x - start.x, y: fixture.center.y - start.y };
    const alongMm = relative.x * tangent.x + relative.y * tangent.y;
    if (alongMm < -tangentReach - ATTACHMENT_TOLERANCE_MM || alongMm > length + tangentReach + ATTACHMENT_TOLERANCE_MM) return [];

    const wallLock = fixture.wall_lock === true;
    // Heating-editor emitters have a 40 mm setback even on zero/thin walls.
    // Recognise that mounted position without attaching free-standing heaters.
    const setbackMm = isHeatingElement(fixture) ? 40 : ATTACHMENT_TOLERANCE_MM;
    const touchesWall = Math.abs(relative.x * normal.x + relative.y * normal.y)
      <= normalReach + Math.max(0, wallThicknessForSegment(nearestWallId, nearestSegmentIndex)) / 2 + setbackMm + 1e-6;
    const widthAxis = { x: Math.cos(fixture.rotation_deg * Math.PI / 180), y: Math.sin(fixture.rotation_deg * Math.PI / 180) };
    const depthAxis = { x: widthAxis.y, y: -widthAxis.x };
    const alignedWithWall = Math.max(
      Math.abs(widthAxis.x * tangent.x + widthAxis.y * tangent.y),
      Math.abs(depthAxis.x * tangent.x + depthAxis.y * tangent.y),
    ) >= Math.cos(Math.PI / 6);
    const electricalDevice = fixture.representation_key?.startsWith("electrical-") ?? false;
    if (!wallLock && (!touchesWall || (!electricalDevice && !alignedWithWall))) return [];

    const wallAngleDeg = Math.atan2(dy, dx) * 180 / Math.PI;
    return [{
      fixtureId: fixture.id,
      wallId: nearestWallId,
      segmentIndex: nearestSegmentIndex,
      along: Math.max(0, Math.min(1, alongMm / length)),
      normalOffsetMm: relative.x * normal.x + relative.y * normal.y,
      rotationOffsetDeg: normalizeDegrees(fixture.rotation_deg - wallAngleDeg),
    }];
  });
}

/** Reapplies each fixture's local wall coordinates after wall geometry changes. */
export function positionWallAttachedFixtures(
  fixtures: Obstacle[],
  attachments: WallFixtureAttachment[],
  walls: AttachmentWall[],
  wallThicknessForSegment?: WallThicknessForSegment,
): Obstacle[] {
  const attachmentByFixtureId = new Map(attachments.map((attachment) => [attachment.fixtureId, attachment]));
  return fixtures.map((fixture) => {
    const attachment = attachmentByFixtureId.get(fixture.id);
    if (!attachment) return fixture;
    const wall = walls.find((candidate) => candidate.id === attachment.wallId);
    const start = wall?.points[attachment.segmentIndex];
    const end = wall?.points[attachment.segmentIndex + 1];
    if (!start || !end) return fixture;
    const dx = end.x - start.x;
    const dy = end.y - start.y;
    const length = Math.hypot(dx, dy);
    if (length <= 1e-6) return fixture;
    const tangent = { x: dx / length, y: dy / length };
    const normal = { x: -tangent.y, y: tangent.x };
    let alongMm = length * attachment.along, normalOffsetMm = attachment.normalOffsetMm;
    if (isHeatingElement(fixture)) {
      const endMargin = (point: Point2D) => Math.max(1, ...walls.flatMap(candidate => candidate.points.slice(0, -1).flatMap((a, i) => {
        const b = candidate.points[i + 1];
        if (candidate.id === wall.id && i === attachment.segmentIndex || Math.min(Math.hypot(a.x - point.x, a.y - point.y), Math.hypot(b.x - point.x, b.y - point.y)) > .01) return [];
        return [Math.max(0, wallThicknessForSegment?.(candidate.id, i) ?? 0) / 2 + 1];
      })));
      const low = fixture.dimensions.width.value / 2 + endMargin(start), high = length - fixture.dimensions.width.value / 2 - endMargin(end);
      if (low <= high) alongMm = Math.max(low, Math.min(high, alongMm));
      if (wallThicknessForSegment) normalOffsetMm = (Math.sign(normalOffsetMm) || 1) * (fixture.dimensions.depth.value / 2 + Math.max(0, wallThicknessForSegment(wall.id, attachment.segmentIndex)) / 2 + 1);
    }
    const center = {
      x: start.x + tangent.x * alongMm + normal.x * normalOffsetMm,
      y: start.y + tangent.y * alongMm + normal.y * normalOffsetMm,
    };
    const wallAngleDeg = Math.atan2(dy, dx) * 180 / Math.PI;
    const rotated = normalizeDegrees(wallAngleDeg + attachment.rotationOffsetDeg);
    const rotation_deg = Math.abs(normalizeDegrees(rotated - fixture.rotation_deg)) < 1e-4 ? fixture.rotation_deg : rotated;
    if (Math.abs(center.x - fixture.center.x) < 1e-4 && Math.abs(center.y - fixture.center.y) < 1e-4 && Math.abs(normalizeDegrees(rotation_deg - fixture.rotation_deg)) < 1e-4) return fixture;
    return { ...fixture, center, rotation_deg };
  });
}

/** Captures fixture-local wall coordinates before an edit and reapplies them to the edited geometry. */
export function followWallAttachedFixtures(
  fixtures: Obstacle[],
  previousWalls: AttachmentWall[],
  nextWalls: AttachmentWall[],
  wallThicknessForSegment: WallThicknessForSegment,
): Obstacle[] {
  const attachments = captureWallFixtureAttachments(fixtures, previousWalls, wallThicknessForSegment);
  return positionWallAttachedFixtures(fixtures, attachments, nextWalls, wallThicknessForSegment);
}
