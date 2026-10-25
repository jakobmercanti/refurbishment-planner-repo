import assert from "node:assert/strict";
import test from "node:test";
import { parseProject } from "../lib/projectDocument";
import {
  preparationInput,
  preparationRequestBody,
  preparationRevision,
} from "../lib/climoptix";
import {
  thermalColour,
  thermalCSV,
  thermalSetupSchema,
} from "../lib/thermalDocument";
import { thermalProject, realThermal } from "./thermalFixtures";
import { importEPW, requestThermal } from "../lib/thermalClient";

test("thermal Python/TypeScript contract, mm area, balance and immutable saved package round trip", async () => {
  const p = thermalProject(),
    s = p.cfdScenarios![0];
  const token = await preparationRevision(preparationInput(p, s));
  const result = realThermal({
    project: p,
    scenario: s,
    clientRevision: token,
  });
  assert.equal(
    result.validation.previewReady,
    true,
    result.validation.errors.join("\n"),
  );
  assert.equal(
    result.validation.applyReady,
    true,
    result.validation.projectionErrors.join("\n"),
  );
  assert.ok(Math.abs(result.preview.equilibriumAirTempC! - 20) < 1e-8);
  s.thermalSnapshots = [
    {
      schemaVersion: 1,
      caseHash: result.caseHash,
      sourceRevision: token,
      createdAt: new Date().toISOString(),
      package: result,
    },
  ];
  const restored = parseProject(JSON.parse(JSON.stringify(p)));
  assert.deepEqual(
    restored.cfdScenarios![0].thermalSnapshots,
    JSON.parse(JSON.stringify(s.thermalSnapshots)),
  );
  assert.equal(
    preparationInput(p, s),
    preparationInput(restored, restored.cfdScenarios![0]),
  );
  const csv = thermalCSV(result);
  assert.ok(csv.includes('"absorbedWm2"') && csv.includes('"transmittedW"'));
  assert.equal(result.executed, false);
  assert.equal(result.runnable, false);
  assert.equal(
    thermalColour({ ...result.surfaces[0], status: "stale" }, "missing"),
    "#cf6262",
  );
});
test("thermal input invalidates on insulation/weather/north, ignores display and strips historical packages from requests", () => {
  const p = thermalProject(),
    s = p.cfdScenarios![0];
  const before = preparationInput(p, s);
  p.energyLayout!.enabled = !p.energyLayout!.enabled;
  p.energyLayout!.display.walls = false;
  assert.equal(preparationInput(p, s), before);
  p.energyLayout!.assemblies[0].layers[0].thicknessMm += 1;
  assert.notEqual(preparationInput(p, s), before);
  const second = preparationInput(p, s);
  s.thermalEnvelope!.northDeg = 45;
  assert.notEqual(preparationInput(p, s), second);
  const third = preparationInput(p, s);
  s.thermalEnvelope!.weather.temperatureC = 12;
  assert.notEqual(preparationInput(p, s), third);
  const body = JSON.parse(preparationRequestBody(p, s, "a".repeat(64)));
  assert.ok(body.project.energyLayout.assemblies.length);
  assert.equal(body.scenario.thermalSnapshots, undefined);
  assert.equal(body.project.cfdScenarios, undefined);
});
test("thermal choices have no invented location, weather or infiltration; validators reject impossible properties", () => {
  const setup = thermalSetupSchema.parse({});
  assert.equal(setup.location.latitude, null);
  assert.equal(setup.weather.temperatureC, null);
  assert.equal(setup.airExchange.mode, "unspecified");
  assert.equal(setup.assumptionsAccepted, false);
  assert.equal(
    thermalSetupSchema.safeParse({ location: { latitude: 91 } }).success,
    false,
  );
  assert.equal(
    thermalSetupSchema.safeParse({ groundAlbedo: 2 }).success,
    false,
  );
  assert.equal(thermalSetupSchema.safeParse({ rhoKgM3: "1.2" }).success, false);
});

test("thermal service contract errors are readable and invalid weather never becomes a saved setting", async (t) => {
  const project = thermalProject(),
    scenario = project.cfdScenarios![0];
  const fetch = t.mock.method(
    globalThis,
    "fetch",
    async () => new Response("{}", { status: 200 }),
  );
  await assert.rejects(
    requestThermal("/api", project, scenario, "a".repeat(64), true),
    /incomplete or incompatible response.*settings are unchanged/,
  );
  await assert.rejects(
    importEPW("/api", new File(["fixture"], "test.epw")),
    /invalid EPW data.*No weather was imported/,
  );
  const invalidWeather = {
    location: scenario.thermalEnvelope!.location,
    source: "Fixture",
    rejectedRows: 0,
    timeConvention: "Standard time",
    records: [
      {
        index: 0,
        localDateTime: "2026-01-01T00:30",
        temperatureC: 20,
        relativeHumidity: 2,
        windMS: -1,
        ghiWm2: 0,
        dniWm2: 0,
        dhiWm2: 0,
      },
    ],
  };
  fetch.mock.mockImplementation(
    async () => new Response(JSON.stringify(invalidWeather)),
  );
  await assert.rejects(
    importEPW("/api", new File(["fixture"], "test.epw")),
    /invalid EPW data/,
  );
  fetch.mock.mockImplementation(
    async () =>
      new Response(
        JSON.stringify({ detail: "Choose a valid local weather file." }),
        { status: 422 },
      ),
  );
  await assert.rejects(
    importEPW("/api", new File(["fixture"], "test.epw")),
    /Choose a valid local weather file/,
  );
});
