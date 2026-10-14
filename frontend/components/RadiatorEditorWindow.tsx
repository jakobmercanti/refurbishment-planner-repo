"use client";
import { useState, useRef } from "react";
import { createPortal } from "react-dom";
import { FloatingToolbar } from "./FloatingToolbar";
import { HeatingSpecsEditor } from "./HeatingSpecsEditor";
import { heatingSpec, elementFromRadiator } from "@/lib/heatingElements";
import { constrainObstacleToRoom } from "@/lib/elementPlacement";
import { snapRadiatorToWall, thermalRoom } from "@/lib/heatingCalculations";
import { parseHeatingProject, type HeatingProject, type HeatingRadiator } from "@/lib/heatingDocument";
import type { Room } from "@/lib/types";
import styles from "./HeatingLayoutPanel.module.css";
export function RadiatorEditorWindow({ id, rooms, data, onChange, onClose }: { id: string; rooms: Room[]; data: HeatingProject; onChange: (value: HeatingProject) => void; onClose: () => void }) {
  const [error, setError] = useState("");
  const performanceInput = useRef<HTMLInputElement>(null);
  const radiator = data.radiators.find(r => r.radiatorId === id), room = rooms.find(r => r.id === radiator?.roomId);
  if (!radiator || !room || typeof document === "undefined") return null;
  function update(patch: Partial<HeatingRadiator>) {
    if (!radiator || !room) return;
    const dimensionsChanged = (["widthMm", "heightMm", "depthMm"] as const).some(k => patch[k] !== undefined && patch[k] !== radiator[k]);
    const next = { ...radiator, ...patch, ...(dimensionsChanged ? { ratedOutputW: null, manufacturerPerformanceData: [], performanceReference: undefined, estimatedOutput: false } : {}) };
    if (!constrainObstacleToRoom(elementFromRadiator(next), room)) { setError("This heater cannot fit against a wall. Existing dimensions and position retained."); return; }
    try { onChange(parseHeatingProject({ ...data, radiators: data.radiators.map(r => r.radiatorId === id ? snapRadiatorToWall(next, room, next.positionMm) : r) })); setError(""); } catch { setError("Check these settings; the existing heater was retained."); }
  }
  return createPortal(<FloatingToolbar title="Heating element editor" className="heating-element-editor-window" defaultPosition={{ x: 180, y: 110 }} initialSize={{ width: 520 }} maxHeight={740} bringToFront onClose={onClose}><section className={styles.panel} aria-label="Heating element editor">
    <strong>{room.name} · {radiator.model}</strong><small>Changes save to the placed object. Dimensions, ratings and output are shared by both editing entry points.</small>
    <details open><summary>Dimensions & wall position</summary><div className={styles.grid}>{(["widthMm", "heightMm", "depthMm"] as const).map(key => <label key={key}>{{ widthMm: "Width mm", heightMm: "Height mm", depthMm: "Depth mm" }[key]}<input type="number" min="1" value={radiator[key]} onChange={e => { if (e.target.value && Number(e.target.value) > 0) update({ [key]: Number(e.target.value) }); }} /></label>)}</div><small>Mounted against a wall. Drag along a wall on the plan; orientation follows it. Changing dimensions clears product ratings.</small></details>
    <HeatingSpecsEditor value={heatingSpec(radiator)} operatingConditions={{ flowC: data.heatingSystem.flowTemperatureC, returnC: data.heatingSystem.returnTemperatureC, roomC: thermalRoom(room, data).designIndoorTemperatureC }} onChange={update} />
    <button onClick={() => performanceInput.current?.click()}>Import radiator performance JSON</button><input hidden ref={performanceInput} type="file" accept=".json,application/json" onChange={async event => { const file = event.target.files?.[0]; event.currentTarget.value = ""; if (!file || file.size > 1024*1024) return; try { update({manufacturerPerformanceData: JSON.parse(await file.text()),estimatedOutput:false}); } catch {setError("Invalid performance JSON; existing data retained.");} }} />
    <label><input type="checkbox" checked={radiator.locked} onChange={e => update({ locked: e.target.checked })} />Lock heater position</label>
    <div className={styles.actionGrid}><button onClick={() => onChange({ ...data, radiators: [...data.radiators, { ...radiator, placementSnapshot: { ...radiator.placementSnapshot, name: `${radiator.model} copy` }, radiatorId: crypto.randomUUID(), model: `${radiator.model} copy` }] })}>Duplicate heater</button><button onClick={() => { onChange({ ...data, radiators: data.radiators.filter(r => r.radiatorId !== id), pipes: data.pipes.filter(p => p.fromId !== id && p.toId !== id) }); onClose(); }}>Delete heater</button><button onClick={onClose}>Done</button></div>{error && <p role="alert">{error}</p>}
  </section></FloatingToolbar>, document.body);
}
