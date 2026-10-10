import test from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ElectricalLayoutPanel } from "../components/ElectricalLayoutPanel.tsx";
import {
  createElectricalConnection,
  DEFAULT_ELECTRICAL_CIRCUIT,
  DEFAULT_ELECTRICAL_CONNECTION,
  electricalConnectionPoints,
  electricalDashArray,
  isElectricalObstacle,
  normalizeElectricalLayout,
  type ElectricalConnection,
} from "../lib/electricalLayout.ts";
import { newProject, parseProject } from "../lib/projectDocument.ts";

const fixture = (id: string) => ({ id, representation_key: "electrical-wall-socket" });

test("electrical catalogue classification remains separate from layout data", () => {
  assert.equal(isElectricalObstacle(fixture("one")), true);
  assert.equal(isElectricalObstacle({ representation_key: "bathroom-basin" }), false);
});

test("electrical connections reject self-links and exact duplicates while allowing a fan-out", () => {
  const first = createElectricalConnection({ fromId: "switch-1", toId: "light-1", circuitId: DEFAULT_ELECTRICAL_CIRCUIT.id }, []);
  assert.ok(first);
  assert.equal(createElectricalConnection({ fromId: "switch-1", toId: "switch-1", circuitId: DEFAULT_ELECTRICAL_CIRCUIT.id }, []), null);
  assert.equal(createElectricalConnection({ fromId: "switch-1", toId: "light-1", circuitId: DEFAULT_ELECTRICAL_CIRCUIT.id }, [first]), null);
  const second = createElectricalConnection({ fromId: "switch-1", toId: "light-2", type: "CONTROL", circuitId: DEFAULT_ELECTRICAL_CIRCUIT.id }, [first]);
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
  assert.deepEqual(electricalConnectionPoints({ ...connection, routing: "MANUAL", waypoints: [manualPoint] }, from, to, true), [from, { x: 40, y: 0 }, manualPoint, { x: 120, y: 35 }, to]);
  assert.equal(electricalDashArray("SOLID"), undefined);
  assert.equal(electricalDashArray("DASH_DOT"), "9 4 1 4");
});

test("project decoding creates a starter circuit for legacy projects and removes dangling edges", () => {
  const legacy = newProject();
  delete legacy.electricalLayout;
  const parsedLegacy = parseProject(legacy);
  assert.deepEqual(parsedLegacy.electricalLayout, { forceOrthogonalRouting: true, connections: [], circuits: [DEFAULT_ELECTRICAL_CIRCUIT], documentation: { bomOverrides: {}, hiddenBomKeys: [], manualBomItems: [], connectionNotes: {}, circuitNotes: {}, generalNotes: "", attachments: [], exportMetadata: {} } });

  const normalized = normalizeElectricalLayout({
    circuits: [{ id: "lighting", name: "Lighting", color: "#ffcc33" }],
    connections: [
      { id: "valid", fromId: "switch-1", toId: "light-1", type: "CONTROL", circuitId: "lighting", color: "#287fb8", lineStyle: "DASHED", width: "MEDIUM", routing: "ORTHOGONAL", waypoints: [] },
      { id: "dangling", fromId: "switch-1", toId: "missing", type: "GENERIC", color: "#287fb8", lineStyle: "DASHED", width: "MEDIUM", routing: "STRAIGHT", waypoints: [] },
    ],
  }, new Set(["switch-1", "light-1"]));
  assert.equal(normalized.connections.length, 1);
  assert.equal(normalized.connections[0].circuitId, "lighting");
  assert.equal(normalized.forceOrthogonalRouting, true);
  const legacyUnassigned = normalizeElectricalLayout({
    circuits: [{ id: "lighting", name: "Lighting", color: "#ffcc33" }],
    connections: [{ id: "legacy-unassigned", fromId: "switch-1", toId: "light-1", type: "GENERIC", ...DEFAULT_ELECTRICAL_CONNECTION, waypoints: [] }],
  }, new Set(["switch-1", "light-1"]));
  assert.equal(legacyUnassigned.connections[0].circuitId, "lighting");
  const migrated = normalizeElectricalLayout({
    circuits: [],
    connections: [{ id: "legacy-link", fromId: "switch-1", toId: "light-1", type: "GENERIC", ...DEFAULT_ELECTRICAL_CONNECTION, waypoints: [] }],
  }, new Set(["switch-1", "light-1"]));
  assert.deepEqual(migrated.circuits, [DEFAULT_ELECTRICAL_CIRCUIT]);
  assert.equal(migrated.connections[0].circuitId, DEFAULT_ELECTRICAL_CIRCUIT.id);
  assert.equal(normalizeElectricalLayout({ forceOrthogonalRouting: false }, new Set()).forceOrthogonalRouting, false);
});

