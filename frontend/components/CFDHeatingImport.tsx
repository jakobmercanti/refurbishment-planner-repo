"use client";

import { useMemo, useState } from "react";
import type { ProjectDocument } from "@/lib/projectDocument";
import type { CFDReport } from "@/lib/climoptix";
import type { CFDScenario } from "@/lib/climoptixDocument";
import { applyCFDHeating,cfdHeatingCandidates } from "@/lib/cfdHeatingBridge";
import { CFDNumber } from "./CFDFields";
import { CFDIndependentWindow } from "./CFDIndependentWindow";
import { CFDCollapseAll } from "./CFDCollapseAll";
import { SharedHvacCFD } from "./SharedHvacCFD";

export function CFDHeatingImport({project,scenario,report,checked,onChange,onClose,onInsulation,onEditSource}:{project:ProjectDocument;scenario:CFDScenario;report:CFDReport|null;checked:boolean;onChange:(s:CFDScenario,checkpoint?:boolean)=>void;onClose:()=>void;onInsulation:()=>void;onEditSource:()=>void}) {
  const candidates=useMemo(()=>report?cfdHeatingCandidates(project,report):[],[project,report]);
  const [selected,setSelected]=useState<Record<string,number>>({}),[error,setError]=useState("");
  return <CFDIndependentWindow title="Import insulation & heating conditions" wide onClose={onClose}>
    <section data-cfx-collapse-root className="cfx-heating-import-panel">
    <div className="cfx-window-disclosure-bar"><CFDCollapseAll/></div>
    <details open><summary>Source workbenches</summary><div className="cfx-equal-actions"><button onClick={onInsulation}>Import insulation boundary conditions</button><button onClick={onEditSource}>Open floorplan source workbenches</button></div>
    <p className="cfx-notice">Thermal CFD preparation only: the current native worker cannot solve temperature or buoyancy. Applying heating enables the thermal equations and blocks incompatible isothermal runs. Export a thermal contract for a compatible solver; no heat result is fabricated.</p>
    </details>
    {project.hvac?.bindings[scenario.id] ? <SharedHvacCFD scenario={scenario} report={report} checked={checked} onEditSource={() => { onClose(); onEditSource(); }} /> : <details open><summary>Radiators · explicit surface temperatures</summary>
      <p>Sources come from the measured heating workbench in the checked air domain. Radiators use their existing solid proxies, never duplicate boxes. UFH retains its zone/loop footprint; replacing a partial heated region with a whole-floor temperature is not supported. Water temperature and rated watts are not surface temperatures.</p>
      <p className="cfx-caption">Select each source and review its assumed surface temperature before applying. Constant temperature replaces that object&apos;s power input to avoid double counting. No source geometry or heating design is changed.</p>
      {candidates.map(source=><div key={source.id} className="cfx-grid"><label className="cfx-check"><input type="checkbox" disabled={source.kind === "floor"} title={source.kind === "floor" ? "Partial UFH floor mapping is not connected. Export its actual zone footprint from Shared HVAC." : undefined} checked={Object.hasOwn(selected,source.id)} onChange={event=>setSelected(current=>{const next={...current};if(event.target.checked)next[source.id]=318.15;else delete next[source.id];return next;})}/>{source.name}{source.kind === "floor" ? " · zone mapping not connected" : ""}</label>
        {Object.hasOwn(selected,source.id)&&<CFDNumber label={`${source.name} surface temperature (K)`} value={selected[source.id]} min={150} max={1500} onChange={value=>setSelected(current=>({...current,[source.id]:value}))}/>}</div>)}
      {!candidates.length&&<p>No eligible measured radiators or UFH floors in this checked domain. Add them in the floorplan Heating workbench and refresh preparation. Missing source geometry is not invented.</p>}
    {!checked&&<p className="cfx-error">Refresh geometry checks before importing. Sources must match the current measured building.</p>}
    {error&&<p role="alert" className="cfx-error">{error}</p>}
    <button className="cfx-primary" disabled={!checked||!Object.keys(selected).length} onClick={()=>{try{onChange(applyCFDHeating(scenario,candidates,selected),true);onClose();}catch(cause){setError(cause instanceof Error?cause.message:"Heating import failed.");}}}>Apply selected heating conditions</button></details>}
    </section>
  </CFDIndependentWindow>;
}
