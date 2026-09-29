import test from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ElectricalLayoutPanel } from "../components/ElectricalLayoutPanel.tsx";
import {
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

test("electrical catalogue classification remains separate from the paid layout module", () => {
  assert.equal(isElectricalObstacle(fixture("one")), true);
  assert.equal(isElectricalObstacle({ representation_key: "bathroom-basin" }), false);
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
  assert.deepEqual(electricalConnectionPoints({ ...connection, routing: "MANUAL", waypoints: [manualPoint] }, from, to, true), [from, { x: 40, y: 0 }, manualPoint, { x: 120, y: 35 }, to]);
  assert.equal(electricalDashArray("SOLID"), undefined);
  assert.equal(electricalDashArray("DASH_DOT"), "9 4 1 4");
});

test("project decoding adds empty electrical data for legacy projects and removes dangling edges", () => {
  const legacy = newProject();
  delete legacy.electricalLayout;
  const parsedLegacy = parseProject(legacy);
  assert.deepEqual(parsedLegacy.electricalLayout, { forceOrthogonalRouting: true, connections: [], circuits: [], documentation: { bomOverrides: {}, hiddenBomKeys: [], manualBomItems: [], connectionNotes: {}, circuitNotes: {}, generalNotes: "", attachments: [], exportMetadata: {} } });

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
  assert.equal(normalizeElectricalLayout({ forceOrthogonalRouting: false }, new Set()).forceOrthogonalRouting, false);
});

test("electrical panel exposes mode, routing and display controls with inherited circuit colour", () => {
  const connection: ElectricalConnection = {
    id: "connection-1", fromId: "switch-1", toId: "light-1", type: "CONTROL",
    ...DEFAULT_ELECTRICAL_CONNECTION, circuitId: "lighting", colorOverride: false,
  };
  const unassignedConnection: ElectricalConnection = {
    ...connection, id: "connection-2", circuitId: undefined, colorOverride: true,
  };
  const markup = renderToStaticMarkup(createElement(ElectricalLayoutPanel, {
    mode: true, onModeChange: () => {}, connecting: false, onConnect: () => {}, onAdd: () => {},
    forceOrthogonalRouting: true, onForceOrthogonalRoutingChange: () => {},
    currentCount: 2, defaults: DEFAULT_ELECTRICAL_CONNECTION, onDefaultsChange: () => {},
    display: { symbols: true, connections: true, circuitLabels: false }, onDisplayChange: () => {},
    objects: [{ id: "switch-1", label: "Wall switch" }, { id: "light-1", label: "Ceiling light" }],
    connections: [connection, unassignedConnection], selectedConnectionId: connection.id, onSelectConnection: () => {},
    onUpdateConnection: () => {}, onDeleteConnection: () => {},
    circuits: [{ id: "lighting", name: "Lighting", color: "#ffaa00" }], activeCircuitId: "lighting",
    onActiveCircuitChange: () => {}, onCreateCircuit: () => {}, onUpdateCircuit: () => {}, onDeleteCircuit: () => {},
  }));
  assert.match(markup, /Electrical layout mode/);
  assert.match(markup, /Orthogonal/);
  assert.match(markup, /Force horizontal \/ vertical circuit routes/);
  assert.match(markup, /Circuit labels/);
  assert.match(markup, /Connections are stored inside their circuit/);
  assert.match(markup, /Double-click/);
  assert.match(markup, /connect several pairs/);
  assert.match(markup, /Right-click a connection line to add a corner/);
  assert.match(markup, /not physical cable routes or cable lengths/);
  assert.match(markup, /Circuits \(1\)/);
  assert.equal([...markup.matchAll(/<summary>Connections \(1\)<\/summary>/g)].length, 1);
  assert.match(markup, /<summary>Unassigned connections \(1\)<\/summary>/);
  assert.ok(markup.indexOf("Circuits (1)") < markup.indexOf("Connections (1)"));
  assert.ok(markup.indexOf("Circuits (1)") < markup.indexOf("Unassigned connections (1)"));
  assert.ok(markup.indexOf("New circuit") < markup.indexOf("Unassigned connections (1)"));
  assert.match(markup, /aria-label="Edit connection from Wall switch to Ceiling light"/);
  assert.match(markup, /aria-label="Delete connection from Wall switch to Ceiling light"/);
  assert.match(markup, /Selected for new connections/);
  const actionGrid = markup.match(/<div class="electrical-layout-actions" aria-label="Electrical layout actions">(.*?)<\/div>/)?.[1] ?? "";
  assert.equal((actionGrid.match(/<button\b/g) ?? []).length, 6);
  const buttonOrder = ["Save layout", "Load layout", "Export", "BOM / Schedule", "Connect", "Add electrical fitting…"];
  assert.ok(buttonOrder.every((label, index) => actionGrid.indexOf(label) >= 0 && (index === 0 || actionGrid.indexOf(buttonOrder[index - 1]) < actionGrid.indexOf(label))));
  assert.match(markup, /aria-label="Delete circuit Lighting"/);
  assert.match(markup, /Cancel<\/button>/);
  assert.match(markup, /New circuit/);
  assert.ok(markup.indexOf("Cancel</button>") < markup.indexOf("New circuit</button>"));
  assert.doesNotMatch(markup, /Active circuit/);
  assert.match(markup, /Wall switch/);
  assert.match(markup, /aria-label="Connection colour"[^>]*value="#ffaa00"/);
});
