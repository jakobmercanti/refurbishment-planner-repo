import fabrics from "./fabrics.json";
import { colourPartsFor, FULL_PART_ID, type ColourSource } from "./assetColours";

export const FABRICS = fabrics;
export const fabricById = (id?: string | null) => FABRICS.find(fabric => fabric.id === id);

export function resolvedPartFabrics(source: ColourSource): Record<string, string> {
  const parts = colourPartsFor(source);
  const textileParts = parts.filter(part => part.material_type === "textile" && part.id !== FULL_PART_ID);
  const resolved = Object.fromEntries(textileParts.map(part => {
    const selected = source.component_materials?.[part.id];
    return [part.id, selected === "plain" ? "plain" : fabricById(selected)?.id ?? part.default_fabric_id ?? "linen"];
  }));
  const full = parts.find(part => part.id === FULL_PART_ID);
  if (full?.material_type === "textile") {
    const selected = source.component_materials?.[FULL_PART_ID];
    resolved[FULL_PART_ID] = selected === "plain" ? "plain" : fabricById(selected)?.id ?? full.default_fabric_id ?? textileParts[0]?.default_fabric_id ?? "linen";
  }
  return resolved;
}

/** Small vector swatches: texture remains neutral so any chosen colour can tint it. */
export function fabricSwatchStyle(id: string, colour: string) {
  const fabric = fabricById(id);
  const angle = fabric?.pattern === "twill" || fabric?.pattern === "herringbone" ? 45 : 0;
  const spacing = fabric?.pattern === "cord" ? 7 : fabric?.pattern === "knit" ? 9 : 4;
  const rounded = ["loops", "felt", "pile"].includes(fabric?.pattern ?? "");
  return {
    backgroundColor: colour,
    backgroundImage: rounded
      ? "radial-gradient(ellipse at 25% 30%, #ffffff40 0 15%, #00000015 35%, transparent 55%), radial-gradient(ellipse at 70% 75%, #ffffff30 0 12%, #00000015 30%, transparent 60%)"
      : `repeating-linear-gradient(${angle}deg, #ffffff25 0 1px, transparent 1px ${spacing}px), repeating-linear-gradient(${angle + 90}deg, #00000020 0 1px, transparent 1px ${spacing + 1}px)`,
    backgroundSize: rounded ? "7px 9px, 11px 7px" : undefined,
  };
}
