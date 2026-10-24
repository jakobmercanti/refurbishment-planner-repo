import { z } from "zod";
import { zipSync, strToU8 } from "fflate";
import {
  projectFloors,
  buildingOf,
  type FloorContent,
} from "./buildingDocument";
import {
  cfdScenarioSchema,
  boundarySchema,
  PATCH_KINDS,
  type CFDScenario,
  type CFDBoundary,
  type PatchKind,
} from "./climoptixDocument";
import type { ProjectDocument } from "./projectDocument";
import {
  refinementLevel,
  refinementCell,
  samplingPlanes,
} from "./climoptixWorkflow";

export type Vec3 = [number, number, number];
export interface CFDHost {
  originMm: Vec3;
  uAxis: Vec3;
  vAxis: Vec3;
  normal: Vec3;
  widthMm: number;
  heightMm: number;
  polygonsMm: number[][][][];
}
export interface CFDPatch {
  label?: string;
  id: string;
  kind: PatchKind;
  roomId: string;
  floorId: string;
  sourceId: string;
  hostable: boolean;
  host?: CFDHost;
  normal: Vec3;
  areaM2: number;
  boundary: CFDBoundary;
  boundaryOrigin: string;
  needsReview?: boolean;
}
export interface CFDDiagnostic {
  severity: "error" | "warning" | "info";
  group: string;
  code: string;
  objectId: string | null;
  message: string;
  repair: string;
}
export interface CFDRegion {
  id: string;
  floorId: string;
  name: string;
  included: boolean;
  baseMm: number;
  verticesMm: [number, number][];
  ceilingRangeMm: [number, number];
}
export interface CFDPortal {
  id: string;
  kind: string;
  rooms: string[];
  traversed: boolean;
  reason: string;
  ringsMm: Record<string, Vec3[]>;
}
export interface CFDObject {
  id: string;
  name: string;
  roomId: string;
  floorId: string;
  mode: string;
  profile: string | null;
  heatW: number;
  co2M3S: number;
  notes: string;
  assumptions?: string[];
  verticesMm: Vec3[];
  triangles: [number, number, number][];
}
export interface CFDReport {
  schemaVersion: 1;
  kind: "ClimoptixPreparation";
  adapterVersion: number;
  units: "mm";
  state: "Draft" | "Validated";
  provider: {
    id: "preparation-only";
    status: "notConnected";
    canRun: false;
    canMesh: false;
    reason: string;
  };
  validation: NonNullable<CFDScenario["validation"]>;
  domain: {
    regions: CFDRegion[];
    includedRoomIds: string[];
    boundsMm: [Vec3, Vec3] | null;
    floorIds: string[];
    volumeM3: number;
    portals: CFDPortal[];
    slabVoids: {
      id: string;
      lower: string;
      upper: string;
      bottom: number;
      top: number;
    }[];
  };
  patches: CFDPatch[];
  diagnostics: CFDDiagnostic[];
  objects: CFDObject[];
  vents: {
    id: string;
    patchId: string;
    actualAreaM2: number;
    effectiveAreaM2: number;
    dischargeCoefficient: number;
    volumeFlowM3S: number | null;
    meanVelocityMS: number | null;
    centerMm: Vec3;
    outwardNormal: Vec3;
    jetDirection: Vec3;
    role: "supply" | "extract";
  }[];
  surface: {
    units: "mm";
    verticesMm: Vec3[];
    triangles: [number, number, number][];
    trianglePatches: string[];
    closed: boolean;
    exportable: boolean;
    badEdges: number;
    volumeM3: number;
    triangleCount: number;
    kind: "boundarySurface";
  };
  meshRecipe: {
    kind: "meshIntent";
    estimate: {
      baseCells: number;
      rangeCells: [number, number];
      memoryRangeGb: [number, number];
      disclaimer: string;
    };
    achievedQuality: null;
  };
  flowBalance: { supplyM3S: number; extractM3S: number; pressurePath: boolean };
  limitations: string[];
  caseGenerated: false;
  resultManifest: null;
}
const finite = z.number().finite(),
  vec = z.tuple([finite, finite, finite]),
  tri = z.tuple([
    z.int().nonnegative(),
    z.int().nonnegative(),
    z.int().nonnegative(),
  ]);
