"use client";
import type { ReactNode } from "react";
import styles from "./EquipmentListRow.module.css";

export { default as equipmentListStyles } from "./EquipmentListRow.module.css";

/** Shared selection, detail text and actions for Floorplan and CFD equipment. */
export function EquipmentListRow({ name, detail, selected, onSelect, selectLabel, onEdit, onRestore, onDuplicate, onDelete, duplicateDisabled = false, duplicateTitle, alternateAction, menu }: {
  name: string; detail: string; selected: boolean;
  onSelect: () => void; selectLabel?: string; onEdit?: () => void; onRestore?: () => void; onDuplicate?: () => void; onDelete?: () => void;
  duplicateDisabled?: boolean; duplicateTitle?: string; alternateAction?: ReactNode; menu?: ReactNode;
}) {
  return <article className={`cfx-device-row ${styles.row}${selected ? " selected" : ""}`}>
    <button className={`cfx-device-name ${styles.name}`} aria-label={selectLabel ?? `Select ${name}`} aria-pressed={selectLabel ? undefined : selected} title={selectLabel ?? `${name} · ${detail}`} onClick={onSelect}><strong>{name}</strong><small>{detail}</small></button>
    {(onEdit || onRestore || onDuplicate || onDelete || alternateAction) && <div className={`cfx-device-actions ${styles.actions}${onRestore ? ` ${styles.restoreActions}` : ""}`}>
      {onEdit && <button aria-label={`Edit ${name}`} onClick={onEdit}>Edit</button>}
      {onRestore && <button aria-label={`Restore ${name}`} onClick={onRestore}>Restore</button>}
      {onDuplicate && <button aria-label={`Duplicate ${name}`} title={duplicateTitle} disabled={duplicateDisabled} onClick={onDuplicate}>Duplicate</button>}
      {onDelete ? <button className="cfx-danger" aria-label={`Delete ${name}`} onClick={onDelete}>Delete</button> : alternateAction}
    </div>}
    {menu}
  </article>;
}
