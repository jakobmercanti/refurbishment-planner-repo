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
