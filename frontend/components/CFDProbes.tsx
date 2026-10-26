"use client";

import type { CFDScenario } from "@/lib/climoptixDocument";
import { CFDNumber, Parameters } from "./CFDFields";
import { CFDConfirmAction } from "./CFDConfirmAction";

export function CFDProbes({scenario,onChange,selected,onSelect}:{scenario:CFDScenario;onChange:(scenario:CFDScenario)=>void;selected:string|null;onSelect:(id:string|null)=>void}) {
  const probes=scenario.outputs.probesMm;
  const commit=(probesMm:typeof probes)=>onChange({...scenario,outputs:{...scenario.outputs,probesMm}});
  return <details open><summary>Requested outputs &amp; monitoring points</summary>
    <Parameters value={scenario.outputs} omit={["probesMm"]} onChange={outputs=>onChange({...scenario,outputs:outputs as typeof scenario.outputs})}/>
    <p className="cfx-caption">Probe coordinates stay visible. Select a row or a marker in the building viewer to highlight it orange. Requested fields are not proof of computed results.</p>
    <fieldset><legend>Probe positions (mm)</legend>
    <div className="cfx-equal-actions"><button disabled={probes.length>=1000} onClick={()=>{commit([...probes,[0,0,0]]);onSelect(`probe:${probes.length}`);}}>Add probe</button>
      <CFDConfirmAction title="Clear all probes?" disabled={!probes.length} description="Remove every monitoring position. Undo can restore them." onConfirm={()=>{commit([]);onSelect(null);}}/></div>
    {probes.map((point,index)=><div key={index} className={`cfx-probe-row cfx-probe-entry ${selected===`probe:${index}`?"selected":""}`} role="group" aria-label={`Probe ${index+1}`} onFocus={()=>onSelect(`probe:${index}`)}>
      <button className="cfx-probe-name" aria-pressed={selected===`probe:${index}`} onClick={()=>onSelect(`probe:${index}`)}>Probe {index+1}</button>
      {point.map((value,axis)=><CFDNumber key={axis} label={`Probe ${index+1} ${["X","Y","Z"][axis]} (mm)`} value={value} onChange={next=>commit(probes.map((old,at)=>at===index?old.map((v,a)=>a===axis?next:v) as typeof point:old))}/>)}
      <details className="cfx-row-menu"><summary aria-label={`Probe ${index+1} actions`}>⋯</summary><div>
        <button disabled={probes.length>=1000} onClick={()=>{commit([...probes,[...point]]);onSelect(`probe:${probes.length}`);}}>Duplicate probe {index+1}</button>
        <button onClick={()=>{commit(probes.filter((_,at)=>at!==index));onSelect(null);}}>Remove probe {index+1}</button>
      </div></details>
    </div>)}
    {!probes.length&&<p>No probes. Add one to request point monitoring in the next run.</p>}
    </fieldset>
  </details>;
}
