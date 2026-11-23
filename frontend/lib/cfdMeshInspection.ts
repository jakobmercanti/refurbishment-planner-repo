import { z } from "zod";

const coordinate = z.number().finite().min(-1e9).max(1e9);
const vector = z.tuple([coordinate, coordinate, coordinate]);
const hash = z.string().regex(/^[a-f0-9]{64}$/);
export const meshMetadataSchema = z.object({
  schemaVersion: z.literal(1), meshId: hash, jobId: z.uuid(), projectId: z.uuid(), studyId: z.string(),
  clientRevision: hash, units: z.literal("mm"), cells: z.int().min(1).max(500000),
  faces: z.int().min(4).max(4000000), points: z.int().min(4).max(2000000),
  boundsMm: z.tuple([vector, vector]).refine(([min, max]) => min.every((value, index) => value < max[index]), "Invalid mesh bounds."),
  patches: z.array(z.object({name: z.string().max(200), faces: z.int().nonnegative(), startFace: z.int().nonnegative()})).max(10000),
  regions: z.array(z.string().max(200)).max(100), expiresAt: z.number().finite(), representation: z.string().max(200),
});
export type MeshMetadata = z.infer<typeof meshMetadataSchema>;
export type MeshAxis = "X" | "Y" | "Z";
export type MeshDisplay = "solid" | "wireframe" | "transparent";
export interface MeshSection {axis: MeshAxis; coordinateMm: number}
export interface MeshGeometry {
  meshId: string; pointsMm: Float64Array; triangles: Uint32Array; edges: Uint32Array;
  sectionCells: number; axis: MeshAxis | null; coordinateMm: number | null;
  motion?: {min: number; max: number; derivatives: Float64Array};
}
export function createMeshPosition() {
  let fraction = .5;
  let frame = 0, lastPaint = 0;
  const listeners = new Set<() => void>();
  const notify = (now: number) => {
    if (now - lastPaint < 32) { frame = requestAnimationFrame(notify); return; }
    frame = 0; lastPaint = now; listeners.forEach(listener => listener());
  };
  return {
    getSnapshot: () => fraction,
    subscribe: (listener: () => void) => { listeners.add(listener); return () => {
      listeners.delete(listener);
      if (!listeners.size && frame) { cancelAnimationFrame(frame); frame = 0; }
    }; },
    set: (value: number) => {
      const next = Math.max(0, Math.min(1, value));
      if (!Number.isFinite(next) || next === fraction) return;
      fraction = next;
      if (!frame && listeners.size) frame = requestAnimationFrame(notify);
    },
  };
}
export function createMeshSectionView() {
  let geometry: MeshGeometry | null = null;
  const listeners = new Set<() => void>();
  return {
    getSnapshot: () => geometry,
    subscribe: (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; },
    set: (value: MeshGeometry | null) => { geometry = value; listeners.forEach(listener => listener()); },
  };
}
export interface MeshInspectionScene {
  metadata: MeshMetadata; geometry: MeshGeometry | null; display: MeshDisplay; opacity: number; fitRequest: number;
  coordinateMm: number;
  rearGeometry: MeshGeometry | null;
  position: ReturnType<typeof createMeshPosition>;
  live: ReturnType<typeof createMeshSectionView>;
  section: {axis: MeshAxis; min: number; max: number} | null;
}

/** A server-proven affine interval never crosses a topology/triangle event. */
export function meshSectionContains(geometry: MeshGeometry, axis: MeshAxis, coordinateMm: number) {
  return geometry.axis === axis && (geometry.coordinateMm === coordinateMm || !!geometry.motion
    && coordinateMm > geometry.motion.min && coordinateMm < geometry.motion.max);
}

const headerSchema = z.object({schemaVersion: z.literal(1), meshId: hash, units: z.literal("mm"),
  points: z.int().min(0).max(2000000), triangles: z.int().min(0).max(1000000), edges: z.int().min(0).max(2000000),
  sectionCells: z.int().min(0).max(500000), axis: z.enum(["X", "Y", "Z"]).nullable(), coordinateMm: coordinate.nullable(),
  motionBoundsMm: z.tuple([coordinate, coordinate]).optional(),
});

/** Versioned, bounded binary buffers. Native solver files stay on the worker. */
export function readMeshGeometry(bytes: Uint8Array, meshId: string, section?: MeshSection): MeshGeometry {
  if (bytes.byteLength < 16 || bytes.byteLength > 48 * 1024**2 || new TextDecoder().decode(bytes.subarray(0, 4)) !== "CMI1")
    throw new Error("Invalid mesh inspection buffer.");
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const size = view.getUint32(4, true);
  if (size > 8192 || size % 8 || size + 8 > bytes.byteLength) throw new Error("Invalid mesh buffer header.");
  const header = headerSchema.parse(JSON.parse(new TextDecoder().decode(bytes.subarray(8, 8 + size))));
  if (header.meshId !== meshId || header.axis !== (section?.axis ?? null) || header.coordinateMm !== (section?.coordinateMm ?? null))
    throw new Error("Mesh geometry belongs to another revision or section.");
  const expected = 8 + size + header.points * 24 + header.triangles * 12 + header.edges * 8 + (header.motionBoundsMm ? header.points * 24 : 0);
  if (expected !== bytes.byteLength) throw new Error("Truncated mesh geometry.");
  const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  const pointsMm = new Float64Array(buffer, 8 + size, header.points * 3);
  const triangles = new Uint32Array(buffer, 8 + size + pointsMm.byteLength, header.triangles * 3);
  const edges = new Uint32Array(buffer, 8 + size + pointsMm.byteLength + triangles.byteLength, header.edges * 2);
  for (const value of pointsMm) if (!Number.isFinite(value) || Math.abs(value) > 1e9) throw new Error("Non-finite or out-of-range mesh point.");
  for (const values of [triangles, edges]) for (const value of values)
    if (value >= header.points) throw new Error("Mesh geometry references an unavailable point.");
  let motion: MeshGeometry["motion"];
  if (header.motionBoundsMm) {
    const [min, max] = header.motionBoundsMm;
    if (!header.axis || header.coordinateMm === null || !(min < header.coordinateMm && header.coordinateMm < max))
      throw new Error("Invalid mesh section motion bounds.");
    // Triangle indices can leave a four-byte offset; copy to an aligned buffer.
    const derivatives = new Float64Array(buffer.slice(expected - header.points * 24));
    const axis = "XYZ".indexOf(header.axis);
    for (let i = 0; i < derivatives.length; i++) {
      if (!Number.isFinite(derivatives[i]) || Math.abs(derivatives[i]) > 1e12
        || i % 3 === axis && Math.abs(derivatives[i] - 1) > 1e-9)
        throw new Error("Invalid mesh section motion.");
      for (const bound of [min, max]) if (Math.abs(pointsMm[i] + derivatives[i] * (bound - header.coordinateMm)) > 1e9)
        throw new Error("Mesh section motion exceeds its coordinate limits.");
    }
    motion = {min, max, derivatives};
  }
  return {meshId, pointsMm, triangles, edges, motion, sectionCells: header.sectionCells, axis: header.axis, coordinateMm: header.coordinateMm};
}
