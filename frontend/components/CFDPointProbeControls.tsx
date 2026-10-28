"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { probeNumber, type ResultPointValue } from "@/lib/cfdPointProbe";

export function useCFDPointProbe(enabled: boolean, key: readonly unknown[]|string, request = 0) {
  const control = useRef<HTMLDivElement>(null);
  const registerControl=useCallback((node:HTMLDivElement|null)=>{control.current=node;},[]);
  const [choice, setChoice] = useState({on:false,request:0});
  const [reading, setReading] = useState<{ key: readonly unknown[]|string; request:number; sample: ResultPointValue | null; message: string } | null>(null);
  // An explicit Results-window request enters the mode, even if its inspector
  // was already open. Escape/toggle acknowledges it without a remount or effect.
  const mode = enabled&&(choice.on||choice.request!==request);
  const toggle = () => { setChoice({on:!mode,request}); setReading(null); };
  const pick = useCallback((sample: ResultPointValue | null, message = "No point on the active result plane. Pick another point.") => setReading({ key,request, sample, message }), [key,request]);
  useEffect(() => {
    const keyboard = (event: KeyboardEvent) => {
      const root = control.current;
      const scope=root?.closest("[data-cfx-probe-scope]");
      const visible=root?.checkVisibility({checkVisibilityCSS:true})||Array.from(scope?.querySelectorAll("[data-cfx-probe-surface]")??[]).some(node=>node.checkVisibility({checkVisibilityCSS:true}));
      if (!enabled || !root || !visible || event.defaultPrevented) return;
      const owner = root.closest(".floating-toolbar"), target = event.target instanceof Element ? event.target : null;
      const targetScope=target?.closest("[data-cfx-probe-scope]");
      if(scope&&targetScope&&scope!==targetScope)return;
      if (event.key === "Escape" && mode && !target?.closest("[role=menu]")) {
        event.preventDefault(); event.stopImmediatePropagation(); setChoice({on:false,request}); setReading(null); return;
      }
      if (event.key.toLowerCase() !== "v" || event.repeat || event.altKey || event.ctrlKey || event.metaKey || target instanceof HTMLElement&&target.isContentEditable || target?.closest("input,select,textarea,[role=menu],dialog")) return;
      if (target?.closest(".floating-toolbar") && target.closest(".floating-toolbar") !== owner) return;
      // Do not activate a viewer hidden behind a different independent window.
      const panels = Array.from(root.closest(".cfx-workspace")?.querySelectorAll<HTMLElement>(".floating-toolbar") ?? []).filter(node => node.getClientRects().length);
      if (owner && !document.fullscreenElement?.contains(root) && panels.some(node => node !== owner && Number(getComputedStyle(node).zIndex) > Number(getComputedStyle(owner).zIndex))) return;
      event.preventDefault(); event.stopImmediatePropagation(); setChoice({on:!mode,request}); setReading(null);
    };
    window.addEventListener("keydown", keyboard, true);
    return () => window.removeEventListener("keydown", keyboard, true);
  }, [enabled, mode,request]);
  const current=reading?.request===request&&(reading.key===key||typeof reading.key!=="string"&&typeof key!=="string"&&reading.key.length===key.length&&reading.key.every((value,index)=>value===key[index]));
  return { registerControl, enabled, mode, toggle, pick, reading: mode&&current ? reading : null };
}

export type CFDPointProbeController = ReturnType<typeof useCFDPointProbe>;
export function CFDPointProbeValue({probe,native=false,unit:explicitUnit,anchor}:{probe:CFDPointProbeController;native?:boolean;unit?:string;anchor?:{x:number;y:number}|null}) {
  const sample = probe.reading?.sample, unit = explicitUnit??(native && sample ? ({ U: "m/s", p: "m²/s²", T: "K" } as Record<string, string>)[sample.field] ?? "file units" : "file units (unverified)");
  if(sample&&anchor===null)return null;
  return probe.mode?<output className={`cfx-probe-value${sample&&anchor?" cfx-probe-anchored":""}`} style={sample&&anchor?{left:anchor.x,top:anchor.y}:undefined} role="status" aria-label="Picked result value" data-probe-value={sample?.value} data-probe-position={sample?JSON.stringify(sample.position):undefined}>
    {sample&&anchor&&<i className="cfx-picked-dot" aria-hidden/>}
    {sample?`${sample.field}${sample.component?` ${sample.component}`:""} = ${probeNumber(sample.value)} ${unit}`:probe.reading?.message??"Click the plane to read its value. Esc exits."}
  </output>:null;
}
export function CFDPointProbeControls({ probe }: { probe: CFDPointProbeController }) {
  const {registerControl}=probe;
  return <div ref={registerControl} className="cfx-point-probe" data-probe-mode={probe.mode || undefined}>
    <button type="button" aria-pressed={probe.mode} aria-keyshortcuts="V" disabled={!probe.enabled} onClick={probe.toggle} title="Pick the active plane's displayed field. V toggles; Escape exits. Geometry-only, hidden planes and isosurfaces cannot be probed.">{probe.mode ? "Exit point probe (Esc)" : "Probe point value (V)"}</button>
  </div>;
}
