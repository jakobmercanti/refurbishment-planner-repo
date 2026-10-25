import assert from "node:assert/strict";
import test from "node:test";
import { cfdScenarioSchema } from "../lib/climoptixDocument";
import { DEFAULT_OBJECT_GROUP, deleteObjectEntry, duplicateObjectEntry, moveObject, objectEntries, objectGroups, objectMembers } from "../lib/climoptixObjectGroups";
import { preparationInput } from "../lib/climoptix";
import { cfdProject } from "./climoptixFixtures";

const objects = ["a", "b", "c"].map(id => ({ id, name: id.toUpperCase(), roomId: "room", floorId: "floor", mode: "solidProxy", profile: "block", heatW: 0, co2M3S: 0, notes: "", verticesMm: [], triangles: [] })) as Parameters<typeof objectEntries>[1];

test("object group transfers preserve membership, original order, overrides and immutable geometry", () => {
  const p = cfdProject(), scenario = p.cfdScenarios![0];
  scenario.objectGroups = [{ id: "empty", name: "Empty", memberIds: [] }];
  const groups = objectGroups(scenario), entries = objectEntries(scenario, objects);
  assert.deepEqual(objectMembers(groups[0], groups, entries).map(e => e.id), ["object:a", "object:b", "object:c"]);
  const moved = moveObject(scenario, "object:b", "empty", 0, objects);
  assert.deepEqual(moved.objectGroups!.find(g => g.id === "empty")!.memberIds, ["object:b"]);
  assert.deepEqual(objectMembers(objectGroups(moved)[0], objectGroups(moved), entries).map(e => e.sourceId), ["a", "c"]);
  const reordered = moveObject(moved, "object:c", DEFAULT_OBJECT_GROUP, 0, objects);
  assert.deepEqual(objectMembers(objectGroups(reordered)[0], objectGroups(reordered), entries).map(e => e.sourceId), ["c", "a"]);
  assert.equal(moveObject(scenario, "external", "empty", 0, objects), scenario);
  assert.equal(moveObject(scenario, "object:a", "empty", 1.5, objects), scenario);
  assert.equal(preparationInput(p, scenario), preparationInput(p, moved), "UI-only grouping must not invalidate the physical input");
  assert.deepEqual(scenario.objectGroups, [{ id: "empty", name: "Empty", memberIds: [] }]);
  cfdScenarioSchema.parse(reordered);
});

test("duplicate creates an independent measured-source instance; delete affects only this simulation", () => {
  const p = cfdProject(), scenario = p.cfdScenarios![0], before = structuredClone(p);
  const entry = objectEntries(scenario, objects)[0];
  const copy = duplicateObjectEntry(scenario, entry, objects)!;
  assert.notEqual(copy.id, entry.id);
  assert.equal(copy.scenario.objectCopies![0].sourceObjectId, "a");
  assert.equal(copy.scenario.assetOverrides.at(-1)!.objectId, copy.scenario.objectCopies![0].id);
  const removedSource = deleteObjectEntry(copy.scenario, entry);
  assert.deepEqual(removedSource.hiddenObjectIds, ["a"]);
  const copiedEntry = { ...entry, id: copy.id, sourceId: copy.scenario.objectCopies![0].id };
  const removedCopy = deleteObjectEntry(removedSource, copiedEntry);
  assert.equal(removedCopy.objectCopies!.length, 0);
  assert.equal(removedCopy.assetOverrides.length, 0);
  assert.deepEqual(p, before, "the authoritative source must be untouched");
  cfdScenarioSchema.parse(removedCopy);
  assert.notEqual(preparationInput(p, scenario), preparationInput(p, removedSource));
});

test("object schemas reject double membership, duplicate IDs and recursive copies", () => {
  const scenario = cfdProject().cfdScenarios![0];
  assert.throws(() => cfdScenarioSchema.parse({ ...scenario, objectGroups: [{ id: "a", name: "A", memberIds: ["object:o"] }, { id: "b", name: "B", memberIds: ["object:o"] }] }));
  assert.throws(() => cfdScenarioSchema.parse({ ...scenario, objectCopies: [{ id: "o", sourceObjectId: "o", name: "Loop" }] }));
  assert.throws(() => cfdScenarioSchema.parse({ ...scenario, hiddenObjectIds: ["o", "o"] }));
});
