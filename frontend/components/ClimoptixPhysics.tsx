"use client";

import type { ReactNode } from "react";
import { CFDCollapseAll } from "./CFDCollapseAll";
import { physicsPreset, type CFDScenario } from "@/lib/climoptixDocument";
import { Parameters } from "./CFDFields";
import { useHvac } from "./HvacContext";
import { requiresHvacThermalExecution } from "@/lib/hvacBridge";

export function PhysicsPanel({
  scenario,
  onChange,
  actions,
}: {
  actions?:ReactNode;
  scenario: CFDScenario;
  onChange: (s: CFDScenario) => void;
}) {
  const p = scenario.physics;
  const ctx = useHvac();
  const binding = ctx?.project.hvac?.bindings[scenario.id];
  const linked = !!binding?.operatingScenarioId;
  const airflow = binding?.analysisMode === "airflow";
  const thermalSource = !!ctx && requiresHvacThermalExecution(ctx.project, { ...scenario, sharedBoundaries: undefined });
  const fields = (keys: (keyof typeof p)[], markCustom = true) => <Parameters value={p}
    omit={Object.keys(p).filter(key => !keys.includes(key as keyof typeof p))}
    onChange={value => onChange({ ...scenario, physics: { ...p, ...value, preset: markCustom ? "custom" : p.preset } })} />;
  return (
    <section data-cfx-collapse-root className="cfx-physics-panel">
      <div className="cfx-inline-toolbar">{actions}<CFDCollapseAll /></div>
      <details open><summary>Models &amp; equations</summary>
      <div className="cfx-grid cfx-physics-primary">
      <label>
        Physics preset
        <select
          aria-label="Physics preset"
          disabled={thermalSource || airflow}
          value={p.preset}
          onChange={(e) =>
            onChange({
              ...scenario,
              physics:
                e.target.value === "custom"
                  ? { ...p, preset: "custom" }
                  : physicsPreset(e.target.value as typeof p.preset),
            })
          }
        >
          <option value="isothermal">Isothermal ventilation</option>
          <option value="buoyant">Buoyant thermal airflow</option>
          <option value="co2">Thermal + CO₂ transport</option>
          <option value="custom">Custom</option>
        </select>
      </label>
        <label>
          Turbulence
          <select
            value={p.turbulence}
            onChange={(e) =>
              onChange({
                ...scenario,
                physics: {
                  ...p,
                  turbulence: e.target.value as typeof p.turbulence,
                },
              })
            }
          >
            <option value="laminar">Laminar</option>
            <option value="kEpsilon">RANS · k–ε</option>
            <option value="kOmegaSST">RANS · k–ω SST</option>
          </select>
        </label>
      </div>
      {airflow && <p className="cfx-notice">Airflow study. The worker calculates velocity and pressure from the measured geometry and vent flows. Use Prepare thermal CFD in Heating or Ventilation to capture heat transfer.</p>}
      {linked && thermalSource && <p className="cfx-notice">Linked HVAC scenario: energy and buoyancy are required. Density, cp, reference room temperature and outdoor temperature edit the same conventional operating conditions. Thermal execution is unavailable on the isothermal worker.</p>}
      {thermalSource && !linked && <p className="cfx-notice">Shared Heating or Insulation conditions require energy and buoyancy. Air properties remain case settings; thermal execution needs a compatible energy adapter.</p>}
      {!airflow && <Parameters value={p} omit={Object.keys(p).filter(k => !(thermalSource ? ["co2"] : ["energy", "co2", "boussinesq"]).includes(k))}
        onChange={v => onChange({ ...scenario, physics: { ...v, preset: "custom" } as typeof p })} />}
      </details>
      <details open><summary>Fluid properties</summary>
        {fields(["densityKgM3", "dynamicViscosityPaS", "heatCapacityJKgK", "conductivityWMK", "prandtl", "expansionPerK"])}
      </details>
      <details open><summary>Reference &amp; ambient conditions</summary>
        <fieldset><legend>Temperature, pressure &amp; humidity</legend>
          {fields(["referenceTemperatureK", "referencePressurePa", "outdoorTemperatureK", "humidityFraction"])}
        </fieldset>
        {fields(["gravityMS2"])}
        <fieldset><legend>Outdoor air composition</legend>{fields(["outdoorCo2Ppm"])}</fieldset>
      </details>
      <details>
        <summary>Initial fields</summary>
        {fields(["initialVelocityMS"], false)}
        <fieldset><legend>Pressure, temperature &amp; concentration</legend>
          {fields(["initialPressurePa", "initialTemperatureK", "initialCo2Ppm"], false)}
        </fieldset>
        <fieldset><legend>Turbulence</legend>
          {fields(["initialK", "initialEpsilon", "initialOmega"], false)}
        </fieldset>
        <p>
          Kinematic viscosity ν = μ/ρ ={" "}
          {(p.dynamicViscosityPaS / p.densityKgM3).toExponential(3)} m²/s.
        </p>
      <p className="cfx-caption">Configure requested outputs and probe positions in Solver → Post.</p>
      </details>
    </section>
  );
}
