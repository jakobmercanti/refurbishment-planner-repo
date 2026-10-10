import test from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { newHeatingProject } from "../lib/heatingDocument";
import { heatingResults, newHeatingRadiator, newUFHZone } from "../lib/heatingDesign";
import { heatingRoomBalance } from "../lib/heatingPresentation";
import { HeatingLayoutPanel } from "../components/HeatingLayoutPanel";
import { HeatingLayoutOverlay } from "../components/HeatingLayoutOverlay";
import { HeatingLayoutProvider, useHeatingLayout } from "../components/HeatingLayoutContext";
import type { Room } from "../lib/types";

const measured = (value: number) => ({ value, uncertainty_mm: 0, verified: true, source_type: "USER_MEASURED" });
const room: Room = { id: "room", name: "Living room", version: 1, vertices: [{ x: 0, y: 0 }, { x: 5000, y: 0 }, { x: 5000, y: 4000 }, { x: 0, y: 4000 }], wall_height: measured(2500), wall_thickness: measured(100), openings: [], obstacles: [] };
const makeHeating = (outputW: number | null = 5000) => ({ ...newHeatingProject(), radiators: [{ ...newHeatingRadiator(room, "Electric"), ratedOutputW: outputW, model: "Room heater" }] });
const result = (heating = makeHeating()) => heatingResults([room], heating).rooms[0];

test("known room output exceeding demand has a green surplus comparison", () => {
  const row = result(), balance = heatingRoomBalance(row);
  assert.equal(balance.tone, "sufficient"); assert.equal(balance.estimated, false);
  assert.equal(balance.differenceW, row.capacityW - row.demand.designW);
  assert.match(balance.indicator, /Surplus \+/); assert.match(balance.detail, /spare capacity/);
  assert.equal(row.status, "Sufficient");
});
test("estimated output can show an explicitly estimated green balance, never a verified pass", () => {
  const heating = makeHeating(); heating.radiators[0].estimatedOutput = true;
  const row = result(heating), balance = heatingRoomBalance(row);
  assert.equal(balance.tone, "sufficient"); assert.match(balance.headline, /^Estimated/);
  assert.match(balance.indicator, /^Estimated surplus/); assert.match(balance.capacityText, /^~/);
  assert.equal(row.status, "Not verified"); assert.equal(heatingResults([room], heating).sufficient, 0);
});

