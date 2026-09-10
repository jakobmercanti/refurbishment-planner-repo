import { WOOD_COLOURS } from "./flooring";
import type { RenderedWall } from "./wallRendering";

export interface SkirtingBoardSettings {
  enabled: boolean;
  colour_mode: "CUSTOM" | "WALL" | "WOOD";
  custom_colour: string;
  wood_id: string;
  height_mm: number;
  thickness_mm: number;
}

export function normalizeSkirting(input?: Partial<SkirtingBoardSettings>): SkirtingBoardSettings {
  const bounded = (value: number | undefined, fallback: number, max: number) => typeof value === "number" && Number.isFinite(value) ? Math.min(max, Math.max(1, value)) : fallback;
  return {
    enabled: input?.enabled === true,
    colour_mode: input?.colour_mode === "WALL" || input?.colour_mode === "WOOD" ? input.colour_mode : "CUSTOM",
    custom_colour: /^#[\da-f]{6}$/i.test(input?.custom_colour ?? "") ? input!.custom_colour! : "#ffffff",
    wood_id: WOOD_COLOURS.some(wood => wood.id === input?.wood_id) ? input!.wood_id! : "natural-oak",
    height_mm: bounded(input?.height_mm, 120, 600),
    thickness_mm: bounded(input?.thickness_mm, 18, 100),
  };
}

/** Render-only millimetre runs, cut back to the outside of each door casing. */
export function skirtingRuns(wall: RenderedWall): [number, number][] {
  const length = Math.hypot(wall.end.x - wall.start.x, wall.end.y - wall.start.y);
  const wallId = `wall-${String(wall.index + 1).padStart(3, "0")}`;
  const gaps = wall.room.openings.filter(opening => opening.parent_wall_id === wallId && (opening.kind === "DOOR" || (opening.kind === "GENERIC" && opening.sill_height_mm === 0))).map(opening => {
    // Match DoorFixture's stepped architrave (including its bevel).
    const unit = opening.height.value / 2040;
    const jamb = Math.min(38 * unit, opening.width.value * .08);
    const casing = opening.kind === "DOOR" ? 65.8 * unit - jamb * .3 : 0;
    return [Math.max(0, opening.offset_mm - wall.sourceOffsetMm - casing), Math.min(length, opening.offset_mm - wall.sourceOffsetMm + opening.width.value + casing)];
  }).filter(([from, to]) => to > from).sort((a, b) => a[0] - b[0]);
  const runs: [number, number][] = [];
  let cursor = 0;
  for (const [from, to] of gaps) { if (from > cursor) runs.push([cursor, from]); cursor = Math.max(cursor, to); }
  if (cursor < length) runs.push([cursor, length]);
  return runs;
}
