"use client";
import type { WindowHelpStep } from "@/lib/windowHelp";
import { windowHelpSteps } from "@/lib/windowHelp";
import { createContext, useContext, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { collectedHelp } from "@/lib/windowHelpContent";
import { WindowMaximizeButton } from "./WindowMaximizeButton";
export const WINDOW_HELP_EVENT = "plannerbuild:window-help";
const ParentHelp = createContext<string | null>(null);
export const helpContentKey = (steps: WindowHelpStep[]) => JSON.stringify(steps.map(step => ({ text: step.text, links: step.links })));
export function WindowHelpScope({ title, steps, children }: { title: string; steps?: WindowHelpStep[]; children: ReactNode }) {
  return <ParentHelp.Provider value={helpContentKey(steps ?? windowHelpSteps(title))}>{children}</ParentHelp.Provider>;
}
export function WindowHelpButton({ title, steps, primary = false, section = false }: { title: string; steps?: WindowHelpStep[]; primary?: boolean; section?: boolean }) {
  const parent = useContext(ParentHelp);
  const marker = useRef<HTMLElement>(null);
  const [header, setHeader] = useState(false);
  const [nested, setNested] = useState(false);
  useLayoutEffect(() => {
    const element = marker.current, window = element?.closest(".floating-toolbar,dialog,[role='dialog'],.popup");
    const inHeader = !!element?.closest(".window-header-actions,.popup-titlebar,.modal-header,.dialog-header") || !!(element && window?.querySelector("header,.floating-toolbar-titlebar")?.contains(element));
    if (inHeader) setHeader(true);
    else if (window && !primary && !section) setNested(true);
  }, [parent, primary, section]);
  if ((parent || nested) && !primary && !section && !header) return <span ref={node => { marker.current = node; }} hidden data-window-help-topic={title} data-window-help-steps={JSON.stringify(steps ?? windowHelpSteps(title))} />;
  return <><WindowMaximizeButton title={title} /><button ref={node => { marker.current = node; }} type="button" className="window-help-button" data-window-help-topic={title} aria-label={`Help for ${title}`} title={`How to use ${title}`} onPointerDown={event => event.stopPropagation()} onMouseDown={event => event.stopPropagation()} onDoubleClick={event => event.stopPropagation()} onClick={event => {
    event.preventDefault(); event.stopPropagation();
    const button = event.currentTarget, summary = button.closest("summary");
    const scope = primary || button.closest(".window-header-actions")
      ? button.closest(".floating-toolbar,dialog,[role='dialog'],.popup")
      : button.closest("[data-window-help-owner]") ?? summary?.parentElement ?? button.closest("section,[role='dialog']");
    window.dispatchEvent(new CustomEvent(WINDOW_HELP_EVENT, { detail: { title, controls: [], steps: collectedHelp(scope, title, steps), opener: button } }));
  }}>?</button></>;
}
