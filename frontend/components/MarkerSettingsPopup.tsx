"use client";

import { useState } from "react";
import { Popup } from "@/components/Popup";

export type MarkerSymbol = "CIRCLE" | "FILLED_CIRCLE" | "SQUARE" | "FILLED_SQUARE" | "TRIANGLE" | "DIAMOND" | "EXCLAMATION" | "QUESTION" | "PLUS" | "CROSS" | "NUMBER" | "LETTER";
export type MarkerSize = number | "SMALL" | "MEDIUM" | "LARGE";
export type MarkerSettings = { symbol: MarkerSymbol; label: string; color: string; size: MarkerSize; arrowAttached?: boolean };

export function markerTextSize(size: MarkerSize): number {
  if (typeof size === "number" && Number.isFinite(size)) return Math.min(72, Math.max(8, size));
  if (size === "SMALL") return 10;
  if (size === "LARGE") return 18;
  return 14;
}

interface MarkerSettingsPopupProps {
  open: boolean;
  settings: MarkerSettings;
  editing: boolean;
  onChange: (settings: Partial<MarkerSettings>) => void;
  onConfirm: () => void;
  onCancel: () => void;
}

const SYMBOLS: Array<{ value: MarkerSymbol; label: string }> = [
  { value: "CIRCLE", label: "Circle" },
  { value: "FILLED_CIRCLE", label: "Filled circle" },
  { value: "SQUARE", label: "Square" },
  { value: "FILLED_SQUARE", label: "Filled square" },
  { value: "TRIANGLE", label: "Triangle" },
  { value: "DIAMOND", label: "Diamond" },
  { value: "EXCLAMATION", label: "Exclamation" },
  { value: "QUESTION", label: "Question" },
  { value: "PLUS", label: "Plus" },
  { value: "CROSS", label: "Cross" },
  { value: "NUMBER", label: "Numbered marker" },
  { value: "LETTER", label: "Letter marker" },
];

function SymbolPreview({ symbol }: { symbol: MarkerSymbol }) {
  const stroke = "currentColor";
  if (symbol === "CIRCLE" || symbol === "FILLED_CIRCLE") return <svg viewBox="0 0 32 32" aria-hidden><circle cx="16" cy="16" r="9" fill={symbol === "FILLED_CIRCLE" ? "currentColor" : "none"} stroke={stroke} strokeWidth="2" /></svg>;
  if (symbol === "SQUARE" || symbol === "FILLED_SQUARE") return <svg viewBox="0 0 32 32" aria-hidden><rect x="7" y="7" width="18" height="18" rx="2" fill={symbol === "FILLED_SQUARE" ? "currentColor" : "none"} stroke={stroke} strokeWidth="2" /></svg>;
  if (symbol === "TRIANGLE") return <svg viewBox="0 0 32 32" aria-hidden><path d="M16 6 26 25H6Z" fill="none" stroke={stroke} strokeWidth="2" strokeLinejoin="round" /></svg>;
  if (symbol === "DIAMOND") return <svg viewBox="0 0 32 32" aria-hidden><path d="m16 5 11 11-11 11L5 16Z" fill="none" stroke={stroke} strokeWidth="2" strokeLinejoin="round" /></svg>;
  if (symbol === "PLUS") return <svg viewBox="0 0 32 32" aria-hidden><path d="M16 7v18M7 16h18" stroke={stroke} strokeWidth="3" strokeLinecap="round" /></svg>;
  if (symbol === "CROSS") return <svg viewBox="0 0 32 32" aria-hidden><path d="m8 8 16 16M24 8 8 24" stroke={stroke} strokeWidth="3" strokeLinecap="round" /></svg>;
  return <svg viewBox="0 0 32 32" aria-hidden><circle cx="16" cy="16" r="11" fill="none" stroke={stroke} strokeWidth="2" /><text x="16" y="21" textAnchor="middle" fontSize="16" fontWeight="700" fill={stroke}>{symbol === "EXCLAMATION" ? "!" : symbol === "QUESTION" ? "?" : symbol === "NUMBER" ? "1" : "A"}</text></svg>;
}

export function MarkerSettingsPopup({ open, settings, editing, onChange, onConfirm, onCancel }: MarkerSettingsPopupProps) {
  const [symbolMenuOpen, setSymbolMenuOpen] = useState(false);
  const hasLabel = settings.symbol === "NUMBER" || settings.symbol === "LETTER";
  const hasText = hasLabel || settings.symbol === "EXCLAMATION" || settings.symbol === "QUESTION";
  const selectedSymbol = SYMBOLS.find((option) => option.value === settings.symbol) ?? SYMBOLS[0];

  return <Popup open={open} title="Marker settings" message="" className="marker-settings-popup" autoFocusTarget="content" confirmLabel={editing ? "Save" : "Place"} onConfirm={() => { setSymbolMenuOpen(false); onConfirm(); }} onCancel={() => { setSymbolMenuOpen(false); onCancel(); }}>
    <div className="marker-settings-content">
      <div className="marker-settings-field">
        <span className="marker-settings-label">Symbol</span>
        <div className="marker-symbol-picker">
          <button type="button" className="marker-symbol-trigger" aria-haspopup="listbox" aria-expanded={symbolMenuOpen} onClick={() => setSymbolMenuOpen((current) => !current)}>
            <span className="marker-symbol-trigger-preview"><SymbolPreview symbol={settings.symbol} /></span>
            <span>{selectedSymbol.label}</span>
            <span className="marker-symbol-trigger-chevron" aria-hidden>{symbolMenuOpen ? "⌃" : "⌄"}</span>
          </button>
          {symbolMenuOpen && <div className="marker-symbol-menu" role="listbox" aria-label="Marker symbol choices">
            {SYMBOLS.map((option) => <button key={option.value} type="button" role="option" aria-selected={settings.symbol === option.value} className={settings.symbol === option.value ? "selected" : ""} onClick={() => { onChange({ symbol: option.value }); setSymbolMenuOpen(false); }}>
              <span className="marker-symbol-option-preview"><SymbolPreview symbol={option.value} /></span>
              <span>{option.label}</span>
            </button>)}
          </div>}
        </div>
      </div>
      {hasLabel && <label className="marker-settings-field"><span className="marker-settings-label">Label</span><input value={settings.label} maxLength={8} placeholder={settings.symbol === "NUMBER" ? "Auto number" : "Auto letter"} onChange={(event) => onChange({ label: event.target.value })} /></label>}
      <label className="marker-settings-row"><span>Colour</span><input aria-label="Marker colour" type="color" value={settings.color} onChange={(event) => onChange({ color: event.target.value })} /></label>
      <label className="marker-settings-row"><span>{hasText ? "Text size (px)" : "Marker size (px)"}</span><input aria-label={hasText ? "Marker text size in pixels" : "Marker size in pixels"} type="number" min="8" max="72" step="1" value={typeof settings.size === "number" ? settings.size : markerTextSize(settings.size)} onChange={(event) => { const value = event.target.value; if (value === "") { onChange({ size: 0 }); return; } const numeric = Number(value); if (Number.isFinite(numeric)) onChange({ size: numeric }); }} onBlur={() => onChange({ size: markerTextSize(settings.size) })} /></label>
      <label className="marker-settings-checkbox">
        <input type="checkbox" checked={Boolean(settings.arrowAttached)} onChange={(event) => onChange({ arrowAttached: event.target.checked })} />
        <span><strong>Attach arrow</strong><small>Use a second click to place the arrow tail, like a callout.</small></span>
      </label>
    </div>
  </Popup>;
}
