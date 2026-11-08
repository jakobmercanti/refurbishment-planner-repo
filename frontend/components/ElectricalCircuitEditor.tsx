"use client";
import { useState } from "react";
import { createPortal } from "react-dom";
import { Popup } from "./Popup";
import type { ElectricalCircuit, ElectricalConnection } from "@/lib/electricalLayout";
import { buildSocketCircuit, isConsumerUnit, isSocket } from "@/lib/socketCircuits";
import type { ElectricalObjectOption } from "./ElectricalLayoutPanel";

export function ElectricalCircuitEditor({ circuit, objects, connections, onSave, onClose }: {
  circuit: ElectricalCircuit; objects: ElectricalObjectOption[]; connections: ElectricalConnection[];
  onSave: (draft: ElectricalCircuit, routes?: ElectricalConnection[]) => void; onClose: () => void;
}) {
  const [draft, setDraft] = useState(circuit);
  const [error, setError] = useState("");
  const sockets = objects.filter(isSocket), boards = objects.filter(isConsumerUnit), ids = draft.socketIds ?? [];
  const update = (patch: Partial<ElectricalCircuit>) => { setError(""); setDraft(value => ({ ...value, ...patch })); };
  const save = (build: boolean) => {
    const next = { ...draft, name: draft.name.trim(), description: draft.description?.trim(), ...(draft.socketTopology ? {} : { consumerUnitId: undefined, socketIds: undefined }) };
    if (!next.name) return;
    try { onSave(next, build ? buildSocketCircuit(next, objects, connections) : undefined); onClose(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Could not save this circuit."); }
  };
  return createPortal(<Popup open dockable title={`Edit circuit · ${circuit.name}`} className="electrical-circuit-dialog" message="" confirmLabel="Save circuit" confirmDisabled={!draft.name.trim()} onConfirm={() => save(false)} onCancel={onClose}>
    <div className="electrical-layout-grid">
      <label className="field"><span>Name</span><input maxLength={100} value={draft.name} onChange={e => update({ name: e.target.value })} /></label>
      <label className="field"><span>Colour</span><input type="color" value={draft.color} onChange={e => update({ color: e.target.value })} /></label>
    </div>
    <label className="field"><span>Notes</span><textarea maxLength={500} value={draft.description ?? ""} onChange={e => update({ description: e.target.value })} /></label>
    <label className="field"><span>Circuit type</span><select value={draft.socketTopology ?? ""} onChange={e => update({ socketTopology: e.target.value as ElectricalCircuit["socketTopology"] || undefined })}><option value="">Other / manual routing</option><option value="RADIAL">Socket radial</option><option value="RING">Socket ring</option></select></label>
    {draft.socketTopology && <>
    <label className="field"><span>Consumer unit</span><select value={draft.consumerUnitId ?? ""} onChange={e => update({ consumerUnitId: e.target.value || undefined })}><option value="">Choose consumer unit…</option>{draft.consumerUnitId && !boards.some(b => b.id === draft.consumerUnitId) && <option value={draft.consumerUnitId} disabled>Missing consumer unit — choose another</option>}{boards.map(b => <option key={b.id} value={b.id}>{b.label}</option>)}</select></label>
    {!boards.length && <p>Add a consumer unit from the electrical catalogue first.</p>}
    <fieldset className="socket-members"><legend>Sockets in this circuit</legend>{sockets.length ? sockets.map(socket => <label key={socket.id}><input type="checkbox" checked={ids.includes(socket.id)} onChange={e => update({ socketIds: e.target.checked ? [...ids, socket.id] : ids.filter(id => id !== socket.id) })} />{socket.label}</label>) : <p>Add sockets to this floor first.</p>}</fieldset>
    {ids.length > 0 && <ol className="socket-route-order" aria-label="Socket route order">{ids.map((id, index) => <li key={id}><span>{objects.find(o => o.id === id)?.label ?? "Missing socket"}</span>{([-1, 1] as const).map(direction => <button type="button" key={direction} aria-label={`Move socket ${index + 1} ${direction < 0 ? "up" : "down"}`} disabled={index + direction < 0 || index + direction >= ids.length} onClick={() => { const next = [...ids]; [next[index], next[index + direction]] = [next[index + direction], next[index]]; update({ socketIds: next }); }}>{direction < 0 ? "↑" : "↓"}</button>)}<button type="button" aria-label={`Remove ${objects.find(o => o.id === id)?.label ?? "missing socket"} from circuit`} onClick={() => update({ socketIds: ids.filter(value => value !== id) })}>×</button></li>)}</ol>}
    <p className="electrical-layout-hint">Routes follow the socket order. A full ring returns to the consumer unit. Creating routes replaces this circuit’s power links; control links remain.</p>
    <button type="button" className="review-style-button" disabled={!draft.name.trim() || !draft.consumerUnitId || ids.length < (draft.socketTopology === "RING" ? 2 : 1)} onClick={() => save(true)}>Save and create socket routes</button>
    </>}
    {error && <p role="alert">{error}</p>}
  </Popup>, document.body);
}
