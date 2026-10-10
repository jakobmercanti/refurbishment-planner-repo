"use client";

import type { ElectricalCircuit, ElectricalConnection, ElectricalConnectionDefaults, ElectricalConnectionType, ElectricalLineStyle, ElectricalLineWidth, ElectricalRouting } from "@/lib/electricalLayout";
import { switchGangCount } from "@/lib/electricalSimulation";
import { electricalEndpointLabel, electricalFittingReferences, electricalGangConnections } from "@/lib/electricalConnectionLabels";
import type { ElectricalCrossing } from "@/lib/electricalCrossings";

export interface ElectricalDisplayOptions { symbols: boolean; connections: boolean; circuitLabels: boolean }
export interface ElectricalObjectOption { id: string; label: string; representation_key?: string | null }

const styles: [ElectricalLineStyle, string][] = [["SOLID", "Solid"], ["DASHED", "Dashed"], ["DOTTED", "Dotted"], ["DASH_DOT", "Dash-dot"]];
const widths: [ElectricalLineWidth, string][] = [["THIN", "Thin"], ["MEDIUM", "Medium"], ["THICK", "Thick"]];
const routings: [ElectricalRouting, string][] = [["ORTHOGONAL", "Orthogonal"], ["STRAIGHT", "Straight"], ["MANUAL", "Manual"]];
const types: [ElectricalConnectionType, string][] = [["GENERIC", "Generic"], ["CONTROL", "Control"], ["POWER", "Power / circuit"]];
type Props = {
  mode: boolean; connecting: boolean; repeatConnecting?: boolean; onConnect: (mode: "single" | "repeat") => void; onAdd: () => void;
  sourceId?: string | null; sourceGang?: number; onConnectGang?: (id: string, gang: number) => void;
  forceOrthogonalRouting: boolean; onForceOrthogonalRoutingChange: (value: boolean) => void;
  onSaveLayout?: () => void; onLoadLayout?: () => void; onExport?: () => void; onSchedule?: () => void;
  onCheckout: () => void; onFinishConnection: () => void;
  crossings?: ElectricalCrossing[]; onToggleJunction?: (crossing: ElectricalCrossing) => void;
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
  const references = electricalFittingReferences(p.objects);
  const multiSwitches = p.objects.filter(item => switchGangCount(item.representation_key) > 1);
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
        const from = electricalEndpointLabel(item, "from", p.objects, references);
        const to = electricalEndpointLabel(item, "to", p.objects, references);
        return <li className="electrical-connection-row" key={item.id}>
          <button type="button" className={item.id === p.selectedConnectionId ? "selected" : ""} aria-pressed={item.id === p.selectedConnectionId} aria-label={`Select connection from ${from} to ${to}`} onClick={() => selectConnection(item.id)}><span>{from} → {to}</span><small>{types.find(([value]) => value === item.type)?.[1]}</small></button>
          <button type="button" className="electrical-connection-action" aria-label={`Edit connection from ${from} to ${to}`} title="Edit connection" onClick={() => selectConnection(item.id)}>Edit</button>
          <button type="button" className="electrical-connection-action delete" aria-label={`Delete connection from ${from} to ${to}`} title="Delete connection" onClick={() => p.onDeleteConnection(item.id)}>Delete</button>
        </li>;
      })}</ul> : <p className="electrical-layout-empty">No connections in this circuit yet.</p>}
      {selected && <div className="electrical-connection-properties">
        <p className="electrical-connection-endpoints">From <strong>{electricalEndpointLabel(selected, "from", p.objects, references)}</strong> → To <strong>{electricalEndpointLabel(selected, "to", p.objects, references)}</strong></p>
        <div className="electrical-layout-grid">
          <label className="field"><span>Relationship</span><select value={selected.type} onChange={(e) => updateSelected({ type: e.target.value as ElectricalConnectionType })}>{types.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
          <label className="field"><span>Colour</span><input aria-label="Connection colour" type="color" value={selectedColour ?? selected.color} onChange={(e) => updateSelected({ color: e.target.value, colorOverride: true })} /></label>
          <label className="field"><span>Style</span><select value={selected.lineStyle} onChange={(e) => updateSelected({ lineStyle: e.target.value as ElectricalLineStyle })}>{styles.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
          <label className="field"><span>Width</span><select value={selected.width} onChange={(e) => updateSelected({ width: e.target.value as ElectricalLineWidth })}>{widths.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
          <label className="field"><span>Routing</span><select value={selected.routing} disabled={p.forceOrthogonalRouting} onChange={(e) => updateSelected({ routing: e.target.value as ElectricalRouting })}>{routings.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
          <label className="field"><span>Circuit</span><select value={selected.circuitId ?? circuitId} onChange={(e) => updateSelected({ circuitId: e.target.value, colorOverride: false })}>{p.circuits.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
        </div>
        {(["from", "to"] as const).map((endpoint) => {
          const object = p.objects.find(item => item.id === (endpoint === "from" ? selected.fromId : selected.toId));
          const gangs = switchGangCount(object?.representation_key);
          const field = endpoint === "from" ? "fromSwitchGang" : "toSwitchGang";
          return gangs > 1 ? <label className="field" key={endpoint}><span>{endpoint === "from" ? "From" : "To"} switch gang</span><select value={selected[field] ?? 1} onChange={event => updateSelected({ [field]: Number(event.target.value) })}>{Array.from({ length: gangs }, (_, index) => <option key={index} value={index + 1}>Gang {index + 1}</option>)}</select><small>Only this rocker belongs to the connection; the other gangs remain independent.</small></label> : null;
        })}
        {selected.circuitId && <button type="button" className="review-style-button" onClick={() => updateSelected({ colorOverride: false })}>Use circuit colour</button>}
        <label className="field"><span>Optional label</span><input value={selected.label ?? ""} maxLength={100} onChange={(e) => updateSelected({ label: e.target.value || undefined })} /></label>
        <p className="electrical-layout-hint">Right-click a route leg to add a corner, or right-click a corner to remove it. Drag a corner to reshape the route.</p>
        {(p.crossings ?? []).some(crossing => crossing.connectionIds.includes(selected.id) && crossing.canJoin) && <details className="electrical-layout-section"><summary>Wire crossings</summary><p className="electrical-layout-hint">A bridge means not connected. Join explicitly to show a dot and share control. Moving wires away removes the active junction.</p>{(p.crossings ?? []).filter(crossing => crossing.connectionIds.includes(selected.id) && crossing.canJoin).map((crossing, index) => <button key={crossing.key} type="button" className="review-style-button" onClick={() => p.onToggleJunction?.(crossing)}>{crossing.connected ? "Separate" : "Join"} crossing {index + 1}</button>)}</details>}
        <button type="button" className="danger-button" onClick={() => p.onDeleteConnection(selected.id)}>Delete connection</button>
        <button type="button" className="review-style-button primary" onClick={p.onFinishConnection}>Ok</button>
      </div>}
    </details>;
  };
  return <div className="electrical-layout-panel evidence-panel">
    <div className="electrical-layout-actions" aria-label="Electrical layout actions">
      <button type="button" className="review-style-button" onClick={p.onSaveLayout} disabled={!p.onSaveLayout}>Save layout</button>
      <button type="button" className="review-style-button" onClick={p.onLoadLayout} disabled={!p.onLoadLayout}>Load layout</button>
      <button type="button" className="review-style-button" onClick={p.onExport} disabled={!p.onExport}>Export</button>
      <button type="button" className="review-style-button" onClick={p.onSchedule} disabled={!p.onSchedule}>BOM / Schedule</button>
      <button type="button" className="review-style-button" aria-label={p.connecting ? (p.repeatConnecting ? "Cancel repeat connection command" : "Cancel connection command") : "Connect fittings. Double-click to connect multiple pairs."} title={p.connecting ? "Click to cancel the active connection command." : "Click to connect one pair; double-click to connect multiple pairs."} aria-pressed={p.connecting} disabled={!p.mode || p.objects.length < 2} onClick={(event) => { if (event.detail <= 1) p.onConnect("single"); }} onDoubleClick={() => p.onConnect("repeat")}>{p.connecting ? (p.repeatConnecting ? "Cancel repeat connect" : "Cancel connect") : "Connect"}</button>
      <button type="button" className="review-style-button" onClick={p.onAdd}>Add electrical fitting…</button>
      {p.mode && <button type="button" className="review-style-button" onClick={p.onCheckout}>Check layout</button>}
    </div>
    <p className="electrical-layout-count" role="status">{p.currentCount} electrical fittings in this project</p>
    {p.status && <p className="electrical-layout-status" role="status">{p.status}</p>}
    {p.connecting && <p className="electrical-connect-hint" role="status">{p.repeatConnecting ? "Select a source and destination. After each connection, choose any new pair. Esc cancels." : "Select a source and destination. The command ends after one connection. Esc cancels."}</p>}
    {multiSwitches.length > 0 && <details className="electrical-layout-section electrical-switch-map" open>
      <summary>Switch connections · {multiSwitches.length} multi-gang fittings</summary>
      <p className="electrical-layout-hint">Choose a rocker below, then its destination on the plan. S = switch, L = light. Each gang is independent; select a linked fitting to highlight and edit its route.</p>
      {multiSwitches.map(fitting => <section className="electrical-switch-map-item" key={fitting.id} aria-label={`${references[fitting.id]} · ${fitting.label} connections`}>
        <h3>{references[fitting.id]} · {fitting.label}</h3>
        <div className="electrical-gang-map-grid">{Array.from({ length: switchGangCount(fitting.representation_key) }, (_, index) => {
          const gang = index + 1, links = electricalGangConnections(p.connections, fitting.id, gang);
          const chosen = p.connecting && p.sourceId === fitting.id && p.sourceGang === gang;
          return <div className="electrical-gang-map-card" key={gang} data-selected={chosen}>
            <button type="button" className="review-style-button" aria-label={`Connect ${references[fitting.id]} Gang ${gang}`} aria-pressed={chosen} disabled={!p.mode || !p.onConnectGang || p.objects.length < 2} onClick={() => p.onConnectGang?.(fitting.id, gang)}>{chosen ? `G${gang} · Choose destination` : `Connect G${gang}`}</button>
            {links.length ? <ul>{links.map(({ connection, otherEndpoint }) => <li key={connection.id}><button type="button" className={connection.id === p.selectedConnectionId ? "selected" : ""} aria-pressed={connection.id === p.selectedConnectionId} onClick={() => { p.onActiveCircuitChange(connection.circuitId); p.onSelectConnection(connection.id); }}><span>→ {electricalEndpointLabel(connection, otherEndpoint, p.objects, references)}</span><small>{p.circuits.find(c => c.id === connection.circuitId)?.name} · {types.find(([type]) => type === connection.type)?.[1]}</small></button></li>)}</ul> : <small>No direct links</small>}
          </div>;
        })}</div>
      </section>)}
    </details>}
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
        <label key={circuit.id + circuit.name} className="field"><span>Name</span><input defaultValue={circuit.name} maxLength={100} onKeyDown={event => { if (event.key === "Enter" && !event.nativeEvent.isComposing) { event.preventDefault(); event.stopPropagation(); event.currentTarget.blur(); } }} onBlur={(e) => { const value = e.target.value.trim(); if (value && value !== circuit.name) p.onUpdateCircuit(circuit.id, { name: value }); else if (!value) e.currentTarget.value = circuit.name; }} /></label>
        <label className="field"><span>Colour</span><input aria-label="Circuit colour" type="color" value={circuit.color} onChange={(e) => p.onUpdateCircuit(circuit.id, { color: e.target.value })} /></label>
        <div className="electrical-circuit-edit-actions">
          <button type="button" className="review-style-button electrical-new-circuit" onClick={p.onCreateCircuit}>New circuit</button>
        </div>
      </div>}
      {!circuit && <button type="button" className="review-style-button electrical-new-circuit" onClick={p.onCreateCircuit}>New circuit</button>}
      {circuit && connectionGroup(circuit.id)}
    </details>
  </div>;
}
