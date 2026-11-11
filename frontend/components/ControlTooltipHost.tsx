"use client";

import { useEffect, useRef } from "react";
import { controlHelp } from "@/lib/windowHelpContent";

const controls = "button,input:not([type=hidden]),textarea,select,summary,[contenteditable=true],[role=button],[role=tab],[role=menuitem],[role=menuitemradio],[role=textbox],[role=combobox]";
const tooltipId = "planner-control-tooltip";

export function ControlTooltipHost() {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const tooltip = ref.current;
    if (!tooltip) return;
    let owner: HTMLElement | undefined;
    let title: string | null = null;
    let timer: number | undefined;

    const dismiss = () => {
      window.clearTimeout(timer);
      if (owner) {
        if (title !== null && !owner.hasAttribute("title")) owner.setAttribute("title", title);
        const describedBy = (owner.getAttribute("aria-describedby") ?? "").split(/\s+/).filter(id => id && id !== tooltipId);
        if (owner.getAttribute("aria-describedby")?.split(/\s+/).includes(tooltipId)) {
          if (describedBy.length) owner.setAttribute("aria-describedby", describedBy.join(" "));
          else owner.removeAttribute("aria-describedby");
        }
      }
      owner = undefined;
      title = null;
      if (tooltip.matches(":popover-open")) tooltip.hidePopover();
    };
    const start = (target: EventTarget | null) => {
      if (!(target instanceof Element)) return;
      const control = target.closest(controls);
      if (!(control instanceof HTMLElement) || owner === control) return;
      dismiss();
      const guide = controlHelp(control, false);
      if (!guide || control.closest("[aria-hidden=true],[data-help-ignore]")) return;
      owner = control;
      title = control.getAttribute("title");
      if (title !== null) control.removeAttribute("title");
      timer = window.setTimeout(() => {
        const rect = control.getBoundingClientRect();
        if (!rect.width || !rect.height || !control.isConnected) { dismiss(); return; }
        tooltip.textContent = guide.text;
        tooltip.showPopover();
        const margin = 8;
        const { width, height } = tooltip.getBoundingClientRect();
        const left = Math.max(margin, Math.min(rect.left, document.documentElement.clientWidth - width - margin));
        const below = rect.bottom + margin;
        const top = below + height + margin <= window.innerHeight ? below : Math.max(margin, rect.top - height - margin);
        tooltip.style.left = `${left}px`;
        tooltip.style.top = `${top}px`;
        const description = control.getAttribute("aria-describedby");
        control.setAttribute("aria-describedby", description ? `${description} ${tooltipId}` : tooltipId);
      }, 500);
    };
    const leave = (event: PointerEvent | FocusEvent) => {
      if (!owner?.contains(event.target as Node)) return;
      if (!(event.relatedTarget instanceof Node) || !owner.contains(event.relatedTarget)) dismiss();
    };
    const hover = (event: PointerEvent) => { if (event.pointerType === "mouse") start(event.target); };
    const focus = (event: FocusEvent) => {
      if (event.target instanceof HTMLElement && event.target.matches(":focus-visible")) start(event.target);
    };
    const escape = (event: KeyboardEvent) => { if (event.key === "Escape") dismiss(); };
    const listeners = new AbortController();
    const options = { capture: true, signal: listeners.signal };
    document.addEventListener("pointerover", hover, options);
    document.addEventListener("pointerout", leave, options);
    document.addEventListener("focusin", focus, options);
    document.addEventListener("focusout", leave, options);
    document.addEventListener("pointerdown", dismiss, options);
    document.addEventListener("input", dismiss, options);
    document.addEventListener("scroll", dismiss, options);
    document.addEventListener("keydown", escape, options);
    window.addEventListener("resize", dismiss, options);
    return () => { listeners.abort(); dismiss(); };
  }, []);
  return <div ref={ref} id={tooltipId} className="planner-control-tooltip" role="tooltip" popover="manual" />;
}
