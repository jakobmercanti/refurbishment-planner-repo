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
  message: z.string().max(2000).default(""),
});
export type CFDWorkerJob = z.infer<typeof workerJobSchema>;
export type CFDOperation = "mesh" | "run";
export interface CFDSubmission {
  operation: CFDOperation;
  studyId: string;
  clientRevision: string;
  sourceHash: string;
  configurationHash: string;
  project: unknown;
  scenario: CFDScenario;
}

/** The only worker integration point. No HTTP endpoint or solver is assumed. */
export interface CFDWorkerAdapter {
  readonly capabilities: {
    connected: boolean;
    mesh: boolean;
    run: boolean;
    reason: string;
  };
  submit(request: CFDSubmission, signal: AbortSignal): Promise<unknown>;
  status(jobId: string, signal: AbortSignal): Promise<unknown>;
}

/** Validate a bounded, immutable handoff before any worker submission is allowed. */
export async function prepareWorkerSubmission(
  apiUrl: string,
  project: ProjectDocument,
  scenario: CFDScenario,
  operation: CFDOperation,
  signal: AbortSignal,
): Promise<CFDSubmission> {
  signal.throwIfAborted();
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
  if (report.validation.errors)
    throw new Error(
      "Preflight blocked this submission. Validate the study and resolve its diagnostics.",
    );
  return {
    operation,
    studyId: scenario.id,
    clientRevision,
    sourceHash: report.validation.sourceHash,
    configurationHash: report.validation.configurationHash,
    project: JSON.parse(
      preparationRequestBody(project, scenario, clientRevision),
    ).project,
    scenario: structuredClone(scenario),
  };
}

export const terminalJob = (job: CFDWorkerJob) =>
  ["Completed", "Failed", "Cancelled", "Stale"].includes(job.phase);

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
