import { z } from "zod";

const n = z.number().finite();
const fraction = n.min(0).max(1);
const temperature = n.min(-100).max(200);
const text = z.string().max(2000);
const hash = z.string().regex(/^[a-f0-9]{64}$/);
const key = z.string().min(1).max(1000);
const vector = z.array(n).length(3);
export const thermalLocationSchema = z
  .object({
    name: text.default(""),
    latitude: n.min(-90).max(90).nullable().default(null),
    longitude: n.min(-180).max(180).nullable().default(null),
    timezone: z.string().max(100).default(""),
    elevationM: n.min(-500).max(9000).default(0),
    fixedUtcOffsetMinutes: n.int().min(-840).max(840).nullable().default(null),
    source: text.default(""),
  })
  .strict();
export const thermalOverrideSchema = z
  .object({
    assemblyId: z.string().max(180).nullable().default(null),
    uWm2K: n.positive().max(100).nullable().default(null),
    uIncludesFilms: z.boolean().nullable().default(null),
    rsi: n.min(0).max(10).nullable().default(null),
    rse: n.min(0).max(10).nullable().default(null),
    exposure: z
      .enum(["auto", "outdoors", "ground", "adjacent", "adiabatic"])
      .default("auto"),
    ambientC: temperature.nullable().default(null),
    alpha: fraction.nullable().default(null),
    emissivity: fraction.nullable().default(null),
    gValue: fraction.nullable().default(null),
    shadingFactor: fraction.nullable().default(null),
    incidentWm2: n.min(0).max(3000).nullable().default(null),
    externalH: n.positive().max(1000).nullable().default(null),
    longwaveWm2: n.min(-2000).max(2000).nullable().default(null),
    method: z
      .enum(["inherit", "robin", "fixedFlux", "temperature", "adiabatic"])
      .default("inherit"),
    fixedFluxWm2: n.min(-1e5).max(1e5).nullable().default(null),
    fixedTemperatureC: temperature.nullable().default(null),
    acknowledgedAssemblyRevision: z.string().max(64).default(""),
    reason: text.default(""),
    updatedAt: z.string().max(40).default(""),
  })
  .strict();
export const thermalGainSchema = z
  .object({
    id: z.string().min(1).max(150),
    name: z.string().min(1).max(120),
    kind: z
      .enum(["people", "lighting", "equipment", "other"])
      .default("equipment"),
    objectId: z.string().max(150).nullable().default(null),
    roomId: z.string().max(150).nullable().default(null),
    count: n.int().min(0).max(10000).default(1),
    powerW: n.min(0).max(1e7).default(0),
    sensibleFraction: fraction.default(1),
    operatingFraction: fraction.default(1),
    radiantFraction: fraction.default(0),
    enabled: z.boolean().default(true),
    source: text.default(""),
  })
  .strict();
export const thermalSetupSchema = z
  .object({
    schemaVersion: z.literal(1).default(1),
    thermalMode: z.literal("steady_no_hvac").default("steady_no_hvac"),
    insulationScenarios: z
      .record(key, z.string().max(150).nullable())
      .refine((v) => Object.keys(v).length <= 20)
      .default({}),
    location: thermalLocationSchema.prefault({}),
    northDeg: n.min(0).max(360).default(0),
    localDateTime: z.string().max(40).default(""),
    dstChoice: z.enum(["reject", "earlier", "later"]).default("reject"),
    weather: z
      .object({
        scenario: z
          .enum([
            "custom",
            "summerDesign",
            "winterDesign",
            "summerDaytime",
            "winterDaytime",
          ])
          .default("custom"),
        source: text.default(""),
        temperatureC: temperature.nullable().default(null),
        relativeHumidity: fraction.nullable().default(null),
        windMS: n.min(0).max(150).nullable().default(null),
        externalH: n.positive().max(1000).nullable().default(null),
        solarMode: z.enum(["none", "components", "perSurface"]).default("none"),
        forcingBasis: z.enum(["instant", "hourlyMean"]).default("instant"),
        dniWm2: n.min(0).max(2000).nullable().default(null),
        dhiWm2: n.min(0).max(2000).nullable().default(null),
        ghiWm2: n.min(0).max(2000).nullable().default(null),
        epwRecord: text.default(""),
      })
      .strict()
      .prefault({}),
    airExchange: z
      .object({
        mode: z
          .enum(["unspecified", "none", "ach", "volume", "mass", "devices"])
          .default("unspecified"),
        value: n.min(0).max(1e6).default(0),
        supplyTemperatureC: temperature.nullable().default(null),
        extractValue: n.min(0).max(1e6).nullable().default(null),
        source: text.default(""),
      })
      .strict()
      .prefault({}),
    gains: z.array(thermalGainSchema).max(2000).default([]),
    includeCFDSources: z.boolean().default(false),
    assumptionsAccepted: z.boolean().default(false),
    referenceIndoorC: temperature.default(20),
    rhoKgM3: n.positive().max(10).default(1.2),
    cpJKgK: n.positive().max(10000).default(1005),
    groundTemperatureC: temperature.nullable().default(null),
    opaqueAbsorptance: fraction.nullable().default(null),
    groundAlbedo: fraction.nullable().default(null),
    shadingFactor: fraction.default(1),
    longwaveWm2: n.min(-2000).max(2000).default(0),
    method: z.enum(["robin", "fixedFlux"]).default("robin"),
    balanceToleranceW: n.positive().max(100).default(0.01),
    overrides: z
      .record(key, thermalOverrideSchema)
      .refine((v) => Object.keys(v).length <= 6000)
      .default({}),
  })
  .strict();
