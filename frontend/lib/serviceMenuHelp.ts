import type { RefObject } from "react";
import { useEffect } from "react";
import { WINDOW_HELP_EVENT } from "../components/WindowHelpButton";
import { helpContentKey } from "../components/WindowHelpButton";
import { windowHelpSteps } from "./windowHelp";
/** Decorate every dynamic service accordion/dropdown without putting help in its toggle action. */
export function useServiceMenuHelp(root: RefObject<HTMLElement | null>, windowTitle: string) {
  useEffect(() => {
    const panel = root.current;
    // Electrical sections currently share a general guide; keep only the main
    // window's button rather than manufacturing unrelated contextual help.
    if (!panel || /^Help\b/.test(windowTitle) || /electrical|lighting/i.test(windowTitle) || !/heat|insulation|energy|wall layers|floor properties|roof|building/i.test(windowTitle)) return;
    const buttons = new Set<HTMLButtonElement>();
    const decorate = () => {
      const targets = [...panel.querySelectorAll<HTMLElement>("summary,label:has(select)")];
      const titleFor = (target: HTMLElement) => Array.from(target.childNodes).filter(n=>n.nodeType===Node.TEXT_NODE || n instanceof HTMLElement && n.tagName !== "SELECT" && !n.classList.contains("window-help-button")).map(n=>n.textContent).join(" ").trim().replace(/\s+/g," ");
      const contentCounts = new Map<string, number>();
      for (const target of targets) {
        const title = titleFor(target);
        if (!title) continue;
        const key = helpContentKey(windowHelpSteps(`${windowTitle} — ${title}`));
        contentCounts.set(key, (contentCounts.get(key) ?? 0) + 1);
      }
      for (const target of targets) {
        const existing = target.querySelector<HTMLButtonElement>(".service-menu-help");
        if (target.hasAttribute("data-no-menu-help")) { existing?.remove(); continue; }
        if (!existing && target.querySelector(".window-help-button")) continue;
        const title = titleFor(target);
        if (!title) continue;
        // A repeated parent guide adds clutter, not contextual help.
        const contentKey = helpContentKey(windowHelpSteps(`${windowTitle} — ${title}`));
        if ((contentCounts.get(contentKey) ?? 0) > 1 || contentKey === helpContentKey(windowHelpSteps(windowTitle))) {
          existing?.remove();
          continue;
        }
        const button = existing ?? document.createElement("button");
        if (!existing) { button.type = "button"; button.className = "window-help-button service-menu-help"; button.textContent = "?"; target.appendChild(button); buttons.add(button); }
        button.title = `How to use ${title}`; button.setAttribute("aria-label", `Help for ${title}`);
        button.onpointerdown = e => e.stopPropagation(); button.onclick = e => { e.preventDefault(); e.stopPropagation(); window.dispatchEvent(new CustomEvent(WINDOW_HELP_EVENT, { detail: { title: `${windowTitle} — ${title}`, controls: [], opener: button } })); };
      }
    };
    decorate(); const observer = new MutationObserver(decorate); observer.observe(panel,{childList:true,subtree:true,characterData:true});
    return () => { observer.disconnect(); buttons.forEach(b=>b.remove()); };
  }, [root, windowTitle]);
}
