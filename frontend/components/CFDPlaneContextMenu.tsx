"use client";

import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";

export interface PlaneMenu {file:File;x:number;y:number}
/** This action unloads a plane from the view; the worker artifact is untouched. */
export function CFDPlaneContextMenu({menu,onDelete,onClose}:{menu:PlaneMenu|null;onDelete:(file:File)=>void;onClose:()=>void}) {
  const root=useRef<HTMLDivElement>(null);
  useEffect(()=>{
    if(!menu)return;
    root.current?.querySelector<HTMLButtonElement>("button")?.focus({preventScroll:true});
    const dismiss=(event:Event)=>{if(!root.current?.contains(event.target as Node))onClose();};
    const key=(event:KeyboardEvent)=>{if(event.key==="Escape"){event.preventDefault();event.stopImmediatePropagation();onClose();}};
    document.addEventListener("pointerdown",dismiss,true);document.addEventListener("keydown",key,true);
    window.addEventListener("resize",onClose);
    return()=>{document.removeEventListener("pointerdown",dismiss,true);document.removeEventListener("keydown",key,true);window.removeEventListener("resize",onClose);};
  },[menu,onClose]);
  if(!menu)return null;
  return createPortal(<div ref={root} role="menu" aria-label="Result plane actions" className="cfx-plane-context-menu" style={{left:Math.max(8,Math.min(menu.x,window.innerWidth-200)),top:Math.max(8,Math.min(menu.y,window.innerHeight-72))}}>
    <button type="button" role="menuitem" title="Remove from this view only; saved results are kept" onClick={()=>{onDelete(menu.file);onClose();}}>Delete plane</button>
  </div>,document.fullscreenElement??document.body);
}
