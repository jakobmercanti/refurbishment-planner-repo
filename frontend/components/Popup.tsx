"use client";

import type { ReactNode } from "react";
import { WindowIcon } from "@/components/WindowIcon";

interface PopupProps {
  open: boolean;
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

export function Popup({ open, title, message, children, className = "", confirmLabel = "Ok", confirmDisabled = false, autoFocusTarget = "cancel", onConfirm, onCancel }: PopupProps) {
  if (!open) return null;
  return <div className="popup-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onCancel(); }}>
    <section className={`popup ${className}`.trim()} role="dialog" aria-modal="true" aria-labelledby="popup-title" onMouseDown={(event) => event.stopPropagation()}>
      <header className="popup-titlebar"><span className="popup-drag" aria-hidden>⠿</span><span className="popup-icon"><WindowIcon title={title} /></span><strong id="popup-title">{title}</strong><button type="button" className="popup-close" aria-label="Close dialog" title="Close dialog" onClick={onCancel}>×</button></header>
      <div className="popup-content">{children ?? <p>{message}</p>}</div>
      <footer className="popup-actions"><button type="button" onClick={onCancel} autoFocus={autoFocusTarget === "cancel"}>Cancel</button><button type="button" className="primary" disabled={confirmDisabled} autoFocus={autoFocusTarget === "confirm"} onClick={onConfirm}>{confirmLabel}</button></footer>
    </section>
  </div>;
}
