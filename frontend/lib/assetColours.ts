import manifest from "./assetColourParts.json";
import type { ColourPart } from "./types";

export interface ColourSource {
  representation_key?: string;
  fixture_kind?: string;
  color_hex?: string;
  secondary_color_hex?: string;
  hardware_color_hex?: string;
  handrail_color_hex?: string;
  component_colors?: Record<string, string>;
  component_materials?: Record<string, string>;
  colour_parts?: ColourPart[];
  stl_base64?: string | null;
}

/** Stable id for the synthetic option that colours every renderable part. */
export const FULL_PART_ID = "full";
/** Glass is rendered with a fixed transparent material and is never editable. */
export const GLASS_PART_ID = "glass";

export function partSupportsFinish(part: ColourPart, material: "wood" | "metal"): boolean {
  return part.material_type === material || part.material_type === "wood-metal";
}

function fullPartFor(source: ColourSource, parts: ColourPart[]): ColourPart {
  const textileParts = parts.filter(part => part.material_type === "textile");
  const woodParts = parts.filter(part => partSupportsFinish(part, "wood"));
  const metalParts = parts.filter(part => partSupportsFinish(part, "metal"));
  // A full-part finish can still offer Fabric when an object contains any
  // upholstered regions; the colour itself is applied to every region,
  // while the material choice is scoped to those textile regions.
  const materialType = textileParts.length > 0
    ? "textile"
    : parts.length > 0 && metalParts.length === parts.length
      ? woodParts.length ? "wood-metal" : "metal"
      : parts.length > 0 && woodParts.length === parts.length
        ? metalParts.length ? "wood-metal" : "wood"
        : parts.some(part => part.material_type) ? "mixed" : null;
  const defaultFabricId = textileParts.find(part => part.default_fabric_id)?.default_fabric_id ?? null;
  const defaultColour = typeof source.color_hex === "string" && source.color_hex.length > 0
    ? source.color_hex
    : parts.find(part => part.legacy_field === "color_hex")?.default_color_hex ?? parts[0]?.default_color_hex ?? "#F4F3EE";
  return {
    id: FULL_PART_ID,
    label: "Full part",
    default_color_hex: defaultColour === "$catalogue" ? "#F4F3EE" : defaultColour,
    material_type: materialType,
    default_fabric_id: defaultFabricId,
  };
}

export function colourPartsFor(source: ColourSource): ColourPart[] {
  const representations: Record<string, string> = manifest.representations;
  const profiles: Record<string, ColourPart[]> = manifest.profiles;
  const key = source.representation_key ?? ({ SHOWER: "shower-corner", BASIN: "basin-vanity", TOILET: "toilet-close-coupled", FURNITURE: "furniture-storage-unit", DOOR: "door-single", WINDOW: "window-casement" }[source.fixture_kind ?? ""] ?? "");
  // Native meshes and their component definitions share this manifest. Older
  // catalogue responses may still contain the former whole-object definition.
  if (source.colour_parts?.length && !representations[key] && !source.stl_base64) {
    const parts = source.colour_parts
      .filter(part => part.id !== FULL_PART_ID && part.id !== GLASS_PART_ID)
      .map(part => ({ ...part, default_color_hex: part.default_color_hex === "$catalogue" ? source.color_hex ?? "#F4F3EE" : part.default_color_hex }));
    const distinctParts = parts.length === 1 && /whole object/i.test(parts[0].label) ? [] : parts;
    return [fullPartFor(source, distinctParts), ...distinctParts];
  }
  const profile = source.stl_base64 ? "whole" : representations[key] ?? "whole";
  const parts = profiles[profile]
    .filter(part => part.id !== GLASS_PART_ID)
    .map(part => ({ ...part, default_color_hex: part.default_color_hex === "$catalogue" ? source.color_hex ?? "#F4F3EE" : part.default_color_hex }));
  const distinctParts = profile === "whole" ? [] : parts;
  return [fullPartFor(source, distinctParts), ...distinctParts];
}

export function colourForPart(source: ColourSource, part: ColourPart): string {
  if (part.id === GLASS_PART_ID) return part.default_color_hex === "$catalogue" ? "#D5E8E8" : part.default_color_hex;
  const override = source.component_colors?.[part.id];
  if (override) return override;
  // A saved Full part override is also a fallback for older records that did
  // not expand the value across every individual part.
  if (part.id !== FULL_PART_ID) {
    const fullOverride = source.component_colors?.[FULL_PART_ID];
    if (fullOverride) return fullOverride;
  }
  if (part.id === FULL_PART_ID) return source.color_hex ?? part.default_color_hex;
  // The remade timber chair unifies the old seat cushion into the seat/back finish.
  if (part.id === "frame" && source.representation_key?.startsWith("furniture-chair-") && source.component_colors?.cushions) return source.component_colors.cushions;
  const legacy = part.legacy_field ? source[part.legacy_field as keyof ColourSource] : undefined;
  // The original vanity used this catalogue placeholder as its timber finish.
  if (part.id === "fronts" && source.representation_key?.startsWith("basin-") && typeof legacy === "string" && legacy.toUpperCase() === "#F4F3EE") return part.default_color_hex;
  return typeof legacy === "string" ? legacy : part.default_color_hex;
}

export function resolvedPartColours(source: ColourSource): Record<string, string> {
  const resolved = Object.fromEntries(colourPartsFor(source).map(part => [part.id, colourForPart(source, part)]));
  // Ignore legacy glass overrides that may still exist in saved projects.
  delete resolved[GLASS_PART_ID];
  // Parametric STL rendering historically reads `body`; retain that alias
  // while exposing the clearer Full part choice in the editor.
  if (resolved[FULL_PART_ID] && !resolved.body) resolved.body = resolved[FULL_PART_ID];
  return resolved;
}

/** Opening metadata is also loaded from user-supplied saved project files. */
export function componentColoursFromMetadata(metadata?: Record<string, unknown>): Record<string, string> {
  const value = metadata?.component_colors;
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(Object.entries(value).filter(([key, colour]) => key !== GLASS_PART_ID && /^[a-z][a-z0-9_]{0,39}$/.test(key) && typeof colour === "string" && /^#[0-9a-f]{6}$/i.test(colour)));
}
