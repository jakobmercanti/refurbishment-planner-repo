import { z } from "zod";
import { thermalSetupSchema, thermalSnapshotSchema } from "./thermalDocument";

const id = z.string().regex(/^[\w:-]{1,150}$/),
  patchId = z.string().regex(/^[\w:.-]{1,500}$/);
const finite = z.number().finite(),
  positive = finite.gt(0).max(1e12),
  nonnegative = finite.min(0).max(1e12);
const fraction = finite.min(0).max(1),
  temperature = finite.min(150).max(1500);
const coordinate = finite.min(-1e7).max(1e7);
const cellLength = finite.min(0.01).max(1e7);
const vector = z.tuple([coordinate, coordinate, coordinate]);
const hash = z.string().regex(/^[a-f0-9]{64}$/);
export const PATCH_KINDS = [
  "wall",
  "floor",
  "ceiling",
  "door",
  "window",
  "cap",
  "supply",
  "extract",
  "object",
  "slabSide",
] as const;
export type PatchKind = (typeof PATCH_KINDS)[number];
export const flowSchema = z
  .object({
    type: z
      .enum([
        "noSlip",
        "slip",
        "velocity",
        "volumeFlow",
        "massFlow",
        "pressure",
        "opening",
        "symmetry",
      ])
      .default("noSlip"),
    value: finite.min(-1e9).max(1e9).default(0),
  })
  .strict()
  .prefault({});
const thermalSchema = z
  .object({
    type: z
      .enum(["adiabatic", "temperature", "heatFlux", "heatTransfer"])
      .default("adiabatic"),
    value: finite.min(-1e6).max(1e6).default(0),
    ambientK: temperature.default(293.15),
  })
  .strict()
  .superRefine((v, c) => {
    if (v.type === "temperature" && (v.value < 150 || v.value > 1500))
      c.addIssue({
        code: "custom",
        message: "Temperature must be 150–1500 K.",
        path: ["value"],
      });
    if (v.type === "heatTransfer" && v.value < 0)
      c.addIssue({
        code: "custom",
        message: "Heat-transfer coefficient cannot be negative.",
        path: ["value"],
      });
  })
  .prefault({});
export const boundarySchema = z
  .object({
    flow: flowSchema,
    thermal: thermalSchema,
    scalarPpm: finite.min(0).max(1e6).default(420),
    scalarType: z
      .enum(["zeroFlux", "concentration", "flux"])
      .default("zeroFlux"),
    scalarFluxM3M2S: finite.min(-1000).max(1000).default(0),
    materialLabel: z.string().max(200).default(""),
    turbulenceIntensity: fraction.default(0.05),
    turbulenceLengthM: positive.default(0.01),
    roughnessM: nonnegative.default(0),
  })
  .strict()
  .prefault({});
export type CFDBoundary = z.infer<typeof boundarySchema>;
export const boundaryCollectionSchema = z.object({
  id,
  name: z.string().trim().min(1).max(80),
  patchIds: z.array(patchId).max(20000).default([]),
  boundary: boundarySchema.nullable().default(null),
}).strict();
export type CFDBoundaryCollection = z.infer<typeof boundaryCollectionSchema>;
export const simulationGroupsSchema = z.array(z.object({
  id,
  name: z.string().trim().min(1).max(80),
}).strict()).max(100).superRefine((groups, ctx) => {
  if (new Set(groups.map(g => g.id)).size !== groups.length ||
      new Set(groups.map(g => g.name.toLowerCase())).size !== groups.length)
    ctx.addIssue({ code: "custom", message: "Simulation group IDs and names must be unique." });
});
export type CFDSimulationGroup = z.infer<typeof simulationGroupsSchema>[number];
const objectCollectionSchema = z.object({
  id, name: z.string().trim().min(1).max(80),
  memberIds: z.array(z.string().regex(/^(vent|object):[\w:-]{1,150}$/)).max(3000).default([]),
}).strict();
const objectCopySchema = z.object({ id, sourceObjectId: id, name: z.string().trim().min(1).max(120) }).strict();
export type CFDObjectCollection = z.infer<typeof objectCollectionSchema>;
const ventOptimization = z
  .object({
    locked: z.boolean().default(true),
    maxDisplacementMm: nonnegative.default(500),
    minSpacingMm: nonnegative.default(100),
    allowablePolygon: z
      .array(z.tuple([fraction, fraction]))
      .max(100)
      .default([]),
  })
  .strict()
  .prefault({});
