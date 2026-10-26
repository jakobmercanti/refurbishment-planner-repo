"use client";

import { useState } from "react";
import { downloadCFD } from "@/lib/climoptix";
import { workerTelemetryCSV, type WorkerTelemetry } from "@/lib/cfdWorkerTelemetry";
import type { WorkerResult } from "@/lib/railwayCFDWorker";

const number = (value:number | null | undefined) => value == null ? "—" : value.toPrecision(5);
function History({label, unit, samples, threshold}: {
  label:string; unit:string; samples:{iteration:number;value:number}[]; threshold?:number | null;
}) {
  if (!samples.length) return <p className="cfx-caption">No {label.toLowerCase()} samples yet.</p>;
  const low=Math.min(0,...samples.map(s=>s.value));
  const high=Math.max(low+1e-12,...samples.map(s=>s.value),threshold??low);
  const first=samples[0].iteration, last=samples[samples.length-1].iteration;
  const x=(iteration:number)=>50+(iteration-first)/Math.max(last-first,1)*320;
  const y=(value:number)=>112-(value-low)/(high-low)*84;
  return <figure className="cfx-telemetry-chart">
    <figcaption>{label} ({unit})</figcaption>
    <svg viewBox="0 0 400 150" role="img" aria-label={`${label} history (${unit})`}>
      <title>{`${label} against solver iteration; units ${unit}`}</title>
      <path d="M50 20 V112 H375" fill="none" stroke="currentColor" opacity=".35" />
      {threshold!=null&&<><line x1="50" x2="375" y1={y(threshold)} y2={y(threshold)} stroke="currentColor" strokeDasharray="4 3"/><text x="55" y="18">Dashed: requested tolerance</text></>}
      <polyline points={samples.map(s=>`${x(s.iteration)},${y(s.value)}`).join(" ")} fill="none" stroke="currentColor" strokeWidth="2" />
      <text x="2" y="30">{number(high)}</text><text x="2" y="115">{number(low)}</text>
      <text x="50" y="133">{first}</text><text x="350" y="133">{last}</text><text x="166" y="147">Iteration</text>
    </svg>
  </figure>;
}

