"use client";

import { useState, useSyncExternalStore } from "react";
import { getEngineeringUnitsSnapshot, getServerEngineeringUnitsSnapshot, parseEngineeringUnits, subscribeEngineeringUnits } from "@/lib/appPreferences";
import { engineeringDisplay } from "@/lib/cfdUnits";
import { CFDConfirmAction } from "./CFDConfirmAction";

function NumberInput({
  label,
  value,
  onChange,
  min,
  max,
  disabled = false,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  min?: number;
  max?: number;
  disabled?: boolean;
}) {
  const [draft, setDraft] = useState(String(value)),
    [lastValue, setLastValue] = useState(value);
  if (value !== lastValue) {
    setLastValue(value);
    setDraft(String(value));
  }
  return (
    <label>
      {label}
      <input
        type="number"
        aria-label={label}
        value={draft}
        step="any"
        min={min}
        max={max}
        disabled={disabled}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => {
          const next = Number(draft);
          setDraft(String(value));
          if (draft.trim() && Number.isFinite(next) && next !== value)
            onChange(next);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            e.currentTarget.blur();
          }
          if (e.key === "Escape") {
            e.preventDefault();
            setDraft(String(value));
          }
        }}
      />
    </label>
  );
}
export function CFDNumber({ convert = true, ...props }: Parameters<typeof NumberInput>[0] & { convert?: boolean }) {
  const raw = useSyncExternalStore(subscribeEngineeringUnits, getEngineeringUnitsSnapshot, getServerEngineeringUnitsSnapshot);
  const display = engineeringDisplay(props.label, convert ? parseEngineeringUnits(raw) : {});
  return <NumberInput {...props} key={display.label} label={display.label} value={display.to(props.value)}
    min={props.min === undefined ? undefined : display.to(props.min)} max={props.max === undefined ? undefined : display.to(props.max)}
    onChange={value => props.onChange(display.from(value))} />;
}
export function CFDText({
  label,
  value,
  onChange,
  maxLength = 120,
}: {
  label: string;
  value: string;
  onChange: (s: string) => void;
  maxLength?: number;
}) {
  const [draft, setDraft] = useState(value),
    [lastValue, setLastValue] = useState(value);
  if (value !== lastValue) {
    setLastValue(value);
    setDraft(value);
  }
  return (
    <label>
      {label}
      <input
        aria-label={label}
        maxLength={maxLength}
        value={draft}
        onChange={(e) => {
          setDraft(e.target.value);
          if (e.target.value.trim()) onChange(e.target.value);
        }}
        onBlur={() => setDraft(value)}
      />
    </label>
  );
}
const LABELS: Record<string, string> = {
  densityKgM3: "Air density (kg/m³)",
  dynamicViscosityPaS: "Dynamic viscosity (Pa·s)",
  heatCapacityJKgK: "Heat capacity (J/kg·K)",
  conductivityWMK: "Thermal conductivity (W/m·K)",
  prandtl: "Prandtl number",
  expansionPerK: "Thermal expansion (1/K)",
  referencePressurePa: "Reference pressure (Pa)",
  initialPressurePa: "Initial relative pressure (Pa)",
  gravityMS2: "Gravity (m/s²)",
  initialVelocityMS: "Initial velocity (m/s)",
  humidityFraction: "Relative humidity (0–1)",
  initialK: "Initial turbulent k (m²/s²)",
  initialEpsilon: "Initial ε (m²/s³)",
  initialOmega: "Initial ω (1/s)",
  turbulenceIntensity: "Turbulence intensity (0–1)",
  turbulenceLengthM: "Turbulence length (m)",
  roughnessM: "Equivalent roughness (m)",
  radiantFraction: "Radiant heat fraction (0–1)",
  cpu: "Requested CPU cores",
  writeEveryIterations: "Write fields every N iterations",
  minVolumeM3: "Minimum cell volume intent (m³)",
  targetYPlus: "Target y+ (not achieved)",
  geometryToleranceMm: "Cleanup tolerance intent (mm)",
  snapToleranceMm: "Snap tolerance intent (mm)",
  targetCells: "Target cell count",
  maxCells: "Maximum cell budget",
  allowablePolygon: "Allowable movement polygon (U,V: 0–1)",
  locked: "Lock position for future optimization",
  refinementMm: "Local refinement intent (mm)",
  maxCourant: "Maximum Courant intent",
  maxNonOrthogonality: "Maximum non-orthogonality (°)",
  coverage: "Minimum layer coverage (0–1)",
  objectId: "Source object ID",
  boussinesq: "Boussinesq buoyancy",
  energy: "Energy equation",
  co2: "CO₂ transport",
  co2Ppm: "CO₂ concentration (ppm)",
  scalarPpm: "Inflow / reference CO₂ (ppm)",
};
export const labelFor = (key: string) =>
  LABELS[key] ??
  key
    .replace(/Mm$/, " (mm)")
    .replace(/MS2$/, " (m/s²)")
    .replace(/M3S$/, " (m³/s)")
    .replace(/KgM3$/, " (kg/m³)")
    .replace(/PaS$/, " (Pa·s)")
    .replace(/JKgK$/, " (J/kg·K)")
    .replace(/WMK$/, " (W/m·K)")
    .replace(/PerK$/, " (1/K)")
    .replace(/Ppm$/, " (ppm)")
    .replace(/K$/, " (K)")
    .replace(/S$/, " (s)")
    .replace(/Gb$/, " (GB)")
    .replace(/Deg$/, " (°)")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/^./, (s) => s.toUpperCase());