export const ventSchema = z
  .object({
    id,
    name: z.string().trim().min(1).max(120),
    role: z.enum(["supply", "extract"]),
    shape: z.enum(["rectangle", "circle"]).default("rectangle"),
    host: z
      .object({ patchId, u: fraction.default(0.5), v: fraction.default(0.5) })
      .strict(),
    widthMm: finite.min(10).max(10000).default(300),
    heightMm: finite.min(10).max(10000).default(200),
    diameterMm: finite.min(10).max(10000).default(200),
    rotationDeg: finite.min(-360).max(360).default(0),
    edgeClearanceMm: nonnegative.default(10),
    openAreaFraction: finite.min(1e-6).max(1).default(1),
    dischargeCoefficient: finite.gt(0).max(1).default(1),
    control: z
      .enum(["volumeFlow", "massFlow", "velocity", "pressure"])
      .default("volumeFlow"),
    valueSI: finite.min(-1e9).max(1e9).default(0.05),
    temperatureK: temperature.default(293.15),
    co2Ppm: finite.min(0).max(1e6).default(420),
    turbulenceIntensity: fraction.default(0.05),
    turbulenceLengthM: positive.default(0.03),
    yawDeg: finite.min(-90).max(90).default(0),
    pitchDeg: finite.min(-90).max(90).default(0),
    group: z.string().max(100).default(""),
    recirculationPair: z.string().max(100).default(""),
    notes: z.string().max(2000).default(""),
    optimization: ventOptimization,
  })
  .strict()
  .superRefine((v, c) => {
    if (v.control !== "pressure" && v.valueSI <= 0)
      c.addIssue({
        code: "custom",
        message:
          "Use a positive flow/velocity; supply or extract determines direction.",
        path: ["valueSI"],
      });
    if (
      v.optimization.allowablePolygon.length > 0 &&
      v.optimization.allowablePolygon.length < 3
    )
      c.addIssue({
        code: "custom",
        message: "A movement region needs at least three vertices.",
      });
  });
export type CFDVent = z.infer<typeof ventSchema>;
export const assetOverrideSchema = z
  .object({
    objectId: id,
    mode: z
      .enum(["none", "solidProxy", "porousProxy", "sourceOnly"])
      .default("solidProxy"),
    heatW: nonnegative.default(0),
    co2M3S: nonnegative.default(0),
    count: z.int().min(1).max(10000).default(1),
    temperatureK: temperature.nullable().default(null),
    radiantFraction: fraction.default(0),
    schedule: z.string().max(200).default("constant"),
    notes: z.string().max(2000).default(""),
    offsetMm: vector.default([0, 0, 0]),
    refinementMm: positive.default(100),
  })
  .strict()
  .superRefine((v, c) => {
    if (v.temperatureK !== null && (v.heatW > 0 || v.mode === "sourceOnly"))
      c.addIssue({
        code: "custom",
        message:
          "Use heat power or a solid-surface temperature—not both. Source-only objects have no thermal surface.",
      });
  });
const timeSchema = z
  .object({
    startS: nonnegative.default(0),
    endS: positive.default(600),
    stepS: positive.default(0.1),
    adjustable: z.boolean().default(true),
    maxCourant: positive.default(1),
    writeIntervalS: positive.default(10),
    statisticsStartS: nonnegative.default(300),
  })
  .strict()
  .superRefine((v, c) => {
    if (
      v.endS <= v.startS ||
      v.stepS > v.endS - v.startS ||
      v.statisticsStartS < v.startS ||
      v.statisticsStartS > v.endS
    )
      c.addIssue({
        code: "custom",
        message:
          "Time limits, step and statistics start must form a valid interval.",
      });
  })
  .prefault({});
const numericsSchema = z
  .object({
    coupling: z.enum(["SIMPLE", "PIMPLE"]).default("SIMPLE"),
    gradient: z.enum(["linear", "limitedLinear"]).default("limitedLinear"),
    convection: z
      .enum(["upwind", "linearUpwind", "limitedLinear"])
      .default("upwind"),
    nonOrthogonalCorrections: z.int().min(0).max(20).default(2),
    relaxation: finite.gt(0).max(1).default(0.7),
    residualTarget: finite.gt(0).lt(1).default(1e-5),
    maxIterations: z.int().min(1).max(10000000).default(1000),
    writeEveryIterations: z.int().min(1).max(10000000).default(50),
    balanceTolerance: finite.gt(0).max(1).default(0.05),
    monitor: z
      .enum(["flowBalance", "temperature", "co2"])
      .default("flowBalance"),
  })
  .strict()
  .prefault({});
