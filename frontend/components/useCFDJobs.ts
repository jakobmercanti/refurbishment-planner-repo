"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { ProjectDocument } from "@/lib/projectDocument";
import type { CFDScenario } from "@/lib/climoptixDocument";
import { preparationInput } from "@/lib/climoptix";
import {
  checkedWorkerJob,
  prepareWorkerSubmission,
  terminalJob,
  type CFDOperation,
  type CFDWorkerAdapter,
  type CFDWorkerJob,
} from "@/lib/climoptixJobs";

export type CFDJobEntry = {
  input: string;
  job?: CFDWorkerJob;
  error?: string;
  submitting?: boolean;
};

export function useCFDJobs(
  project: ProjectDocument,
  apiUrl: string,
  adapter: CFDWorkerAdapter | null,
) {
  const [entries, setEntries] = useState<Record<string, CFDJobEntry>>({});
  const latest = useRef({ project, adapter });
  const pending = useRef(new Map<string, AbortController>());
  const submitAbort = useRef(new AbortController());
  const entriesRef = useRef(entries);
  useEffect(() => {
    latest.current = { project, adapter };
    entriesRef.current = entries;
  }, [project, adapter, entries]);
  useEffect(() => {
    const controller = new AbortController();
    submitAbort.current = controller;
    const submitting = pending.current;
    return () => {
      controller.abort();
      submitting.clear();
    };
  }, [project.projectId, adapter]);
  const update = useCallback(
    (id: string, entry: CFDJobEntry) =>
      setEntries((values) => ({ ...values, [id]: entry })),
    [],
  );
  const submit = async (operation: CFDOperation, studies: CFDScenario[]) => {
    if (!adapter?.capabilities.connected || !adapter.capabilities[operation])
      return;
    const controller = submitAbort.current;
    // Sequential preparation bounds resource use; each submitted worker job can run independently.
    for (const study of studies) {
      if (
        controller.signal.aborted ||
        study.archived ||
        pending.current.has(study.id)
      )
        continue;
      const existing = entriesRef.current[study.id];
      if (existing?.job && !terminalJob(existing.job)) continue;
      pending.current.set(study.id, controller);
      const input = preparationInput(project, study);
      update(study.id, { input, submitting: true });
      try {
        const request = await prepareWorkerSubmission(
          apiUrl,
          project,
          study,
          operation,
          controller.signal,
        );
        const live = latest.current.project.cfdScenarios?.find(
          (s) => s.id === study.id,
        );
        if (controller.signal.aborted) return;
        if (
          !live ||
          live.archived ||
          preparationInput(latest.current.project, live) !== input
        )
          throw new Error(
            "Setup changed before submission. Select the updated study and submit again.",
          );
        const job = checkedWorkerJob(
          await adapter.submit(request, controller.signal),
          { studyId: study.id, clientRevision: request.clientRevision },
        );
        if (!controller.signal.aborted) update(study.id, { input, job });
      } catch (error) {
        if (!controller.signal.aborted)
          update(study.id, {
            input,
            error:
              error instanceof Error
                ? error.message
                : "Worker submission failed.",
          });
      } finally {
        if (pending.current.get(study.id) === controller)
          pending.current.delete(study.id);
      }
    }
  };
  // One bounded polling loop, not one interval per study. Failures retain the job ID for retry.
  useEffect(() => {
    if (!adapter?.capabilities.connected) return;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      for (const [id, entry] of Object.entries(entriesRef.current)) {
        if (!entry.job || terminalJob(entry.job) || controller.signal.aborted)
          continue;
        try {
          const job = checkedWorkerJob(
            await adapter.status(entry.job.id, controller.signal),
            entry.job,
          );
          if (!controller.signal.aborted)
            update(id, { ...entry, job, error: undefined });
        } catch (error) {
          if (!controller.signal.aborted)
            update(id, {
              ...entry,
              error:
                error instanceof Error
                  ? error.message
                  : "Worker status unavailable.",
            });
        }
      }
      if (!controller.signal.aborted)
        timer = setTimeout(() => void poll(), 2000);
    };
    timer = setTimeout(() => void poll(), 1000);
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [adapter, project.projectId, update]);
  return { entries, submit };
}
