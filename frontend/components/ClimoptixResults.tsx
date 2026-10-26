"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { CFDReport } from "@/lib/climoptix";
import type { CFDWorkerJob } from "@/lib/climoptixJobs";
import type { RailwayCFDWorker } from "@/lib/railwayCFDWorker";
import { useCFDResult } from "./useCFDResult";
import { CFDResultFiles } from "./CFDResultFiles";
import { ClimoptixVTKViewer } from "./ClimoptixVTKViewer";
import { CFDCollapseAll } from "./CFDCollapseAll";
import type { ResultContext } from "./CFDResultsViewer";
import { CFDIndependentWindow } from "./CFDIndependentWindow";

export function ClimoptixResults({adapter,job,name,older,report,initialFile,initialProvenance,onClose,onScene,active=true}:{
  adapter:RailwayCFDWorker|null;job?:CFDWorkerJob;name:string;older:boolean;report:CFDReport|null;initialFile?:File;initialProvenance?:string;onClose:()=>void;onScene?:(file:File)=>void;active?:boolean;
}){
  const {result,error,missing,retry}=useCFDResult(adapter,job,active);
  const [files,setFiles]=useState<{file:File;verified:boolean}[]>(()=>initialFile?[{file:initialFile,verified:!!initialProvenance?.startsWith("Authenticated worker job")}]:[]);
  // Downloads may finish after a layer was removed or imported. Always merge
  // with the latest layer collection, never the render that started the request.
  const currentFiles=useRef(files);
  const replaceFiles=(next:typeof files)=>{currentFiles.current=next;setFiles(next);};
  const [fileError,setFileError]=useState("");
  const [inspectorOpen,setInspectorOpen]=useState(!!initialFile),[plane,setPlane]=useState("");
  const [planeBusy,setPlaneBusy]=useState(false);
  const planeRequest=useRef<AbortController|null>(null);
  useEffect(()=>()=>planeRequest.current?.abort(),[adapter,job?.id]);
  const add=(incoming:File[],verified:boolean)=>{
    const names=new Set(incoming.map(file=>file.name)),next=[...currentFiles.current.filter(item=>!names.has(item.file.name)),...incoming.map(file=>({file,verified}))];
    if(next.length>8||next.reduce((sum,item)=>sum+item.file.size,0)>64*1024**2){setFileError("Load at most eight layers totalling 64 MB. Remove a layer before adding more.");return;}
    setFileError("");replaceFiles(next);setPlane(incoming[0]?.name??"");setInspectorOpen(true);
  };
  const primary=files.find(item=>item.file.name===plane)??files[0];
  const additional=useMemo(()=>files.filter(item=>item!==primary).map(item=>item.file),[files,primary]);
  const context=useMemo(()=>{
    if(!report||!result||older||result.sourceHash!==report.validation.sourceHash||!files.length||files.some(item=>!item.verified))return undefined;
    const patches=new Map(report.patches.map(patch=>[patch.id,patch])), grouped=new Map<string,ResultContext>();
    report.surface.triangles.forEach((triangle,index)=>{
      const patchId=report.surface.trianglePatches[index],patch=patches.get(patchId);if(!patch)return;
      const id=patch.kind==="object"?`object:${patch.sourceId}`:patchId;
      const object=grouped.get(id)??{id,name:patch.kind==="object"?report.objects.find(object=>object.id===patch.sourceId)?.name??patch.label??patch.sourceId:patch.label??`${patch.kind} · ${patch.sourceId}`,points:[]};
      triangle.forEach(vertex=>object.points.push(...report.surface.verticesMm[vertex].map(mm=>mm/1000)));grouped.set(id,object);
    });
    return [...grouped.values()].slice(0,100);
  },[report,result,older,files]);
  const provenance=files.some(item=>!item.verified)?"External file layers · simulation provenance and physical units unverified":
    job?`Authenticated worker job ${job.id} · pinned revision ${job.clientRevision.slice(0,12)} · p in m²/s², not Pa${older?" · older setup":""}`:initialProvenance;
  return <section className="cfx-results" data-cfx-collapse-root aria-label="Simulation results and downloads">
    <div className="cfx-inline-toolbar"><h3>Results · {name}</h3><CFDCollapseAll/></div>
    {older&&<p className="cfx-notice">This job belongs to an older setup. Its results remain pinned to the submitted geometry/configuration; current building overlays are disabled.</p>}
    {error&&<div role="alert" className="cfx-error">Native result retrieval failed: {error}<button onClick={retry}>Retry loading results</button></div>}
    {result&&adapter&&job?<CFDResultFiles key={job.id} adapter={adapter} job={job} result={result} onVTK={file=>add([file],true)}/>:
      <details open><summary>Online results folder</summary><p>{job?missing?"No native result manifest was retained for this job.":"Results are available after the worker finishes. You can return to Monitor to follow its current phase.":"Run a simulation to create its private online folder and verified post-processing downloads. You can also import an existing result below."}</p></details>}
    <details open={!files.length}><summary>3D result layers · {files.length} loaded</summary>
      <label className="cfx-file">Import surface, plane or scalar volume<input type="file" multiple accept=".vtk,.vtp,.vti" aria-label="Import result layers" onChange={event=>{add(Array.from(event.target.files??[]),false);event.target.value="";}}/></label>
      <p className="cfx-caption">ASCII .vtk/.vtp surfaces or planes; .vti structured scalar volumes. Up to 25 MB per file, eight layers / 64 MB total. Never changes simulation inputs.</p>
      {files.map(item=><div className="cfx-folder-file" key={item.file.name}><span>{item.file.name}{item.verified?" · verified job artifact":" · external"}</span><button onClick={()=>replaceFiles(currentFiles.current.filter(current=>current.file!==item.file))}>Remove layer {item.file.name}</button></div>)}
      {fileError&&<p role="alert" className="cfx-error">{fileError}</p>}
    </details>
    <div className="cfx-equal-actions"><button className="cfx-primary" disabled={!files.length} onClick={()=>setInspectorOpen(true)}>Open plane inspector</button>
      <button disabled={!primary?.verified||older||!context||!onScene} title={older?"Older setup: do not overlay on changed building geometry":!primary?.verified?"Import verified worker data before overlaying the measured building":undefined} onClick={()=>{if(primary){setInspectorOpen(false);onScene?.(primary.file);}}}>Load selected plane into building 3D</button></div>
    {primary&&inspectorOpen&&<CFDIndependentWindow title="Result plane inspector" wide className="cfx-result-inspector" onClose={()=>setInspectorOpen(false)}>
      <label className="cfx-inspector-plane">Plane to inspect<select aria-label="Plane to inspect" disabled={planeBusy} value={primary.file.name} onChange={event=>{
        const value=event.target.value;
        if(!value.startsWith("artifact:")){setPlane(value);return;}
        const artifact=result?.artifacts.find(item=>item.id===value.slice(9)&&item.kind==="vtk");if(!artifact||!adapter||!job)return;
        planeRequest.current?.abort();const controller=new AbortController();planeRequest.current=controller;setPlaneBusy(true);
        void adapter.download(job,artifact,AbortSignal.any([controller.signal,AbortSignal.timeout(120000)])).then(file=>{if(!controller.signal.aborted)add([file],true);}).catch(cause=>{if(!controller.signal.aborted)setFileError(cause instanceof Error?cause.message:"Plane download failed.");}).finally(()=>{if(!controller.signal.aborted)setPlaneBusy(false);});
      }}>{files.map(item=><option key={item.file.name} value={item.file.name}>{item.file.name}</option>)}{result&&<optgroup label="Verified worker planes">{result.artifacts.filter(item=>item.kind==="vtk").map(item=><option key={item.id} value={`artifact:${item.id}`}>{item.name??item.id}</option>)}</optgroup>}</select></label>
      {planeBusy&&<p role="status">Loading verified plane…</p>}{fileError&&<p role="alert" className="cfx-error">{fileError}</p>}
      <button disabled={!primary.verified||older||!context||!onScene} onClick={()=>{setInspectorOpen(false);onScene?.(primary.file);}}>Load this plane into building 3D</button>
      <ClimoptixVTKViewer file={primary.file} additionalFiles={additional} context={context} provenance={provenance} onClose={()=>setInspectorOpen(false)}/>
    </CFDIndependentWindow>}
    {!files[0]&&
      <p className="cfx-notice">Choose View beside an online plane, or import data to inspect fields, legends, slice positions and scalar isosurfaces. No results are invented from preparation geometry.</p>}
    <button onClick={onClose}>Back to geometry</button>
  </section>;
}
