"use client";

interface ViewToggleProps {
  label: string;
  active: boolean;
  onToggle: () => void;
}

export function ViewToggle({ label, active, onToggle }: ViewToggleProps) {
  return <button type="button" className={`view-toggle${active ? " active" : ""}`} aria-pressed={active} aria-label={`${label}: ${active ? "visible" : "hidden"}`} onClick={onToggle}>{label}</button>;
}
