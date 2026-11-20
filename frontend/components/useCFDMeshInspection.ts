"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { CFDJobEntry } from "./useCFDJobs";
import { jobHasCheckedMesh } from "./useCFDJobs";
import { CFDWorkerError, type RailwayCFDWorker } from "@/lib/railwayCFDWorker";
import type { CFDWorkerJob } from "@/lib/climoptixJobs";
import type { MeshAxis, MeshDisplay, MeshGeometry, MeshInspectionScene, MeshMetadata } from "@/lib/cfdMeshInspection";
import { retainedMesh } from "@/lib/cfdMeshArchive";

export function useCFDMeshInspection({adapter, apiUrl, projectId, studyId, input, entry, active, hasDomain}: {
  apiUrl: string;
  adapter: RailwayCFDWorker | null; projectId: string; studyId?: string; input: string;
  entry?: CFDJobEntry; active: boolean; hasDomain: boolean;
}) {
  const selectedJob = entry?.job;
  const jobId = selectedJob?.id, jobRevision = selectedJob?.clientRevision, jobPhase = selectedJob?.phase;
  const jobStudy = selectedJob?.studyId;
  // Progress polling does not change the immutable mesh source.
  const job = useMemo<CFDWorkerJob | undefined>(() => jobId && jobRevision && jobPhase && jobStudy
    ? {id: jobId, clientRevision: jobRevision, phase: jobPhase, studyId: jobStudy, progress: null, message: ""} : undefined,
  [jobId, jobRevision, jobPhase, jobStudy]);
  const current = !!entry && entry.input === input;
  const checked = !!(entry?.meshChecked || jobHasCheckedMesh(job));
  const identity = JSON.stringify([adapter?.namespace, apiUrl, projectId, studyId, jobId, jobRevision]);
  const [source, setSource] = useState<{identity: string; metadata?: MeshMetadata; job?: CFDWorkerJob; error?: string;
    archive?: Awaited<ReturnType<typeof retainedMesh>>}>();
  const [retry, setRetry] = useState(0);
  const [inspecting, setInspecting] = useState(false);
  const [display, setDisplay] = useState<MeshDisplay>("solid");
  const [opacity, setOpacity] = useState(35);
  const [sectioning, setSectioning] = useState(false);
  const [axis, setAxis] = useState<MeshAxis>("Z");
  const [fraction, setFraction] = useState(.5);
  const [fitRequest, setFitRequest] = useState(0);
  const [view, setView] = useState<{identity: string; key: string; geometry?: MeshGeometry; error?: string}>();
  const request = useRef<AbortController | null>(null);
  const cache = useRef(new Map<string, MeshGeometry>());
  const metadata = checked && source?.identity === identity ? source.metadata : undefined;
  const archive = source?.identity === identity ? source.archive : undefined;
  const sourceJob = source?.identity === identity ? source.job : undefined;
  const error = source?.identity === identity ? source.error : undefined;
  const index = "XYZ".indexOf(axis);
  const min = metadata?.boundsMm[0][index] ?? 0, max = metadata?.boundsMm[1][index] ?? 1;
  const coordinateMm = min + (max - min) * fraction;
  const section = sectioning ? {axis, coordinateMm} : undefined;
  const key = JSON.stringify([identity, metadata?.meshId, section?.axis, section?.coordinateMm]);
  // Keep the last section on the SAME axis visible while its replacement loads.
  // A different mesh, source, axis or full/section mode can never reuse it.
  const geometry = view?.identity === identity && view.geometry?.meshId === metadata?.meshId
    && view.geometry?.axis === (sectioning ? axis : null) ? view.geometry : undefined;
  const viewError = view?.key === key ? view.error : undefined;
  const connected = !!adapter?.capabilities.connected;
  const canInspect = connected && !!metadata && !error;

  useEffect(() => {
    const buffers = cache.current;
    return () => { request.current?.abort(); setInspecting(false); setView(undefined); buffers.clear(); };
  }, [identity, active]);

  useEffect(() => {
    if (!active || !connected || !adapter || !job || !checked) return;
    const controller = new AbortController();
    const find = async () => {
      try {
        const read = async (candidate: CFDWorkerJob) => {
          try {
            const metadata = await adapter.mesh(candidate, projectId, controller.signal);
            if (!controller.signal.aborted) setSource(previous => previous?.identity === identity && previous.metadata?.meshId === metadata.meshId
              && previous.job?.id === candidate.id ? previous : {identity, metadata, job: candidate});
            return true;
          } catch (cause) {
            if (controller.signal.aborted) return true;
            if (!(cause instanceof CFDWorkerError) || ![404, 409].includes(cause.status)) throw cause;
            try {
              const archive = await retainedMesh(apiUrl, adapter, candidate, projectId, controller.signal);
              if (!controller.signal.aborted) setSource({identity, metadata:archive.metadata, job:candidate, archive});
              return true;
            } catch (archiveError) {
              if (controller.signal.aborted) return true;
              if (!(archiveError instanceof CFDWorkerError) || ![404, 409].includes(archiveError.status)) throw archiveError;
            }
            return false;
          }
        };
        if (await read(job)) return;
        const jobs = await adapter.list(projectId, controller.signal);
        for (const candidate of jobs.filter(item => item.id !== job.id && item.studyId === studyId
          && item.clientRevision === job.clientRevision && ["Running", "Postprocess", "Completed", "Failed", "Cancelled"].includes(item.phase))) {
          if (await read(candidate)) return;
        }
        throw new Error("The checked mesh is not retained on this worker. Generate a mesh to inspect it.");
      } catch (cause) {
        if (!controller.signal.aborted) {
          request.current?.abort(); cache.current.clear(); setInspecting(false); setView(undefined);
          setSource({identity, error: cause instanceof Error ? cause.message : "Mesh inspection is unavailable."});
        }
      }
    };
    void find();
    return () => controller.abort();
  }, [active, connected, adapter, apiUrl, projectId, studyId, job, identity, checked, retry]);

  useEffect(() => {
    if (!active || !canInspect || !inspecting || !adapter || !metadata || !sourceJob) return;
    const controller = new AbortController();
    request.current = controller;
    const timer = setTimeout(() => {
      const cached = cache.current.get(key);
      if (cached) {
        cache.current.delete(key); cache.current.set(key, cached);
        setView({identity, key, geometry: cached}); return;
      }
      void (archive ? archive.geometry(section, controller.signal)
        : adapter.meshGeometry(sourceJob, projectId, metadata.meshId, section, controller.signal)).then(geometry => {
        if (controller.signal.aborted) return;
        const bytes = (item: MeshGeometry) => item.pointsMm.byteLength + item.triangles.byteLength + item.edges.byteLength;
        cache.current.set(key, geometry);
        let size = [...cache.current.values()].reduce((sum, item) => sum + bytes(item), 0);
        while (cache.current.size > 12 || size > 64 * 1024**2) {
          const first = cache.current.keys().next().value!;
          size -= bytes(cache.current.get(first)!); cache.current.delete(first);
        }
        setView({identity, key, geometry});
      }).catch(cause => {
        if (!controller.signal.aborted) {
          cache.current.clear(); setInspecting(false);
          setView({identity, key, error: cause instanceof Error ? cause.message : "Mesh view failed."});
        }
      });
    }, sectioning ? 100 : 0);
    return () => { clearTimeout(timer); controller.abort(); };
    // The key includes every physical section input. Material changes stay local.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, canInspect, inspecting, adapter, metadata, sourceJob, projectId, identity, key, archive]);

  const enabled = active && inspecting && canInspect && !viewError;
  const scene: MeshInspectionScene | null = enabled ? {metadata, geometry: geometry ?? null, display, opacity, fitRequest} : null;
  const meshing = !!entry?.submitting || !!job && ["Queued", "Meshing", "MeshCheck"].includes(job.phase);
  const status = !hasDomain && !checked ? "Choose a CFD domain." : !connected ? "CFD worker unavailable."
    : !checked && job?.phase === "Failed" ? "Meshing failed."
    : !checked ? meshing ? "Meshing in progress…" : "No checked mesh available."
    : error || viewError ? "Mesh inspection unavailable." : !metadata ? "Loading checked mesh…"
    : enabled ? "Mesh inspection active" : !current ? "Checked mesh ready · earlier setup" : "Checked mesh ready";
  const guidance = !hasDomain && !checked ? "Open Mesh setup and choose the domain to mesh."
    : !connected ? "The CFD worker cannot currently be reached. Reconnect and retry; opening inspection never submits a job."
    : job && !current ? "This checked mesh belongs to the submitted setup. Inspection uses its original coordinates, without mixing in the current building. It does not change the simulation or imply that later edits have been meshed."
    : !checked ? meshing ? "Inspection becomes available when the current mesh checks pass."
      : "Open Mesh setup to generate and check the volume mesh. If meshing failed, review its worker log before retrying."
    : "Inspect mesh opens a temporary mesh-only view. Exit inspection restores the previous scene and camera. Escape also exits.";
  return {metadata, geometry, scene, status, guidance, historical:!!job && !current, canInspect, error: error || viewError, inspecting: enabled,
    loading: enabled && view?.key !== key, display, setDisplay, opacity, setOpacity, sectioning,
    setSectioning: (value: boolean) => { if (value !== sectioning) { request.current?.abort(); setSectioning(value); } }, axis,
    setAxis: (value: MeshAxis) => { if (value !== axis) { request.current?.abort(); setAxis(value); setFraction(.5); } }, min, max, coordinateMm,
    setCoordinate: (value: number) => {
      if (!Number.isFinite(value)) return;
      const next = Math.max(0, Math.min(1, (value - min) / (max - min)));
      if (next !== fraction) { request.current?.abort(); setFraction(next); }
    },
    step: (direction: number) => {
      if (direction < 0 && fraction <= 0 || direction > 0 && fraction >= 1) return;
      request.current?.abort(); setFraction(value => Math.max(0, Math.min(1, value + direction / 100)));
    },
    center: () => { if (fraction !== .5) { request.current?.abort(); setFraction(.5); } },
    fit: () => setFitRequest(value => value + 1),
    toggle: () => { request.current?.abort(); cache.current.clear(); setView(undefined); setInspecting(value => !value); },
    fail: (message: string) => { request.current?.abort(); cache.current.clear(); setInspecting(false); setView({identity, key, error: message}); },
    exit: () => { request.current?.abort(); cache.current.clear(); setView(undefined); setInspecting(false); },
    retry: () => { request.current?.abort(); cache.current.clear(); setInspecting(false); setSource(undefined); setView(undefined); setRetry(value => value + 1); },
  };
}
