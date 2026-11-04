import { useEffect, type RefObject } from "react";
import { helpWindowFor, mergeHelpSteps, parseHelpSteps } from "./windowHelpContent";
import { windowHelpSteps, type WindowHelpStep } from "./windowHelp";
/** Retain service topics in the main window guide without manufacturing extra buttons. */
export function useServiceMenuHelp(root: RefObject<HTMLElement | null>, windowTitle: string) {
  useEffect(() => {
    const panel = root.current;
    if (!panel || /^Help\b/.test(windowTitle) || !/heat|ventilation|insulation|energy|wall layers|floor properties|roof|building/i.test(windowTitle)) return;
    const remembered = new Map<string, WindowHelpStep[]>();
    const bag = document.createElement("span"); bag.hidden = true; bag.dataset.windowHelpTopic = windowTitle; panel.appendChild(bag);
    const decorate = () => {
      for (const target of panel.querySelectorAll<HTMLElement>("summary,label:has(select)")) {
        const title = Array.from(target.childNodes).filter(n => n.nodeType === Node.TEXT_NODE || n instanceof HTMLElement && !["SELECT", "BUTTON"].includes(n.tagName) && !n.hidden).map(n => n.textContent).join(" ").trim().replace(/\s+/g, " ");
        if (!title || helpWindowFor(target) !== panel) continue;
        const topic = `${windowTitle} — ${title}`;
        target.dataset.windowHelpTopic = topic; remembered.set(topic, windowHelpSteps(topic));
      }
      for (const marker of panel.querySelectorAll<HTMLElement>("[data-window-help-steps]")) {
        if (marker === bag || helpWindowFor(marker) !== panel) continue;
        const steps = parseHelpSteps(marker.dataset.windowHelpSteps);
        if (steps) remembered.set(marker.dataset.windowHelpTopic ?? "", steps);
      }
      bag.dataset.windowHelpSteps = JSON.stringify(mergeHelpSteps(...remembered.values()));
    };
    decorate(); const observer = new MutationObserver(decorate); observer.observe(panel, { childList: true, subtree: true, characterData: true });
    return () => { observer.disconnect(); bag.remove(); };
  }, [root, windowTitle]);
}
