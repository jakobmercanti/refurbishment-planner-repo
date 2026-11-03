"use client";
import { useState } from "react";
import { hvacErrorMessage, type HvacProject } from "@/lib/hvacDocument";
import { useHvac } from "./HvacContext";
import { CFDNumber } from "./CFDFields";
import { downloadCFD } from "@/lib/climoptix";
import type { CFDReport } from "@/lib/climoptix";
import type { CFDScenario } from "@/lib/climoptixDocument";
import { hvacBoundaryPackage, hvacModelLabel } from "@/lib/hvacBridge";
import { SharedBoundaryCapture } from "./SharedBoundaryCapture";

export function SharedHvacCFD({ scenario, report, checked = false, onEditSource }: { scenario: CFDScenario; report: CFDReport | null; checked?: boolean; onEditSource: () => void }) {
  const ctx = useHvac(), hvac = ctx?.project.hvac, link = hvac?.bindings[scenario.id];
  const [error, setError] = useState("");
  if (!ctx || !hvac || !link) return null;
  const commit = (next: HvacProject) => { try { ctx.commit(next); setError(""); } catch (cause) { setError(hvacErrorMessage(cause)); } };
  const operating = hvac.scenarios.find(s => s.id === link.operatingScenarioId);
  const overrideCount = new Set([...Object.keys(link.overrides), ...Object.keys(operating?.ventOverrides ?? {})]).size;
  const pkg = hvacBoundaryPackage(ctx.project, scenario, checked ? report : null);
  const snapshot = hvac.snapshots.find(s => s.caseId === scenario.id);
  const stale = snapshot ? JSON.parse(snapshot.boundaryJson).sourceInput !== pkg.sourceInput : false;
  const openSource = (tab: "Heating" | "Ventilation") => {
    if (operating && hvac.activeScenarioId !== operating.id) commit({ ...hvac, activeScenarioId: operating.id });
    const selected = hvac.devices.find(d => d.vent.id === ctx.selectedVentId && scenario.vents.some(v => v.id === d.vent.id));
    const target = selected ?? scenario.seed;
    if (target) ctx.focusRoom(target, selected?.vent.id);
    ctx.setTab(tab); ctx.requestHeating(); onEditSource();
  };
  return <details open className="cfx-card" aria-label="Shared HVAC devices"><summary>Shared HVAC design &amp; operation</summary>
    <p className="cfx-caption">One measured design across Heating, Ventilation and CFD. Geometry edits are permanent. Flow/temperature edits use the mode below. Heater operating values belong to the linked conventional scenario.</p>
    <label>Shared operating scenario<select aria-label="CFD shared operating scenario" value={link.operatingScenarioId ?? ""} onChange={e => commit({ ...hvac, activeScenarioId: e.target.value || hvac.activeScenarioId, bindings: { ...hvac.bindings, [scenario.id]: { ...link, operatingScenarioId: e.target.value || null, overrides: {} } } })}>
      <option value="">Case air settings · shared design</option>
      {hvac.scenarios.filter(s => s.id === link.operatingScenarioId || s.floorId === scenario.seed?.floorId && s.roomId === scenario.seed?.roomId).map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
    </select></label>
    <p className="cfx-caption">{operating ? "Operating edits update this same scenario in Ventilation and Heating. Design ratings remain separate." : "Design geometry and ratings update live. Select a room scenario to share operating values; create one in Ventilation if needed."} Changing this selection uses the selected scenario values and clears case-only vent overrides.</p>
    <label>Vent edits<select aria-label="CFD vent edit scope" value={link.editMode} onChange={e => commit({ ...hvac, bindings: { ...hvac.bindings, [scenario.id]: { ...link, editMode: e.target.value as "design" | "override" } } })}><option value="design">Permanent shared design</option><option value="override">Scenario override · retain design</option></select></label>
    <p role="status">{stale ? "CFD case outdated — shared inputs changed. Existing result snapshots are preserved." : snapshot ? "Synced with conventional snapshot" : "Shared design · no conventional case snapshot"}</p>
    <div className="cfx-equal-actions"><button onClick={() => openSource("Ventilation")}>Open Ventilation</button><button onClick={() => openSource("Heating")}>Edit shared Heating geometry</button><button onClick={() => commit({ ...hvac, bindings: { ...hvac.bindings, [scenario.id]: { ...link, overrides: {} } }, scenarios: hvac.scenarios.map(s => s.id === operating?.id ? { ...s, ventOverrides: {}, heaterOverrides: {} } : s) })}>Use design values</button></div>
    {overrideCount > 0 && <p>Scenario override active for {overrideCount} vent(s). Geometry moves retain baseline operating design values.</p>}
    {pkg.heaters.map(h => <details key={`${h.floorId}:${h.id}`} aria-label={`Shared heating source · ${h.name}`}><summary>{h.name} · {h.kind === "ufh" ? "Underfloor heating" : "Radiator"} · {h.inDomain ? "In domain" : "Out of domain"}</summary>
      <p>{h.watts === null ? "Unknown effective output" : `${h.watts.toFixed(1)} W`} · {hvacModelLabel(h.model)}{h.coverageM2 !== null ? ` · ${h.coverageM2.toFixed(2)} m² heated coverage` : ""}</p><p>{h.notes}</p>
      {operating && <><label className="cfx-check"><input type="checkbox" checked={operating.heaterOverrides[h.id]?.enabled ?? true} onChange={e => commit({ ...hvac, scenarios: hvac.scenarios.map(s => s.id === operating.id ? { ...s, heaterOverrides: { ...s.heaterOverrides, [h.id]: { actualW: s.heaterOverrides[h.id]?.actualW ?? null, enabled: e.target.checked } } } : s) })} />Enabled in {operating.name}</label>
      <CFDNumber label={`Scenario effective output · ${h.name} (W)`} value={h.watts ?? 0} min={0} onChange={actualW => commit({ ...hvac, scenarios: hvac.scenarios.map(s => s.id === operating.id ? { ...s, heaterOverrides: { ...s.heaterOverrides, [h.id]: { enabled: s.heaterOverrides[h.id]?.enabled ?? true, actualW } } } : s) })} />
      <button onClick={() => commit({ ...hvac, scenarios: hvac.scenarios.map(s => { if (s.id !== operating.id) return s; const overrides = { ...s.heaterOverrides }; delete overrides[h.id]; return { ...s, heaterOverrides: overrides }; }) })}>Use Heating output</button></>}
    </details>)}
    {error && <p role="alert" className="cfx-error">{error}</p>}
    <SharedBoundaryCapture report={report} checked={checked} />
    {pkg.warnings.map(w => <p key={w} className="cfx-notice">{w}</p>)}
    <button onClick={() => downloadCFD(new Blob([JSON.stringify(pkg, null, 2)], { type: "application/json" }), "hvac-cfd-boundaries.json")}>Export shared boundary package</button>
  </details>;
}
