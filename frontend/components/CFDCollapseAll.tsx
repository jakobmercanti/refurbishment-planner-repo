"use client";

import type { ReactNode } from "react";

export function CFDWindowControls({ children }: { children?: ReactNode }) {
  return <div className="cfx-setup-status-row">
    {children}
    <div className="cfx-window-disclosure-bar"><CFDCollapseAll wholeWindow /></div>
  </div>;
}

export function CFDWindowSections({ children, sectionTitle }: { children: ReactNode; sectionTitle?: string }) {
  return <div className="cfx-window-sections" data-cfx-collapse-root>
    <CFDWindowControls />
    {sectionTitle ? <details open><summary>{sectionTitle}</summary>{children}</details> : children}
  </div>;
}

/** Change disclosures in this panel, without opening row-action menus. */
export function CFDCollapseAll({onToggle, wholeWindow = false}:{onToggle?:(open:boolean)=>void; wholeWindow?:boolean}) {
  return <div className={`cfx-disclosure-actions${wholeWindow ? " cfx-window-disclosures" : ""}`}>{[false,true].map(open=><button key={String(open)} type="button" data-cfx-toggle={onToggle ? String(open) : undefined} onClick={event => {
    const root = event.currentTarget.closest("[data-cfx-collapse-root]");
    root?.querySelectorAll<HTMLDetailsElement>("details:not(.cfx-row-menu)").forEach(details => {
      if (!details.closest("[hidden]")) details.open = open;
    });
    if (wholeWindow) root?.querySelectorAll<HTMLButtonElement>(`[data-cfx-toggle="${open}"]`).forEach(button => {
      if (!button.closest("[hidden]")) button.click();
    });
    onToggle?.(open);
  }}>{open?"Expand all":"Collapse all"}</button>)}</div>;
}
