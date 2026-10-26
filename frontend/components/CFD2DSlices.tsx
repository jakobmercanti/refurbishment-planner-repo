"use client";

import { useEffect, useState } from "react";
import type { RailwayCFDWorker } from "@/lib/railwayCFDWorker";
import type { CFDWorkerJob } from "@/lib/climoptixJobs";
import { autoDeltaRange,availablePlanes,axisLabels,defaultLegend,inPlaneAxes,nearestPlane,restoreSliceState,sliceCSV,type SliceRequest,type SliceState } from "@/lib/cfdSlices";
import { downloadCFD } from "@/lib/climoptix";
import { probeNumber } from "@/lib/cfdPointProbe";
import { CFDNumber } from "./CFDFields";
import { CFDPointProbeControls,useCFDPointProbe } from "./CFDPointProbeControls";
import { CFDSlicePlot,resetSliceView,type SliceView } from "./CFDSlicePlot";
import { useSliceData,useSliceManifest,useSliceRuns } from "./useCFDSlices";

function LegendSettings({name,value,onChange}:{name:string;value:typeof defaultLegend;onChange:(v:typeof defaultLegend)=>void}) {
  const patch=(next:Partial<typeof value>)=>onChange({...value,...next});
  return <fieldset><legend>{name}</legend><div className="cfx-slice-controls">
    <label className="cfx-check"><input type="checkbox" checked={value.auto} onChange={e=>patch({auto:e.target.checked})}/>Auto {name}</label>
    <CFDNumber convert={false} label={`${name} minimum`} value={value.min} disabled={value.auto} onChange={min=>patch({min})}/>
    <CFDNumber convert={false} label={`${name} maximum`} value={value.max} disabled={value.auto} onChange={max=>patch({max})}/>
    <label>{name} palette<select value={value.palette} onChange={e=>patch({palette:e.target.value})}><option value="coolwarm">Blue / neutral / red</option><option value="viridis">Viridis</option><option value="grey">Greyscale</option></select></label>
    <label>{name} colour bands<select value={value.bands} onChange={e=>patch({bands:Number(e.target.value)})}><option value="0">Continuous</option>{[5,9,15].map(n=><option key={n} value={n}>{n} bands</option>)}</select></label>
    <CFDNumber convert={false} label={`${name} tick count`} min={2} max={9} value={value.ticks} onChange={n=>patch({ticks:Math.max(2,Math.min(9,Math.round(n)))})}/>
    <CFDNumber convert={false} label={`${name} decimal precision`} min={0} max={7} value={value.precision} onChange={n=>patch({precision:Math.max(0,Math.min(7,Math.round(n)))})}/>
  </div></fieldset>;
}

