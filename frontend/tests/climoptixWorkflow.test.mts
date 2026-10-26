import assert from "node:assert/strict";
import test from "node:test";
import {
  cfdScenarioSchema,
  duplicateCFDScenario,
} from "../lib/climoptixDocument";
import {
  samplingPlanes,
  refinementLevel,
  refinementCell,
  refinementColour,
  parseResidualLog,
} from "../lib/climoptixWorkflow";
import { checkVTKText, renderableVTKValues } from "../lib/climoptixVTK";
import {
  preparationInput,
  preparationRevision,
  preparationSummary,
} from "../lib/climoptix";
import { cfdProject, realPreparation } from "./climoptixFixtures";

test("legacy studies default to named slice settings and duplication is independent", async () => {
  const p = cfdProject(),
    old = { ...p.cfdScenarios![0] };
  delete (old as Record<string, unknown>).postProcessing;
  const s = cfdScenarioSchema.parse(old);
  assert.equal(s.postProcessing.z.enabled, true);
  const planes = samplingPlanes(
    [
      [100, 200, 300],
      [3100, 2200, 4300],
    ],
    {
      ...s.postProcessing,
      x: { enabled: true, count: 2 },
      y: { enabled: true, count: 1 },
    },
  );
  assert.equal(planes.length, 6);
  assert.deepEqual(planes[0], {
    id: "slice_x_001",
    axis: "X",
    pointMm: [1100, 1200, 2300],
    normal: [1, 0, 0],
  });
  assert.equal(samplingPlanes(null, s.postProcessing).length, 0);
  const copy = duplicateCFDScenario(s);
  copy.postProcessing.z.count = 7;
  assert.equal(s.postProcessing.z.count, 3);
  assert.notEqual(
    await preparationRevision(preparationInput(p, s)),
    await preparationRevision(preparationInput(p, copy)),
  );
  for (const count of [0, 101, 1.5, true, "3"])
    assert.equal(
      cfdScenarioSchema.safeParse({
        ...s,
        postProcessing: { ...s.postProcessing, x: { enabled: true, count } },
      }).success,
      false,
    );
  assert.equal(
    cfdScenarioSchema.safeParse({
      ...s,
      postProcessing: { ...s.postProcessing, fields: ["U", "U"] },
    }).success,
    false,
  );
});
test("explicit levels halve cells and legacy cell targets round to a sufficient level", () => {
  for (let level = 0; level <= 10; level++) {
    const r = { level, cellMm: 7 };
    assert.equal(refinementLevel(200, r), level);
    assert.equal(refinementCell(200, r), 200 / 2 ** level);
    assert.match(refinementColour(level), /^#[a-f0-9]{6}$/i);
  }
  assert.equal(refinementLevel(200, { level: null, cellMm: 70 }), 2);
  assert.equal(refinementCell(200, { level: null, cellMm: 70 }), 50);
  assert.notEqual(refinementColour(2), refinementColour(3));
});
test("extreme custom cell targets have finite derived levels rather than overflowing", () => {
  for (const cellMm of [1e-310, Number.MIN_VALUE]) {
    assert.ok(Number.isFinite(refinementLevel(200, { level: null, cellMm })));
  }
});
test("convergence parser reads real OpenFOAM solver records without fabricating data", () => {
  const result = parseResidualLog(
    `Time = 1\nsmoothSolver: Solving for Ux, Initial residual = 0.1, Final residual = 2e-5, No Iterations 2\nGAMG: Solving for p, Initial residual = 0.2, Final residual = 1e-4, No Iterations 3\nTime = 2.5\nsmoothSolver: Solving for Ux, Initial residual = 0, Final residual = 0, No Iterations 0`,
  );
  assert.equal(result.samples.length, 3);
  assert.equal(result.samples[2].time, 2.5);
  assert.equal(result.samples[2].initial, 0);
  assert.equal(result.samples[2].iteration, 2);
  assert.equal(parseResidualLog("No simulation has run").samples.length, 0);
  assert.equal(
    parseResidualLog(
      "Time = 1e999\nSolving for p, Initial residual = 1, Final residual = 1e-3",
    ).samples.length,
    0,
  );
  assert.throws(
    () => parseResidualLog("x".repeat(8 * 1024 * 1024 + 1)),
    /8 MB/,
  );
  const bounded = parseResidualLog(
    "Solving for p, Initial residual = 1, Final residual = 1e-4\n".repeat(
      20001,
    ),
  );
  assert.equal(bounded.samples.length, 20000);
  assert.equal(bounded.truncated, true);
  const manyFields = parseResidualLog(
    Array.from(
      { length: 33 },
      (_, i) =>
        `Solving for field${i}, Initial residual = 1, Final residual = 1e-4`,
    ).join("\n"),
  );
  assert.equal(manyFields.samples.length, 32);
  assert.equal(manyFields.truncated, true);
});
test("full default convergence history retains all 5000 outer steps despite repeated pressure correctors",()=>{
  const log=Array.from({length:5000},(_,i)=>`Time = ${i+1}\n${['Ux','Uy','Uz','p','p','p'].map((field,j)=>`Solving for ${field}, Initial residual = ${1/(i+j+1)}, Final residual = ${1/(i+j+2)}`).join('\n')}`).join('\n');
  const result=parseResidualLog(log);
  assert.equal(result.truncated,false);assert.equal(result.samples.length,20000);
  const pressure=result.samples.filter(sample=>sample.field==='p');
  assert.equal(pressure.length,5000);assert.equal(pressure.at(-1)?.iteration,5000);
  assert.equal(pressure[0].initial,.25);assert.equal(pressure[0].final,1/7);
});

test("VTK preflight blocks external entities, unsupported grids and oversized allocations", () => {
  const valid =
    '<VTKFile type="PolyData"><PolyData><Piece NumberOfPoints="4" NumberOfPolys="1"><DataArray format="ascii" NumberOfComponents="3">0 0 0</DataArray></Piece></PolyData></VTKFile>';
  assert.doesNotThrow(() => checkVTKText(valid, true));
  assert.throws(
    () =>
      checkVTKText(
        valid.replace("<PolyData>", "<PolyData>" + "<Ignored/>".repeat(1025)),
        true,
      ),
    /element/,
  );
  for (const bad of [
    valid.replace('"4"', '"999999999"'),
    valid.replace("PolyData", "UnstructuredGrid"),
    valid.replace("ascii", "binary"),
    "<!DOCTYPE x>" + valid,
    valid.replace("<DataArray", '<DataArray NumberOfComponents="99999"'),
    valid.replace("<VTKFile", '<VTKFile compressor="zlib"'),
  ])
    assert.throws(() => checkVTKText(bad, true));
  const legacy =
    "# vtk DataFile Version 3.0\nSlice\nASCII\nDATASET POLYDATA\nPOINTS 4 float\n0 0 0 1 0 0 1 1 0 0 1 0\nPOLYGONS 1 5\n4 0 1 2 3";
  assert.doesNotThrow(() => checkVTKText(legacy, false));
  assert.throws(() =>
    checkVTKText(legacy.replace("POINTS 4", "POINTS 999999999"), false),
  );
  assert.throws(() => checkVTKText(legacy.replace("ASCII", "BINARY"), false));
  assert.throws(() =>
    checkVTKText(legacy.replace("POLYGONS 1 5", "POLYGONS 1 1e12"), false),
  );
  assert.throws(() =>
    checkVTKText(legacy + "\nPOINT_DATA 4\nSCALARS p float 1e9", false),
  );
  assert.throws(
    () => checkVTKText(legacy + "\nFIELD FieldData 2", false),
    /Incomplete VTK array/,
  );
});
test("WebGL numeric checks reject finite doubles that would turn into rendering infinities", () => {
  assert.equal(
    renderableVTKValues(new Float64Array([0, 290, -1.2, 100000])),
    true,
  );
  for (const bad of [NaN, Infinity, -Infinity, 1e308, -1e100])
    assert.equal(renderableVTKValues([bad]), false);
});

test("preflight text reports effective mesh levels and named sampling planes, not obsolete cell targets", () => {
  const p = cfdProject(),
    s = p.cfdScenarios![0];
  s.mesh.minCellMm = 1;
  s.mesh.refinements = [
    {
      id: "numbered",
      name: "Numbered",
      shape: "box",
      level: 4,
      cellMm: 70,
      objectId: null,
      centerMm: [1000, 1000, 1000],
      sizeMm: [1000, 1000, 1000],
    },
    {
      id: "custom",
      name: "Target",
      shape: "box",
      level: null,
      cellMm: 70,
      objectId: null,
      centerMm: [1000, 1000, 1000],
      sizeMm: [1000, 1000, 1000],
    },
  ];
  const revision = "a".repeat(64);
  const report = realPreparation({
    project: p,
    scenario: s,
    clientRevision: revision,
  });
  const summary = preparationSummary(s, report, revision);
  assert.match(summary, /Numbered · box · level 4 · nominal 12\.5 mm/);
  assert.match(
    summary,
    /Target · box · level 2 · nominal 50 mm \(requested 70 mm\)/,
  );
  assert.match(summary, /SAMPLING PLANES/);
  assert.match(summary, /slice_z_001/);
  assert.match(summary, /Fields: U, p/);
});

test("legacy VTK preflight rejects integer wrapping, incomplete arrays and surplus values before decoding", () => {
  const legacy =
    "# vtk DataFile Version 3.0\nSlice\nASCII\nDATASET POLYDATA\nPOINTS 4 float\n0 0 0 1 0 0 1 1 0 0 1 0\nPOLYGONS 1 5\n4 0 1 2 3\nPOINT_DATA 4\nSCALARS label long 1\nLOOKUP_TABLE default\n1 2 3 4";
  assert.doesNotThrow(() => checkVTKText(legacy, false));
  for (const invalid of [
    legacy.replace("\n1 2 3 4", "\n3000000000 2 3 4"),
    legacy.replace("0 0 0 1 0 0 1 1 0 0 1 0", "0 0 0 1 0 0 1 1 0 0 1"),
    legacy.replace("0 0 0 1 0 0 1 1 0 0 1 0", "0 0 0 1 0 0 1 1 0 0 1 0 99"),
    legacy.replace("POLYGONS 1 5", "POLYGONS 2 5"),
    legacy.replace("POINT_DATA 4", "POINT_DATA 3"),
  ])
    assert.throws(() => checkVTKText(invalid, false));
});