test("incomplete fabric data does not hide a surplus from known room emitters", () => {
  const heating = makeHeating();
  heating.thermalOverrides = { "room|wall:0": { warning: "Energy construction inputs incomplete; fallback retained." } };
  const row = result(heating), balance = heatingRoomBalance(row);
  assert.equal(row.status, "Not verified");
  assert.equal(balance.tone, "sufficient");
  assert.equal(balance.estimated, true);
  assert.match(balance.indicator, /Estimated surplus/);
  assert.ok(row.warnings.some(w => w.startsWith("Energy ")));
});
test("missing or unsuitable UFH output never produces a green pass even with a large radiator", () => {
  const missing = heatingRoomBalance(result(makeHeating(null)));
  assert.equal(missing.tone, "review"); assert.match(missing.headline, /checking/);
  const heating = makeHeating(); heating.ufhZones = [newUFHZone(room, null)];
  assert.equal(heatingRoomBalance(result(heating)).tone, "review");
});
test("boiler rating is not room heat, and an empty room asks the user to add heating", () => {
  const heating = makeHeating(24000); heating.radiators[0].category = "Boiler";
  const row = result(heating);
  assert.equal(row.capacityW, 0); assert.equal(heatingRoomBalance(row).tone, "empty");
  assert.equal(heatingRoomBalance(heatingResults([room], newHeatingProject()).rooms[0]).tone, "empty");
});
test("shortfalls distinguish marginal and insufficient capacity; exact demand is sufficient", () => {
  const demand = result().demand.designW;
  assert.equal(heatingRoomBalance(result(makeHeating(demand * 0.95))).tone, "marginal");
  assert.equal(heatingRoomBalance(result(makeHeating(demand * 0.5))).tone, "insufficient");
  assert.equal(heatingRoomBalance(result(makeHeating(demand))).tone, "sufficient");
});
test("system-temperature changes recalculate the same room comparison", () => {
  const heating = makeHeating(); heating.radiators[0].emitterTechnology = "Hydronic";
  heating.heatingSystem = { name: "Boiler", flowTemperatureC: 75, returnTemperatureC: 65 };
  const hot = result(heating); assert.equal(heatingRoomBalance(hot).tone, "sufficient");
  const cold = result({ ...heating, heatingSystem: { name: "Low temperature", flowTemperatureC: 30, returnTemperatureC: 25 } });
  assert.ok(cold.capacityW < hot.capacityW); assert.equal(heatingRoomBalance(cold).tone, "insufficient");
});
test("central room symbol contains a green fill, demand, capacity and textual surplus", () => {
  const heating = makeHeating(); heating.enabled = true;
  const html = renderToStaticMarkup(createElement(HeatingLayoutOverlay, { data: heating, rooms: [room], selection: null, onSelect() {}, onChange() {}, toScreen: p => ({ x: p.x / 10, y: p.y / 10 }), fromClient: (x, y) => ({ x, y }), highlightedRoomId: null, draft: [] }));
  assert.match(html, /data-balance="sufficient"/); assert.match(html, /heating-room-status-fill[^>]*fill="#15803d"/);
  assert.match(html, /Heat loss:/); assert.match(html, /Heat available:/); assert.match(html, /Surplus \+/);
});
test("a rotated heating element keeps its output label upright", () => {
  const heating = makeHeating(); heating.enabled = true; heating.radiators[0].rotationDeg = 180;
  const html = renderToStaticMarkup(createElement(HeatingLayoutOverlay, { data: heating, rooms: [room], selection: null, onSelect() {}, onChange() {}, toScreen: p => ({ x: p.x / 10, y: p.y / 10 }), fromClient: (x, y) => ({ x, y }), highlightedRoomId: null, draft: [] }));
  assert.match(html, /rotate\(180\)" class="heating-emitter-symbol"/);
  assert.match(html, /rotate\(-180\)/);
});
test("redesigned panel has structured room balance, expandable technical fields, no mode checkbox", () => {
  const data = makeHeating(); data.enabled = true;
  const html = renderToStaticMarkup(createElement(HeatingLayoutPanel, { apiUrl: "/api", rooms: [room], data, selection: { kind: "radiator", id: data.radiators[0].radiatorId }, onChange() {}, onSelect() {}, onAdd() {}, onHighlightRoom() {}, onTool() {}, tool: null, onFinishPipe() {}, pipePointCount: 0, onFinishExclusion() {}, exclusionPointCount: 0, onUndo() {}, onRedo() {}, canUndo: false, canRedo: false, projectName: "Test" }));
  assert.doesNotMatch(html, /Heating layout mode/); assert.match(html, /Room heating balance/);
  assert.match(html, /Heat required/); assert.match(html, /Heat available/);
  assert.match(html, /Room setup/); assert.match(html, /Heating elements/);
  assert.match(html, /Identity, dimensions &amp; position/); assert.match(html, /Output &amp; performance/);
  assert.match(html, /Heating pipes &amp; connections/); assert.match(html, /Assumptions &amp; professional review/);
  assert.doesNotMatch(html, /Auto Design Heating|Advanced automatic sizing reference|\+ Add heating element/);
  assert.equal((html.match(/role="tab"/g) ?? []).length, 5);
});
test("persisted enabled state cannot activate heating mode without its window", () => {
  function Probe() { const heating = useHeatingLayout();return createElement("span", { "data-mode": heating.data.enabled, "data-window": heating.windowOpen }); }
  const data = makeHeating(); data.enabled = true;
  const html = renderToStaticMarkup(createElement(HeatingLayoutProvider, { data, rooms: [room], onChange() {}, onOpen() {} }, createElement(Probe)));
  assert.match(html, /data-mode="false"/); assert.match(html, /data-window="false"/);
});