export function CFD2DSlices({adapter,projectId,currentJob,active}:{adapter:RailwayCFDWorker|null;projectId:string;currentJob?:CFDWorkerJob;active:boolean}) {
  const storageKey=`climoptix:2d-slices:v1:${adapter?.namespace??"offline"}:${projectId}`;
  const [state,setState]=useState<SliceState>(()=>{let text=null;try{text=localStorage.getItem(storageKey);}catch{/* Browser storage may be disabled. */}const restored=restoreSliceState(text);return {...restored,baseline:restored.baseline||currentJob?.id||""};});
  const [retry,setRetry]=useState(0),[storageError,setStorageError]=useState("");
  const [view,setView]=useState(resetSliceView),[linked,setLinked]=useState(true),[views,setViews]=useState<Record<string,SliceView>>({});
  const [hover,setHover]=useState(false);
  const runs=useSliceRuns(adapter,projectId,active,retry);
  const a=useSliceManifest(adapter,projectId,state.baseline,active,retry),b=useSliceManifest(adapter,projectId,state.mode==="compare"?state.option:"",active,retry);
  const am=a.data??undefined,bm=b.data??undefined;
  // Freeze an actual available iteration on initial load; progressive inventory
  // updates cannot jump the user's current time or physical slice coordinate.
  if(am&&!state.time&&am.planes.length)setState({...state,time:am.planes.reduce((best,p)=>Number(p.time)>Number(best)?p.time:best,am.planes[0].time)});
  if(bm&&!state.optionTime&&bm.planes.length)setState({...state,optionTime:bm.planes.reduce((best,p)=>Number(p.time)>Number(best)?p.time:best,bm.planes[0].time)});
  const planes=availablePlanes(am,state.axis,state.time),plane=nearestPlane(planes,state.coordinates[state.axis]);
  if(plane&&state.coordinates[state.axis]===undefined)setState({...state,coordinates:{...state.coordinates,[state.axis]:plane.coordinate}});
  const options=availablePlanes(bm,state.axis,state.optionTime),option=nearestPlane(options,plane?.coordinate);
  const actualField=plane?.fields.find(f=>f.name===state.field)??plane?.fields[0];
  const component=actualField&&state.component<actualField.components?state.component:-1;
  const request:SliceRequest|null=plane&&actualField?{projectId,baseline:{runId:state.baseline,assetId:plane.id},...(state.mode==="compare"&&option?{option:{runId:state.option,assetId:option.id}}:{}),field:actualField.name,component,size:state.size,deltaMode:state.deltaMode,epsilon:state.epsilon,temperature:state.temperature}:null;
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
  const axes=inPlaneAxes(state.axis),axis="XYZ".indexOf(state.axis);
  const setPoint=(p:[number,number,number])=>{recordProbe(null,"Sampling picked physical point…");patch({point:p});};
  const fmt=(v:number|null|undefined)=>v==null?"N/A":probeNumber(v);
  const compare=state.mode==="compare";
  const quantity=`${actualField?.name??"field"}${component<0&&actualField&&actualField.components>1?" magnitude":component>=0?"XYZ"[component]??component:""} [${data?.unit??actualField?.unit??"—"}]`;
  const velocities=sample?.baseline.velocity&&sample.option?.velocity?{a:sample.baseline.velocity as number[],b:sample.option.velocity as number[]}:null;
  const quantitative=!!data?.option&&!data.compatibility.length;
  const changeRun=(kind:"baseline"|"option",id:string)=>patch({[kind]:id,...(kind==="baseline"?{time:""}:{optionTime:""}),point:null});
  const runLabel=(run:CFDWorkerJob)=>`${run.name??(run.studyId===currentJob?.studyId?"Current study":run.studyId)} · ${run.phase} · ${run.createdAt?new Date(run.createdAt*1000).toLocaleString():run.id.slice(0,8)}`;
  const pane=(kind:"baseline"|"option"|"delta",title:string,values?:(number|null)[]|null)=>state.focus==="all"||state.focus===kind?<CFDSlicePlot key={kind} title={title} kind={kind} axis={state.axis} data={data} values={values} legend={kind==="delta"?legends.delta:legends.shared} limits={kind==="delta"?delta:shared} view={linked?view:views[kind]??view} onView={v=>linked?setView(v):setViews({...views,[kind]:v})} point={probe.mode&&(kind==="baseline"||quantitative)?point:null} probing={probe.mode} hover={hover} onPick={setPoint} focus={state.focus===kind} onFocus={()=>patch({focus:state.focus===kind?"all":kind})}/>:null;
  const clipped=(values:(number|null)[]|undefined|null,limits:[number,number])=>values?.filter(v=>v!==null&&(v<limits[0]||v>limits[1])).length??0;
  return <section className="cfx-slices" aria-label="2D CFD slice results" tabIndex={0} onKeyDown={event=>{
    if(event.defaultPrevented||event.altKey||event.ctrlKey||event.metaKey||event.target instanceof Element&&event.target.closest("input,select,textarea,button,[contenteditable=true]"))return;
    if(event.key==="ArrowLeft"||event.key==="ArrowRight"||event.key==="Home"||event.key==="End"){event.preventDefault();step(event.key==="Home"?0:event.key==="End"?planes.length-1:index+(event.key==="ArrowRight"?1:-1));}
  }}>
    <header className="cfx-inline-toolbar"><h3>2D Slice Viewer</h3><div className="cfx-segment" role="group" aria-label="Slice comparison mode">{([['single','Single Run'],['compare','Compare Runs']] as const).map(([mode,label])=><button key={mode} type="button" aria-pressed={state.mode===mode} className={state.mode===mode?"active":""} onClick={()=>patch({mode,focus:"all",point:null})}>{label}</button>)}</div></header>
    <p className="cfx-caption">One solver-produced plane per plot · global X/Y/Z in metres · Z up. Native p is kinematic m²/s², not Pa. No building-editor changes.</p>
    {!adapter&&<p role="status" className="cfx-notice">Connect the authenticated OpenFOAM worker to browse retained run data. Existing imported 3D results remain in Summary.</p>}
    <div className="cfx-slice-controls">
      <label>{compare?"Baseline":"Run"}<select aria-label={compare?"Baseline run":"Slice run"} value={state.baseline} onChange={e=>changeRun("baseline",e.target.value)}><option value="">Choose a run…</option>{runs.runs.map(run=><option key={run.id} value={run.id} disabled={compare&&run.id===state.option}>{runLabel(run)}</option>)}</select></label>
      {compare&&<><label>Option<select aria-label="Option run" value={state.option} onChange={e=>changeRun("option",e.target.value)}><option value="">Choose a different run…</option>{runs.runs.map(run=><option key={run.id} value={run.id} disabled={run.id===state.baseline}>{runLabel(run)}</option>)}</select></label><button type="button" disabled={!state.option||state.option===state.baseline} onClick={()=>patch({baseline:state.option,option:state.baseline,time:state.optionTime,optionTime:state.time,point:null})}>Swap runs</button></>}
      <label>Quantity<select aria-label="Slice field" value={actualField?.name??""} onChange={e=>patch({field:e.target.value,component:-1,point:null})}>{!actualField&&<option value="">No available fields</option>}{plane?.fields.map(f=><option key={f.name} value={f.name}>{f.name==="U"?"Velocity U":f.name==="p"?"Kinematic pressure p":f.name} [{f.unit}]</option>)}</select></label>
      {actualField&&actualField.components>1&&<label>Vector quantity<select value={component} onChange={e=>patch({component:Number(e.target.value),point:null})}><option value="-1">Magnitude |{actualField.name}|</option>{Array.from({length:actualField.components},(_,i)=><option key={i} value={i}>{actualField.name}{"XYZ"[i]??i+1}</option>)}</select></label>}
      <label>Plane orientation<select aria-label="Slice orientation" value={state.axis} onChange={e=>patch({axis:e.target.value as SliceState['axis'],point:null})}>{Object.entries(axisLabels).map(([key,label])=><option key={key} value={key}>{label}</option>)}</select></label>
      <label>Baseline output iteration<select aria-label="Baseline output iteration" value={state.time} onChange={e=>patch({time:e.target.value,point:null})}><option value="">No available output</option>{[...new Set(am?.planes.map(p=>p.time))].sort((a,b)=>Number(a)-Number(b)).map(time=><option key={time}>{time}</option>)}</select></label>
      {compare&&<label>Option output iteration<select value={state.optionTime} onChange={e=>patch({optionTime:e.target.value,point:null})}><option value="">No available output</option>{[...new Set(bm?.planes.map(p=>p.time))].sort((a,b)=>Number(a)-Number(b)).map(time=><option key={time}>{time}</option>)}</select></label>}
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
    {(a.error||b.error)&&<p className="cfx-caption">A 404 can mean a missing run or an older worker without the slice API. Use Summary &amp; 3D for existing downloads; the new slice workflow requires the matching worker and proxy version.</p>}
    {am&&!planes.length&&<p className="cfx-notice">No ready {state.axis} planes at this output iteration. Choose another axis/time, or wait for a completed sampled-field write. No contours are fabricated.</p>}
    {data?.compatibility.map(reason=><p key={reason} role="status" className="cfx-notice">{reason}</p>)}
    {compare&&!option&&<p className="cfx-notice">Choose an Option run with a ready {state.axis} plane. Delta and cross-run probes require matching physical planes.</p>}
    <div className="cfx-inline-toolbar"><button type="button" onClick={()=>setRetry(n=>n+1)}>Refresh slice data</button><label className="cfx-check"><input type="checkbox" checked={linked} onChange={e=>{setLinked(e.target.checked);setViews({});}}/>Link plot pan/zoom</label><button type="button" onClick={()=>{setView(resetSliceView);setViews({});}}>Reset plot views</button>{state.focus!=="all"&&<button type="button" onClick={()=>patch({focus:"all"})}>Show all panes</button>}</div>
    <details><summary>Visual settings &amp; delta legend</summary><div className="cfx-slice-controls"><label>Sampling grid<select value={state.size} onChange={e=>patch({size:Number(e.target.value)})}>{[96,128,256,512].map(n=><option key={n} value={n}>{n} × {n} area-centred samples</option>)}</select></label>
      <label>Temperature display<select value={state.temperature} onChange={e=>patch({temperature:e.target.value as "K"|"C"})}><option value="K">Kelvin (requires stored K field)</option><option value="C">Celsius (only from known K)</option></select></label>
      {compare&&<><label>Delta definition<select value={state.deltaMode} onChange={e=>patch({deltaMode:e.target.value as SliceRequest['deltaMode']})}><option value="absolute">Option − Baseline</option><option value="percent">100 × (Option − Baseline) / |Baseline| [%]</option><option value="vector" disabled={actualField?.name!=="U"||actualField.components!==3}>|U_option − U_baseline| [m/s]</option></select></label><CFDNumber convert={false} label="Relative delta denominator floor" value={state.epsilon} min={1e-12} onChange={epsilon=>{if(epsilon>0&&epsilon<=1e10)patch({epsilon});}}/></>}
    </div><LegendSettings name="Shared scale" value={legends.shared} onChange={v=>updateLegend("shared",v)}/>{compare&&<LegendSettings name="Delta scale" value={legends.delta} onChange={v=>updateLegend("delta",v)}/>}<p className="cfx-caption">Baseline and Option always share one range. Delta is Option − Baseline; default diverging scale is symmetric about zero. Masked grey is unavailable, never zero. Relative delta masks |baseline| ≤ the denominator floor. Manual clipping changes colours only.</p></details>
    {(invalidShared||invalidDelta)&&<p role="alert" className="cfx-error">Legend minimum must be less than maximum. Restore Auto or correct the bounds. Numeric data has not changed.</p>}
    {data&&<p className="cfx-caption">Clipped samples: baseline {clipped(data.a,shared)}, option {clipped(data.b,shared)}, delta {clipped(data.delta,delta)}. Grey cells are holes, outside fluid or unavailable values; near-zero denominators are also masked in percent mode.</p>}
    <details open><summary>Point probing (V / Esc)</summary><CFDPointProbeControls probe={probe} native coordinateUnit="m" unit={data?.unit}/><div className="cfx-slice-controls"><label>Probe interaction<select value={hover?"hover":"pin"} onChange={e=>setHover(e.target.value==="hover")}><option value="pin">Click to pin / replace</option><option value="hover">Hover (80 ms debounce)</option></select></label>{[0,1,2].map(i=><CFDNumber key={i} convert={false} label={`Probe ${"XYZ"[i]} (m)`} value={state.point?.[i]??(i===axis?plane?.coordinate??0:0)} disabled={i===axis||!plane} onChange={n=>{const p:[number,number,number]=state.point?[...state.point]:[0,0,0];p[axis]=plane!.coordinate;p[i]=n;setPoint(p);}}/>)}<button type="button" onClick={()=>{patch({point:null});recordProbe(null,"Probe cleared. Pick another point.");}}>Clear picked point</button></div>
      {state.point&&!point&&<p className="cfx-notice">Saved probe is off the displayed plane and is hidden. Pick a point on this plane.</p>}
      <p className="cfx-caption">V toggles the existing one-point mode; Esc exits. A click replaces the prior point. Drag pans without probing. Arrow keys browse planes; focus the inspector below to move a pinned point instead.</p></details>
    {request&&!data&&!grid.error&&<p role="status">Sampling selected physical plane…</p>}
    <div className={`cfx-slice-grid${compare?" compare":""}${state.focus!=="all"?" focused":""}`}>
      {pane("baseline",`${compare?"Baseline":"Run"} — ${am?.name??"choose run"} · ${quantity} · ${state.axis} ${plane?probeNumber(plane.coordinate):"—"} m · iteration ${plane?.time??"—"}`,invalidShared?null:data?.a)}
      {compare&&pane("option",`Option — ${bm?.name??"choose run"} · ${quantity} · ${state.axis} ${option?probeNumber(option.coordinate):"—"} m · iteration ${option?.time??"—"}`,invalidShared?null:data?.b)}
      {(state.focus==="all"||state.focus==="inspector")&&<section className="cfx-slice-pane cfx-slice-inspector" data-slice-pane="inspector" aria-label="Velocity Probe / Comparison Inspector" tabIndex={0} onKeyDown={e=>{
        if(e.target!==e.currentTarget||!probe.mode||!point||!data?.bounds||!e.key.startsWith("Arrow"))return;e.preventDefault();e.stopPropagation();const p:[number,number,number]=[...point],move=(e.key==="ArrowLeft"||e.key==="ArrowRight")?0:1;p[axes[move]]+=(e.key==="ArrowLeft"||e.key==="ArrowDown"?-1:1)*(data.bounds[move+2]-data.bounds[move])/state.size;setPoint(p);
      }}><header><strong>Velocity Probe / Comparison Inspector</strong><button type="button" onClick={()=>patch({focus:state.focus==="inspector"?"all":"inspector"})}>{state.focus==="inspector"?"Show all panes":"Focus inspector"}</button></header>
      <p>{point?`X ${fmt(point[0])} · Y ${fmt(point[1])} · Z ${fmt(point[2])} m`:"Press V and pick a point, or enter exact physical coordinates."}</p>
      <div className="cfx-slice-readings"><div><strong>Baseline {actualField?.name}</strong><span>{probe.mode?fmt(sample?.baseline.value):"N/A"} {data?.unit}</span></div>{compare&&<><div><strong>Option {actualField?.name}</strong><span>{probe.mode?fmt(sample?.option?.value):"N/A"} {data?.unit}</span></div><div><strong>{data?.definition??"Option − Baseline"}</strong><span>{probe.mode?fmt(sample?.delta):"N/A"} {data?.deltaUnit}</span></div></>}
        {[0,1,2].map(i=><div key={i}><strong>U{"XYZ"[i]} [m/s]</strong><span>Baseline {probe.mode?fmt(sample?.baseline.velocity?.[i]):"N/A"}{compare?` · Option ${probe.mode?fmt(sample?.option?.velocity?.[i]):"N/A"} · ΔU${"XYZ"[i]} ${probe.mode&&quantitative&&velocities?fmt(velocities.b[i]-velocities.a[i]):"N/A"}`:""}</span></div>)}
        <div><strong>|U| [m/s]</strong><span>Baseline {probe.mode&&sample?.baseline.velocity?fmt(Math.hypot(...sample.baseline.velocity as number[])):"N/A"}{compare?` · Option ${probe.mode&&sample?.option?.velocity?fmt(Math.hypot(...sample.option.velocity as number[])):"N/A"}`:""}</span></div>
        {compare&&<><div><strong>Δ|U| = |U_option| − |U_baseline|</strong><span>{probe.mode&&quantitative&&velocities?fmt(Math.hypot(...velocities.b)-Math.hypot(...velocities.a)):"N/A"} m/s</span></div><div><strong>|ΔU| = |U_option − U_baseline|</strong><span>{probe.mode&&quantitative&&velocities?fmt(Math.hypot(...velocities.b.map((v,i)=>v-velocities.a[i]))):"N/A"} m/s</span></div></>}
      </div>{probe.mode&&sample&&<p className="cfx-caption">{sample.baseline.method} · {sample.baseline.reason} {sample.option?.reason}. Output {data?.baseline.time}{data?.option?` / ${data.option.time}`:""}.</p>}
      {compare&&<div aria-label="Delta statistics"><h4>Common valid sample statistics</h4><p>Coverage {fmt(data?.statistics?data.statistics.coverage*100:null)}% of union rectangle · {fmt(data?.statistics?.commonAreaM2)} m²</p><p>Minimum {fmt(data?.statistics?.min)} · maximum {fmt(data?.statistics?.max)} · area-weighted mean {fmt(data?.statistics?.mean)} · RMS {fmt(data?.statistics?.rms)} {data?.deltaUnit}</p><p>{data?.statistics?.valid??0} valid / {data?.statistics?.missing??0} masked grid samples. Uniform cell-centre quadrature; convergence with grid resolution is not guaranteed at boundaries.</p></div>}
      {data?.notes.map(note=><p key={note} className="cfx-caption">{note}</p>)}
      </section>}
      {compare&&pane("delta",`Delta — ${data?.definition??"Option − Baseline"} · ${actualField?.name??"field"} [${data?.deltaUnit??"—"}] · ${state.axis} ${plane?probeNumber(plane.coordinate):"—"} m`,invalidDelta||!quantitative?null:data?.delta)}
    </div>
    <details><summary>Export numeric data &amp; provenance</summary><div className="cfx-equal-actions"><button type="button" disabled={!data?.a} onClick={()=>{if(data)downloadCFD(new Blob([sliceCSV(data)],{type:"text/csv"}),"cfd-slice-option-minus-baseline.csv");}}>Download slice / delta CSV</button><button type="button" disabled={!data} onClick={()=>{if(data)downloadCFD(new Blob([JSON.stringify({data,settings:state,baseline:am,option:bm,probe:probe.mode?picked.data:null},null,2)],{type:"application/json"}),"cfd-slice-provenance.json");}}>Download comparison metadata</button></div><p className="cfx-caption">CSV includes both run/asset IDs, physical sample coordinates, mask, sign, units and method. JSON includes the exact numerical raster, legends and provenance. Plot PNG downloads include displayed title, axes and colour scale.</p></details>
  </section>;
}
