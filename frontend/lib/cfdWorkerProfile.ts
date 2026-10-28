import { MAX_SAMPLING_PLANES, type CFDScenario } from "./climoptixDocument";
import type { WorkerCapabilities } from "./railwayCFDWorker";

type Limits = WorkerCapabilities["limits"];
const resourceKeys = ["cpu", "memoryGb", "wallTimeMinutes", "storageGb", "retentionDays"] as const;

/** Explicit user action only. This never changes measured geometry or silently clamps a submission. */
export function applyWorkerLimits(scenario: CFDScenario, limits: Limits): CFDScenario {
  const resources = { ...scenario.resources };
  for (const key of resourceKeys) resources[key] = Math.min(resources[key], limits[key]);
  return { ...scenario, resources, mesh: { ...scenario.mesh,
    maxCells: Math.min(scenario.mesh.maxCells, limits.maxCells), targetCells: Math.min(scenario.mesh.targetCells, limits.maxCells) } };
}

/** Advisory only: authenticated worker validation remains authoritative. */
export function workerProfileIssues(scenario: CFDScenario, limits: Limits): string[] {
  const issues: string[] = [], p = scenario.physics;
  if (resourceKeys.some(key => scenario.resources[key] > limits[key]) || scenario.mesh.maxCells > limits.maxCells)
    issues.push("Requested resources exceed this worker's limits. Review them or use the explicit limits action.");
  if (p.mode !== "steady" || !["isothermal", "custom"].includes(p.preset) || p.energy || p.co2 || p.boussinesq || p.numerics.coupling !== "SIMPLE" || p.numerics.monitor !== "flowBalance")
    issues.push("Execution supports steady isothermal SIMPLE ventilation; thermal, scalar and transient settings remain export-only intent.");
  if (scenario.thermalSnapshots?.length) issues.push("Applied thermal contracts are not supported by this worker.");
  if (scenario.mesh.layers.enabled || scenario.mesh.alignmentDeg !== 0) issues.push("Boundary layers and rotated background grids are not supported by this worker.");
  if (scenario.outputs.temperature || scenario.outputs.co2 || scenario.outputs.ageOfAir || scenario.outputs.comfort || scenario.postProcessing.fields.some(field => field !== "U" && field !== "p"))
    issues.push("Execution outputs are velocity and kinematic pressure only. Other requested fields are not computed.");
  const planes = [scenario.postProcessing.x, scenario.postProcessing.y, scenario.postProcessing.z].reduce((sum, stack) => sum + (stack.enabled ? stack.count : 0), 0);
  if (scenario.outputs.probesMm.length > 100 || planes > MAX_SAMPLING_PLANES) issues.push(`Execution supports up to 100 probes and ${MAX_SAMPLING_PLANES} sampling planes.`);
  if (p.numerics.maxIterations > 5000) issues.push("Execution supports at most 5,000 steady iterations.");
  return issues;
}
