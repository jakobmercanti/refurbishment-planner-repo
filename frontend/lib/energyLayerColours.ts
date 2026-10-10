import type { ConstructionAssembly } from "./energyDocument";

export const LAYER_COLOURS = ["#b96950", "#ecd59c", "#e9c844", "#a5b2bb", "#ece9e0", "#78a5b4"];

/** Assign missing colours once, before any reorder; colour belongs to the layer ID. */
export function withLayerColours(assembly: ConstructionAssembly): ConstructionAssembly {
  return { ...assembly, layers: assembly.layers.map((layer, index) => ({ ...layer, colorHex: layer.colorHex ?? LAYER_COLOURS[index % LAYER_COLOURS.length] })) };
}