const CHOICES: Record<string, string[]> = {
  coupling: ["SIMPLE", "PIMPLE"],
  gradient: ["linear", "limitedLinear"],
  convection: ["upwind", "linearUpwind", "limitedLinear"],
  monitor: ["flowBalance", "temperature", "co2"],
  objective: ["comfort", "co2", "uniformity", "pressureLoss"],
  shape: ["box", "sphere", "object"],
  scalarType: ["zeroFlux", "concentration", "flux"],
};
const replaceAt = <T,>(values: T[], index: number, value: T) => values.map((old, at) => at === index ? value : old);
const numeric = (value: unknown): value is number[] => Array.isArray(value) && value.every(item => typeof item === "number");

/** One vector control keeps axis labels, units and immutable updates consistent. */
export function CFDVector({ label, value, onChange, unit, axes = ["X", "Y", "Z"] }: {
  label: string; value: number[]; onChange: (value: number[]) => void; unit?: string; axes?: string[];
}) {
  return <div className="cfx-grid cfx-three">{value.map((number, index) =>
    <CFDNumber key={index} label={`${label} ${axes[index] ?? index + 1}${unit ? ` (${unit})` : ""}`} value={number}
      onChange={next => onChange(replaceAt(value, index, next))} />)}</div>;
}

/** Structured expert controls preserve units and enum choices; no executable templates. */
export function Parameters({ value, onChange, omit = [], prefix = "" }: {
  value: Record<string, unknown>; onChange: (value: Record<string, unknown>) => void; omit?: string[]; prefix?: string;
}) {
  return <div className="cfx-grid">{Object.entries(value).filter(([key]) => !omit.includes(key)).map(([key, item]) =>
    <ParameterField key={key} name={key} item={item} prefix={prefix} onChange={next => onChange({ ...value, [key]: next })} />)}</div>;
}

function ParameterField({ name, item, prefix, onChange }: {
  name: string; item: unknown; prefix: string; onChange: (value: unknown) => void;
}) {
  const label = labelFor(name);
  if (typeof item === "number") return <CFDNumber label={prefix + label} value={item} onChange={onChange} />;
  if (typeof item === "boolean") return <label className="cfx-check">
    <input type="checkbox" checked={item} onChange={event => onChange(event.target.checked)} />{label}</label>;
  if (typeof item === "string") return <label>{label}{CHOICES[name]
    ? <select value={item} onChange={event => onChange(event.target.value)}>{CHOICES[name].map(option =>
      <option key={option} value={option}>{labelFor(option)}</option>)}</select>
    : <input value={item} maxLength={name === "notes" ? 2000 : 200} readOnly={name === "id"} onChange={event => onChange(event.target.value)} />}</label>;
  if (item === null) return <label>{label}<input value="" placeholder="Optional" onChange={event => onChange(event.target.value || null)} /></label>;
  if (Array.isArray(item)) return <ParameterArray name={name} values={item} onChange={onChange} />;
  if (item && typeof item === "object") return <details className="cfx-wide"><summary>{label}</summary>
    <Parameters value={item as Record<string, unknown>} onChange={onChange} prefix={label + " "} /></details>;
  return null;
}

function ParameterArray({ name, values, onChange }: { name: string; values: unknown[]; onChange: (value: unknown[]) => void }) {
  const label = labelFor(name), polygon = name === "allowablePolygon", probes = name === "probesMm";
  if (numeric(values) && values.length === 3) return <fieldset className="cfx-wide"><legend>{label}</legend>
    <CFDVector label={label} value={values} onChange={onChange} /></fieldset>;
  const remove = (index: number) => onChange(values.filter((_, at) => at !== index));
  return <fieldset className="cfx-wide"><legend>{probes ? "Probe positions (mm)" : label}</legend>
    {values.map((entry, index) => <div key={index} className={probes ? "cfx-probe-row" : "cfx-list-row"}
      role={probes ? "group" : undefined} aria-label={probes ? `Probe ${index + 1}` : undefined}>
      {numeric(entry) ? probes
        ? entry.map((number, axis) => <CFDNumber key={axis} label={`Probe ${index + 1} ${["X", "Y", "Z"][axis]} (mm)`} value={number}
          onChange={next => onChange(replaceAt(values, index, replaceAt(entry, axis, next)))} />)
        : <div className="cfx-grid">{entry.map((number, axis) => <CFDNumber key={axis} label={`${label} ${index + 1}.${axis + 1}`} value={number}
          onChange={next => onChange(replaceAt(values, index, replaceAt(entry, axis, next)))} />)}</div>
        : entry && typeof entry === "object" ? <Parameters value={entry as Record<string, unknown>}
          onChange={next => onChange(replaceAt(values, index, next))} prefix={`${label} ${index + 1} `} /> : null}
      <button disabled={polygon && values.length <= 3} aria-label={probes ? `Remove probe ${index + 1}` : `Remove ${label} ${index + 1}`}
        onClick={() => remove(index)}>Remove</button>
    </div>)}
    {polygon && values.length > 0 && <button onClick={() => onChange([])}>Clear movement region</button>}
    {probes && <CFDConfirmAction title="Clear all probes?" disabled={!values.length} description="Remove all monitoring positions from this simulation. Undo can restore them." onConfirm={() => onChange([])} />}
    <button disabled={probes && values.length >= 1000} onClick={() => onChange(polygon && !values.length
      ? [[.2, .2], [.8, .2], [.8, .8], [.2, .8]] : [...values, polygon ? [.5, .1] : [0, 0, 0]])}>
      {probes ? "Add probe" : `Add ${label.toLowerCase()}`}</button>
  </fieldset>;
}