const reportGuard = z
  .object({
    schemaVersion: z.literal(1),
    kind: z.literal("ClimoptixPreparation"),
    adapterVersion: z.literal(1),
    units: z.literal("mm"),
    state: z.enum(["Draft", "Validated"]),
    validation: cfdScenarioSchema.shape.validation.unwrap(),
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

function thermalInsulation(content: FloorContent) {
  const e = content.energyLayout;
  return e
    ? {
        materials: e.materials,
        assemblies: e.assemblies,
        existingAssignments: e.existingAssignments,
        scenarios: e.scenarios,
        activeScenarioId: e.activeScenarioId,
      }
    : null;
}
function stable(value: unknown): string {
  return JSON.stringify(value, (_key, v: unknown) =>
    v && typeof v === "object" && !Array.isArray(v)
      ? Object.fromEntries(
          Object.entries(v)
            .filter(([, x]) => x !== undefined)
            .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)),
        )
      : v,
  );
}
/** UI staleness token; the backend independently computes authoritative SHA-256 geometry/configuration hashes. */
export function preparationInput(
  project: ProjectDocument,
  scenario: CFDScenario,
): string {
  const b = buildingOf(project);
  return stable({
    projectId: project.projectId,
    roof: b.roof,
    assets: project.assets,
    floors: projectFloors(project).map((f) => ({
      id: f.id,
      elevationMm: f.elevationMm,
      heightMm: f.heightMm,
      slabThicknessMm: f.slabThicknessMm,
      openings: f.openings,
      assetInstances: f.content.assetInstances,
      wallRuns: f.content.floorplan?.walls ?? [],
      sourceWallHeightMm: f.content.floorplan?.wallHeight,
      sourceWallThicknessMm: f.content.floorplan?.wallThickness,
      insulation: scenario.thermalEnvelope
        ? thermalInsulation(f.content)
        : undefined,
      rooms: f.content.rooms.map((r) => ({
        id: r.id,
        vertices: r.vertices,
        wall_height: r.wall_height,
        wall_thickness: r.wall_thickness,
        wall_thickness_overrides_mm: r.wall_thickness_overrides_mm,
        openings: r.openings,
        obstacles: r.obstacles,
      })),
    })),
    scenario: {
      ...scenario,
      validation: undefined,
      thermalSnapshots: undefined,
      name: undefined,
      description: undefined,
      group: undefined,
      createdAt: undefined,
      updatedAt: undefined,
      archived: undefined,
      objectGroups: undefined,
    },
  });
}
export async function preparationRevision(input: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(input),
  );
  return Array.from(new Uint8Array(digest), (b) =>
    b.toString(16).padStart(2, "0"),
  ).join("");
}
export function preparationRequestBody(
  project: ProjectDocument,
  scenario: CFDScenario,
  clientRevision: string,
): string {
  // This stateless public preparation endpoint does not need quotations, other
  // studies, service layouts, reference drawings or embedded symbol pictures.
  const slim = (content: FloorContent): FloorContent => ({
    rooms: content.rooms.map((room) => ({
      ...room,
      finishes: undefined,
      person_mockup: undefined,
      obstacles: room.obstacles.map((obj) => ({
        ...obj,
        plan_symbol_data_url: undefined,
      })),
    })),
    floorplan: content.floorplan
      ? {
          ...content.floorplan,
          annotations: [],
          measurements: [],
          dimensionOffsets: {},
          hiddenDimensions: [],
          roomFinishes: undefined,
          viewSettings: undefined,
        }
      : null,
    assetInstances: content.assetInstances,
    energyLayout: scenario.thermalEnvelope ? content.energyLayout : undefined,
  });
  const b = buildingOf(project),
    source = {
      ...project,
      ...slim(project),
      building: {
        ...b,
        floors: projectFloors(project).map((f) => ({
          ...f,
          content: f.id === b.activeFloorId ? undefined : slim(f.content),
        })),
      },
      plannerBuild: { activities: [] },
      quotes: [],
      cfdScenarios: undefined,
      cfdSimulationGroups: undefined,
      renderCamera: undefined,
      electricalLayout: undefined,
      heatingLayout: undefined,
      energyLayout: scenario.thermalEnvelope ? project.energyLayout : undefined,
    };
  const body = JSON.stringify({
    project: source,
    // Grouping is local presentation metadata, not part of the solver contract.
    // Omitting it also keeps existing preparation-only workers compatible.
    scenario: { ...scenario, group: undefined, thermalSnapshots: undefined },
    clientRevision,
  });
  if (new TextEncoder().encode(body).byteLength > 4 * 1024 * 1024)
    throw new Error(
      "This preparation exceeds 4 MB. Reduce scenario complexity or use a smaller source project.",
    );
  return body;
}
export async function openfoamSettings(
  apiUrl: string,
  project: ProjectDocument,
  scenario: CFDScenario,
  revision: string,
  signal?: AbortSignal,
): Promise<Blob> {
  const response = await fetch(`${apiUrl}/climoptix/openfoam-settings`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: preparationRequestBody(project, scenario, revision),
    signal,
  });
  if (!response.ok) {
    const error = await response.json().catch(() => null);
    throw new Error(
      typeof error?.detail === "string"
        ? error.detail
        : "OpenFOAM settings service unavailable. Your study is saved locally.",
    );
  }
  if (!response.headers.get("content-type")?.includes("application/zip"))
    throw new Error("The settings service did not return a ZIP.");
  return response.blob();
}
export async function prepareCFD(
  apiUrl: string,
  project: ProjectDocument,
  scenario: CFDScenario,
  clientRevision: string,
  signal?: AbortSignal,
): Promise<CFDReport> {
  const body = preparationRequestBody(project, scenario, clientRevision);
  const response = await fetch(`${apiUrl}/climoptix/prepare`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body,
    signal,
  });
  if (!response.ok) {
    const detail: unknown = await response.json().catch(() => null);
    throw new Error(
      detail &&
      typeof detail === "object" &&
      "detail" in detail &&
      typeof detail.detail === "string"
        ? detail.detail
        : "Climoptix preparation service is unavailable. Your scenario remains saved locally; no solver is connected.",
    );
  }
  const raw: unknown = await response.json();
  const result = reportGuard.parse(raw) as CFDReport;
  if (result.validation.clientRevision !== clientRevision)
    throw new Error("Preparation revision does not match the current request.");
  if (
    result.surface.triangles.some((t) =>
      t.some((i) => i >= result.surface.verticesMm.length),
    ) ||
    result.surface.triangles.length !== result.surface.trianglePatches.length ||
    result.surface.triangleCount !== result.surface.triangles.length ||
    result.objects.some((o) =>
      o.triangles.some((t) => t.some((i) => i >= o.verticesMm.length)),
    ) ||
    (result.surface.exportable &&
      (!result.surface.closed || result.validation.errors > 0))
  )
    throw new Error("Preparation returned an invalid surface manifest.");
  return result;
}
export function scenarioImport(input: unknown, projectId: string): CFDScenario {
  const parsed = cfdScenarioSchema.parse(input);
  return {
    ...parsed,
    id: crypto.randomUUID(),
    sourceBuildingId: projectId,
    validation: null,
    archived: false,
    updatedAt: new Date().toISOString(),
  };
}
export function boundarySurfaceSTL(
  report: CFDReport,
  currentRevision: string,
): string {
  if (
    report.validation.clientRevision !== currentRevision ||
    !report.surface.exportable ||
    !report.surface.closed ||
    report.validation.errors > 0
  )
    throw new Error(
      "Validate the current, closed geometry before exporting its surface.",
    );
  const { verticesMm, triangles } = report.surface;
  const lines = ["solid climoptix_boundary_metres"];
  for (const t of triangles) {
    const [a, b, c] = t.map((i) => verticesMm[i].map((x) => x * 0.001));
    const ab = b.map((x, i) => x - a[i]),
      ac = c.map((x, i) => x - a[i]);
    const n = ab.map(
        (_, i) =>
          ab[(i + 1) % 3] * ac[(i + 2) % 3] - ab[(i + 2) % 3] * ac[(i + 1) % 3],
      ),
      length = Math.hypot(...n);
    if (length === 0) throw new Error("Degenerate boundary triangle.");
    lines.push(
      `facet normal ${n.map((x) => x / length).join(" ")}`,
      "outer loop",
      ...[a, b, c].map((p) => `vertex ${p.join(" ")}`),
      "endloop",
      "endfacet",
    );
  }
  return [...lines, "endsolid climoptix_boundary_metres"].join("\n");
}
export function preparationPackage(
  scenario: CFDScenario,
  report: CFDReport,
  currentRevision: string,
): Blob {
  if (report.validation.clientRevision !== currentRevision)
    throw new Error(
      "Preparation is stale. Validate again before exporting a manifest.",
    );
  const entries: Record<string, Uint8Array> = {
    "summary.txt": strToU8(
      preparationSummary(scenario, report, currentRevision),
    ),
    "scenario.json": strToU8(
      JSON.stringify(cfdScenarioSchema.parse(scenario), null, 2),
    ),
    "preparation.json": strToU8(JSON.stringify(report, null, 2)),
    "README.txt": strToU8(
      "Climoptix preparation only. This is NOT a runnable OpenFOAM case or a CFD volume mesh. Source geometry is mm; the optional boundary-metres.stl is metres (right-handed X/Y plan, Z up). Review diagnostics and boundary/physics assumptions. No computed results exist.\n",
    ),
  };
  if (report.surface.exportable)
    entries["boundary-metres.stl"] = strToU8(
      boundarySurfaceSTL(report, currentRevision),
    );
  return new Blob([new Uint8Array(zipSync(entries, { level: 6 }))], {
    type: "application/zip",
  });
}
export function preparationSummary(
  scenario: CFDScenario,
  report: CFDReport,
  currentRevision: string,
): string {
  if (report.validation.clientRevision !== currentRevision)
    throw new Error(
      "Preparation is stale. Validate again before exporting a report.",
    );
  const p = scenario.physics,
    m = scenario.mesh;
  return [
    "CLIMOPTIX · PREPARATION SUMMARY",
    "No mesher, solver or optimizer is connected. No computed results exist.",
    `Study: ${scenario.name} (${scenario.id})`,
    `Checked: ${report.validation.checkedAt}`,
    `Source SHA-256: ${report.validation.sourceHash}`,
    `Configuration SHA-256: ${report.validation.configurationHash}`,
    `Provider: ${report.provider.id} · ${report.provider.status}`,
    `Preflight: ${report.validation.errors} blocking error(s), ${report.validation.warnings} warning(s)`,
    "",
    "CONNECTED DOMAIN",
    ...report.domain.regions
      .filter((r) => r.included)
      .map((r) => `${r.name} · room ${r.id} · floor ${r.floorId}`),
    `Volume: ${report.domain.volumeM3.toFixed(6)} m³${report.surface.closed ? " (closed checked skin)" : " (unverified signed volume)"}`,
    `Bounds X/Y/Z (mm): ${JSON.stringify(report.domain.boundsMm)}`,
    "",
    "DEVICES",
    ...scenario.vents.map(
      (v) =>
        `${v.name} · ${v.role} · ${v.shape} · ${v.control} ${v.valueSI} ${v.control === "volumeFlow" ? "m³/s" : v.control === "massFlow" ? "kg/s" : v.control === "velocity" ? "m/s" : "Pa gauge"} · ${v.temperatureK} K · ${v.co2Ppm} ppm · host ${v.host.patchId} U=${v.host.u} V=${v.host.v}`,
    ),
    "",
    "OBJECT TREATMENTS",
    ...report.objects.map(
      (o) =>
        `${o.name} (${o.id}) · ${o.mode} · proxy ${o.profile ?? "none"} · ${o.heatW} W · ${o.co2M3S} m³/s pure CO₂`,
    ),
    "",
    "PHYSICS / ENVIRONMENT",
    `${p.preset} · ${p.mode} · ${p.turbulence} · energy=${p.energy} · CO₂=${p.co2} · buoyancy=${p.boussinesq}`,
    `Air: ρ=${p.densityKgM3} kg/m³ · μ=${p.dynamicViscosityPaS} Pa·s · cp=${p.heatCapacityJKgK} J/kg·K · k=${p.conductivityWMK} W/m·K`,
    `Reference: ${p.referencePressurePa} Pa · ${p.referenceTemperatureK} K · gravity ${p.gravityMS2.join(", ")} m/s²`,
    `Time intent: ${p.time.startS}–${p.time.endS} s · Δt=${p.time.stepS} s · algorithm ${p.numerics.coupling}`,
    "",
    "MESH INTENT — NOT GENERATED CELLS",
    `${m.preset} · min/base/max ${m.minCellMm}/${m.baseCellMm}/${m.maxCellMm} mm · target ${m.targetCells}, maximum ${m.maxCells} cells`,
    `Layers enabled=${m.layers.enabled} · ${m.layers.count} layers · first ${m.layers.firstMm} mm`,
    ...m.refinements.map(
      (r) =>
        `${r.name} · ${r.shape} · level ${refinementLevel(m.baseCellMm, r)} · nominal ${refinementCell(m.baseCellMm, r)} mm${r.level === null ? ` (requested ${r.cellMm} mm)` : ""} · center ${r.centerMm.join(",")} mm · size ${r.sizeMm.join(",")} mm${r.objectId ? ` · object ${r.objectId}` : ""}`,
    ),
    report.meshRecipe.estimate.disclaimer,
    `Resources (metadata only): ${scenario.resources.cpu} CPU · ${scenario.resources.memoryGb} GB RAM · ${scenario.resources.wallTimeMinutes} min`,
    "",
    "SAMPLING PLANES — SAVED INTENT",
    `Fields: ${scenario.postProcessing.fields.join(", ")} · every ${scenario.postProcessing.writeInterval} field write(s)`,
    ...samplingPlanes(report.domain.boundsMm, scenario.postProcessing).map(
      (plane) =>
        `${plane.id} · point ${plane.pointMm.join(",")} mm · normal ${plane.normal.join(",")}`,
    ),
    "",
    "PATCH CONDITIONS",
    ...report.patches.map(
      (p) =>
        `${p.label ?? p.kind} (${p.id}) · ${p.areaM2.toFixed(6)} m² · normal ${p.normal.join(",")} · ${p.boundaryOrigin}${p.needsReview ? " · REVIEW SAMPLE" : ""}\n  Flow: ${p.boundary.flow.type} ${p.boundary.flow.value} · Thermal: ${p.boundary.thermal.type} ${p.boundary.thermal.value} · Scalar: ${p.boundary.scalarType} ${p.boundary.scalarPpm} ppm / ${p.boundary.scalarFluxM3M2S} m³/m²·s`,
    ),
    "",
    "DIAGNOSTICS",
    ...report.diagnostics.map(
      (d) =>
        `${d.severity.toUpperCase()} [${d.group}/${d.code}]${d.objectId ? ` (${d.objectId})` : ""}: ${d.message}\n  ${d.repair}`,
    ),
    "",
    "LIMITATIONS",
    ...report.limitations,
    "",
    "Structured inputs, units and full provenance are in scenario.json and preparation.json.",
    "An optional boundary STL is metres, X/Y plan, Z up; it is not a CFD volume mesh or runnable OpenFOAM case.",
  ].join("\n");
}
export function downloadCFD(blob: Blob, name: string): void {
  const url = URL.createObjectURL(blob),
    a = document.createElement("a");
  a.href = url;
  a.download = name.replace(/[^a-z0-9_.-]/gi, "-");
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}
