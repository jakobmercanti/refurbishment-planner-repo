import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { constrainObstacleToRoom, obstacleFitsInRoom, obstacleFootprint, transferObstacle } from "../lib/elementPlacement";
import { newHeatingRadiator } from "../lib/heatingDesign";
import { newHeatingProject } from "../lib/heatingDocument";
import { snapRadiatorToWall } from "../lib/heatingCalculations";
import { elementFromRadiator, migrateHeatingElements } from "../lib/heatingElements";
import { electricalConnectionPoints, DEFAULT_ELECTRICAL_CONNECTION } from "../lib/electricalLayout";
import { EnergyLayoutOverlay } from "../components/EnergyLayoutOverlay";
import { FloorPlanFixtureSpacingDimensions, heatingWallClearanceSpan } from "../components/FloorPlanFixtureDimensions";
import { newEnergyProject } from "../lib/energyDocument";
import { energyElements, isInsulationSelectable } from "../lib/energyCalculations";
import { layoutEnergyLabels, labelBoxesOverlap } from "../lib/energyLabelLayout";
import { followWallAttachedFixtures } from "../lib/wallFixtureAttachment";
import type { Room } from "../lib/types";

const measure = (value: number) => ({ value, uncertainty_mm: 0, verified: true, source_type: "USER_MEASURED" });
const room: Room = { id: "room", name: "Room 1", version: 1, vertices: [{ x: 0, y: 0 }, { x: 5000, y: 0 }, { x: 5000, y: 4000 }, { x: 0, y: 4000 }], wall_height: measure(2500), wall_thickness: measure(100), openings: [], obstacles: [] };
const heater = elementFromRadiator(newHeatingRadiator(room));
test("standard heater placement cannot be free-standing or independently rotated", () => {
  for (const point of [{ x: 2300, y: 2000 }, { x: 4800, y: 1900 }, { x: 50, y: 20 }]) {
    const mounted = constrainObstacleToRoom({ ...heater, wall_lock: false, rotation_deg: 37 }, room, point)!;
    assert.equal(mounted.wall_lock, true);
    assert.ok(obstacleFitsInRoom(mounted, room));
    assert.equal(Math.abs(mounted.rotation_deg) % 90, 0);
    const footprint = obstacleFootprint(mounted);
    assert.ok(footprint.some(p => Math.abs(p.x - 51) < .01 || Math.abs(p.x - 4949) < .01 || Math.abs(p.y - 51) < .01 || Math.abs(p.y - 3949) < .01));
  }
  const moved = transferObstacle([room], { ...heater, wall_lock: false, center: { x: 2500, y: 2000 } }, room.id)[0].obstacles[0];
  assert.equal(moved.wall_lock, true);
  assert.notDeepEqual(moved.center, { x: 2500, y: 2000 });
});
test("legacy heaters migrate to measured wall faces once; impossible placements are refused", () => {
  const legacy = { ...room, obstacles: [{ ...heater, wall_lock: false, center: { x: 2500, y: 2000 }, rotation_deg: 23 }] };
  const migrated = migrateHeatingElements([legacy]);
  assert.deepEqual(migrateHeatingElements(migrated.rooms, migrated.heatingLayout), migrated);
  assert.equal(migrated.rooms[0].obstacles[0].wall_lock, true);
  const huge = { ...heater, dimensions: { ...heater.dimensions, width: measure(10000), depth: measure(9000) } };
  assert.equal(constrainObstacleToRoom(huge, room), null);
  assert.deepEqual(transferObstacle([room], huge, room.id), [room]);
});
test("only two end-wall face clearances are drawn for a mounted heater", () => {
  const corner = snapRadiatorToWall({ ...newHeatingRadiator(room), widthMm: 100, depthMm: 400 }, room, { x: 100, y: 100 });
  const a = room.vertices[corner.wallIndex!], b = room.vertices[(corner.wallIndex! + 1) % room.vertices.length];
  assert.ok(Math.abs(Math.sin(Math.atan2(b.y - a.y, b.x - a.x) + corner.rotationDeg * Math.PI / 180)) < 1e-6, "mount metadata uses the parallel host wall even if a perpendicular wall is nearer");
  for (const at of [{ x: 1800, y: 0 }, { x: 5000, y: 2000 }]) {
    const radiator = snapRadiatorToWall(newHeatingRadiator(room), room, at);
    const item = elementFromRadiator(radiator), span = heatingWallClearanceSpan(item, room)!;
    const wallLength = span.segmentIndex % 2 ? 4000 : 5000;
    assert.ok(Math.abs(span.startOffsetMm + span.widthMm + span.endOffsetMm - (wallLength - 100)) < .01);
    const html = renderToStaticMarkup(createElement(FloorPlanFixtureSpacingDimensions, { span, toScreen: p => ({ x: p.x / 10, y: p.y / 10 }), displayUnits: "MM" }));
    assert.equal((html.match(/<text/g) ?? []).length, 2);
    assert.doesNotMatch(html, /X width|Y depth/);
  }
});
test("a heater near a wall end stays inside when the wall span shrinks", () => {
  const original = elementFromRadiator(snapRadiatorToWall(newHeatingRadiator(room), room, { x: 4500, y: 0 }));
  const oldWall = { id: "outline", points: [...room.vertices, room.vertices[0]] };
  const smaller = { ...room, vertices: [{ x: 0, y: 0 }, { x: 3000, y: 0 }, { x: 3000, y: 4000 }, { x: 0, y: 4000 }] };
  const nextWall = { id: "outline", points: [...smaller.vertices, smaller.vertices[0]] };
  const moved = followWallAttachedFixtures([original], [oldWall], [nextWall], () => 100)[0];
  assert.ok(obstacleFitsInRoom(moved, smaller));
  assert.ok(moved.center.x <= 3000 - moved.dimensions.width.value / 2 - 51);
});
test("default switch routes depart normally for horizontal/vertical switches, including reversed endpoints", () => {
  const connection = { ...DEFAULT_ELECTRICAL_CONNECTION, routing: "ORTHOGONAL" as const, id: "wire", fromId: "s", toId: "l", circuitId: "c", waypoints: [] };
  for (const rotation_deg of [0, 90, 180, 270]) {
    const fixture = { representation_key: "electrical-switch-quadruple", rotation_deg };
    const from = { x: 100, y: 100 }, to = { x: 700, y: 800 };
    const points = electricalConnectionPoints(connection, from, to, true, fixture);
    assert.deepEqual(points[0], from); assert.deepEqual(points.at(-1), to);
    assert.equal(rotation_deg % 180 === 0 ? points[1].x : points[1].y, rotation_deg % 180 === 0 ? from.x : from.y);
    const reversed = electricalConnectionPoints(connection, to, from, true, undefined, fixture);
    assert.deepEqual(reversed, [...points].reverse());
    const aligned = rotation_deg % 180 === 0 ? { x: 700, y: from.y } : { x: from.x, y: 800 };
    const departure = electricalConnectionPoints(connection, from, aligned, true, fixture);
    assert.notDeepEqual(departure[0], departure[1]);
    assert.equal(rotation_deg % 180 === 0 ? departure[1].x : departure[1].y, rotation_deg % 180 === 0 ? from.x : from.y);
    const manual = { ...connection, waypoints: [{ x: 400, y: 100 }] };
    assert.deepEqual(electricalConnectionPoints(manual, from, to, false, fixture), [from, ...manual.waypoints, to]);
  }
});
test("insulation never draws shared-wall overlays, but keeps both surfaces in every room", () => {
  const neighbor = { ...room, id: "next", name: "Room 2", vertices: room.vertices.map(p => ({ ...p, x: p.x + 5000 })) };
  const heating = newHeatingProject(), energy = newEnergyProject();
  assert.equal(energy.display.floors, true); assert.equal(energy.display.roofs, true);
  const elements = energyElements([room, neighbor], heating, energy);
  const internal = elements.filter(e => e.category === "wall" && !isInsulationSelectable(e));
  assert.equal(internal.length, 2);
  assert.ok(internal.every(e => !isInsulationSelectable({ ...e, boundary: "Unheated" }, [room, neighbor])));
  const html = renderToStaticMarkup(createElement(EnergyLayoutOverlay, { rooms: [room, neighbor], heating, data: energy, selectedIds: [], onSelect() {}, onChange() {}, toScreen: p => ({ x: p.x / 10, y: p.y / 10 }), fromClient: (x, y) => ({ x, y }) }));
  assert.equal((html.match(/data-energy-category="floor"/g) ?? []).length, 2);
  assert.equal((html.match(/data-energy-category="roof"/g) ?? []).length, 2);
  for (const e of internal) assert.ok(!html.includes(e.label));
  assert.match(html, /data-plan-info=/);
});
test("compact floor/roof controls remain centered and disjoint from room titles", () => {
  const polygon = [{ x: 0, y: 0 }, { x: 240, y: 0 }, { x: 240, y: 180 }, { x: 0, y: 180 }];
  const titleBox = { x: 120, y: 90, width: 100, height: 24 };
  const labels = layoutEnergyLabels([{ id: "r", polygon, titleBox }], ["floor", "roof"].map(category => ({ id: category, roomId: "r", category: category as "floor" | "roof", width: 132, height: 20 })));
  assert.equal(labels.floor?.x, 120); assert.equal(labels.roof?.x, 120);
  assert.ok(!labelBoxesOverlap(labels.floor!, labels.roof!));
  assert.ok(!labelBoxesOverlap(labels.floor!, titleBox)); assert.ok(!labelBoxesOverlap(labels.roof!, titleBox));
});
