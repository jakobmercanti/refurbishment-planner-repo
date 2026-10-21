import assert from "node:assert/strict";
import test from "node:test";
import {
  cfdScenarioSchema,
  duplicateCFDScenario,
  meshPreset,
  physicsPreset,
  ventSchema,
} from "../lib/climoptixDocument";
import {
  preparationInput,
  preparationRevision,
  boundarySurfaceSTL,
  preparationPackage,
  scenarioImport,
  prepareCFD,
  preparationSummary,
} from "../lib/climoptix";
import { parseProject } from "../lib/projectDocument";
import { selectFloor, duplicateFloor } from "../lib/buildingDocument";
import { unzipSync, strFromU8 } from "fflate";
import { cfdProject, realPreparation } from "./climoptixFixtures";
import {
  structuralFloorFootprint,
  roofFrame,
  roofHeightAt,
} from "../lib/buildingGeometry";

test("scenario defaults and all documented mesh/physics presets are valid and independent", () => {
  const p = cfdProject(),
    s = p.cfdScenarios![0],
    copy = duplicateCFDScenario(s);
  assert.notEqual(copy.id, s.id);
  assert.equal(copy.validation, null);
  copy.physics.densityKgM3 = 1.3;
  assert.notEqual(copy.physics.densityKgM3, s.physics.densityKgM3);
  for (const preset of ["isothermal", "buoyant", "co2", "custom"] as const)
    assert.doesNotThrow(() =>
      cfdScenarioSchema.parse({ ...s, physics: physicsPreset(preset) }),
    );
  for (const preset of ["Draft", "Standard", "Fine", "Custom"] as const)
    assert.doesNotThrow(() =>
      cfdScenarioSchema.parse({ ...s, mesh: meshPreset(preset) }),
    );
});
test("schema rejects incompatible physics, conflicting controls, invalid units and future versions", () => {
  const s = cfdProject().cfdScenarios![0];
  for (const changed of [
    { ...s, version: 2 },
    { ...s, physics: { ...s.physics, densityKgM3: Infinity } },
    { ...s, physics: { ...s.physics, boussinesq: true, energy: false } },
    {
      ...s,
      physics: {
        ...s.physics,
        time: { ...s.physics.time, endS: 10, statisticsStartS: 20 },
      },
    },
    { ...s, mesh: { ...s.mesh, minCellMm: 500 } },
    { ...s, mesh: { ...s.mesh, minCellMm: 1e-151, baseCellMm: 1e-150 } },
    { ...s, mesh: { ...s.mesh, maxCellMm: 1e100 } },
  ])
    assert.equal(cfdScenarioSchema.safeParse(changed).success, false);
  assert.equal(
    ventSchema.safeParse({
      id: "v",
      name: "Supply",
      role: "supply",
      host: { patchId: "room:wall" },
      valueSI: -2,
    }).success,
    false,
  );
  assert.equal(
    ventSchema.safeParse({
      id: "v",
      name: "Supply",
      role: "supply",
      host: { patchId: "host" },
      openAreaFraction: 1e-320,
    }).success,
    false,
  );
  assert.equal(
    ventSchema.safeParse({
      id: "v",
      name: "Supply",
      role: "supply",
      host: { patchId: "room:wall" },
      control: "pressure",
      pressurePa: 20,
      volumeFlow: 1,
    }).success,
    false,
  );
});
test("old projects stay scenario-free; duplicate IDs and cross-project studies cannot silently import", () => {
  const p = cfdProject();
  delete p.cfdScenarios;
  assert.equal(parseProject(p).cfdScenarios, undefined);
  const s = cfdProject().cfdScenarios![0];
  assert.throws(() => parseProject({ ...p, cfdScenarios: [s] }));
  const imported = scenarioImport(s, p.projectId);
  assert.equal(imported.sourceBuildingId, p.projectId);
  assert.notEqual(imported.id, s.id);
  assert.equal(imported.validation, null);
  assert.throws(() =>
    parseProject({ ...p, cfdScenarios: [imported, imported] }),
  );
});
test("staleness fingerprints track topology, ceilings, objects and setup but not camera, names or active-floor projection", async () => {
  let p = cfdProject();
  p = duplicateFloor(p, p.building!.activeFloorId);
  const s = p.cfdScenarios![0];
  const before = preparationInput(p, s),
    hash = await preparationRevision(before);
  assert.equal(hash.length, 64);
  const view = selectFloor({ ...p, name: "Renamed" }, p.building!.floors[0].id);
  assert.equal(preparationInput(view, s), before);
  assert.equal(
    preparationInput(p, {
      ...s,
      name: "Other",
      updatedAt: new Date().toISOString(),
    }),
    before,
  );
  const edits = structuredClone(p);
  edits.building!.roof.lowHeightMm += 20;
  assert.notEqual(preparationInput(edits, s), before);
  assert.notEqual(
    preparationInput(p, { ...s, physics: physicsPreset("co2") }),
    before,
  );
});
test("real Python/TypeScript contracts agree; ZIP contains honest provenance and closed SI boundary, not a solver case", async () => {
  const p = cfdProject(),
    s = p.cfdScenarios![0],
    revision = await preparationRevision(preparationInput(p, s));
  const report = realPreparation({
    project: p,
    scenario: s,
    clientRevision: revision,
  });
  assert.equal(report.surface.exportable, true);
  assert.equal(report.provider.canRun, false);
  assert.equal(report.resultManifest, null);
  assert.doesNotThrow(() =>
    cfdScenarioSchema.parse({ ...s, validation: report.validation }),
  );
  const stl = boundarySurfaceSTL(report, revision);
  assert.match(stl, /solid climoptix_boundary_metres/);
  assert.match(stl, /vertex 4(?:\.\d*)? /);
  assert.throws(() => boundarySurfaceSTL(report, "b".repeat(64)), /Validate/);
  const entries = unzipSync(
    new Uint8Array(await preparationPackage(s, report, revision).arrayBuffer()),
  );
  assert.deepEqual(Object.keys(entries).sort(), [
    "README.txt",
    "boundary-metres.stl",
    "preparation.json",
    "scenario.json",
    "summary.txt",
  ]);
  assert.equal(
    JSON.parse(strFromU8(entries["preparation.json"])).caseGenerated,
    false,
  );
  assert.match(
    strFromU8(entries["summary.txt"]),
    /No mesher, solver or optimizer/,
  );
  assert.match(preparationSummary(s, report, revision), /PATCH CONDITIONS/);
  assert.throws(() => preparationSummary(s, report, "b".repeat(64)), /stale/);
  const blocked = {
    ...report,
    surface: { ...report.surface, exportable: false },
  };
  const withoutSurface = unzipSync(
    new Uint8Array(
      await preparationPackage(s, blocked, revision).arrayBuffer(),
    ),
  );
  assert.equal(withoutSurface["boundary-metres.stl"], undefined);
});

