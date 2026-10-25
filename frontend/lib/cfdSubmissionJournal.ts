import { z } from "zod";
import type { CFDSubmission } from "./climoptixJobs";

const recordSchema = z.object({
  input: z.string().max(4 * 1024**2),
  request: z.object({
    contractVersion: z.literal(1), dialect: z.literal("OpenCFD-v2312"), sourceUnits: z.literal("mm"),
    submissionId: z.uuid(), operation: z.enum(["mesh", "run"]), studyId: z.string().min(1).max(200),
    clientRevision: z.string().regex(/^[a-f0-9]{64}$/),
    project: z.object({projectId:z.uuid()}).passthrough(), scenario:z.object({id:z.string()}).passthrough(),
  }).passthrough(),
});
export type PendingCFDSubmission = {input: string; request: CFDSubmission};
const prefix = "freefloorplan3d:cfd-pending:v1:";
const key = (namespace:string, projectId:string) => `${prefix}${encodeURIComponent(namespace)}:${encodeURIComponent(projectId)}`;

/** Per-tab, per-account recovery; no bearer credentials are stored here. */
export function readPendingCFD(namespace: string | undefined, projectId: string): PendingCFDSubmission[] {
  if (!namespace || typeof window === "undefined") return [];
  try {
    const raw = sessionStorage.getItem(key(namespace, projectId));
    if (!raw) return [];
    if (raw.length > 8 * 1024**2) throw new Error("Oversized journal");
    const records: unknown = JSON.parse(raw);
    if (!Array.isArray(records) || records.length > 100) throw new Error("Invalid journal");
    for (const record of records) {
      const checked = recordSchema.parse(record);
      if (checked.request.project.projectId !== projectId || checked.request.studyId !== checked.request.scenario.id)
        throw new Error("Recovery scope mismatch");
    }
    // Validate without normalizing the immutable wire payload or its digest.
    return records as PendingCFDSubmission[];
  } catch {
    throw new Error("Cannot read saved OpenFOAM submission recovery data. Do not start a replacement job until recovery is available.");
  }
}

export function savePendingCFD(namespace:string | undefined, projectId:string, pending:PendingCFDSubmission) {
  if (!namespace || typeof window === "undefined") return;
  const records = readPendingCFD(namespace, projectId).filter(item => item.request.studyId !== pending.request.studyId);
  records.push(pending);
  try {
    const raw = JSON.stringify(records);
    if (raw.length > 8 * 1024**2) throw new Error("Oversized journal");
    sessionStorage.setItem(key(namespace, projectId), raw);
  } catch {
    throw new Error("Cannot safely save OpenFOAM retry data in this tab. No job was sent; free browser storage before retrying.");
  }
}

export function removePendingCFD(namespace:string | undefined, projectId:string, studyId:string, submissionId:string) {
  if (!namespace || typeof window === "undefined") return;
  try {
    const records = readPendingCFD(namespace, projectId).filter(item => item.request.studyId !== studyId || item.request.submissionId !== submissionId);
    if (records.length) sessionStorage.setItem(key(namespace, projectId), JSON.stringify(records));
    else sessionStorage.removeItem(key(namespace, projectId));
  } catch {
    // A leftover immutable ID is safe to retry; losing it before dispatch is not.
  }
}
