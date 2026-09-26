"use client";

export interface AppPreferences {
  density: "COMFORTABLE" | "COMPACT";
  confirmBeforeOpen: boolean;
  units: "MM" | "CM" | "INCHES" | "FEET" | "METERS";
}

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
        <div className="settings-section">
          <strong>Workspace density</strong>
          <p>Choose the amount of space used by planner controls.</p>
          <div className="settings-choice" role="group" aria-label="Workspace density">
            <button type="button" className={preferences.density === "COMFORTABLE" ? "active" : ""} aria-pressed={preferences.density === "COMFORTABLE"} onClick={() => onChange({ ...preferences, density: "COMFORTABLE" })}>Comfortable</button>
            <button type="button" className={preferences.density === "COMPACT" ? "active" : ""} aria-pressed={preferences.density === "COMPACT"} onClick={() => onChange({ ...preferences, density: "COMPACT" })}>Compact</button>
          </div>
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
