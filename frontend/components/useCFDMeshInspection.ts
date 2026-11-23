"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { CFDJobEntry } from "./useCFDJobs";
import { jobHasCheckedMesh } from "./useCFDJobs";
import { CFDWorkerError, type RailwayCFDWorker } from "@/lib/railwayCFDWorker";
import type { CFDWorkerJob } from "@/lib/climoptixJobs";
import type { MeshAxis, MeshDisplay, MeshGeometry, MeshInspectionScene, MeshMetadata } from "@/lib/cfdMeshInspection";
import { createMeshPosition, createMeshSectionView, meshSectionContains } from "@/lib/cfdMeshInspection";
import { retainedMesh } from "@/lib/cfdMeshArchive";
import { createLocalMeshSection } from "@/lib/cfdLocalMeshSection";

async function readMeshWhenReady<T>(read: () => Promise<T>, signal: AbortSignal) {
  for (let attempt = 0; ; attempt++) {
    signal.throwIfAborted();
    try { return await read(); }
    catch (cause) {
      if (!(cause instanceof CFDWorkerError) || cause.status !== 429 || attempt >= 12) throw cause;
      // An abandoned cut can briefly occupy a worker slot while it cancels.
      // Preserve the visible section, then retry this read (never a submission).
      await new Promise<void>((resolve, reject) => {
        const abort = () => { clearTimeout(timer); reject(signal.reason); };
        const timer = setTimeout(() => { signal.removeEventListener("abort", abort); resolve(); }, Math.min(1000, 250 * (attempt + 1)));
        signal.addEventListener("abort", abort, {once: true});
        if (signal.aborted) abort();
      });
    }
  }
}

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
  const [showRear, setShowRear] = useState(false);
  const [boundary, setBoundary] = useState<{identity: string; geometry: MeshGeometry}>();
  const [rearError, setRearError] = useState("");
  const [localCut, setLocalCut] = useState<{identity: string; cutter: ReturnType<typeof createLocalMeshSection>}>();
  const [axis, setAxis] = useState<MeshAxis>("Z");
  const [fraction, setFraction] = useState(.5);
  const [position] = useState(createMeshPosition);
  const [live] = useState(createMeshSectionView);
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
  const matchesView = (item: MeshGeometry) => item.meshId === metadata?.meshId && (sectioning
    ? meshSectionContains(item, axis, coordinateMm) : item.axis === null);
  const geometry = view?.identity === identity && view.geometry?.meshId === metadata?.meshId
    && view.geometry?.axis === (sectioning ? axis : null) ? view.geometry : undefined;
  const ready = !!geometry && matchesView(geometry);
  const displayedCoordinate = ready ? coordinateMm : geometry?.coordinateMm ?? coordinateMm;
  const viewError = view?.key === key ? view.error : undefined;
  const connected = !!adapter?.capabilities.connected;
  const canInspect = connected && !!metadata && !error;

  useEffect(() => {
    const buffers = cache.current;
    return () => { request.current?.abort(); request.current = null; setInspecting(false); setView(undefined); buffers.clear(); };
  }, [identity, active]);
  useEffect(() => () => { request.current?.abort(); request.current = null; }, [axis, sectioning, inspecting]);
  useEffect(() => {
    const update = () => {
      const next = position.getSnapshot();
      if (localCut?.identity === identity || request.current || !sectioning || geometry && meshSectionContains(geometry, axis, min + (max - min) * next)) return;
      setFraction(next);
    };
    // Slider updates stay inside the controls and mesh renderer. The workspace
    // only receives a new position when another exact topology interval is needed.
    update();
    return position.subscribe(update);
  }, [position, geometry, axis, min, max, sectioning, view, localCut, identity]);

  useEffect(() => {
    if (!active || !canInspect || !inspecting || !sectioning || !adapter || !metadata || !sourceJob) return;
    const controller = new AbortController();
    let cutter: ReturnType<typeof createLocalMeshSection> | undefined;
    void (async () => {
      const bytes = await readMeshWhenReady(() => archive ? archive.sectionSource(controller.signal)
        : adapter.meshSource(sourceJob, projectId, metadata.meshId, controller.signal), controller.signal);
      controller.signal.throwIfAborted();
      cutter = createLocalMeshSection(bytes, metadata.meshId, controller.signal);
      await cutter.ready;
      if (!controller.signal.aborted) {
        request.current?.abort(); request.current = null;
        setLocalCut({identity, cutter});
      }
    })().catch(() => { /* The exact server cutter remains available for older/oversized sources. */ });
    return () => { controller.abort(); cutter?.dispose(); };
  }, [active, canInspect, inspecting, sectioning, adapter, metadata, sourceJob, projectId, identity, archive]);

  useEffect(() => {
    if (!active || !inspecting || !sectioning || !metadata || !sourceJob || !adapter || localCut?.identity !== identity) return;
    const controller = new AbortController();
    let busy = false, frame = 0;
    live.set(null);
    const draw = async () => {
      if (busy || controller.signal.aborted) return;
      const coordinateMm = min + (max - min) * position.getSnapshot();
      const current = live.getSnapshot();
      if (current && meshSectionContains(current, axis, coordinateMm)) return;
      busy = true;
      try {
        let geometry: MeshGeometry;
        try { geometry = await localCut.cutter.cut({axis, coordinateMm}, controller.signal); }
        catch {
          controller.signal.throwIfAborted();
          geometry = await readMeshWhenReady(() => archive ? archive.geometry({axis, coordinateMm}, controller.signal)
            : adapter.meshGeometry(sourceJob, projectId, metadata.meshId, {axis, coordinateMm}, controller.signal), controller.signal);
        }
        if (!controller.signal.aborted) live.set(geometry);
      } catch (cause) {
        if (!controller.signal.aborted) {
          setInspecting(false);
          setView({identity, key, error: cause instanceof Error ? cause.message : "Mesh section unavailable."});
        }
      } finally {
        busy = false;
        // Coalesce movement during a calculation to ONE newest cut. This path
        // updates only subscribers in the controls and 3D mesh, never the workspace.
        if (!controller.signal.aborted && coordinateMm !== min + (max - min) * position.getSnapshot())
          frame = requestAnimationFrame(() => void draw());
      }
    };
    const unsubscribe = position.subscribe(() => void draw());
    void draw();
    return () => { controller.abort(); cancelAnimationFrame(frame); unsubscribe(); live.set(null); };
    // Position is read from the store; its changes must not recreate this driver.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, inspecting, sectioning, metadata, sourceJob, adapter, localCut, identity, min, max, axis, position, live, archive, projectId]);

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
    if (!active || !canInspect || !inspecting || !adapter || !metadata || !sourceJob || ready || request.current || sectioning && localCut?.identity === identity) return;
    const controller = new AbortController();
    request.current = controller;
    // One request in flight. A drag replaces the next requested cut rather than
    // repeatedly aborting CPU work before ANY new section can finish.
    setTimeout(() => {
      if (controller.signal.aborted) return;
      const cached = cache.current.get(key) ?? [...cache.current.values()].find(matchesView);
      if (cached) {
        cache.current.delete(key); cache.current.set(key, cached);
        request.current = null; setView({identity, key, geometry: cached}); return;
      }
      void readMeshWhenReady(async () => {
        return archive ? archive.geometry(section, controller.signal)
          : adapter.meshGeometry(sourceJob, projectId, metadata.meshId, section, controller.signal);
      }, controller.signal).then(geometry => {
        if (controller.signal.aborted) return;
        const bytes = (item: MeshGeometry) => item.pointsMm.byteLength + item.triangles.byteLength + item.edges.byteLength + (item.motion?.derivatives.byteLength ?? 0);
        cache.current.set(key, geometry);
        let size = [...cache.current.values()].reduce((sum, item) => sum + bytes(item), 0);
        while (cache.current.size > 12 || size > 64 * 1024**2) {
          const first = cache.current.keys().next().value!;
          size -= bytes(cache.current.get(first)!); cache.current.delete(first);
        }
        request.current = null; setView({identity, key, geometry});
      }).catch(cause => {
        if (!controller.signal.aborted) {
          request.current = null;
          cache.current.clear(); setInspecting(false);
          setView({identity, key, error: cause instanceof Error ? cause.message : "Mesh view failed."});
        }
      });
    }, sectioning ? 16 : 0);
    // The key includes every physical section input. Material changes stay local.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, canInspect, inspecting, adapter, metadata, sourceJob, projectId, identity, key, archive, ready, view, localCut]);

  useEffect(() => {
    if (!active || !inspecting || !sectioning || !showRear || !adapter || !metadata || !sourceJob) return;
    if (boundary?.identity === identity && boundary.geometry.meshId === metadata.meshId) return;
    const controller = new AbortController();
    void readMeshWhenReady(() => archive ? archive.geometry(undefined, controller.signal)
      : adapter.meshGeometry(sourceJob, projectId, metadata.meshId, undefined, controller.signal), controller.signal).then(geometry => {
      if (!controller.signal.aborted) { setRearError(""); setBoundary({identity, geometry}); }
    }).catch(cause => {
      if (!controller.signal.aborted) setRearError(cause instanceof Error ? cause.message : "Rear mesh unavailable.");
    });
    return () => controller.abort();
  }, [active, inspecting, sectioning, showRear, adapter, metadata, sourceJob, projectId, identity, archive, boundary]);

  const enabled = active && inspecting && canInspect && !viewError;
  const scene: MeshInspectionScene | null = enabled ? {metadata, geometry: geometry ?? null, display, opacity, fitRequest,
    position, live, section: sectioning ? {axis, min, max} : null,
    coordinateMm: displayedCoordinate, rearGeometry: sectioning && showRear && boundary?.identity === identity
      && boundary.geometry.meshId === metadata.meshId ? boundary.geometry : null} : null;
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
    loading: enabled && !ready, displayedCoordinate, display, setDisplay, opacity, setOpacity, sectioning,
    position, live, showRear, setShowRear: (value: boolean) => { setRearError(""); setShowRear(value); }, rearError,
    setSectioning: (value: boolean) => { if (value !== sectioning) { request.current?.abort(); setSectioning(value); } }, axis,
    setAxis: (value: MeshAxis) => { if (value !== axis) { request.current?.abort(); setAxis(value); position.set(.5); setFraction(.5); } }, min, max, coordinateMm,
    setCoordinate: (value: number) => {
      if (!Number.isFinite(value)) return;
      const next = Math.max(0, Math.min(1, (value - min) / (max - min)));
      position.set(next);
    },
    step: (direction: number) => {
      position.set(position.getSnapshot() + direction / 100);
    },
    center: () => position.set(.5),
    fit: () => setFitRequest(value => value + 1),
    toggle: () => { request.current?.abort(); cache.current.clear(); setView(undefined); setInspecting(value => !value); },
    fail: (message: string) => { request.current?.abort(); cache.current.clear(); setInspecting(false); setView({identity, key, error: message}); },
    exit: () => { request.current?.abort(); cache.current.clear(); setView(undefined); setInspecting(false); },
    retry: () => { request.current?.abort(); cache.current.clear(); setInspecting(false); setSource(undefined); setView(undefined); setRetry(value => value + 1); },
  };
}
