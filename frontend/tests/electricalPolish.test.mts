import test from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { constrainObstacleToRoom, obstacleFitsInRoom, transferObstacle } from "../lib/elementPlacement";
import { newProject, parseProject } from "../lib/projectDocument";
import { electricalPlanEndpoint } from "../lib/electricalPlanPorts";
import { DEFAULT_ELECTRICAL_CONNECTION, DEFAULT_ELECTRICAL_LAYOUT } from "../lib/electricalLayout";
import { ElectricalLayoutOverlay } from "../components/ElectricalLayoutOverlay";
import { HeatingLayoutOverlay } from "../components/HeatingLayoutOverlay";
import { newHeatingProject, parseHeatingProject } from "../lib/heatingDocument";
import { exportElectricalLayoutPackage, readElectricalLayoutPackage } from "../lib/electricalLayoutPackage";
import { followWallAttachedFixtures } from "../lib/wallFixtureAttachment";
import type { Obstacle, Room } from "../lib/types";
const measurement = (value: number) => ({ value, uncertainty_mm: 0, verified: true, source_type: "USER_MEASURED" });
const fitting: Obstacle = { id: "socket", name: "Socket", kind: "BOX", center: { x: 2500, y: 1800 }, dimensions: { width: measurement(86), depth: measurement(14), height: measurement(86) }, rotation_deg: 37, base_z_mm: 350, verified: false, representation_key: "electrical-socket-single", wall_lock: false, plan_symbol_url: "" };
const room: Room = { id: "room", name: "Room", version: 0, vertices: [{ x: 0, y: 0 }, { x: 5000, y: 0 }, { x: 5000, y: 4000 }, { x: 0, y: 4000 }], wall_height: measurement(2500), wall_thickness: measurement(100), obstacles: [fitting], openings: [] };
test("sockets/switches mount in placement, transfer and legacy project loading, while lamps stay free", () => {
  for (const key of ["electrical-socket-single", "electrical-switch-triple"]) {
    const item = { ...fitting, representation_key: key }, mounted = constrainObstacleToRoom(item, room)!;
    assert.equal(mounted.wall_lock, true); assert.equal(mounted.center.y, 58); assert.equal(mounted.rotation_deg % 180, 0); assert.ok(obstacleFitsInRoom(mounted, room));
    assert.equal(transferObstacle([room], item, room.id)[0].obstacles[0].wall_lock, true);
    const loaded = parseProject({ ...newProject(), rooms: [{ ...room, obstacles: [item] }] });
    assert.deepEqual(loaded.rooms[0].obstacles[0].center, mounted.center);
  }
  const lamp = { ...fitting, representation_key: "electrical-pendant-dome" };
  assert.deepEqual(constrainObstacleToRoom(lamp, room)?.center, lamp.center);
});
test("mounted sockets remain against moving walls", () => {
  const mounted = constrainObstacleToRoom(fitting, room)!;
  const wall = { id: "wall", points: [...room.vertices, room.vertices[0]] };
  const moved = { ...wall, points: wall.points.map(p => ({ ...p, y: p.y === 0 ? 500 : p.y })) };
  const next = followWallAttachedFixtures([mounted], [wall], [moved], () => 100)[0];
  assert.equal(next.center.y, 558); assert.equal(next.rotation_deg, mounted.rotation_deg);
});
test("portable layouts accept empty URLs and inert embedded symbols but reject external/active content", async () => {
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><rect x="5" y="5" width="90" height="90" fill="#fff"/></svg>';
  const withSvg = { ...fitting, plan_symbol_data_url: 'data:image/svg+xml;base64,' + btoa(svg) };
  const blob = await exportElectricalLayoutPackage("Test", [{ ...room, obstacles: [withSvg] }], [], [], DEFAULT_ELECTRICAL_LAYOUT);
  const result = await readElectricalLayoutPackage(new File([blob], "Test.electricallayout"));
  assert.equal(result.data.items[0].obstacle.plan_symbol_data_url, withSvg.plan_symbol_data_url);
  for (const value of ['https://evil.example/symbol.svg', 'data:image/svg+xml;base64,' + btoa(svg.replace('<rect', '<script/><rect')), 'data:image/svg+xml;base64,' + btoa(svg.replace('fill="#fff"', 'onload="alert(1)"')), 'data:image/svg+xml;base64,' + btoa(svg.replace('<rect', '<image href="https://evil.example"/><rect'))]) {
    assert.throws(() => parseProject({ ...newProject(), rooms: [{ ...room, obstacles: [{ ...fitting, plan_symbol_data_url: value }] }] }), /External resources/);
  }
});
test("supersized electrical plates, badges and terminal offsets scale with zoom", () => {
  const item = { ...fitting, representation_key: "electrical-switch-triple", rotation_deg: 180 };
  const connection = { ...DEFAULT_ELECTRICAL_CONNECTION, id: "wire", fromId: item.id, toId: "light", fromSwitchGang: 1, circuitId: "c" };
  const screen = (zoom: number) => (p: { x: number; y: number }) => ({ x: p.x * .1 * zoom, y: -p.y * .1 * zoom });
  assert.deepEqual(electricalPlanEndpoint(connection, "from", item, screen(1), true, 1), electricalPlanEndpoint(connection, "from", item, screen(.5), true, .5));
  const html = renderToStaticMarkup(createElement(ElectricalLayoutOverlay, { fixtures: [item], connections: [], circuits: [], toScreen: screen(.5), active: true, zoom: .5, showSymbols: true, showConnections: true, showLabels: true, selectedFixtureId: null, sourceId: null, selectedConnectionId: null, activeCircuitId: "", connecting: false, forceOrthogonalRouting: true, cursor: null, defaults: DEFAULT_ELECTRICAL_CONNECTION, onFixturePointerDown() {}, onFixtureActivate() {}, onFixtureContextMenu() {}, onConnectionPointerDown() {}, onConnectionContextMenu() {}, onWaypointPointerDown() {}, onWaypointContextMenu() {}, onLabelPointerDown() {} }));
  assert.match(html, /scale\(0.5\)/); assert.match(html, /electrical-gang-badge/);
});
test("compact heating summaries are draggable and presentation positions survive save/parse", () => {
  const data = { ...newHeatingProject(), roomIndicatorPositions: { room: { x: 1000, y: 1200 } } };
  assert.deepEqual(parseHeatingProject(data).roomIndicatorPositions, data.roomIndicatorPositions);
  const html = renderToStaticMarkup(createElement(HeatingLayoutOverlay, { data, rooms: [room], selection: null, onSelect() {}, onChange() {}, toScreen: p => p, fromClient: (x, y) => ({ x, y }), highlightedRoomId: null, draft: [] }));
  assert.match(html, /translate\(1000,1237\) scale\(.82\)/); assert.match(html, /Move heating summary: Room/); assert.match(html, /pointer-events="all"/);
});
