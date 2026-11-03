"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { preparationRevision } from "@/lib/climoptix";
import { cacheCFDReport, captureCFDSource, matchesCFDSource, type CFDReportCache, type CFDSource } from "@/lib/cfdSource";
import { requestThermal } from "@/lib/thermalClient";
import type { ThermalPackage } from "@/lib/thermalDocument";
import type { CFDScenario } from "@/lib/climoptixDocument";
import type { ProjectDocument } from "@/lib/projectDocument";

interface Options {
  active: boolean; open: boolean; apiUrl: string; project: ProjectDocument;
  scenario: CFDScenario | undefined; scenarios: CFDScenario[]; input: string; revision: string;
  onPreview: () => void;
}
type Task = { source: CFDSource; busy: boolean; error: string };

export function useCFDThermal(options: Options) {
  const { active, open, apiUrl, project, scenario, input, revision } = options;
  const latest = useRef(options);
  useEffect(() => { latest.current = options; });
  const [cache, setCache] = useState<CFDReportCache<ThermalPackage>>({ projectId: project.projectId, reports: {} });
  const [task, setTask] = useState<Task | null>(null);
  const pending = useRef<AbortController | null>(null);
  useEffect(() => () => pending.current?.abort(), [project.projectId]);

  const calculate = useCallback(async (calculate: boolean, target = scenario) => {
    if (!target?.seed) return;
    pending.current?.abort();
    const controller = new AbortController(); pending.current = controller;
    const source = captureCFDSource(project, target);
    const current = () => !controller.signal.aborted && matchesCFDSource(source, latest.current.project, latest.current.scenarios);
    setTask({ source, busy: true, error: "" });
    try {
      const token = await preparationRevision(source.input);
      controller.signal.throwIfAborted();
      const result = await requestThermal(apiUrl, project, target, token, calculate, controller.signal);
      if (!current()) return;
      setCache(previous => cacheCFDReport(previous, source, result, latest.current.scenarios.map(s => s.id)));
      if (!calculate && result.surfaces.length) latest.current.onPreview();
    } catch (reason) {
      if (current()) setTask({ source, busy: false, error: reason instanceof Error ? reason.message : "Thermal preparation failed." });
    } finally {
      if (!controller.signal.aborted) setTask(previous => previous?.source === source ? { ...previous, busy: false } : previous);
    }
  }, [apiUrl, project, scenario]);

  const previouslyActive = useRef(active);
  useEffect(() => {
    const returning = active && !previouslyActive.current;
    previouslyActive.current = active;
    if (returning && open) void calculate(false);
  }, [active, open, calculate]);

  const setError = (error: string) => {
    if (scenario) setTask({ source: captureCFDSource(project, scenario), busy: false, error });
  };
  const remove = useCallback((id: string) => setCache(previous => ({ ...previous,
    reports: Object.fromEntries(Object.entries(previous.reports).filter(([key]) => key !== id)),
  })), []);
  const clear = useCallback(() => {
    pending.current?.abort(); setCache({ projectId: "", reports: {} }); setTask(null);
  }, []);
  const report = cache.projectId === project.projectId && scenario ? cache.reports[scenario.id] ?? null : null;
  const currentTask = task?.source.projectId === project.projectId && task.source.studyId === scenario?.id && task.source.input === input ? task : null;
  return { report, busy: currentTask?.busy ?? false, error: currentTask?.error ?? "",
    stale: !report || !revision || report.sourceRevision !== revision,
    calculate, setError, remove, clear };
}
