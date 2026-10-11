import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { FixturePlanSymbol } from "../components/FixturePlanSymbol.tsx";
import { followWallAttachedFixtures } from "../lib/wallFixtureAttachment.ts";
import { elementFromRadiator } from "../lib/heatingElements.ts";
import { snapRadiatorToWall } from "../lib/heatingCalculations.ts";
import { newHeatingRadiator } from "../lib/heatingDesign.ts";
import type { Room } from "../lib/types.ts";

const measure = (value: number) => ({value, uncertainty_mm: 0, verified: true, source_type: "USER_MEASURED"});
const room: Room = {id: "room", name: "Room", version: 1, vertices: [{x:0,y:0},{x:5000,y:0},{x:5000,y:4000},{x:0,y:4000}], wall_height: measure(2500), wall_thickness: measure(0), openings: [], obstacles: []};
const wall = {id: "wall", points: [...room.vertices, room.vertices[0]]};
const heater = elementFromRadiator(snapRadiatorToWall(newHeatingRadiator(room), room, {x:5000,y:2200}));

test("standard heating symbols have solid outlines, fins and a usable hit target", () => {
  const original = structuredClone(heater);
  const html = renderToStaticMarkup(createElement(FixturePlanSymbol, {obstacle: heater, x: 0, y: 0, width: 30, depth: 3}));
  assert.match(html, /class="heating-plan-symbol"/);
  assert.match(html, /stroke-dasharray:none/);
  assert.match(html, /class="fixture-symbol-hit-area"[^>]*height="18"[^>]*pointer-events:all/);
  assert.equal((html.match(/<path/g) ?? []).length, 5);
  assert.deepEqual(heater, original, "screen minima never change measured dimensions");
  const legacy = {...heater, heating_spec: undefined};
  assert.match(renderToStaticMarkup(createElement(FixturePlanSymbol, {obstacle: legacy, x: 0, y: 0, width: 30, depth: 3})), /heating-plan-symbol/);
});

test("heating setback follows an inward wall resize even with zero wall thickness", () => {
  const resized = {...wall, points: [{x:0,y:0},{x:4000,y:0},{x:4000,y:4000},{x:0,y:4000},{x:0,y:0}]};
  const moved = followWallAttachedFixtures([heater], [wall], [resized], () => 0)[0];
  assert.equal(moved.center.x, heater.center.x - 1000);
  assert.equal(moved.center.y, heater.center.y);
  assert.deepEqual(moved.dimensions, heater.dimensions);
  assert.equal(moved.rotation_deg, heater.rotation_deg);
  assert.deepEqual(followWallAttachedFixtures([moved], [resized], [wall], () => 0)[0], heater);
});

test("both sides of a shared wall follow; free-standing heating stays put", () => {
  const otherSide = {...heater, id: "other-room-heater", center: {x: 5090, y: 2200}};
  const free = {...heater, id: "free-standing", center: {x:2500,y:2000}};
  const resized = {...wall, points: [{x:0,y:0},{x:4000,y:0},{x:4000,y:4000},{x:0,y:4000},{x:0,y:0}]};
  const moved = followWallAttachedFixtures([heater, otherSide, free], [wall], [resized], () => 0);
  assert.equal(moved[0].center.x, 3910);
  assert.equal(moved[1].center.x, 4090);
  assert.equal(moved[2], free);
});

test("normal fixture picking is above the wall hit layer; wall history covers all visible rooms", () => {
  const source = readFileSync(new URL("../components/FullFloorplanEditor.tsx", import.meta.url), "utf8");
  const canvas = source.slice(source.indexOf("<FloorPlanCanvas"));
  assert.ok(canvas.indexOf("visibleFixtures).filter") > canvas.indexOf("wall-selection-line"));
  assert.match(source, /captureWallFixtureAttachments\(visibleFixtures,/);
  assert.match(source, /fixturePositions: fixturePositions\(visibleFixtures\)/);
  assert.match(source, /persistFixturePositions\(value.fixturePositions\)/);
});
