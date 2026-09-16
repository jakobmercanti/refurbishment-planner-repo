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
  colour_parts?: ColourPart[];
  stl_base64?: string | null;
}

export function colourPartsFor(source: ColourSource): ColourPart[] {
  if (source.colour_parts?.length) return source.colour_parts;
  const representations: Record<string, string> = manifest.representations;
  const profiles: Record<string, ColourPart[]> = manifest.profiles;
  const key = source.representation_key ?? ({ SHOWER: "shower-corner", BASIN: "basin-vanity", TOILET: "toilet-close-coupled", FURNITURE: "furniture-storage-unit", DOOR: "door-single", WINDOW: "window-casement" }[source.fixture_kind ?? ""] ?? "");
  const profile = source.stl_base64 ? "whole" : representations[key] ?? "whole";
  return profiles[profile].map(part => ({ ...part, default_color_hex: part.default_color_hex === "$catalogue" ? source.color_hex ?? "#F4F3EE" : part.default_color_hex }));
}

export function colourForPart(source: ColourSource, part: ColourPart): string {
  const override = source.component_colors?.[part.id];
  if (override) return override;
  const legacy = part.legacy_field ? source[part.legacy_field as keyof ColourSource] : undefined;
  // The original vanity used this catalogue placeholder as its timber finish.
  if (part.id === "fronts" && source.representation_key?.startsWith("basin-") && typeof legacy === "string" && legacy.toUpperCase() === "#F4F3EE") return part.default_color_hex;
  return typeof legacy === "string" ? legacy : part.default_color_hex;
}

export function resolvedPartColours(source: ColourSource): Record<string, string> {
  return Object.fromEntries(colourPartsFor(source).map(part => [part.id, colourForPart(source, part)]));
}

/** Opening metadata is also loaded from user-supplied saved project files. */
export function componentColoursFromMetadata(metadata?: Record<string, unknown>): Record<string, string> {
  const value = metadata?.component_colors;
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(Object.entries(value).filter(([key, colour]) => /^[a-z][a-z0-9_]{0,39}$/.test(key) && typeof colour === "string" && /^#[0-9a-f]{6}$/i.test(colour)));
}
