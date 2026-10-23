"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { ProjectDocument } from "@/lib/projectDocument";
import type { CFDScenario } from "@/lib/climoptixDocument";
import {
  checkedWorkerJob,
  prepareWorkerSubmission,
  terminalJob,
  workerInput,
  type CFDOperation,
  type CFDSubmission,
  type CFDWorkerAdapter,
  type CFDWorkerJob,
} from "@/lib/climoptixJobs";

export type CFDJobEntry = {
  input: string;
  job?: CFDWorkerJob;
  error?: string;
  submitting?: boolean;
  submissionId?: string;
  operation?: CFDOperation;
  /** Dispatch may have succeeded even if its response was lost. */
  dispatched?: boolean;
};

export function useCFDJobs(
  project: ProjectDocument,
  apiUrl: string,
  adapter: CFDWorkerAdapter | null,
) {
  const [entries, setEntries] = useState<Record<string, CFDJobEntry>>({});
  const latest = useRef({ project, adapter });
  const pending = useRef(new Map<string, AbortController>());
  const unresolved = useRef(new Map<string, CFDSubmission>());
  const submitAbort = useRef(new AbortController());
  const entriesRef = useRef(entries);
  useEffect(() => {
    latest.current = { project, adapter };
  }, [project, adapter]);
  const update = useCallback((id: string, entry: CFDJobEntry) => {
    // The synchronous ref is the submission lock; React rendering is not a lock.
    const next = { ...entriesRef.current, [id]: entry };
    entriesRef.current = next;
    setEntries(next);
  }, []);
  const projectId = useRef(project.projectId);
  useEffect(() => {
    const controller = new AbortController();
    submitAbort.current = controller;
    const submitting = pending.current;
    if (projectId.current !== project.projectId) {
      projectId.current = project.projectId;
      entriesRef.current = {};
      unresolved.current.clear();
      setEntries({});
    } else {
      for (const [id, entry] of Object.entries(entriesRef.current)) {
        if (entry.submitting)
          update(id, {
            ...entry,
            submitting: false,
            error:
              "Connection changed before submission completed. Retry to check or resume this request.",
          });
      }
    }
    return () => {
      controller.abort();
      submitting.clear();
    };
  }, [project.projectId, adapter, update]);
  const submit = async (operation: CFDOperation, studies: CFDScenario[]) => {
    if (!adapter?.capabilities.connected || !adapter.capabilities[operation])
      return;
    const controller = submitAbort.current;
    // Reserve the whole batch before awaiting preflight: rapid clicks cannot queue duplicates.
    const queue: {
      study: CFDScenario;
      input: string;
      submissionId: string;
      recovery?: CFDSubmission;
    }[] = [];
    for (const study of studies) {
      if (
        controller.signal.aborted ||
        study.archived ||
        pending.current.has(study.id)
      )
        continue;
      const existing = entriesRef.current[study.id];
      if (existing?.job && !terminalJob(existing.job)) continue;
      const recovery = unresolved.current.get(study.id);
      if (recovery && recovery.operation !== operation) {
        update(study.id, {
          ...existing!,
          error: `Recover the previous ${recovery.operation} submission before starting ${operation}.`,
        });
        continue;
      }
      pending.current.set(study.id, controller);
      const input = recovery ? existing!.input : workerInput(project, study);
      const submissionId =
        recovery?.submissionId ??
        (existing?.input === input &&
        existing.operation === operation &&
        existing.submissionId &&
        !existing.job
          ? existing.submissionId
          : crypto.randomUUID());
      update(study.id, {
        input,
        operation,
        submissionId,
        submitting: true,
        dispatched: !!recovery,
      });
      queue.push({
        study: structuredClone(study),
        input,
        submissionId,
        recovery,
      });
    }
    // Sequential preparation bounds resource use; worker jobs can run independently.
    for (const { study, input, submissionId, recovery } of queue) {
      if (controller.signal.aborted) return;
      try {
        const request =
          recovery ??
          (await prepareWorkerSubmission(
            apiUrl,
            project,
            study,
            operation,
            controller.signal,
            submissionId,
          ));
        const live = latest.current.project.cfdScenarios?.find(
          (s) => s.id === study.id,
        );
        if (controller.signal.aborted) return;
        if (
          !recovery &&
          (!live ||
            live.archived ||
            workerInput(latest.current.project, live) !== input)
        )
          throw new Error(
            "Setup changed before submission. Select the updated study and submit again.",
          );
        unresolved.current.set(study.id, request);
        update(study.id, {
          input,
          operation,
          submissionId,
          submitting: true,
          dispatched: true,
        });
        const job = checkedWorkerJob(
          await adapter.submit(structuredClone(request), controller.signal),
          { studyId: study.id, clientRevision: request.clientRevision },
        );
        if (!controller.signal.aborted) {
          unresolved.current.delete(study.id);
          update(study.id, { input, operation, submissionId, job });
        }
      } catch (error) {
        if (!controller.signal.aborted)
          update(study.id, {
            input,
            submissionId,
            operation,
            dispatched: unresolved.current.has(study.id),
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
