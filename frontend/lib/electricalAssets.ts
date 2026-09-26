import assets from "./electricalAssets.json";

export const ELECTRICAL_ASSETS = assets;
export const ELECTRICAL_SUBCATEGORIES = [...new Set(assets.map(asset => asset.subcategory))];
export function electricalAsset(key?: string | null) {
  return assets.find(asset => asset.key === key);
}

/** All authoring dimensions and mounting heights are millimetres. */
export function electricalPlacement(key: string | undefined, height: number, roomHeight: number) {
  const asset = electricalAsset(key);
  if (!asset) return undefined;
  return {
    base_z_mm: Math.max(0, asset.mount === "ceiling" ? roomHeight - height : Math.min(asset.base, roomHeight - height)),
    wall_lock: asset.mount === "wall",
  };
}
