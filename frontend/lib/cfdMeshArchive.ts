import { z } from "zod";
import { meshMetadataSchema, readMeshGeometry, type MeshSection } from "./cfdMeshInspection";
import type { CFDWorkerJob } from "./climoptixJobs";
import { CFDWorkerError, type RailwayCFDWorker } from "./railwayCFDWorker";

async function checked(response: Response) {
  if (!response.ok) {
    const body = await response.json().catch(() => null);
    throw new CFDWorkerError(typeof body?.detail === "string" ? body.detail : "Retained mesh inspection is unavailable.", response.status);
  }
  return response;
}

/** The worker adapter authenticates, bounds and SHA-256 verifies this download. */
export async function retainedMesh(apiUrl: string, adapter: RailwayCFDWorker, job: CFDWorkerJob, projectId: string, signal: AbortSignal) {
  const result = await adapter.result(job, signal);
  if (!result.accepted) throw new Error("The retained job has not passed its checks.");
  const archive = result.artifacts.find(item => item.id === "native-case");
  if (!archive) throw new Error("No native volume mesh was retained for this job.");
  if (archive.size > 32 * 1024**2) throw new Error("Retained mesh archive exceeds the 32 MB compatibility limit. Update the worker for direct inspection.");
  const file = await adapter.download(job, archive, signal);
  const query = new URLSearchParams({projectId, jobId:job.id, studyId:job.studyId, clientRevision:job.clientRevision,
    sourceHash:result.sourceHash, configurationHash:result.configurationHash, sha256:archive.sha256});
  const response = await checked(await fetch(`${apiUrl}/climoptix/mesh-archives?${query}`, {
    method:"POST", headers:{"Content-Type":"application/zip"}, body:file, signal,
  }));
  const source = z.object({token:z.string().regex(/^[\w-]{40,100}$/), metadata:meshMetadataSchema}).parse(await response.json());
  if (source.metadata.jobId !== job.id || source.metadata.projectId !== projectId || source.metadata.studyId !== job.studyId
    || source.metadata.clientRevision !== job.clientRevision) throw new Error("Retained mesh provenance does not match this job.");
  return {metadata:source.metadata, geometry:async (section:MeshSection|undefined, signal:AbortSignal) => {
    const params = new URLSearchParams({meshId:source.metadata.meshId,
      ...(section ? {axis:section.axis, coordinateMm:String(section.coordinateMm), motion:"true"} : {})});
    const response = await checked(await fetch(`${apiUrl}/climoptix/mesh-archives/${source.token}?${params}`, {signal}));
    const length = Number(response.headers.get("Content-Length"));
    if (length > 48 * 1024**2) throw new Error("Mesh geometry exceeds 48 MB.");
    return readMeshGeometry(new Uint8Array(await response.arrayBuffer()), source.metadata.meshId, section);
  }};
}
