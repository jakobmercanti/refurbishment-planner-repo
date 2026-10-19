"use client";

interface ViewToggleProps {
  label: string;
  active: boolean;
  onToggle: () => void;
  disabled?: boolean;
}

export function ViewToggle({ label, active, onToggle, disabled=false }: ViewToggleProps) {
  return <button type="button" className={`view-toggle${active ? " active" : ""}`} aria-pressed={active} aria-label={`${label}: ${active ? "visible" : "hidden"}`} disabled={disabled} onClick={onToggle}>{label}</button>;
}
