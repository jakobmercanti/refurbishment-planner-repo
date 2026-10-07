"use client";

import type { ElectricalCircuit, ElectricalConnection, ElectricalConnectionDefaults, ElectricalConnectionType, ElectricalLineStyle, ElectricalLineWidth, ElectricalRouting } from "@/lib/electricalLayout";

export interface ElectricalDisplayOptions { symbols: boolean; connections: boolean; circuitLabels: boolean }
export interface ElectricalObjectOption { id: string; label: string }

const styles: [ElectricalLineStyle, string][] = [["SOLID", "Solid"], ["DASHED", "Dashed"], ["DOTTED", "Dotted"], ["DASH_DOT", "Dash-dot"]];
const widths: [ElectricalLineWidth, string][] = [["THIN", "Thin"], ["MEDIUM", "Medium"], ["THICK", "Thick"]];
const routings: [ElectricalRouting, string][] = [["ORTHOGONAL", "Orthogonal"], ["STRAIGHT", "Straight"], ["MANUAL", "Manual"]];
const types: [ElectricalConnectionType, string][] = [["GENERIC", "Generic"], ["CONTROL", "Control"], ["POWER", "Power / circuit"]];
type Props = {
  mode: boolean; onModeChange: (value: boolean) => void; connecting: boolean; repeatConnecting?: boolean; onConnect: (mode: "single" | "repeat") => void; onAdd: () => void;
  forceOrthogonalRouting: boolean; onForceOrthogonalRoutingChange: (value: boolean) => void;
  onSaveLayout?: () => void; onLoadLayout?: () => void; onExport?: () => void; onSchedule?: () => void;
  status?: string | null; currentCount: number; defaults: ElectricalConnectionDefaults;
  onDefaultsChange: (value: ElectricalConnectionDefaults) => void; display: ElectricalDisplayOptions;
  onDisplayChange: (value: ElectricalDisplayOptions) => void; objects: ElectricalObjectOption[];
  connections: ElectricalConnection[]; selectedConnectionId: string | null; onSelectConnection: (id: string) => void;
  onUpdateConnection: (id: string, patch: Partial<ElectricalConnection>) => void; onDeleteConnection: (id: string) => void;
  circuits: ElectricalCircuit[]; activeCircuitId: string | null; onActiveCircuitChange: (id: string) => void;
  onCreateCircuit: () => void; onUpdateCircuit: (id: string, patch: Partial<ElectricalCircuit>) => void; onDeleteCircuit: (id: string) => void;
};

