import { useEffect, type RefObject } from "react";
import { collectedHelp, helpLabelText, helpWindowFor, mergeHelpSteps, parseHelpSteps } from "./windowHelpContent";
import { windowHelpSteps, type WindowHelpStep } from "./windowHelp";
/** One contextual guide per main collapsible section; field help stays in its guide. */
export function useServiceMenuHelp(root: RefObject<HTMLElement | null>, windowTitle: string, fromHeader = false) {
  useEffect(() => {
    const panel = fromHeader && root.current ? helpWindowFor(root.current) : root.current;
    if (!panel || !windowTitle || /^Help\b/.test(windowTitle)) return;
    if (fromHeader && panel.matches(".floating-toolbar")) return;
    const remembered = new Map<string, WindowHelpStep[]>();
    const bag = document.createElement("span"); bag.hidden = true; bag.dataset.windowHelpTopic = windowTitle; panel.appendChild(bag);
    const decorate = () => {
      for (const target of panel.querySelectorAll<HTMLElement>("summary,label:has(select)")) {
        const title = helpLabelText(target);
        if (!title || target.closest(".cfx-row-menu") || helpWindowFor(target) !== panel) continue;
        const topic = `${windowTitle} — ${title}`;
        target.dataset.windowHelpTopic = topic; remembered.set(topic, windowHelpSteps(topic));
        const parent = target.parentElement?.parentElement?.closest("details");
        if (target.tagName === "SUMMARY" && (!parent || helpWindowFor(parent) !== panel) &&
          !target.querySelector(".window-help-button:not(.menu-section-help)")) {
          let button = target.querySelector<HTMLButtonElement>(":scope > .menu-section-help");
          if (!button) {
            button = document.createElement("button");
            button.type = "button";
            button.className = "window-help-button menu-section-help";
            button.onpointerdown = event => event.stopPropagation();
            target.appendChild(button);
          }
          button.setAttribute("aria-label", "Help for " + title);
          button.title = "How to use " + title;
          button.onclick = event => {
            event.preventDefault();
            event.stopPropagation();
            const steps = collectedHelp(target.parentElement, topic);
            window.dispatchEvent(new CustomEvent("plannerbuild:window-help", { detail: { title, steps, controls: [], opener: button } }));
          };
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
    return () => {
      observer.disconnect();
      panel.querySelectorAll(".menu-section-help").forEach(button => { if (helpWindowFor(button) === panel) button.remove(); });
      bag.remove();
    };
  }, [root, windowTitle, fromHeader]);
}