const bcSchema = z
  .object({
    model: z.enum([
      "adiabatic",
      "externalRobin",
      "fixedFlux",
      "fixedTemperature",
    ]),
    rOutwardM2KW: n.nullable().default(null),
    tEqOutsideK: n.nullable().default(null),
    fluxIntoRoomWm2: n.nullable().default(null),
    temperatureK: n.nullable().default(null),
    referenceIndoorK: n.nullable().default(null),
  })
  .strict();
const thermalLayerSchema = z
  .object({
    layerId: z.string(),
    name: z.string(),
    thicknessMm: n,
    lambdaWMK: n.nullable(),
    rM2KW: n.nullable(),
    reference: z.string(),
  })
  .strict();
const thermalSurfaceSchema = z
  .object({
    surfaceId: key,
    patchId: key,
    roomId: z.string(),
    roomName: z.string(),
    floorId: z.string(),
    elementId: key,
    kind: z.string(),
    category: z.string(),
    exposure: z.enum([
      "outdoors",
      "ground",
      "adjacent",
      "internal",
      "adiabatic",
    ]),
    neighborRoomId: z.string().nullable(),
    areaM2: n.positive(),
    normal: vector,
    centroidMm: vector,
    azimuthDeg: n,
    tiltDeg: n,
    verticesMm: z.array(vector).max(50000),
    triangles: z.array(z.array(n.int().min(0)).length(3)).max(50000),
    assemblyId: z.string().nullable(),
    assemblyName: z.string(),
    assemblyRevision: z.string(),
    insulationRevision: z.string(),
    insulationAssemblyId: z.string().nullable().default(null),
    insulationAssemblyName: z.string().default("Unknown source construction"),
    insulationUWm2K: n.nullable().default(null),
    insulationRsi: n.nullable().default(null),
    insulationRse: n.nullable().default(null),
    insulationAssemblyLayers: z
      .array(thermalLayerSchema)
      .nullable()
      .default(null),
    assemblyLayers: z.array(thermalLayerSchema),
    uWm2K: n.nullable(),
    rTotalM2KW: n.nullable(),
    rsi: n.nullable(),
    rse: n.nullable(),
    source: z.string(),
    alpha: n.nullable(),
    emissivity: n.nullable(),
    gValue: n.nullable(),
    shadingFactor: n,
    ambientC: n.nullable(),
    status: z.enum([
      "valid",
      "incomplete",
      "overridden",
      "stale",
      "inapplicable",
    ]),
    warnings: z.array(z.string()),
    override: thermalOverrideSchema.nullable(),
    method: z.enum(["robin", "fixedFlux", "temperature", "adiabatic"]),
    incidentWm2: n.nullable(),
    absorbedWm2: n.nullable(),
    transmittedW: n.nullable(),
    equivalentC: n.nullable(),
    conductanceWK: n.nullable(),
    fluxWm2: n.nullable(),
    heatW: n.nullable(),
    cfdBC: bcSchema.nullable(),
  })
  .strict();
