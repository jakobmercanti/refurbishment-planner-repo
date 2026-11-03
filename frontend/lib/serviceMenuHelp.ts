import { useEffect, type RefObject } from "react";
import { WINDOW_HELP_EVENT } from "../components/WindowHelpButton";
import { collectedHelp, mergeHelpSteps } from "./windowHelpContent";
import { windowHelpSteps, type WindowHelpStep } from "./windowHelp";
/** One guide per outer section; fields and nested sections contribute their topics. */
export function useServiceMenuHelp(root: RefObject<HTMLElement | null>, windowTitle: string) {
  useEffect(() => {
    const panel = root.current;
    if (!panel || /^Help\b/.test(windowTitle) || !/heat|ventilation|insulation|energy|wall layers|floor properties|roof|building/i.test(windowTitle)) return;
    const buttons = new Set<HTMLButtonElement>(), remembered = new Map<string, WindowHelpStep[]>();
    const bag = document.createElement("span"); bag.hidden = true; bag.dataset.windowHelpTopic = windowTitle; panel.appendChild(bag);
    const decorate = () => {
      for (const target of panel.querySelectorAll<HTMLElement>("summary,label:has(select)")) {
        const title = Array.from(target.childNodes).filter(n => n.nodeType === Node.TEXT_NODE || n instanceof HTMLElement && !["SELECT", "BUTTON"].includes(n.tagName) && !n.hidden).map(n => n.textContent).join(" ").trim().replace(/\s+/g, " ");
        if (!title) continue;
        const topic = `${windowTitle} — ${title}`;
        target.dataset.windowHelpTopic = topic; remembered.set(topic, windowHelpSteps(topic));
        const existing = target.querySelector<HTMLButtonElement>(":scope > .service-menu-help");
        const details = target.tagName === "SUMMARY" ? target.parentElement : null;
        if (!details || details.parentElement?.closest("details") || target.hasAttribute("data-no-menu-help")) { existing?.remove(); continue; }
        if (!existing && target.querySelector(".window-help-button")) continue;
        const button = existing ?? document.createElement("button");
        if (!existing) { button.type = "button"; button.className = "window-help-button service-menu-help"; button.textContent = "?"; target.appendChild(button); buttons.add(button); }
        button.title = `How to use ${title}`; button.setAttribute("aria-label", `Help for ${title}`);
        button.onpointerdown = e => e.stopPropagation();
        button.onclick = e => { e.preventDefault(); e.stopPropagation(); window.dispatchEvent(new CustomEvent(WINDOW_HELP_EVENT, { detail: { title: topic, controls: [], steps: collectedHelp(details, topic), opener: button } })); };
      }
      for (const marker of panel.querySelectorAll<HTMLElement>("[data-window-help-steps]")) {
        if (marker === bag) continue;
        try { remembered.set(marker.dataset.windowHelpTopic ?? "", JSON.parse(marker.dataset.windowHelpSteps!)); } catch { /* Ignore malformed external metadata. */ }
      }
      bag.dataset.windowHelpSteps = JSON.stringify(mergeHelpSteps(...remembered.values()));
    };
    decorate(); const observer = new MutationObserver(decorate); observer.observe(panel, { childList: true, subtree: true, characterData: true });
    return () => { observer.disconnect(); buttons.forEach(b => b.remove()); bag.remove(); };
  }, [root, windowTitle]);
}
