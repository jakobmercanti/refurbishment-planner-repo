import { z } from "zod";
import { resolveHvacScenario, requiresHvacThermalExecution } from "./hvacBridge";
import type { CFDBoundary, CFDScenario } from "./climoptixDocument";
import type { ProjectDocument } from "./projectDocument";
import {
  type CFDReport,
  preparationInput,
  preparationRevision,
  preparationRequestBody,
  prepareCFD,
} from "./climoptix";

export const workerJobSchema = z.object({
  id: z.string().min(1).max(200),
  studyId: z.string().min(1),
  clientRevision: z.string().regex(/^[a-f0-9]{64}$/),
  phase: z.enum([
    "Queued",
    "Meshing",
    "MeshCheck",
    "Running",
    "Postprocess",
    "Completed",
    "Failed",
    "Cancelled",
    "Stale",
  ]),
  // Worker-reported completion of the CURRENT phase; null means unknown, not zero.
  progress: z.number().finite().min(0).max(100).nullable(),
  operation: z.enum(["mesh", "run"]).optional(),
  progressBasis: z.enum(["steps", "iterationBudget"]).optional(),
  message: z.string().max(2000).default(""),
  createdAt: z.number().finite().optional(),
  name: z.string().max(200).optional(),
  projectId: z.string().optional(),
});
export type CFDWorkerJob = z.infer<typeof workerJobSchema>;
export type CFDOperation = "mesh" | "run";
export interface CFDSubmission {
  contractVersion: 1;
  dialect: "OpenCFD-v2312";
  sourceUnits: "mm";
  /** The adapter must deduplicate retries with this ID before creating a job. */
  submissionId: string;
  operation: CFDOperation;
  studyId: string;
  clientRevision: string;
  sourceHash: string;
  configurationHash: string;
  /** Applied intent only. A worker must recompute and match these hashes, never execute a saved preview. */
  thermalApplication: {
    caseHash: string;
    sourceRevision: string;
    createdAt: string;
  } | null;
  project: unknown;
  scenario: CFDScenario;
}

/** The only worker integration point. No HTTP endpoint or solver is assumed. */
export interface CFDWorkerAdapter {
  readonly namespace?: string;
  readonly capabilities: {
    connected: boolean;
    mesh: boolean;
    run: boolean;
    reason: string;
    simulationQuota?: { remaining: number };
  };
  configurationIssue?(scenario: CFDScenario): string | undefined;
  reportIssue?(report: CFDReport): string | undefined;
  submit(request: CFDSubmission, signal: AbortSignal): Promise<unknown>;
  status(jobId: string, signal: AbortSignal): Promise<unknown>;
  list?(projectId: string, signal: AbortSignal): Promise<CFDWorkerJob[]>;
  cancel?(job: CFDWorkerJob, signal: AbortSignal): Promise<unknown>;
  clearResults?(projectId: string, studyIds: string[], signal: AbortSignal): Promise<void>;
}

export function simulationLimitReached(adapter: CFDWorkerAdapter | null): boolean {
  return adapter?.capabilities.simulationQuota?.remaining === 0;
}

export function workerConfigurationIssue(project: ProjectDocument, scenario: CFDScenario, adapter: CFDWorkerAdapter | null, operation: CFDOperation = "run") {
  if (operation === "run" && requiresHvacThermalExecution(project, scenario))
    return "Shared HVAC thermal execution is not connected. Export the boundary package for a thermal-capable solver. The native worker runs isothermal airflow.";
  return adapter?.configurationIssue?.(resolveHvacScenario(project, scenario));
}

/** Job freshness also includes Apply intent, without invalidating geometry preparation. */
export function workerInput(
  project: ProjectDocument,
  scenario: CFDScenario,
): string {
  const applied = scenario.thermalSnapshots?.[0];
  return `${preparationInput(project, scenario)}\nthermal:${applied?.caseHash ?? "none"}:${applied?.sourceRevision ?? "none"}`;
}

function nativeBoundary(boundary: CFDBoundary): CFDBoundary {
  return boundary.thermal.sourceFluxWm2 === 0
    ? { ...boundary, thermal: { ...boundary.thermal, sourceFluxWm2: undefined } }
    : boundary;
}

