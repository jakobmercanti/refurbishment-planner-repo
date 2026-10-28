"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { CFDReport } from "@/lib/climoptix";
import type { CFDWorkerJob } from "@/lib/climoptixJobs";
import type { RailwayCFDWorker } from "@/lib/railwayCFDWorker";
import { useCFDResult } from "./useCFDResult";
import { CFDResultFiles } from "./CFDResultFiles";
import { ClimoptixVTKViewer } from "./ClimoptixVTKViewer";
import { CFDCollapseAll } from "./CFDCollapseAll";
import { useCFDPlaneStepper } from "./useCFDPlaneStepper";
import { CFD2DSlices } from "./CFD2DSlices";

export function ClimoptixResults({adapter,job,name,older,report,initialFile,initialProvenance,onClose,onScene,sceneFiles=[],sceneError,onUnloadScene,active=true,projectId}:{
  adapter:RailwayCFDWorker|null;job?:CFDWorkerJob;name:string;older:boolean;report:CFDReport|null;initialFile?:File;initialProvenance?:string;onClose:()=>void;onScene?:(file:File)=>void;sceneFiles?:File[];sceneError?:string;onUnloadScene?:(file?:File)=>void;active?:boolean;projectId:string;
}){
  const [subview,setSubview]=useState<"summary"|"slices">("summary");
  const {result,error,missing,retry}=useCFDResult(adapter,job,active);
  const [files,setFiles]=useState<{file:File;verified:boolean}[]>(()=>initialFile?[{file:initialFile,verified:!!initialProvenance?.startsWith("Authenticated worker job")}]:[]);
  // Downloads may finish after a layer was removed or imported. Always merge
  // with the latest layer collection, never the render that started the request.
  const currentFiles=useRef(files);
  const loadsGeneration=useRef(0),loadGeneration=loadsGeneration.current;
  const removedAt=useRef(new Map<string,number>());
  const clearedAt=useRef(0);
  const replaceFiles=useCallback((next:typeof files)=>{currentFiles.current=next;setFiles(next);},[]);
  const [fileError,setFileError]=useState("");
  const [inspectorOpen,setInspectorOpen]=useState(!!initialFile),[plane,setPlane]=useState("");
  const closeInspector=()=>setInspectorOpen(false);
  const autoOpened=useRef(false);
  const [sceneSelection,setSceneSelection]=useState("");
  const [planeBusy,setPlaneBusy]=useState(false);
  const planeRequest=useRef<AbortController|null>(null);
  useEffect(()=>()=>planeRequest.current?.abort(),[adapter,job?.id]);
  const add=useCallback((requested:File[],verified:boolean,started=loadsGeneration.current)=>{
    if(started<clearedAt.current)return;
    const incoming=requested.filter(file=>(removedAt.current.get(file.name)??-1)<=started);
    if(!incoming.length)return;
    const names=new Set(incoming.map(file=>file.name)),next=[...currentFiles.current.filter(item=>!names.has(item.file.name)),...incoming.map(file=>({file,verified}))];
    if(next.length>8||next.reduce((sum,item)=>sum+item.file.size,0)>64*1024**2){setFileError("Load at most eight layers totalling 64 MB. Remove a layer before adding more.");return;}
    setFileError("");replaceFiles(next);setPlane(incoming[0]?.name??"");setInspectorOpen(true);
  },[replaceFiles]);
  const loadPlane=useCallback((id:string,automatic=false)=>{
    const artifact=result?.artifacts.find(item=>item.id===id&&item.kind==="vtk");if(!artifact||!adapter||!job)return;
    planeRequest.current?.abort();const controller=new AbortController(),started=loadsGeneration.current;planeRequest.current=controller;setPlaneBusy(true);setFileError("");
    void adapter.download(job,artifact,AbortSignal.any([controller.signal,AbortSignal.timeout(120000)])).then(file=>{if(!controller.signal.aborted&&(!automatic||!currentFiles.current.length))add([file],true,started);}).catch(cause=>{if(!controller.signal.aborted)setFileError(cause instanceof Error?cause.message:"Plane download failed.");}).finally(()=>{if(!controller.signal.aborted)setPlaneBusy(false);});
  },[adapter,job,result,add]);
  useEffect(()=>{
    if(!active||autoOpened.current||initialFile||!result)return;
    const first=result.artifacts.find(item=>item.kind==="vtk");if(!first)return;
    const timer=setTimeout(()=>{autoOpened.current=true;if(!currentFiles.current.length)loadPlane(first.id,true);},0);
    return()=>clearTimeout(timer);
  },[active,initialFile,result,loadPlane]);
  const primary=files.find(item=>item.file.name===plane)??files[0];
  const stack=useCFDPlaneStepper(adapter,job,primary?.verified?primary.file:undefined,file=>{replaceFiles(currentFiles.current.filter(item=>item!==primary));add([file],true);});
  const canOverlay=!!(primary?.verified&&report&&result&&!older&&result.sourceHash===report.validation.sourceHash);
  const provenance=primary&&!primary.verified?"External file layers · simulation provenance and physical units unverified":
    job?`Authenticated worker job ${job.id} · pinned revision ${job.clientRevision.slice(0,12)} · p in m²/s², not Pa${older?" · older setup":""}`:initialProvenance;
  const selectedScene=sceneFiles.find(file=>file.name===sceneSelection)??sceneFiles[0];
  const removePlane=(file?:File)=>{
    loadsGeneration.current++;
    if(file)removedAt.current.set(file.name,loadsGeneration.current);
    else{clearedAt.current=loadsGeneration.current;removedAt.current.clear();planeRequest.current?.abort();setPlaneBusy(false);}
    const next=file?currentFiles.current.filter(item=>item.file!==file):[];
    replaceFiles(next);setPlane(current=>next.some(item=>item.file.name===current)?current:next[0]?.file.name??"");setFileError("");
    if(!next.length)closeInspector();
    if(file&&files.find(item=>item.file===file)?.verified)onUnloadScene?.(file);
  };
  const planeSelection=<label className="cfx-inspector-plane">Plane to inspect<select aria-label="Plane to inspect" disabled={planeBusy||stack.busy} value={primary?.file.name??""} onChange={event=>{const value=event.target.value;if(value.startsWith("artifact:"))loadPlane(value.slice(9));else{setPlane(value);setInspectorOpen(true);}}}><option value="" disabled>Choose a plane…</option>{files.map(item=><option key={item.file.name} value={item.file.name}>{item.file.name.replace(`${job?.id}-`,"")}</option>)}{result&&<optgroup label="Verified worker planes">{result.artifacts.filter(item=>item.kind==="vtk").map(item=><option key={item.id} value={`artifact:${item.id}`}>{item.name??item.id}</option>)}</optgroup>}</select></label>;
  const planeViewer=(embedded=false)=>primary&&inspectorOpen?<ClimoptixVTKViewer compact embedded={embedded} file={primary.file} provenance={provenance} viewMode="2d" onClose={closeInspector} onRemoveFile={removePlane} toolbar={<>{planeSelection}{fileError&&<p className="cfx-error" role="alert">{fileError}</p>}{stack.error&&<p className="cfx-error" role="alert">{stack.error}</p>}</>} onPlaneStep={direction=>void stack.step(direction)} previousPlane={stack.previous} nextPlane={stack.next}/>:<div className="cfx-notice">{planeSelection}<button disabled={!primary} onClick={()=>setInspectorOpen(true)}>Show plane viewer</button></div>;
  return <section className="cfx-results" data-cfx-collapse-root aria-label="Simulation results and downloads">
    <div className="cfx-inline-toolbar"><h3>Results · {name}</h3><CFDCollapseAll/></div>
    <div className="cfx-segments cfx-results-tabs" role="tablist" aria-label="Results views" onKeyDown={event=>{
      if(!["ArrowLeft","ArrowRight","Home","End"].includes(event.key))return;
      event.preventDefault();const next=event.key==="Home"?"summary":event.key==="End"?"slices":subview==="summary"?"slices":"summary";setSubview(next);event.currentTarget.querySelector<HTMLButtonElement>(`[data-view=${next}]`)?.focus();
    }}>{([['summary','Summary & 3D'],['slices','2D Slices']] as const).map(([id,label])=><button key={id} id={`results-tab-${id}`} data-view={id} type="button" role="tab" aria-controls={`results-panel-${id}`} tabIndex={subview===id?0:-1} aria-selected={subview===id} onClick={()=>setSubview(id)}>{label}</button>)}</div>
    {subview==="slices"&&error&&<details open><summary>Result retrieval status</summary><div role="alert" className="cfx-error">Native result retrieval failed: {error}<button onClick={retry}>Retry loading results</button></div></details>}
    {subview==="slices"&&<div id="results-panel-slices" role="tabpanel" aria-labelledby="results-tab-slices"><CFD2DSlices key={`${adapter?.namespace}:${projectId}:${job?.id??"none"}`} adapter={adapter} projectId={projectId} currentJob={job} active={active} legacyViewer={planeViewer} forceNative={!!primary&&!primary.verified}/></div>}
    <div id="results-panel-summary" role="tabpanel" aria-labelledby="results-tab-summary" hidden={subview!=="summary"}>
    {(older||error)&&<details open><summary>Result status</summary>{older&&<p className="cfx-notice">This job belongs to an older setup. Its results remain pinned to the submitted geometry/configuration; current building overlays are disabled.</p>}
    {error&&<div role="alert" className="cfx-error">Native result retrieval failed: {error}<button onClick={retry}>Retry loading results</button></div>}</details>}
    {result&&adapter&&job?<CFDResultFiles key={job.id} adapter={adapter} job={job} result={result} onVTK={file=>{add([file],true,loadGeneration);if(!older&&report&&result.sourceHash===report.validation.sourceHash)onScene?.(file);}}/>:
      <details open><summary>Online results folder</summary><p>{job?missing?"No native result manifest was retained for this job.":"Results are available after the worker finishes. You can return to Monitor to follow its current phase.":"Run a simulation to create its private online folder and verified post-processing downloads. You can also import an existing result below."}</p></details>}
    <details open={!files.length}><summary>Cached result layers · {files.length} loaded</summary>
      <label className="cfx-file">Import surface, plane or scalar volume<input type="file" multiple accept=".vtk,.vtp,.vti" aria-label="Import result layers" onChange={event=>{add(Array.from(event.target.files??[]),false);setSubview("slices");event.target.value="";}}/></label>
      <p className="cfx-caption">ASCII .vtk/.vtp surfaces or planes; .vti structured scalar volumes. Up to 25 MB per file, eight layers / 64 MB total. Never changes simulation inputs.</p>
      <div className="cfx-plane-management"><label>Delete result plane<select aria-label="Delete result plane" value="" disabled={!files.length} onChange={event=>{const item=currentFiles.current.find(item=>item.file.name===event.target.value);if(item)removePlane(item.file);}}><option value="">Choose a plane to remove from the view…</option>{files.map(item=><option key={item.file.name} value={item.file.name}>{item.file.name}{item.verified?" · verified":" · external"}</option>)}</select></label>
      <button disabled={!files.length&&!planeBusy} onClick={()=>removePlane()}>Unload all result layers</button></div>
      <p className="cfx-caption">You can also right-click a plane in the viewer and choose Delete plane. Saved worker files are never deleted.</p>
      {fileError&&<p role="alert" className="cfx-error">{fileError}</p>}
    </details>
    <details><summary>Planes loaded in building 3D · {sceneFiles.length}</summary><label>Loaded plane<select aria-label="Planes loaded in building 3D" value={selectedScene?.name??""} onChange={event=>setSceneSelection(event.target.value)}><option value="" disabled>No loaded planes</option>{sceneFiles.map(file=><option key={file.name} value={file.name}>{file.name.replace(`${job?.id}-`,"")}</option>)}</select></label><div className="cfx-equal-actions"><button disabled={!selectedScene} onClick={()=>onUnloadScene?.(selectedScene)}>Unload selected 3D plane</button><button disabled={!sceneFiles.length} onClick={()=>onUnloadScene?.()}>Unload all 3D planes</button></div></details>
    <details open><summary>Main 3D viewer</summary>{planeSelection}<div className="cfx-inline-toolbar"><button disabled={!canOverlay||!onScene} onClick={()=>{if(primary)onScene?.(primary.file);}}>Load selected plane into building 3D</button><button onClick={()=>setSubview("slices")}>Inspect in 2D</button><button onClick={onClose}>Back to geometry</button></div>{sceneError&&<p role="alert" className="cfx-error">{sceneError}</p>}{fileError&&<p role="alert" className="cfx-error">{fileError}</p>}</details>
    </div>
  </section>;
}
