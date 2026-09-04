/** Applying the inherited value still creates an explicit, default-independent override. */
export function needsWallThicknessOverride(existingOverride: number | undefined, requested: number): boolean {
  return Number.isFinite(requested) && requested > 0 && (existingOverride === undefined || Math.abs(existingOverride - requested) > 1e-6);
}
