import type { Room } from "./types";
import type { UFHZone } from "./heatingDocument";
import { parallelRunCount } from "./ufhBendControls";

/** Derive spacing from measured available span without relaxing the pipe's bend radius. */
export function withParallelRuns(room: Room, zone: UFHZone, count: number): UFHZone {
  if (!Number.isInteger(count) || count < 2 || count > 300) throw new Error("Parallel tube runs must be a whole number from 2 to 300.");
  const { available } = parallelRunCount(room, zone), spacing = available / (count - 1);
  const minimum = Math.max(50, 2 * zone.minBendRadiusMm);
  if (spacing < minimum || spacing > 600) throw new Error(`${count} runs need ${spacing.toFixed(1)} mm spacing. This pipe requires ${minimum}–600 mm spacing, including its ${zone.minBendRadiusMm} mm minimum bend radius. Choose ${Math.max(2, Math.ceil(available / 600) + 1)}–${Math.max(1, Math.floor(available / minimum) + 1)} runs or review the pipe settings.`);
  return { ...zone, runCountTarget: count, spacingMm: spacing, pattern: "Serpentine" };
}
