"use client";
import { useEffect, useRef } from "react";
import { WindowHelpButton } from "./WindowHelpButton";
import { WindowIcon } from "./WindowIcon";

export function ClimoptixDeleteStudy({
  name,
  count,
  opener,
  onCancel,
  onDelete,
}: {
  name: string;
  count?: number;
  opener: HTMLButtonElement;
  onCancel: () => void;
  onDelete: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const cancel = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const dialog = ref.current;
    dialog?.showModal();
    cancel.current?.focus();
    return () => {
      dialog?.close();
      if (!opener.isConnected) {
        document
          .querySelector<HTMLButtonElement>(
            ".cfx-study-tools button:not(:disabled)",
          )
          ?.focus();
      } else {
        const target = opener.disabled
          ? opener.parentElement?.querySelector<HTMLButtonElement>(
              "button:not(:disabled)",
            )
          : opener;
        target?.focus();
      }
    };
  }, [opener]);
  return (
    <dialog
      className="popup cfx-confirm"
      ref={ref}
      aria-label={count === undefined ? "Delete CFD scenario" : "Clear all simulations"}
      onCancel={(e) => {
        e.preventDefault();
        onCancel();
      }}
    >
      <header className="popup-titlebar">
        <span className="popup-icon">
          <WindowIcon title="Delete simulation" />
        </span>
        <strong>{count === undefined ? "Delete this simulation?" : "Delete all simulations?"}</strong>
        <div className="window-header-actions">
          <WindowHelpButton
            title="Delete CFD simulation"
            steps={[
              {
                heading: "Keep the building",
                text: "Delete removes only this simulation and its CFD settings. The shared building, assets and other simulations are unchanged. Cancel or Escape keeps the simulation; Undo can restore a deleted simulation.",
              },
            ]}
          />
          <button
            className="popup-close"
            aria-label="Close dialog"
            title="Close dialog"
            onClick={onCancel}
          >
            ×
          </button>
        </div>
      </header>
      <div className="popup-content">
        <p>
          {count === undefined ? `“${name}” and its CFD settings will be removed. Existing groups are kept.` : `All ${count} simulations, including archived simulations, and every simulation group will be removed.`} The shared measured building and assets are kept. Undo can restore the previous workbench.
        </p>
      </div>
      <footer className="popup-actions">
        <button ref={cancel} onClick={onCancel}>
          Cancel
        </button>
        <button className="cfx-danger" onClick={onDelete}>
          {count === undefined ? "Delete simulation" : "Delete all simulations"}
        </button>
      </footer>
    </dialog>
  );
}
