import test from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ElectricalLayoutPanel } from "../components/ElectricalLayoutPanel.tsx";
import {
  canAddElectricalObstacle,
  createElectricalConnection,
  DEFAULT_ELECTRICAL_CONNECTION,
  electricalConnectionPoints,
  electricalDashArray,
  isElectricalObstacle,
  normalizeElectricalLayout,
  type ElectricalConnection,
} from "../lib/electricalLayout.ts";
import { newProject, parseProject } from "../lib/projectDocument.ts";

const fixture = (id: string) => ({ id, representation_key: "electrical-wall-socket" });

test("electrical catalogue classification and free limit count only placed Electric fittings", () => {
  const rooms = [{ obstacles: [fixture("one"), fixture("two")] }] as unknown as Parameters<typeof canAddElectricalObstacle>[0];
  assert.equal(isElectricalObstacle(fixture("one")), true);
  assert.equal(isElectricalObstacle({ representation_key: "bathroom-basin" }), false);
  assert.equal(canAddElectricalObstacle(rooms, fixture("three") as Parameters<typeof canAddElectricalObstacle>[1], 5), true);
  assert.equal(canAddElectricalObstacle(rooms, fixture("six") as Parameters<typeof canAddElectricalObstacle>[1], null), true);
  const full = [{ obstacles: Array.from({ length: 5 }, (_, index) => fixture("electric-" + index)) }] as unknown as Parameters<typeof canAddElectricalObstacle>[0];
  assert.equal(canAddElectricalObstacle(full, fixture("six") as Parameters<typeof canAddElectricalObstacle>[1], 5), false);
  assert.equal(canAddElectricalObstacle(full, fixture("electric-0") as Parameters<typeof canAddElectricalObstacle>[1], 5), true);
});

test("electrical connections reject self-links and exact duplicates while allowing a fan-out", () => {
  const first = createElectricalConnection({ fromId: "switch-1", toId: "light-1" }, []);
  assert.ok(first);
  assert.equal(createElectricalConnection({ fromId: "switch-1", toId: "switch-1" }, []), null);
  assert.equal(createElectricalConnection({ fromId: "switch-1", toId: "light-1" }, [first]), null);
  const second = createElectricalConnection({ fromId: "switch-1", toId: "light-2", type: "CONTROL" }, [first]);
  assert.ok(second);
  assert.equal(second.fromId, first.fromId);
});

test("line style and routing helpers preserve straight, orthogonal and manual paths", () => {
  const from = { x: 0, y: 0 };
  const to = { x: 120, y: 80 };
  const connection: ElectricalConnection = {
    id: "connection-1",
    fromId: "socket-1",
    toId: "socket-2",
    type: "POWER",
    ...DEFAULT_ELECTRICAL_CONNECTION,
    waypoints: [],
  };
  assert.deepEqual(electricalConnectionPoints(connection, from, to), [from, { x: 60, y: 0 }, { x: 60, y: 80 }, to]);
  assert.deepEqual(electricalConnectionPoints({ ...connection, routing: "STRAIGHT" }, from, to), [from, to]);
  const manualPoint = { x: 40, y: 35 };
  assert.deepEqual(electricalConnectionPoints({ ...connection, routing: "MANUAL", waypoints: [manualPoint] }, from, to), [from, manualPoint, to]);
  assert.equal(electricalDashArray("SOLID"), undefined);
  assert.equal(electricalDashArray("DASH_DOT"), "9 4 1 4");
});

test("project decoding adds empty electrical data for legacy projects and removes dangling edges", () => {
  const legacy = newProject();
  delete legacy.electricalLayout;
  const parsedLegacy = parseProject(legacy);
  assert.deepEqual(parsedLegacy.electricalLayout, { connections: [], circuits: [] });

  const normalized = normalizeElectricalLayout({
    circuits: [{ id: "lighting", name: "Lighting", color: "#ffcc33" }],
    connections: [
      { id: "valid", fromId: "switch-1", toId: "light-1", type: "CONTROL", circuitId: "lighting", color: "#287fb8", lineStyle: "DASHED", width: "MEDIUM", routing: "ORTHOGONAL", waypoints: [] },
      { id: "dangling", fromId: "switch-1", toId: "missing", type: "GENERIC", color: "#287fb8", lineStyle: "DASHED", width: "MEDIUM", routing: "STRAIGHT", waypoints: [] },
    ],
  }, new Set(["switch-1", "light-1"]));
  assert.equal(normalized.connections.length, 1);
  assert.equal(normalized.connections[0].circuitId, "lighting");
});

test("electrical panel exposes mode, routing and display controls with inherited circuit colour", () => {
  const connection: ElectricalConnection = {
    id: "connection-1", fromId: "switch-1", toId: "light-1", type: "CONTROL",
    ...DEFAULT_ELECTRICAL_CONNECTION, circuitId: "lighting", colorOverride: false,
  };
  const markup = renderToStaticMarkup(createElement(ElectricalLayoutPanel, {
    mode: true, onModeChange: () => {}, connecting: false, onConnect: () => {}, onAdd: () => {},
    maximum: 5, currentCount: 2, defaults: DEFAULT_ELECTRICAL_CONNECTION, onDefaultsChange: () => {},
    display: { symbols: true, connections: true, circuitLabels: false }, onDisplayChange: () => {},
    objects: [{ id: "switch-1", label: "Wall switch" }, { id: "light-1", label: "Ceiling light" }],
    connections: [connection], selectedConnectionId: connection.id, onSelectConnection: () => {},
    onUpdateConnection: () => {}, onDeleteConnection: () => {},
    circuits: [{ id: "lighting", name: "Lighting", color: "#ffaa00" }], activeCircuitId: "lighting",
    onActiveCircuitChange: () => {}, onCreateCircuit: () => {}, onUpdateCircuit: () => {}, onDeleteCircuit: () => {},
  }));
  assert.match(markup, /Electrical layout mode/);
  assert.match(markup, /Orthogonal/);
  assert.match(markup, /Circuit labels/);
  assert.match(markup, /Wall switch/);
  assert.match(markup, /aria-label="Connection colour"[^>]*value="#ffaa00"/);
});
