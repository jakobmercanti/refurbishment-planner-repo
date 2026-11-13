"use client";

import { useEffect, useId, useRef, type ReactNode } from "react";
import type { WindowHelpStep } from "@/lib/windowHelp";
import { WindowHelpButton } from "./WindowHelpButton";
import { WindowIcon } from "./WindowIcon";

export function ConfirmationDialog({ title, label, message, confirmLabel, disabled, opener, fallbackFocus, help, onCancel, onConfirm }: {
  title: string;
  label?: string;
  message: ReactNode;
  confirmLabel: string;
  disabled?: boolean;
  opener: HTMLButtonElement | null;
  fallbackFocus?: string;
  help?: WindowHelpStep[];
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const cancel = useRef<HTMLButtonElement>(null);
  const id = useId();
  useEffect(() => {
    const dialog = ref.current;
    dialog?.showModal();
    cancel.current?.focus({ preventScroll: true });
    return () => {
      dialog?.close();
      if (opener?.isConnected && !opener.disabled) opener.focus({ preventScroll: true });
      else if (fallbackFocus) document.querySelector<HTMLElement>(fallbackFocus)?.focus({ preventScroll: true });
    };
  }, [opener, fallbackFocus]);
  return <dialog ref={ref} className="popup planner-window planner-confirmation" aria-label={label}
    aria-labelledby={label ? undefined : id + "-title"} aria-describedby={id + "-message"}
    onCancel={event => { event.preventDefault(); onCancel(); }}>
    <header className="popup-titlebar planner-window-header">
      <span className="popup-icon"><WindowIcon title={title} /></span>
      <strong id={id + "-title"}>{title}</strong>
      <div className="window-header-actions">
        <WindowHelpButton primary title={title} steps={help} />
        <button type="button" className="popup-close" aria-label="Close dialog" onClick={onCancel}>×</button>
      </div>
    </header>
    <div className="popup-content planner-window-body"><p id={id + "-message"}>{message}</p></div>
    <footer className="popup-actions planner-window-footer">
      <button type="button" ref={cancel} onClick={onCancel}>Cancel</button>
      <button type="button" className="planner-danger-action" disabled={disabled} onClick={onConfirm}>{confirmLabel}</button>
    </footer>
  </dialog>;
}
