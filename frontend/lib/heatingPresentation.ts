import type { heatingResults } from "./heatingDesign";

export type HeatingRoomResult = ReturnType<typeof heatingResults>["rooms"][number];
export const heatingWatts = (value: number) => `${Math.round(value).toLocaleString()} W`;

/** Presentation of the existing deterministic results, not a second sizing engine.
 * A green estimated comparison is explicitly not the engine's verified-capacity pass.
 */
export function heatingRoomBalance(row: HeatingRoomResult) {
  const differenceW = row.capacityW - row.demand.designW;
  const estimated = row.capacityEstimated;
  const capacityText = `${estimated ? "~" : ""}${heatingWatts(row.capacityW)}`;
  if (!row.capacityComparisonValid) return { tone: "review", headline: "Output needs checking", detail: "Missing or unsuitable performance data", indicator: "! Check output data", capacityText: `${capacityText} known`, estimated, differenceW } as const;
  if (!row.emitters.some(e => e.radiator.category !== "Boiler") && !row.zones.length && row.demand.designW > 0) return { tone: "empty", headline: "Add heating to this room", detail: `${heatingWatts(row.demand.designW)} of heat required`, indicator: "No room heating added", capacityText, estimated, differenceW } as const;
  if (row.demand.designW === 0 && row.capacityW === 0) return { tone: "empty", headline: "No heat demand calculated", detail: "Check room temperatures and exposed surfaces", indicator: "Check heat-loss inputs", capacityText, estimated, differenceW } as const;
  if (differenceW >= 0) return { tone: "sufficient", headline: estimated ? "Estimated output meets demand" : "Heating output meets demand", detail: `${heatingWatts(differenceW)} spare capacity · ${Math.round(row.coveragePercent)}% coverage`, indicator: `${estimated ? "Estimated surplus" : "Surplus"} +${heatingWatts(differenceW)}`, capacityText, estimated, differenceW } as const;
  return { tone: row.capacityW >= row.demand.designW * 0.9 ? "marginal" : "insufficient", headline: estimated ? "Estimated output is too low" : "More heating output needed", detail: `${heatingWatts(-differenceW)} more needed · ${Math.round(row.coveragePercent)}% coverage`, indicator: `${estimated ? "Estimated shortfall" : "Shortfall"} ${heatingWatts(-differenceW)}`, capacityText, estimated, differenceW } as const;
}
