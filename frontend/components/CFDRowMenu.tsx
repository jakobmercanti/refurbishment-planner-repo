"use client";

import { useLayoutEffect, useRef, useState, type ReactNode } from "react";

/** The browser top layer escapes scrolling windows without losing DOM ownership
 * or inherited appearance. Flip upward, then clamp to the visual viewport. */
export function CFDRowMenu({ label, children }: { label: string; children: ReactNode }) {
  const details = useRef<HTMLDetailsElement>(null), panel = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  useLayoutEffect(() => {
    const node = panel.current, anchor = details.current?.querySelector("summary");
    if (!node || !anchor || !open) return;
    const position = () => {
      const a = anchor.getBoundingClientRect(), v = window.visualViewport;
      const left = v?.offsetLeft ?? 0, top = v?.offsetTop ?? 0;
      const right = left + (v?.width ?? innerWidth), bottom = top + (v?.height ?? innerHeight);
      node.style.maxHeight = `${Math.max(40, bottom - top - 16)}px`;
      node.style.maxWidth = `${Math.max(40, right - left - 16)}px`;
      const b = node.getBoundingClientRect();
      node.style.left = `${Math.max(left + 8, Math.min(right - b.width - 8, a.right - b.width))}px`;
      node.style.top = `${Math.max(top + 8, Math.min(bottom - b.height - 8, a.bottom + b.height + 4 <= bottom - 8 ? a.bottom + 4 : a.top - b.height - 4))}px`;
    };
    node.showPopover(); position();
    const observer = new ResizeObserver(position); observer.observe(node);
    window.addEventListener("resize", position); window.addEventListener("scroll", position, true);
    window.visualViewport?.addEventListener("resize", position);
    window.visualViewport?.addEventListener("scroll", position);
    return () => {
      observer.disconnect(); node.hidePopover();
      window.removeEventListener("resize", position); window.removeEventListener("scroll", position, true);
      window.visualViewport?.removeEventListener("resize", position);
      window.visualViewport?.removeEventListener("scroll", position);
    };
  }, [open]);
  return <details ref={details} className="cfx-row-menu" onToggle={e => setOpen(e.currentTarget.open)} onClick={e => {
    if (e.target instanceof Element && e.target.closest("button")) e.currentTarget.open = false;
  }}>
    <summary aria-label={label}>⋯</summary>
    <div ref={panel} popover="auto" className="cfx-row-menu-panel" onToggle={e => {
      if (e.newState === "closed" && details.current) details.current.open = false;
    }}>{children}</div>
  </details>;
}
