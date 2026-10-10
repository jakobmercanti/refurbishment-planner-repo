"use client";
import { useState } from "react";
import type { HeatingElementSpec } from "@/lib/heatingElements";
import { heatingElementSpecSchema } from "@/lib/heatingDocument";
export function HeatingSpecsEditor({ value, onChange }: { value: HeatingElementSpec; onChange: (spec: HeatingElementSpec) => void }) {
  const [error, setError] = useState("");
  const update = (patch: Partial<HeatingElementSpec>) => { const parsed = heatingElementSpecSchema.safeParse({ ...value, ...patch }); if (parsed.success) { onChange(parsed.data); setError(""); } else setError("Check the thermal input; existing specification retained."); };
  return <details><summary>Heating technical specifications</summary><p>Ratings must come from the selected product or your own verified inputs. Not set is not zero capacity. Changing physical dimensions invalidates published ratings.</p>
    {value.estimatedOutput && <p>Estimated size-scaled panel surrogate. Not a verified product rating.</p>}
    <label className="field"><span>Technology</span><select value={value.emitterTechnology} onChange={e => update({ emitterTechnology: e.target.value as HeatingElementSpec["emitterTechnology"], manufacturerPerformanceData: [], performanceReference: undefined, ratedOutputW: null })}>{["Hydronic", "Electric", "Hybrid"].map(x => <option key={x}>{x}</option>)}</select></label>
    <label className="field"><span>Emitter type</span><select value={value.category} onChange={e => update({ category: e.target.value as HeatingElementSpec["category"], manufacturerPerformanceData: [], performanceReference: undefined, ratedOutputW: null, estimatedOutput: false })}>{["Type 10", "Type 11", "Type 21", "Type 22", "Type 33", "Towel", "Custom", "Boiler"].map(x => <option key={x}>{x}</option>)}</select></label>
    {(["manufacturer", "model", "performanceReference"] as const).map(key => <label className="field" key={key}><span>{key}</span><input value={value[key] ?? ""} onChange={e => update({ [key]: e.target.value })} /></label>)}
    {([['ratedOutputW','Rated output W'],['ratedDeltaTK','Rated ΔT K'],['exponent','Correction exponent (estimate unless supplied)'],['electricalInputW','Electrical input W']] as const).map(([key,label]) => <label key={key} className="field"><span>{label}</span><input type="number" min="0" step="any" placeholder="Not set" value={value[key] ?? ""} onChange={e => { const n = e.target.value === "" && key === "ratedOutputW" ? null : Number(e.target.value); update({ [key]: n, ...(key === "ratedOutputW" ? { estimatedOutput: false } : {}) }); }} /></label>)}
    <label className="field"><span>Manufacturer operating points JSON</span><textarea key={JSON.stringify(value.manufacturerPerformanceData)} defaultValue={JSON.stringify(value.manufacturerPerformanceData, null, 2)} onBlur={e => { try { update({ manufacturerPerformanceData: JSON.parse(e.target.value) }); } catch { setError("Invalid performance JSON; existing values retained."); } }} /></label><small>Rows: flowC, returnC, roomC, outputW, electricalW, fanMode; optional soundDb. Hybrid outputs require manufacturer tables.</small>{error && <p role="alert">{error}</p>}
  </details>;
}
