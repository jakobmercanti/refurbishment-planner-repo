"use client";

import { createPortal } from "react-dom";
import { useEffect, useLayoutEffect, useRef, useState } from "react";

export const CFD_WINDOWS = [
  { id: "studies", name: "Simulations", tab: "Simulations" },
  { id: "domain", name: "Domain", tab: "Domain" },
  { id: "equipment", name: "Equipment", tab: "Objects" },
  { id: "boundaries", name: "Boundaries", tab: "Bounds" },
  { id: "physics", name: "Physics", tab: "Physics" },
  { id: "mesh", name: "Solver", tab: "Solver" },
  { id: "adjoint", name: "Adjoint Optimisation", tab: "Adjoint Optimisation" },
  { id: "review", name: "Review & export", tab: "Export" },
  { id: "results", name: "Imported results", tab: "Results" },
] as const;
export type CFDWindowId = (typeof CFD_WINDOWS)[number]["id"] | "view" | "thermal" | "convergence";

/** The same menu content serves the application Toolbar and viewer context menu. */
export function ClimoptixWindowMenu({
  target,
  context,
  onDismiss,
  selected,
  setupOpen,
  available,
  onToggle,
  onHideAll,
  onRefresh,
  checking,
}: {
  target: HTMLElement | null;
  context: { x: number; y: number } | null;
  onDismiss: () => void;
  selected: CFDWindowId;
  setupOpen: boolean;
  available: (id: CFDWindowId) => boolean;
  onToggle: (id: CFDWindowId) => void;
  onHideAll: () => void;
  onRefresh: () => void;
  checking: boolean;
}) {
  const [open, setOpen] = useState(false);
  const button = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const shown = open || !!context;
  const dismiss = () => {
    setOpen(false);
    onDismiss();
  };
  useEffect(() => {
    if (!shown) return;
    const outside = (event: PointerEvent) => {
      if (
        !menu.current?.contains(event.target as Node) &&
        !button.current?.contains(event.target as Node)
      )
        dismiss();
    };
    document.addEventListener("pointerdown", outside, true);
    return () => document.removeEventListener("pointerdown", outside, true);
  });
  useLayoutEffect(() => {
    if (!shown || !menu.current) return;
    const node = menu.current;
    if (context) {
      const bounds = node.getBoundingClientRect();
      node.style.left = `${Math.max(8, Math.min(context.x, window.innerWidth - bounds.width - 8))}px`;
      node.style.top = `${Math.max(8, Math.min(context.y, window.innerHeight - bounds.height - 8))}px`;
    }
    node.querySelector<HTMLButtonElement>("button:not(:disabled)")?.focus();
  }, [shown, context]);
  const contents = shown && (
    <div
      ref={menu}
      className={`software-dropdown toolbar-menu cfx-window-menu${context ? " cfx-context-menu" : ""}`}
      role="menu"
      aria-label="Climoptix windows"
      style={
        context
          ? { position: "fixed", left: context.x, top: context.y }
          : undefined
      }
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.preventDefault();
          event.stopPropagation();
          dismiss();
          button.current?.focus();
          return;
        }
        const items = Array.from(
          event.currentTarget.querySelectorAll<HTMLButtonElement>(
            "button:not(:disabled)",
          ),
        );
        const index = items.indexOf(event.target as HTMLButtonElement);
        if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key))
          return;
        event.preventDefault();
        const next =
          event.key === "Home"
            ? 0
            : event.key === "End"
              ? items.length - 1
              : (index + (event.key === "ArrowUp" ? -1 : 1) + items.length) %
                items.length;
        items[next]?.focus();
      }}
    >
      <div className="toolbar-menu-actions">
        <button
          type="button"
          role="menuitem"
          onClick={() => {
            onHideAll();
            dismiss();
            button.current?.focus();
          }}
        >
          Hide setup window
        </button>
      </div>
      <button
        type="button"
        role="menuitem"
        onClick={() => {
          onToggle(selected);
          dismiss();
          button.current?.focus();
        }}
      >
        Simulation setup…
      </button>
      <p className="cfx-menu-caption">Setup phases</p>
      <button type="button" role="menuitem" disabled={!available("domain") || checking}
        onClick={() => { onRefresh(); dismiss(); button.current?.focus(); }}>Refresh checks</button>
      {CFD_WINDOWS.map((window) => (
        <button
          key={window.id}
          type="button"
          role="menuitem"
          aria-current={
            setupOpen && selected === window.id ? "page" : undefined
          }
          disabled={!available(window.id)}
          onClick={() => {
            onToggle(window.id);
            dismiss();
            button.current?.focus();
          }}
        >
          <span className="menu-check" aria-hidden="true">
            {setupOpen && selected === window.id ? "✓" : ""}
          </span>
          <span>{window.name}</span>
        </button>
      ))}
    </div>
  );
  return (
    <>
      {target &&
        createPortal(
          <div className="software-menu-item">
            <button
              ref={button}
              type="button"
              aria-haspopup="menu"
              aria-expanded={shown}
              className={shown ? "active" : ""}
              onClick={() => {
                onDismiss();
                setOpen(!open);
              }}
            >
              Toolbar
            </button>
            {!context && contents}
          </div>,
          target,
        )}
      {context && createPortal(contents, document.body)}
    </>
  );
}