export function CFDWorkerTelemetry({data,result,jobId}: {data:WorkerTelemetry | null;result:WorkerResult | null;jobId:string}) {
  const [selected,setSelected]=useState(0);
  const probe=data?.probes.find(p=>p.index===selected)??data?.probes[0];
  const sample=probe?.samples[probe.samples.length-1];
  const balance=data?.balance, latest=balance?.samples[balance.samples.length-1];
  return <section className="cfx-telemetry" aria-label="Measured worker telemetry">
    <details open><summary>Probes &amp; flow balance</summary>
    <div className="cfx-inline-toolbar">
      <button disabled={!data||(!data.probes.length&&!data.balance?.samples.length)} onClick={()=>{
        if(data) downloadCFD(new Blob([workerTelemetryCSV(data)],{type:"text/csv"}),`${jobId}-telemetry.csv`);
      }}>Download telemetry CSV</button>
    </div>
    <p className="cfx-caption">Measured native output, pinned to this job. Iterations are not elapsed seconds. Pressure p is kinematic (m²/s²), not Pa.</p>
    {data?.warnings.map(warning=><p key={warning} role="status">{warning}</p>)}
    {data?.truncated&&<p className="cfx-caption">Recent history only: up to 32 samples per probe and 120 flow-balance samples. Full native files remain in the archive.</p>}
    {!data&&<p className="cfx-caption">This worker has not supplied live probe/flux telemetry yet. Native data, when available, is retained in its case archive.</p>}
    {latest&&balance&&<details open aria-label="Measured flow balance">
      <summary>Flow balance · iteration {latest.iteration}</summary>
      <dl className="cfx-telemetry-values"><div><dt>Inflow (m³/s)</dt><dd>{number(latest.incomingM3S)}</dd></div>
        <div><dt>Outflow (m³/s)</dt><dd>{number(latest.outgoingM3S)}</dd></div><div><dt>Net outflow (m³/s)</dt><dd>{number(latest.netM3S)}</dd></div>
        <div><dt>Relative imbalance</dt><dd>{number(latest.relativeImbalance*100)}%</dd></div>
        <div><dt>Requested tolerance</dt><dd>{balance.tolerance==null?"Unavailable":`${number(balance.tolerance*100)}%`}</dd></div></dl>
      <History label="Relative flow imbalance" unit="fraction" samples={balance.samples.map(s=>({iteration:s.iteration,value:s.relativeImbalance}))} threshold={balance.tolerance}/>
      <details><summary>Native patch fluxes (m³/s; outward positive)</summary><dl>{Object.entries(balance.fluxM3S).map(([name,value])=><div key={name}><dt>{name}</dt><dd>{number(value)}</dd></div>)}</dl></details>
    </details>}
    {data&&!latest&&<p className="cfx-caption">No aligned boundary-flux samples yet. A partial set of patches is never reported as a balance.</p>}
    {probe&&<details open aria-label="Measured probe history"><summary>Probe history</summary>
      <label>Probe to monitor<select aria-label="Probe to monitor" value={probe.index} onChange={e=>setSelected(Number(e.target.value))}>
        {data!.probes.map(p=><option key={p.index} value={p.index}>Probe {p.index+1}</option>)}</select></label>
      <h4>Probe {probe.index+1}{probe.positionMm?` · X ${number(probe.positionMm[0])} mm · Y ${number(probe.positionMm[1])} mm · Z ${number(probe.positionMm[2])} mm`:" · position metadata unavailable"}</h4>
      <p>Latest sample: iteration {sample?.iteration ?? "—"}</p>
      <dl className="cfx-telemetry-values"><div><dt>Velocity X (m/s)</dt><dd>{number(sample?.velocityMS?.[0])}</dd></div>
        <div><dt>Velocity Y (m/s)</dt><dd>{number(sample?.velocityMS?.[1])}</dd></div><div><dt>Velocity Z (m/s)</dt><dd>{number(sample?.velocityMS?.[2])}</dd></div>
        <div><dt>Pressure p (m²/s²)</dt><dd>{number(sample?.pressureM2S2)}</dd></div></dl>
      <div className="cfx-grid"><History label={`Probe ${probe.index+1} speed`} unit="m/s" samples={probe.samples.flatMap(s=>s.velocityMS?[{iteration:s.iteration,value:Math.hypot(...s.velocityMS)}]:[])}/>
        <History label={`Probe ${probe.index+1} pressure`} unit="m²/s²" samples={probe.samples.flatMap(s=>s.pressureM2S2!=null?[{iteration:s.iteration,value:s.pressureM2S2}]:[])}/></div>
    </details>}
    {data&&!probe&&<p className="cfx-caption">No probe samples yet. Configure probe coordinates in Solver → Post before running.</p>}
    {result&&(result.mesh||result.convergence||result.conservation)&&<section aria-label="Final measured acceptance metrics"><details open>
      <summary>Final measured acceptance metrics</summary><dl className="cfx-telemetry-values">
        {result.mesh&&<><div><dt>Mesh cells</dt><dd>{result.mesh.cells.toLocaleString()}</dd></div>
          <div><dt>Maximum non-orthogonality (°)</dt><dd>{number(result.mesh.maxNonOrthogonality)}</dd></div><div><dt>Maximum skewness</dt><dd>{number(result.mesh.maxSkewness)}</dd></div></>}
        {result.conservation&&<div><dt>Final relative flow imbalance</dt><dd>{number(result.conservation.relativeImbalance*100)}% · tolerance {number(result.conservation.tolerance*100)}%</dd></div>}
        {result.convergence&&<div><dt>Final initial residual target</dt><dd>{number(result.convergence.target)}</dd></div>}
        {result.convergence?.finalInitialResiduals&&Object.entries(result.convergence.finalInitialResiduals).map(([field,value])=><div key={field}><dt>{field} initial residual</dt><dd>{number(value)}</dd></div>)}
      </dl>
    </details></section>}
    </details>
  </section>;
}
