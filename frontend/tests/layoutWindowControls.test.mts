import test from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { electricalEndpointLabel, electricalFittingReferences, electricalGangConnections } from "../lib/electricalConnectionLabels.ts";
import { createElectricalConnection, DEFAULT_ELECTRICAL_CONNECTION, DEFAULT_ELECTRICAL_LAYOUT } from "../lib/electricalLayout.ts";
import { ElectricalLayoutPanel } from "../components/ElectricalLayoutPanel.tsx";
import { ElectricalScheduleWindow } from "../components/ElectricalScheduleWindow.tsx";
import { EnergyLayoutProvider, useEnergyLayout } from "../components/EnergyLayoutContext.tsx";
import { newEnergyProject } from "../lib/energyDocument.ts";

const fittings = [
  { id: "s1", label: "Switch", representation_key: "electrical-switch-double" },
  { id: "s2", label: "Switch", representation_key: "electrical-switch-triple" },
  { id: "s3", label: "Switch", representation_key: "electrical-switch-quadruple" },
  { id: "l1", label: "Pendant", representation_key: "electrical-pendant-dome" },
  { id: "l2", label: "Pendant", representation_key: "electrical-pendant-dome" },
];
const circuitId = DEFAULT_ELECTRICAL_LAYOUT.circuits[0].id;
const wire = (fromId: string, toId: string, fromSwitchGang?: number, toSwitchGang?: number) => createElectricalConnection({ fromId, toId, fromSwitchGang, toSwitchGang, circuitId }, [])!;

test("identical names get distinct plan references, independent of current room ordering", () => {
  assert.deepEqual(electricalFittingReferences(fittings), { s1: "S1", s2: "S2", s3: "S3", l1: "L1", l2: "L2" });
  assert.deepEqual(electricalFittingReferences([...fittings].reverse()), electricalFittingReferences(fittings));
  assert.equal(electricalEndpointLabel(wire("s3", "l2", 4), "from", fittings), "S3 · Switch · Gang 4");
  assert.equal(electricalEndpointLabel(wire("s3", "l2", 4), "to", fittings), "L2 · Pendant");
});
test("per-rocker maps include reverse endpoints and legacy Gang 1 without mixing gangs", () => {
  const links = [wire("s1", "l1"), wire("l2", "s1", undefined, 2), wire("s2", "l1", 3), wire("s3", "l2", 4)];
  assert.deepEqual(electricalGangConnections(links, "s1", 1).map(row => row.connection), [links[0]]);
  assert.equal(electricalGangConnections(links, "s1", 2)[0].otherEndpoint, "from");
  assert.equal(electricalGangConnections(links, "s2", 2).length, 0);
  assert.equal(electricalGangConnections(links, "s2", 3).length, 1);
  assert.equal(electricalGangConnections(links, "s3", 4).length, 1);
});
test("connection map exposes all 2/3/4 rockers with exact endpoint labels and selected source", () => {
  const links = [wire("s1", "l1", 1), wire("l2", "s1", undefined, 2)];
  const html = renderToStaticMarkup(createElement(ElectricalLayoutPanel, {
    mode: true, connecting: true, sourceId: "s1", sourceGang: 2, onConnectGang() {}, onConnect() {}, onAdd() {}, onCheckout() {}, onFinishConnection() {},
    forceOrthogonalRouting: true, onForceOrthogonalRoutingChange() {}, currentCount: 5,
    defaults: DEFAULT_ELECTRICAL_CONNECTION, onDefaultsChange() {}, display: { symbols: true, connections: true, circuitLabels: false }, onDisplayChange() {},
    objects: fittings, connections: links, selectedConnectionId: links[0].id, onSelectConnection() {}, onUpdateConnection() {}, onDeleteConnection() {},
    circuits: DEFAULT_ELECTRICAL_LAYOUT.circuits, activeCircuitId: circuitId, onActiveCircuitChange() {}, onCreateCircuit() {}, onUpdateCircuit() {}, onDeleteCircuit() {},
  }));
  assert.equal((html.match(/aria-label="Connect S\d Gang \d"/g) ?? []).length, 9);
  assert.match(html, /G2 · Choose destination/);
  assert.match(html, /S1 · Switch · Gang 1/);
  assert.match(html, /S1 · Switch · Gang 2/);
  assert.match(html, /L1 · Pendant/); assert.match(html, /L2 · Pendant/);
  assert.doesNotMatch(html, /Electrical layout mode/);
});
test("BOM contents start collapsed without removing export and manual item controls", () => {
  const html = renderToStaticMarkup(createElement(ElectricalScheduleWindow, { rooms: [], assets: [], instances: [], layout: DEFAULT_ELECTRICAL_LAYOUT, projectName: "Test", onLayoutChange() {} }));
  assert.match(html, /<details class="electrical-project-documentation electrical-bom-section"><summary>Bill of materials · 0 items<\/summary>/);
  assert.match(html, /Export BOM CSV/); assert.match(html, /Add manual BOM item/);
});
test("persisted energy enabled state cannot activate the overlay without its window", () => {
  function Probe() { const energy = useEnergyLayout(); return createElement("span", { "data-mode": energy.data.enabled, "data-window": energy.windowOpen }); }
  const data = newEnergyProject(); data.enabled = true;
  const html = renderToStaticMarkup(createElement(EnergyLayoutProvider, { data, onChange() {}, onOpen() {} }, createElement(Probe)));
  assert.match(html, /data-mode="false" data-window="false"/);
});
