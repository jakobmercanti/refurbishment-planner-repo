import { z } from "zod";

const n = z.number().finite(), id = z.string().regex(/^[\w:-]{1,150}$/);
const point = z.object({ x: n.min(-1e7).max(1e7), y: n.min(-1e7).max(1e7) }).strict();
/** Derived transport intent. The preparation kernel clips these measured paths to real air faces. */
export const sharedBoundaryInputsSchema = z.object({
  version: z.literal(1), captureEnvelope: z.boolean(),
  sources: z.array(z.object({
    id, name: z.string().max(200), floorId: id, roomId: id,
    kind: z.enum(["radiator", "ufh"]), watts: n.min(0).max(1e9).nullable(), enabled: z.boolean(),
    geometryValid: z.boolean(), planningAreaM2: n.min(0).max(1e9).nullable(),
    circuits: z.array(z.object({ id, spacingMm: n.min(1).max(1000), pathMm: z.array(point).min(2).max(12000) }).strict()).max(2000),
    exclusions: z.array(z.array(point).min(3).max(12000)).max(1000),
  }).strict()).max(2000),
  inventory: z.array(z.object({ floorId: id, kind: z.enum(["boiler", "pipe", "manifold", "exclusion"]), count: z.int().min(0).max(10000) }).strict()).max(80),
  unlocated: z.array(z.object({ id, name: z.string().max(200), floorId: id, roomId: id,
    kind: z.enum(["people", "equipment", "solar", "infiltration"]), valueSI: n.min(0).max(1e9), units: z.enum(["W", "m³/s"]),
  }).strict()).max(4).default([]),
}).strict().superRefine((inputs, ctx) => {
  const ids = [...inputs.sources, ...inputs.unlocated].map(source => source.id);
  if (new Set(ids).size !== ids.length)
    ctx.addIssue({ code: "custom", message: "Shared heat source IDs must be unique." });
  for (const value of inputs.unlocated) {
    if ((value.kind === "infiltration") !== (value.units === "m³/s"))
      ctx.addIssue({ code: "custom", message: "Infiltration uses m³/s; sensible gains use W.", path: ["unlocated"] });
  }
});
export type SharedBoundaryInputs = z.infer<typeof sharedBoundaryInputsSchema>;

const row = z.object({
  id: z.string(), name: z.string(), floorId: z.string(), roomId: z.string(),
  kind: z.string(), status: z.enum(["applied", "off", "outside", "incomplete", "unassigned"]),
  patchIds: z.array(z.string()).max(20000), areaM2: n.nonnegative(),
  watts: n.nullable(), appliedW: n, uWm2K: n.nullable(), rsiM2KW: n.nullable(),
  coefficientWm2K: n.nullable(), ambientK: n.nullable(), message: z.string(),
}).strict();
export const sharedBoundaryAuditSchema = z.object({
  version: z.literal(1), state: z.enum(["complete", "review"]),
  sources: z.array(row).max(2010), envelope: z.array(row).max(6000),
  inventory: sharedBoundaryInputsSchema.shape.inventory,
}).strict();
export type SharedBoundaryAudit = z.infer<typeof sharedBoundaryAuditSchema>;
