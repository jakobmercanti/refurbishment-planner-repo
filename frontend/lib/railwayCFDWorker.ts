"use client";

import { z } from "zod";
import { readBoundedResponse } from "./boundedResponse";
import { MAX_SAMPLING_PLANES } from "./climoptixDocument";
import { currentSession } from "./commercialAuth";
import { workerTelemetrySchema } from "./cfdWorkerTelemetry";
import { sliceDataSchema, sliceManifestSchema, type SliceRequest } from "./cfdSlices";
import { checkedWorkerJob, workerJobSchema, type CFDSubmission, type CFDWorkerAdapter, type CFDWorkerJob } from "./climoptixJobs";

export const workerCapabilitiesSchema = z.object({
  connected: z.boolean(), mesh: z.boolean(), run: z.boolean(), reason: z.string().max(2000), namespace: z.uuid(),
  limits: z.object({cpu: z.number().int().positive().max(2), memoryGb: z.number().positive().max(4), wallTimeMinutes: z.number().positive().max(15),
    storageGb: z.number().positive(), retentionDays: z.number().positive(), maxCells: z.number().int().positive().max(500000), concurrentJobs: z.literal(1)}),
  simulationQuota: z.object({tier:z.literal("free"),period:z.literal("lifetime"),limit:z.literal(5),
    completed:z.number().int().nonnegative(),remaining:z.number().int().min(0).max(5)})
    .refine(q=>q.remaining===Math.max(0,q.limit-q.completed),"Inconsistent simulation quota").optional(),
});
export type WorkerCapabilities = z.infer<typeof workerCapabilitiesSchema>;
export class CFDWorkerError extends Error {
  constructor(message: string, readonly status: number) {super(message);}
}
const artifactSchema = z.object({id: z.string().regex(/^(native-case|postprocessing|slice-\d+)$/), kind: z.enum(["vtk", "zip"]),
  name: z.string().max(200).optional(),
  size: z.number().int().positive().max(128*1024**2), sha256: z.string().regex(/^[a-f0-9]{64}$/)});
const resultSchema = z.object({jobId: z.uuid(), studyId: z.string(), clientRevision: z.string(),
  sourceHash: z.string().regex(/^[a-f0-9]{64}$/), configurationHash: z.string().regex(/^[a-f0-9]{64}$/),
  pressureUnit: z.literal("m2/s2"), accepted: z.boolean(), artifacts: z.array(artifactSchema).max(MAX_SAMPLING_PLANES+2),
  expiresAt: z.number().finite().optional(),
  operation:z.enum(["mesh","run"]).optional(),
  mesh:z.object({cells:z.number().int().positive(),maxNonOrthogonality:z.number().finite().optional(),
    maxSkewness:z.number().finite().optional(),maxAspectRatio:z.number().finite().optional(),minVolumeM3:z.number().finite().optional()}).optional(),
  convergence:z.object({converged:z.boolean(),target:z.number().finite().positive().optional(),
    finalInitialResiduals:z.record(z.string().max(100),z.number().finite().nonnegative()).optional()}).optional(),
  conservation:z.object({passed:z.boolean(),relativeImbalance:z.number().finite().nonnegative(),
    tolerance:z.number().finite().positive(),fluxM3S:z.record(z.string().max(200),z.number().finite())}).optional(),
});
export type WorkerResult = z.infer<typeof resultSchema>;

