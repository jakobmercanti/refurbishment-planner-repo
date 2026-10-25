import assert from "node:assert/strict";
import test from "node:test";
import { ventSchema } from "../lib/climoptixDocument";
import {
  ventCenter,
  ventDirection,
  ventFootprint,
  previewScene,
  patchPositions,
  refinementPreviews,
  snapVentUV,
  CFD_SELECTION_COLOUR,
} from "../lib/climoptixPreview";
import { refinementColour } from "../lib/climoptixWorkflow";
import { cfdProject, realPreparation } from "./climoptixFixtures";

test("prescribed direction, UV placement and rotated footprint agree with the actual provider", () => {
  const p = cfdProject(),
    s = p.cfdScenarios![0],
    base = realPreparation({
      project: p,
      scenario: s,
      clientRevision: "a".repeat(64),
    });
  const patch = base.patches.find((p) => p.kind === "ceiling" && p.host)!,
    host = patch.host!;
  for (const role of ["supply", "extract"] as const) {
    const vent = ventSchema.parse({
      id: "v",
      name: role,
      role,
      host: { patchId: patch.id, u: 0.4, v: 0.6 },
      yawDeg: 30,
      pitchDeg: 20,
      rotationDeg: 37,
    });
    const report = realPreparation({
        project: p,
        scenario: { ...s, vents: [vent] },
        clientRevision: "a".repeat(64),
      }),
      resolved = report.vents[0];
    ventCenter(vent, host).forEach((v, i) =>
      assert.ok(Math.abs(v - resolved.centerMm[i]) < 1e-7),
    );
    ventDirection(vent, host).forEach((v, i) =>
      assert.ok(Math.abs(v - resolved.jetDirection[i]) < 1e-7),
    );
    assert.ok(Math.abs(Math.hypot(...ventDirection(vent, host)) - 1) < 1e-10);
    const footprint = ventFootprint(vent, host);
    assert.equal(footprint.length, 4);
    for (const point of footprint)
      assert.ok(
        Math.abs(
          point.reduce(
            (v, x, i) => v + (x - host.originMm[i]) * host.normal[i],
            0,
          ),
        ) < 1e-7,
      );
    assert.ok(
      Math.abs(
        Math.hypot(...footprint[0].map((v, i) => v - footprint[1][i])) -
          vent.widthMm,
      ) < 1e-7,
    );
    assert.equal(ventFootprint({ ...vent, shape: "circle" }, host).length, 64);
  }
});

test("vent snapping stays on canonical wall/floor/ceiling frames and keeps the rotated footprint within frame bounds", () => {
  const p = cfdProject(), s = p.cfdScenarios![0], report = realPreparation({ project: p, scenario: s, clientRevision: "a".repeat(64) });
  for (const kind of ["wall", "floor", "ceiling"]) {
    const patch = report.patches.find(p => p.kind === kind && p.host)!;
    assert.ok(patch, kind);
    const h = patch.host!;
    for (const shape of ["rectangle", "circle"] as const) {
      const vent = ventSchema.parse({ id: "snap", name: "Snapped", role: "supply", shape, rotationDeg: 37, host: { patchId: patch.id } });
      const uv = snapVentUV(vent, h, -2, 5)!;
      assert.ok(uv && uv.every(v => v >= 0 && v <= 1));
      for (const point of ventFootprint(vent, h, ...uv)) {
        const delta = point.map((v, i) => v - h.originMm[i]);
        assert.ok(Math.abs(delta.reduce((v, x, i) => v + x * h.normal[i], 0)) < 1e-7);
        for (const [axis, extent] of [[h.uAxis, h.widthMm], [h.vAxis, h.heightMm]] as const) {
          const distance = delta.reduce((v, x, i) => v + x * axis[i], 0);
          assert.ok(distance >= vent.edgeClearanceMm - 1e-7 && distance <= extent - vent.edgeClearanceMm + 1e-7);
        }
      }
      assert.equal(snapVentUV({ ...vent, widthMm: h.widthMm * 10, diameterMm: h.widthMm * 10 }, h, .5, .5), null);
      assert.equal(snapVentUV(vent, h, NaN, .5), null);
    }
  }
  assert.equal(CFD_SELECTION_COLOUR, "#ff7900");
  for (let level = 0; level <= 10; level++) assert.notEqual(refinementColour(level), CFD_SELECTION_COLOUR);
  assert.notEqual(refinementColour(5), "#e47d20");
});

test("patch positions are grouped once with the explicit right-handed display transform", () => {
  const p = cfdProject(),
    report = realPreparation({
      project: p,
      scenario: p.cfdScenarios![0],
      clientRevision: "a".repeat(64),
    });
  const groups = patchPositions(report);
  assert.equal(
    [...groups.values()].reduce((sum, p) => sum + p.length, 0),
    report.surface.triangles.length * 9,
  );
  const first = report.surface.triangles[0],
    positions = groups.get(report.surface.trianglePatches[0])!;
  assert.deepEqual(
    positions.slice(0, 3),
    previewScene(report.surface.verticesMm[first[0]]),
  );
  assert.deepEqual(previewScene([1000, 2000, 3000]), [1, 3, -2]);
  assert.equal(patchPositions(null).size, 0);
});

test("refinement previews retain mm coordinates and never invent extents for missing objects", () => {
  const p = cfdProject(),
    s = p.cfdScenarios![0],
    report = realPreparation({
      project: p,
      scenario: s,
      clientRevision: "a".repeat(64),
    });
  s.mesh.refinements = [
    {
      id: "box",
      name: "Box",
      shape: "box",
      centerMm: [100, 200, 300],
      sizeMm: [1000, 2000, 3000],
      objectId: null,
      cellMm: 50,
    },
    {
      id: "sphere",
      name: "Sphere",
      shape: "sphere",
      centerMm: [400, 500, 600],
      sizeMm: [1000, 1000, 1000],
      objectId: null,
      cellMm: 50,
    },
    {
      id: "missing",
      name: "Missing",
      shape: "object",
      centerMm: [0, 0, 0],
      sizeMm: [1, 1, 1],
      objectId: "deleted",
      cellMm: 50,
    },
  ];
  const previews = refinementPreviews(s, report);
  assert.equal(previews.length, 2);
  assert.deepEqual(previews[0].centerMm, [100, 200, 300]);
  assert.deepEqual(previews[1].sizeMm, [1000, 1000, 1000]);
  assert.deepEqual(s.mesh.refinements[2].sizeMm, [1, 1, 1]);
});
