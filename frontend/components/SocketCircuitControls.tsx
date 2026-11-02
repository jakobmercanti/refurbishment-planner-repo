"use client";
import { useState } from "react";
import type { ElectricalCircuit, ElectricalConnection } from "@/lib/electricalLayout";
import { buildSocketCircuit, isConsumerUnit, isSocket } from "@/lib/socketCircuits";
import type { ElectricalObjectOption } from "./ElectricalLayoutPanel";

export function SocketCircuitControls({ circuit, objects, connections, onUpdate, onConnectionsChange }: {
  circuit: ElectricalCircuit; objects: ElectricalObjectOption[]; connections: ElectricalConnection[];
  onUpdate: (patch: Partial<ElectricalCircuit>) => void; onConnectionsChange: (connections: ElectricalConnection[]) => void;
}) {
  const [error, setError] = useState("");
  const sockets = objects.filter(isSocket), boards = objects.filter(isConsumerUnit), ids = circuit.socketIds ?? [];
  const update = (patch: Partial<ElectricalCircuit>) => { setError(""); onUpdate(patch); };
  return <details className="electrical-layout-section" open={Boolean(circuit.socketTopology)}>
    <summary>Socket circuit</summary>
    <div className="electrical-layout-grid">
      <label className="field"><span>Circuit type</span><select value={circuit.socketTopology ?? ""} onChange={e => update({ socketTopology: e.target.value as ElectricalCircuit["socketTopology"] || undefined })}><option value="">Choose type…</option><option value="RADIAL">Radial</option><option value="RING">Full ring</option></select></label>
      <label className="field"><span>Consumer unit</span><select value={circuit.consumerUnitId ?? ""} onChange={e => update({ consumerUnitId: e.target.value || undefined })}><option value="">Choose consumer unit…</option>{circuit.consumerUnitId && !boards.some(b => b.id === circuit.consumerUnitId) && <option value={circuit.consumerUnitId} disabled>Missing consumer unit — choose another</option>}{boards.map(b => <option key={b.id} value={b.id}>{b.label}</option>)}</select></label>
    </div>
    {!boards.length && <p>Add a consumer unit from the electrical catalogue first.</p>}
    <fieldset className="socket-members"><legend>Sockets in this circuit</legend>{sockets.length ? sockets.map(socket => <label key={socket.id}><input type="checkbox" checked={ids.includes(socket.id)} onChange={e => update({ socketIds: e.target.checked ? [...ids, socket.id] : ids.filter(id => id !== socket.id) })} />{socket.label}</label>) : <p>Add sockets to this floor first.</p>}</fieldset>
    {ids.length > 0 && <ol className="socket-route-order" aria-label="Socket route order">{ids.map((id, index) => <li key={id}><span>{objects.find(o => o.id === id)?.label ?? "Missing socket"}</span>{([-1, 1] as const).map(direction => <button type="button" key={direction} aria-label={`Move socket ${index + 1} ${direction < 0 ? "up" : "down"}`} disabled={index + direction < 0 || index + direction >= ids.length} onClick={() => { const next = [...ids]; [next[index], next[index + direction]] = [next[index + direction], next[index]]; update({ socketIds: next }); }}>{direction < 0 ? "↑" : "↓"}</button>)}<button type="button" aria-label={`Remove ${objects.find(o => o.id === id)?.label ?? "missing socket"} from circuit`} onClick={() => update({ socketIds: ids.filter(value => value !== id) })}>×</button></li>)}</ol>}
    <p className="electrical-layout-hint">Routes follow the socket order. A full ring returns to the consumer unit. Creating routes replaces this circuit’s power links; control links remain.</p>
    <button type="button" className="review-style-button" disabled={!circuit.socketTopology || !circuit.consumerUnitId || !ids.length} onClick={() => { try { onConnectionsChange(buildSocketCircuit(circuit, objects, connections)); setError(""); } catch (e) { setError(e instanceof Error ? e.message : "Could not create routes."); } }}>Create socket routes</button>
    {error && <p role="alert">{error}</p>}
  </details>;
}
