import test from 'node:test';
import assert from 'node:assert/strict';
import { layoutEnergyLabels, labelBoxesOverlap, screenLabelToWorld, type EnergyLabelRequest } from '../lib/energyLabelLayout';
const rooms = [
  { id: 'a', polygon: [{ x: 0, y: 0 }, { x: 640, y: 0 }, { x: 640, y: 260 }, { x: 0, y: 260 }] },
  { id: 'b', polygon: [{ x: 408, y: 260 }, { x: 1008, y: 260 }, { x: 1008, y: 652 }, { x: 408, y: 652 }] },
];
const requests: EnergyLabelRequest[] = rooms.flatMap(r => [
  ...(['floor', 'roof'] as const).map(category => ({ id: `${r.id}-${category}`, roomId: r.id, width: 156, height: 34, category })),
  ...r.polygon.map((p, i) => ({ id: `${r.id}-wall-${i}`, roomId: r.id, category: 'wall' as const, width: 125, height: 14, start: p, end: r.polygon[(i + 1) % r.polygon.length] })),
]);
test('offset adjacent rooms have non-overlapping cards and wall labels independent of input order', () => {
  const original = structuredClone(requests), layout = layoutEnergyLabels(rooms, requests);
  assert.equal(Object.keys(layout).length, 12);
  const boxes = Object.values(layout).filter(Boolean);
  for (const [i, box] of boxes.entries()) for (const other of boxes.slice(i + 1)) assert.equal(labelBoxesOverlap(box!, other!), false);
  assert.deepEqual(layout, layoutEnergyLabels(rooms, [...requests].reverse())); assert.deepEqual(requests, original);
});
test('congested/low-zoom labels are suppressed instead of colliding; explicit position is retained', () => {
  const tiny = rooms.map(r => ({ ...r, polygon: r.polygon.map(p => ({ x: p.x / 10, y: p.y / 10 })) }));
  assert.equal(Object.keys(layoutEnergyLabels(tiny, requests.filter(r => r.category !== 'wall'))).length, 0);
  const desired = { ...requests[0], preferred: { x: -150, y: -40 } };
  assert.deepEqual(layoutEnergyLabels(rooms, [desired])[desired.id], { ...desired.preferred, width: 156, height: 34 });
});
test('label drag inversion supports flipped and rotated views without modifying geometry', () => {
  const transforms = [(p: { x: number; y: number }) => ({ x: 400 + p.x * .08, y: 600 - p.y * .08 }), (p: { x: number; y: number }) => ({ x: 100 - p.y * .1, y: 300 + p.x * .1 })];
  const p = { x: 2345, y: 6789 };
  for (const t of transforms) { const q = screenLabelToWorld(t(p), t); assert.ok(Math.abs(q.x - p.x) < 1e-6 && Math.abs(q.y - p.y) < 1e-6); }
});
test('short rooms fit floor/roof cards around the actual room title', () => {
  const short = [{ id: 'a', polygon: [{ x: 0, y: 0 }, { x: 320, y: 0 }, { x: 320, y: 136 }, { x: 0, y: 136 }], titleBox: { x: 160, y: 68, width: 100, height: 30 } }];
  const cards = requests.filter(r => r.roomId === 'a' && r.category !== 'wall');
  const layout = layoutEnergyLabels(short, cards); assert.equal(Object.keys(layout).length, 2);
  for (const box of Object.values(layout)) assert.equal(labelBoxesOverlap(box!, short[0].titleBox), false);
  assert.equal(labelBoxesOverlap(layout['a-floor']!, layout['a-roof']!), false);
});
