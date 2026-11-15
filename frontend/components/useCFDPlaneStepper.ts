"use client";

import { useEffect, useEffectEvent, useMemo, useRef, useState } from "react";
import type { RailwayCFDWorker, WorkerResult } from "@/lib/railwayCFDWorker";
import type { CFDWorkerJob } from "@/lib/climoptixJobs";
import { readResultData } from "@/lib/cfdResultData";
import { useCFDResult } from "./useCFDResult";

export const RESULT_AXES = ["X", "Y", "Z"] as const;
export type ResultAxis = typeof RESULT_AXES[number];
export function resultPlaneAxis(name: string): ResultAxis | undefined {
  return /slice_([xyz])_\d+/i.exec(name)?.[1].toUpperCase() as ResultAxis | undefined;
}

async function physicalPlane(file:File) {
  const loaded=await readResultData(file);
  try {
    if(loaded.volume)throw Error("Choose a sampled surface plane, not a volume.");
    const bounds=loaded.data.getBounds(),spans=[0,1,2].map(i=>bounds[i*2+1]-bounds[i*2]);
    const axis=spans.indexOf(Math.min(...spans));
    if(spans[axis]>Math.max(1,...spans)*1e-7)throw Error("This surface is not an axis-aligned sampled plane.");
    return {axis,coordinate:(bounds[axis*2]+bounds[axis*2+1])/2};
  } finally {loaded.dispose();}
}

type Artifact = WorkerResult["artifacts"][number];
type PreparedPlane = { file: File; bounds: Awaited<ReturnType<typeof physicalPlane>> };
const boundsCache = new WeakMap<File, ReturnType<typeof physicalPlane>>();
function planeBounds(file: File) {
  const existing = boundsCache.get(file);
  if (existing) return existing;
  const bounds = physicalPlane(file);
  boundsCache.set(file, bounds);
  return bounds;
}

/** Select another verified native artifact. Never translate a solved plane mesh. */
export function useCFDPlaneStepper(adapter:RailwayCFDWorker|null,job:CFDWorkerJob|undefined,current:File|undefined,onChoose:(file:File)=>void,preload=false) {
  const {result}=useCFDResult(adapter,job,!!current);
  const jobId = job?.id, revision = job?.clientRevision;
  const cache = useMemo(() => ({jobId,revision,adapter,ready:new Map<string,PreparedPlane>(),pending:new Map<string,Promise<PreparedPlane>>()}), [adapter,jobId,revision]);
  const [buffer, setBuffer] = useState<{cache:typeof cache;files:File[]}>();
  const [task, setTask] = useState<{
    adapter: RailwayCFDWorker; file: File; jobId: string; busy: boolean; error: string;
  } | null>(null);
  const activeTask = task?.adapter === adapter && task?.file === current && task?.jobId === job?.id ? task : null;
  const busy = activeTask?.busy ?? false, error = activeTask?.error ?? "";
  const pending = useRef<AbortController | null>(null);
  useEffect(() => () => pending.current?.abort(), [adapter, job?.id, current]);
  const all = result?.artifacts.filter(a => a.kind === "vtk") ?? [];
  const name = (a: typeof all[number]) => a.name?.replace(/[^a-z0-9_.-]/gi, "-") ?? `${job?.id}-${a.id}.vtk`;
  const axis = resultPlaneAxis(current?.name ?? "");
  const stack = all.filter(a => !axis || resultPlaneAxis(name(a)) === axis)
    .sort((a, b) => name(a).localeCompare(name(b), undefined, { numeric: true }));
  const index = stack.findIndex(a => name(a) === current?.name);
  const remember = (id: string, plane: PreparedPlane) => {
    if (!preload || plane.file.size > 12 * 1024**2) return;
    cache.ready.delete(id);
    cache.ready.set(id,plane);
    while (cache.ready.size > 6 || [...cache.ready.values()].reduce((size, entry)=>size + entry.file.size,0) > 24 * 1024**2) {
      cache.ready.delete(cache.ready.keys().next().value!);
    }
    setBuffer({cache,files:[...cache.ready.values()].map(entry=>entry.file)});
  };
  const prepare = async (artifact: Artifact, signal: AbortSignal) => {
    const ready = cache.ready.get(artifact.id);
    if (ready) return ready;
    const queued = cache.pending.get(artifact.id);
    if (queued) return queued;
    const load = async () => {
      if (!adapter || !job) throw new Error("Reconnect the worker to load this plane.");
      const file = await adapter.download(job,artifact,AbortSignal.any([signal,AbortSignal.timeout(120000)]));
      const bounds = await planeBounds(file);
      signal.throwIfAborted();
      const value = {file,bounds};
      remember(artifact.id,value);
      return value;
    };
    const loading = load();
    cache.pending.set(artifact.id, loading);
    try { return await loading; }
    finally { if (cache.pending.get(artifact.id) === loading) cache.pending.delete(artifact.id); }
  };
  const warmNeighbours = useEffectEvent(async (signal: AbortSignal) => {
    if (!current || index < 0) return;
    try {
      if (!cache.ready.has(stack[index].id)) {
        const bounds = await planeBounds(current);
        signal.throwIfAborted();
        remember(stack[index].id, {file:current,bounds});
      }
      await Promise.allSettled([1,-1,2,-2].flatMap(offset => {
        const artifact = stack[index + offset];
        return artifact && artifact.size <= 12 * 1024**2 ? [prepare(artifact,signal)] : [];
      }));
    } catch { /* The explicit step reports download or validation failures. */ }
  });
  useEffect(() => {
    if (!preload || !current || !result) return;
    const controller = new AbortController();
    const timer = setTimeout(() => void warmNeighbours(controller.signal), 0);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [cache,current,preload,result]);
  const choose = async (artifact: typeof all[number] | undefined, direction?: -1 | 1) => {
    // Lock before the first await; two clicks in one React render cannot download twice.
    if (!adapter || !job || !current || busy || (pending.current && !pending.current.signal.aborted) || !artifact) return;
    const controller = new AbortController(); pending.current = controller;
    const source = { adapter, file: current, jobId: job.id };
    setTask({ ...source, busy: true, error: "" });
    try {
      const {file,bounds:after} = await prepare(artifact,controller.signal);
      const before = direction ? await planeBounds(current) : null;
      controller.signal.throwIfAborted();
      if (direction && before && (before.axis !== after.axis || direction * (after.coordinate - before.coordinate) <= 1e-9))
        throw Error("No adjacent sampled plane in this direction. Choose a different plane stack; result data has not been moved.");
      onChoose(file);
    } catch (cause) {
      if (!controller.signal.aborted)
        setTask({ ...source, busy: false, error: cause instanceof Error ? cause.message : "Cannot load the adjacent plane." });
    } finally {
      if (pending.current === controller) {
        pending.current = null;
        setTask(value => value?.adapter === adapter && value.file === current && value.jobId === job.id ? { ...value, busy: false } : value);
      }
    }
  };
  const sorted = [...all].sort((a, b) => name(a).localeCompare(name(b), undefined, { numeric: true }));
  return {
    step: (direction: -1 | 1) => choose(index < 0 ? undefined : stack[index + direction], direction),
    chooseAxis: (axis: ResultAxis) => choose(sorted.find(a => resultPlaneAxis(name(a)) === axis)),
    availableAxes: RESULT_AXES.filter(axis => sorted.some(a => resultPlaneAxis(name(a)) === axis)),
    busy, error, previous: index > 0 && !busy, next: index >= 0 && index < stack.length - 1 && !busy,
    buffered: buffer?.cache === cache ? buffer.files : [],
  };
}
