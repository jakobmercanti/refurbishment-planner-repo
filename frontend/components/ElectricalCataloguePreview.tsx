"use client";
import { assetUrl } from "@/lib/assetUrl";
import { electricalAsset } from "@/lib/electricalAssets";
import type { CatalogueItem } from "@/lib/types";

/** Grid cards must not allocate WebGL contexts; the details dialog owns the live model. */
export function ElectricalCataloguePreview({ item }: { item: CatalogueItem }) {
  const image = item.images?.[0]?.data_url || item.images?.[0]?.url;
  const preview = image || (electricalAsset(item.representation_key) ? `/fixture-previews/${item.representation_key}.png` : undefined);
  return <div className="electrical-catalogue-preview" aria-label={item.name + " 3D model image"}
    style={{ display: "grid", gridTemplateRows: "1fr auto", padding: 12, boxSizing: "border-box", gap: 8 }}>
    {preview ? <div role="img" aria-label={item.name} style={{ minHeight: 0, backgroundImage: `url(${assetUrl(preview)})`, backgroundPosition: "center", backgroundSize: "contain", backgroundRepeat: "no-repeat" }} />
      : <span style={{ alignSelf: "center", textAlign: "center" }}>{item.name}</span>}
    <small style={{ textAlign: "center" }}>Open for 3D view</small>
  </div>;
}
