"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";

/** Fullscreen keeps the existing canvas, camera and display state mounted. */
export function CFDViewerFrame({children,label,embedded=false}:{children:ReactNode;label:string;embedded?:boolean}) {
  const root=useRef<HTMLDivElement>(null);
  const [expanded,setExpanded]=useState(false),[error,setError]=useState("");
  useEffect(()=>{
    const changed=()=>setExpanded(document.fullscreenElement===root.current);
    document.addEventListener("fullscreenchange",changed);
    return()=>document.removeEventListener("fullscreenchange",changed);
  },[]);
  return <div ref={root} className="cfx-viewer-frame" aria-label={label}>
    {children}
    {!embedded&&<div className="cfx-viewer-bottom-actions cfx-viewer-expand"><button type="button" aria-pressed={expanded} onClick={()=>{
      setError("");
      const operation=expanded?document.exitFullscreen?.():root.current?.requestFullscreen?.();
      if(!operation)setError("Fullscreen is unavailable in this browser. Use the window layout menu to maximise the Results window.");
      void operation?.catch(()=>setError("Your browser could not expand this viewer. Use the window layout menu to maximise the Results window."));
    }}>{expanded?"Restore viewer":"Expand viewer"}</button></div>}
    {error&&<p className="cfx-error" role="alert">{error}</p>}
  </div>;
}
