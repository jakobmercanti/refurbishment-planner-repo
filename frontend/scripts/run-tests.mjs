import { readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const frontend = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const extensions = "(?:[cm]?[jt]s|tsx|jsx)";

export function testSuite(filename) {
  if (new RegExp(`\\.browser\\.${extensions}$`).test(filename)) return "browser";
  if (new RegExp(`\\.integration\\.${extensions}$`).test(filename)) return "projects";
  if (new RegExp(`\\.test\\.${extensions}$`).test(filename)) return "unit";
  return null;
}

export function discoverTests(directory, suite) {
  if (!["unit", "projects", "browser"].includes(suite)) throw new Error(`Unknown test suite: ${suite}`);
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const location = path.join(directory, entry.name);
    if (entry.isDirectory()) return discoverTests(location, suite);
    return entry.isFile() && testSuite(entry.name) === suite ? [location] : [];
  }).sort();
}

export function requireTests(directory, suite) {
  const files = discoverTests(directory, suite);
  if (!files.length) throw new Error(`No tests discovered for ${suite}; refusing an empty successful run.`);
  return files;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const suite = process.argv[2] ?? "unit";
  const files = requireTests(path.join(frontend, "tests"), suite);
  console.log(`Running ${suite}: ${files.length} test files`);
  const result = spawnSync(process.execPath, [
    fileURLToPath(import.meta.resolve("tsx/cli")), "--require", path.join(frontend, "tests/css-register.cjs"),
    "--test", ...(suite === "browser" ? ["--test-concurrency=1"] : []), ...process.argv.slice(3), ...files,
  ], { cwd: frontend, stdio: "inherit", env: process.env });
  if (result.error) throw result.error;
  process.exitCode = result.status ?? 1;
}
