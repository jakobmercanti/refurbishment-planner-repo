"use client";
import type { Room } from "@/lib/types";
import type { HeatingProject } from "@/lib/heatingDocument";
import type { EnergyProject } from "@/lib/energyDocument";
import { assignEnergyElements, energyElements, scenarioAssignments } from "@/lib/energyCalculations";
import { NumberField } from "./EnergyNumberField";

/** Edit the resolved surface assignments, never a second copy of Insulation data. */
export function SharedThermalValues({ rooms, heating, energy, onChange }: { rooms: Room[]; heating: HeatingProject; energy: EnergyProject; onChange?: (data: EnergyProject) => void }) {
  const elements = energyElements(rooms, heating, energy);
  const assignments = scenarioAssignments(energy);
  return <details className="heating-shared-u-values"><summary>Actual U-values in use (W/m²K)</summary>
    <p>Shared with Energy &amp; Insulation · {energy.scenarios.find(s => s.scenarioId === energy.activeScenarioId)?.name ?? "Existing Building"}. Layer-derived values update here automatically. Entering a whole-element U-value replaces that surface’s layer assignment in this scenario.</p>
    <fieldset disabled={!onChange} className="heating-surface-values">{elements.map(element => <div key={element.elementId}><NumberField label={`${element.label} shared U-value`} min={0} max={10} value={element.uValue} onChange={value => onChange?.(assignEnergyElements(energy, [{ ...assignments.find(a => a.elementId === element.elementId), elementId: element.elementId, assemblyId: null, uValue: value, geometrySignature: element.geometrySignature }]))} /><small>{Math.round(element.heatLossW)} W · {element.areaM2.toFixed(2)} m²</small></div>)}</fieldset>
  </details>;
}
