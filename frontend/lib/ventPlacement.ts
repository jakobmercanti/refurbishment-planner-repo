import type { CFDHost, CFDPatch, Vec3 } from "./climoptix";
import type { CFDVent } from "./climoptixDocument";
import { snapVentUV, ventCenter } from "./climoptixPreview";
import { containsPoint } from "./elementPlacement";
import type { Point2D } from "./types";

/** Project a measured point onto a checked host; the kernel validates polygon cutouts. */
export function ventUVAtPoint(vent: CFDVent, host: CFDHost, point: Vec3) {
  const delta = point.map((p, i) => p - host.originMm[i]);
  const dot = (axis: Vec3) => delta.reduce((sum, n, i) => sum + n * axis[i], 0);
  return snapVentUV(vent, host, dot(host.uAxis) / host.widthMm, dot(host.vAxis) / host.heightMm);
}

/** Translate the vent by the pointer displacement without changing its elevation. */
export function ventPointFromPlanDrag(vent: CFDVent, host: CFDHost, start: Point2D, end: Point2D): Vec3 {
  const centre = ventCenter(vent, host);
  return [centre[0] + end.x - start.x, centre[1] + end.y - start.y, centre[2]];
}

/** Match a rendered building hit to a checked host, including real polygon holes. */
export function ventHostAtPoint(vent: CFDVent, patches: readonly CFDPatch[], point: Vec3, toleranceMm = 8) {
  return patches.flatMap(patch => {
    const host = patch.host;
    if (!patch.hostable || !host || !["wall", "floor", "ceiling"].includes(patch.kind)) return [];
    const delta = point.map((n, i) => n - host.originMm[i]);
    const dot = (axis: Vec3) => delta.reduce((sum, n, i) => sum + n * axis[i], 0);
    const distance = Math.abs(dot(host.normal)); if (distance > toleranceMm) return [];
    const local = { x: dot(host.uAxis), y: dot(host.vAxis) };
    if (!host.polygonsMm.some(polygon => containsPoint(local, polygon[0].map(([x,y]) => ({x,y}))) && !polygon.slice(1).some(hole => containsPoint(local, hole.map(([x,y])=>({x,y})))))) return [];
    const uv = snapVentUV(vent, host, local.x / host.widthMm, local.y / host.heightMm);
    return uv ? [{ patch, uv, distance }] : [];
  }).sort((a,b)=>a.distance-b.distance)[0] ?? null;
}

/** Numeric placement accepts rounding to a millimetre without silently clamping to an edge. */
export function ventHostAtCoordinates(vent: CFDVent, patches: readonly CFDPatch[], point: Vec3): CFDVent["host"] | null {
  if (!point.every(Number.isFinite)) return null;
  const current = patches.find(patch => patch.id === vent.host.patchId);
  const fits = (patch: CFDPatch) => {
    const hit = ventHostAtPoint(vent, [patch], point, 1);
    if (!hit || !patch.host) return null;
    const centre = ventCenter(vent, patch.host, ...hit.uv);
    return Math.hypot(...centre.map((value, axis) => value - point[axis])) <= 1
      ? { patchId: patch.id, u: hit.uv[0], v: hit.uv[1] } : null;
  };
  const onCurrent = current && fits(current);
  if (onCurrent) return onCurrent;
  for (const patch of patches) {
    if (patch === current) continue;
    const host = fits(patch);
    if (host) return host;
  }
  return null;
}

/** Resolve a 2D drop against measured room-facing hosts, including sloped ceilings. */
export function ventHostFromPlan(vent: CFDVent, patches: readonly CFDPatch[], point: Vec3, toleranceMm: number, wallThicknessMm: (patch: CFDPatch) => number, preserveWallHeight: boolean) {
  const walls = patches.filter(patch => patch.kind === "wall" && patch.hostable && patch.host);
  const wallHits = walls.flatMap(patch => {
    const host = patch.host!;
    const dx = point[0] - host.originMm[0], dy = point[1] - host.originMm[1];
    const faceOffset = dx * host.normal[0] + dy * host.normal[1];
    // The checked host is the room-facing surface. The drawn wall extends
    // outward from that face, so the entire visible strip is a snap target.
    const distance = Math.max(-faceOffset, faceOffset - wallThicknessMm(patch), 0);
    const along = dx * host.uAxis[0] + dy * host.uAxis[1];
    if (distance > toleranceMm || along < -toleranceMm || along > host.widthMm + toleranceMm) return [];
    const height = preserveWallHeight ? (point[2] - host.originMm[2]) / (host.vAxis[2] * host.heightMm) : 0.5;
    const uv = snapVentUV(vent, host, along / host.widthMm, height);
    return uv ? [{ patch, uv, distance, faceDistance: Math.abs(faceOffset) }] : [];
  }).sort((a, b) => a.distance - b.distance || a.faceDistance - b.faceDistance);
  if (wallHits[0]) return wallHits[0];
  for (const patch of patches) {
    const host = patch.host;
    if (patch.kind !== "ceiling" || !patch.hostable || !host || Math.abs(host.normal[2]) < 1e-6) continue;
    const z = host.originMm[2] - ((point[0] - host.originMm[0]) * host.normal[0] + (point[1] - host.originMm[1]) * host.normal[1]) / host.normal[2];
    const hit = ventHostAtPoint(vent, [patch], [point[0], point[1], z]);
    if (hit) return hit;
  }
  return null;
}
