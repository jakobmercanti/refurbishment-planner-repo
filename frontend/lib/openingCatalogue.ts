import type { CatalogueItem } from "@/lib/types";

export function openingCatalogueCategoryLabel(item: CatalogueItem) {
  if (item.fixture_kind === "WINDOW") {
    const family = item.representation_key?.match(/^window-(bay|bow|sash)$/)?.[1];
    return family ? `${family[0].toUpperCase()}${family.slice(1)} windows` : "Casement windows";
  }
  return item.category_name || "Doors";
}