test("CFD interior roof heights match authoritative planner frames with asymmetric wall thickness", () => {
  for (const type of ["MONO", "GABLE", "STEPPED"] as const) {
    const p = cfdProject(false);
    p.rooms[0].wall_thickness_overrides_mm = {
      "wall-001": 225,
      "wall-002": 140,
      "wall-003": 75,
      "wall-004": 180,
    };
    p.building!.roof = {
      ...p.building!.roof,
      type,
      orientationDeg: 37,
      lowHeightMm: 2200,
      highHeightMm: 3400,
    };
    const r = p.building!.roof,
      frame = roofFrame(structuralFloorFootprint(p), r);
    const report = realPreparation({
      project: p,
      scenario: p.cfdScenarios![0],
      clientRevision: "a".repeat(64),
    });
    assert.equal(
      report.surface.exportable,
      true,
      JSON.stringify(report.diagnostics),
    );
    const ceilingIds = new Set(
      report.patches.filter((p) => p.kind === "ceiling").map((p) => p.id),
    );
    report.surface.triangles.forEach((triangle, i) => {
      if (!ceilingIds.has(report.surface.trianglePatches[i])) return;
      for (const index of triangle) {
        const [x, y, z] = report.surface.verticesMm[index];
        // Either side of the stepped seam is legitimate, but neither changes
        // the X/Y frame used by the measured planner roof definition.
        const seam =
          Math.abs(
            x * frame.ux +
              y * frame.uy -
              (frame.min + (frame.max - frame.min) * r.splitFraction),
          ) < 1e-5;
        if (type === "STEPPED" && seam)
          assert.ok(
            Math.min(
              Math.abs(z - r.lowHeightMm),
              Math.abs(z - r.highHeightMm),
            ) < 1e-5,
          );
        else
          assert.ok(
            Math.abs(z - roofHeightAt({ x, y }, r, frame)) < 1e-5,
            `${type}: ${x},${y},${z}`,
          );
      }
    });
  }
});

test("preparation strips unrelated private layouts and rejects incomplete or inconsistent reports", async () => {
  const p = cfdProject(),
    s = p.cfdScenarios![0],
    revision = "a".repeat(64);
  const report = realPreparation({
    project: p,
    scenario: s,
    clientRevision: revision,
  });
  const originalFetch = globalThis.fetch;
  try {
    let reply: unknown = report;
    globalThis.fetch = async (_url, options) => {
      const body = JSON.parse(String(options!.body));
      assert.equal(body.project.cfdScenarios, undefined);
      assert.equal(body.project.electricalLayout, undefined);
      assert.equal(body.project.renderCamera, undefined);
      assert.deepEqual(body.project.quotes, []);
      assert.deepEqual(body.project.floorplan.annotations, []);
      assert.deepEqual(body.project.floorplan.walls, p.floorplan!.walls);
      assert.deepEqual(body.project.rooms[0].openings, p.rooms[0].openings);
      return Response.json(reply);
    };
    assert.equal(
      (await prepareCFD("/api", p, s, revision)).surface.closed,
      true,
    );
    for (const mutate of [
      (r) => delete r.domain,
      (r) => (r.patches[0].host.widthMm = NaN),
      (r) => (r.objects = [{ id: "bad" }]),
      (r) => r.surface.triangleCount++,
      (r) => (r.surface.triangles[0][0] = r.surface.verticesMm.length),
      (r) => (r.surface.closed = false),
      (r) => (r.validation.clientRevision = "b".repeat(64)),
      (r) => (r.provider.canRun = true),
    ]) {
      reply = structuredClone(report);
      mutate(reply);
      await assert.rejects(prepareCFD("/api", p, s, revision));
    }
  } finally {
    globalThis.fetch = originalFetch;
  }
});
