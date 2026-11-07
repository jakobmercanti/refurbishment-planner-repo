import { useEffect, type RefObject } from "react";
import { helpWindowFor, mergeHelpSteps, parseHelpSteps } from "./windowHelpContent";
import { windowHelpSteps, type WindowHelpStep } from "./windowHelp";
/** One contextual guide per main collapsible section; field help stays in its guide. */
export function useServiceMenuHelp(root: RefObject<HTMLElement | null>, windowTitle: string) {
  useEffect(() => {
    const panel = root.current;
    if (!panel || /^Help\b/.test(windowTitle)) return;
    const buttons: HTMLButtonElement[] = [];
    const remembered = new Map<string, WindowHelpStep[]>();
    const bag = document.createElement("span"); bag.hidden = true; bag.dataset.windowHelpTopic = windowTitle; panel.appendChild(bag);
    const decorate = () => {
      for (const target of panel.querySelectorAll<HTMLElement>("summary,label:has(select)")) {
        const title = Array.from(target.childNodes).filter(n => n.nodeType === Node.TEXT_NODE || n instanceof HTMLElement && !["SELECT", "BUTTON"].includes(n.tagName) && !n.hidden).map(n => n.textContent).join(" ").trim().replace(/\s+/g, " ");
        if (!title || helpWindowFor(target) !== panel) continue;
        const topic = `${windowTitle} — ${title}`;
        target.dataset.windowHelpTopic = topic; remembered.set(topic, windowHelpSteps(topic));
        const parent = target.parentElement?.parentElement?.closest("details");
        if (target.tagName === "SUMMARY" && !target.closest(".cfx-row-menu") && (!parent || helpWindowFor(parent) !== panel) && !target.querySelector(".window-help-button")) {
          const button = document.createElement("button");
          button.type = "button";
          button.className = "window-help-button menu-section-help";
          button.setAttribute("aria-label", "Help for " + title);
          button.title = "How to use " + title;
          button.onpointerdown = event => event.stopPropagation();
          button.onclick = event => {event.preventDefault();event.stopPropagation();window.dispatchEvent(new CustomEvent("plannerbuild:window-help",{detail:{title,steps:windowHelpSteps(topic),controls:[],opener:button}}));};
          target.appendChild(button);buttons.push(button);
        }
      }
      for (const marker of panel.querySelectorAll<HTMLElement>("[data-window-help-steps]")) {
        if (marker === bag || helpWindowFor(marker) !== panel) continue;
        const steps = parseHelpSteps(marker.dataset.windowHelpSteps);
        if (steps) remembered.set(marker.dataset.windowHelpTopic ?? "", steps);
      }
      bag.dataset.windowHelpSteps = JSON.stringify(mergeHelpSteps(...remembered.values()));
    };
    decorate(); const observer = new MutationObserver(decorate); observer.observe(panel, { childList: true, subtree: true, characterData: true });
    return () => { observer.disconnect();buttons.forEach(button=>button.remove()); bag.remove(); };
  }, [root, windowTitle]);
}
