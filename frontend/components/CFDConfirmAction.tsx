"use client";

import { useEffect, useRef, useState } from "react";

/** A destructive bulk action never runs from the first click or Escape. */
export function CFDConfirmAction({ label = "Clear all", title, description, confirmLabel = label, disabled, onConfirm }: {
  label?: string; title: string; description: string; confirmLabel?: string; disabled?: boolean; onConfirm: () => void;
}) {
  const [open, setOpen] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null);
  const opener = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!open) return;
    const node = dialog.current;
    const button = opener.current;
    node?.showModal();
    node?.querySelector<HTMLButtonElement>("button")?.focus();
    return () => { node?.close(); button?.focus(); };
  }, [open]);
  return <>
    <button type="button" ref={opener} className="cfx-danger" disabled={disabled} onClick={() => setOpen(true)}>{label}</button>
    {open && <dialog ref={dialog} className="popup cfx-confirm" aria-label={title} onCancel={event => { event.preventDefault(); setOpen(false); }}>
      <header className="popup-titlebar"><strong>{title}</strong></header>
      <div className="popup-content"><p>{description}</p></div>
      <footer className="popup-actions">
        <button type="button" onClick={() => setOpen(false)}>Cancel</button>
        <button type="button" className="cfx-danger" disabled={disabled} onClick={() => { if (!disabled) { onConfirm(); setOpen(false); } }}>{confirmLabel}</button>
      </footer>
    </dialog>}
  </>;
}
