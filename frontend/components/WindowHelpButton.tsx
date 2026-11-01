"use client";
import type { WindowHelpStep } from "@/lib/windowHelp";
import { windowHelpSteps } from "@/lib/windowHelp";
import { createContext, useContext, type ReactNode } from "react";
import { WindowMaximizeButton } from "./WindowMaximizeButton";
export const WINDOW_HELP_EVENT = "plannerbuild:window-help";
const ParentHelp = createContext<string | null>(null);
export const helpContentKey = (steps: WindowHelpStep[]) => JSON.stringify(steps.map(step => ({ text: step.text, links: step.links })));
export function WindowHelpScope({ title, steps, children }: { title: string; steps?: WindowHelpStep[]; children: ReactNode }) {
  return <ParentHelp.Provider value={helpContentKey(steps ?? windowHelpSteps(title))}>{children}</ParentHelp.Provider>;
}
export function WindowHelpButton({ title, steps }: { title: string; steps?: WindowHelpStep[] }) {
  const parent = useContext(ParentHelp);
  if (parent === helpContentKey(steps ?? windowHelpSteps(title))) return null;
  return <><WindowMaximizeButton title={title} /><button type="button" className="window-help-button" aria-label={`Help for ${title}`} title={`How to use ${title}`} onPointerDown={event => event.stopPropagation()} onMouseDown={event => event.stopPropagation()} onDoubleClick={event => event.stopPropagation()} onClick={event => {
    event.preventDefault(); event.stopPropagation();
    const section = event.currentTarget.closest("section, [role='dialog']");
    const controls = section ? Array.from(section.querySelectorAll("button:not(.window-help-button):not(.floating-toolbar-resize), label")).map(item => item.textContent?.trim() ?? "").filter(Boolean).slice(0, 18) : [];
    window.dispatchEvent(new CustomEvent(WINDOW_HELP_EVENT, { detail: { title, controls, steps, opener: event.currentTarget } }));
  }}>?</button></>;
}