export const physicsSchema = z
  .object({
    preset: z
      .enum(["isothermal", "buoyant", "co2", "custom"])
      .default("isothermal"),
    mode: z.enum(["steady", "transient"]).default("steady"),
    energy: z.boolean().default(false),
    co2: z.boolean().default(false),
    boussinesq: z.boolean().default(false),
    turbulence: z
      .enum(["laminar", "kEpsilon", "kOmegaSST"])
      .default("kEpsilon"),
    densityKgM3: finite.min(0.01).max(100).default(1.204),
    dynamicViscosityPaS: finite.min(1e-8).max(1).default(1.81e-5),
    heatCapacityJKgK: finite.min(100).max(1e5).default(1005),
    conductivityWMK: finite.min(1e-5).max(1000).default(0.0257),
    prandtl: finite.min(0.01).max(1e4).default(0.71),
    expansionPerK: finite.min(1e-6).max(0.1).default(0.00341),
    referenceTemperatureK: temperature.default(293.15),
    referencePressurePa: finite.min(1000).max(1e7).default(101325),
    outdoorTemperatureK: temperature.default(283.15),
    humidityFraction: fraction.default(0.5),
    gravityMS2: vector.default([0, 0, -9.81]),
    initialVelocityMS: vector.default([0, 0, 0]),
    initialPressurePa: finite.min(-1e9).max(1e9).default(0),
    initialTemperatureK: temperature.default(293.15),
    initialCo2Ppm: finite.min(0).max(1e6).default(420),
    outdoorCo2Ppm: finite.min(0).max(1e6).default(420),
    initialK: nonnegative.default(0.01),
    initialEpsilon: positive.default(0.001),
    initialOmega: positive.default(1),
    time: timeSchema,
    numerics: numericsSchema,
  })
  .strict()
  .superRefine((v, c) => {
    if (v.boussinesq && (!v.energy || v.gravityMS2.every((x) => x === 0)))
      c.addIssue({
        code: "custom",
        message: "Buoyancy needs energy and nonzero gravity.",
      });
  })
  .prefault({});
const refinementSchema = z
  .object({
    id,
    name: z.string().trim().min(1).max(120),
    shape: z.enum(["box", "sphere", "object"]).default("box"),
    centerMm: vector.default([0, 0, 0]),
    sizeMm: z.tuple([positive, positive, positive]).default([1000, 1000, 1000]),
    objectId: id.nullable().default(null),
    cellMm: positive.default(50),
    level: z.int().min(0).max(10).nullable().default(null),
  })
  .strict();
const layersSchema = z
  .object({
    enabled: z.boolean().default(false),
    count: z.int().min(1).max(30).default(3),
    firstMm: positive.default(2),
    growth: finite.min(1).max(2).default(1.2),
    minThicknessMm: positive.default(0.2),
    coverage: fraction.default(0.8),
    targetYPlus: positive.default(30),
  })
  .strict()
  .prefault({});
export const meshRecipeSchema = z
  .object({
    preset: z.enum(["Draft", "Standard", "Fine", "Custom"]).default("Standard"),
    baseCellMm: cellLength.default(200),
    minCellMm: cellLength.default(25),
    maxCellMm: cellLength.default(400),
    originMm: vector.default([0, 0, 0]),
    alignmentDeg: finite.min(-360).max(360).default(0),
    targetCells: z.int().min(1).max(1e9).default(100000),
    maxCells: z.int().min(1).max(1e9).default(500000),
    geometryToleranceMm: finite.gt(0).max(1).default(0.01),
    smallFeatureMm: positive.default(5),
    snapToleranceMm: positive.default(2),
    ventCellMm: positive.default(25),
    jetCellMm: positive.default(50),
    openingCellMm: positive.default(50),
    objectCellMm: positive.default(100),
    wakeCellMm: positive.default(100),
    wallCellMm: positive.default(100),
    refinements: z.array(refinementSchema).max(200).default([]),
    layers: layersSchema,
    featureAngleDeg: finite.gt(0).lt(180).default(30),
    snapIterations: z.int().min(1).max(100).default(5),
    maxNonOrthogonality: finite.gt(0).lt(90).default(65),
    maxSkewness: positive.default(4),
    maxAspectRatio: positive.default(100),
    minVolumeM3: positive.default(1e-15),
    loadImbalance: fraction.default(0.1),
  })
  .strict()
  .superRefine((v, c) => {
    if (
      v.minCellMm > v.baseCellMm ||
      v.baseCellMm > v.maxCellMm ||
      v.targetCells > v.maxCells
    )
      c.addIssue({
        code: "custom",
        message: "Use min ≤ base ≤ max cell size and target ≤ maximum cells.",
      });
    if (new Set(v.refinements.map((r) => r.id)).size !== v.refinements.length)
      c.addIssue({ code: "custom", message: "Refinement IDs must be unique." });
  })
  .prefault({});
