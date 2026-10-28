"use client";

import { useEffect, useState } from "react";
import { CFDWorkerError, type RailwayCFDWorker } from "@/lib/railwayCFDWorker";
import type { CFDWorkerJob } from "@/lib/climoptixJobs";
import type { SliceData, SliceManifest, SliceRequest } from "@/lib/cfdSlices";

export function useSliceRuns(adapter:RailwayCFDWorker|null,project:string,active:boolean,retry:number) {
  const scope=`${adapter?.namespace}:${project}`;
  const [snapshot,setSnapshot]=useState<{scope:string;runs:CFDWorkerJob[];error:string}|null>(null);
  useEffect(()=>{
    if(!active||!adapter)return;
    const controller=new AbortController();let timer:ReturnType<typeof setTimeout>;
    const read=async()=>{try{const runs=await adapter.list(project,controller.signal);if(!controller.signal.aborted)setSnapshot({scope,runs,error:""});}
      catch(error){if(!controller.signal.aborted)setSnapshot(previous=>({scope,runs:previous?.scope===scope?previous.runs:[],error:error instanceof Error?error.message:"Run history unavailable."}));}
      finally{if(!controller.signal.aborted)timer=setTimeout(()=>void read(),6000);}};
    void read();return()=>{controller.abort();clearTimeout(timer);};
  },[adapter,project,scope,active,retry]);
  return snapshot?.scope===scope?snapshot:{runs:[],error:""};
}

export function useSliceManifest(adapter:RailwayCFDWorker|null,project:string,run:string,active:boolean,retry:number) {
  const key=`${adapter?.namespace}:${project}:${run}`;
  const [snapshot,setSnapshot]=useState<{key:string;data:SliceManifest|null;error:string;unsupported?:boolean}|null>(null);
  useEffect(()=>{
    if(!active||!adapter||!run)return;
    const controller=new AbortController();let timer:ReturnType<typeof setTimeout>,failures=0;
    const read=async()=>{try{const data=await adapter.slices(run,project,controller.signal);if(!controller.signal.aborted){setSnapshot({key,data,error:""});failures=0;}}
      catch(error){if(!controller.signal.aborted){
        failures++;
        if(error instanceof CFDWorkerError&&error.status===404){
          try{await adapter.status(run,controller.signal);if(!controller.signal.aborted)setSnapshot({key,data:null,error:"",unsupported:true});return;}
          catch(cause){if(controller.signal.aborted)return;setSnapshot({key,data:null,error:cause instanceof CFDWorkerError&&cause.status===404?"This simulation's retained results are no longer available. Its worker storage may have expired.":cause instanceof Error?cause.message:"Cannot verify this simulation's results."});}
        }else setSnapshot({key,data:null,error:error instanceof Error?error.message:"Slice inventory unavailable."});
      }}
      finally{if(!controller.signal.aborted)timer=setTimeout(()=>void read(),Math.min(4000*2**failures,30000));}};
    void read();return()=>{controller.abort();clearTimeout(timer);};
  },[adapter,project,run,key,active,retry]);
  return snapshot?.key===key?snapshot:{data:null,error:"",unsupported:false};
}

/** At most one bounded raster per hook; dropped on namespace/selection change.
 * Identity includes run/asset digests, field, component, time bytes and all maths.
 * Stale/aborted work can never be presented under a new selection's label.
 */
export function useSliceData(adapter:RailwayCFDWorker|null,request:SliceRequest|null,active:boolean,retry:number) {
  const serialized=JSON.stringify(request),key=`${adapter?.namespace}:${serialized}`;
  const [snapshot,setSnapshot]=useState<{key:string;data:SliceData|null;error:string}|null>(null);
  useEffect(()=>{
    if(!active||!adapter||serialized==="null")return;
    const controller=new AbortController();
    const timer=setTimeout(()=>{void adapter.sliceData(JSON.parse(serialized),controller.signal).then(data=>{if(!controller.signal.aborted)setSnapshot({key,data,error:""});}).catch(error=>{if(!controller.signal.aborted)setSnapshot({key,data:null,error:error instanceof Error?error.message:"Slice sampling failed."});});},80);
    return()=>{clearTimeout(timer);controller.abort();};
  },[adapter,serialized,key,active,retry]);
  return snapshot?.key===key?snapshot:{data:null,error:""};
}
