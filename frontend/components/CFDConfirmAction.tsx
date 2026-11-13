"use client";

import { useState } from "react";
import { ConfirmationDialog } from "./ConfirmationDialog";

/** A destructive bulk action never runs from the first click or Escape. */
export function CFDConfirmAction({ label = "Clear all", title, description, confirmLabel = label, disabled, onConfirm }: {
  label?: string; title: string; description: string; confirmLabel?: string; disabled?: boolean; onConfirm: () => void;
}) {
  const [opener, setOpener] = useState<HTMLButtonElement | null>(null);
  return <>
    <button type="button" className="cfx-danger" disabled={disabled} onClick={event => setOpener(event.currentTarget)}>{label}</button>
    {opener && <ConfirmationDialog opener={opener} title={title} message={description}
      confirmLabel={confirmLabel} disabled={disabled} onCancel={() => setOpener(null)}
      onConfirm={() => { if (!disabled) { onConfirm(); setOpener(null); } }} />}
  </>;
}
