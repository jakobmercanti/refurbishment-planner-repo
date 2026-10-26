import { unzipSync, zipSync } from "fflate";

const MAX_ENTRIES = 5000, MAX_FILE = 128 * 1024**2, MAX_TOTAL = 512 * 1024**2;
export interface CFDArchiveEntry { name: string; size: number }
const safeName = (name: string) => !!name && name.length <= 500 && !name.includes("\\") && !name.startsWith("/") && !name.includes(":") && !name.split("/").some(p => p === ".." || p === "." || Object.hasOwn(Object.prototype,p) || p === "prototype");

/** Inspect the ZIP directory without expanding every native field into memory. */
export function archiveEntries(bytes: Uint8Array): CFDArchiveEntry[] {
  if (bytes.length > MAX_FILE) throw new Error("Native archive exceeds the 128 MB browser limit.");
  const entries: CFDArchiveEntry[] = []; let total = 0, count = 0;
  unzipSync(bytes, { filter: entry => {
    if (!safeName(entry.name) || entry.originalSize > MAX_FILE) throw new Error("Unsafe or oversized archive entry.");
    total += entry.originalSize;
    if (total > MAX_TOTAL || ++count > MAX_ENTRIES) throw new Error("Archive exceeds the bounded browser folder limit. Download the ZIP instead.");
    if (!entry.name.endsWith("/")) entries.push({name: entry.name, size: entry.originalSize});
    return false;
  } });
  if (new Set(entries.map(entry => entry.name)).size !== entries.length) throw new Error("Archive has duplicate file names.");
  return entries.sort((a,b) => a.name.localeCompare(b.name));
}
export function archiveFile(bytes: Uint8Array, name: string): File {
  const entry = archiveEntries(bytes).find(entry => entry.name === name);
  if (!entry) throw new Error("File not found in the verified archive.");
  const output = unzipSync(bytes, { filter: item => item.name === name });
  return new File([output[name] as Uint8Array<ArrayBuffer>], name.split("/").pop()!, {type:"application/octet-stream"});
}
export function postprocessingArchive(bytes: Uint8Array): File {
  const entries = archiveEntries(bytes).filter(entry => entry.name.startsWith("postProcessing/"));
  if (!entries.length) throw new Error("This job archive contains no post-processing output. Download its native case and inspect the solver log.");
  if (entries.reduce((size,entry) => size+entry.size,0) > 64*1024**2) throw new Error("Post-processing output exceeds the 64 MB browser packaging limit. Download the full native case ZIP instead.");
  const names = new Set(entries.map(entry=>entry.name));
  const data = unzipSync(bytes, {filter: entry => names.has(entry.name)});
  return new File([zipSync(data, {level:1}) as Uint8Array<ArrayBuffer>], "postprocessing.zip", {type:"application/zip"});
}
