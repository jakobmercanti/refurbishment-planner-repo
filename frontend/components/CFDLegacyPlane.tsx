"use client";

import { useEffect, useState } from "react";
import type { CFDWorkerJob } from "@/lib/climoptixJobs";
import type { RailwayCFDWorker } from "@/lib/railwayCFDWorker";
import { useCFDResult } from "./useCFDResult";
import { CFDFloatingControls } from "./CFDFloatingControls";
import { useCFDPlaneStepper } from "./useCFDPlaneStepper";
import { CFDResultsViewer } from "./CFDResultsViewer";

/** Older workers retain native planes but cannot supply a comparable delta grid. */
export function CFDLegacyPlane({adapter,job,active}:{adapter:RailwayCFDWorker|null;job?:CFDWorkerJob;active:boolean}) {
  const {result,error,retry}=useCFDResult(adapter,job,active);
  const [selection,setSelection]=useState("");
  const artifact=result?.artifacts.find(item=>item.kind==="vtk"&&item.id===selection)??result?.artifacts.find(item=>item.kind==="vtk");
  const [loaded,setLoaded]=useState<{id:string;file:File}|null>(null),[failure,setFailure]=useState("");
  const [visible,setVisible]=useState(true);
  useEffect(()=>{
    if(!adapter||!job||!artifact||!active||loaded?.id===artifact.id)return;
    const controller=new AbortController();
    void adapter.download(job,artifact,AbortSignal.any([controller.signal,AbortSignal.timeout(120000)])).then(file=>{if(!controller.signal.aborted){setLoaded({id:artifact.id,file});setFailure("");}}).catch(cause=>{if(!controller.signal.aborted)setFailure(cause instanceof Error?cause.message:"Plane download failed.");});
    return()=>controller.abort();
  },[adapter,job,artifact,active,loaded?.id]);
  const file=loaded?.id===artifact?.id?loaded?.file:undefined;
  const stack=useCFDPlaneStepper(adapter,job,file,incoming=>{const id=result?.artifacts.find(a=>a.name===incoming.name||`${job?.id}-${a.id}.vtk`===incoming.name)?.id??"";setLoaded({id,file:incoming});setSelection(id);});
  const selectionControl=<>
    <label>Comparison plane<select aria-label="Comparison plane" value={artifact?.id??""} onChange={event=>{setSelection(event.target.value);setVisible(true);}}><option value="" disabled>Choose a retained plane…</option>{result?.artifacts.filter(item=>item.kind==="vtk").map(item=><option key={item.id} value={item.id}>{item.name??item.id}</option>)}</select></label>
    {error&&<p className="cfx-error" role="alert">{error}<button onClick={retry}>Retry loading comparison</button></p>}{failure&&<p className="cfx-error" role="alert">{failure}</p>}
    {!job&&<p>Choose an Option run to view its retained plane.</p>}{job&&!artifact&&!error&&<p>No retained native planes are available for this run.</p>}
    {artifact&&!file&&!failure&&<p role="status">Loading verified comparison plane…</p>}
    {file&&!visible&&<button onClick={()=>setVisible(true)}>Show comparison plane</button>}</>;
  return <div className="cfx-legacy-plane">
    {(!file||!visible)&&<CFDFloatingControls label="Plane selection">{selectionControl}</CFDFloatingControls>}
    {stack.error&&<p role="alert" className="cfx-error">{stack.error}</p>}
    {file&&visible&&<CFDResultsViewer compact embedded toolbar={selectionControl} onPlaneStep={direction=>void stack.step(direction)} previousPlane={stack.previous} nextPlane={stack.next} file={file} viewMode="2d" provenance={`Authenticated worker job ${job?.id} · p in m²/s², not Pa`} onClose={()=>setVisible(false)} onRemoveFile={()=>setVisible(false)}/>}
  </div>;
}
