import { copyFile, mkdir } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const frontendRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const packageDist = join(frontendRoot, "node_modules", "occt-import-js", "dist");
const publicRuntime = join(frontendRoot, "public", "vendor", "occt-import-js");
const runtimeFiles = [
  "occt-import-js.js",
  "occt-import-js.wasm",
  "occt-import-js-worker.js",
  "license.occt-import-js.txt",
  "license.occt.txt",
];

await mkdir(publicRuntime, { recursive: true });
await Promise.all(runtimeFiles.map(file => copyFile(join(packageDist, file), join(publicRuntime, file))));
console.log(`Prepared ${runtimeFiles.length} OCCT runtime and license files for the browser.`);
