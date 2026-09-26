/** PlannerBuild uses consistent metric units regardless of the editor's unit preference. */
export function formatPlannerBuildArea(areaMm2: number): string {
  if (!Number.isFinite(areaMm2)) return "—";
  return `${(areaMm2 / 1_000_000).toFixed(1)} m²`;
}

export function formatPlannerBuildLength(lengthMm: number): string {
  if (!Number.isFinite(lengthMm)) return "—";
  return `${(lengthMm / 1_000).toFixed(1)} m`;
}
