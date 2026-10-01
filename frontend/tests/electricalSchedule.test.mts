import test from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { electricalBomRows, electricalConnectionRows } from "../lib/electricalSchedule.ts";
import { DEFAULT_ELECTRICAL_CIRCUIT, DEFAULT_ELECTRICAL_DOCUMENTATION, DEFAULT_ELECTRICAL_LAYOUT, type ElectricalConnection, type ElectricalLayoutData } from "../lib/electricalLayout.ts";
import { planElectricalLayoutImport, type ElectricalLayoutPackage } from "../lib/electricalLayoutPackage.ts";
import type { Obstacle, Room } from "../lib/types.ts";
import { ElectricalScheduleWindow } from "../components/ElectricalScheduleWindow.tsx";

const obstacle = (id: string, center: { x: number; y: number }, representationKey: string, name = "Fitting", wallLock = false) => ({
  id, name, kind: "BOX", center,
  dimensions: { width: { value: 86 }, depth: { value: 14 }, height: { value: 86 } },
  rotation_deg: 0, representation_key: representationKey, wall_lock: wallLock,
} as unknown as Obstacle);

const room = (id: string, obstacles: Obstacle[] = []): Room => ({
  id, name: "Room 1", version: 1,
  vertices: [{ x: 0, y: 0 }, { x: 10000, y: 0 }, { x: 10000, y: 10000 }, { x: 0, y: 10000 }],
  obstacles,
} as unknown as Room);

function connection(id: string, fromId: string, toId: string, routing: ElectricalConnection["routing"] = "STRAIGHT", waypoints: ElectricalConnection["waypoints"] = []): ElectricalConnection {
  return { id, fromId, toId, type: "POWER", circuitId: DEFAULT_ELECTRICAL_CIRCUIT.id, color: "#287fb8", lineStyle: "DASHED", width: "MEDIUM", routing, waypoints };
}

function archive(items: Array<{ roomId: string; obstacle: Obstacle }>, connections: ElectricalConnection[] = [], forceOrthogonalRouting = true): ElectricalLayoutPackage {
  return {
    packageType: "freefloorplan3d-electrical-layout", schemaVersion: 1, projectName: "Example", exportedAt: "",
    items, assets: [], assetInstances: [],
    electricalLayout: { forceOrthogonalRouting, connections, circuits: [{ ...DEFAULT_ELECTRICAL_CIRCUIT }], documentation: structuredClone(DEFAULT_ELECTRICAL_DOCUMENTATION) },
  };
}

test("BOM counts identical catalogue identities but does not merge same-name custom assets", () => {
  const items = [
    obstacle("switch-1", { x: 500, y: 500 }, "electrical-switch-single", "Same name"),
    obstacle("switch-2", { x: 700, y: 500 }, "electrical-switch-single", "Same name"),
    obstacle("custom-1", { x: 900, y: 500 }, "electrical-custom-a", "Custom item"),
    obstacle("custom-2", { x: 1100, y: 500 }, "electrical-custom-b", "Custom item"),
  ];
  const rows = electricalBomRows([room("room-1", items)], DEFAULT_ELECTRICAL_LAYOUT);
  assert.equal(rows.length, 3);
  assert.equal(rows.find((row) => row.bomKey === "catalogue:electrical-switch-single")?.quantity, 2);
  assert.equal(rows.filter((row) => row.name === "Custom item").length, 2);
});

test("connection schedule derives schematic lengths and individual segment orientations", () => {
  const fittings = [
    obstacle("a", { x: 0, y: 0 }, "electrical-socket-single"),
    obstacle("b", { x: 3000, y: 4000 }, "electrical-socket-single"),
  ];
  const layout: ElectricalLayoutData = {
    ...DEFAULT_ELECTRICAL_LAYOUT,
    connections: [connection("direct", "a", "b"), connection("orthogonal", "a", "b", "ORTHOGONAL")],
  };
  const rows = electricalConnectionRows(layout, [room("room-1", fittings)]);
  assert.deepEqual(rows.map((row) => row.number), ["C001", "C002"]);
  assert.equal(rows[0].drawingLengthMm, 7000);
  assert.equal(rows[0].segments?.length, 2);
  assert.deepEqual(rows[0].segments?.map((segment) => segment.orientation), ["Horizontal", "Vertical"]);
  assert.equal(rows[1].drawingLengthMm, 7000);
  assert.deepEqual(rows[1].segments?.map((segment) => segment.orientation), ["Horizontal", "Vertical", "Horizontal"]);
  assert.equal(rows[1].segments?.[1].lengthMm, 4000);
  const unrestrictedRows = electricalConnectionRows({ ...layout, forceOrthogonalRouting: false }, [room("room-1", fittings)]);
  assert.equal(unrestrictedRows[0].drawingLengthMm, 5000);
  assert.equal(unrestrictedRows[0].segments?.[0].orientation, "Diagonal");
});

