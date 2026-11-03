import { z } from "zod";
import { cfdValidationSchema, boundarySchema, PATCH_KINDS } from "./climoptixDocument";
import { sharedBoundaryAuditSchema } from "./sharedBoundaryDocument";

const finite = z.number().finite(),
  vec = z.tuple([finite, finite, finite]),
  tri = z.tuple([
    z.int().nonnegative(),
    z.int().nonnegative(),
    z.int().nonnegative(),
  ]);
const reportSchema = z
  .object({
    sharedBoundaryAudit: sharedBoundaryAuditSchema.optional(),
    schemaVersion: z.literal(1),
    kind: z.literal("ClimoptixPreparation"),
    adapterVersion: z.literal(1),
    units: z.literal("mm"),
    state: z.enum(["Draft", "Validated"]),
    validation: cfdValidationSchema,
    provider: z
      .object({
        id: z.literal("preparation-only"),
        status: z.literal("notConnected"),
        canRun: z.literal(false),
        canMesh: z.literal(false),
        reason: z.string(),
      })
      .passthrough(),
    surface: z
      .object({
        units: z.literal("mm"),
        verticesMm: z.array(vec).max(100000),
        triangles: z.array(tri).max(200000),
        trianglePatches: z.array(z.string()).max(200000),
        closed: z.boolean(),
        exportable: z.boolean(),
        volumeM3: finite,
        badEdges: z.int().nonnegative(),
        triangleCount: z.int().nonnegative(),
        kind: z.literal("boundarySurface"),
      })
      .passthrough(),
    patches: z
      .array(
        z
          .object({
            id: z.string(),
            label: z.string().optional(),
            kind: z.enum(PATCH_KINDS),
            roomId: z.string(),
            floorId: z.string(),
            sourceId: z.string(),
            hostable: z.boolean(),
            host: z
              .object({
                originMm: vec,
                uAxis: vec,
                vAxis: vec,
                normal: vec,
                widthMm: finite.positive(),
                heightMm: finite.positive(),
                polygonsMm: z
                  .array(z.array(z.array(z.array(finite).length(2))))
                  .max(20000),
              })
              .optional(),
            areaM2: finite.nonnegative(),
            normal: vec,
            boundary: boundarySchema,
            boundaryOrigin: z.string(),
            needsReview: z.boolean().optional(),
          })
          .passthrough(),
      )
      .max(20000),
    diagnostics: z
      .array(
        z
          .object({
            severity: z.enum(["error", "warning", "info"]),
            message: z.string(),
            repair: z.string(),
            code: z.string(),
            group: z.string(),
            objectId: z.string().nullable(),
          })
          .passthrough(),
      )
      .max(20000),
    domain: z.object({
      regions: z
        .array(
          z.object({
            id: z.string(),
            floorId: z.string(),
            name: z.string(),
            included: z.boolean(),
            baseMm: finite,
            verticesMm: z.array(z.tuple([finite, finite])).max(15000),
            ceilingRangeMm: z.tuple([finite, finite]),
          }),
        )
        .max(200),
      includedRoomIds: z.array(z.string()).max(200),
      boundsMm: z.tuple([vec, vec]).nullable(),
      floorIds: z.array(z.string()).max(200),
      volumeM3: finite,
      portals: z
        .array(
          z.object({
            id: z.string(),
            kind: z.string(),
            rooms: z.array(z.string()),
            traversed: z.boolean(),
            reason: z.string(),
            ringsMm: z.record(z.string(), z.array(vec)),
          }),
        )
        .max(1000),
      slabVoids: z
        .array(
          z
            .object({
              id: z.string(),
              lower: z.string(),
              upper: z.string(),
              bottom: finite,
              top: finite,
            })
            .passthrough(),
        )
        .max(1000),
    }),
    objects: z
      .array(
        z
          .object({
            id: z.string(),
            name: z.string(),
            roomId: z.string(),
            floorId: z.string(),
            mode: z.enum(["none", "solidProxy", "sourceOnly", "porousProxy"]),
            profile: z.string().nullable(),
            heatW: finite.nonnegative(),
            co2M3S: finite.nonnegative(),
            notes: z.string(),
            assumptions: z.array(z.string()).optional(),
            verticesMm: z.array(vec).max(100000),
            triangles: z.array(tri).max(200000),
          })
          .passthrough(),
      )
      .max(10000),
    vents: z
      .array(
        z
          .object({
            id: z.string(),
            patchId: z.string(),
            actualAreaM2: finite.positive(),
            effectiveAreaM2: finite.positive(),
            dischargeCoefficient: finite.positive(),
            volumeFlowM3S: finite.nullable(),
            meanVelocityMS: finite.nullable(),
            centerMm: vec,
            outwardNormal: vec,
            jetDirection: vec,
            role: z.enum(["supply", "extract"]),
          })
          .passthrough(),
      )
      .max(500),
    meshRecipe: z
      .object({
        kind: z.literal("meshIntent"),
        estimate: z.object({
          baseCells: finite.nonnegative(),
          rangeCells: z.tuple([finite, finite]),
          memoryRangeGb: z.tuple([finite, finite]),
          disclaimer: z.string(),
        }),
        achievedQuality: z.null(),
      })
      .passthrough(),
    flowBalance: z.object({
      supplyM3S: finite,
      extractM3S: finite,
      pressurePath: z.boolean(),
    }),
    limitations: z.array(z.string()),
    caseGenerated: z.literal(false),
    resultManifest: z.null(),
  })
  .passthrough();


// Runtime validation and TypeScript consumers share one authoritative contract.
export type CFDReport = z.infer<typeof reportSchema>;
export type CFDPatch = CFDReport["patches"][number];
export type CFDHost = NonNullable<CFDPatch["host"]>;
export type CFDObject = CFDReport["objects"][number];
export type Vec3 = [number, number, number];

/** Reject inconsistent manifests before they reach a viewer, export or worker gate. */
export function parseCFDReport(raw: unknown, clientRevision: string): CFDReport {
  const result = reportSchema.parse(raw);
  if (result.validation.clientRevision !== clientRevision)
    throw new Error("Preparation revision does not match the current request.");
  const patches = new Map(result.patches.map(p => [p.id, p]));
  const unique = (items: { id: string }[]) => new Set(items.map(item => item.id)).size === items.length;
  if (!unique(result.patches) || !unique(result.objects) || !unique(result.vents) ||
      result.surface.triangles.some(t => t.some(i => i >= result.surface.verticesMm.length)) ||
      result.surface.triangles.length !== result.surface.trianglePatches.length ||
      result.surface.triangleCount !== result.surface.triangles.length ||
      result.surface.trianglePatches.some(id => !patches.has(id)) ||
      result.objects.some(o => o.triangles.some(t => t.some(i => i >= o.verticesMm.length))) ||
      result.vents.some(v => patches.get(v.patchId)?.kind !== v.role) ||
      (result.sharedBoundaryAudit &&
        (!unique(result.sharedBoundaryAudit.sources) || !unique(result.sharedBoundaryAudit.envelope) ||
          [...result.sharedBoundaryAudit.sources, ...result.sharedBoundaryAudit.envelope].some(row =>
            new Set(row.patchIds).size !== row.patchIds.length || row.patchIds.some(id => !patches.has(id))))) ||
      (result.surface.exportable && (!result.surface.closed || result.validation.errors > 0)))
    throw new Error("Preparation returned an invalid surface manifest.");
  return result;
}
