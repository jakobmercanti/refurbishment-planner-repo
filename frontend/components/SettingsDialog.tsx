"use client";

import { CURRENCY_OPTIONS, type AppPreferences, type CurrencyCode } from "@/lib/appPreferences";

export { DEFAULT_APP_PREFERENCES } from "@/lib/appPreferences";
export type { AppPreferences } from "@/lib/appPreferences";

interface SettingsDialogProps {
  open: boolean;
  preferences: AppPreferences;
  onChange: (preferences: AppPreferences) => void;
  onClose: () => void;
}

export function SettingsDialog({ open, preferences, onChange, onClose }: SettingsDialogProps) {
  if (!open) return null;
  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section className="settings-dialog" role="dialog" aria-modal="true" aria-labelledby="settings-title">
        <header>
          <div><span className="eyebrow">Application settings</span><h2 id="settings-title">Preferences</h2></div>
          <button type="button" className="modal-close" onClick={onClose} aria-label="Close settings">×</button>
        </header>
        <section className="settings-appearance" aria-labelledby="settings-appearance-title">
          <h3 id="settings-appearance-title">Appearance</h3>
          <div className="settings-appearance-option">
            <strong>Theme</strong>
            <p>Use your system setting or choose a fixed appearance.</p>
            <div className="settings-choice settings-theme-choice" role="group" aria-label="Theme">
              <button type="button" className={preferences.theme === "SYSTEM" ? "active" : ""} aria-pressed={preferences.theme === "SYSTEM"} onClick={() => onChange({ ...preferences, theme: "SYSTEM" })}>System</button>
              <button type="button" className={preferences.theme === "LIGHT" ? "active" : ""} aria-pressed={preferences.theme === "LIGHT"} onClick={() => onChange({ ...preferences, theme: "LIGHT" })}>Light</button>
              <button type="button" className={preferences.theme === "DARK" ? "active" : ""} aria-pressed={preferences.theme === "DARK"} onClick={() => onChange({ ...preferences, theme: "DARK" })}>Dark</button>
            </div>
          </div>
          <div className="settings-appearance-option">
            <strong>Workspace density</strong>
            <p>Compact keeps the interface tight. Comfortable makes text larger and easier to read.</p>
            <div className="settings-choice" role="group" aria-label="Workspace density">
              <button type="button" className={preferences.density === "COMFORTABLE" ? "active" : ""} aria-pressed={preferences.density === "COMFORTABLE"} onClick={() => onChange({ ...preferences, density: "COMFORTABLE" })}>Comfortable</button>
              <button type="button" className={preferences.density === "COMPACT" ? "active" : ""} aria-pressed={preferences.density === "COMPACT"} onClick={() => onChange({ ...preferences, density: "COMPACT" })}>Compact</button>
            </div>
          </div>
        </section>
        <div className="settings-section">
          <strong>Display units</strong>
          <p>Choose how dimensions are presented. Calculations remain millimetre-authoritative.</p>
          <div className="settings-choice unit-choice" role="group" aria-label="Display units">
            <button type="button" className={preferences.units === "MM" ? "active" : ""} aria-pressed={preferences.units === "MM"} onClick={() => onChange({ ...preferences, units: "MM" })}>Millimetres</button>
            <button type="button" className={preferences.units === "CM" ? "active" : ""} aria-pressed={preferences.units === "CM"} onClick={() => onChange({ ...preferences, units: "CM" })}>Centimetres</button>
            <button type="button" className={preferences.units === "INCHES" ? "active" : ""} aria-pressed={preferences.units === "INCHES"} onClick={() => onChange({ ...preferences, units: "INCHES" })}>Inches</button>
            <button type="button" className={preferences.units === "FEET" ? "active" : ""} aria-pressed={preferences.units === "FEET"} onClick={() => onChange({ ...preferences, units: "FEET" })}>Feet</button>
            <button type="button" className={preferences.units === "METERS" ? "active" : ""} aria-pressed={preferences.units === "METERS"} onClick={() => onChange({ ...preferences, units: "METERS" })}>Meters</button>
          </div>
        </div>
        <div className="settings-section">
          <label className="settings-currency-label" htmlFor="settings-default-currency">Default currency</label>
          <p>Used for costs without an item-specific currency. Changing this never converts existing amounts.</p>
          <select id="settings-default-currency" className="settings-currency-select" value={preferences.currency} onChange={(event) => onChange({ ...preferences, currency: event.target.value as CurrencyCode })}>
            {CURRENCY_OPTIONS.map(({ code, name, symbol }) => <option key={code} value={code}>{code} · {symbol} — {name}</option>)}
          </select>
        </div>
        <label className="settings-check">
          <input type="checkbox" checked={preferences.confirmBeforeOpen} onChange={(event) => onChange({ ...preferences, confirmBeforeOpen: event.target.checked })} />
          <span><strong>Confirm before opening another project</strong><small>Ask before replacing the current room with a selected file.</small></span>
        </label>
        <button className="settings-done" type="button" onClick={onClose}>Done</button>
      </section>
    </div>
  );
}
