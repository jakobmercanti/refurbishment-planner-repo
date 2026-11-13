"use client";

import { useEffect, useRef, useState } from "react";
import { preparationInput, preparationRevision, prepareCFD } from "@/lib/climoptix";
import { newCFDScenario } from "@/lib/climoptixDocument";
import { hvacBoundaryPackage, resolveHvacScenario } from "@/lib/hvacBridge";
import { hvacConditionsSchema, hvacSchema, newHvacProject, roomOperatingScenario, type HvacAnalysisMode, type HvacConditions } from "@/lib/hvacDocument";
import { useHvac } from "./HvacContext";

export function useEvaluateHvacCFD(floorId: string, roomId: string | undefined, defaults: Partial<HvacConditions>) {
  const ctx = useHvac();
  const project = ctx?.project;
  const request = useRef<AbortController | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => () => request.current?.abort(), [project, floorId, roomId, ctx?.apiUrl]);

  async function evaluate(analysisMode: HvacAnalysisMode = "airflow") {
    if (!ctx || !project || !roomId || request.current && !request.current.signal.aborted) return;
    const { apiUrl } = ctx;
    if ((project.cfdScenarios?.length ?? 0) >= 100) {
      setError("Remove an existing simulation before creating another CFD case.");
      return;
    }
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    const { signal } = controller;
    setBusy(true);
    setError("");
    try {
      const hvac = project.hvac ?? newHvacProject();
      const seed = { floorId, roomId };
      const operating = roomOperatingScenario(hvac, floorId, roomId) ?? {
        ...seed, id: crypto.randomUUID(), name: "Nominal operation", conditions: hvacConditionsSchema.parse(defaults), ventOverrides: {}, heaterOverrides: {},
      };
      const scenario = { ...newCFDScenario(project.projectId, `${operating.name} · ${analysisMode === "airflow" ? "Airflow" : "HVAC"}`), seed };
      const deviceIds = hvac.devices.filter(d => d.floorId === floorId && d.roomId === roomId).map(d => d.vent.id);
      const nextHvac = hvacSchema.parse({ ...hvac, activeScenarioId: operating.id,
        scenarios: [...hvac.scenarios.filter(s => s.id !== operating.id), operating],
        bindings: { ...hvac.bindings, [scenario.id]: { analysisMode, operatingScenarioId: operating.id, deviceIds, editMode: "design", overrides: {} } },
      });
      const nextProject = { ...project, hvac: nextHvac };
      async function prepare() {
        const resolved = resolveHvacScenario(nextProject, scenario);
        const revision = await preparationRevision(preparationInput(nextProject, resolved));
        return prepareCFD(apiUrl, nextProject, resolved, revision, signal);
      }
      let report = await prepare();
      const binding = nextHvac.bindings[scenario.id];
      const included = hvac.devices.filter(d => report.domain.regions.some(r => r.included && r.floorId === d.floorId && r.id === d.roomId)).map(d => d.vent.id);
      if (included.some(id => !binding.deviceIds.includes(id))) {
        binding.deviceIds = included;
        report = await prepare();
      }
      binding.scopeRooms = report.domain.regions.filter(r => r.included).map(r => ({ floorId: r.floorId, roomId: r.id }));
      binding.scopeSeed = seed;
      const boundary = hvacBoundaryPackage(nextProject, scenario, report);
      const inputHash = await preparationRevision(boundary.sourceInput);
      signal.throwIfAborted();
      nextHvac.snapshots = [{ caseId: scenario.id, operatingScenarioId: operating.id, createdAt: new Date().toISOString(), inputHash, boundaryJson: JSON.stringify(boundary) }, ...nextHvac.snapshots].slice(0, 5);
      ctx.commit(nextHvac, [...(project.cfdScenarios ?? []), scenario]);
      ctx.navigateCFD(scenario.id);
    } catch (cause) {
      if (!signal.aborted) setError(cause instanceof Error ? cause.message : "CFD preflight unavailable.");
    } finally {
      if (request.current === controller) {
        request.current = null;
        setBusy(false);
      }
    }
  }
  return { evaluate, busy, error };
}
