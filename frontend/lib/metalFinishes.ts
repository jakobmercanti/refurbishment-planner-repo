import finishes from "./metalFinishes.json";
import type { MaterialCollection } from "./types";

export const METAL_FINISHES = finishes;
export const metalFinishForColour = (colour?: string) =>
  METAL_FINISHES.find(finish => finish.colour.toLowerCase() === colour?.toLowerCase());

/** Finishes use the existing persisted component colour, including opening metadata. */
export function metalSwatchStyle(colour: string) {
  const finish = metalFinishForColour(colour);
  if (!finish || finish.metalness === 0) return { background: colour };
  return {
    backgroundColor: colour,
    backgroundImage: finish.brushed
      ? "repeating-linear-gradient(0deg, #ffffff20 0 1px, #00000010 1px 2px, transparent 2px 4px), linear-gradient(120deg, #00000025, #ffffff70 45%, #00000025)"
      : "linear-gradient(120deg, #00000050, #ffffff90 35%, transparent 50%, #ffffff50 65%, #00000045)",
  };
}

export const METALS_COLLECTION: MaterialCollection = {
  id: "metals", kind: "PAINT", name: "Metals",
  families: [{
    id: "metal-finishes", name: "Metal finishes",
    items: METAL_FINISHES.map(finish => ({
      id: `metal-${finish.id}`, name: finish.name, color_hex: finish.colour,
      metadata: { ...finish, metal_finish_id: finish.id },
    })),
  }],
};