export async function workerRequest(base: string, path: string, signal: AbortSignal, body?: unknown, max = 1024**2): Promise<Uint8Array<ArrayBuffer>> {
  signal.throwIfAborted();
  const session = await currentSession(); signal.throwIfAborted();
  if (!session) throw new CFDWorkerError("Sign in with a verified account to use Climoptix's free simulations.", 401);
  const response = await fetch(`${base.replace(/\/$/, "")}/climoptix/worker${path}`, {
    method: body === undefined ? "GET" : "POST", cache: "no-store", credentials: "omit",
    signal: AbortSignal.any([signal, AbortSignal.timeout(max > 25 * 1024**2 ? 120000 : 25000)]),
    headers: { Authorization: `Bearer ${session.access_token}`, "Content-Type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const data = await readBoundedResponse(response, response.ok ? max : 16384, "Worker response exceeded its size bound.");
  if (!response.ok) {
    let detail = `CFD worker request failed (${response.status}).`;
    try { const parsed = JSON.parse(new TextDecoder().decode(data)); if (typeof parsed.detail === "string") detail = parsed.detail.slice(0, 2000); } catch { /* fixed fallback */ }
    throw new CFDWorkerError(detail, response.status);
  }
  return data;
}
export async function workerJSON(base: string, path: string, signal: AbortSignal, body?: unknown): Promise<unknown> {
  return JSON.parse(new TextDecoder().decode(await workerRequest(base, path, signal, body)));
}

export function railwayCFDWorker(base: string, capabilities: WorkerCapabilities) {
  const jobPath = (id: string) => `/jobs/${z.uuid().parse(id)}`;
  return {
    namespace: capabilities.namespace,
    capabilities,
    async submit(request: CFDSubmission, signal: AbortSignal) {
      return checkedWorkerJob(await workerJSON(base, "/jobs", signal, request), request);
    },
    async status(id: string, signal: AbortSignal) { return workerJobSchema.parse(await workerJSON(base, jobPath(id), signal)); },
    async list(projectId: string, signal: AbortSignal) {
      return z.array(workerJobSchema).max(100).parse(await workerJSON(base, `/jobs?projectId=${z.uuid().parse(projectId)}`, signal));
    },
    async slices(jobId:string,projectId:string,signal:AbortSignal) {
      const data=sliceManifestSchema.parse(JSON.parse(new TextDecoder().decode(await workerRequest(base,`${jobPath(jobId)}/slices?projectId=${z.uuid().parse(projectId)}`,signal,undefined,8*1024**2))));
      if(data.runId!==jobId||data.projectId!==projectId)throw new Error("Slice inventory belongs to a different run/project.");
      return data;
    },
    async sliceData(request:SliceRequest,signal:AbortSignal) {
      const data=sliceDataSchema.parse(JSON.parse(new TextDecoder().decode(await workerRequest(base,"/slice-data",signal,request,48*1024**2))));
      if(data.baseline.run!==request.baseline.runId||data.baseline.asset!==request.baseline.assetId||data.option?.run!==request.option?.runId||data.option?.asset!==request.option?.assetId||data.field!==request.field||data.component!==request.component)throw new Error("Slice data does not match the current selection.");
      if(data.deltaMode!==request.deltaMode||data.epsilon!==request.epsilon||(request.point?(!data.point||data.point.some((value,i)=>value!==request.point![i])):data.point!==undefined))throw new Error("Slice sampling settings or picked coordinates do not match this request.");
      if(!request.point&&data.size!==request.size)throw new Error("Slice sampling resolution does not match this request.");
      return data;
    },
    async cancel(job: CFDWorkerJob, signal: AbortSignal) {
      return checkedWorkerJob(await workerJSON(base, `${jobPath(job.id)}/cancel`, signal, {}), job);
    },
    async logs(job: CFDWorkerJob, cursor: number, signal: AbortSignal) {
      const data = z.object({cursor: z.number().int().min(0), nextCursor: z.number().int().min(0).max(8*1024**2), text: z.string().max(128*1024),
        telemetry:workerTelemetrySchema.optional()})
        .and(workerJobSchema).parse(await workerJSON(base, `${jobPath(job.id)}/logs?cursor=${cursor}`, signal));
      checkedWorkerJob(data, job);
      if (data.cursor !== cursor || data.nextCursor < cursor) throw new Error("Out-of-order worker telemetry.");
      return data;
    },
    async result(job: CFDWorkerJob, signal: AbortSignal) {
      const data = resultSchema.parse(await workerJSON(base, `${jobPath(job.id)}/result`, signal));
      if (data.jobId !== job.id || data.studyId !== job.studyId || data.clientRevision !== job.clientRevision)
        throw new Error("Result provenance does not match this job.");
      return data;
    },
    async download(job: CFDWorkerJob, artifact: WorkerResult["artifacts"][number], signal: AbortSignal) {
      const item = artifactSchema.parse(artifact);
      const bytes = await workerRequest(base, `${jobPath(job.id)}/artifacts/${item.id}`, signal, undefined, item.size);
      const hash = [...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))].map(b => b.toString(16).padStart(2,"0")).join("");
      signal.throwIfAborted();
      if (hash !== item.sha256 || bytes.length !== item.size) throw new Error("Downloaded artifact failed its integrity check.");
      const name = item.name?.replace(/[^a-z0-9_.-]/gi, "-") || `${job.id}-${item.id}.${item.kind === "zip" ? "zip" : "vtk"}`;
      return new File([bytes], name, {type: item.kind === "zip" ? "application/zip" : "application/octet-stream"});
    },
  } satisfies CFDWorkerAdapter & Record<string, unknown>;
}
export type RailwayCFDWorker = ReturnType<typeof railwayCFDWorker>;
