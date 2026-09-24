import { Box3, LoadingManager, Mesh, Vector3 } from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { completed, localDatabase, requestValue } from "./localDatabase";
import { assetSchema, type AssetDefinition } from "./projectDocument";

export const MAX_GLB_BYTES = 50 * 1024 * 1024;
export async function contentHash(bytes: Uint8Array): Promise<string> { const hash = await crypto.subtle.digest("SHA-256", new Uint8Array(bytes)); return Array.from(new Uint8Array(hash), b => b.toString(16).padStart(2, "0")).join(""); }
export function inspectGlb(bytes: Uint8Array) {
  if (bytes.length < 20 || bytes.length > MAX_GLB_BYTES) throw new Error("GLB must be between 20 bytes and 50 MB.");
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (view.getUint32(0, true) !== 0x46546c67 || view.getUint32(4, true) !== 2 || view.getUint32(8, true) !== bytes.length || view.getUint32(16, true) !== 0x4e4f534a) throw new Error("Invalid GLB 2.0 file.");
  const size = view.getUint32(12, true);
  if (size > 4 * 1024 * 1024 || 20 + size > bytes.length) throw new Error("Invalid GLB metadata size.");
  const json = JSON.parse(new TextDecoder().decode(bytes.subarray(20, 20 + size)));
  if (json.asset?.version !== "2.0") throw new Error("Unsupported GLB version.");
  const inspect = (value: unknown, depth = 0) => {
    if (depth > 30) throw new Error("GLB nesting limit exceeded.");
    if (!value || typeof value !== "object") return;
    for (const [key, item] of Object.entries(value)) { if (key === "uri") throw new Error("GLB must embed resources in binary buffer views; external/data URLs are not supported."); inspect(item, depth + 1); }
  };
  inspect(json);
  if ((json.nodes?.length ?? 0) > 20000 || (json.meshes?.length ?? 0) > 10000 || (json.images?.length ?? 0) > 64 || (json.accessors ?? []).reduce((sum: number, a: { count: number }) => sum + a.count, 0) > 6000000) throw new Error("This model is too complex for the browser planner.");
  if ((json.extensionsRequired?.length ?? 0) > 0) throw new Error("This GLB needs unsupported extensions. Export an uncompressed GLB 2.0 model.");
  return json;
}
export async function loadGlb(bytes: Uint8Array) {
  inspectGlb(bytes);
  const manager = new LoadingManager();
  manager.setURLModifier(url => { if (!url.startsWith("blob:")) throw new Error("External GLB resources are disabled."); return url; });
  return new GLTFLoader(manager).parseAsync(new Uint8Array(bytes).buffer, "");
}
export function disposeModel(scene: import("three").Object3D) { scene.traverse(object => { if (!(object instanceof Mesh)) return; object.geometry.dispose(); for (const material of Array.isArray(object.material) ? object.material : [object.material]) { for (const value of Object.values(material)) if (value && typeof value === "object" && "isTexture" in value && "dispose" in value) (value as import("three").Texture).dispose(); material.dispose(); } }); }
export async function validateGlb(bytes: Uint8Array) {
  const model = await loadGlb(bytes);
  try { const size = new Box3().setFromObject(model.scene).getSize(new Vector3()).multiplyScalar(1000); if (![size.x, size.y, size.z].every(v => Number.isFinite(v) && v > 0 && v < 1e7)) throw new Error("The model has invalid or empty bounds."); return { x: size.x, y: size.y, z: size.z }; } finally { disposeModel(model.scene); }
}
export interface AssetRepository { getAsset(id: string): Promise<AssetDefinition | null>; getAssetBlob(id: string): Promise<Blob>; listAssets(): Promise<AssetDefinition[]>; importLocalAsset(file: File): Promise<AssetDefinition>; }
export class LocalAssetRepository implements AssetRepository {
  async getAsset(id: string) { const db = await localDatabase(); const value = await requestValue(db.transaction("assets").objectStore("assets").get(id)); return value ? assetSchema.parse(value.metadata) : null; }
  async getAssetBlob(id: string) { const db = await localDatabase(); const value = await requestValue(db.transaction("assets").objectStore("assets").get(id)); if (!value?.blob) throw new Error("Local model is missing. Reopen a complete .floorplan3d backup."); return value.blob as Blob; }
  async listAssets() { const db = await localDatabase(); return (await requestValue(db.transaction("assets").objectStore("assets").getAll())).map(v => assetSchema.parse(v.metadata)); }
  async importLocalAsset(file: File) {
    if (!file.name.toLowerCase().endsWith(".glb") || file.size > MAX_GLB_BYTES) throw new Error("Choose a .glb file of 50 MB or less.");
    const bytes = new Uint8Array(await file.arrayBuffer()); const bounds = await validateGlb(bytes); const hash = await contentHash(bytes);
    const existing = (await this.listAssets()).find(a => a.contentHash === hash); if (existing) return existing;
    const metadata: AssetDefinition = { assetId: `local-${hash}`, assetVersion: 1, name: file.name.slice(0, 200), source: "local", modelFormat: "glb", contentHash: hash, byteSize: bytes.length, computedBoundsMm: bounds, geometryAuthority: "visual-only", createdAt: new Date().toISOString() };
    const db = await localDatabase(), tx = db.transaction("assets", "readwrite"), done = completed(tx); tx.objectStore("assets").put({ metadata, blob: new Blob([bytes], { type: "model/gltf-binary" }) }, metadata.assetId); await done; return metadata;
  }
}
export const assetRepository = new LocalAssetRepository();
// Built-in procedural objects already resolve model_id/representation_key in the existing renderer.
export function resolveBuiltInAsset(obstacle: { model_id?: string; representation_key?: string }) { return { assetId: obstacle.model_id ?? obstacle.representation_key ?? "builtin-box", assetVersion: 1, representation: obstacle.representation_key ?? "builtin-box", source: "builtin" as const }; }
