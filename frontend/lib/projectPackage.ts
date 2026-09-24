import { unzipSync, zipSync, strFromU8, strToU8 } from "fflate";
import { assetRepository, contentHash, validateGlb, MAX_GLB_BYTES } from "./assetRepository";
import { completed, localDatabase } from "./localDatabase";
import { parseProject, type ProjectDocument } from "./projectDocument";

const MAX_PACKAGE = 200 * 1024 * 1024;
const MAX_MANIFEST = 8 * 1024 * 1024;
export async function exportProject(project: ProjectDocument): Promise<Blob> {
  const referenced = new Set(project.assetInstances.map(i => i.assetId));
  const p = parseProject({ ...project, assets: project.assets.filter(a => referenced.has(a.assetId)) });
  const manifest = strToU8(JSON.stringify({ packageVersion: 1, builtinCatalogueVersion: 1, project: p }));
  if (manifest.length > MAX_MANIFEST) throw new Error("Project metadata exceeds 8 MB.");
  const entries: Record<string, Uint8Array> = { "manifest.json": manifest }; let total = manifest.length;
  for (const asset of p.assets) { const blob = await assetRepository.getAssetBlob(asset.assetId); total += blob.size; if (total > MAX_PACKAGE) throw new Error("Project exceeds the 200 MB package limit."); const bytes = new Uint8Array(await blob.arrayBuffer()); if (await contentHash(bytes) !== asset.contentHash) throw new Error("Local model is damaged."); entries[`assets/${asset.assetId}/model.glb`] = bytes; }
  return new Blob([new Uint8Array(zipSync(entries, { level: 0 }))], { type: "application/zip" });
}
export function inspectPackage(bytes: Uint8Array) {
  if (bytes.length > MAX_PACKAGE) throw new Error("Project package exceeds 200 MB.");
  let total = 0, count = 0; const seen = new Set<string>();
  const entries = unzipSync(bytes, { filter(entry) {
    if (++count > 101 || seen.has(entry.name)) throw new Error("Too many or duplicate archive entries.");
    seen.add(entry.name);
    if (entry.name !== "manifest.json" && !/^assets\/[\w:-]+\/model\.glb$/.test(entry.name)) throw new Error("Unsafe or unsupported package path.");
    const limit = entry.name === "manifest.json" ? MAX_MANIFEST : MAX_GLB_BYTES;
    if (entry.originalSize > limit || (total += entry.originalSize) > MAX_PACKAGE) throw new Error("Expanded project package exceeds its size limit.");
    return true;
  } });
  if (!entries["manifest.json"]) throw new Error("Project manifest is missing.");
  const manifest = JSON.parse(strFromU8(entries["manifest.json"]));
  if (manifest.packageVersion !== 1 || manifest.builtinCatalogueVersion !== 1) throw new Error("Unsupported package or built-in catalogue version.");
  const project = parseProject(manifest.project);
  if (Object.keys(entries).length !== project.assets.length + 1) throw new Error("Package contains unregistered assets.");
  return { project, entries };
}
export async function importProject(file: File): Promise<ProjectDocument> {
  if (file.size > MAX_PACKAGE) throw new Error("Project package exceeds 200 MB.");
  const { project, entries } = inspectPackage(new Uint8Array(await file.arrayBuffer()));
  const assets = [];
  for (const a of project.assets) {
    const bytes = entries[`assets/${a.assetId}/model.glb`];
    if (!bytes || bytes.length !== a.byteSize || await contentHash(bytes) !== a.contentHash) throw new Error("A packaged model is missing or damaged.");
    const bounds = await validateGlb(bytes);
    if (["x", "y", "z"].some(axis => Math.abs(bounds[axis as keyof typeof bounds] - a.computedBoundsMm[axis as keyof typeof bounds]) > .01)) throw new Error("Packaged model bounds do not match its metadata.");
    assets.push({ metadata: a, blob: new Blob([new Uint8Array(bytes)], { type: "model/gltf-binary" }) });
  }
  // All expensive parsing happens before the transaction; failed imports write nothing.
  const db = await localDatabase(), tx = db.transaction(["projects", "backups", "assets", "meta"], "readwrite"), done = completed(tx);
  const previous = tx.objectStore("projects").get(project.projectId);
  previous.onsuccess = () => { if (previous.result) { try { tx.objectStore("backups").put(parseProject(previous.result), project.projectId); } catch { /* retain backup */ } } };
  for (const a of assets) tx.objectStore("assets").put(a, a.metadata.assetId);
  tx.objectStore("projects").put(project, project.projectId); tx.objectStore("meta").put(project.projectId, "current"); await done;
  return project;
}
