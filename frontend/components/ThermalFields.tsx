"use client";

import { useId, useState } from "react";
import type { ThermalOverride, ThermalSurface } from "@/lib/thermalDocument";

export function ThermalNumber({
  label,
  value,
  onChange,
  min = -1e12,
  max = 1e12,
  nullable = true,
  integer = false,
}: {
  label: string;
  value: number | null;
  onChange: (value: number | null) => void;
  min?: number;
  max?: number;
  nullable?: boolean;
  integer?: boolean;
}) {
  const errorId = useId();
  const [draft, setDraft] = useState(value === null ? "" : String(value));
  const [before, setBefore] = useState(value);
  const [error, setError] = useState("");
  if (before !== value) {
    setBefore(value);
    setDraft(value === null ? "" : String(value));
    setError("");
  }
  return (
    <label>
      {label}
      <input
        type="number"
        step={integer ? 1 : "any"}
        aria-label={label}
        aria-invalid={!!error}
        aria-describedby={error ? errorId : undefined}
        required={!nullable}
        min={min}
        max={max}
        placeholder={nullable ? "Not supplied" : undefined}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => {
          const n = draft.trim() ? Number(draft) : null;
          if (
            (n === null && !nullable) ||
            (n !== null &&
              (!Number.isFinite(n) ||
                n < min ||
                n > max ||
                (integer && !Number.isInteger(n))))
          ) {
            setError(
              `Enter ${integer ? "a whole number " : ""}${min}–${max}${nullable ? ", or leave blank" : ""}.`,
            );
            return;
          }
          setError("");
          if (n !== value) onChange(n);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            e.currentTarget.blur();
          }
          if (e.key === "Escape") {
            e.stopPropagation();
            setDraft(value === null ? "" : String(value));
            setError("");
          }
        }}
      />
      {error && (
        <small id={errorId} className="cfx-error" role="alert">
          {error}
        </small>
      )}
    </label>
  );
}
export function ThermalText({
  label,
  value,
  onChange,
  maxLength = 2000,
  type = "text",
  required = false,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  maxLength?: number;
  type?: string;
  required?: boolean;
}) {
  const errorId = useId();
  const [draft, setDraft] = useState(value),
    [before, setBefore] = useState(value);
  const [error, setError] = useState("");
  if (before !== value) {
    setBefore(value);
    setDraft(value);
    setError("");
  }
  return (
    <label>
      {label}
      <input
        type={type}
        aria-label={label}
        aria-invalid={!!error}
        aria-describedby={error ? errorId : undefined}
        required={required}
        value={required ? draft : value}
        maxLength={maxLength}
        onChange={(e) =>
          required ? setDraft(e.target.value) : onChange(e.target.value)
        }
        onBlur={() => {
          if (!required) return;
          const next = draft.trim();
          if (!next) {
            setError(
              "Enter a name, or press Escape to restore the saved name.",
            );
            return;
          }
          setError("");
          setDraft(next);
          if (next !== value) onChange(next);
        }}
        onKeyDown={(e) => {
          if (!required) return;
          if (e.key === "Enter") {
            e.preventDefault();
            e.currentTarget.blur();
          }
          if (e.key === "Escape") {
            e.stopPropagation();
            setDraft(value);
            setError("");
          }
        }}
      />
      {error && (
        <small id={errorId} className="cfx-error" role="alert">
          {error}
        </small>
      )}
    </label>
  );
}
export function SurfaceOverride({
  face,
  value,
  onChange,
  onReset,
  assemblies,
}: {
  face: ThermalSurface;
  value: ThermalOverride;
  onChange: (v: ThermalOverride) => void;
  onReset: () => void;
  assemblies: { assemblyId: string; name: string }[];
}) {
  const edit = (patch: Partial<ThermalOverride>) =>
    onChange({ ...value, ...patch, updatedAt: new Date().toISOString() });
  const number = (
    key:
      | "uWm2K"
      | "rsi"
      | "rse"
      | "ambientC"
      | "alpha"
      | "emissivity"
      | "gValue"
      | "shadingFactor"
      | "externalH"
      | "incidentWm2"
      | "longwaveWm2"
      | "fixedFluxWm2"
      | "fixedTemperatureC",
    label: string,
    min: number,
    max: number,
  ) => (
    <ThermalNumber
      key={key}
      label={label}
      value={value[key]}
      min={min}
      max={max}
      onChange={(n) => edit({ [key]: n })}
    />
  );
  return (
    <section
      className="cfx-card thermal-override"
      aria-label="Surface thermal override"
    >
      <h3>CFD-only override</h3>
      <p className="cfx-caption">
        Source insulation is unchanged. Confirm again whenever its construction
        changes.
      </p>
      <ThermalText
        label="Override reason / source"
        value={value.reason}
        onChange={(reason) => edit({ reason })}
      />
      <label>
        Existing construction library
        <select
          aria-label="Override construction library"
          value={value.assemblyId ?? ""}
          onChange={(e) =>
            edit({
              assemblyId: e.target.value || null,
              acknowledgedAssemblyRevision: "",
            })
          }
        >
          <option value="">Use surface source assembly</option>
          {assemblies.map((a) => (
            <option key={a.assemblyId} value={a.assemblyId}>
              {a.name}
            </option>
          ))}
        </select>
      </label>
      <div className="cfx-grid">
        {number("uWm2K", "Overall / construction U (W/m²K)", 0.000001, 100)}
        <label>
          Entered U includes films
          <select
            aria-label="Entered U includes films"
            value={
              value.uIncludesFilms === null
                ? "unknown"
                : String(value.uIncludesFilms)
            }
            onChange={(e) =>
              edit({
                uIncludesFilms:
                  e.target.value === "unknown"
                    ? null
                    : e.target.value === "true",
              })
            }
          >
            <option value="unknown">Declare when overriding U</option>
            <option value="true">Yes · overall U</option>
            <option value="false">No · add explicit Rsi &amp; Rse</option>
          </select>
        </label>
        {number("rsi", "Inside film Rsi (m²K/W)", 0, 10)}
        {number("rse", "Outside film Rse (m²K/W)", 0, 10)}
        <label>
          Exposure override
          <select
            value={value.exposure}
            onChange={(e) =>
              edit({ exposure: e.target.value as ThermalOverride["exposure"] })
            }
          >
            <option value="auto">From topology / Insulation</option>
            <option value="outdoors">Outdoors</option>
            <option value="ground">Ground</option>
            <option value="adjacent">Adjacent zone</option>
            <option value="adiabatic">Adiabatic</option>
          </select>
        </label>
        {number("ambientC", "Boundary ambient temperature (°C)", -100, 200)}
        {number("alpha", "Solar absorptance α (0–1)", 0, 1)}
        {number("emissivity", "Emissivity ε (metadata only)", 0, 1)}
        {number("gValue", "Glazing g / SHGC (0–1)", 0, 1)}
        {number("shadingFactor", "Solar multiplier (0–1)", 0, 1)}
        {number("incidentWm2", "Per-face incident solar (W/m²)", 0, 3000)}
        {number("externalH", "Sol-air exterior h (W/m²K)", 0.001, 1000)}
        {number("longwaveWm2", "Net longwave correction (W/m²)", -2000, 2000)}
        <label>
          Thermal method
          <select
            value={value.method}
            onChange={(e) =>
              edit({ method: e.target.value as ThermalOverride["method"] })
            }
          >
            <option value="inherit">Inherit global method</option>
            <option value="robin">Robin · remove Rsi once</option>
            <option value="fixedFlux">
              Fixed flux · reference approximation
            </option>
            <option value="temperature">
              Prescribed inner-surface temperature
            </option>
            <option value="adiabatic">Adiabatic</option>
          </select>
        </label>
        {value.method === "fixedFlux" &&
          number(
            "fixedFluxWm2",
            "Forced constant flux into room (W/m²)",
            -1e5,
            1e5,
          )}
        {value.method === "temperature" &&
          number(
            "fixedTemperatureC",
            "Inner-surface temperature (°C)",
            -100,
            200,
          )}
      </div>
      <label className="cfx-check">
        <input
          type="checkbox"
          checked={
            value.acknowledgedAssemblyRevision === face.insulationRevision
          }
          onChange={(e) =>
            edit({
              acknowledgedAssemblyRevision: e.target.checked
                ? face.insulationRevision
                : "",
            })
          }
        />
        I reviewed this override against the current source construction
      </label>
      <button onClick={onReset}>Reset to Insulation</button>
    </section>
  );
}
