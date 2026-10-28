"use client";

import { useEffect, useRef, useState } from "react";
import type { RailwayCFDWorker } from "@/lib/railwayCFDWorker";
import type { CFDWorkerJob } from "@/lib/climoptixJobs";
import { readResultData } from "@/lib/cfdResultData";
import { useCFDResult } from "./useCFDResult";

export async function physicalPlane(file:File) {
  const loaded=await readResultData(file);
  try {
    if(loaded.volume)throw Error("Choose a sampled surface plane, not a volume.");
    const bounds=loaded.data.getBounds(),spans=[0,1,2].map(i=>bounds[i*2+1]-bounds[i*2]);
    const axis=spans.indexOf(Math.min(...spans));
    if(spans[axis]>Math.max(1,...spans)*1e-7)throw Error("This surface is not an axis-aligned sampled plane.");
    return {axis,coordinate:(bounds[axis*2]+bounds[axis*2+1])/2};
  } finally {loaded.dispose();}
}

/** Select another verified native artifact. Never translate a solved plane mesh. */
export function useCFDPlaneStepper(adapter:RailwayCFDWorker|null,job:CFDWorkerJob|undefined,current:File|undefined,onChoose:(file:File)=>void) {
  const {result}=useCFDResult(adapter,job,!!current);
  const [busy,setBusy]=useState(false),[error,setError]=useState("");
  const pending=useRef<AbortController|null>(null);
  useEffect(()=>()=>pending.current?.abort(),[adapter,job?.id,current]);
  const all=result?.artifacts.filter(a=>a.kind==="vtk")??[];
  const name=(a:typeof all[number])=>a.name?.replace(/[^a-z0-9_.-]/gi,"-")??`${job?.id}-${a.id}.vtk`;
  const match=/slice_([xyz])_(\d+)/i.exec(current?.name??"");
  const stack=all.filter(a=>!match||new RegExp(`slice_${match[1]}_`,"i").test(name(a))).sort((a,b)=>name(a).localeCompare(name(b),undefined,{numeric:true}));
  const index=stack.findIndex(a=>name(a)===current?.name);
  const step=async(direction:-1|1)=>{
    if(!adapter||!job||!current||busy||index<0)return;
    const artifact=stack[index+direction];if(!artifact)return;
    pending.current?.abort();const controller=new AbortController();pending.current=controller;setBusy(true);setError("");
    try {
      const before=await physicalPlane(current),file=await adapter.download(job,artifact,AbortSignal.any([controller.signal,AbortSignal.timeout(120000)])),after=await physicalPlane(file);
      controller.signal.throwIfAborted();
      if(before.axis!==after.axis||direction*(after.coordinate-before.coordinate)<=1e-9)throw Error("No adjacent sampled plane in this direction. Choose a different plane stack; result data has not been moved.");
      onChoose(file);
    }catch(cause){if(!controller.signal.aborted)setError(cause instanceof Error?cause.message:"Cannot load the adjacent plane.");}
    finally{if(pending.current===controller)setBusy(false);}
  };
  return {step,busy,error,previous:index>0&&!busy,next:index>=0&&index<stack.length-1&&!busy};
}
