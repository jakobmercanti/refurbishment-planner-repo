"use client";

import { useRef, useState } from "react";
import { useWindowFocusMode } from "@/lib/windowFocusMode";

/** Modal windows keep their backdrop/focus behaviour; only their box changes. */
export function WindowMaximizeButton({ title }: { title: string }) {
  const [maximized, setMaximized] = useState(false);
  const ref = useRef<HTMLButtonElement>(null);
  useWindowFocusMode(ref, maximized, true, () => setMaximized(false));
  const label = `${maximized ? "Restore" : "Maximise"} ${title}`;
  return <button ref={ref} type="button" className="window-dialog-maximize" aria-label={label} title={label} aria-pressed={maximized} onPointerDown={event => event.stopPropagation()} onDoubleClick={event => event.stopPropagation()} onClick={event => {
    event.preventDefault(); event.stopPropagation();
    const dialog = event.currentTarget.closest(".window-header-actions")?.closest<HTMLElement>("[role=dialog],dialog");
    if (!dialog) return;
    dialog.toggleAttribute("data-window-maximized", !maximized);
    setMaximized(!maximized);
  }}><svg viewBox="0 0 20 20" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">{maximized ? <><path d="M6 6V3h11v11h-3" /><rect x="3" y="6" width="11" height="11" rx="1" /></> : <rect x="3" y="3" width="14" height="14" rx="1.5" />}</svg></button>;
}
