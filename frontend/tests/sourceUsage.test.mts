import assert from "node:assert/strict";
import test from "node:test";
import { moduleSpecifiers, sourceUsage } from "../scripts/check-source-usage.mjs";

test("source usage includes static, dynamic, type and worker imports", () => {
  assert.deepEqual(moduleSpecifiers(`
    import A from './a'; export { B } from './b';
    const lazy = import('./lazy'); const legacy = require('./legacy');
    type T = import('./types').T;
    new Worker(new URL('./worker.ts', import.meta.url));
    new URL('./photo.png', import.meta.url);
  `), ["./a", "./b", "./lazy", "./legacy", "./types", "./worker.ts"]);
});

test("real edge catalogue and browser worker remain reachable", () => {
  const result = sourceUsage();
  assert(result.reachable.has("frontend/lib/commercialCatalogue.ts"));
  assert(result.reachable.has("frontend/lib/heatingWorker.ts"));
  assert(result.reachable.has("frontend/types/vtk-legacy.d.ts"));
  assert.deepEqual(result.unused, []);
});
