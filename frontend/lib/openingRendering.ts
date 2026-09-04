/** Screen-only widths: clear both thin wall outlines and span the full wall with jambs. */
export function openingRenderWidths(wallThicknessScreen = 10) {
  const thickness = Number.isFinite(wallThicknessScreen) ? Math.max(0, wallThicknessScreen) : 10;
  return { gapWidth: Math.max(14, thickness + 4), jambHalf: Math.max(7, thickness / 2 + 2) };
}
