"use client";

import type { ReactNode } from "react";
import { createPortal } from "react-dom";
import { FloatingToolbar } from "./FloatingToolbar";

/** A sibling of the setup window, never clipped by its scrolling body. */
export function CFDIndependentWindow({title,children,onClose,className="",wide=false}:{title:string;children:ReactNode;onClose:()=>void;className?:string;wide?:boolean}) {
  if(typeof document==="undefined")return null;
  const workspace=document.querySelector(".cfx-workspace");
  if(!workspace)return null;
  return createPortal(<FloatingToolbar title={title} className={`cfx-independent-window ${className}`} dialog bringToFront
    defaultPosition={{x:40,y:40}} initialSize={{width:wide?1120:800,height:wide?780:600}} maxHeight={900} onClose={onClose}>
    {children}
  </FloatingToolbar>,workspace);
}
