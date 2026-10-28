"use client";

/** Change disclosures in this panel, without opening row-action menus. */
export function CFDCollapseAll({onToggle}:{onToggle?:(open:boolean)=>void}) {
  return <div className="cfx-disclosure-actions">{[false,true].map(open=><button key={String(open)} type="button" onClick={event => {
    event.currentTarget.closest("[data-cfx-collapse-root]")?.querySelectorAll<HTMLDetailsElement>("details:not(.cfx-row-menu)")
      .forEach(details => { details.open = open; });
    onToggle?.(open);
  }}>{open?"Expand all":"Collapse all"}</button>)}</div>;
}
