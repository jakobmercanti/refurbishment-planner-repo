import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
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
  assert.deepEqual(result.unused, []);
});

test("retired billing styles cannot override the SVG drawing grid", () => {
  const css = readFileSync(new URL("../app/commercial.css", import.meta.url), "utf8");
  assert.doesNotMatch(css, /\.(?:plan-grid|plan-card|free-planner-note|pack-grid)\b/);
  assert.match(css, /\.account-dialog-content/);
});
