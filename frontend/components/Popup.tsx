"use client";

import type { ReactNode } from "react";
import { WindowIcon } from "@/components/WindowIcon";
import { WindowHelpButton } from "@/components/WindowHelpButton";
import { FloatingToolbar } from "./FloatingToolbar";

interface PopupProps {
  open: boolean;
  dockable?: boolean;
  title: string;
  message: string;
  children?: ReactNode;
  className?: string;
  confirmLabel?: string;
  confirmDisabled?: boolean;
  autoFocusTarget?: "cancel" | "confirm" | "content";
  onConfirm: () => void;
  onCancel: () => void;
}

export function Popup({ open, dockable = false, title, message, children, className = "", confirmLabel = "OK", confirmDisabled = false, autoFocusTarget = "cancel", onConfirm, onCancel }: PopupProps) {
  if (!open) return null;
  if (dockable) {
    const wide = className.includes("appearance-popup");
    const width = wide ? (className.includes("wall-layers-popup") ? 1240 : 1120) : 540;
    return <div className="dockable-editor-host" onKeyDown={event => { if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); onCancel(); } }}>
      <FloatingToolbar title={title} dialog className={`popup dockable-editor ${className}`} defaultPosition={{ x: typeof window === "undefined" ? 30 : Math.max(8, (window.innerWidth - width) / 2), y: 72 }} initialSize={{ width, height: wide ? 760 : undefined }} maxHeight={850} bringToFront onClose={onCancel} footer={<footer className="popup-actions"><button type="button" onClick={onCancel} autoFocus={autoFocusTarget === "cancel"}>Cancel</button><button type="button" className="primary" disabled={confirmDisabled} autoFocus={autoFocusTarget === "confirm"} onClick={onConfirm}>{confirmLabel}</button></footer>}>
        <div className="popup-content">{children ?? <p>{message}</p>}</div>
      </FloatingToolbar>
    </div>;
  }
  return <div className="popup-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onCancel(); }}>
    <section className={`popup ${className}`.trim()} role="dialog" aria-modal="true" aria-labelledby="popup-title" onMouseDown={(event) => event.stopPropagation()} onKeyDown={event=>{if(event.key==="Escape"){event.preventDefault();event.stopPropagation();onCancel();}}}>
      <header className="popup-titlebar"><span className="popup-drag" aria-hidden>⠿</span><span className="popup-icon"><WindowIcon title={title} /></span><strong id="popup-title">{title}</strong><div className="window-header-actions"><WindowHelpButton title={title} /><button type="button" className="popup-close" aria-label="Close dialog" title="Close dialog" onClick={onCancel}>×</button></div></header>
      <div className="popup-content">{children ?? <p>{message}</p>}</div>
      <footer className="popup-actions"><button type="button" onClick={onCancel} autoFocus={autoFocusTarget === "cancel"}>Cancel</button><button type="button" className="primary" disabled={confirmDisabled} autoFocus={autoFocusTarget === "confirm"} onClick={onConfirm}>{confirmLabel}</button></footer>
    </section>
  </div>;
}
