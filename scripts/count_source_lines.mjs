import fs from "node:fs";
import { execFileSync } from "node:child_process";

// Keep these rules unchanged when comparing with the recorded audit baseline.
const paths = [...new Set(execFileSync("git", ["ls-files", "--cached", "--others", "--exclude-standard"],
  { encoding: "utf8" }).split(/\r?\n/))];
const eligible = file => /\.(?:py|[cm]?[jt]sx?|css|html|sql|sh|ps1)$/.test(file)
  || /(?:^|\/)Dockerfile(?:\.[^/]*)?$/.test(file);
const excluded = file => /^(?:freefloorplan3d-website|\.codex-remote-attachments|frontend\/public|data|\.local-logs|\.agents|\.codex)\//.test(file)
  || /\.d\.(?:ts|mts)$/.test(file);
const testFile = file => /(?:^|\/)(?:tests|test)(?:\/|$)/.test(file)
  || /\.(?:test|browser|integration)\.[^.]+$/.test(file);
const cfd = file => /(?:climoptix|openfoam|(?:^|[/_.-])cfd)/i.test(file);
const files = paths.filter(file => file && eligible(file) && !excluded(file)
  && fs.existsSync(file) && fs.statSync(file).isFile()).map(file => {
  const source = fs.readFileSync(file, "utf8");
  const lines = source ? source.split(/\r?\n/) : [];
  if (lines.at(-1) === "") lines.pop();
  return { file, lines: lines.length, nonblank: lines.filter(line => line.trim()).length,
    test: testFile(file), cfd: cfd(file) };
});
const sum = rows => ({ files: rows.length, lines: rows.reduce((total, file) => total + file.lines, 0),
  nonblank: rows.reduce((total, file) => total + file.nonblank, 0) });

console.log(JSON.stringify({
  capturedAt: new Date().toISOString(),
  head: execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(),
  method: "Physical source lines including comments and blanks; nonblank reported separately. Git indexed and nonignored untracked source files. Excludes vendor/public assets, data, declarations, nested website gitlink, attachments and generated/ignored output. Extensions: py, JS/TS variants, css, html, sql, sh, ps1, Dockerfiles.",
  total: sum(files), production: sum(files.filter(file => !file.test)), tests: sum(files.filter(file => file.test)),
  cfdProduction: sum(files.filter(file => file.cfd && !file.test)), cfdTests: sum(files.filter(file => file.cfd && file.test)),
  files,
}));
