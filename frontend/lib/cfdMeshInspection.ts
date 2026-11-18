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
}
export interface MeshInspectionScene {
  metadata: MeshMetadata; geometry: MeshGeometry | null; display: MeshDisplay; opacity: number; fitRequest: number;
}

const headerSchema = z.object({schemaVersion: z.literal(1), meshId: hash, units: z.literal("mm"),
  points: z.int().min(0).max(2000000), triangles: z.int().min(0).max(1000000), edges: z.int().min(0).max(2000000),
  sectionCells: z.int().min(0).max(500000), axis: z.enum(["X", "Y", "Z"]).nullable(), coordinateMm: coordinate.nullable(),
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
  const expected = 8 + size + header.points * 24 + header.triangles * 12 + header.edges * 8;
  if (expected !== bytes.byteLength) throw new Error("Truncated mesh geometry.");
  const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  const pointsMm = new Float64Array(buffer, 8 + size, header.points * 3);
  const triangles = new Uint32Array(buffer, 8 + size + pointsMm.byteLength, header.triangles * 3);
  const edges = new Uint32Array(buffer, 8 + size + pointsMm.byteLength + triangles.byteLength, header.edges * 2);
  for (const value of pointsMm) if (!Number.isFinite(value) || Math.abs(value) > 1e9) throw new Error("Non-finite or out-of-range mesh point.");
  for (const values of [triangles, edges]) for (const value of values)
    if (value >= header.points) throw new Error("Mesh geometry references an unavailable point.");
  return {meshId, pointsMm, triangles, edges, sectionCells: header.sectionCells, axis: header.axis, coordinateMm: header.coordinateMm};
}
