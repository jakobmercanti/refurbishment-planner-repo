"use client";

import { useEffect, useState } from "react";
import type { CFDWorkerJob } from "@/lib/climoptixJobs";
import { CFDWorkerError, type RailwayCFDWorker, type WorkerResult } from "@/lib/railwayCFDWorker";

/** Read-only, identity-scoped recovery. Retrying never resubmits a simulation. */
export function useCFDResult(adapter: RailwayCFDWorker | null, job?: CFDWorkerJob, enabled=true) {
  const [snapshot,setSnapshot]=useState<{key:string;result:WorkerResult|null;error:string;missing:boolean}|null>(null);
  const [retry,setRetry]=useState(0);
  const id=job?.id, studyId=job?.studyId, clientRevision=job?.clientRevision, phase=job?.phase;
  const key=JSON.stringify([adapter?.namespace,id,studyId,clientRevision,phase]);
  useEffect(()=>{
    if(!enabled||!adapter||!id||!studyId||!clientRevision||!phase||!["Completed","Failed","Cancelled","Stale"].includes(phase))return;
    const controller=new AbortController();let timer:ReturnType<typeof setTimeout>,attempts=0;
    const read=async()=>{
      try{
        const result=await adapter.result({id,studyId,clientRevision,phase,progress:null,message:""},controller.signal);
        if(!controller.signal.aborted)setSnapshot({key,result,error:"",missing:false});
      }catch(cause){
        if(controller.signal.aborted)return;
        const missing=phase!=="Completed"&&cause instanceof CFDWorkerError&&[404,409].includes(cause.status);
        const message=cause instanceof CFDWorkerError&&cause.status===404?"No retained native results were found for this simulation. Worker storage may have expired or the configured worker may have changed. Refresh results, or import a previously downloaded plane.":cause instanceof Error?cause.message:"Native results could not be loaded.";
        setSnapshot({key,result:null,error:missing?"":message,missing});
        if(!missing&&++attempts<5)timer=setTimeout(()=>void read(),Math.min(1000*2**(attempts-1),10000));
      }
    };
    void read();return()=>{controller.abort();clearTimeout(timer);};
  },[adapter,id,studyId,clientRevision,phase,key,retry,enabled]);
  const current=snapshot?.key===key?snapshot:null;
  return {result:current?.result??null,error:current?.error??"",missing:current?.missing??false,retry:()=>setRetry(value=>value+1)};
}
