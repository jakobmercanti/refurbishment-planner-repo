import { parseCFDReport, type CFDReport } from "./climoptixReport";
export type { CFDReport, CFDPatch, CFDHost, CFDObject, Vec3 } from "./climoptixReport";
import { zipSync, strToU8 } from "fflate";
import { resolveHvacScenario } from "./hvacBridge";
import {
  projectFloors,
  buildingOf,
  type FloorContent,
} from "./buildingDocument";
import {
  cfdScenarioSchema,
  type CFDScenario,
} from "./climoptixDocument";
import type { ProjectDocument } from "./projectDocument";
import {
  refinementLevel,
  refinementCell,
  samplingPlanes,
} from "./climoptixWorkflow";


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
  scenario = resolveHvacScenario(project, scenario);
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
      insulation: scenario.thermalEnvelope || scenario.sharedBoundaries
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
      heating: !scenario.sharedBoundaries && project.hvac && f.content.heatingLayout ? { ...f.content.heatingLayout, enabled: undefined, display: undefined } : undefined,
    })),
    scenario: {
      ...scenario,
      validation: undefined,
      adjointStudies: undefined,
      thermalSnapshots: undefined,
      name: undefined,
      description: undefined,
      group: undefined,
      createdAt: undefined,
      updatedAt: undefined,
      archived: undefined,
      objectGroups: undefined,
      boundaries: { ...scenario.boundaries, hideDefaultGroup: undefined },
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
  scenario = resolveHvacScenario(project, scenario);
  // This stateless public preparation endpoint does not need quotations, other
  // studies, service layouts, reference drawings or embedded symbol pictures.
  // Symbol URLs are drawing metadata, not air-domain geometry. In particular,
  // /planner-prefixed built-ins and empty URL fields fail the public resource
  // guard. Omit only these known display fields; never relax that server guard.
  const withoutSymbols = <T extends object>(value: T): T => {
    const next = { ...value } as T & Record<string, unknown>;
    for (const key of ["plan_symbol_url", "plan_symbol_data_url", "planSymbolUrl", "planSymbolDataUrl"]) delete next[key];
    return next;
  };
  const slim = (content: FloorContent): FloorContent => ({
    rooms: content.rooms.map((room) => ({
      ...room,
      finishes: undefined,
      person_mockup: undefined,
      obstacles: room.obstacles.map(withoutSymbols),
      openings: room.openings.map(opening => ({ ...withoutSymbols(opening),
        metadata: opening.metadata ? withoutSymbols(opening.metadata) : undefined })),
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
          openings: content.floorplan.openings.map(withoutSymbols),
        }
      : null,
    assetInstances: content.assetInstances,
    energyLayout: scenario.thermalEnvelope || scenario.sharedBoundaries ? content.energyLayout : undefined,
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
      hvac: undefined,
      cfdSimulationGroups: undefined,
      renderCamera: undefined,
      electricalLayout: undefined,
      heatingLayout: undefined,
      energyLayout: scenario.thermalEnvelope || scenario.sharedBoundaries ? project.energyLayout : undefined,
    };
  const body = JSON.stringify({
    project: source,
    // Grouping is local presentation metadata, not part of the solver contract.
    // Omitting it also keeps existing preparation-only workers compatible.
    scenario: { ...scenario, group: undefined, thermalSnapshots: undefined, adjointStudies: undefined, boundaries: { ...scenario.boundaries, hideDefaultGroup: undefined } },
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
  return parseCFDReport(raw, clientRevision);
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
export async function defaultCFDSetup(apiUrl: string, project: ProjectDocument, scenario: CFDScenario, signal: AbortSignal): Promise<CFDScenario> {
  const revision = await preparationRevision(preparationInput(project, scenario));
  const response = await fetch(`${apiUrl}/climoptix/default-setup`, { method: "POST", headers: { "Content-Type": "application/json" },
    body: preparationRequestBody(project, scenario, revision), signal: AbortSignal.any([signal, AbortSignal.timeout(25000)]) });
  if (!response.ok) {
    const error = await response.json().catch(() => null);
    throw new Error(typeof error?.detail === "string" ? error.detail : "Default setup is unavailable. Your existing simulation has not been changed.");
  }
  const result = cfdScenarioSchema.parse(await response.json());
  if (result.id !== scenario.id || result.sourceBuildingId !== project.projectId) throw new Error("Default setup returned a different simulation. Nothing was changed.");
  return { ...result, group: scenario.group };
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
