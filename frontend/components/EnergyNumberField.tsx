"use client";
import { useState } from "react";

export function NumberField({ label, value, onChange, min = 0, max = 10000, autoFocus = false }: { label: string; value: number | null; onChange: (v: number | null) => void; min?: number; max?: number; autoFocus?: boolean }) {
  const [draft, setDraft] = useState<string | null>(null);
  const commit = () => { const raw = draft ?? String(value ?? ""), n = Number(raw);if (!raw) onChange(null);else if (Number.isFinite(n) && n >= min && n <= max) onChange(n);setDraft(null); };
  return <label>{label}<input autoFocus={autoFocus} type="number" min={min} max={max} step="any" placeholder="Not set" value={draft ?? value ?? ""} onChange={e => setDraft(e.target.value)} onBlur={commit} onKeyDown={e => { if (e.key === "Enter") e.currentTarget.blur(); }} /></label>;
}
