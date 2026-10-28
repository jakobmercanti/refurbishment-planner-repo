"use client";

import { useEffect, useState, type ReactNode } from "react";
import type { RailwayCFDWorker } from "@/lib/railwayCFDWorker";
import type { CFDWorkerJob } from "@/lib/climoptixJobs";
import { autoDeltaRange,availablePlanes,axisLabels,defaultLegend,inPlaneAxes,nearestPlane,restoreSliceState,sliceCSV,type SliceRequest,type SliceState } from "@/lib/cfdSlices";
import { downloadCFD } from "@/lib/climoptix";
import { probeNumber } from "@/lib/cfdPointProbe";
import { CFDNumber } from "./CFDFields";
import { CFDPointProbeControls,useCFDPointProbe } from "./CFDPointProbeControls";
import { CFDSlicePlot,resetSliceView,type SliceView } from "./CFDSlicePlot";
import { useSliceData,useSliceManifest,useSliceRuns } from "./useCFDSlices";
import { CFDFloatingControls } from "./CFDFloatingControls";
import { CFDViewerFrame } from "./CFDViewerFrame";
import { CFDLegacyPlane } from "./CFDLegacyPlane";

function LegendSettings({name,value,onChange}:{name:string;value:typeof defaultLegend;onChange:(v:typeof defaultLegend)=>void}) {
  const patch=(next:Partial<typeof value>)=>onChange({...value,...next});
  return <fieldset><legend>{name}</legend><div className="cfx-slice-controls">
    <label className="cfx-check"><input type="checkbox" checked={value.auto} onChange={e=>patch({auto:e.target.checked})}/>Auto {name}</label>
    <CFDNumber convert={false} label={`${name} minimum`} value={value.min} disabled={value.auto} onChange={min=>patch({min})}/>
    <CFDNumber convert={false} label={`${name} maximum`} value={value.max} disabled={value.auto} onChange={max=>patch({max})}/>
    <label>{name} palette<select aria-label={`${name} palette`} value={value.palette} onChange={e=>patch({palette:e.target.value})}><option value="coolwarm">Blue / neutral / red</option><option value="viridis">Viridis</option><option value="grey">Greyscale</option></select></label>
    <label>{name} colour bands<select aria-label={`${name} colour bands`} value={value.bands} onChange={e=>patch({bands:Number(e.target.value)})}><option value="0">Continuous</option>{[5,9,15].map(n=><option key={n} value={n}>{n} bands</option>)}</select></label>
    <CFDNumber convert={false} label={`${name} tick count`} min={2} max={9} value={value.ticks} onChange={n=>patch({ticks:Math.max(2,Math.min(9,Math.round(n)))})}/>
    <CFDNumber convert={false} label={`${name} decimal precision`} min={0} max={7} value={value.precision} onChange={n=>patch({precision:Math.max(0,Math.min(7,Math.round(n)))})}/>
  </div></fieldset>;
}

