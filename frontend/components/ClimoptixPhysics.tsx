"use client";

import type { ReactNode } from "react";
import { CFDCollapseAll } from "./CFDCollapseAll";
import { physicsPreset, type CFDScenario } from "@/lib/climoptixDocument";
import { Parameters } from "./CFDFields";

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
  return (
    <section data-cfx-collapse-root className="cfx-physics-panel">
      <div className="cfx-inline-toolbar">{actions}<CFDCollapseAll /></div>
      <details open><summary>Models &amp; equations</summary>
      <div className="cfx-grid cfx-physics-primary">
      <label>
        Physics preset
        <select
          aria-label="Physics preset"
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
      <Parameters value={p} omit={Object.keys(p).filter(k => !["energy", "co2", "boussinesq"].includes(k))}
        onChange={v => onChange({ ...scenario, physics: { ...v, preset: "custom" } as typeof p })} />
      </details>
      {([
        ["Fluid properties", ["densityKgM3", "dynamicViscosityPaS", "heatCapacityJKgK", "conductivityWMK", "prandtl", "expansionPerK"]],
        ["Reference & ambient conditions", ["referenceTemperatureK", "referencePressurePa", "outdoorTemperatureK", "humidityFraction", "gravityMS2", "outdoorCo2Ppm"]],
      ] as const).map(([title, keys]) => <details open key={title}><summary>{title}</summary>
        <Parameters value={p} omit={Object.keys(p).filter(k => !(keys as readonly string[]).includes(k))}
          onChange={v => onChange({ ...scenario, physics: { ...v, preset: "custom" } as typeof p })} />
      </details>)}
      <details>
        <summary>Initial fields</summary>
        <Parameters
          value={p}
          omit={[
            "preset",
            "mode",
            "energy",
            "co2",
            "boussinesq",
            "turbulence",
            "densityKgM3",
            "dynamicViscosityPaS",
            "heatCapacityJKgK",
            "conductivityWMK",
            "prandtl",
            "expansionPerK",
            "referenceTemperatureK",
            "referencePressurePa",
            "outdoorTemperatureK",
            "humidityFraction",
            "gravityMS2",
            "outdoorCo2Ppm",
            "time",
            "numerics",
          ]}
          onChange={(v) => onChange({ ...scenario, physics: v as typeof p })}
        />
        <p>
          Kinematic viscosity ν = μ/ρ ={" "}
          {(p.dynamicViscosityPaS / p.densityKgM3).toExponential(3)} m²/s.
        </p>
      <p className="cfx-caption">Configure requested outputs and probe positions in Solver → Post.</p>
      </details>
    </section>
  );
}
