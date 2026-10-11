import test from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { newHeatingProject, parseHeatingProject, heatingElementSpecSchema } from '../lib/heatingDocument';
import { newHeatingRadiator, heatingResults } from '../lib/heatingDesign';
import { enteredHeatingOutput, commitHeatingElements, withHeatingElements } from '../lib/heatingElements';
import { calculateRadiatorOutput, thermalRoom } from '../lib/heatingCalculations';
import { newEnergyProject, CONSTRUCTION_TEMPLATES } from '../lib/energyDocument';
import { withEnergyFabric } from '../lib/energyCalculations';
import { HeatingLayoutPanel } from '../components/HeatingLayoutPanel';
import { HeatingSpecsEditor } from '../components/HeatingSpecsEditor';
import type { Room } from '../lib/types';
const measure = (value: number) => ({ value, uncertainty_mm: 0, verified: true, source_type: 'USER_MEASURED' });
const room: Room = { id: 'room', name: 'Living room', version: 1, vertices: [{ x: 0, y: 0 }, { x: 7500, y: 0 }, { x: 7500, y: 4900 }, { x: 0, y: 4900 }], wall_height: measure(2500), wall_thickness: measure(100), openings: [], obstacles: [] };
const point = { flowC: 45, returnC: 40, roomC: 30 };
const hybrid = () => ({ ...newHeatingRadiator(room), emitterTechnology: 'Hybrid' as const, fanMode: 'Silent' as const, ratedOutputW: 1500, manufacturerPerformanceData: [], estimatedOutput: false });
test('manual hybrid output counts in the room and survives placed-object save/reload', () => {
  const old = hybrid(); assert.equal(calculateRadiatorOutput(old, 45, 40, 30).outputW, null);
  const r = { ...old, ...enteredHeatingOutput(old, 1500, point) };
  const data = newHeatingProject(); data.heatingSystem = { name: 'Heat pump', flowTemperatureC: 45, returnTemperatureC: 40 };
  data.rooms = [{ ...thermalRoom(room, data), designTemperatureOverride: true, designIndoorTemperatureC: 30 }]; data.radiators = [r];
  const stored = commitHeatingElements(parseHeatingProject(data), [room]);
  const view = withHeatingElements(parseHeatingProject(JSON.parse(JSON.stringify(stored.heatingLayout))), stored.rooms);
  assert.equal(heatingResults(stored.rooms, view).rooms[0].capacityW, 1500);
  assert.ok(!calculateRadiatorOutput(view.radiators[0], 45, 40, 30).estimated);
  assert.equal(calculateRadiatorOutput(r, 55, 45, 30).outputW, null);
  assert.equal(calculateRadiatorOutput({ ...r, fanMode: 'Boost' }, 45, 40, 30).outputW, null);
  assert.equal(calculateRadiatorOutput(r, 45, 40, 20).outputW, null);
});
test('editing, clearing and zero do not corrupt other operating conditions or fan ratings', () => {
  const original = { ...hybrid(), manufacturerPerformanceData: [{ ...point, outputW: 1200, electricalW: 5, fanMode: 'Silent' as const }, { ...point, outputW: 1900, electricalW: 20, fanMode: 'Boost' as const }, { ...point, flowC: 55, outputW: 2000, electricalW: 5, fanMode: 'Silent' as const }] };
  const edited = { ...original, ...enteredHeatingOutput(original, 1500, point) };
  assert.equal(edited.manufacturerPerformanceData.length, 3);
  assert.equal(calculateRadiatorOutput(edited, 45, 40, 30).outputW, 1500);
  assert.equal(calculateRadiatorOutput({ ...edited, fanMode: 'Boost' }, 45, 40, 30).outputW, 1900);
  const cleared = { ...edited, ...enteredHeatingOutput(edited, null, point) };
  assert.equal(calculateRadiatorOutput(cleared, 45, 40, 30).outputW, null);
  assert.equal(calculateRadiatorOutput({ ...cleared, ...enteredHeatingOutput(cleared, 0, point) }, 45, 40, 30).outputW, 0);
  assert.equal(original.manufacturerPerformanceData[0].outputW, 1200);
  assert.equal(heatingElementSpecSchema.safeParse({ ...original, ...enteredHeatingOutput(original, -1, point) }).success, false);
});
test('hybrid rating editor shows explicit temperatures and preserves a real zero', () => {
  const spec = heatingElementSpecSchema.parse({ ...hybrid(), ...enteredHeatingOutput(hybrid(), 0, point) });
  const html = renderToStaticMarkup(createElement(HeatingSpecsEditor, { value: spec, operatingConditions: point, onChange() {} }));
  assert.match(html, /Output at 45\/40\/30°C · Silent W/); assert.match(html, /value="0"/);
  assert.match(html, /other operating conditions need their own data/);
});
test('cleared explicit ratings stay unknown after commit; hybrids never acquire hydronic surrogate output', () => {
  for (const technology of ['Hydronic', 'Hybrid', 'Electric'] as const) {
    const r = { ...hybrid(), emitterTechnology: technology, ...enteredHeatingOutput({ ...hybrid(), emitterTechnology: technology }, null, point) };
    const stored = commitHeatingElements({ ...newHeatingProject(), radiators: [r] }, [room]);
    const restored = withHeatingElements(stored.heatingLayout, stored.rooms).radiators[0];
    assert.equal(restored.ratedOutputW, null); assert.ok(!restored.estimatedOutput);
    assert.equal(calculateRadiatorOutput(restored, 45, 40, 30).outputW, null);
  }
});
test('heating exposes the same existing/upgrade scenarios; inactive energy UI still drives heat loss', () => {
  const energy = newEnergyProject(); energy.enabled = false;
  energy.scenarios = [{ scenarioId: 'upgrade', name: 'Proposed Upgrade 1', assignments: [{ elementId: 'room|wall:0', assemblyId: null, uValue: .1 }] }]; energy.activeScenarioId = 'upgrade';
  const data = newHeatingProject(), r = { ...hybrid(), ...enteredHeatingOutput(hybrid(), 1500, point) }; data.radiators = [r];
  const props = { apiUrl: '/api', rooms: [room], data, energy, onEnergyChange() {}, selection: { kind: 'radiator' as const, id: r.radiatorId }, onChange() {}, onSelect() {}, onAdd() {}, onHighlightRoom() {}, onTool() {}, tool: null, onFinishPipe() {}, pipePointCount: 0, onFinishExclusion() {}, exclusionPointCount: 0, onUndo() {}, onRedo() {}, canUndo: false, canRedo: false, projectName: 'Test' };
  const html = renderToStaticMarkup(createElement(HeatingLayoutPanel, props));
  assert.match(html, /Load construction scenario/); assert.match(html, /Existing Building/); assert.match(html, /value="upgrade" selected=""/);
  const upgraded = heatingResults([room], withEnergyFabric(data, energy, [room]));
  const baseline = heatingResults([room], withEnergyFabric(data, energy, [room], null));
  assert.ok(upgraded.rooms[0].demand.designW < baseline.rooms[0].demand.designW);
  assert.deepEqual(upgraded.rooms[0].emitters, baseline.rooms[0].emitters);
});
test('all nine construction presets reference real, editable materials', () => {
  const data = newEnergyProject(), templates = CONSTRUCTION_TEMPLATES.filter(t => t.category === 'wall');
  assert.equal(templates.length, 9);
  for (const t of templates) for (const [id, thickness] of t.materials) { assert.ok(data.materials.some(m => m.materialId === id), `${t.name}: ${id}`); assert.ok(thickness > 0); }
});
test('full operating tables reject additions without dropping existing ratings', () => {
  const spec = { ...hybrid(), manufacturerPerformanceData: Array.from({ length: 500 }, (_, i) => ({ flowC: 40 + i / 100, returnC: 35, roomC: 20, fanMode: 'Silent' as const, outputW: 1000 + i, electricalW: 10 })) };
  const before = structuredClone(spec);
  assert.throws(() => enteredHeatingOutput(spec, 1500, point), /table is full/);
  assert.deepEqual(spec, before);
  assert.equal(enteredHeatingOutput(spec, 1234, { flowC: 40, returnC: 35, roomC: 20 }).manufacturerPerformanceData!.length, 500);
});
