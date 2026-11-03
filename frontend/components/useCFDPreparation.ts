"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { preparationRevision, prepareCFD, type CFDReport } from "@/lib/climoptix";
import { cacheCFDReport, matchesCFDSource, type CFDReportCache, type CFDSource } from "@/lib/cfdSource";
import type { CFDScenario } from "@/lib/climoptixDocument";
import type { ProjectDocument } from "@/lib/projectDocument";

interface Options {
  active: boolean; apiUrl: string; input: string; project: ProjectDocument;
  scenario: CFDScenario | undefined; scenarios: CFDScenario[];
  onValidated: (report: CFDReport, scenarioId: string) => void;
}

/** Debounced source checks own cancellation, freshness and the bounded report cache. */
export function useCFDPreparation(options: Options) {
  const { active, apiUrl, input, project, scenario } = options;
  const scenarioId = scenario?.id;
  const latest = useRef(options);
  useEffect(() => { latest.current = options; });
  const [hash, setHash] = useState({ input: "", revision: "" });
  const [failure, setFailure] = useState<{ input: string; message: string } | null>(null);
  const [preparing, setPreparing] = useState("");
  const [retry, setRetry] = useState(0);
  const [cache, setCache] = useState<CFDReportCache<CFDReport>>({ projectId: project.projectId, reports: {} });
  const pending = useRef<AbortController | null>(null);
  const revision = hash.input === input ? hash.revision : "";

  useEffect(() => {
    let cancelled = false;
    if (input) void preparationRevision(input).then(revision => {
      if (!cancelled) setHash({ input, revision });
    }).catch(reason => {
      if (!cancelled) setFailure({ input, message: reason instanceof Error ? reason.message : "Cannot fingerprint the current simulation." });
    });
    return () => { cancelled = true; };
  }, [input]);

  useEffect(() => {
    if (!active || !revision || !scenarioId) return;
    const controller = new AbortController();
    pending.current = controller;
    const source: CFDSource = { projectId: project.projectId, studyId: scenarioId, input };
    const current = () => !controller.signal.aborted && matchesCFDSource(source, latest.current.project, latest.current.scenarios);
    const timer = window.setTimeout(() => {
      if (!current()) return;
      const target = latest.current;
      const study = target.scenarios.find(s => s.id === source.studyId)!;
      setPreparing(input);
      setFailure(null);
      void prepareCFD(apiUrl, target.project, study, revision, controller.signal).then(report => {
        if (!current()) return;
        setCache(previous => cacheCFDReport(previous, source, report, latest.current.scenarios.map(s => s.id)));
        latest.current.onValidated(report, source.studyId);
      }).catch(reason => {
        if (current()) setFailure({ input, message: reason instanceof Error ? reason.message : "Preparation unavailable. Your simulation is saved locally." });
      }).finally(() => {
        if (!controller.signal.aborted) setPreparing("");
      });
    }, 450);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
      setPreparing("");
    };
    // Source identity, not React object identity, schedules expensive geometry checks.
  }, [active, apiUrl, input, revision, retry, project.projectId, scenarioId]);

  const refresh = useCallback(() => setRetry(value => value + 1), []);
  const remove = useCallback((id: string) => setCache(previous => ({ ...previous,
    reports: Object.fromEntries(Object.entries(previous.reports).filter(([key]) => key !== id)),
  })), []);
  const clear = useCallback(() => {
    pending.current?.abort();
    setCache({ projectId: "", reports: {} });
    setFailure(null); setPreparing("");
  }, []);
  const report = cache.projectId === project.projectId && scenario ? cache.reports[scenario.id] ?? null : null;
  return { report, revision, busy: active && preparing === input && !!input,
    error: failure?.input === input ? failure.message : "",
    stale: !report || !revision || report.validation.clientRevision !== revision,
    refresh, remove, clear };
}
