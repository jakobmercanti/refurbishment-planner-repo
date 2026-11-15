"use client";

import { useEffect, useEffectEvent, useState } from "react";
import { readResultData } from "@/lib/cfdResultData";
import type { CFDWorkerJob } from "@/lib/climoptixJobs";
import type { RailwayCFDWorker, WorkerResult } from "@/lib/railwayCFDWorker";

type Range = [number, number];
const fileRanges = new WeakMap<File, Promise<Map<string, Range>>>();

function readRanges(file: File) {
  const cached = fileRanges.get(file);
  if (cached) return cached;
  const pending = readResultData(file).then(loaded => {
    try {
      const ranges = new Map(loaded.fields.map(field => [field.key, field.range]));
      for (const field of loaded.fields) {
        if (field.name !== "U" || field.components !== 3) continue;
        ["Ux", "Uy", "Uz"].forEach((name, axis) => {
          const key = `${field.cell ? "cell" : "point"}:${name}`;
          if (!ranges.has(key)) ranges.set(key, field.componentRanges[axis]);
        });
      }
      return ranges;
    } finally { loaded.dispose(); }
  });
  fileRanges.set(file, pending);
  void pending.catch(() => fileRanges.delete(file));
  return pending;
}

/** Publish once, after every retained plane has contributed to the run's scale. */
export function useCFDPlaneRanges(adapter: RailwayCFDWorker | null, job: CFDWorkerJob | undefined,
  result: WorkerResult | null, knownFiles: readonly File[], enabled: boolean) {
  const key = result && JSON.stringify([adapter?.namespace, result.jobId, result.clientRevision,
    result.artifacts.filter(artifact => artifact.kind === "vtk").map(artifact => artifact.sha256)]);
  const [snapshot, setSnapshot] = useState<{key: string; ranges?: Map<string, Range>; error?: string}>();
  const [attempt, setAttempt] = useState(0);
  const current = snapshot?.key === key ? snapshot : undefined;
  const resolved = !!current?.ranges;
  const scan = useEffectEvent(async (signal: AbortSignal) => {
    if (!result || !adapter || !job) throw new Error("Reconnect the worker to read this result’s colour range.");
    const artifacts = result.artifacts.filter(artifact => artifact.kind === "vtk");
    const known = new Map(knownFiles.map(file => [file.name, file]));
    const ranges = new Map<string, Range>();
    let index = 0;
    const consume = async () => {
      while (index < artifacts.length) {
        signal.throwIfAborted();
        const artifact = artifacts[index++];
        const filename = artifact.name?.replace(/[^a-z0-9_.-]/gi, "-") ?? `${job.id}-${artifact.id}.vtk`;
        const file = known.get(filename) ?? await adapter.download(job, artifact,
          AbortSignal.any([signal, AbortSignal.timeout(120000)]));
        for (const [field, [low, high]] of await readRanges(file)) {
          const previous = ranges.get(field);
          ranges.set(field, previous ? [Math.min(low, previous[0]), Math.max(high, previous[1])] : [low, high]);
        }
      }
    };
    await Promise.all(Array.from({length: Math.min(3, artifacts.length)}, consume));
    return ranges;
  });
  useEffect(() => {
    if (!enabled || !key || resolved) return;
    const controller = new AbortController();
    void scan(controller.signal).then(ranges => {
      if (!controller.signal.aborted) setSnapshot({key, ranges});
    }).catch(cause => {
      if (controller.signal.aborted) return;
      controller.abort();
      setSnapshot({key, error: cause instanceof Error ? cause.message : "Unable to read the run’s plane ranges."});
    });
    return () => controller.abort();
  }, [enabled, key, attempt, resolved]);
  return {
    ranges: current?.ranges,
    error: current?.error,
    retry: () => { setSnapshot(undefined); setAttempt(value => value + 1); },
  };
}
