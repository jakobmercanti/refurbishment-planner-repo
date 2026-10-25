import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { testSuite, discoverTests, requireTests } from "../scripts/run-tests.mjs";

test("all supported test extensions are discovered without mixing browser or integration suites", () => {
  for (const extension of ["ts", "tsx", "mts", "cts", "js", "jsx", "mjs", "cjs"]) {
    assert.equal(testSuite(`feature.test.${extension}`), "unit");
    assert.equal(testSuite(`feature.integration.${extension}`), "projects");
    assert.equal(testSuite(`feature.browser.${extension}`), "browser");
  }
  for (const name of ["helper.ts", "component.tsx", "sample.test.json", "not-a-test.mts"]) assert.equal(testSuite(name), null);
});

test("discovery includes nested test files, excludes helpers and fails closed on unknown suites", () => {
  const root = mkdtempSync(path.join(tmpdir(), "planner-discovery-"));
  try {
    assert.throws(() => requireTests(root, "unit"), /No tests discovered/);
    mkdirSync(path.join(root, "nested"));
    for (const name of ["a.test.tsx", "nested/b.test.ts", "c.integration.mts", "d.browser.mts", "helper.ts"]) writeFileSync(path.join(root, name), "");
    assert.deepEqual(discoverTests(root, "unit"), [path.join(root, "a.test.tsx"), path.join(root, "nested/b.test.ts")]);
    assert.equal(requireTests(root, "unit").length, 2);
    assert.deepEqual(discoverTests(root, "projects"), [path.join(root, "c.integration.mts")]);
    assert.deepEqual(discoverTests(root, "browser"), [path.join(root, "d.browser.mts")]);
    assert.throws(() => discoverTests(root, "misspelled"), /Unknown test suite/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
