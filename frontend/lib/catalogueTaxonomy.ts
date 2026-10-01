export const MACRO_CATEGORY_ORDER = ["bathroom", "kitchen", "living", "bedroom", "staircases", "radiators", "electrical", "other"] as const;
export type MacroCategoryId = typeof MACRO_CATEGORY_ORDER[number];

export const MACRO_CATEGORY_LABELS: Record<MacroCategoryId, string> = {
  bathroom: "Bathroom fixtures",
  kitchen: "Kitchen",
  living: "Living Room",
  bedroom: "Bedroom",
  staircases: "Staircases",
  radiators: "Radiators",
  electrical: "Electrical",
  other: "Other",
};

export function macroCategoryForCategoryId(categoryId: string): MacroCategoryId {
  if (categoryId === "electric") return "electrical";
  if (["showers", "basins", "toilets", "baths", "storage"].includes(categoryId)) return "bathroom";
  if (categoryId.startsWith("kitchen-")) return "kitchen";
  if (categoryId.startsWith("living-")) return "living";
  if (categoryId.startsWith("bedroom-")) return "bedroom";
  if (categoryId.startsWith("radiators-")) return "radiators";
  if (categoryId.startsWith("staircases-")) return "staircases";
  return "other";
}

export function macroCategoryDisplay(categoryId: MacroCategoryId): string {
  return MACRO_CATEGORY_LABELS[categoryId].replace(/\s+fixtures$/, "");
}
