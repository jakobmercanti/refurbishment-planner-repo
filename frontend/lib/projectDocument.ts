import { z } from "zod";
import type { Room } from "./types";
import type { PersistedFloorplan } from "../components/FullFloorplanEditor";

const id = z.string().min(1).max(150).regex(/^[\w:-]+$/);
const number = z.number().finite().min(-1e7).max(1e7);
const point = z.object({ x: number, y: number });
const colour = z.string().regex(/^#[0-9a-fA-F]{6}$/);
const measurement = z.object({ value: number.positive(), uncertainty_mm: number.nonnegative(), verified: z.boolean(), source_type: z.string().max(100) });
const roomSchema = z.object({ id, name: z.string().max(1000), version: z.number().int().nonnegative(), vertices: z.array(point).min(3).max(10000), wall_height: measurement, wall_thickness: measurement, openings: z.array(z.object({ id }).passthrough()).max(10000), obstacles: z.array(z.object({ id, center: point, dimensions: z.object({ width: measurement, depth: measurement, height: measurement }), base_z_mm: number, rotation_deg: number, verified: z.boolean() }).passthrough()).max(10000) }).passthrough();
const layoutSchema = z.object({
  walls: z.array(z.object({ id, points: z.array(point).min(2).max(10000) }).passthrough()).max(10000),
  rooms: z.array(z.object({ id, name: z.string().max(1000), vertices: z.array(point).min(3).max(10000), sourceWallId: id }).passthrough()).max(1000),
  openings: z.array(z.object({ id, kind: z.enum(["DOOR", "WINDOW"]), wallId: id, segmentIndex: z.number().int().nonnegative(), offset: number.nonnegative(), width: number.positive(), height: number.positive(), sill: number.nonnegative(), hingeSide: z.enum(["START", "END"]), doorType: z.enum(["SINGLE", "DOUBLE"]), opensInward: z.boolean() }).passthrough()).max(10000),
  measurements: z.array(z.object({ id }).passthrough()).max(10000),
  annotations: z.array(z.object({ id, type: z.enum(["LINE", "ARROW", "POLYLINE", "TEXT", "CALLOUT", "MARKER"]), style: z.object({}).passthrough() }).passthrough()).max(10000),
  dimensionOffsets: z.record(z.string(), number), hiddenDimensions: z.array(z.string()).max(10000),
  canvasSize: z.object({ width: number.positive(), height: number.positive() }), selectedRoomId: id.nullable(),
}).passthrough();
export const assetSchema = z.object({
  assetId: id, assetVersion: z.literal(1), name: z.string().max(200), source: z.literal("local"), modelFormat: z.literal("glb"),
  contentHash: z.string().regex(/^[a-f0-9]{64}$/), byteSize: z.number().int().positive().max(50 * 1024 * 1024),
  computedBoundsMm: z.object({ x: number.positive(), y: number.positive(), z: number.positive() }),
  geometryAuthority: z.literal("visual-only"), createdAt: z.iso.datetime(),
}).strict();
export type AssetDefinition = z.infer<typeof assetSchema>;
const vector = z.object({ x: number, y: number, z: number });
const instanceSchema = z.object({ instanceId: id, assetId: id, assetVersion: z.literal(1), positionMm: vector, rotationDeg: vector, scale: z.object({ x: number.positive(), y: number.positive(), z: number.positive() }) }).strict();
export type AssetInstance = z.infer<typeof instanceSchema>;
const documentSchema = z.object({
  schemaVersion: z.literal(1), projectId: id, name: z.string().max(200), units: z.literal("mm"),
  createdAt: z.iso.datetime(), updatedAt: z.iso.datetime(), generated: z.boolean(),
  rooms: z.array(roomSchema).max(1000), floorplan: layoutSchema.nullable(),
  assets: z.array(assetSchema).max(100), assetInstances: z.array(instanceSchema).max(1000),
}).strict();
export interface ProjectDocument {
  schemaVersion: 1; projectId: string; name: string; units: "mm"; createdAt: string; updatedAt: string; generated: boolean;
  rooms: Room[]; floorplan: PersistedFloorplan | null; assets: AssetDefinition[]; assetInstances: AssetInstance[];
}

function inspectJson(value: unknown, depth = 0): void {
  if (depth > 40) throw new Error("Project nesting limit exceeded.");
  if (typeof value === "number" && !Number.isFinite(value)) throw new Error("Invalid project number.");
  if (typeof value === "string" && value.length > 100000) throw new Error("Project text exceeds the size limit.");
  if (!value || typeof value !== "object") return;
  for (const [key, item] of Object.entries(value)) {
    if (item === undefined || item === null) continue;
    if (["__proto__", "prototype", "constructor", "stl_base64", "stl_filename"].includes(key)) throw new Error("Unsupported project content.");
    if (typeof item === "string" && /(?:url|uri|path)$/i.test(key) && !/^\/fixture-(symbols|previews)\/[\w-]+\.(svg|png|jpg|webp)$/.test(item)) throw new Error("External resources are not allowed in project files.");
    inspectJson(item, depth + 1);
  }
}
function unique(values: string[]) { if (new Set(values).size !== values.length) throw new Error("Duplicate project entity ID."); }
export function parseProject(input: unknown): ProjectDocument {
  inspectJson(input);
  if (!input || typeof input !== "object" || !("schemaVersion" in input) || input.schemaVersion !== 1) throw new Error("Unsupported project schema version. This app supports version 1.");
  const p = documentSchema.parse(input) as unknown as ProjectDocument;
  unique(p.rooms.map(r => r.id)); unique(p.assets.map(a => a.assetId)); unique(p.assetInstances.map(a => a.instanceId));
  for (const room of p.rooms) {
    unique(room.obstacles.map(o => o.id)); unique(room.openings.map(o => o.id));
    for (const opening of room.openings) z.object({ id, kind: z.enum(["DOOR", "WINDOW", "GENERIC"]), parent_wall_id: id, offset_mm: number.nonnegative(), width: measurement, height: measurement, sill_height_mm: number.nonnegative() }).parse(opening);
    for (const obstacle of room.obstacles) {
      if (obstacle.color_hex !== undefined) colour.parse(obstacle.color_hex);
      if (obstacle.component_colors !== undefined) z.record(z.string(), colour).parse(obstacle.component_colors);
    }
    if (room.person_mockup) z.object({ id, enabled: z.boolean(), center: point, rotation_deg: number, posture: z.enum(["STANDING", "SEATED", "CROUCHING"]), height_mm: number.positive(), shoulder_width_mm: number.positive(), body_depth_mm: number.positive(), eye_height_mm: number.nonnegative(), movement_clearance_mm: number.nonnegative(), include_in_analysis: z.boolean() }).parse(room.person_mockup);
    if (room.finishes?.wall_colors) z.record(z.string(), colour).parse(room.finishes.wall_colors);
  }
  if (p.floorplan) {
    unique(p.floorplan.walls.map(w => w.id)); unique(p.floorplan.rooms.map(r => r.id)); unique(p.floorplan.openings.map(o => o.id));
    for (const wall of p.floorplan.walls) {
      if (wall.attachments) z.record(z.string().regex(/^\d+$/), z.object({ wallId: id, segmentIndex: z.number().int().nonnegative(), along: number, hideCorner: z.boolean().optional() })).parse(wall.attachments);
      if (wall.thicknessOverridesMm) z.record(z.string().regex(/^\d+$/), number.positive()).parse(wall.thicknessOverridesMm);
      if (wall.lengthOverridesMm) z.record(z.string().regex(/^\d+$/), number.positive()).parse(wall.lengthOverridesMm);
    }
    const reference = z.discriminatedUnion("kind", [z.object({ kind: z.literal("WALL"), wallId: id, segmentIndex: z.number().int().nonnegative() }), z.object({ kind: z.literal("POINT"), wallId: id, pointIndex: z.number().int().nonnegative() }), z.object({ kind: z.literal("ROOM_POINT"), point }), z.object({ kind: z.literal("FIXTURE"), fixtureId: id }), z.object({ kind: z.literal("OPENING"), openingId: id })]);
    for (const m of p.floorplan.measurements) z.object({ id, first: reference, second: reference, offset: number, direction: z.enum(["NORMAL", "HORIZONTAL", "VERTICAL"]).optional() }).parse(m);
    for (const annotation of p.floorplan.annotations) {
      z.object({ lineStyle: z.enum(["SOLID", "DASHED", "DOTTED", "SHORT_DASH", "LONG_DASH", "DASH_DOT", "DASH_DOT_DOT"]), thickness: number.nonnegative(), textSize: number.positive(), rotation: number.optional(), color: colour.optional() }).parse(annotation.style);
      if (["LINE", "ARROW"].includes(annotation.type)) { point.parse(annotation.start); point.parse(annotation.end); }
      if (annotation.type === "POLYLINE") z.array(point).min(2).max(10000).parse(annotation.points);
      if (annotation.type === "TEXT") { point.parse(annotation.position); z.string().max(10000).parse(annotation.text); }
      if (annotation.type === "CALLOUT") { point.parse(annotation.anchor); point.parse(annotation.labelPosition); z.string().max(10000).parse(annotation.text); }
      if (annotation.type === "MARKER") { point.parse(annotation.position); z.object({ symbol: z.enum(["CIRCLE", "FILLED_CIRCLE", "SQUARE", "FILLED_SQUARE", "TRIANGLE", "DIAMOND", "EXCLAMATION", "QUESTION", "PLUS", "CROSS", "NUMBER", "LETTER"]), label: z.string().max(1000), color: colour, size: z.union([number.positive(), z.enum(["", "SMALL", "MEDIUM", "LARGE"])]), arrowAttached: z.boolean().optional() }).parse(annotation.marker); }
    }
    for (const opening of p.floorplan.openings) { const wall = p.floorplan.walls.find(w => w.id === opening.wallId); if (!wall || opening.segmentIndex >= wall.points.length - 1) throw new Error("Opening references a missing wall."); }
  }
  if (p.assetInstances.some(i => !p.assets.some(a => a.assetId === i.assetId && a.assetVersion === i.assetVersion))) throw new Error("A placed model is missing its asset definition.");
  return p;
}
// New versions must add explicit sequential migrations here, never shape guessing.
export const migrateProject = parseProject;
export function newProject(): ProjectDocument {
  const now = new Date().toISOString();
  return { schemaVersion: 1, projectId: crypto.randomUUID(), name: "My floorplan", units: "mm", createdAt: now, updatedAt: now, generated: false, rooms: [], floorplan: null, assets: [], assetInstances: [] };
}
export const capabilities = Object.freeze({ canSaveCloudProjects: false, canUploadCloudAssets: false, canUseAiRendering: false, canExport4K: false, cloudStorageBytes: 0, aiRenderCreditsRemaining: 0 });
