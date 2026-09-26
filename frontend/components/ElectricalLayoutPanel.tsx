"use client";

import type { ElectricalCircuit, ElectricalConnection, ElectricalConnectionDefaults, ElectricalConnectionType, ElectricalLineStyle, ElectricalLineWidth, ElectricalRouting } from "@/lib/electricalLayout";

export interface ElectricalDisplayOptions { symbols: boolean; connections: boolean; circuitLabels: boolean }
export interface ElectricalObjectOption { id: string; label: string }

const styles: [ElectricalLineStyle, string][] = [["SOLID", "Solid"], ["DASHED", "Dashed"], ["DOTTED", "Dotted"], ["DASH_DOT", "Dash-dot"]];
const widths: [ElectricalLineWidth, string][] = [["THIN", "Thin"], ["MEDIUM", "Medium"], ["THICK", "Thick"]];
const routings: [ElectricalRouting, string][] = [["ORTHOGONAL", "Orthogonal"], ["STRAIGHT", "Straight"], ["MANUAL", "Manual"]];
const types: [ElectricalConnectionType, string][] = [["GENERIC", "Generic"], ["CONTROL", "Control"], ["POWER", "Power / circuit"]];
type Props = {
  mode: boolean; onModeChange: (value: boolean) => void; connecting: boolean; onConnect: () => void; onAdd: () => void;
  status?: string | null; maximum: number | null; currentCount: number; defaults: ElectricalConnectionDefaults;
  onDefaultsChange: (value: ElectricalConnectionDefaults) => void; display: ElectricalDisplayOptions;
  onDisplayChange: (value: ElectricalDisplayOptions) => void; objects: ElectricalObjectOption[];
  connections: ElectricalConnection[]; selectedConnectionId: string | null; onSelectConnection: (id: string) => void;
  onUpdateConnection: (id: string, patch: Partial<ElectricalConnection>) => void; onDeleteConnection: (id: string) => void;
  circuits: ElectricalCircuit[]; activeCircuitId: string | null; onActiveCircuitChange: (id: string | null) => void;
  onCreateCircuit: () => void; onUpdateCircuit: (id: string, patch: Partial<ElectricalCircuit>) => void; onDeleteCircuit: (id: string) => void;
};