const resourcesSchema = z
  .object({
    cpu: z.int().min(1).max(1024).default(1),
    memoryGb: positive.default(4),
    wallTimeMinutes: z.int().min(1).max(43200).default(15),
    storageGb: positive.default(1),
    retentionDays: z.int().min(1).max(3650).default(3),
    queue: z.string().max(100).default("unassigned"),
  })
  .strict()
  .prefault({});
const outputsSchema = z
  .object({
    velocity: z.boolean().default(true),
    pressure: z.boolean().default(true),
    temperature: z.boolean().default(false),
    co2: z.boolean().default(false),
    ageOfAir: z.boolean().default(false),
    comfort: z.boolean().default(false),
    probesMm: z.array(vector).max(1000).default([]),
  })
  .strict()
  .prefault({});
const validationSchema = z
  .object({
    clientRevision: hash,
    sourceHash: hash,
    configurationHash: hash,
    checkedAt: z.iso.datetime({ offset: true }),
    errors: z.int().nonnegative(),
    warnings: z.int().nonnegative(),
  })
  .strict();
const sliceStackSchema = z
  .object({
    enabled: z.boolean().default(false),
    count: z.int().min(1).max(100).default(3),
  })
  .strict();
export const postProcessingSchema = z
  .object({
    x: sliceStackSchema.prefault({}),
    y: sliceStackSchema.prefault({}),
    z: sliceStackSchema.prefault({ enabled: true }),
    fields: z
      .array(z.enum(["U", "p", "T", "CO2"]))
      .min(1)
      .max(4)
      .refine((v) => new Set(v).size === v.length, "Fields must be unique.")
      .default(["U", "p"]),
    writeInterval: z.int().min(1).max(1000000).default(1),
    format: z.literal("vtk").default("vtk"),
  })
  .strict()
  .prefault({});
