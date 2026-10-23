import "fake-indexeddb/auto";
import assert from "node:assert/strict";
import test from "node:test";
import { projectRepository } from "../lib/projectRepository";
import { ProjectHistory } from "../lib/projectHistory";
import { exportProject, importProject } from "../lib/projectPackage";
import { duplicateCFDScenario } from "../lib/climoptixDocument";
import { ventSchema } from "../lib/climoptixDocument";
import { cfdProject, realExampleProjects } from "./climoptixFixtures";
import { parseProject } from "../lib/projectDocument";

test("multiple CFD studies survive IndexedDB and portable packages, with independent settings", async () => {
  const p = cfdProject(),
    s = duplicateCFDScenario(p.cfdScenarios![0]);
  s.name = "CO2 study";
  s.group = "Summer";
  p.cfdScenarios![0].group = "Winter";
  s.physics.co2 = true;
  p.cfdScenarios!.push(s);
  p.cfdSimulationGroups = [{ id: "empty", name: "Empty folder" }, { id: "summer", name: "Summer" }];
  await projectRepository.saveProject(p);
  assert.deepEqual(
    (await projectRepository.getProject(p.projectId))?.cfdScenarios,
    p.cfdScenarios,
  );
  const backup = await exportProject(p),
    loaded = await importProject(new File([backup], "climoptix.floorplan3d"));
  assert.deepEqual(loaded.cfdScenarios, p.cfdScenarios);
  assert.deepEqual(loaded.cfdSimulationGroups, p.cfdSimulationGroups);
  assert.deepEqual(loaded.building, p.building);
  const duplicated = await projectRepository.duplicateProject(p.projectId);
  assert.ok(
    duplicated.cfdScenarios!.every(
      (s) =>
        s.sourceBuildingId === duplicated.projectId && s.validation === null,
    ),
  );
  assert.notEqual(duplicated.cfdScenarios![0].id, p.cfdScenarios![0].id);
});
test("CFD changes participate in project undo/redo without changing source rooms", () => {
  const p = cfdProject(),
    changed = structuredClone(p),
    h = new ProjectHistory();
  changed.cfdScenarios![0].physics.co2 = true;
  h.record(p, changed, true);
  assert.deepEqual(h.undo(changed)?.cfdScenarios, p.cfdScenarios);
  assert.deepEqual(h.redo(p)?.cfdScenarios, changed.cfdScenarios);
  assert.deepEqual(changed.rooms, p.rooms);
});

test("a rapid completed vent drag is an independent history checkpoint", () => {
  const original = cfdProject(),
    added = structuredClone(original),
    h = new ProjectHistory();
  added.cfdScenarios![0].vents = [
    ventSchema.parse({
      id: "vent",
      name: "Supply",
      role: "supply",
      host: { patchId: "host" },
    }),
  ];
  h.record(original, added, true, 1000);
  const moved = structuredClone(added);
  moved.cfdScenarios![0].vents[0].host.u = 0.75;
  h.record(added, moved, true, 1100);
  assert.deepEqual(h.undo(moved)?.cfdScenarios, added.cfdScenarios);
  assert.deepEqual(h.redo(added)?.cfdScenarios, moved.cfdScenarios);
  assert.deepEqual(moved.rooms, original.rooms);
});

test("all five Python examples are usable portable planner projects, not disconnected CFD demos", async () => {
  const examples = realExampleProjects();
  assert.equal(Object.keys(examples).length, 5);
  for (const [name, raw] of Object.entries(examples)) {
    const project = parseProject(raw),
      file = new File([await exportProject(project)], name + ".floorplan3d");
    const loaded = await importProject(file);
    assert.deepEqual(loaded.cfdScenarios, project.cfdScenarios);
    assert.deepEqual(loaded.rooms, project.rooms);
    assert.deepEqual(loaded.building, project.building);
  }
});
