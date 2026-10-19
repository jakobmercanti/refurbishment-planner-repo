import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { PlacementPreview2D } from "../components/PlacementPreview2D";
import { ElectricalLayoutOverlay } from "../components/ElectricalLayoutOverlay";
import { FixturePlanSymbol } from "../components/FixturePlanSymbol";
import { HeatingLayoutOverlay } from "../components/HeatingLayoutOverlay";
import { newHeatingProject } from "../lib/heatingDocument";
import { newHeatingRadiator } from "../lib/heatingDesign";
import { elementFromRadiator } from "../lib/heatingElements";
import { DEFAULT_ELECTRICAL_CONNECTION } from "../lib/electricalLayout";
import type { Obstacle, Room } from "../lib/types";

const measure = (value: number) => ({ value, uncertainty_mm: 2, verified: true, source_type: "USER_MEASURED" });
const fixture = (key: string, width = 86, depth = 12): Obstacle => ({ id: key, name: key, kind: "BOX", fixture_kind: "FURNITURE", representation_key: key, center: { x: 1200, y: 900 }, rotation_deg: 90, base_z_mm: 1100, verified: true, dimensions: { width: measure(width), depth: measure(depth), height: measure(86) } });
const scaleFor = (zoom: number) => (p: { x: number; y: number }) => ({ x: 120 + p.x * .2 * zoom, y: 700 - p.y * .2 * zoom });
const render = (component, props) => renderToStaticMarkup(createElement(component, props));
const sameSize = (actual: number[], expected: number[], message?: string) => assert.ok(actual.every((n, i) => Math.abs(n - expected[i]) < 1e-9), `${message ?? "Symbol size mismatch"}: ${actual} / ${expected}`);
function symbolSize(markup: string, selector = "image") {
  const tag = markup.match(new RegExp(`<${selector}\\b[^>]*>`))?.[0];
  assert.ok(tag, `Missing ${selector}`);
  const zoom = Number(markup.match(/scale\(([^)]+)\)/)?.[1] ?? 1);
  return ["width", "height"].map(axis => Number(tag.match(new RegExp(` ${axis}="([^"]+)"`))?.[1]) * zoom);
}
function placedElectrical(obstacle: Obstacle, zoom: number, active: boolean) {
  return render(ElectricalLayoutOverlay, { fixtures: [obstacle], connections: [], circuits: [], toScreen: scaleFor(zoom), zoom, active,
    showSymbols: true, showConnections: false, showLabels: false, selectedFixtureId: null, sourceId: null, selectedConnectionId: null,
    activeCircuitId: "", connecting: false, forceOrthogonalRouting: true, cursor: null, defaults: DEFAULT_ELECTRICAL_CONNECTION,
    onFixturePointerDown() {}, onFixtureActivate() {}, onFixtureContextMenu() {}, onConnectionPointerDown() {}, onConnectionContextMenu() {},
    onWaypointPointerDown() {}, onWaypointContextMenu() {}, onLabelPointerDown() {} });
}

test("electrical placement faces match placed symbols at every zoom, without double sizing", () => {
  for (const active of [true, false]) for (const zoom of [.5, 1, 1.6, 3]) {
    for (const key of ["electrical-switch-single", "electrical-switch-double", "electrical-switch-triple", "electrical-switch-quadruple", "electrical-socket-double", "electrical-fan-axial", "electrical-ceiling-downlight"]) {
      const obstacle = fixture(key, key.endsWith("quadruple") ? 146 : 86), before = structuredClone(obstacle);
      const preview = render(PlacementPreview2D, { request: { id: "new", obstacle }, point: obstacle.center, candidate: { obstacle }, toScreen: scaleFor(zoom), zoom, units: "MM", electricalMode: active });
      const expected = symbolSize(placedElectrical(obstacle, zoom, active));
      const actual = symbolSize(preview);
      sameSize(actual, expected, `${key}, zoom ${zoom}, electrical ${active}`);
      const border = preview.match(/<rect\b[^>]*stroke-dasharray="5 3"[^>]*>/)?.[0];
      assert.ok(border);
      sameSize(["width", "height"].map(axis => Number(border.match(new RegExp(` ${axis}="([^"]+)"`))?.[1])), expected, "The placement outline must fit the visible face");
      assert.deepEqual(obstacle, before, "Rendering must not change authoritative measurements");
    }
  }
});

test("ordinary furniture stays physically scaled even when an electrical module is open", () => {
  const obstacle = fixture("furniture-chair", 450, 500);
  for (const zoom of [.5, 1, 3]) {
    const preview = render(PlacementPreview2D, { request: { id: "new", obstacle }, point: obstacle.center, candidate: null, toScreen: scaleFor(zoom), zoom, units: "MM", electricalMode: true });
    const toScreen = scaleFor(zoom), center = toScreen(obstacle.center);
    const placed = render(FixturePlanSymbol, { obstacle, x: center.x, y: center.y, width: 450 * .2 * zoom, depth: 500 * .2 * zoom });
    sameSize(symbolSize(preview), symbolSize(placed));
  }
});

test("thin heating previews use the same visible minima as placed emitters", () => {
  const obstacle = fixture("furniture-radiator-panel", 600, 20);
  for (const zoom of [.5, 1, 3]) {
    const preview = render(PlacementPreview2D, { request: { id: "new", obstacle }, point: obstacle.center, candidate: { obstacle }, toScreen: scaleFor(zoom), zoom, units: "MM" });
    const border = preview.match(/<rect\b[^>]*stroke-dasharray="5 3"[^>]*>/)?.[0]; assert.ok(border);
    assert.equal(Number(border.match(/ height="([^"]+)"/)?.[1]), Math.max(8, 20 * .2 * zoom));
    assert.equal(Number(border.match(/ width="([^"]+)"/)?.[1]), Math.max(24, 600 * .2 * zoom));
  }
});

test("heating-module previews match its schematic emitters without altering heating data", () => {
  const room: Room = { id: "room", name: "Studio", version: 1, vertices: [{ x: 0, y: 0 }, { x: 2400, y: 0 }, { x: 2400, y: 1800 }, { x: 0, y: 1800 }], wall_height: measure(2400), wall_thickness: measure(50), openings: [], obstacles: [] };
  const data = newHeatingProject(), radiator = newHeatingRadiator(room);
  data.radiators = [radiator]; const obstacle = elementFromRadiator(radiator), before = structuredClone(data);
  for (const zoom of [.5, 1, 3]) {
    const preview = render(PlacementPreview2D, { request: { id: "new", obstacle }, point: obstacle.center, candidate: { obstacle }, toScreen: scaleFor(zoom), zoom, units: "MM", heatingMode: true });
    const placed = render(HeatingLayoutOverlay, { data, rooms: [room], zoom, selection: null, onSelect() {}, onChange() {}, toScreen: scaleFor(zoom), fromClient: (x, y) => ({ x, y }), highlightedRoomId: null, draft: [] });
    const emitter = placed.match(/class="heating-emitter-symbol"[\s\S]*?<\/g>/)?.[0]; assert.ok(emitter);
    const border = preview.match(/<rect\b[^>]*stroke-dasharray="5 3"[^>]*>/)?.[0]; assert.ok(border);
    sameSize(symbolSize(border, "rect"), symbolSize(emitter, "rect"));
  }
  assert.deepEqual(data, before);
});
