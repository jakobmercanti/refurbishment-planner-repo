import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { roofProject } from "./roofBalustradeFixtures";
import { newCFDScenario } from "../lib/climoptixDocument";
import type { CFDReport } from "../lib/climoptix";
import type { ProjectDocument } from "../lib/projectDocument";
import { parseScene, type CFDScene } from "../lib/climoptixScene";

export function realScene(project: ProjectDocument): CFDScene {
  const root = fileURLToPath(new URL("../../", import.meta.url));
  const python = path.join(root, ".venv", process.platform === "win32" ? "Scripts/python.exe" : "bin/python");
  const result = spawnSync(python, ["-X", "utf8", "-c", "import json,sys; from geometry.climoptix_scene import building_scene; print(json.dumps(building_scene(json.load(sys.stdin))))"], {
    cwd: root, input: JSON.stringify(project), encoding: "utf8", timeout: 25000, maxBuffer: 12 * 1024 * 1024,
  });
  if (result.status !== 0) throw new Error(result.stderr || result.error?.message || "Building geometry failed");
  return parseScene(JSON.parse(result.stdout));
}

export function realExampleProjects(): Record<string, ProjectDocument> {
  const root = fileURLToPath(new URL("../../", import.meta.url));
  const python = path.join(
    root,
    ".venv",
    process.platform === "win32" ? "Scripts/python.exe" : "bin/python",
  );
  const result = spawnSync(
    python,
    [
      "-X", "utf8", "-c",
      "import json; from scripts.audit_climoptix import example_projects; print(json.dumps(example_projects()))",
    ],
    { cwd: root, encoding: "utf8", timeout: 15000, maxBuffer: 4 * 1024 * 1024 },
  );
  if (result.status !== 0)
    throw new Error(
      result.stderr || result.error?.message || "Example generation failed",
    );
  return JSON.parse(result.stdout);
}

export function cfdProject(passage = true): ProjectDocument {
  const p = roofProject();
  const key = passage ? "door-opening-single" : "door-single";
  p.floorplan!.openings = [
    {
      id: "shared-aperture",
      kind: "DOOR",
      wallId: "wall-0",
      segmentIndex: 1,
      offset: 2200,
      width: 1000,
      height: 2100,
      sill: 0,
      hingeSide: "START",
      doorType: "SINGLE",
      opensInward: true,
      representationKey: key,
    },
  ];
  const mm = (value: number) => ({
    value,
    uncertainty_mm: 5,
    verified: false,
    source_type: "USER_MEASURED",
  });
  p.rooms.forEach((r, i) => {
    r.openings = [
      {
        id: "shared-aperture",
        kind: "DOOR",
        parent_wall_id: i ? "wall-004" : "wall-002",
        offset_mm: i ? 2800 : 2200,
        width: mm(1000),
        height: mm(2100),
        sill_height_mm: 0,
        swing_angle_deg: 90,
        hinge_side: "START",
        door_type: "SINGLE",
        opens_inward: true,
        metadata: { representation_key: key },
        ...(passage ? { passage_profile: "RECTANGULAR" as const } : {}),
      },
    ];
  });
  const s = newCFDScenario(p.projectId, "Office airflow");
  s.seed = { floorId: p.building!.floors[0].id, roomId: p.rooms[0].id };
  p.cfdScenarios = [s];
  return p;
}
/** The browser exercises the real deterministic provider, not a synthetic result fixture. */
export function realPreparation(request: {
  project: ProjectDocument;
  scenario: unknown;
  clientRevision: string;
}): CFDReport {
  const root = fileURLToPath(new URL("../../", import.meta.url));
  const python = path.join(
    root,
    ".venv",
    process.platform === "win32" ? "Scripts/python.exe" : "bin/python",
  );
  const result = spawnSync(
    python,
    [
      "-X", "utf8", "-c",
      "import json,sys; from geometry.climoptix_models import Scenario; from backend.app.climoptix_provider import PreparationOnlyProvider; data=json.load(sys.stdin); print(json.dumps(PreparationOnlyProvider().validate_scenario(data['project'], Scenario.model_validate(data['scenario']), data['clientRevision'])))",
    ],
    {
      cwd: root,
      input: JSON.stringify(request),
      encoding: "utf8",
      timeout: 25000,
      maxBuffer: 12 * 1024 * 1024,
    },
  );
  if (result.status !== 0)
    throw new Error(
      result.stderr || result.error?.message || "Python provider failed",
    );
  return JSON.parse(result.stdout) as CFDReport;
}
