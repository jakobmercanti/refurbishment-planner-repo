import { z } from "zod";
import type { CFDScenario } from "./climoptixDocument";
import type { ProjectDocument } from "./projectDocument";
import {
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
  };
  submit(request: CFDSubmission, signal: AbortSignal): Promise<unknown>;
  status(jobId: string, signal: AbortSignal): Promise<unknown>;
  list?(projectId: string, signal: AbortSignal): Promise<CFDWorkerJob[]>;
}

/** Job freshness also includes Apply intent, without invalidating geometry preparation. */
export function workerInput(
  project: ProjectDocument,
  scenario: CFDScenario,
): string {
  const applied = scenario.thermalSnapshots?.[0];
  return `${preparationInput(project, scenario)}\nthermal:${applied?.caseHash ?? "none"}:${applied?.sourceRevision ?? "none"}`;
}

/** Validate a bounded, immutable handoff before any worker submission is allowed. */
export async function prepareWorkerSubmission(
  apiUrl: string,
  project: ProjectDocument,
  scenario: CFDScenario,
  operation: CFDOperation,
  signal: AbortSignal,
  submissionId: string = crypto.randomUUID(),
): Promise<CFDSubmission> {
  signal.throwIfAborted();
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
  scenario = structuredClone({ ...scenario, thermalSnapshots: undefined, adjointStudies: undefined, boundaries: { ...scenario.boundaries, hideDefaultGroup: undefined } });
  project = JSON.parse(
    preparationRequestBody(project, scenario, "0".repeat(64)),
  ).project;
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
  if (report.validation.errors || !report.surface.exportable)
    throw new Error(
      "Preflight blocked this submission. Validate the study and resolve its diagnostics.",
    );
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
