import type { CatalogueItem } from "@/lib/types";

export function openingCatalogueCategoryLabel(item: CatalogueItem) {
  if (item.fixture_kind === "WINDOW") {
    const family = item.representation_key?.match(/^window-(bay|bow|sash)$/)?.[1];
    return family ? `${family[0].toUpperCase()}${family.slice(1)} windows` : "Casement windows";
  }
  return item.category_name || "Doors";
}

export function openingCatalogueDefaultDimensions(item: Pick<CatalogueItem, "fixture_kind" | "representation_key" | "height_mm">) {
  const projectedWindow = item.fixture_kind === "WINDOW" && (item.representation_key === "window-bay" || item.representation_key === "window-bow");
  const height = projectedWindow ? Math.min(item.height_mm, 1400) : item.height_mm;
  const sill = item.fixture_kind === "WINDOW"
    ? Math.min(projectedWindow ? 1000 : 1200, Math.max(0, height)) || 900
    : 0;
  return { height, sill };
}