export function ElectricalLayoutPanel(p: Props) {
  const circuit = p.circuits.find((item) => item.id === p.activeCircuitId) ?? p.circuits[0] ?? null;
  const activeCircuitId = circuit?.id ?? null;
  const name = (id: string) => p.objects.find((item) => item.id === id)?.label ?? "Missing fitting";
  const connectionGroup = (circuitId: string) => {
    const groupedConnections = p.connections.filter((item) => item.circuitId === circuitId);
    const selected = groupedConnections.find((item) => item.id === p.selectedConnectionId) ?? null;
    const selectedCircuit = p.circuits.find((item) => item.id === circuitId);
    const selectedColour = selected?.colorOverride === false && selectedCircuit ? selectedCircuit.color : selected?.color;
    const title = `Connections (${groupedConnections.length})`;
    const updateSelected = (patch: Partial<ElectricalConnection>) => {
      if (!selected) return;
      p.onUpdateConnection(selected.id, patch);
      if (Object.hasOwn(patch, "circuitId")) p.onActiveCircuitChange(patch.circuitId ?? circuitId);
    };
    const selectConnection = (id: string) => {
      p.onActiveCircuitChange(circuitId);
      p.onSelectConnection(id);
    };
    return <details className="electrical-layout-section electrical-circuit-connections" open key={circuitId}>
      <summary>{title}</summary>
      {groupedConnections.length ? <ul className="electrical-connection-list">{groupedConnections.map((item) => {
        const from = name(item.fromId);
        const to = name(item.toId);
        return <li className="electrical-connection-row" key={item.id}>
          <button type="button" className={item.id === p.selectedConnectionId ? "selected" : ""} aria-pressed={item.id === p.selectedConnectionId} aria-label={`Select connection from ${from} to ${to}`} onClick={() => selectConnection(item.id)}><span>{from} → {to}</span><small>{types.find(([value]) => value === item.type)?.[1]}</small></button>
          <button type="button" className="electrical-connection-action" aria-label={`Edit connection from ${from} to ${to}`} title="Edit connection" onClick={() => selectConnection(item.id)}>Edit</button>
          <button type="button" className="electrical-connection-action delete" aria-label={`Delete connection from ${from} to ${to}`} title="Delete connection" onClick={() => p.onDeleteConnection(item.id)}>Delete</button>
        </li>;
      })}</ul> : <p className="electrical-layout-empty">No connections in this circuit yet.</p>}
      {selected && <div className="electrical-connection-properties">
        <p className="electrical-connection-endpoints">From <strong>{name(selected.fromId)}</strong> → To <strong>{name(selected.toId)}</strong></p>
        <div className="electrical-layout-grid">
          <label className="field"><span>Relationship</span><select value={selected.type} onChange={(e) => updateSelected({ type: e.target.value as ElectricalConnectionType })}>{types.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
          <label className="field"><span>Colour</span><input aria-label="Connection colour" type="color" value={selectedColour ?? selected.color} onChange={(e) => updateSelected({ color: e.target.value, colorOverride: true })} /></label>
          <label className="field"><span>Style</span><select value={selected.lineStyle} onChange={(e) => updateSelected({ lineStyle: e.target.value as ElectricalLineStyle })}>{styles.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
          <label className="field"><span>Width</span><select value={selected.width} onChange={(e) => updateSelected({ width: e.target.value as ElectricalLineWidth })}>{widths.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
          <label className="field"><span>Routing</span><select value={selected.routing} disabled={p.forceOrthogonalRouting} onChange={(e) => updateSelected({ routing: e.target.value as ElectricalRouting })}>{routings.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
          <label className="field"><span>Circuit</span><select value={selected.circuitId ?? circuitId} onChange={(e) => updateSelected({ circuitId: e.target.value, colorOverride: false })}>{p.circuits.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
        </div>
        {selected.circuitId && <button type="button" className="review-style-button" onClick={() => updateSelected({ colorOverride: false })}>Use circuit colour</button>}
        <label className="field"><span>Optional label</span><input value={selected.label ?? ""} maxLength={100} onChange={(e) => updateSelected({ label: e.target.value || undefined })} /></label>
        <p className="electrical-layout-hint">Right-click a route leg to add a corner, or right-click a corner to remove it. Drag a corner to reshape the route.</p>
        <button type="button" className="danger-button" onClick={() => p.onDeleteConnection(selected.id)}>Delete connection</button>
      </div>}
    </details>;
  };
  return <div className="electrical-layout-panel evidence-panel">
    <label className="electrical-mode-toggle"><input type="checkbox" checked={p.mode} onChange={(event) => p.onModeChange(event.target.checked)} /><span><strong>Electrical layout mode</strong></span></label>
    <div className="electrical-layout-actions" aria-label="Electrical layout actions">
      <button type="button" className="review-style-button" onClick={p.onSaveLayout} disabled={!p.onSaveLayout}>Save layout</button>
      <button type="button" className="review-style-button" onClick={p.onLoadLayout} disabled={!p.onLoadLayout}>Load layout</button>
      <button type="button" className="review-style-button" onClick={p.onExport} disabled={!p.onExport}>Export</button>
      <button type="button" className="review-style-button" onClick={p.onSchedule} disabled={!p.onSchedule}>BOM / Schedule</button>
      <button type="button" className="review-style-button" aria-label={p.connecting ? (p.repeatConnecting ? "Cancel repeat connection command" : "Cancel connection command") : "Connect fittings. Double-click to connect multiple pairs."} title={p.connecting ? "Click to cancel the active connection command." : "Click to connect one pair; double-click to connect multiple pairs."} aria-pressed={p.connecting} disabled={!p.mode || p.objects.length < 2} onClick={(event) => { if (event.detail <= 1) p.onConnect("single"); }} onDoubleClick={() => p.onConnect("repeat")}>{p.connecting ? (p.repeatConnecting ? "Cancel repeat connect" : "Cancel connect") : "Connect"}</button>
      <button type="button" className="review-style-button" onClick={p.onAdd}>Add electrical fitting…</button>
    </div>
    <p className="electrical-layout-count" role="status">{p.currentCount} electrical fittings in this project</p>
    {p.status && <p className="electrical-layout-status" role="status">{p.status}</p>}
    {p.connecting && <p className="electrical-connect-hint" role="status">{p.repeatConnecting ? "Select a source and destination. After each connection, choose any new pair. Esc cancels." : "Select a source and destination. The command ends after one connection. Esc cancels."}</p>}
    <details className="electrical-layout-section" open><summary>New connection defaults</summary><div className="electrical-layout-grid">
      <label className="field"><span>Colour</span><input aria-label="Default connection colour" type="color" value={p.defaults.color} onChange={(e) => p.onDefaultsChange({ ...p.defaults, color: e.target.value })} /></label>
      <label className="field"><span>Style</span><select value={p.defaults.lineStyle} onChange={(e) => p.onDefaultsChange({ ...p.defaults, lineStyle: e.target.value as ElectricalLineStyle })}>{styles.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
      <label className="field"><span>Width</span><select value={p.defaults.width} onChange={(e) => p.onDefaultsChange({ ...p.defaults, width: e.target.value as ElectricalLineWidth })}>{widths.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
      <label className="field"><span>Routing</span><select value={p.defaults.routing} disabled={p.forceOrthogonalRouting} onChange={(e) => p.onDefaultsChange({ ...p.defaults, routing: e.target.value as ElectricalRouting })}>{routings.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
      <label className="field"><span>Relationship</span><select value={p.defaults.type} onChange={(e) => p.onDefaultsChange({ ...p.defaults, type: e.target.value as ElectricalConnectionType })}>{types.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
    </div><label className="electrical-orthogonal-toggle"><input type="checkbox" checked={p.forceOrthogonalRouting} onChange={(e) => p.onForceOrthogonalRoutingChange(e.target.checked)} /><span>Force horizontal / vertical circuit routes</span></label></details>
    <details className="electrical-layout-section" open><summary>Display</summary><div className="electrical-layout-display">
      <label><input type="checkbox" checked={p.display.symbols} onChange={(e) => p.onDisplayChange({ ...p.display, symbols: e.target.checked })} /> Electrical symbols</label>
      <label><input type="checkbox" checked={p.display.connections} onChange={(e) => p.onDisplayChange({ ...p.display, connections: e.target.checked })} /> Connections</label>
      <label><input type="checkbox" checked={p.display.circuitLabels} onChange={(e) => p.onDisplayChange({ ...p.display, circuitLabels: e.target.checked })} /> Circuit labels</label>
    </div></details>
    <details className="electrical-layout-section" open><summary>Circuits ({p.circuits.length})</summary>
      {p.circuits.length ? <ul className="electrical-connection-list electrical-circuit-list">{p.circuits.map((item) => <li className="electrical-circuit-row" key={item.id}>
        <button type="button" className={`electrical-circuit-select ${item.id === activeCircuitId ? "selected" : ""}`} aria-pressed={item.id === activeCircuitId} onClick={() => p.onActiveCircuitChange(item.id)}><span className="electrical-circuit-name"><i style={{ backgroundColor: item.color }} aria-hidden="true" />{item.name}</span><small>{item.id === activeCircuitId ? "Selected for new connections" : "Select for new connections"}</small></button>
        {p.circuits.length > 1 && <button type="button" className="electrical-connection-action delete electrical-circuit-delete" aria-label={`Delete circuit ${item.name}`} title={`Delete ${item.name}`} onClick={() => p.onDeleteCircuit(item.id)}>Delete</button>}
      </li>)}</ul> : <p className="electrical-layout-empty">No circuits yet.</p>}
      {circuit && <div className="electrical-circuit-edit">
        <label key={circuit.id} className="field"><span>Name</span><input defaultValue={circuit.name} maxLength={100} onBlur={(e) => { const value = e.target.value.trim(); if (value && value !== circuit.name) p.onUpdateCircuit(circuit.id, { name: value }); else if (!value) e.currentTarget.value = circuit.name; }} /></label>
        <label className="field"><span>Colour</span><input aria-label="Circuit colour" type="color" value={circuit.color} onChange={(e) => p.onUpdateCircuit(circuit.id, { color: e.target.value })} /></label>
        <div className="electrical-circuit-edit-actions">
          <button type="button" className="review-style-button electrical-new-circuit" onClick={p.onCreateCircuit}>New circuit</button>
        </div>
      </div>}
      {!circuit && <button type="button" className="review-style-button electrical-new-circuit" onClick={p.onCreateCircuit}>New circuit</button>}
      {circuit && connectionGroup(circuit.id)}
    </details>
    <details className="electrical-layout-help"><summary>Electrical layout help</summary><div className="electrical-layout-help-content">
      <p><strong>Place fittings.</strong> Click <em>Add electrical fitting…</em>, choose a catalogue item, then click on the plan to place it. The add window keeps your last item selected so you can place several of the same fitting.</p>
      <p><strong>Circuits and connections.</strong> A first circuit is created and selected automatically. Every new connection is added to the currently selected circuit. Click <em>New circuit</em> to add more circuits, then select a circuit row to choose where future connections go.</p>
      <p><strong>Connect two fittings.</strong> Click <em>Connect</em> once, select a source fitting, then its destination. The command exits after one connection. Double-click <em>Connect</em> to connect several pairs; after each connection, select any new source and destination. Press Esc or click the active Cancel button to stop.</p>
      <p><strong>Edit or delete connections.</strong> Open a circuit’s <em>Connections</em> list. Select a row or click <em>Edit</em> to change its relationship, colour, style, width, route, circuit or label. Click <em>Delete</em> to remove just that connection, not its fittings.</p>
      <p><strong>Shape a route.</strong> Right-click a connection line to add a corner on that leg. Drag a corner to reshape the line; right-click a corner to remove it. <em>Force horizontal / vertical circuit routes</em> keeps legs axis-aligned and is on by default. Turn it off to allow diagonal legs.</p>
      <p><strong>Manage circuits and files.</strong> The last remaining circuit cannot be deleted. Deleting a circuit moves its connections to another circuit. <em>Save layout</em> downloads an electrical-only file. <em>Load layout</em> lets you merge or replace electrical data without replacing the floorplan. Normal project saving also stores the electrical layout.</p>
      <p className="electrical-layout-help-note"><strong>Important:</strong> connection lines show schematic relationships, not physical cable routes or cable lengths. Room geometry remains unchanged.</p>
    </div></details>
  </div>;
}
