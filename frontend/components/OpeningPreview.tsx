"use client";

import { doorRepresentation } from "@/lib/doorModels";
import { FixturePreview } from "@/components/FixturePreview";
import type { CatalogueItem, Obstacle } from "@/lib/types";

type OpeningPreviewProps = {
  item?: CatalogueItem;
  kind: "DOOR" | "WINDOW";
  doorType?: "SINGLE" | "DOUBLE";
  width?: number;
  height?: number;
  colorHex?: string;
};

export function OpeningPreview({ item, kind, doorType = "SINGLE", width, height, colorHex }: OpeningPreviewProps) {
  const label = `${item?.subcategory ?? ""} ${item?.name ?? ""}`.toLowerCase();
  const panes = label.includes("triple") ? "triple" : label.includes("double") ? "double" : "single";
  const representation = kind === "DOOR" ? doorRepresentation(item?.representation_key, doorType) : item?.representation_key || `window-${panes}-pane`;
  const measured = (value: number) => ({ value: Math.max(1, value), uncertainty_mm: 0, verified: false, source_type: "USER_MEASURED" });
  const obstacle: Obstacle = {
    id: "opening-preview", name: item?.name ?? (kind === "DOOR" ? "Door" : "Window"),
    representation_key: representation, color_hex: colorHex ?? item?.color_hex,
    center: { x: 0, y: 0 }, base_z_mm: 0, rotation_deg: 0, verified: false,
    dimensions: {
      width: measured(width ?? item?.width_mm ?? 800),
      depth: measured(item?.depth_mm ?? 100),
      height: measured(height ?? item?.height_mm ?? (kind === "DOOR" ? 2040 : 900)),
    },
  };
  return <><FixturePreview obstacle={obstacle} /><svg viewBox="0 0 200 100" role="img" aria-label={`${obstacle.name} plan symbol`} style={{ width: "100%", height: 100, background: "white" }}><title>{obstacle.name} plan symbol</title><image href={`/fixture-symbols/${representation}.svg`} width={200} height={100} preserveAspectRatio="xMidYMid meet" /></svg></>;
}
