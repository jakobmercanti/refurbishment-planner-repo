import test from 'node:test';
import assert from 'node:assert/strict';
import { newAssembly, newEnergyProject, parseEnergyProject } from '../lib/energyDocument.ts';
import { calculateAssemblyUValue, calculateLayerResistance, energyElements, withEnergyFabric } from '../lib/energyCalculations.ts';
import { setWallAssembly } from '../lib/energyWallConstruction.ts';
import { withLayerColours } from '../lib/energyLayerColours.ts';
import { newHeatingProject, parseHeatingProject } from '../lib/heatingDocument.ts';
import { calculateRadiatorOutput, thermalRoom } from '../lib/heatingCalculations.ts';
import { heatingResults } from '../lib/heatingDesign.ts';
import { REFERENCE_RADIATORS, referenceRadiatorForRoom } from '../lib/heatingCatalogue.ts';
import type { Room } from '../lib/types.ts';
const measured = (value: number) => ({ value, uncertainty_mm: 0, verified: true });
const room: Room = { id: 'room', name: 'Room', version: 1, vertices: [{ x: 0, y: 0 }, { x: 5000, y: 0 }, { x: 5000, y: 4000 }, { x: 0, y: 4000 }], wall_height: measured(2500), wall_thickness: measured(100), openings: [], obstacles: [] };

test('default families have sourced editable thermal inputs and calculate a complete wall', () => {
  const data = newEnergyProject();
  assert.ok(data.materials.every(m => m.lambda != null || m.resistance != null));
  assert.ok(data.materials.every(m => m.reference.includes('https://') && m.editable));
  const assembly = newAssembly({ name: 'Wall', category: 'wall', materials: [['custom-0', 100], ['pir-tw55', 100]] });
  assert.ok(calculateAssemblyUValue(assembly, data.materials).uValue! < .3);
});
test('legacy defaults upgrade only untouched placeholders, without replacing edits', () => {
  const data = newEnergyProject(); const block = data.materials.find(m => m.materialId === 'custom-0')!;
  Object.assign(block, { name: 'Concrete block — specify product value', lambda: null, reference: 'Not supplied: enter a declared/design value for the actual product and conditions.' });
  assert.equal(parseEnergyProject(data).materials.find(m => m.materialId === block.materialId)!.lambda, 1.13);
  block.lambda = .42; assert.equal(parseEnergyProject(data).materials.find(m => m.materialId === block.materialId)!.lambda, .42);
  block.lambda = null; block.reference = 'User requires tested value';
  assert.equal(parseEnergyProject(data).materials.find(m => m.materialId === block.materialId)!.lambda, null);
});
test('library changes immediately feed plan and heating U; layer override stays independent', () => {
  const data = newEnergyProject(), heating = newHeatingProject(), element = energyElements([room], heating, data)[0];
  let next = setWallAssembly(data, element, newAssembly({ name: 'Wall', category: 'wall', materials: [['custom-0', 100], ['pir-tw55', 100]] }));
  const before = energyElements([room], heating, next)[0].uValue;
  next = { ...next, materials: next.materials.map(m => m.materialId === 'pir-tw55' ? { ...m, lambda: .04 } : m) };
  const after = energyElements([room], heating, next)[0]; assert.ok(after.uValue > before); assert.deepEqual(after.warnings, []);
  assert.equal(withEnergyFabric(heating, next, [room]).thermalOverrides![element.elementId].uValue, after.uValue);
  const assembly = next.assemblies[0]; assembly.layers[1].lambdaOverride = .022;
  assert.equal(energyElements([room], heating, next)[0].uValue, before);
});
test('cavity resistance is conditional, and equivalent layer U requires its reference thickness', () => {
  const data = newEnergyProject(), assembly = newAssembly({ name: 'Cavity', category: 'wall', materials: [['custom-9', 50]] });
  assert.equal(calculateLayerResistance(assembly.layers[0], data.materials), .18);
  assembly.layers[0].thicknessMm = 10; assert.equal(calculateLayerResistance(assembly.layers[0], data.materials), null);
  const material = data.materials.find(m => m.materialId === 'custom-9')!; material.resistanceReferenceThicknessMm = 50;
  assembly.layers[0].thicknessMm = 100; assert.equal(calculateLayerResistance(assembly.layers[0], data.materials), null);
  assembly.layers[0].resistanceOverride = .2; assert.equal(calculateLayerResistance(assembly.layers[0], data.materials), .2);
});
test('missing legacy colours attach once to IDs and survive reorder/save/resize', () => {
  const assembly = newAssembly({ name: 'Wall', category: 'wall', materials: [['custom-0', 150], ['pir-tw55', 150]] });
  delete assembly.layers[0].colorHex; assembly.layers[1].colorHex = '#ecd59c';
  const fixed = withLayerColours(assembly), colours = new Map(fixed.layers.map(l => [l.layerId, l.colorHex]));
  assert.notEqual(fixed.layers[0].colorHex, fixed.layers[1].colorHex);
  fixed.layers.reverse(); const data = newEnergyProject(); data.assemblies = [fixed];
  assert.ok(parseEnergyProject(data).assemblies[0].layers.every(l => colours.get(l.layerId) === l.colorHex));
});
test('room target changes preserve ratings and show explicit corrected output, reversible to supplied point', () => {
  const heating = newHeatingProject(), radiator = referenceRadiatorForRoom(REFERENCE_RADIATORS.find(p => p.catalogueId === 'jaga-strw-035-600-16')!, room);
  heating.radiators = [radiator]; const snapshot = JSON.stringify(radiator);
  heating.rooms = [{ ...thermalRoom(room, heating), designTemperatureOverride: true, designIndoorTemperatureC: 20 }];
  const initial = heatingResults([room], heating).rooms[0]; assert.equal(initial.capacityW, 624);
  heating.rooms[0].designIndoorTemperatureC = 25;
  const changed = heatingResults([room], parseHeatingProject(heating)).rooms[0];
  assert.ok(changed.capacityW > 0 && changed.capacityW < 624); assert.ok(changed.capacityEstimated); assert.equal(changed.status, 'Not verified');
  assert.equal(JSON.stringify(radiator), snapshot); assert.match(changed.emitters[0].note, /Original rating retained/);
  heating.estimateRoomTemperatureOutput = false; assert.equal(heatingResults([room], heating).rooms[0].emitters[0].outputW, null);
  heating.rooms[0].designIndoorTemperatureC = 20; assert.equal(heatingResults([room], heating).rooms[0].capacityW, 624);
  assert.equal(calculateRadiatorOutput(radiator, 46, 40, 25, true).outputW, null, 'No unrelated water-temperature extrapolation');
  assert.equal(calculateRadiatorOutput(radiator, 45, 40, 35, true).outputW, null, 'No unbounded room correction');
});
