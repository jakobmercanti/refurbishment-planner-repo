"use client";
import type { WindowHelpStep } from "@/lib/windowHelp";
import { windowHelpSteps } from "@/lib/windowHelp";
import { createContext, useContext, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { collectedHelp, helpWindowFor } from "@/lib/windowHelpContent";
import { WindowMaximizeButton } from "./WindowMaximizeButton";
import { useServiceMenuHelp } from "@/lib/serviceMenuHelp";
export const WINDOW_HELP_EVENT = "plannerbuild:window-help";
const ParentHelp = createContext(false);
export function WindowHelpScope({ children }: { children: ReactNode }) {
  return <ParentHelp.Provider value={true}>{children}</ParentHelp.Provider>;
}
export function WindowHelpSectionHeader({ title, children }: { title: string; children: ReactNode }) {
  return <div className="window-help-disclosure-header">{children}<WindowHelpButton title={title} steps={windowHelpSteps(title)} section /></div>;
}

export function WindowHelpButton({ title, steps, primary = false, section = false }: { title: string; steps?: WindowHelpStep[]; primary?: boolean; section?: boolean }) {
  const parent = useContext(ParentHelp);
  const marker = useRef<HTMLElement>(null);
  const [header, setHeader] = useState(false);
  const [nested, setNested] = useState(false);
  useServiceMenuHelp(marker, header ? title : "", true);
  useLayoutEffect(() => {
    const element = marker.current, window = element ? helpWindowFor(element) : null;
    const inHeader = !!element?.closest(".window-header-actions,.popup-titlebar,.modal-header,.dialog-header") || !!(element && window?.querySelector("header,.floating-toolbar-titlebar")?.contains(element));
    if (inHeader) setHeader(true);
    else if (window && !primary && !section) setNested(true);
  }, [parent, primary, section]);
  if ((parent || nested) && !primary && !header && !section) return <span ref={node => { marker.current = node; }} hidden data-window-help-topic={title} data-window-help-steps={JSON.stringify(steps ?? windowHelpSteps(title))} />;
  return <>{!section && <WindowMaximizeButton title={title} />}<button ref={node => { marker.current = node; }} type="button" className="window-help-button" data-window-help-topic={title} data-window-help-steps={section ? JSON.stringify(steps) : undefined} aria-label={`Help for ${title}`} title={`How to use ${title}`} onPointerDown={event => event.stopPropagation()} onMouseDown={event => event.stopPropagation()} onDoubleClick={event => event.stopPropagation()} onClick={event => {
    event.preventDefault(); event.stopPropagation();
    const button = event.currentTarget;
    const scope = section ? button.closest(".window-help-disclosure-header")?.parentElement ?? null
      : button.closest("summary,legend")?.parentElement ?? helpWindowFor(button) ?? button.closest("section");
    window.dispatchEvent(new CustomEvent(WINDOW_HELP_EVENT, { detail: { title, controls: [], steps: collectedHelp(scope, title, steps), opener: button } }));
  }}>?</button></>;
}
