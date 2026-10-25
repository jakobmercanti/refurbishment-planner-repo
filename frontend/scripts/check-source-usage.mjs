/** Detect orphaned first-party frontend modules, including edge and worker imports. */
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const repository = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

export function moduleSpecifiers(source) {
  const ast = ts.createSourceFile("source.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const specifiers = [];
  const visit = (node) => {
    if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
      specifiers.push(node.moduleSpecifier.text);
    }
    if (ts.isCallExpression(node) && (node.expression.kind === ts.SyntaxKind.ImportKeyword || ts.isIdentifier(node.expression) && node.expression.text === "require") && node.arguments[0] && ts.isStringLiteral(node.arguments[0])) {
      specifiers.push(node.arguments[0].text);
    }
    if (ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument) && ts.isStringLiteral(node.argument.literal)) {
      specifiers.push(node.argument.literal.text);
    }
    // Webpack compiles workers referenced by new Worker(new URL(..., import.meta.url)).
    if (ts.isNewExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === "URL" && node.arguments?.[0] && ts.isStringLiteral(node.arguments[0]) && /\.[cm]?[jt]sx?$/.test(node.arguments[0].text)) {
      specifiers.push(node.arguments[0].text);
    }
    ts.forEachChild(node, visit);
  };
  visit(ast);
  return [...new Set(specifiers)];
}

export function sourceUsage() {
  const files = execFileSync("git", ["ls-files", "--cached", "--others", "--exclude-standard", "--", "frontend", "deployment"], { cwd: repository, encoding: "utf8" }).trim().split(/\r?\n/);
  const sources = [...new Set(files)].filter((file) => /^(?:frontend|deployment)\//.test(file) && /\.[cm]?[jt]sx?$/.test(file) && !file.startsWith("frontend/public/") && fs.existsSync(path.join(repository, file)));
  const configPath = path.join(repository, "frontend/tsconfig.json");
  const config = ts.readConfigFile(configPath, ts.sys.readFile);
  if (config.error) throw new Error(ts.flattenDiagnosticMessageText(config.error.messageText, "\n"));
  const options = ts.parseJsonConfigFileContent(config.config, ts.sys, path.dirname(configPath)).options;
  const sourceSet = new Set(sources);
  const edges = new Map(sources.map((file) => [file, moduleSpecifiers(fs.readFileSync(path.join(repository, file), "utf8"))
    .map((specifier) => ts.resolveModuleName(specifier, path.join(repository, file), options, ts.sys).resolvedModule?.resolvedFileName)
    .filter(Boolean).map((resolved) => path.relative(repository, resolved).replaceAll(path.sep, "/"))
    .filter((resolved) => sourceSet.has(resolved))]));
  const roots = sources.filter((file) =>
    /^frontend\/app\/(?:.*\/)?(?:page|layout|route|template|loading|error|global-error|not-found|default|robots|sitemap|manifest|icon|apple-icon|opengraph-image|twitter-image)\.[jt]sx?$/.test(file) ||
    /^frontend\/(?:[^/]+config\.[cm]?[jt]s|next-env\.d\.ts|scripts\/|tests\/)/.test(file) ||
    /^frontend\/types\/.*\.d\.ts$/.test(file) || // Ambient declarations are loaded by tsconfig, not runtime imports.
    file.startsWith("deployment/"));
  const reachable = new Set();
  const queue = [...roots];
  while (queue.length) {
    const file = queue.pop();
    if (reachable.has(file)) continue;
    reachable.add(file);
    queue.push(...(edges.get(file) ?? []));
  }
  return { count: sources.length, reachable, unused: sources.filter((file) => !reachable.has(file)) };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = sourceUsage();
  if (result.unused.length) {
    console.error("Unreferenced source modules (check framework/worker entry points before deleting):\n" + result.unused.join("\n"));
    process.exitCode = 1;
  } else {
    console.log(`Source usage checked: ${result.count} modules, no orphaned modules.`);
  }
}
