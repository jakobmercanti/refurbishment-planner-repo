import type { CFDHost, Vec3 } from "./climoptix";
import type { CFDVent } from "./climoptixDocument";
import { snapVentUV } from "./climoptixPreview";

/** Project a measured point onto a checked host; the kernel validates polygon cutouts. */
export function ventUVAtPoint(vent: CFDVent, host: CFDHost, point: Vec3) {
  const delta = point.map((p, i) => p - host.originMm[i]);
  const dot = (axis: Vec3) => delta.reduce((sum, n, i) => sum + n * axis[i], 0);
  return snapVentUV(vent, host, dot(host.uAxis) / host.widthMm, dot(host.vAxis) / host.heightMm);
}
