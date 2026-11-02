"use client";
import { useState } from "react";
import type { HvacProject } from "@/lib/hvacDocument";
import { useHvac } from "./HvacContext";
import { CFDNumber } from "./CFDFields";
import { downloadCFD } from "@/lib/climoptix";
import type { CFDReport } from "@/lib/climoptix";
import type { CFDScenario } from "@/lib/climoptixDocument";
import { hvacBoundaryPackage } from "@/lib/hvacBridge";

export function SharedHvacCFD({ scenario, report, onEditSource }: { scenario: CFDScenario; report: CFDReport | null; onEditSource: () => void }) {
  const ctx = useHvac(), hvac = ctx?.project.hvac, link = hvac?.bindings[scenario.id];
  const [error, setError] = useState("");
  if (!ctx || !hvac || !link) return null;
  const commit = (next: HvacProject) => { try { ctx.commit(next); setError(""); } catch (cause) { setError(cause instanceof Error ? cause.message : "Invalid shared HVAC operation."); } };
  const operating = hvac.scenarios.find(s => s.id === link.operatingScenarioId);
  const overrideCount = new Set([...Object.keys(link.overrides), ...Object.keys(operating?.ventOverrides ?? {})]).size;
  const pkg = hvacBoundaryPackage(ctx.project, scenario, report);
  const snapshot = hvac.snapshots.find(s => s.caseId === scenario.id);
  const stale = snapshot ? JSON.parse(snapshot.boundaryJson).sourceInput !== pkg.sourceInput : false;
  return <details open className="cfx-card" aria-label="Shared HVAC devices"><summary>Shared HVAC design &amp; operation</summary>
    <p className="cfx-caption">One measured design across Heating, Ventilation and CFD. Geometry edits are permanent. Flow/temperature edits use the mode below. Heater operating values belong to the linked conventional scenario.</p>
    <label>Vent edits<select aria-label="CFD vent edit scope" value={link.editMode} onChange={e => commit({ ...hvac, bindings: { ...hvac.bindings, [scenario.id]: { ...link, editMode: e.target.value as "design" | "override" } } })}><option value="design">Permanent shared design</option><option value="override">Scenario override · retain design</option></select></label>
    <p role="status">{stale ? "CFD case outdated — shared inputs changed. Existing result snapshots are preserved." : snapshot ? "Synced with conventional snapshot" : "Shared design · no conventional case snapshot"}</p>
    <div className="cfx-equal-actions"><button onClick={() => { ctx.setTab("Ventilation"); ctx.requestHeating(); onEditSource(); }}>Open Ventilation</button><button onClick={() => { ctx.setTab("Heating"); ctx.requestHeating(); onEditSource(); }}>Edit shared Heating geometry</button><button onClick={() => commit({ ...hvac, bindings: { ...hvac.bindings, [scenario.id]: { ...link, overrides: {} } }, scenarios: hvac.scenarios.map(s => s.id === operating?.id ? { ...s, ventOverrides: {}, heaterOverrides: {} } : s) })}>Use design values</button></div>
    {overrideCount > 0 && <p>Scenario override active for {overrideCount} vent(s). Geometry moves retain baseline operating design values.</p>}
    {pkg.heaters.map(h => <details key={`${h.floorId}:${h.id}`}><summary>{h.name} · {h.kind} · {h.inDomain ? "In domain" : "Out of domain"}</summary>
      <p>{h.watts === null ? "Unknown effective output" : `${h.watts.toFixed(1)} W`} · {h.model}{h.coverageM2 !== null ? ` · ${h.coverageM2.toFixed(2)} m² heated coverage` : ""}</p><p>{h.notes}</p>
      {operating && <><label className="cfx-check"><input type="checkbox" checked={operating.heaterOverrides[h.id]?.enabled ?? true} onChange={e => commit({ ...hvac, scenarios: hvac.scenarios.map(s => s.id === operating.id ? { ...s, heaterOverrides: { ...s.heaterOverrides, [h.id]: { actualW: s.heaterOverrides[h.id]?.actualW ?? null, enabled: e.target.checked } } } : s) })} />Enabled in {operating.name}</label>
      <CFDNumber label={`Scenario effective output · ${h.name} (W)`} value={h.watts ?? 0} min={0} onChange={actualW => commit({ ...hvac, scenarios: hvac.scenarios.map(s => s.id === operating.id ? { ...s, heaterOverrides: { ...s.heaterOverrides, [h.id]: { enabled: s.heaterOverrides[h.id]?.enabled ?? true, actualW } } } : s) })} />
      <button onClick={() => commit({ ...hvac, scenarios: hvac.scenarios.map(s => { if (s.id !== operating.id) return s; const overrides = { ...s.heaterOverrides }; delete overrides[h.id]; return { ...s, heaterOverrides: overrides }; }) })}>Use Heating output</button></>}
    </details>)}
    {error && <p role="alert" className="cfx-error">{error}</p>}
    {pkg.warnings.map(w => <p key={w} className="cfx-notice">{w}</p>)}
    <button onClick={() => downloadCFD(new Blob([JSON.stringify(pkg, null, 2)], { type: "application/json" }), "hvac-cfd-boundaries.json")}>Export shared boundary package</button>
  </details>;
}
