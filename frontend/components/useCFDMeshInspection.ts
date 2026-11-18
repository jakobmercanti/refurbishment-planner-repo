"use client";

import { useEffect, useRef, useState } from "react";
import type { CFDJobEntry } from "./useCFDJobs";
import { jobHasCheckedMesh } from "./useCFDJobs";
import { CFDWorkerError, type RailwayCFDWorker } from "@/lib/railwayCFDWorker";
import type { CFDWorkerJob } from "@/lib/climoptixJobs";
import type { MeshAxis, MeshDisplay, MeshGeometry, MeshInspectionScene, MeshMetadata } from "@/lib/cfdMeshInspection";

export function useCFDMeshInspection({adapter, projectId, studyId, input, entry, active, hasDomain}: {
  adapter: RailwayCFDWorker | null; projectId: string; studyId?: string; input: string;
  entry?: CFDJobEntry; active: boolean; hasDomain: boolean;
}) {
  const job = entry?.job;
  const current = !!entry && entry.input === input;
  const checked = current && !!(entry?.meshChecked || jobHasCheckedMesh(job));
  const identity = JSON.stringify([adapter?.namespace, projectId, studyId, job?.id, current]);
  const [source, setSource] = useState<{identity: string; metadata?: MeshMetadata; job?: CFDWorkerJob; error?: string}>();
  const [retry, setRetry] = useState(0);
  const [inspecting, setInspecting] = useState(false);
  const [display, setDisplay] = useState<MeshDisplay>("solid");
  const [opacity, setOpacity] = useState(35);
  const [sectioning, setSectioning] = useState(false);
  const [axis, setAxis] = useState<MeshAxis>("Z");
  const [fraction, setFraction] = useState(.5);
  const [fitRequest, setFitRequest] = useState(0);
  const [view, setView] = useState<{key: string; geometry?: MeshGeometry; error?: string}>();
  const cache = useRef(new Map<string, MeshGeometry>());
  const metadata = source?.identity === identity ? source.metadata : undefined;
  const sourceJob = source?.identity === identity ? source.job : undefined;
  const error = source?.identity === identity ? source.error : undefined;
  const index = "XYZ".indexOf(axis);
  const min = metadata?.boundsMm[0][index] ?? 0, max = metadata?.boundsMm[1][index] ?? 1;
  const coordinateMm = min + (max - min) * fraction;
  const section = sectioning ? {axis, coordinateMm} : undefined;
  const key = JSON.stringify([identity, metadata?.meshId, section?.axis, section?.coordinateMm]);
  const geometry = view?.key === key ? view.geometry : undefined;
  const viewError = view?.key === key ? view.error : undefined;

  useEffect(() => {
    const buffers = cache.current;
    return () => { setInspecting(false); setView(undefined); buffers.clear(); };
  }, [identity, active]);

  useEffect(() => {
    if (!active || !adapter || !job || !hasDomain || !checked) return;
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
        if (!controller.signal.aborted) setSource({identity, error: cause instanceof Error ? cause.message : "Mesh inspection is unavailable."});
      }
    };
    void find();
    return () => controller.abort();
  }, [active, adapter, projectId, studyId, job, identity, hasDomain, checked, retry]);

  useEffect(() => {
    if (!active || !inspecting || !adapter || !metadata || !sourceJob || !current) return;
    const controller = new AbortController();
    const timer = setTimeout(() => {
      const cached = cache.current.get(key);
      if (cached) { setView({key, geometry: cached}); return; }
      void adapter.meshGeometry(sourceJob, projectId, metadata.meshId, section, controller.signal).then(geometry => {
        if (controller.signal.aborted) return;
        const bytes = (item: MeshGeometry) => item.pointsMm.byteLength + item.triangles.byteLength + item.edges.byteLength;
        cache.current.set(key, geometry);
        let size = [...cache.current.values()].reduce((sum, item) => sum + bytes(item), 0);
        while (cache.current.size > 12 || size > 64 * 1024**2) {
          const first = cache.current.keys().next().value!;
          size -= bytes(cache.current.get(first)!); cache.current.delete(first);
        }
        setView({key, geometry});
      }).catch(cause => {
        if (!controller.signal.aborted) setView({key, error: cause instanceof Error ? cause.message : "Mesh view failed."});
      });
    }, sectioning ? 100 : 0);
    return () => { clearTimeout(timer); controller.abort(); };
    // The key includes every physical section input. Material changes stay local.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, inspecting, adapter, metadata, sourceJob, current, projectId, key]);

  const enabled = active && inspecting && current && !!metadata && !error && !viewError;
  const scene: MeshInspectionScene | null = enabled ? {metadata, geometry: geometry ?? null, display, opacity, fitRequest} : null;
  const status = !hasDomain ? "Choose a CFD domain before inspecting a mesh." : !adapter?.capabilities.connected ? "Connect the CFD worker to load a retained mesh."
    : job && !current ? "This mesh belongs to an older setup. Generate a mesh for the current domain."
    : !checked && job?.phase === "Failed" ? "Meshing did not complete successfully. Review the worker log and generate a checked mesh."
    : !checked ? entry?.submitting || job && ["Queued", "Meshing", "MeshCheck"].includes(job.phase)
      ? "Meshing is in progress. Inspection becomes available after the mesh checks pass." : "Generate and check a mesh to inspect it."
    : !metadata && !error ? "Loading the checked mesh…" : enabled ? "Mesh inspection active" : "Checked mesh ready";
  return {metadata, geometry, scene, status, error: error || viewError, inspecting: enabled,
    loading: enabled && !geometry, display, setDisplay, opacity, setOpacity, sectioning, setSectioning, axis,
    setAxis: (value: MeshAxis) => { setAxis(value); setFraction(.5); }, min, max, coordinateMm,
    setCoordinate: (value: number) => setFraction(Math.max(0, Math.min(1, (value - min) / (max - min)))),
    step: (direction: number) => setFraction(value => Math.max(0, Math.min(1, value + direction / 100))),
    center: () => setFraction(.5), fit: () => setFitRequest(value => value + 1),
    toggle: () => { cache.current.clear(); setView(undefined); setInspecting(value => !value || !!viewError); },
    fail: (message: string) => { cache.current.clear(); setView({key, error: message}); },
    exit: () => { cache.current.clear(); setView(undefined); setInspecting(false); },
    retry: () => { cache.current.clear(); setSource(undefined); setView(undefined); setRetry(value => value + 1); },
  };
}
