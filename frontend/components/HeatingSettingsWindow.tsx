"use client";
import { useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { FloatingToolbar } from "./FloatingToolbar";
import styles from "./HeatingLayoutPanel.module.css";
/** Separate advanced settings keep the room workflow short without duplicating state. */
export function HeatingSettingsWindow({ title, children }: { title: string; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  return <><button className="heating-settings-launcher" onClick={() => setOpen(true)}>{title}…</button>{open && typeof document !== "undefined" && createPortal(<FloatingToolbar title={`Heating — ${title}`} defaultPosition={{ x: 140, y: 105 }} initialSize={{ width: 540 }} maxHeight={700} bringToFront onClose={() => setOpen(false)}><div className={styles.panel}>{children}<button onClick={() => setOpen(false)}>Done</button></div></FloatingToolbar>, document.body)}</>;
}
