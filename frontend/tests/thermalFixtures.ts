import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { cfdProject } from "./climoptixFixtures";
import { newEnergyProject } from "../lib/energyDocument";
import {
  thermalSetupSchema,
  thermalPackageSchema,
  type ThermalPackage,
} from "../lib/thermalDocument";
import type { CFDScenario } from "../lib/climoptixDocument";
import type { ProjectDocument } from "../lib/projectDocument";
import { parseProject } from "../lib/projectDocument";

export function thermalProject(passage = true): ProjectDocument {
  const p = cfdProject(passage),
    energy = newEnergyProject();
  energy.materials.push({
    materialId: "test-insulation",
    name: "Synthetic insulation",
    lambda: 0.04,
    density: null,
    vapourResistance: null,
    category: "Synthetic",
    reference: "Offline analytical fixture",
    editable: true,
  });
  for (const category of ["wall", "floor", "roof"] as const)
    energy.assemblies.push({
      assemblyId: `test-${category}`,
      name: `Analytical ${category}`,
      category,
      rsi: 0.13,
      rse: 0.04,
      directUValue: null,
      notes: "Synthetic, not a regulatory construction",
      layers: [
        {
          layerId: `layer-${category}`,
          materialId: "test-insulation",
          thicknessMm: 100,
          resistanceOverride: null,
          position: "Within",
          upgrade: false,
        },
      ],
    });
  energy.existingAssignments = p.rooms.flatMap((r) =>
    ["floor", "roof", "wall:0", "wall:1", "wall:2", "wall:3"].map((key) => ({
      elementId: `${r.id}|${key}`,
      assemblyId: `test-${key.split(":")[0]}`,
      uValue: null,
    })),
  );
  p.energyLayout = energy;
  const s = p.cfdScenarios![0];
  s.physics.energy = true;
  s.thermalEnvelope = thermalSetupSchema.parse({
    location: {
      name: "Offline fixture",
      latitude: 51.5,
      longitude: 0,
      timezone: "UTC",
      source: "Synthetic analytical coordinates",
    },
    localDateTime: "2026-06-21T12:00",
    weather: { temperatureC: 20, source: "Offline weather fixture" },
    airExchange: { mode: "none" },
    groundTemperatureC: 20,
    assumptionsAccepted: true,
  });
  return parseProject(p);
}
export function realThermal(
  request: {
    project: ProjectDocument;
    scenario: CFDScenario;
    clientRevision: string;
  },
  calculate = true,
): ThermalPackage {
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
      "import json,sys; from geometry.climoptix_models import Scenario; from backend.app.climoptix_provider import PreparationOnlyProvider; from geometry.thermal_balance import thermal_package; d=json.load(sys.stdin); s=Scenario.model_validate(d['scenario']); r=PreparationOnlyProvider().validate_scenario(d['project'],s,d['clientRevision']); print(thermal_package(d['project'],s,r,calculate=" +
        (calculate ? "True" : "False") +
        ").model_dump_json())",
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
      result.stderr || result.error?.message || "Thermal provider failed",
    );
  return thermalPackageSchema.parse(JSON.parse(result.stdout));
}