function nativeWorkerSource(project: ProjectDocument, scenario: CFDScenario) {
  const { boundaries } = scenario;
  const detached = structuredClone({
    ...scenario,
    // Sun exposure is a separate thermal preview, not a native airflow input.
    // Omit the whole optional preview contract so older strict workers accept
    // the same bounded source used for preflight and provenance hashes.
    // Applied thermal intent and actual thermal boundaries remain guarded.
    thermalEnvelope: undefined,
    thermalSnapshots: undefined,
    adjointStudies: undefined,
    sharedBoundaries: scenario.sharedBoundaries ?? undefined,
    boundaries: {
      groups: Object.fromEntries(Object.entries(boundaries.groups).map(([kind, boundary]) => [kind, nativeBoundary(boundary)])),
      patches: Object.fromEntries(Object.entries(boundaries.patches).map(([id, boundary]) => [id, nativeBoundary(boundary)])),
      collections: boundaries.collections.map(group => group.boundary ? { ...group, boundary: nativeBoundary(group.boundary) } : group),
    },
  });
  return { project: JSON.parse(preparationRequestBody(project, detached, "0".repeat(64))).project as ProjectDocument, scenario: detached };
}

export function workerClientRevision(project: ProjectDocument, scenario: CFDScenario) {
  const source = nativeWorkerSource(project, resolveHvacScenario(project, scenario));
  return preparationRevision(preparationInput(source.project, source.scenario));
}

/** Validate a bounded, immutable handoff before any worker submission is allowed. */
export async function prepareWorkerSubmission(
  apiUrl: string,
  project: ProjectDocument,
  scenario: CFDScenario,
  operation: CFDOperation,
  signal: AbortSignal,
  submissionId: string = crypto.randomUUID(),
  adapter: CFDWorkerAdapter | null = null,
): Promise<CFDSubmission> {
  signal.throwIfAborted();
  const configurationIssue = workerConfigurationIssue(project, scenario, adapter, operation);
  if (configurationIssue) throw new Error(configurationIssue);
  scenario = resolveHvacScenario(project, scenario);
  const applied = scenario.thermalSnapshots?.[0];
  const thermalApplication = applied
    ? {
        caseHash: applied.caseHash,
        sourceRevision: applied.sourceRevision,
        createdAt: applied.createdAt,
      }
    : null;
  // Detach only the bounded solver source, not unrelated studies or thermal histories.
  // Do this before the first await, including when a caller mutates its objects.
  const source = nativeWorkerSource(project, scenario);
  project = source.project;
  scenario = source.scenario;
  const clientRevision = await preparationRevision(
    preparationInput(project, scenario),
  );
  signal.throwIfAborted();
  const report = await prepareCFD(
    apiUrl,
    project,
    scenario,
    clientRevision,
    signal,
  );
  signal.throwIfAborted();
  if (report.validation.errors || !report.surface.exportable) {
    const issue = report.diagnostics.find(diagnostic => diagnostic.severity === "error");
    throw new Error("Preflight blocked this submission. " + (issue?.message ?? "Review the geometry checks."));
  }
  const reportIssue = adapter?.reportIssue?.(report);
  if (reportIssue) throw new Error(reportIssue);
  return {
    contractVersion: 1,
    dialect: "OpenCFD-v2312",
    sourceUnits: "mm",
    submissionId,
    operation,
    studyId: scenario.id,
    clientRevision,
    sourceHash: report.validation.sourceHash,
    configurationHash: report.validation.configurationHash,
    thermalApplication,
    project,
    scenario,
  };
}

export const terminalJob = (job: CFDWorkerJob) =>
  ["Completed", "Failed", "Cancelled", "Stale"].includes(job.phase);

/** A checked mesh is not a converged baseline flow run; older unknown jobs fail closed. */
export function completedRunReference(entry:{input:string;job?:CFDWorkerJob;operation?:CFDOperation}|undefined,input:string):string|null {
  const job=entry?.job;
  return entry?.input===input&&job?.phase==="Completed"&&(job.operation??entry.operation)==="run"&&z.uuid().safeParse(job.id).success?job.id:null;
}

/** Reject cross-study, stale and mismatched worker responses before showing progress. */
export function checkedWorkerJob(
  raw: unknown,
  expected: Pick<CFDWorkerJob, "studyId" | "clientRevision"> & { id?: string },
): CFDWorkerJob {
  const job = workerJobSchema.parse(raw);
  if (
    job.studyId !== expected.studyId ||
    job.clientRevision !== expected.clientRevision ||
    (expected.id && job.id !== expected.id)
  ) {
    throw new Error(
      "The worker returned a job for a different study or setup revision.",
    );
  }
  return job;
}