test("electrical schedule keeps notes and photos in BOM entry details without separate tabs", () => {
  const switchItem = obstacle("switch-1", { x: 500, y: 500 }, "electrical-switch-single", "Single rocker switch");
  const bomKey = "catalogue:electrical-switch-single";
  const layout: ElectricalLayoutData = {
    ...DEFAULT_ELECTRICAL_LAYOUT,
    documentation: {
      ...DEFAULT_ELECTRICAL_DOCUMENTATION,
      bomOverrides: { [bomKey]: { notes: "White finish" } },
      attachments: [{ attachmentId: "photo-1", fileName: "switch.jpg", mediaType: "image/jpeg", sizeBytes: 100, title: "Switch reference", caption: "", notes: "", includeInExport: false, relation: { kind: "BOM", id: bomKey } }],
    },
  };
  const markup = renderToStaticMarkup(createElement(ElectricalScheduleWindow, {
    rooms: [room("room-1", [switchItem])], assets: [], instances: [], layout, projectName: "Example", onLayoutChange: () => {},
  }));
  const tabs = markup.match(/<nav class="electrical-schedule-tabs"[\s\S]*?<\/nav>/)?.[0] ?? "";
  assert.match(tabs, />BOM<\/button>/);
  assert.match(tabs, />Circuits<\/button>/);
  assert.doesNotMatch(tabs, />Connections<\/button>|Notes &amp; photos<\/button>/);
  assert.match(markup, /Edit · notes &amp; photos/);
  assert.match(markup, /Switch reference/);
  assert.match(markup, /White finish/);
  assert.match(markup, /Project-wide notes, photos &amp; document details/);
});

test("electrical BOM uses the settings currency unless a row has its own currency", () => {
  const switchItem = obstacle("switch-1", { x: 500, y: 500 }, "electrical-switch-single", "Single rocker switch");
  const bomKey = "catalogue:electrical-switch-single";
  const layout: ElectricalLayoutData = {
    ...DEFAULT_ELECTRICAL_LAYOUT,
    documentation: {
      ...DEFAULT_ELECTRICAL_DOCUMENTATION,
      bomOverrides: { [bomKey]: { unitCost: 250 } },
      manualBomItems: [{ bomRowId: "manual-cable", description: "Cable", quantity: 1, unitCost: 80, currency: "EUR" }],
    },
  };
  const markup = renderToStaticMarkup(createElement(ElectricalScheduleWindow, {
    rooms: [room("room-1", [switchItem])], assets: [], instances: [], layout, projectName: "Example", defaultCurrency: "USD", onLayoutChange: () => {},
  }));

  assert.ok(markup.includes(new Intl.NumberFormat(undefined, { style: "currency", currency: "USD" }).format(250)));
  assert.ok(markup.includes(new Intl.NumberFormat(undefined, { style: "currency", currency: "EUR" }).format(80)));
  assert.match(markup, /value="USD"/);
});

test("Replace changes only electrical data and frees wall-mounted items without a wall reference", () => {
  const furniture = obstacle("sofa-1", { x: 5000, y: 5000 }, "sofa");
  const oldElectrical = obstacle("old-switch", { x: 500, y: 500 }, "electrical-switch-single");
  const current = room("room-1", [furniture, oldElectrical]);
  const imported = obstacle("new-switch", { x: 2500, y: 2500 }, "electrical-switch-double", "Wall switch", true);
  const plan = planElectricalLayoutImport(archive([{ roomId: "room-1", obstacle: imported }], [], false), [current], DEFAULT_ELECTRICAL_LAYOUT, [], [], "REPLACE", new Map());
  assert.deepEqual(plan.rooms[0].vertices, current.vertices);
  assert.equal(plan.rooms[0].obstacles.some((item) => item.id === "sofa-1"), true);
  assert.equal(plan.rooms[0].obstacles.some((item) => item.id === "old-switch"), false);
  assert.equal(plan.rooms[0].obstacles.find((item) => item.id === "new-switch")?.wall_lock, false);
  assert.match(plan.warnings.join(" "), /free-positioned/);
  assert.equal(plan.electricalLayout.forceOrthogonalRouting, false);
});

test("Merge remaps fitting and connection IDs without replacing existing layout data", () => {
  const oldFrom = obstacle("switch-1", { x: 500, y: 500 }, "electrical-switch-single");
  const oldTo = obstacle("light-1", { x: 1500, y: 500 }, "electrical-ceiling-round");
  const importedFrom = obstacle("switch-1", { x: 2500, y: 500 }, "electrical-switch-single");
  const importedTo = obstacle("light-1", { x: 3500, y: 500 }, "electrical-ceiling-round");
  const currentConnection = connection("connection-old", "switch-1", "light-1");
  const incomingConnection = connection("connection-new", "switch-1", "light-1");
  const currentLayout: ElectricalLayoutData = { ...DEFAULT_ELECTRICAL_LAYOUT, forceOrthogonalRouting: false, connections: [currentConnection] };
  const plan = planElectricalLayoutImport(archive([{ roomId: "room-1", obstacle: importedFrom }, { roomId: "room-1", obstacle: importedTo }], [incomingConnection]), [room("room-1", [oldFrom, oldTo])], currentLayout, [], [], "MERGE", new Map());
  assert.equal(plan.electricalLayout.connections.length, 2);
  assert.equal(plan.electricalLayout.forceOrthogonalRouting, false);
  assert.equal(plan.electricalLayout.connections[0].id, "connection-old");
  const addedConnection = plan.electricalLayout.connections[1];
  assert.notEqual(addedConnection.fromId, "switch-1");
  assert.notEqual(addedConnection.toId, "light-1");
  assert.equal(plan.rooms[0].obstacles.some((item) => item.id === addedConnection.fromId), true);
  assert.equal(plan.rooms[0].obstacles.some((item) => item.id === addedConnection.toId), true);
});
