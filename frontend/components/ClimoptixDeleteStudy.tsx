"use client";
import { ConfirmationDialog } from "./ConfirmationDialog";

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
  const bulk = count !== undefined;
  return <ConfirmationDialog
    opener={opener}
    fallbackFocus=".cfx-study-tools button:not(:disabled)"
    label={bulk ? "Clear all simulations" : "Delete CFD scenario"}
    title={bulk ? "Delete all simulations?" : "Delete this simulation?"}
    confirmLabel={bulk ? "Delete all simulations" : "Delete simulation"}
    message={<>
      {bulk ? `All ${count} simulations, including archived simulations, and every simulation group will be removed.`
        : `“${name}” and its CFD settings will be removed. Existing groups are kept.`}
      {" The shared measured building and assets are kept. Undo can restore the previous workbench."}
    </>}
    help={[{ heading: "What is removed", text: bulk
      ? "Clearing the workbench removes all simulations and groups. Undo can restore them."
      : "This removes the selected simulation and its CFD settings. Undo can restore it." }]}
    onCancel={onCancel}
    onConfirm={onDelete}
  />;
}
