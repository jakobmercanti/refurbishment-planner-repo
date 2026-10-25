"use client";

/** Close native disclosure menus within this panel, including nested parameters. */
export function CFDCollapseAll() {
  return <button type="button" onClick={event => {
    event.currentTarget.closest("[data-cfx-collapse-root]")?.querySelectorAll<HTMLDetailsElement>("details[open]:not(.cfx-row-menu)")
      .forEach(details => { details.open = false; });
  }}>Collapse all</button>;
}
