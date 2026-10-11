"use client";
import { useEffect, useId, useState } from "react";
import { createPortal } from "react-dom";

/** Shared, non-interactive plan help. Never participates in selection or geometry. */
export function PlanHoverHelp() {
  const id = useId();
  const [tip, setTip] = useState<{ text: string; x: number; y: number } | null>(null);
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined, owner: Element | null = null, described: string | null = null;
    let pressed = false;
    const target = (node: EventTarget | null) => node instanceof Element ? node.closest("[data-plan-info]") : null;
    const hide = () => {
      clearTimeout(timer); setTip(null);
      if (owner) { if (described === null) owner.removeAttribute("aria-describedby"); else owner.setAttribute("aria-describedby", described); }
      owner = null;
    };
    const show = (element: Element, x: number, y: number, immediate = false) => {
      if (owner === element) return;
      hide(); owner = element; described = element.getAttribute("aria-describedby");
      const text = element.getAttribute("data-plan-info");
      if (!text) return;
      timer = setTimeout(() => {
        element.setAttribute("aria-describedby", [described, id].filter(Boolean).join(" "));
        setTip({ text, x: Math.max(8, Math.min(x + 14, window.innerWidth - 288)), y: Math.max(8, Math.min(y + 18, window.innerHeight - 160)) });
      }, immediate ? 0 : 220);
    };
    const down = () => { pressed = true; hide(); };
    const up = () => { pressed = false; };
    const over = (event: PointerEvent) => { const element = target(event.target); if (!pressed && !event.buttons && element) show(element, event.clientX, event.clientY); };
    const out = (event: PointerEvent) => { if (owner && target(event.relatedTarget) !== owner) hide(); };
    const focus = (event: FocusEvent) => { if (pressed) return; const element = target(event.target); if (element) { const box = element.getBoundingClientRect(); show(element, box.right, box.top, true); } };
    const key = (event: KeyboardEvent) => { if (event.key === "Escape") hide(); };
    document.addEventListener("pointerover", over); document.addEventListener("pointerout", out);
    document.addEventListener("pointerdown", down, true); document.addEventListener("pointerup", up, true); document.addEventListener("pointercancel", up, true); document.addEventListener("focusin", focus); document.addEventListener("focusout", hide);
    document.addEventListener("keydown", key, true); window.addEventListener("blur", hide); window.addEventListener("scroll", hide, true);
    return () => {
      clearTimeout(timer); if (owner) { if (described === null) owner.removeAttribute("aria-describedby"); else owner.setAttribute("aria-describedby", described); }
      document.removeEventListener("pointerover", over); document.removeEventListener("pointerout", out);
      document.removeEventListener("pointerdown", down, true); document.removeEventListener("pointerup", up, true); document.removeEventListener("pointercancel", up, true); document.removeEventListener("focusin", focus); document.removeEventListener("focusout", hide);
      document.removeEventListener("keydown", key, true); window.removeEventListener("blur", hide); window.removeEventListener("scroll", hide, true);
    };
  }, [id]);
  return tip && createPortal(<div id={id} role="tooltip" style={{ position: "fixed", left: tip.x, top: tip.y, width: 270, maxWidth: "calc(100vw - 16px)", padding: "10px 12px", borderRadius: 10, border: "1px solid var(--line,#cad6e4)", background: "var(--surface,#fff)", color: "var(--ink,#10243e)", boxShadow: "0 5px 20px #0002", fontSize: 13, lineHeight: 1.45, whiteSpace: "pre-line", pointerEvents: "none", zIndex: 100000 }}>{tip.text}</div>, document.body);
}
