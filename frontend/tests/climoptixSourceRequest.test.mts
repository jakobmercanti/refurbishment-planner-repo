import assert from "node:assert/strict";
import test from "node:test";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { cfdProject } from "./climoptixFixtures";
import { preparationRequestBody } from "../lib/climoptix";
import { duplicateFloor } from "../lib/buildingDocument";

function publicEndpoints(body: string) {
  const root = fileURLToPath(new URL("../../", import.meta.url));
  const result = spawnSync(path.join(root, ".venv", process.platform === "win32" ? "Scripts/python.exe" : "bin/python"), ["-X", "utf8", "-c", `
import json,sys
from backend.app.climoptix_api import prepare,geometry,PreparationRequest,GeometryRequest
from fastapi import HTTPException
data=json.load(sys.stdin)
try:
    report=prepare(PreparationRequest.model_validate(data))
    scene=geometry(GeometryRequest(project=data['project']))
    print(json.dumps({'report':report,'scene':scene}))
except HTTPException as error:
    print(json.dumps({'error':error.detail,'status':error.status_code}))
`], { cwd: root, input: body, encoding: "utf8", timeout: 30000, maxBuffer: 12 * 1024 * 1024 });
  if (result.status !== 0) throw new Error(result.stderr || result.error?.message || "Public API check failed");
  return JSON.parse(result.stdout);
}

test("public CFD endpoints accept measured geometry with drawing-only empty and planner-prefixed symbol URLs omitted, without mutating the document", () => {
  const base = cfdProject();
  const p = duplicateFloor(base, base.building!.activeFloorId);
  const contents = [p, ...p.building!.floors.flatMap(f => f.content ? [f.content] : [])];
  for (const content of contents) {
    for (const room of content.rooms) {
      for (const opening of room.openings) {
        opening.metadata = { ...opening.metadata, plan_symbol_url: "/planner/fixture-symbols/door.svg", plan_symbol_data_url: "", planSymbolUrl: "" };
      }
      room.obstacles = [{ id: `symbol-${room.id}`, name: "Visual symbol", kind: "BOX", fixture_kind: "FURNITURE", representation_key: "electrical-pendant-dome",
        center: { x: 1000, y: 1000 }, rotation_deg: 0, base_z_mm: 1500, verified: false,
        dimensions: { width: { value: 100, verified: true }, depth: { value: 100, verified: true }, height: { value: 100, verified: true } },
        plan_symbol_url: "/planner/fixture-symbols/light.svg", plan_symbol_data_url: "" }];
    }
    for (const opening of content.floorplan?.openings ?? []) Object.assign(opening, { planSymbolUrl: "/planner/fixture-symbols/door.svg", planSymbolDataUrl: "" });
  }
  const before = structuredClone(p), s = p.cfdScenarios![0];
  const raw = JSON.stringify({ project: p, scenario: { ...s, group: undefined }, clientRevision: "a".repeat(64) });
  assert.match(publicEndpoints(raw).error, /external resource reference/);
  const body = preparationRequestBody(p, s, "a".repeat(64));
  assert.equal(/plan_symbol_url|plan_symbol_data_url|planSymbolUrl|planSymbolDataUrl/.test(body), false);
  const sent = JSON.parse(body);
  assert.deepEqual(sent.project.rooms[0].vertices, p.rooms[0].vertices);
  assert.equal(sent.project.rooms[0].openings[0].metadata.representation_key, "door-opening-single");
  assert.deepEqual(sent.project.rooms[0].openings[0].width, p.rooms[0].openings[0].width);
  const checked = publicEndpoints(body);
  assert.equal(checked.error, undefined);
  assert.ok(checked.report.patches.length > 0);
  assert.ok(checked.scene.patches.length > 0);
  assert.deepEqual(p, before);
  sent.project.rooms[0].obstacles[0].unexpected_url = "https://example.invalid/private";
  assert.match(publicEndpoints(JSON.stringify(sent)).error, /external resource reference/, "Unknown external references remain blocked by the server");
});
