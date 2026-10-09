"use client";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { FloatingToolbar } from "./FloatingToolbar";
import { WINDOW_HELP_EVENT } from "./WindowHelpButton";
import { windowHelpSteps } from "@/lib/windowHelp";
import { useCompactWorkspace } from "@/lib/useCompactWorkspace";

interface HelpRequest { title: string; controls: string[]; opener: HTMLButtonElement }
export function WindowHelpHost() {
  const compact = useCompactWorkspace();
  const [request, setRequest] = useState<HelpRequest | null>(null);
  const container = useRef<HTMLDivElement>(null);
  const activeRequest = useRef<HelpRequest | null>(null);
  useEffect(() => {
    const open = (event: Event) => { activeRequest.current = (event as CustomEvent<HelpRequest>).detail; setRequest(activeRequest.current); };
    const key = (event: KeyboardEvent) => {
      if (!activeRequest.current) return;
      if (event.key === "Tab") {
        const controls = Array.from(container.current?.querySelectorAll<HTMLElement>('button:not([disabled]),summary,a[href],input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex="0"]') ?? []).filter(element => element.getClientRects().length > 0);
        if (!controls.length) return;
        event.preventDefault(); event.stopImmediatePropagation();
        const index = controls.indexOf(document.activeElement as HTMLElement);
        controls[(index + (event.shiftKey ? -1 : 1) + controls.length) % controls.length].focus();
        return;
      }
      if (event.key !== "Escape") return;
      event.preventDefault(); event.stopImmediatePropagation();
      activeRequest.current.opener?.focus(); activeRequest.current = null; setRequest(null);
    };
    window.addEventListener(WINDOW_HELP_EVENT, open);
    window.addEventListener("keydown", key, true);
    return () => { window.removeEventListener(WINDOW_HELP_EVENT, open); window.removeEventListener("keydown", key, true); };
  }, []);
  useEffect(() => {
    if (!request) return;
    const frame = requestAnimationFrame(() => container.current?.querySelector<HTMLButtonElement>(".floating-toolbar-close")?.focus());
    return () => cancelAnimationFrame(frame);
  }, [request]);
  if (!request) return null;
  return createPortal(<div ref={container} className={`window-help-host ${compact ? "compact-workspace" : ""}`}><FloatingToolbar key={request.title} title={`Help — ${request.title}`} help={false} defaultPosition={{ x: 70, y: 80 }} initialSize={{ width: 540 }} maxHeight={650} bringToFront onClose={() => { activeRequest.current = null; setRequest(null); request.opener?.focus(); }}><article className="window-help-content" aria-label={`Help for ${request.title}`}>
    {windowHelpSteps(request.title).map(step => <section key={step.heading}><h3>{step.heading}</h3><p>{step.text}</p></section>)}
    {request.controls.length > 0 && <details><summary>Controls in this window</summary><ul>{[...new Set(request.controls)].map(control => <li key={control}>{control}</li>)}</ul></details>}
    <p>Drag the header to move this help window; drag an edge to resize. Close it or press Escape to return to the original window.</p>
  </article></FloatingToolbar></div>, request.opener.closest("dialog") ?? document.body);
}
