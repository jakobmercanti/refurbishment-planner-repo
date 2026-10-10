import type { EnergyProject } from "./energyDocument";
import { scenarioAssignments } from "./energyCalculations";

/** Save a separate snapshot of the currently visible construction assignments. */
export function saveEnergyScenarioAs(data: EnergyProject, name: string): EnergyProject {
  if (data.scenarios.length >= 100) throw new Error("The project already has 100 scenarios.");
  const label = name.trim();
  if (!label || label.length > 80) throw new Error("Enter a scenario name up to 80 characters.");
  const scenarioId = crypto.randomUUID();
  return { ...data, scenarios: [...data.scenarios, { scenarioId, name: label, assignments: structuredClone(scenarioAssignments(data)) }], activeScenarioId: scenarioId };
}

export function renameEnergyScenario(data: EnergyProject, scenarioId: string, name: string): EnergyProject {
  const label = name.trim();
  if (!label || label.length > 80) throw new Error("Enter a scenario name up to 80 characters.");
  return { ...data, scenarios: data.scenarios.map(s => s.scenarioId === scenarioId ? { ...s, name: label } : s) };
}

export function removeEnergyScenario(data: EnergyProject, scenarioId: string): EnergyProject {
  return { ...data, scenarios: data.scenarios.filter(s => s.scenarioId !== scenarioId), activeScenarioId: data.activeScenarioId === scenarioId ? null : data.activeScenarioId };
}
