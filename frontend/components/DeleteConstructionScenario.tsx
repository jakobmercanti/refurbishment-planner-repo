"use client";

import { useState } from "react";
import { createPortal } from "react-dom";
import type { EnergyProject } from "@/lib/energyDocument";
import { removeEnergyScenario } from "@/lib/energyScenarios";
import { Popup } from "./Popup";

export function DeleteConstructionScenario({ data, label = "Delete selected scenario", onChange }: {
  data: EnergyProject;
  label?: string;
  onChange?: (data: EnergyProject) => void;
}) {
  const [targetId, setTargetId] = useState<string | null>(null);
  const active = data.scenarios.find(scenario => scenario.scenarioId === data.activeScenarioId);
  const target = data.scenarios.find(scenario => scenario.scenarioId === targetId);
  const close = () => setTargetId(null);
  return <>
    <button type="button" disabled={!active || !onChange} onClick={() => setTargetId(active?.scenarioId ?? null)}>{label}</button>
    {target && createPortal(<Popup open title="Delete construction scenario?" confirmLabel="Delete scenario"
      message={`Delete “${target.name}”? Existing Building and your other scenarios are kept.`}
      onCancel={close} onConfirm={() => { onChange?.(removeEnergyScenario(data, target.scenarioId)); close(); }} />, document.body)}
  </>;
}
