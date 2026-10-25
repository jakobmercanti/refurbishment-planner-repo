import assert from "node:assert/strict";
import test from "node:test";
import { boundarySchema, cfdScenarioSchema, simulationGroupsSchema, ventSchema } from "../lib/climoptixDocument";
import { assignBoundarySurfaces, boundaryGroups, boundaryMembers, boundaryMembership, duplicateSimulationGroup, effectiveBoundary, moveBoundary, simulationGroups, uniqueGroupName } from "../lib/climoptixGroups";
import { insertAtBoundary, moveStudy } from "../lib/climoptixStudies";
import { preparationInput, preparationRequestBody } from "../lib/climoptix";
import { cfdProject, realPreparation } from "./climoptixFixtures";
import { parseProject } from "../lib/projectDocument";
import { ProjectHistory } from "../lib/projectHistory";

test("an unassigned vent remains editable but real geometry preparation blocks worker submission", () => {
  const project = cfdProject(), scenario = structuredClone(project.cfdScenarios![0]);
  scenario.vents.push(ventSchema.parse({ id: "draft-supply", name: "Draft supply", role: "supply", host: { patchId: "unassigned" } }));
  assert.ok(cfdScenarioSchema.safeParse(scenario).success);
  const report = realPreparation({ project, scenario, clientRevision: "a".repeat(64) });
  assert.ok(report.validation.errors > 0);
  assert.equal(report.surface.exportable, false);
  assert.equal(report.vents.some(v => v.id === "draft-supply"), false);
});

test("empty simulation folders and legacy labels are first-class metadata, independently ordered and duplicated", () => {
  const p = cfdProject(), s = p.cfdScenarios![0];
  const saved = [{ id: "empty", name: "Empty folder" }];
  const groups = simulationGroups([s], saved);
  assert.equal(groups.length, 2);
  assert.deepEqual(saved, [{ id: "empty", name: "Empty folder" }]);
  assert.equal(insertAtBoundary(groups, "empty", 2)[1].id, "empty");
  const cloned = duplicateSimulationGroup([s], groups, groups[1].id)!;
  assert.equal(cloned.scenarios.length, 2);
  assert.notEqual(cloned.scenarios[1].id, s.id);
  assert.deepEqual(cloned.scenarios[1].physics, s.physics);
  assert.equal(cloned.scenarios[1].validation, null);
  assert.equal(cloned.scenarios[1].group, cloned.groups[2].name);
  assert.equal(duplicateSimulationGroup(Array.from({ length: 100 }, () => s), groups, groups[1].id), null);
  assert.equal(moveStudy([s], s.id, "General", 0.5)[0], s);
  assert.throws(() => simulationGroupsSchema.parse([{ id: "a", name: "Test" }, { id: "b", name: "test" }]));
  assert.equal(preparationInput(p, s), preparationInput({ ...p, cfdSimulationGroups: saved }, s));
  assert.equal(JSON.parse(preparationRequestBody({ ...p, cfdSimulationGroups: saved }, s, "a".repeat(64))).project.cfdSimulationGroups, undefined);
  assert.throws(() => parseProject({ ...p, cfdSimulationGroups: Array.from({ length: 100 }, (_, i) => ({ id: `g${i}`, name: `Folder ${i}` })) }), /100 simulation groups/);
  const unicode = uniqueGroupName([], "🔵".repeat(40) + " copy");
  assert.ok(unicode.length <= 80);
  assert.equal(new TextDecoder().decode(new TextEncoder().encode(unicode)), unicode);
  const unicodeGroup = [{ id: "emoji", name: "🔵".repeat(40) }];
  const copyName = duplicateSimulationGroup([], unicodeGroup, "emoji")!.groups[1].name;
  assert.ok(copyName.length <= 80);
  assert.equal(new TextDecoder().decode(new TextEncoder().encode(copyName)), copyName);
  const history = new ProjectHistory(), grouped = { ...p, cfdSimulationGroups: saved };
  history.record(p, grouped, true);
  assert.equal(history.past.length, 1, "Empty folders are undoable edits");
  const undone = history.undo(grouped)!;
  history.record(undone, { ...undone, cfdScenarios: undone.cfdScenarios!.map(s => ({ ...s, updatedAt: "2026-10-23T12:00:00Z" })) });
  assert.equal(history.future.length, 1, "Preparation metadata must not erase redo");
  assert.deepEqual(history.redo(undone)!.cfdSimulationGroups, saved);
});