export function CFD2DSlices({adapter,projectId,currentJob,active,legacyViewer,forceNative=false}:{adapter:RailwayCFDWorker|null;projectId:string;currentJob?:CFDWorkerJob;active:boolean;legacyViewer?:(embedded:boolean)=>ReactNode;forceNative?:boolean}) {
  const storageKey=`climoptix:2d-slices:v1:${adapter?.namespace??"offline"}:${projectId}:${currentJob?.studyId??"none"}`;
  const [state,setState]=useState<SliceState>(()=>{let text=null;try{text=localStorage.getItem(storageKey);}catch{/* Browser storage may be disabled. */}const restored=restoreSliceState(text);return {...restored,mode:"single",focus:"all",baseline:currentJob?.id??"",time:"",point:null};});
  if(forceNative&&state.mode!=="single")setState({...state,mode:"single",point:null,focus:"all"});
  if(state.mode==="single"&&state.baseline!==(currentJob?.id??""))setState({...state,baseline:currentJob?.id??"",time:"",point:null,focus:"all"});
  const [retry,setRetry]=useState(0),[storageError,setStorageError]=useState("");
  const [view,setView]=useState(resetSliceView),[linked,setLinked]=useState(true),[views,setViews]=useState<Record<string,SliceView>>({});
  const [hover,setHover]=useState(false);
  const runs=useSliceRuns(adapter,projectId,active&&!forceNative&&state.mode==="compare",retry);
  const a=useSliceManifest(adapter,projectId,state.baseline,active&&!forceNative,retry),b=useSliceManifest(adapter,projectId,state.mode==="compare"?state.option:"",active&&!forceNative,retry);
  const am=a.data??undefined,bm=b.data??undefined;
  // Freeze an actual available iteration on initial load; progressive inventory
  // updates cannot jump the user's current time or physical slice coordinate.
  if(am&&!state.time&&am.planes.length){
    const axis=am.planes.some(p=>p.axis===state.axis)?state.axis:am.planes[0].axis;
    const stored=am.planes.filter(p=>p.axis===axis);
    setState({...state,axis,time:stored.reduce((best,p)=>Number(p.time)>Number(best)?p.time:best,stored[0].time)});
  }
  if(bm&&!state.optionTime&&bm.planes.length)setState({...state,optionTime:bm.planes.reduce((best,p)=>Number(p.time)>Number(best)?p.time:best,bm.planes[0].time)});
  const planes=availablePlanes(am,state.axis,state.time),plane=nearestPlane(planes,state.coordinates[state.axis]);
  if(plane&&state.coordinates[state.axis]===undefined)setState({...state,coordinates:{...state.coordinates,[state.axis]:plane.coordinate}});
  const options=availablePlanes(bm,state.axis,state.optionTime),option=nearestPlane(options,plane?.coordinate);
  const actualField=plane?.fields.find(f=>f.name===state.field)??plane?.fields[0];
  const component=actualField&&state.component<actualField.components?state.component:-1;
  const request:SliceRequest|null=!forceNative&&plane&&actualField?{projectId,baseline:{runId:state.baseline,assetId:plane.id},...(state.mode==="compare"&&option?{option:{runId:state.option,assetId:option.id}}:{}),field:actualField.name,component,size:state.size,deltaMode:state.deltaMode,epsilon:state.epsilon,temperature:state.temperature}:null;
  const requestKey=JSON.stringify(request),grid=useSliceData(adapter,request,active,retry);
  const data=grid.data;
  const probe=useCFDPointProbe(active&&!!data&&!!actualField,requestKey);
  const {pick:recordProbe}=probe;
  const point=state.point&&plane&&Math.abs(state.point["XYZ".indexOf(state.axis)]-plane.coordinate)<=1e-7?state.point:null;
  const pointRequest=probe.mode&&point&&request?{...request,point}:null;
  const picked=useSliceData(adapter,pointRequest,active,retry);
  const sample=picked.data?.probe;
  useEffect(()=>{
    if(!picked.data?.point||!sample)return;
    const value=sample.baseline.value;
    recordProbe(value===null?null:{value,position:picked.data.point,field:picked.data.field,component:component<0&&actualField&&actualField.components>1?"magnitude":component>=0?["X","Y","Z"][component]??String(component):"",cell:!!actualField?.cell},sample.baseline.reason);
  },[picked.data,sample,component,actualField,recordProbe]);
  useEffect(()=>{const timer=setTimeout(()=>{try{localStorage.setItem(storageKey,JSON.stringify(state));}catch{setStorageError("Display preferences could not be saved in this browser. Simulation data is unchanged.");}},250);return()=>clearTimeout(timer);},[state,storageKey]);
  const patch=(next:Partial<SliceState>)=>setState({...state,...next});
  const index=plane?planes.indexOf(plane):-1;
  const step=(next:number)=>{const p=planes[Math.max(0,Math.min(planes.length-1,next))];if(p)patch({coordinates:{...state.coordinates,[state.axis]:p.coordinate},point:null});};
  const legendKey=`${actualField?.name}:${component}:${state.temperature}:${state.deltaMode}`;
  const legends=state.legends[legendKey]??{shared:{...defaultLegend,palette:"viridis"},delta:defaultLegend};
  const shared:[number,number]=legends.shared.auto?(data?.range??[0,1]):[legends.shared.min,legends.shared.max];
  const delta:[number,number]=legends.delta.auto?autoDeltaRange(data?.delta??[]):[legends.delta.min,legends.delta.max];
  const invalidShared=!legends.shared.auto&&shared[0]>=shared[1],invalidDelta=!legends.delta.auto&&delta[0]>=delta[1];
  const updateLegend=(kind:"shared"|"delta",value:typeof defaultLegend)=>patch({legends:{...state.legends,[legendKey]:{...legends,[kind]:value}}});
  const axes=inPlaneAxes(state.axis);
  const setPoint=(p:[number,number,number])=>{recordProbe(null,"Sampling picked physical point…");patch({point:p});};
  const fmt=(v:number|null|undefined)=>v==null?"N/A":probeNumber(v);
  const compare=state.mode==="compare";
  const parameter=`${actualField?.name??"field"}${component<0&&actualField&&actualField.components>1?" magnitude":component>=0?"XYZ"[component]??component:""}`;
  const quantity=`${parameter} [${data?.unit??actualField?.unit??"—"}]`;
  const quantitative=!!data?.option&&!data.compatibility.length;
  const changeRun=(kind:"baseline"|"option",id:string)=>patch({[kind]:id,...(kind==="baseline"?{time:""}:{optionTime:""}),point:null});
  const runLabel=(run:CFDWorkerJob)=>`${run.name??(run.studyId===currentJob?.studyId?"Current simulation":`Run ${run.id.slice(0,8)}`)} · ${run.phase} · ${run.createdAt?new Date(run.createdAt*1000).toLocaleString():run.id.slice(0,8)}`;
  const pane=(kind:"baseline"|"option"|"delta",title:string,values?:(number|null)[]|null)=>{
    if(state.focus!=="all"&&state.focus!==kind)return null;
    const value=kind==="baseline"?probe.reading?.sample?.value:kind==="option"?sample?.option?.value:sample?.delta;
    const label=kind==="delta"?(data?.deltaMode==="vector"?"|ΔU|":`Δ ${parameter}`):parameter;
    return <CFDSlicePlot key={kind} title={title} kind={kind} axis={state.axis} physicalCoordinate={kind==="option"?option?.coordinate:plane?.coordinate} data={data} values={values} legend={kind==="delta"?legends.delta:legends.shared} limits={kind==="delta"?delta:shared} view={linked?view:views[kind]??view} onView={v=>linked?setView(v):setViews({...views,[kind]:v})} point={probe.mode&&(kind==="baseline"||quantitative)?point:null} probing={probe.mode&&(kind==="baseline"||quantitative)} hover={hover} onPick={setPoint} readout={probe.mode?{value:value??null,label,unit:kind==="delta"?data?.deltaUnit:data?.unit}:undefined} focus={state.focus===kind} onFocus={()=>patch({focus:state.focus===kind?"all":kind})}/>;
  };
  const clipped=(values:(number|null)[]|undefined|null,limits:[number,number])=>values?.filter(v=>v!==null&&(v<limits[0]||v>limits[1])).length??0;
  return <section className="cfx-slices" data-cfx-probe-scope aria-label="2D CFD slice results" tabIndex={0} onKeyDown={event=>{
    if(event.defaultPrevented||event.altKey||event.ctrlKey||event.metaKey||event.target instanceof Element&&event.target.closest("input,select,textarea,button,[contenteditable=true]"))return;
    if(event.key==="ArrowLeft"||event.key==="ArrowRight"||event.key==="ArrowUp"||event.key==="ArrowDown"||event.key==="Home"||event.key==="End"){event.preventDefault();step(event.key==="Home"?0:event.key==="End"?planes.length-1:index+(event.key==="ArrowRight"||event.key==="ArrowUp"?1:-1));}
  }}>
    <header className="cfx-inline-toolbar"><h3>2D Slice Viewer</h3><div className="cfx-slice-mode" role="group" aria-label="Slice comparison mode">{([['single','Single Run'],['compare','Compare Runs']] as const).map(([mode,label])=><button key={mode} type="button" disabled={forceNative&&mode==="compare"} title={forceNative&&mode==="compare"?"Comparisons require verified simulation runs. Imported files are view-only.":undefined} aria-pressed={state.mode===mode} className={state.mode===mode?"active":""} onClick={()=>patch({mode,baseline:currentJob?.id??"",time:"",focus:"all",point:null})}>{label}</button>)}</div></header>
    <details><summary>Slice data &amp; coordinate conventions</summary><p className="cfx-caption">One solver-produced plane per plot · global X/Y/Z in metres · Z up. Native p is kinematic m²/s², not Pa. No building-editor changes.</p></details>
    {!forceNative&&(!adapter||!currentJob)&&<details open><summary>Simulation availability</summary>
    {!adapter&&<p role="status" className="cfx-notice">Connect the authenticated OpenFOAM worker to browse retained run data. Existing imported 3D results remain in Summary.</p>}
    {!currentJob&&<p role="status" className="cfx-notice">No run is available for the selected simulation. Complete this simulation to display its planes.</p>}
    </details>}
    {a.unsupported||forceNative?<><details><summary>Native plane data availability</summary><p className="cfx-notice">{forceNative?"Imported plane files · simulation provenance and physical units are unverified.":"This service has no indexed slice API. Displaying this simulation’s verified native plane files instead. No new solve is needed."}{compare?" Cross-run deltas require the updated worker and proxy; they are not calculated by this legacy viewer.":""}</p></details>
      {compare?<>
      <details open><summary>Comparison plots · 2 × 2</summary><CFDViewerFrame label="2D comparison viewer"><CFDFloatingControls label="Comparison controls"><details className="cfx-comparison-run-controls"><summary>Comparison run selection</summary><label>Option<select aria-label="Option run" value={state.option} onChange={event=>changeRun("option",event.target.value)}><option value="">Choose a different run…</option>{runs.runs.filter(run=>run.operation!=="mesh"&&run.phase==="Completed"&&run.id!==state.baseline).map(run=><option key={run.id} value={run.id}>{runLabel(run)}</option>)}</select></label>{runs.error&&<p role="alert" className="cfx-error">{runs.error}</p>}</details></CFDFloatingControls><div className="cfx-slice-grid-scroll"><div className="cfx-slice-grid compare cfx-legacy-comparison">
        <section className="cfx-slice-pane" data-slice-pane="baseline"><header><strong>Baseline · current simulation</strong></header>{legacyViewer?.(true)}</section>
        <section className="cfx-slice-pane" data-slice-pane="option"><header><strong>Option · {runs.runs.find(run=>run.id===state.option)?.name??(state.option?`Run ${state.option.slice(0,8)}`:"choose run")}</strong></header><CFDLegacyPlane key={state.option} adapter={adapter} job={runs.runs.find(run=>run.id===state.option)} active={active}/></section>
        <section className="cfx-slice-pane cfx-slice-inspector" data-slice-pane="inspector"><header><strong>Comparison information</strong></header><p>Native planes can be inspected independently in 2D. Pan and zoom never rotate the plane. Check their field ranges and physical plane positions before visual comparison.</p></section>
        <section className="cfx-slice-pane cfx-slice-inspector" data-slice-pane="delta"><header><strong>Delta · unavailable on this worker</strong></header><p>Numerical deltas and linked physical sampling require the indexed slice API. No difference values are inferred from rendered colours.</p></section>
      </div></div></CFDViewerFrame></details></>:legacyViewer?.(false)}
    </>:<>
    <details open><summary>Slice plots{compare?" · 2 × 2":""}</summary><CFDViewerFrame label="2D slice plots">
    {request&&!data&&!grid.error&&<p role="status">Sampling selected physical plane…</p>}
    <div className="cfx-slice-grid-scroll" data-cfx-probe-surface>
    <div className={`cfx-slice-grid${compare?" compare":""}${state.focus!=="all"?" focused":""}`}>
      {pane("baseline",`${compare?"Baseline":"Run"} — ${am?.name??"choose run"} · ${quantity} · ${state.axis} ${plane?probeNumber(plane.coordinate):"—"} m · iteration ${plane?.time??"—"}`,invalidShared?null:data?.a)}
      {compare&&pane("option",`Option — ${bm?.name??"choose run"} · ${quantity} · ${state.axis} ${option?probeNumber(option.coordinate):"—"} m · iteration ${option?.time??"—"}`,invalidShared?null:data?.b)}
      {compare&&(state.focus==="all"||state.focus==="inspector")&&<section className="cfx-slice-pane cfx-slice-inspector" data-slice-pane="inspector" aria-label="Comparison statistics">
      <header><strong>Comparison statistics</strong><button type="button" onClick={()=>patch({focus:state.focus==="inspector"?"all":"inspector"})}>{state.focus==="inspector"?"Show all panes":"Focus inspector"}</button></header>
      {compare&&<div aria-label="Delta statistics"><h4>Common valid sample statistics</h4><p>Coverage {fmt(data?.statistics?data.statistics.coverage*100:null)}% of union rectangle · {fmt(data?.statistics?.commonAreaM2)} m²</p><p>Minimum {fmt(data?.statistics?.min)} · maximum {fmt(data?.statistics?.max)} · area-weighted mean {fmt(data?.statistics?.mean)} · RMS {fmt(data?.statistics?.rms)} {data?.deltaUnit}</p><p>{data?.statistics?.valid??0} valid / {data?.statistics?.missing??0} masked grid samples. Uniform cell-centre quadrature; convergence with grid resolution is not guaranteed at boundaries.</p></div>}
      {data?.notes.map(note=><p key={note} className="cfx-caption">{note}</p>)}
      </section>}
      {compare&&pane("delta",`Delta — ${data?.definition??"Option − Baseline"} · ${actualField?.name??"field"} [${data?.deltaUnit??"—"}] · ${state.axis} ${plane?probeNumber(plane.coordinate):"—"} m`,invalidDelta||!quantitative?null:data?.delta)}
    </div>
    </div>
    <CFDFloatingControls label="Slice controls">
    <div className="cfx-inline-toolbar"><button type="button" onClick={()=>setRetry(n=>n+1)}>Refresh slice data</button><label className="cfx-check"><input type="checkbox" checked={linked} onChange={e=>{setLinked(e.target.checked);setViews({});}}/>Link plot pan/zoom</label><button type="button" onClick={()=>{setView(resetSliceView);setViews({});}}>Reset plot views</button>{state.focus!=="all"&&<button type="button" onClick={()=>patch({focus:"all"})}>Show all panes</button>}</div>
    <details><summary>Runs, fields &amp; physical plane</summary>
    <div className="cfx-slice-controls">
      {compare&&<label>Baseline<select aria-label="Baseline run" value={state.baseline} onChange={e=>changeRun("baseline",e.target.value)}><option value="">Choose a run…</option>{runs.runs.filter(run=>run.operation!=="mesh"&&run.phase==="Completed").map(run=><option key={run.id} value={run.id} disabled={run.id===state.option}>{runLabel(run)}</option>)}</select></label>}
      {compare&&<><label>Option<select aria-label="Option run" value={state.option} onChange={e=>changeRun("option",e.target.value)}><option value="">Choose a different run…</option>{runs.runs.filter(run=>run.operation!=="mesh"&&run.phase==="Completed").map(run=><option key={run.id} value={run.id} disabled={run.id===state.baseline}>{runLabel(run)}</option>)}</select></label><button type="button" disabled={!state.option||state.option===state.baseline} onClick={()=>patch({baseline:state.option,option:state.baseline,time:state.optionTime,optionTime:state.time,point:null})}>Swap runs</button></>}
      <label>Quantity<select aria-label="Slice field" value={actualField?.name??""} onChange={e=>patch({field:e.target.value,component:-1,point:null,...(state.deltaMode==="vector"&&e.target.value!=="U"?{deltaMode:"absolute" as const}:{})})}>{!actualField&&<option value="">No available fields</option>}{plane?.fields.map(f=><option key={f.name} value={f.name}>{f.name==="U"?"Velocity U":f.name==="p"?"Kinematic pressure p":f.name} [{f.unit}]</option>)}</select></label>
      {actualField&&actualField.components>1&&<label>Vector quantity<select aria-label="Vector quantity" value={component} onChange={e=>patch({component:Number(e.target.value),point:null})}><option value="-1">Magnitude |{actualField.name}|</option>{Array.from({length:actualField.components},(_,i)=><option key={i} value={i}>{actualField.name}{"XYZ"[i]??i+1}</option>)}</select></label>}
      <label>Plane orientation<select aria-label="Slice orientation" value={state.axis} onChange={e=>patch({axis:e.target.value as SliceState['axis'],point:null})}>{Object.entries(axisLabels).map(([key,label])=><option key={key} value={key}>{label}</option>)}</select></label>
      <label>Baseline output iteration<select aria-label="Baseline output iteration" value={state.time} onChange={e=>patch({time:e.target.value,point:null})}><option value="">No available output</option>{[...new Set(am?.planes.map(p=>p.time))].sort((a,b)=>Number(a)-Number(b)).map(time=><option key={time}>{time}</option>)}</select></label>
      {compare&&<label>Option output iteration<select aria-label="Option output iteration" value={state.optionTime} onChange={e=>patch({optionTime:e.target.value,point:null})}><option value="">No available output</option>{[...new Set(bm?.planes.map(p=>p.time))].sort((a,b)=>Number(a)-Number(b)).map(time=><option key={time}>{time}</option>)}</select></label>}
    </div>
    <div className="cfx-slice-navigation"><button type="button" disabled={index<=0} onClick={()=>step(index-1)}>Previous plane</button><label>Available physical plane<select aria-label="Available physical plane" value={plane?.id??""} onChange={e=>{const p=planes.find(p=>p.id===e.target.value);if(p)patch({coordinates:{...state.coordinates,[state.axis]:p.coordinate},point:null});}}>{!plane&&<option value="">No ready {state.axis} planes</option>}{planes.map((p,i)=><option key={p.id} value={p.id}>Plane {i+1} of {planes.length} | {state.axis} = {probeNumber(p.coordinate)} m</option>)}</select></label><button type="button" disabled={index<0||index>=planes.length-1} onClick={()=>step(index+1)}>Next plane</button></div>
    {plane&&<p className="cfx-caption">{planes.length>1?`Actual adjacent spacing: ${index>0?probeNumber(plane.coordinate-planes[index-1].coordinate):"—"} / ${index+1<planes.length?probeNumber(planes[index+1].coordinate-plane.coordinate):"—"} m. `:"Only one plane available. "}Horizontal {"XYZ"[axes[0]]} / vertical {"XYZ"[axes[1]]}. Iterations are not elapsed seconds.</p>}
    <div className="cfx-slice-status" role="status">{[am,bm].filter(Boolean).map(m=><p key={m!.runId}><strong>{m!.name}</strong> · {m!.status} · {new Date(m!.createdAt*1000).toLocaleString()} · {m!.solver} · geometry {m!.sourceHash.slice(0,10)} · {m!.planes.length} ready planes, {m!.pending} pending · job updated {new Date(m!.updatedAt*1000).toLocaleTimeString()}{m!.status!=="Completed"?` · ${m!.message}`:""}</p>)}</div>
    <p className="cfx-caption">Inventories refresh automatically while this Results view is active. The latest ten retained output iterations are indexed; older raw outputs remain available in the native archive under Summary &amp; 3D.</p>
    {[runs.error,a.error,b.error,grid.error,picked.error,storageError].filter(Boolean).map(message=><p key={message} role="alert" className="cfx-error">{message}</p>)}
    {[...(am?.warnings??[]),...(bm?.warnings??[])].map((warning,i)=><p key={i} className="cfx-notice">{warning}</p>)}
    {state.baseline&&runs.runs.length&&!runs.runs.some(r=>r.id===state.baseline)?<p className="cfx-notice">Saved run is no longer in the authorized inventory. Choose another run.</p>:null}
    {actualField&&actualField.name!==state.field&&<p className="cfx-notice">{state.field} is unavailable on this plane. Showing {actualField.name}; choose a stored field.</p>}
    {plane&&state.coordinates[state.axis]!==undefined&&Math.abs(plane.coordinate-state.coordinates[state.axis]!)>1e-7&&<p className="cfx-notice">Saved {state.axis} = {probeNumber(state.coordinates[state.axis]!)} m is not available in this run/output. Showing the nearest ready plane at {probeNumber(plane.coordinate)} m; no interpolation between planes is implied.</p>}
    {am?.planes.length&&!am.planes.some(p=>p.time===state.time)?<p className="cfx-notice">Saved output iteration is no longer indexed. Choose an available iteration, or <button type="button" onClick={()=>patch({time:"",point:null})}>Use latest available output</button>.</p>:null}
    {b.unsupported&&<p className="cfx-notice">The comparison run requires the indexed slice API. Its legacy files can still be viewed under that simulation&apos;s Results.</p>}
    {am&&!planes.length&&<p className="cfx-notice">No ready {state.axis} planes at this output iteration. Choose another axis/time, or wait for a completed sampled-field write. No contours are fabricated.</p>}
    {data?.compatibility.map(reason=><p key={reason} role="status" className="cfx-notice">{reason}</p>)}
    {compare&&data?.option&&!quantitative&&<p className="cfx-caption">The Option is view-only until the data is physically comparable. Point picking remains available on Baseline; Option/Delta picking and cross-run differences are disabled.</p>}
    {compare&&!option&&<p className="cfx-notice">Choose an Option run with a ready {state.axis} plane. Delta and cross-run probes require matching physical planes.</p>}
    </details>
    <details><summary>Visual settings &amp; delta legend</summary><div className="cfx-slice-controls"><label>Sampling grid<select aria-label="Sampling grid" value={state.size} onChange={e=>patch({size:Number(e.target.value)})}>{[96,128,256,512].map(n=><option key={n} value={n}>{n} × {n} area-centred samples</option>)}</select></label>
      <label>Temperature display<select aria-label="Temperature display" value={state.temperature} onChange={e=>patch({temperature:e.target.value as "K"|"C"})}><option value="K">Kelvin (requires stored K field)</option><option value="C">Celsius (only from known K)</option></select></label>
      {compare&&<><label>Delta definition<select aria-label="Delta definition" value={state.deltaMode} onChange={e=>patch({deltaMode:e.target.value as SliceRequest['deltaMode']})}><option value="absolute">Option − Baseline</option><option value="percent">100 × (Option − Baseline) / |Baseline| [%]</option><option value="vector" disabled={actualField?.name!=="U"||actualField.components!==3}>|U_option − U_baseline| [m/s]</option></select></label><CFDNumber convert={false} label="Relative delta denominator floor" value={state.epsilon} min={1e-12} onChange={epsilon=>{if(epsilon>0&&epsilon<=1e10)patch({epsilon});}}/></>}
    </div><LegendSettings name="Shared scale" value={legends.shared} onChange={v=>updateLegend("shared",v)}/>{compare&&<LegendSettings name="Delta scale" value={legends.delta} onChange={v=>updateLegend("delta",v)}/>}<p className="cfx-caption">Baseline and Option always share one range. Delta is Option − Baseline; default diverging scale is symmetric about zero. Masked grey is unavailable, never zero. Relative delta masks |baseline| ≤ the denominator floor. Manual clipping changes colours only.</p>
    {(invalidShared||invalidDelta)&&<p role="alert" className="cfx-error">Legend minimum must be less than maximum. Restore Auto or correct the bounds. Numeric data has not changed.</p>}
    {data&&<p className="cfx-caption">Clipped samples: baseline {clipped(data.a,shared)}, option {clipped(data.b,shared)}, delta {clipped(data.delta,delta)}. Grey cells are holes, outside fluid or unavailable values; near-zero denominators are also masked in percent mode.</p>}
    </details>
    <details><summary>Point probing (V / Esc)</summary><CFDPointProbeControls probe={probe}/><div className="cfx-slice-controls"><label>Probe interaction<select aria-label="Probe interaction" value={hover?"hover":"pin"} onChange={e=>setHover(e.target.value==="hover")}><option value="pin">Click to pin / replace</option><option value="hover">Hover (80 ms debounce)</option></select></label><button type="button" onClick={()=>{patch({point:null});recordProbe(null,"Probe cleared. Pick another point.");}}>Clear picked point</button></div>
      {state.point&&!point&&<p className="cfx-notice">Saved probe is off the displayed plane and is hidden. Pick a point on this plane.</p>}
      <p className="cfx-caption">V toggles point mode; Esc exits. A click replaces the value shown inside the plot. Drag pans without probing; arrow keys browse planes.</p></details>
    </CFDFloatingControls>
    </CFDViewerFrame></details>
    <details><summary>Export numeric data &amp; provenance</summary><div className="cfx-equal-actions"><button type="button" disabled={!data?.a} onClick={()=>{if(data)downloadCFD(new Blob([sliceCSV(data,option)],{type:"text/csv"}),"cfd-slice-option-minus-baseline.csv");}}>Download slice / delta CSV</button><button type="button" disabled={!data} onClick={()=>{if(data)downloadCFD(new Blob([JSON.stringify({data,settings:state,baseline:am,option:bm,probe:probe.mode?picked.data:null},null,2)],{type:"application/json"}),"cfd-slice-provenance.json");}}>Download comparison metadata</button></div><p className="cfx-caption">CSV includes both run/asset IDs, separate Baseline and Option physical sample coordinates, mask, sign, units and method. JSON includes the exact numerical raster, legends and provenance. Plot PNG downloads include displayed title, axes and colour scale.</p></details>
    </>}
  </section>;
}
