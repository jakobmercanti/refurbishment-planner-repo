"use client";

import { useEffect, useRef, useState } from "react";
import { downloadCFD } from "@/lib/climoptix";
import { archiveEntries, archiveFile, postprocessingArchive, type CFDArchiveEntry } from "@/lib/cfdArchive";
import type { CFDWorkerJob } from "@/lib/climoptixJobs";
import type { RailwayCFDWorker, WorkerResult } from "@/lib/railwayCFDWorker";
import { CFDIndependentWindow } from "./CFDIndependentWindow";

const size = (bytes: number) => bytes >= 1024**2 ? `${(bytes/1024**2).toFixed(1)} MB` : `${Math.ceil(bytes/1024)} KB`;
export function CFDResultFiles({ adapter,job,result,onVTK }: { adapter:RailwayCFDWorker;job:CFDWorkerJob;result:WorkerResult;onVTK:(file:File)=>void }) {
  const [busy,setBusy] = useState(""), [error,setError] = useState("");
  const [entries,setEntries] = useState<CFDArchiveEntry[] | null>(null), [folder,setFolder] = useState("");
  const [page,setPage] = useState(0);
  const cache = useRef<Uint8Array<ArrayBuffer> | null>(null), actions = useRef<AbortController | null>(null);
  const locked=useRef(false);
  useEffect(() => { const controller = new AbortController(); actions.current=controller;
    return () => { controller.abort(); cache.current=null; };
  }, [adapter,job.id]);
  const action = async (name:string, work:(signal:AbortSignal)=>Promise<void>) => {
    const controller=actions.current; if (!controller || controller.signal.aborted || locked.current) return;
    locked.current=true;
    setBusy(name);setError("");
    try { await work(AbortSignal.any([controller.signal,AbortSignal.timeout(120000)])); }
    catch(cause) { if (!controller.signal.aborted) setError(cause instanceof Error?cause.message:"Results action failed. Retry without running the solver again."); }
    finally { locked.current=false; if (!controller.signal.aborted) setBusy(""); }
  };
  const native = result.artifacts.find(item=>item.id==="native-case");
  const readArchive = async (signal:AbortSignal) => {
    if (!cache.current) {
      if (!native) throw new Error("The worker did not retain a native case archive for this job.");
      const file=await adapter.download(job,native,signal); signal.throwIfAborted();
      cache.current=new Uint8Array(await file.arrayBuffer()); signal.throwIfAborted();
    }
    return cache.current;
  };
  const descendants=entries?.filter(entry=>entry.name.startsWith(folder))??[];
  const directories=[...new Set(descendants.flatMap(entry=>{const tail=entry.name.slice(folder.length);return tail.includes("/")?[tail.split("/")[0]]:[];}))];
  const files=descendants.filter(entry=>!entry.name.slice(folder.length).includes("/"));
  const planes=result.artifacts.filter(item=>item.kind==="vtk");
  const postprocessing=result.artifacts.find(item=>item.id==="postprocessing");
  const label=(item:WorkerResult["artifacts"][number])=>`${item.name??item.id} · ${size(item.size)}`;
  return <section aria-label="Worker artifacts"><details open className="cfx-result-files"><summary>Online results folder &amp; downloads</summary>
    <p>{result.accepted?"Job acceptance checks passed.":"Diagnostic output only: job acceptance checks did not pass."} Native p is kinematic pressure (m²/s²), not Pa.</p>
    <p className="cfx-caption">Private worker storage · job {job.id}. Downloads are authenticated and SHA-256 checked. {result.expiresAt?`Retained until ${new Date(result.expiresAt*1000).toLocaleString()}.`:"Worker retention applies; download files for long-term storage."}</p>
    <div className="cfx-result-selectors">
      <label>View result in 3D<select aria-label="View result in 3D" disabled={!!busy||!planes.length} value="" onChange={event=>{
        const item=planes.find(item=>item.id===event.target.value);if(!item)return;
        void action(item.name??item.id,async signal=>{const file=await adapter.download(job,item,signal);signal.throwIfAborted();onVTK(file);});
      }}><option value="">{planes.length?"Choose a result plane…":"No result planes retained"}</option>{planes.map(item=><option key={item.id} value={item.id}>{label(item)}</option>)}</select></label>
      <label>Download simulation data<select aria-label="Download simulation data" disabled={!!busy||!result.artifacts.length} value="" onChange={event=>{
        const id=event.target.value;if(!id)return;
        const item=result.artifacts.find(item=>item.id===id);
        if(id==="postprocessing"&&(postprocessing||native))void action("post-processing ZIP",async signal=>{
          const file=postprocessing?await adapter.download(job,postprocessing,signal):postprocessingArchive(await readArchive(signal));
          signal.throwIfAborted();downloadCFD(file,`${job.id}-postprocessing.zip`);
        });
        else if(item)void action(item.name??item.id,async signal=>{const file=await adapter.download(job,item,signal);signal.throwIfAborted();downloadCFD(file,file.name);});
      }}><option value="">Choose data to download…</option>
        <optgroup label="Simulation archives">{native&&<option value={native.id}>Full native case ZIP · {size(native.size)}</option>}{(postprocessing||native)&&<option value="postprocessing">Post-processing ZIP{postprocessing?` · ${size(postprocessing.size)}`:" · from native archive"}</option>}</optgroup>
        <optgroup label="Result files">{result.artifacts.filter(item=>item.id!=="native-case"&&item.id!=="postprocessing").map(item=><option key={item.id} value={item.id}>{label(item)}</option>)}</optgroup>
      </select></label>
    </div>
    <div className="cfx-actions"><button disabled={!!busy||!native} onClick={()=>void action("folder",async signal=>{const bytes=await readArchive(signal);const listed=archiveEntries(bytes);signal.throwIfAborted();setEntries(listed);})}>Open online results folder</button></div>
    {busy&&<p role="status">{busy==="folder"?"Loading verified online folder…":`Loading ${busy}…`} This does not rerun the simulation.</p>}
    {error&&<p role="alert" className="cfx-error">{error}</p>}
    {entries&&<CFDIndependentWindow title="Online simulation folder" onClose={()=>{setEntries(null);setFolder("");setPage(0);}}><section aria-label="Private simulation files">
      <div className="cfx-inline-toolbar"><strong>/{folder}</strong><button disabled={!folder||!!busy} onClick={()=>{setFolder(folder.replace(/[^/]+\/$/,""));setPage(0);}}>Up one folder</button><button disabled={!!busy} onClick={()=>{setEntries(null);cache.current=null;setFolder("");}}>Close folder</button></div>
      <p className="cfx-caption">Private, verified archive from worker storage. Double-click a folder or press Enter to open it. Download files before worker retention expires.</p>
      <table className="cfx-file-explorer" aria-label="Simulation folder contents"><thead><tr><th>Name</th><th>Type</th></tr></thead><tbody>
      {directories.map(directory=><tr key={directory} tabIndex={0} aria-label={`Folder ${directory}`} onDoubleClick={()=>{setFolder(folder+directory+"/");setPage(0);}} onKeyDown={event=>{if(event.key==="Enter"||event.key==="ArrowRight"){event.preventDefault();setFolder(folder+directory+"/");setPage(0);}}}><td>📁 {directory}</td><td>Folder</td></tr>)}
      {!directories.length&&!files.length&&<tr><td colSpan={2}>This folder is empty.</td></tr>}
      </tbody></table>
      {files.slice(page*100,(page+1)*100).map(entry=><div className="cfx-folder-file" key={entry.name}><span>{entry.name.slice(folder.length)} · {size(entry.size)}</span>
        {/\.(vtk|vtp|vti)$/i.test(entry.name)&&entry.size<=25*1024**2&&<button disabled={!!busy} onClick={()=>void action(entry.name,async signal=>{const file=archiveFile(await readArchive(signal),entry.name);signal.throwIfAborted();onVTK(file);})}>View {entry.name.split("/").pop()}</button>}
        <button disabled={!!busy} onClick={()=>void action(entry.name,async signal=>{const file=archiveFile(await readArchive(signal),entry.name);signal.throwIfAborted();downloadCFD(file,file.name);})}>Download {entry.name.split("/").pop()}</button></div>)}
      {files.length>100&&<div className="cfx-actions"><button disabled={!page} onClick={()=>setPage(page-1)}>Previous files</button><span>Page {page+1} of {Math.ceil(files.length/100)}</span><button disabled={(page+1)*100>=files.length} onClick={()=>setPage(page+1)}>Next files</button></div>}
    </section></CFDIndependentWindow>}
  </details></section>;
}
