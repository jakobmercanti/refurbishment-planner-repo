import test from 'node:test';
import assert from 'node:assert/strict';
import { electricalDevicePlanSize, electricalRockerBounds, electricalDevicePlanSymbol } from '../lib/electricalPlanSymbols.ts';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ElectricalLayoutOverlay } from '../components/ElectricalLayoutOverlay.tsx';
import { DEFAULT_ELECTRICAL_CONNECTION } from '../lib/electricalLayout.ts';
import type { Obstacle } from '../lib/types.ts';

test('multi-rocker switches keep the single-plate display height', () => {
  const variants = [
    ['electrical-switch-single', 86],
    ['electrical-switch-double', 86],
    ['electrical-switch-triple', 86],
    ['electrical-switch-quadruple', 146],
  ] as const;
  const sizes = variants.map(([key, width]) => electricalDevicePlanSize(key, width, 12, true));
  assert.deepEqual(sizes.map(size => size.depth), [86, 86, 86, 86]);
  assert.ok(sizes.every((size, index) => index === 0 || size.width > sizes[index - 1].width));
  assert.ok(sizes[3].width < 2.2 * sizes[0].width);
});

test('quadruple plate and all rocker state bands are symmetric and match the face', () => {
  const bounds = electricalRockerBounds('electrical-switch-quadruple')!;
  assert.equal(bounds.length, 4);
  assert.ok(Math.abs(bounds[0].x + bounds[3].x + bounds[3].width) < 1e-10);
  const svg = decodeURIComponent(electricalDevicePlanSymbol('electrical-switch-quadruple', true)!.dataUrl.split(',')[1]);
  assert.match(svg, /x="23" y="21" width="24"/);
  assert.match(svg, /x="137" y="21" width="24"/);
  for (const key of ['single', 'double', 'triple', 'quadruple']) {
    const b = electricalRockerBounds('electrical-switch-' + key)!;
    assert.ok(b.every(r => r.y === -.29 && r.height === .58));
    assert.ok(b.every(r => r.x >= -.5 && r.x + r.width <= .5));
  }
});

test('gang badges counter-rotate while the rocker hit areas retain their interaction', () => {
  const fixture = { id: 'switch-1', name: 'Double switch', representation_key: 'electrical-switch-double', rotation_deg: 180,
    center: { x: 0, y: 0 }, dimensions: { width: { value: 86 }, depth: { value: 12 }, height: { value: 86 } },
    fixture_kind: 'FURNITURE', kind: 'BOX', base_z_mm: 1000 } as Obstacle;
  const html = renderToStaticMarkup(createElement(ElectricalLayoutOverlay, { fixtures: [fixture], connections: [], circuits: [], toScreen: p => p,
    showSymbols: true, showConnections: false, showLabels: false, active: true, selectedFixtureId: null, sourceId: null,
    selectedConnectionId: null, activeCircuitId: 'circuit-1', connecting: true, forceOrthogonalRouting: true, cursor: null,
    defaults: DEFAULT_ELECTRICAL_CONNECTION, onFixturePointerDown() {}, onFixtureActivate() {}, onFixtureContextMenu() {},
    onConnectionPointerDown() {}, onConnectionContextMenu() {}, onWaypointPointerDown() {}, onWaypointContextMenu() {}, onLabelPointerDown() {} }));
  assert.match(html, /rotate\(-180\)/);
  assert.equal((html.match(/rotate\(180\)/g) ?? []).length, 2);
  assert.equal((html.match(/data-electrical-gang=/g) ?? []).length, 2);
});
