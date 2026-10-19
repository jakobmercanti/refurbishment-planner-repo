import type { RefObject } from "react";
import { useEffect } from "react";
import { WINDOW_HELP_EVENT } from "../components/WindowHelpButton";
/** Decorate every dynamic service accordion/dropdown without putting help in its toggle action. */
export function useServiceMenuHelp(root: RefObject<HTMLElement | null>, windowTitle: string) {
  useEffect(() => {
    const panel = root.current;
    if (!panel || /^Help\b/.test(windowTitle) || !/heat|electrical|insulation|energy|wall layers|floor properties|roof|building/i.test(windowTitle)) return;
    const buttons = new Set<HTMLButtonElement>();
    const decorate = () => {
      for (const target of panel.querySelectorAll<HTMLElement>("summary,label:has(select)")) {
        if (target.querySelector(".window-help-button")) continue;
        const title = Array.from(target.childNodes).filter(n=>n.nodeType===Node.TEXT_NODE || n instanceof HTMLElement && n.tagName !== "SELECT").map(n=>n.textContent).join(" ").trim().replace(/\s+/g," ");
        if (!title) continue;
        const button = document.createElement("button"); button.type = "button"; button.className = "window-help-button service-menu-help"; button.textContent = "?"; button.title = `How to use ${title}`; button.setAttribute("aria-label", `Help for ${title}`);
        button.onpointerdown = e => e.stopPropagation(); button.onclick = e => { e.preventDefault(); e.stopPropagation(); window.dispatchEvent(new CustomEvent(WINDOW_HELP_EVENT, { detail: { title: `${windowTitle} — ${title}`, controls: [], opener: button } })); };
        target.appendChild(button); buttons.add(button);
      }
    };
    decorate(); const observer = new MutationObserver(decorate); observer.observe(panel,{childList:true,subtree:true});
    return () => { observer.disconnect(); buttons.forEach(b=>b.remove()); };
  }, [root, windowTitle]);
}