export function ElectricalLayoutPanel(p: Props) {
  const selected = p.connections.find((item) => item.id === p.selectedConnectionId) ?? null;
  const circuit = p.circuits.find((item) => item.id === p.activeCircuitId) ?? null;
  const selectedCircuit = selected?.circuitId ? p.circuits.find((item) => item.id === selected.circuitId) : null;
  const selectedColour = selected?.colorOverride === false && selectedCircuit ? selectedCircuit.color : selected?.color;
  const name = (id: string) => p.objects.find((item) => item.id === id)?.label ?? "Missing fitting";
  return <div className="electrical-layout-panel evidence-panel">
    <label className="electrical-mode-toggle"><input type="checkbox" checked={p.mode} onChange={(event) => p.onModeChange(event.target.checked)} /><span><strong>Electrical layout mode</strong><small>Keep the plan as context while editing electrical fittings and schematic connections.</small></span></label>
    <div className="electrical-layout-actions"><button type="button" className="review-style-button" onClick={p.onAdd}>Add electrical fitting…</button><button type="button" className="review-style-button" aria-pressed={p.connecting} disabled={!p.mode || p.objects.length < 2} onClick={p.onConnect}>{p.connecting ? "Cancel connect" : "Connect"}</button></div>
    <p className="electrical-layout-count" role="status">{p.maximum === null ? p.currentCount + " electrical fittings · unlimited" : p.currentCount + " of " + p.maximum + " free electrical fittings used"}</p>
    {p.status && <p className="electrical-layout-status" role="status">{p.status}</p>}
    {p.connecting && <p className="electrical-connect-hint" role="status">Select a source, then one or more destinations. Esc cancels.</p>}
    <details className="electrical-layout-section" open><summary>New connection defaults</summary><div className="electrical-layout-grid">
      <label className="field"><span>Colour</span><input aria-label="Default connection colour" type="color" value={p.defaults.color} onChange={(e) => p.onDefaultsChange({ ...p.defaults, color: e.target.value })} /></label>
      <label className="field"><span>Style</span><select value={p.defaults.lineStyle} onChange={(e) => p.onDefaultsChange({ ...p.defaults, lineStyle: e.target.value as ElectricalLineStyle })}>{styles.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
      <label className="field"><span>Width</span><select value={p.defaults.width} onChange={(e) => p.onDefaultsChange({ ...p.defaults, width: e.target.value as ElectricalLineWidth })}>{widths.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
      <label className="field"><span>Routing</span><select value={p.defaults.routing} onChange={(e) => p.onDefaultsChange({ ...p.defaults, routing: e.target.value as ElectricalRouting })}>{routings.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
      <label className="field"><span>Relationship</span><select value={p.defaults.type} onChange={(e) => p.onDefaultsChange({ ...p.defaults, type: e.target.value as ElectricalConnectionType })}>{types.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
    </div></details>
    <details className="electrical-layout-section" open><summary>Display</summary><div className="electrical-layout-display">
      <label><input type="checkbox" checked={p.display.symbols} onChange={(e) => p.onDisplayChange({ ...p.display, symbols: e.target.checked })} /> Electrical symbols</label>
      <label><input type="checkbox" checked={p.display.connections} onChange={(e) => p.onDisplayChange({ ...p.display, connections: e.target.checked })} /> Connections</label>
      <label><input type="checkbox" checked={p.display.circuitLabels} onChange={(e) => p.onDisplayChange({ ...p.display, circuitLabels: e.target.checked })} /> Circuit labels</label>
    </div></details>
    <details className="electrical-layout-section" open><summary>Circuits</summary><div className="electrical-circuit-controls">
      <label className="field"><span>Active circuit</span><select value={p.activeCircuitId ?? ""} onChange={(e) => p.onActiveCircuitChange(e.target.value || null)}><option value="">No circuit</option>{p.circuits.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
      <button type="button" className="review-style-button" onClick={p.onCreateCircuit}>New circuit</button>
    </div>{circuit && <div className="electrical-circuit-edit">
      <label key={circuit.id} className="field"><span>Name</span><input defaultValue={circuit.name} maxLength={100} onBlur={(e) => { const value = e.target.value.trim(); if (value && value !== circuit.name) p.onUpdateCircuit(circuit.id, { name: value }); else if (!value) e.currentTarget.value = circuit.name; }} /></label>
      <label className="field"><span>Colour</span><input aria-label="Circuit colour" type="color" value={circuit.color} onChange={(e) => p.onUpdateCircuit(circuit.id, { color: e.target.value })} /></label>
      <button type="button" className="danger-button" onClick={() => p.onDeleteCircuit(circuit.id)}>Delete circuit</button>
    </div>}</details>
    <details className="electrical-layout-section" open><summary>Connections ({p.connections.length})</summary>
      {p.connections.length ? <ul className="electrical-connection-list">{p.connections.map((item) => <li key={item.id}><button type="button" className={item.id === p.selectedConnectionId ? "selected" : ""} onClick={() => p.onSelectConnection(item.id)}><span>{name(item.fromId)} → {name(item.toId)}</span><small>{types.find(([value]) => value === item.type)?.[1]}</small></button></li>)}</ul> : <p className="electrical-layout-empty">No connections yet.</p>}
      {selected && <div className="electrical-connection-properties">
        <p className="electrical-connection-endpoints">From <strong>{name(selected.fromId)}</strong> → To <strong>{name(selected.toId)}</strong></p>
        <div className="electrical-layout-grid">
          <label className="field"><span>Relationship</span><select value={selected.type} onChange={(e) => p.onUpdateConnection(selected.id, { type: e.target.value as ElectricalConnectionType })}>{types.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
          <label className="field"><span>Colour</span><input aria-label="Connection colour" type="color" value={selectedColour ?? selected.color} onChange={(e) => p.onUpdateConnection(selected.id, { color: e.target.value, colorOverride: true })} /></label>
          <label className="field"><span>Style</span><select value={selected.lineStyle} onChange={(e) => p.onUpdateConnection(selected.id, { lineStyle: e.target.value as ElectricalLineStyle })}>{styles.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
          <label className="field"><span>Width</span><select value={selected.width} onChange={(e) => p.onUpdateConnection(selected.id, { width: e.target.value as ElectricalLineWidth })}>{widths.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
          <label className="field"><span>Routing</span><select value={selected.routing} onChange={(e) => p.onUpdateConnection(selected.id, { routing: e.target.value as ElectricalRouting })}>{routings.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
          <label className="field"><span>Circuit</span><select value={selected.circuitId ?? ""} onChange={(e) => p.onUpdateConnection(selected.id, { circuitId: e.target.value || undefined, colorOverride: e.target.value ? false : true })}><option value="">No circuit</option>{p.circuits.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
        </div>
        {selected.circuitId && <button type="button" className="review-style-button" onClick={() => p.onUpdateConnection(selected.id, { colorOverride: false })}>Use circuit colour</button>}
        <label className="field"><span>Optional label</span><input value={selected.label ?? ""} maxLength={100} onChange={(e) => p.onUpdateConnection(selected.id, { label: e.target.value || undefined })} /></label>
        <p className="electrical-layout-hint">Double-click a manual route to add a waypoint; drag a waypoint to reshape it.</p>
        <button type="button" className="danger-button" onClick={() => p.onDeleteConnection(selected.id)}>Delete connection</button>
      </div>}
    </details>
    <details className="electrical-layout-help"><summary>Electrical layout help</summary><p>Connections are schematic relationships, not exact hidden cable routes. Room geometry remains unchanged.</p></details>
  </div>;
}