export const cfdScenarioSchema = z
  .object({
    version: z.literal(1),
    id,
    name: z.string().trim().min(1).max(120),
    description: z.string().max(2000).default(""),
    group: z.string().trim().min(1).max(80).default("General"),
    archived: z.boolean().default(false),
    createdAt: z.iso.datetime({ offset: true }),
    updatedAt: z.iso.datetime({ offset: true }),
    sourceBuildingId: id,
    seed: z
      .object({ floorId: id, roomId: id })
      .strict()
      .nullable()
      .default(null),
    vents: z.array(ventSchema).max(500).default([]),
    assetOverrides: z.array(assetOverrideSchema).max(2000).default([]),
    objectGroups: z.array(objectCollectionSchema).max(100).optional(),
    objectCopies: z.array(objectCopySchema).max(500).optional(),
    hiddenObjectIds: z.array(id).max(2000).optional(),
    boundaries: z
      .object({
        groups: z
          .partialRecord(z.enum(PATCH_KINDS), boundarySchema)
          .default({}),
        collections: z.array(boundaryCollectionSchema).max(100).default([]),
        hideDefaultGroup: z.boolean().optional(),
        patches: z
          .record(patchId, boundarySchema)
          .refine((v) => Object.keys(v).length <= 10000)
          .default({}),
      })
      .strict()
      .prefault({}),
    physics: physicsSchema,
    mesh: meshRecipeSchema,
    resources: resourcesSchema,
    outputs: outputsSchema,
    postProcessing: postProcessingSchema,
    optimization: z
      .object({
        enabled: z.literal(false).default(false),
        objective: z
          .enum(["comfort", "co2", "uniformity", "pressureLoss"])
          .default("uniformity"),
        notes: z.string().max(2000).default(""),
      })
      .strict()
      .prefault({}),
    thermalEnvelope: thermalSetupSchema.nullable().optional(),
    thermalSnapshots: z.array(thermalSnapshotSchema).max(3).optional(),
    validation: validationSchema.nullable().default(null),
  })
  .strict()
  .superRefine((s, c) => {
    const objectGroups = s.objectGroups ?? [], copies = s.objectCopies ?? [], hidden = s.hiddenObjectIds ?? [];
    const objectMembers = objectGroups.flatMap(g => g.memberIds);
    if (new Set(objectGroups.map(g => g.id)).size !== objectGroups.length ||
        new Set(objectGroups.map(g => g.name.toLowerCase())).size !== objectGroups.length || new Set(objectMembers).size !== objectMembers.length || objectMembers.length > 3000 ||
        (objectGroups.length === 100 && !objectGroups.some(g => g.id === "objects-default")) ||
        new Set(copies.map(o => o.id)).size !== copies.length || copies.some(o => copies.some(source => source.id === o.sourceObjectId)) ||
        new Set(hidden).size !== hidden.length)
      c.addIssue({ code: "custom", message: "Object groups, copies and hidden IDs must have unique valid membership; copies reference original measured objects." });
    const collections = s.boundaries.collections;
    const members = collections.flatMap(g => g.patchIds);
    if (new Set(collections.map(g => g.id)).size !== collections.length ||
        new Set(collections.map(g => g.name.toLowerCase())).size !== collections.length ||
        new Set(members).size !== members.length || members.length > 20000)
      c.addIssue({ code: "custom", message: "Boundary groups require unique IDs, names and surface membership." });
    if (collections.length === 100 && !collections.some(g => g.id === "all-surfaces"))
      c.addIssue({ code: "custom", message: "Boundary groups reserve one of 100 slots for Default surfaces." });
    if (
      new Set(s.vents.map((v) => v.id)).size !== s.vents.length ||
      new Set(s.assetOverrides.map((v) => v.objectId)).size !==
        s.assetOverrides.length
    )
      c.addIssue({
        code: "custom",
        message: "Scenario entity IDs must be unique.",
      });
  });
export type CFDScenario = z.infer<typeof cfdScenarioSchema>;
export const cfdScenariosSchema = z
  .array(cfdScenarioSchema)
  .max(100)
  .superRefine((s, c) => {
    if (new Set(s.map((v) => v.id)).size !== s.length)
      c.addIssue({ code: "custom", message: "Scenario IDs must be unique." });
  });
export function newCFDScenario(
  projectId: string,
  name = "Ventilation study",
): CFDScenario {
  const now = new Date().toISOString();
  return cfdScenarioSchema.parse({
    version: 1,
    id: crypto.randomUUID(),
    name,
    sourceBuildingId: projectId,
    createdAt: now,
    updatedAt: now,
    physics: { turbulence: "laminar" },
  });
}
export function duplicateCFDScenario(s: CFDScenario): CFDScenario {
  const now = new Date().toISOString();
  const copy = structuredClone(s);
  delete copy.thermalSnapshots;
  return {
    ...copy,
    id: crypto.randomUUID(),
    name: `${s.name.slice(0, 114)} copy`,
    createdAt: now,
    updatedAt: now,
    archived: false,
    validation: null,
  };
}
export function physicsPreset(
  preset: CFDScenario["physics"]["preset"],
): CFDScenario["physics"] {
  return physicsSchema.parse({
    preset,
    energy: preset === "buoyant" || preset === "co2",
    boussinesq: preset === "buoyant" || preset === "co2",
    co2: preset === "co2",
  });
}
export function meshPreset(
  preset: CFDScenario["mesh"]["preset"],
): CFDScenario["mesh"] {
  const base = preset === "Draft" ? 400 : preset === "Fine" ? 100 : 200;
  return meshRecipeSchema.parse({
    preset,
    baseCellMm: base,
    minCellMm: base / 8,
    maxCellMm: base * 2,
    ventCellMm: base / 8,
    jetCellMm: base / 4,
    openingCellMm: base / 4,
    objectCellMm: base / 2,
    wakeCellMm: base / 2,
    wallCellMm: base / 2,
  });
}
