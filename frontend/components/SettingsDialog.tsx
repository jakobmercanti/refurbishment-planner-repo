"use client";

export interface AppPreferences {
  density: "COMFORTABLE" | "COMPACT";
  confirmBeforeOpen: boolean;
  units: "MM" | "CM" | "INCHES" | "FEET_INCHES";
}

interface SettingsDialogProps {
  open: boolean;
  preferences: AppPreferences;
  onChange: (preferences: AppPreferences) => void;
  onClose: () => void;
}

export function SettingsDialog({ open, preferences, onChange, onClose }: SettingsDialogProps) {
  if (!open) return null;
  return <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}><section className="settings-dialog" role="dialog" aria-modal="true" aria-labelledby="settings-title"><header><div><span className="eyebrow">Application settings</span><h2 id="settings-title">Preferences</h2></div><button className="modal-close" onClick={onClose}>×</button></header><div className="settings-section"><strong>Interface density</strong><p>Choose how much information is shown within the control panels.</p><div className="settings-choice"><button className={preferences.density === "COMFORTABLE" ? "active" : ""} onClick={() => onChange({ ...preferences, density: "COMFORTABLE" })}>Comfortable</button><button className={preferences.density === "COMPACT" ? "active" : ""} onClick={() => onChange({ ...preferences, density: "COMPACT" })}>Compact</button></div></div><label className="settings-check"><input type="checkbox" checked={preferences.confirmBeforeOpen} onChange={(event) => onChange({ ...preferences, confirmBeforeOpen: event.target.checked })} /><span><strong>Confirm before opening another room</strong><small>Protects the current unsaved working plan.</small></span></label><div className="settings-section"><strong>Display units</strong><p>Choose how dimensions are presented. Calculations remain millimetre-authoritative.</p><div className="settings-choice unit-choice"><button className={preferences.units === "MM" ? "active" : ""} onClick={() => onChange({ ...preferences, units: "MM" })}>Millimetres</button><button className={preferences.units === "CM" ? "active" : ""} onClick={() => onChange({ ...preferences, units: "CM" })}>Centimetres</button><button className={preferences.units === "INCHES" ? "active" : ""} onClick={() => onChange({ ...preferences, units: "INCHES" })}>Inches</button><button className={preferences.units === "FEET_INCHES" ? "active" : ""} onClick={() => onChange({ ...preferences, units: "FEET_INCHES" })}>Feet + inches</button></div></div><button className="settings-done" onClick={onClose}>Done</button></section></div>;
}