export const thermalPackageSchema = z
  .object({
    schemaVersion: z.literal(1),
    kind: z.literal("ThermalBoundaryPackage"),
    projectId: z.string(),
    domainId: z.string(),
    sourceRevision: hash,
    caseHash: hash,
    geometryHash: hash,
    constructionHash: hash,
    configurationHash: hash,
    scenario: thermalSetupSchema,
    surfaces: z.array(thermalSurfaceSchema).max(6000),
    internalSources: z.array(
      z
        .object({
          id: z.string(),
          name: z.string(),
          powerW: n,
          radiantFraction: n,
          roomId: z.string().nullable(),
          objectId: z.string().nullable(),
          source: z.string(),
          deposition: z.literal("lumped_sensible_air"),
        })
        .strict(),
    ),
    airExchange: z
      .object({
        mode: z.string(),
        volumeFlowM3S: n,
        massFlowKgS: n,
        supplyTemperatureC: n.nullable(),
      })
      .strict(),
    sun: z
      .object({
        azimuthDeg: n,
        elevationDeg: n,
        zenithDeg: n,
        instantUtc: z.string(),
        method: z.string(),
      })
      .strict()
      .nullable(),
    cardinalIrradianceWm2: z.record(z.string(), n),
    preview: z
      .object({
        modelFidelity: z.literal("lumped_steady_screening"),
        equilibriumAirTempC: n.nullable(),
        heatBalanceResidualW: n.nullable(),
        envelopeConductanceWK: n,
        airConductanceWK: n,
        totalConductanceWK: n,
        transmittedSolarW: n,
        internalGainsW: n,
        opaqueSolarEquivalentW: n,
        airExchangeW: n.nullable(),
        netAtReferenceW: n.nullable(),
      })
      .strict(),
    validation: z
      .object({
        errors: z.array(z.string()),
        warnings: z.array(z.string()),
        projectionErrors: z.array(z.string()),
        previewReady: z.boolean(),
        applyReady: z.boolean(),
        energyCompatible: z.boolean(),
      })
      .strict(),
    limitations: z.array(z.string()),
    temperatureUnits: z.literal("C display / K handoff"),
    fluxConvention: z.literal("positive into selected air domain"),
    adapter: z.literal("OpenCFD-v2312-contract-only"),
    executed: z.literal(false),
    runnable: z.literal(false),
  })
  .strict();
export const thermalSnapshotSchema = z
  .object({
    schemaVersion: z.literal(1),
    caseHash: hash,
    sourceRevision: hash,
    createdAt: z.string().max(40),
    package: thermalPackageSchema,
  })
  .strict();
export type ThermalSetup = z.infer<typeof thermalSetupSchema>;
export type ThermalOverride = z.infer<typeof thermalOverrideSchema>;
export type ThermalSurface = z.infer<typeof thermalSurfaceSchema>;
export type ThermalPackage = z.infer<typeof thermalPackageSchema>;
export type ThermalMetric = "off" | "u" | "missing" | "exposure" | "heat";
export function thermalColour(
  face: ThermalSurface,
  metric: ThermalMetric,
): string {
  if (metric === "missing")
    return face.status === "incomplete" || face.status === "stale"
      ? "#cf6262"
      : "#4b9685";
  if (metric === "heat")
    return face.heatW === null
      ? "#8995a5"
      : face.heatW > 0.01
        ? "#d98148"
        : face.heatW < -0.01
          ? "#5088ba"
          : "#69a08f";
  if (metric === "u")
    return face.uWm2K === null
      ? "#cf6262"
      : face.uWm2K <= 0.3
        ? "#4b9685"
        : face.uWm2K <= 0.7
          ? "#b9a553"
          : "#cd7655";
  return {
    outdoors: "#5a9dbb",
    ground: "#a4906f",
    adjacent: "#b093bc",
    internal: "#6c9d8c",
    adiabatic: "#8e97a3",
  }[face.exposure];
}
export function thermalCSV(report: ThermalPackage): string {
  const columns = [
    "surfaceId",
    "roomName",
    "floorId",
    "kind",
    "exposure",
    "areaM2",
    "azimuthDeg",
    "tiltDeg",
    "assemblyId",
    "source",
    "status",
    "uWm2K",
    "rTotalM2KW",
    "rsi",
    "rse",
    "ambientC",
    "equivalentC",
    "incidentWm2",
    "absorbedWm2",
    "transmittedW",
    "fluxWm2",
    "heatW",
  ] as const;
  const cell = (v: unknown) => {
    const safe =
      typeof v === "string" && /^\s*[=+\-@\t\r]/.test(v)
        ? "'" + v
        : String(v ?? "");
    return `"${safe.replaceAll('"', '""')}"`;
  };
  return [
    columns.map(cell).join(","),
    ...report.surfaces.map((f) => columns.map((c) => cell(f[c])).join(",")),
  ].join("\r\n");
}
