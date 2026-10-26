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
      if (!enabled || !root?.getClientRects().length || event.defaultPrevented) return;
      const owner = root.closest(".floating-toolbar"), target = event.target instanceof Element ? event.target : null;
      if (event.key === "Escape" && mode) {
        event.preventDefault(); event.stopImmediatePropagation(); setChoice({on:false,request}); setReading(null); return;
      }
      if (event.key.toLowerCase() !== "v" || event.repeat || event.altKey || event.ctrlKey || event.metaKey || target instanceof HTMLElement&&target.isContentEditable || target?.closest("input,select,textarea,[role=menu],dialog")) return;
      if (target?.closest(".floating-toolbar") && target.closest(".floating-toolbar") !== owner) return;
      // Do not activate a viewer hidden behind a different independent window.
      const panels = Array.from(root.closest(".cfx-workspace")?.querySelectorAll<HTMLElement>(".floating-toolbar") ?? []).filter(node => node.getClientRects().length);
      if (owner && panels.some(node => node !== owner && Number(getComputedStyle(node).zIndex) > Number(getComputedStyle(owner).zIndex))) return;
      event.preventDefault(); event.stopImmediatePropagation(); setChoice({on:!mode,request}); setReading(null);
    };
    window.addEventListener("keydown", keyboard, true);
    return () => window.removeEventListener("keydown", keyboard, true);
  }, [enabled, mode,request]);
  const current=reading?.request===request&&(reading.key===key||typeof reading.key!=="string"&&typeof key!=="string"&&reading.key.length===key.length&&reading.key.every((value,index)=>value===key[index]));
  return { registerControl, enabled, mode, toggle, pick, reading: mode&&current ? reading : null };
}

export type CFDPointProbeController = ReturnType<typeof useCFDPointProbe>;
export function CFDPointProbeControls({ probe, native = false,coordinateUnit="mm",unit:explicitUnit }: { probe: CFDPointProbeController; native?: boolean;coordinateUnit?:"m"|"mm";unit?:string }) {
  const {registerControl}=probe;
  const sample = probe.reading?.sample, unit = explicitUnit??(native && sample ? ({ U: "m/s", p: "m²/s²", T: "K" } as Record<string, string>)[sample.field] ?? "file units" : "file units (unverified)");
  return <div ref={registerControl} className="cfx-point-probe" data-probe-mode={probe.mode || undefined}>
    <button type="button" aria-pressed={probe.mode} aria-keyshortcuts="V" disabled={!probe.enabled} onClick={probe.toggle} title="Pick the active plane's displayed field. V toggles; Escape exits. Geometry-only, hidden planes and isosurfaces cannot be probed.">{probe.mode ? "Exit point probe (Esc)" : "Probe point value (V)"}</button>
    {probe.mode && <output role="status" aria-label="Picked result value" data-probe-value={sample?.value}>
      {sample ? <><strong>{sample.field}{sample.component ? ` ${sample.component}` : ""} = {probeNumber(sample.value)} {unit}</strong>
        <span>{sample.position.map((value, axis) => `${["X", "Y", "Z"][axis]} ${probeNumber(native&&coordinateUnit==="mm" ? value * 1000 : value)}`).join(" · ")} {native ? coordinateUnit : "(file coordinates; units unverified)"}</span>
        <small>{sample.cell ? "Stored cell value" : "Interpolated point data"} · Click another point to replace · Esc exits</small></> : probe.reading?.message ?? "Click the active plane to read its displayed parameter. Esc exits."}
    </output>}
  </div>;
}
