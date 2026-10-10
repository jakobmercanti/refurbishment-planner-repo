import test from 'node:test';
import assert from 'node:assert/strict';
import { newEnergyProject, parseEnergyProject, newAssembly } from '../lib/energyDocument.ts';
import { scenarioAssignments } from '../lib/energyCalculations.ts';
import { removeEnergyScenario, renameEnergyScenario, saveEnergyScenarioAs } from '../lib/energyScenarios.ts';
import { setWallAssembly } from '../lib/energyWallConstruction.ts';

test('saved scenarios load, rename and retain independent wall edits', () => {
  const base = newEnergyProject();
  const wall = { elementId: 'room-1|wall:0', geometrySignature: 'wall-geometry' } as Parameters<typeof setWallAssembly>[1];
  const existing = setWallAssembly(base, wall, newAssembly({ name: 'Existing', category: 'wall', materials: [['brick-english-red', 150]] }));
  const first = saveEnergyScenarioAs(existing, 'Loft and walls');
  const second = saveEnergyScenarioAs(first, 'Lower-temperature option');
  assert.equal(second.scenarios.length, 2);
  const modified = setWallAssembly(second, wall, newAssembly({ name: 'Insulated', category: 'wall', materials: [['pir-tw55', 100]] }));
  const baselineId = scenarioAssignments(modified, null)[0].assemblyId;
  const firstId = scenarioAssignments(modified, first.activeScenarioId)[0].assemblyId;
  const secondId = scenarioAssignments(modified, second.activeScenarioId)[0].assemblyId;
  assert.equal(firstId, baselineId);
  assert.notEqual(secondId, baselineId);
  const restored = parseEnergyProject(JSON.parse(JSON.stringify(modified)));
  assert.equal(scenarioAssignments(restored, restored.activeScenarioId)[0].assemblyId, secondId);
  const renamed = renameEnergyScenario(restored, second.activeScenarioId!, 'Heat pump proposal');
  assert.equal(renamed.scenarios[1].name, 'Heat pump proposal');
  const removed = removeEnergyScenario(renamed, second.activeScenarioId!);
  assert.equal(removed.activeScenarioId, null);
  assert.equal(removed.scenarios.length, 1);
  assert.equal(scenarioAssignments(removed)[0].assemblyId, baselineId);
});

test('invalid scenario names do not change the project', () => {
  const base = newEnergyProject();
  assert.throws(() => saveEnergyScenarioAs(base, '   '));
  assert.equal(base.scenarios.length, 0);
});