test("surface groups move and reorder by stable ID, never duplicate membership, and retain physical overrides", () => {
  const p = cfdProject(), original = p.cfdScenarios![0], report = realPreparation({ project: p, scenario: original, clientRevision: "a".repeat(64) });
  const s = structuredClone(original);
  s.boundaries.collections = [...boundaryGroups(s), { id: "heated", name: "Heated", patchIds: [], boundary: null }];
  const ids = report.patches.slice(0, 3).map(p => p.id);
  const groups = [{ ...s.boundaries.collections[0], patchIds: [ids[2], 'stale', ids[0]] },
    { ...s.boundaries.collections[1], patchIds: [ids[0]] }];
  const indexed = boundaryMembership(groups, report.patches);
  assert.equal(indexed.get('all-surfaces')![0].id, ids[2]);
  assert.ok(!indexed.get('all-surfaces')!.some(p => p.id === ids[0]));
  assert.deepEqual(indexed.get('heated')!.map(p => p.id), [ids[0]]);
  let moved = moveBoundary(s, ids[0], "heated", 0, report.patches);
  moved = moveBoundary(moved, ids[1], "heated", 1, report.patches);
  moved = moveBoundary(moved, ids[2], "heated", 2, report.patches);
  assert.deepEqual(moved.boundaries.collections[1].patchIds, ids);
  assert.equal(moveBoundary(moved, ids[1], "heated", 1, report.patches), moved);
  const reordered = moveBoundary(moved, ids[0], "heated", 3, report.patches);
  assert.deepEqual(reordered.boundaries.collections[1].patchIds, [ids[1], ids[2], ids[0]]);
  assert.deepEqual(boundaryMembers(reordered.boundaries.collections[1], boundaryGroups(reordered), report.patches).map(p => p.id), [ids[1], ids[2], ids[0]]);
  const returned = moveBoundary(reordered, ids[0], "all-surfaces", 0, report.patches);
  assert.equal(boundaryMembers(returned.boundaries.collections[0], boundaryGroups(returned), report.patches)[0].id, ids[0]);
  assert.equal(returned.boundaries.collections[1].patchIds.includes(ids[0]), false);
  assert.deepEqual(cfdScenarioSchema.parse(returned), returned);
  assert.deepEqual(original.boundaries.collections, []);
  assert.equal(moveBoundary(s, "foreign", "heated", 0, report.patches), s);
  assert.equal(moveBoundary(s, ids[0], "missing", 0, report.patches), s);
  const imported = structuredClone(original);
  imported.boundaries.collections = [{ id: "custom", name: "Default surfaces", patchIds: [], boundary: null }];
  assert.deepEqual(cfdScenarioSchema.parse({ ...imported, boundaries: { ...imported.boundaries, collections: boundaryGroups(imported) } }).boundaries.collections.map(g => g.name), ["Default surfaces 2", "Default surfaces"]);
  imported.boundaries.collections = Array.from({ length: 100 }, (_, i) => ({ id: `g${i}`, name: `Group ${i}`, patchIds: [], boundary: null }));
  assert.equal(cfdScenarioSchema.safeParse(imported).success, false, "The catch-all group has a reserved slot");
});

test("checkbox surface assignment transfers unique members, returns unchecked members and preserves stale references and overrides", () => {
  const p = cfdProject(), s = p.cfdScenarios![0], report = realPreparation({ project: p, scenario: s, clientRevision: "a".repeat(64) });
  const [a, b, c] = report.patches.filter(p => p.kind === "wall");
  s.boundaries.collections = [
    { id: "all-surfaces", name: "Default surfaces", patchIds: [], boundary: null },
    { id: "a", name: "A", patchIds: [a.id, "stale"], boundary: null },
    { id: "b", name: "B", patchIds: [b.id], boundary: null },
  ];
  s.boundaries.patches[a.id] = boundarySchema.parse({ flow: { type: "slip" } });
  const before = structuredClone(s);
  const next = assignBoundarySurfaces(s, "a", [b.id, c.id, b.id, "foreign"], report.patches);
  assert.deepEqual(next.boundaries.collections[1].patchIds, ["stale", b.id, c.id]);
  assert.deepEqual(next.boundaries.collections[2].patchIds, []);
  assert.ok(boundaryMembers(next.boundaries.collections[0], boundaryGroups(next), report.patches).some(p => p.id === a.id));
  assert.deepEqual(next.boundaries.patches, s.boundaries.patches);
  assert.deepEqual(s, before);
  assert.ok(cfdScenarioSchema.safeParse(next).success);
  assert.equal(assignBoundarySurfaces(s, "missing", [a.id], report.patches), s);
  assert.equal(assignBoundarySurfaces(s, "all-surfaces", [a.id], report.patches), s);
});

test("custom physical group conditions roundtrip to preparation with correct precedence and provenance", () => {
  const p = cfdProject(), s = structuredClone(p.cfdScenarios![0]);
  const before = realPreparation({ project: p, scenario: s, clientRevision: "a".repeat(64) });
  const walls = before.patches.filter(p => p.kind === "wall");
  const global = boundarySchema.parse({ flow: { type: "slip" } });
  const custom = boundarySchema.parse({ thermal: { type: "temperature", value: 300 } });
  s.boundaries.collections = [
    { id: "all-surfaces", name: "Default surfaces", patchIds: [], boundary: global },
    { id: "warm", name: "Warm wall", patchIds: [walls[0].id], boundary: custom },
  ];
  s.boundaries.patches[walls[1].id] = boundarySchema.parse({ flow: { type: "symmetry" } });
  assert.equal(effectiveBoundary(s, walls[0]).thermal.value, 300);
  assert.equal(effectiveBoundary(s, walls[1]).flow.type, "symmetry");
  const result = realPreparation({ project: p, scenario: s, clientRevision: "a".repeat(64) });
  assert.equal(result.patches.find(p => p.id === walls[0].id)!.boundary.thermal.value, 300);
  assert.equal(result.patches.find(p => p.id === walls[1].id)!.boundary.flow.type, "symmetry");
  assert.match(result.patches.find(p => p.id === walls[0].id)!.boundaryOrigin, /Warm wall/);
  assert.notEqual(result.validation.configurationHash, before.validation.configurationHash);
  const invalid = structuredClone(s);
  invalid.boundaries.collections.push({ id: "dup", name: "Duplicate", patchIds: [walls[0].id], boundary: null });
  assert.equal(cfdScenarioSchema.safeParse(invalid).success, false);
});