test("electrical panel exposes mode, routing and display controls with inherited circuit colour", () => {
  const connection: ElectricalConnection = {
    id: "connection-1", fromId: "switch-1", toId: "light-1", type: "CONTROL",
    ...DEFAULT_ELECTRICAL_CONNECTION, circuitId: "lighting", colorOverride: false,
  };
  const secondConnection: ElectricalConnection = {
    ...connection, id: "connection-2", colorOverride: false,
  };
  const markup = renderToStaticMarkup(createElement(ElectricalLayoutPanel, {
    mode: true, onModeChange: () => {}, connecting: false, onConnect: () => {}, onAdd: () => {},
    onCheckout: () => {}, onFinishConnection: () => {},
    forceOrthogonalRouting: true, onForceOrthogonalRoutingChange: () => {},
    currentCount: 2, defaults: DEFAULT_ELECTRICAL_CONNECTION, onDefaultsChange: () => {},
    display: { symbols: true, connections: true, circuitLabels: false }, onDisplayChange: () => {},
    objects: [{ id: "switch-1", label: "Wall switch" }, { id: "light-1", label: "Ceiling light" }],
    connections: [connection, secondConnection], selectedConnectionId: connection.id, onSelectConnection: () => {},
    onUpdateConnection: () => {}, onDeleteConnection: () => {},
    circuits: [{ id: "lighting", name: "Lighting", color: "#ffaa00" }], activeCircuitId: "lighting",
    onActiveCircuitChange: () => {}, onCreateCircuit: () => {}, onUpdateCircuit: () => {}, onDeleteCircuit: () => {},
  }));
  assert.match(markup, /Electrical layout mode/);
  assert.match(markup, /Orthogonal/);
  assert.match(markup, /Force horizontal \/ vertical circuit routes/);
  assert.match(markup, /Circuit labels/);
  assert.doesNotMatch(markup, /<summary>Electrical layout help/);
  assert.match(markup, /Check layout/);
  assert.match(markup, />Ok<\/button>/);
  assert.match(markup, /Double-click/);
  assert.match(markup, /Right-click a route leg to add a corner/);
  assert.match(markup, /Circuits \(1\)/);
  assert.equal([...markup.matchAll(/<summary>Connections \(2\)<\/summary>/g)].length, 1);
  assert.doesNotMatch(markup, /Unassigned connections/);
  assert.ok(markup.indexOf("Circuits (1)") < markup.indexOf("Connections (2)"));
  assert.match(markup, /aria-label="Edit connection from Wall switch to Ceiling light"/);
  assert.match(markup, /aria-label="Delete connection from Wall switch to Ceiling light"/);
  assert.match(markup, /Selected for new connections/);
  const actionGrid = markup.match(/<div class="electrical-layout-actions" aria-label="Electrical layout actions">(.*?)<\/div>/)?.[1] ?? "";
  assert.equal((actionGrid.match(/<button\b/g) ?? []).length, 7);
  const buttonOrder = ["Save layout", "Load layout", "Export", "BOM / Schedule", "Connect", "Add electrical fitting…", "Check layout"];
  assert.ok(buttonOrder.every((label, index) => actionGrid.indexOf(label) >= 0 && (index === 0 || actionGrid.indexOf(buttonOrder[index - 1]) < actionGrid.indexOf(label))));
  assert.doesNotMatch(markup, /aria-label="Delete circuit Lighting"/);
  assert.doesNotMatch(markup, />No circuit<\/option>/);
  assert.match(markup, /New circuit/);
  assert.doesNotMatch(markup, /Active circuit/);
  assert.match(markup, /Wall switch/);
  assert.match(markup, /aria-label="Connection colour"[^>]*value="#ffaa00"/);
});
