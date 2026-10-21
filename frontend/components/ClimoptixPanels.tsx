"use client";

import { useState } from "react";
import {
  assetOverrideSchema,
  boundarySchema,
  meshPreset,
  physicsPreset,
  ventSchema,
  type CFDBoundary,
  type CFDScenario,
  type CFDVent,
  type PatchKind,
  PATCH_KINDS,
} from "@/lib/climoptixDocument";
import type { CFDReport } from "@/lib/climoptix";
import { projectFloors } from "@/lib/buildingDocument";
import type { ProjectDocument } from "@/lib/projectDocument";
import {
  refinementLevel,
  refinementColour,
  refinementCell,
} from "@/lib/climoptixWorkflow";

export function CFDNumber({
  label,
  value,
  onChange,
  min,
  max,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  min?: number;
  max?: number;
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
        onBlur={() => {
          if (!draft.trim()) setDraft(value);
        }}
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
const labelFor = (key: string) =>
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
/** Structured expert controls preserve units and enum choices; no executable templates. */
export function Parameters({
  value,
  onChange,
  omit = [],
  prefix = "",
}: {
  value: Record<string, unknown>;
  onChange: (v: Record<string, unknown>) => void;
  omit?: string[];
  prefix?: string;
}) {
  return (
    <div className="cfx-grid">
      {Object.entries(value)
        .filter(([k]) => !omit.includes(k))
        .map(([key, item]) => {
          const label = labelFor(key),
            change = (next: unknown) => onChange({ ...value, [key]: next });
          if (typeof item === "number")
            return (
              <CFDNumber
                key={key}
                label={`${prefix}${label}`}
                value={item}
                onChange={change}
              />
            );
          if (typeof item === "boolean")
            return (
              <label className="cfx-check" key={key}>
                <input
                  type="checkbox"
                  checked={item}
                  onChange={(e) => change(e.target.checked)}
                />
                {label}
              </label>
            );
          if (typeof item === "string")
            return (
              <label key={key}>
                {label}
                {CHOICES[key] ? (
                  <select value={item} onChange={(e) => change(e.target.value)}>
                    {CHOICES[key].map((option) => (
                      <option key={option} value={option}>
                        {labelFor(option)}
                      </option>
                    ))}
                  </select>
                ) : (
                  <input
                    value={item}
                    maxLength={key === "notes" ? 2000 : 200}
                    readOnly={key === "id"}
                    onChange={(e) => change(e.target.value)}
                  />
                )}
              </label>
            );
          if (item === null)
            return (
              <label key={key}>
                {label}
                <input
                  value=""
                  placeholder="Optional"
                  onChange={(e) => change(e.target.value || null)}
                />
              </label>
            );
          if (Array.isArray(item)) {
            if (item.length === 3 && item.every((x) => typeof x === "number"))
              return (
                <fieldset className="cfx-wide" key={key}>
                  <legend>{label}</legend>
                  <div className="cfx-grid cfx-three">
                    {item.map((v, i) => (
                      <CFDNumber
                        key={i}
                        label={`${label} ${["X", "Y", "Z"][i]}`}
                        value={v}
                        onChange={(n) =>
                          change(item.map((x, j) => (i === j ? n : x)))
                        }
                      />
                    ))}
                  </div>
                </fieldset>
              );
            return (
              <fieldset className="cfx-wide" key={key}>
                <legend>{label}</legend>
                {item.map((entry, i) => (
                  <div className="cfx-list-row" key={i}>
                    {Array.isArray(entry) ? (
                      <div className="cfx-grid">
                        {entry.map((v, j) => (
                          <CFDNumber
                            key={j}
                            label={`${label} ${i + 1}.${j + 1}`}
                            value={v}
                            onChange={(n) =>
                              change(
                                item.map((x, k) =>
                                  k === i
                                    ? entry.map((a, b) => (j === b ? n : a))
                                    : x,
                                ),
                              )
                            }
                          />
                        ))}
                      </div>
                    ) : (
                      <Parameters
                        value={entry as Record<string, unknown>}
                        onChange={(v) =>
                          change(item.map((x, k) => (k === i ? v : x)))
                        }
                        prefix={`${label} ${i + 1} `}
                      />
                    )}
                    <button
                      disabled={key === "allowablePolygon" && item.length <= 3}
                      onClick={() => change(item.filter((_, k) => k !== i))}
                      aria-label={`Remove ${label} ${i + 1}`}
                    >
                      Remove
                    </button>
                  </div>
                ))}
                {key === "allowablePolygon" && item.length > 0 && (
                  <button onClick={() => change([])}>
                    Clear movement region
                  </button>
                )}
                <button
                  onClick={() =>
                    change(
                      key === "allowablePolygon" && !item.length
                        ? [
                            [0.2, 0.2],
                            [0.8, 0.2],
                            [0.8, 0.8],
                            [0.2, 0.8],
                          ]
                        : [
                            ...item,
                            key === "allowablePolygon" ? [0.5, 0.1] : [0, 0, 0],
                          ],
                    )
                  }
                >
                  Add {label.toLowerCase()}
                </button>
              </fieldset>
            );
          }
          if (item && typeof item === "object")
            return (
              <details className="cfx-wide" key={key}>
                <summary>{label}</summary>
                <Parameters
                  value={item as Record<string, unknown>}
                  onChange={change}
                  prefix={`${label} `}
                />
              </details>
            );
          return null;
        })}
    </div>
  );
}
export function DomainPanel({
  project,
  scenario,
  report,
  onChange,
}: {
  project: ProjectDocument;
  scenario: CFDScenario;
  report: CFDReport | null;
  onChange: (s: CFDScenario) => void;
}) {
  const floors = projectFloors(project),
    floor = floors.find((f) => f.id === scenario.seed?.floorId) ?? floors[0];
  return (
    <>
      <p className="cfx-intro">
        Choose one seed room. Permanent passages and physical slab voids expand
        the connected air volume. Doors and windows always stop it—even when
        open.
      </p>
      <label>
        Seed floor
        <select
          aria-label="Seed floor"
          value={floor.id}
          onChange={(e) => {
            const f = floors.find((f) => f.id === e.target.value)!;
            onChange({
              ...scenario,
              seed: f.content.rooms[0]
                ? { floorId: f.id, roomId: f.content.rooms[0].id }
                : null,
            });
          }}
        >
          {floors.map((f) => (
            <option key={f.id} value={f.id}>
              {f.name}
            </option>
          ))}
        </select>
      </label>
      <label>
        Seed room
        <select
          aria-label="Seed room"
          value={scenario.seed?.roomId ?? ""}
          onChange={(e) =>
            onChange({
              ...scenario,
              seed: e.target.value
                ? { floorId: floor.id, roomId: e.target.value }
                : null,
            })
          }
        >
          <option value="">Choose a room…</option>
          {floor.content.rooms.map((r) => (
            <option key={r.id} value={r.id}>
              {r.name}
            </option>
          ))}
        </select>
      </label>
      {!floor.content.rooms.length && (
        <p className="cfx-notice">
          This floor has no measured enclosed rooms. Draw one in Floorplan
          first; switching workspaces preserves this study.
        </p>
      )}
      {report && (
        <>
          <div className="cfx-metrics">
            <div>
              <small>Connected rooms</small>
              <strong>{report.domain.includedRoomIds.length}</strong>
            </div>
            <div>
              <small>
                {report.surface.closed
                  ? "Last checked air volume"
                  : "Unverified signed volume"}
              </small>
              <strong>{report.domain.volumeM3.toFixed(2)} m³</strong>
            </div>
          </div>
          <h3>Connectivity inspector</h3>
          <p className="cfx-caption">
            Connected floors:{" "}
            {report.domain.floorIds
              .map((id) => floors.find((f) => f.id === id)?.name ?? id)
              .join(", ") || "None"}
          </p>
          {report.domain.boundsMm && (
            <p className="cfx-caption">
              Last checked bounds (X × Y × Z):{" "}
              {report.domain.boundsMm[0]
                .map((v, i) => Math.round(report.domain.boundsMm![1][i] - v))
                .join(" × ")}{" "}
              mm
            </p>
          )}
          <ul className="cfx-inspector-list">
            {report.domain.regions.map((r) => (
              <li key={r.id}>
                <strong>{r.name}</strong>
                <span>
                  {r.included ? "Included" : "Excluded · disconnected"} ·{" "}
                  {floors.find((f) => f.id === r.floorId)?.name ?? r.floorId}
                </span>
                <small>
                  Elevation {r.baseMm} mm · ceiling{" "}
                  {r.ceilingRangeMm
                    .map((v) => Math.round(v - r.baseMm))
                    .join("–")}{" "}
                  mm
                </small>
              </li>
            ))}
          </ul>
          <h3>Passages &amp; stops</h3>
          {report.domain.portals.map((p) => (
            <div className="cfx-notice" key={p.id}>
              <strong>
                {p.traversed ? "↔ Connected" : "STOP"} · {p.kind}
              </strong>
              <small>
                {p.reason} · {p.rooms.join(" ↔ ")}
              </small>
            </div>
          ))}
          {report.domain.slabVoids.map((v) => (
            <div key={v.id} className="cfx-notice">
              ↕ Physical slab void · {v.id}
            </div>
          ))}
        </>
      )}
    </>
  );
}
export function EquipmentPanel({
  scenario,
  report,
  selected,
  onSelect,
  onChange,
  onPick,
  onEditSource,
}: {
  scenario: CFDScenario;
  report: CFDReport | null;
  selected: string | null;
  onSelect: (id: string) => void;
  onChange: (s: CFDScenario) => void;
  onPick: (role: "supply" | "extract") => void;
  onEditSource: () => void;
}) {
  const [flowUnit, setFlowUnit] = useState("L/s");
  const selectedObjectId =
    report?.patches.find((p) => p.kind === "object" && p.id === selected)
      ?.sourceId ?? selected;
  const vent =
    scenario.vents.find((v) => `vent:${v.id}` === selected) ??
    scenario.vents[0];
  const hosts = report?.patches.filter((p) => p.hostable && p.host) ?? [];
  const edit = (v: CFDVent) =>
    onChange({
      ...scenario,
      vents: scenario.vents.map((a) => (a.id === v.id ? v : a)),
    });
  const add = (role: "supply" | "extract") => {
    if (!hosts.length) return;
    const v = ventSchema.parse({
      id: crypto.randomUUID(),
      name: role === "supply" ? "Supply vent" : "Extract vent",
      role,
      host: { patchId: hosts[0].id },
    });
    onChange({ ...scenario, vents: [...scenario.vents, v] });
    onSelect(`vent:${v.id}`);
  };
  const derived = report?.vents.find((v) => v.id === vent?.id);
  const flowFactor = flowUnit === "L/s" ? 1000 : flowUnit === "m³/h" ? 3600 : 1;
  return (
    <>
      <p className="cfx-intro">
        Vents are apertures on real room-facing surfaces. Flow sign comes from
        Supply/Extract, not from a negative flow rate. Drag a vent in 3D or use
        precise host coordinates below.
      </p>
      <div className="cfx-actions">
        <button disabled={!hosts.length} onClick={() => add("supply")}>
          + Supply
        </button>
        <button disabled={!hosts.length} onClick={() => add("extract")}>
          + Extract
        </button>
        <button disabled={!hosts.length} onClick={() => onPick("supply")}>
          Place on face…
        </button>
      </div>
      {!hosts.length && (
        <p className="cfx-notice">
          Validate a seed room to discover available wall/ceiling hosts.
        </p>
      )}
      {!!scenario.vents.length && (
        <label>
          Device
          <select
            aria-label="Selected CFD vent"
            value={vent?.id}
            onChange={(e) => onSelect(`vent:${e.target.value}`)}
          >
            {scenario.vents.map((v) => (
              <option key={v.id} value={v.id}>
                {v.name} · {v.role}
              </option>
            ))}
          </select>
        </label>
      )}
      {vent && (
        <section className="cfx-card">
          <CFDText
            label="Vent name"
            value={vent.name}
            onChange={(name) => edit({ ...vent, name })}
          />
          <div className="cfx-grid">
            <label>
              Role
              <select
                value={vent.role}
                onChange={(e) =>
                  edit({ ...vent, role: e.target.value as CFDVent["role"] })
                }
              >
                <option value="supply">Supply</option>
                <option value="extract">Extract</option>
              </select>
            </label>
            <label>
              Shape
              <select
                value={vent.shape}
                onChange={(e) =>
                  edit({ ...vent, shape: e.target.value as CFDVent["shape"] })
                }
              >
                <option value="rectangle">Rectangle</option>
                <option value="circle">Circle</option>
              </select>
            </label>
          </div>
          <label>
            Host face
            <select
              aria-label="Vent host face"
              value={vent.host.patchId}
              onChange={(e) =>
                edit({
                  ...vent,
                  host: { ...vent.host, patchId: e.target.value },
                })
              }
            >
              {!hosts.some((h) => h.id === vent.host.patchId) && (
                <option value={vent.host.patchId}>
                  Missing host · reassign
                </option>
              )}
              {hosts.map((h) => (
                <option key={h.id} value={h.id}>
                  {h.label ?? labelFor(h.kind)} ·{" "}
                  {report?.domain.regions.find((r) => r.id === h.roomId)
                    ?.name ?? h.roomId}
                </option>
              ))}
            </select>
          </label>
          <div className="cfx-grid">
            <CFDNumber
              label="Host U (0–1)"
              value={vent.host.u}
              onChange={(u) => edit({ ...vent, host: { ...vent.host, u } })}
            />
            <CFDNumber
              label="Host V (0–1)"
              value={vent.host.v}
              onChange={(v) => edit({ ...vent, host: { ...vent.host, v } })}
            />
            {vent.shape === "rectangle" ? (
              <>
                <CFDNumber
                  label="Vent width (mm)"
                  value={vent.widthMm}
                  onChange={(widthMm) => edit({ ...vent, widthMm })}
                />
                <CFDNumber
                  label="Vent height (mm)"
                  value={vent.heightMm}
                  onChange={(heightMm) => edit({ ...vent, heightMm })}
                />
              </>
            ) : (
              <CFDNumber
                label="Vent diameter (mm)"
                value={vent.diameterMm}
                onChange={(diameterMm) => edit({ ...vent, diameterMm })}
              />
            )}
            <CFDNumber
              label="Vent rotation (°)"
              value={vent.rotationDeg}
              onChange={(rotationDeg) => edit({ ...vent, rotationDeg })}
            />
            <CFDNumber
              label="Open area fraction (0–1)"
              value={vent.openAreaFraction}
              onChange={(openAreaFraction) =>
                edit({ ...vent, openAreaFraction })
              }
            />
          </div>
          <label>
            Controlling quantity
            <select
              aria-label="Vent controlling quantity"
              value={vent.control}
              onChange={(e) =>
                edit({ ...vent, control: e.target.value as CFDVent["control"] })
              }
            >
              <option value="volumeFlow">Volume flow</option>
              <option value="massFlow">Mass flow (kg/s)</option>
              <option value="velocity">Mean velocity (m/s)</option>
              <option value="pressure">Pressure (Pa)</option>
            </select>
          </label>
          {vent.control === "volumeFlow" && (
            <label>
              Flow display unit
              <select
                aria-label="Flow display unit"
                value={flowUnit}
                onChange={(e) => setFlowUnit(e.target.value)}
              >
                {["L/s", "m³/h", "m³/s"].map((u) => (
                  <option key={u}>{u}</option>
                ))}
              </select>
            </label>
          )}
          <CFDNumber
            label={
              vent.control === "volumeFlow"
                ? `Volume flow (${flowUnit})`
                : vent.control === "massFlow"
                  ? "Mass flow (kg/s)"
                  : vent.control === "velocity"
                    ? "Mean velocity (m/s)"
                    : "Relative pressure (Pa)"
            }
            value={
              vent.valueSI * (vent.control === "volumeFlow" ? flowFactor : 1)
            }
            onChange={(v) =>
              edit({
                ...vent,
                valueSI: v / (vent.control === "volumeFlow" ? flowFactor : 1),
              })
            }
          />
          <div className="cfx-grid">
            <CFDNumber
              label="Supply / inflow temperature (K)"
              value={vent.temperatureK}
              onChange={(temperatureK) => edit({ ...vent, temperatureK })}
            />
            <CFDNumber
              label="Inflow CO₂ (ppm)"
              value={vent.co2Ppm}
              onChange={(co2Ppm) => edit({ ...vent, co2Ppm })}
            />
          </div>
          {derived && (
            <p className="cfx-notice">
              Actual {derived.actualAreaM2.toPrecision(4)} m² · effective{" "}
              {derived.effectiveAreaM2.toPrecision(4)} m²
              {derived.meanVelocityMS !== null && (
                <> · {derived.meanVelocityMS.toPrecision(3)} m/s</>
              )}
            </p>
          )}
          <details>
            <summary>
              Jet, discharge, grouping &amp; placement constraints
            </summary>
            <Parameters
              value={vent}
              omit={[
                "id",
                "name",
                "role",
                "shape",
                "host",
                "widthMm",
                "heightMm",
                "diameterMm",
                "rotationDeg",
                "openAreaFraction",
                "control",
                "valueSI",
                "temperatureK",
                "co2Ppm",
              ]}
              onChange={(v) => edit(v as CFDVent)}
            />
            <p className="cfx-caption">
              Optimization lock and allowable host-local polygon are metadata
              only; no optimizer is connected. A recirculating unit needs
              separate supply and return devices.
            </p>
          </details>
          <div className="cfx-actions">
            <button
              onClick={() => {
                const copy = {
                  ...structuredClone(vent),
                  id: crypto.randomUUID(),
                  name: vent.name.slice(0, 115) + " copy",
                  host: { ...vent.host, u: Math.min(0.9, vent.host.u + 0.15) },
                };
                onChange({ ...scenario, vents: [...scenario.vents, copy] });
                onSelect(`vent:${copy.id}`);
              }}
            >
              Duplicate
            </button>
            <button
              className="cfx-danger"
              onClick={() =>
                onChange({
                  ...scenario,
                  vents: scenario.vents.filter((v) => v.id !== vent.id),
                })
              }
            >
              Delete vent
            </button>
          </div>
        </section>
      )}
      <h3>Objects &amp; occupants</h3>
      <button onClick={onEditSource}>Edit source building &amp; assets</button>
      <p className="cfx-caption">
        Source assets stay in the shared floorplan. Overrides change only this
        study. Emissions start at zero; supply calibrated inputs. CO₂ source is
        pure-gas m³/s, not ppm/s.
      </p>
      {report?.objects.map((obj) => {
        const override =
          scenario.assetOverrides.find((v) => v.objectId === obj.id) ??
          assetOverrideSchema.parse({ objectId: obj.id, mode: obj.mode });
        const apply = (v: typeof override) =>
          onChange({
            ...scenario,
            assetOverrides: [
              ...scenario.assetOverrides.filter((x) => x.objectId !== obj.id),
              v,
            ],
          });
        return (
          <details
            key={obj.id}
            open={selectedObjectId === obj.id ? true : undefined}
          >
            <summary>
              {obj.name} · {override.mode}
            </summary>
            {!!obj.assumptions?.length && (
              <div className="cfx-caption">
                <strong>Proxy assumptions</strong>
                <ul>
                  {obj.assumptions.map((text) => (
                    <li key={text}>{text}</li>
                  ))}
                </ul>
              </div>
            )}
            {!obj.profile &&
              !scenario.assetOverrides.some((v) => v.objectId === obj.id) && (
                <button onClick={() => apply({ ...override, mode: "none" })}>
                  Confirm excluded
                </button>
              )}
            <div className="cfx-grid">
              <label>
                CFD treatment
                <select
                  value={override.mode}
                  onChange={(e) =>
                    apply({
                      ...override,
                      mode: e.target.value as typeof override.mode,
                    })
                  }
                >
                  <option value="none">Excluded</option>
                  <option value="solidProxy">Solid proxy</option>
                  <option value="sourceOnly">Source only</option>
                  <option value="porousProxy" disabled>
                    Porous · not connected
                  </option>
                </select>
              </label>
              <CFDNumber
                label={`Heat · ${obj.name} (W)`}
                value={override.heatW}
                onChange={(heatW) => apply({ ...override, heatW })}
              />
              <CFDNumber
                label={`CO₂ · ${obj.name} (m³/s)`}
                value={override.co2M3S}
                onChange={(co2M3S) => apply({ ...override, co2M3S })}
              />
              <CFDNumber
                label={`Count · ${obj.name}`}
                value={override.count}
                onChange={(count) => apply({ ...override, count })}
              />
            </div>
            <p className="cfx-caption">
              {obj.profile
                ? `Catalogue proxy: ${obj.profile}`
                : "No eligible catalogue proxy; exclusion or an explicitly reviewed conservative box."}
            </p>
            <Parameters
              value={override}
              omit={[
                "objectId",
                "mode",
                "heatW",
                "co2M3S",
                "count",
                "temperatureK",
              ]}
              onChange={(v) => apply(v as typeof override)}
            />
            <label className="cfx-check">
              <input
                type="checkbox"
                checked={override.temperatureK !== null}
                onChange={(e) =>
                  apply({
                    ...override,
                    temperatureK: e.target.checked ? 293.15 : null,
                  })
                }
              />
              Prescribed surface temperature
            </label>
            {override.temperatureK !== null && (
              <CFDNumber
                label={`Surface temperature · ${obj.name} (K)`}
                value={override.temperatureK}
                onChange={(temperatureK) =>
                  apply({ ...override, temperatureK })
                }
              />
            )}
          </details>
        );
      })}
      {!!report &&
        scenario.assetOverrides.some(
          (a) => !report.objects.some((o) => o.id === a.objectId),
        ) && (
          <details>
            <summary>Unavailable object overrides</summary>
            <p className="cfx-caption">
              Deleted or disconnected source references are retained until you
              remove them.
            </p>
            {scenario.assetOverrides
              .filter((a) => !report.objects.some((o) => o.id === a.objectId))
              .map((a) => (
                <button
                  key={a.objectId}
                  onClick={() =>
                    onChange({
                      ...scenario,
                      assetOverrides: scenario.assetOverrides.filter(
                        (v) => v.objectId !== a.objectId,
                      ),
                    })
                  }
                >
                  Remove override · {a.objectId}
                </button>
              ))}
          </details>
        )}
    </>
  );
}
function BoundaryEditor({
  value,
  onChange,
}: {
  value: CFDBoundary;
  onChange: (v: CFDBoundary) => void;
}) {
  const flowUnits: Record<string, string> = {
    velocity: "m/s",
    volumeFlow: "m³/s",
    massFlow: "kg/s",
    pressure: "Pa",
    opening: "Pa",
  };
  return (
    <>
      <div className="cfx-grid">
        <label>
          Flow condition
          <select
            aria-label="Boundary flow condition"
            value={value.flow.type}
            onChange={(e) =>
              onChange({
                ...value,
                flow: {
                  ...value.flow,
                  type: e.target.value as CFDBoundary["flow"]["type"],
                },
              })
            }
          >
            {[
              "noSlip",
              "slip",
              "velocity",
              "volumeFlow",
              "massFlow",
              "pressure",
              "opening",
              "symmetry",
            ].map((t) => (
              <option key={t} value={t}>
                {labelFor(t)}
              </option>
            ))}
          </select>
        </label>
        {flowUnits[value.flow.type] && (
          <CFDNumber
            label={`Boundary flow value (${flowUnits[value.flow.type]})`}
            value={value.flow.value}
            onChange={(v) =>
              onChange({ ...value, flow: { ...value.flow, value: v } })
            }
          />
        )}
        <label>
          Thermal condition
          <select
            aria-label="Boundary thermal condition"
            value={value.thermal.type}
            onChange={(e) => {
              const type = e.target.value as CFDBoundary["thermal"]["type"];
              onChange({
                ...value,
                thermal: {
                  ...value.thermal,
                  type,
                  value: type === "temperature" ? 293.15 : 0,
                },
              });
            }}
          >
            {["adiabatic", "temperature", "heatFlux", "heatTransfer"].map(
              (t) => (
                <option key={t} value={t}>
                  {labelFor(t)}
                </option>
              ),
            )}
          </select>
        </label>
        {value.thermal.type !== "adiabatic" && (
          <CFDNumber
            label={
              value.thermal.type === "temperature"
                ? "Boundary temperature (K)"
                : value.thermal.type === "heatFlux"
                  ? "Heat flux into air (W/m²)"
                  : "Heat-transfer coefficient (W/m²·K)"
            }
            value={value.thermal.value}
            onChange={(v) =>
              onChange({ ...value, thermal: { ...value.thermal, value: v } })
            }
          />
        )}
      </div>
      {value.thermal.type === "heatTransfer" && (
        <CFDNumber
          label="Ambient temperature (K)"
          value={value.thermal.ambientK}
          onChange={(ambientK) =>
            onChange({ ...value, thermal: { ...value.thermal, ambientK } })
          }
        />
      )}
      <Parameters
        value={value}
        omit={["flow", "thermal"]}
        onChange={(v) => onChange(v as CFDBoundary)}
      />
    </>
  );
}
export function BoundariesPanel({
  scenario,
  report,
  selected,
  onSelect,
  onChange,
}: {
  scenario: CFDScenario;
  report: CFDReport | null;
  selected: string | null;
  onSelect: (id: string) => void;
  onChange: (s: CFDScenario) => void;
}) {
  const [search, setSearch] = useState(""),
    [group, setGroup] = useState<PatchKind>("wall");
  const patch = report?.patches.find(
    (p) =>
      p.id === selected || (p.kind === "object" && p.sourceId === selected),
  );
  const roomNames = new Map(report?.domain.regions.map((r) => [r.id, r.name]));
  const query = search.trim().toLowerCase();
  const rows =
    report?.patches.filter((p) =>
      `${p.kind} ${p.label ?? ""} ${roomNames.get(p.roomId) ?? ""} ${p.roomId} ${p.sourceId} ${p.id}`
        .toLowerCase()
        .includes(query),
    ) ?? [];
  const groupValue =
    scenario.boundaries.groups[group] ?? boundarySchema.parse({});
  const updateGroup = (v: CFDBoundary) =>
    onChange({
      ...scenario,
      boundaries: {
        ...scenario.boundaries,
        groups: { ...scenario.boundaries.groups, [group]: v },
      },
    });
  return (
    <>
      <p className="cfx-intro">
        Every derived patch is named and coloured. Group conditions are
        inherited unless a patch has an override. Vent flow and inflow
        properties come from its device inspector.
      </p>
      <details>
        <summary>Group presets</summary>
        <label>
          Patch group
          <select
            aria-label="Boundary patch group"
            value={group}
            onChange={(e) => setGroup(e.target.value as PatchKind)}
          >
            {PATCH_KINDS.filter((k) => k !== "supply" && k !== "extract").map(
              (k) => (
                <option key={k} value={k}>
                  {labelFor(k)}
                </option>
              ),
            )}
          </select>
        </label>
        <BoundaryEditor value={groupValue} onChange={updateGroup} />
        <button onClick={() => updateGroup(groupValue)}>
          Assign this group preset
        </button>
      </details>
      <label>
        Find a patch
        <input
          type="search"
          aria-label="Find a CFD patch"
          value={search}
          maxLength={500}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Room, surface or source ID"
        />
      </label>
      <div
        className="cfx-patch-list"
        role="list"
        aria-label="CFD boundary patches"
      >
        {rows.map((p) => (
          <button
            className={patch?.id === p.id ? "active" : ""}
            key={p.id}
            onClick={() => onSelect(p.id)}
          >
            <strong>
              {p.label ?? labelFor(p.kind)} · {p.sourceId}
            </strong>
            <small>
              {roomNames.get(p.roomId) ?? p.roomId} · {p.areaM2.toFixed(3)} m² ·{" "}
              {p.boundaryOrigin}
            </small>
          </button>
        ))}
      </div>
      {report && !rows.length && (
        <p role="status" className="cfx-caption">
          No matching patches. Try a room, surface name or source ID.
        </p>
      )}
      {patch && (
        <section className="cfx-card">
          <h3>
            {patch.label ?? labelFor(patch.kind)} · {patch.sourceId}
          </h3>
          <small>{patch.id}</small>
          {patch.kind === "supply" || patch.kind === "extract" ? (
            <p>Controlled by the device in Equipment.</p>
          ) : (
            <>
              <BoundaryEditor
                value={scenario.boundaries.patches[patch.id] ?? patch.boundary}
                onChange={(value) =>
                  onChange({
                    ...scenario,
                    boundaries: {
                      ...scenario.boundaries,
                      patches: {
                        ...scenario.boundaries.patches,
                        [patch.id]: value,
                      },
                    },
                  })
                }
              />
              <button
                disabled={!scenario.boundaries.patches[patch.id]}
                onClick={() => {
                  const next = { ...scenario.boundaries.patches };
                  delete next[patch.id];
                  onChange({
                    ...scenario,
                    boundaries: { ...scenario.boundaries, patches: next },
                  });
                }}
              >
                Clear override · inherit group
              </button>
            </>
          )}
        </section>
      )}
      {!!report &&
        Object.keys(scenario.boundaries.patches).some(
          (id) => !report.patches.some((p) => p.id === id),
        ) && (
          <details>
            <summary>Unavailable patch overrides</summary>
            {Object.keys(scenario.boundaries.patches)
              .filter((id) => !report.patches.some((p) => p.id === id))
              .map((id) => (
                <button
                  key={id}
                  onClick={() => {
                    const patches = { ...scenario.boundaries.patches };
                    delete patches[id];
                    onChange({
                      ...scenario,
                      boundaries: { ...scenario.boundaries, patches },
                    });
                  }}
                >
                  Remove override · {id}
                </button>
              ))}
          </details>
        )}
    </>
  );
}
export function PhysicsPanel({
  scenario,
  onChange,
}: {
  scenario: CFDScenario;
  onChange: (s: CFDScenario) => void;
}) {
  const p = scenario.physics;
  return (
    <>
      <p className="cfx-intro">
        Sample indoor-air intentions—not certified simulation settings. Physics
        is stored in SI. Temperatures are kelvin; CO₂ concentration is ppm by
        volume (1 ppm = 10⁻⁶ volume fraction). Time stepping and numerical
        controls are in Simulation → Run.
      </p>
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
      <div className="cfx-grid">
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
      <Parameters
        value={p}
        omit={[
          "preset",
          "mode",
          "turbulence",
          "time",
          "numerics",
          "initialVelocityMS",
          "initialPressurePa",
          "initialTemperatureK",
          "initialCo2Ppm",
          "initialK",
          "initialEpsilon",
          "initialOmega",
        ]}
        onChange={(v) =>
          onChange({
            ...scenario,
            physics: { ...v, preset: "custom" } as typeof p,
          })
        }
      />
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
      </details>
      <details>
        <summary>Requested outputs &amp; monitoring points</summary>
        <Parameters
          value={scenario.outputs}
          onChange={(v) =>
            onChange({ ...scenario, outputs: v as typeof scenario.outputs })
          }
        />
        <p className="cfx-caption">
          Age of air and comfort are requested future fields, not computed
          metrics.
        </p>
      </details>
    </>
  );
}
export function MeshPanel({
  scenario,
  report,
  onChange,
  selected,
  onSelect,
  onShowRefinements,
}: {
  scenario: CFDScenario;
  report: CFDReport | null;
  onChange: (s: CFDScenario) => void;
  selected: string | null;
  onSelect: (id: string | null) => void;
  onShowRefinements: () => void;
}) {
  const regions = scenario.mesh.refinements,
    region =
      regions.find((r) => `refinement:${r.id}` === selected) ?? regions[0];
  const solids =
    report?.objects.filter(
      (o) => o.mode === "solidProxy" && o.verticesMm.length,
    ) ?? [];
  const editRegion = (next: typeof region) =>
    onChange({
      ...scenario,
      mesh: {
        ...scenario.mesh,
        preset: "Custom",
        refinements: regions.map((r) => (r.id === next.id ? next : r)),
      },
    });
  return (
    <>
      <p className="cfx-intro">
        This is a mesh recipe, not a generated mesh. Geometry cleanup, snapping
        and cell size are separate intentions. Achieved quality, y+ and cell
        counts remain unavailable until a mesher is connected.
      </p>
      <label>
        Mesh intent preset
        <select
          aria-label="Mesh intent preset"
          value={scenario.mesh.preset}
          onChange={(e) =>
            onChange({
              ...scenario,
              mesh:
                e.target.value === "Custom"
                  ? { ...scenario.mesh, preset: "Custom" }
                  : {
                      ...meshPreset(
                        e.target.value as typeof scenario.mesh.preset,
                      ),
                      refinements: scenario.mesh.refinements,
                      originMm: scenario.mesh.originMm,
                      alignmentDeg: scenario.mesh.alignmentDeg,
                    },
            })
          }
        >
          {["Draft", "Standard", "Fine", "Custom"].map((p) => (
            <option key={p}>{p}</option>
          ))}
        </select>
      </label>
      <div className="cfx-grid">
        {(
          [
            "baseCellMm",
            "minCellMm",
            "maxCellMm",
            "targetCells",
            "maxCells",
          ] as const
        ).map((key) => (
          <CFDNumber
            key={key}
            label={labelFor(key)}
            value={scenario.mesh[key]}
            onChange={(v) =>
              onChange({
                ...scenario,
                mesh: { ...scenario.mesh, preset: "Custom", [key]: v },
              })
            }
          />
        ))}
      </div>
      {report && (
        <div className="cfx-notice">
          <strong>
            Estimate only ·{" "}
            {report.meshRecipe.estimate.rangeCells
              .map((v) => v.toLocaleString())
              .join("–")}{" "}
            cells
          </strong>
          <small>{report.meshRecipe.estimate.disclaimer}</small>
        </div>
      )}
      <h3>Local refinement regions</h3>
      <p className="cfx-caption">
        Box, sphere or object extents are shown as wireframe intent in the
        preview—not cells or achieved resolution. Coordinates and sizes are
        millimetres.
      </p>
      <button
        disabled={!regions.length || !report?.surface.verticesMm.length}
        onClick={onShowRefinements}
      >
        View refinements in 3D
      </button>
      {!report && (
        <p className="cfx-caption">
          Use Validate &amp; refresh once to preview refinement regions against
          your building.
        </p>
      )}
      <button
        disabled={regions.length >= 200}
        onClick={() => {
          const bounds = report?.domain.boundsMm;
          const names = new Set(regions.map((region) => region.name));
          let number = regions.length + 1;
          while (names.has(`Refinement ${number}`)) number++;
          const next = {
            id: crypto.randomUUID(),
            name: `Refinement ${number}`,
            shape: "box" as const,
            centerMm: bounds
              ? (bounds[0].map((v, i) => (v + bounds[1][i]) / 2) as [
                  number,
                  number,
                  number,
                ])
              : ([0, 0, 0] as [number, number, number]),
            sizeMm: [1000, 1000, 1000] as [number, number, number],
            objectId: null,
            level: 2,
            cellMm: scenario.mesh.baseCellMm / 4,
          };
          onChange({
            ...scenario,
            mesh: {
              ...scenario.mesh,
              preset: "Custom",
              minCellMm: Math.min(
                scenario.mesh.minCellMm,
                scenario.mesh.baseCellMm / 4,
              ),
              refinements: [...regions, next],
            },
          });
          onSelect(`refinement:${next.id}`);
        }}
      >
        Add refinement region
      </button>
      <ol className="cfx-refinement-list" aria-label="Refinement regions">
        {regions.map((r, index) => {
          const level = refinementLevel(scenario.mesh.baseCellMm, r);
          return (
            <li
              key={r.id}
              className={`cfx-refinement-row ${region?.id === r.id ? "selected" : ""}`}
            >
              <span
                className="cfx-level-swatch"
                style={{ background: refinementColour(level) }}
                aria-hidden="true"
              />
              <button
                className="cfx-refinement-name"
                onClick={() => onSelect(`refinement:${r.id}`)}
                aria-label={`Edit ${r.name}`}
              >
                <strong>{r.name}</strong>
                <small>
                  Level {level} ·{" "}
                  {refinementCell(scenario.mesh.baseCellMm, r).toLocaleString()}{" "}
                  mm · {r.shape === "box" ? "Cuboid" : r.shape}
                </small>
              </button>
              <div className="cfx-refinement-actions">
                <button
                  aria-label={`Move ${r.name} up`}
                  disabled={index === 0}
                  onClick={() => {
                    const reordered = [...regions];
                    [reordered[index - 1], reordered[index]] = [
                      reordered[index],
                      reordered[index - 1],
                    ];
                    onChange({
                      ...scenario,
                      mesh: { ...scenario.mesh, refinements: reordered },
                    });
                  }}
                >
                  ↑
                </button>
                <button
                  disabled={regions.length >= 200}
                  aria-label={`Duplicate ${r.name}`}
                  onClick={() => {
                    const names = new Set(regions.map((value) => value.name));
                    let name: string,
                      number = 1;
                    do {
                      const suffix = ` copy${number === 1 ? "" : ` ${number}`}`;
                      // Keep an emoji/surrogate pair intact at the name limit.
                      const stem = r.name
                        .slice(0, 120 - suffix.length)
                        .replace(/[\uD800-\uDBFF]$/, "");
                      name = `${stem}${suffix}`;
                      number++;
                    } while (names.has(name));
                    const copy = {
                      ...structuredClone(r),
                      id: crypto.randomUUID(),
                      name,
                    };
                    onChange({
                      ...scenario,
                      mesh: {
                        ...scenario.mesh,
                        refinements: [...regions, copy],
                      },
                    });
                    onSelect(`refinement:${copy.id}`);
                  }}
                >
                  Duplicate
                </button>
                <button
                  aria-label={`Delete ${r.name}`}
                  onClick={() => {
                    onChange({
                      ...scenario,
                      mesh: {
                        ...scenario.mesh,
                        refinements: regions.filter((v) => v.id !== r.id),
                      },
                    });
                    if (region?.id === r.id) {
                      const next = regions[index + 1] ?? regions[index - 1];
                      onSelect(next ? `refinement:${next.id}` : null);
                    }
                  }}
                >
                  Delete
                </button>
              </div>
            </li>
          );
        })}
      </ol>
      {!regions.length && (
        <p className="cfx-caption">
          No local refinements yet. Add a cuboid, set its level, then inspect it
          in 3D. Each list entry has Duplicate and Delete controls.
        </p>
      )}
      {!!regions.length && (
        <label>
          Region
          <select
            aria-label="Selected refinement"
            value={region.id}
            onChange={(e) => onSelect(`refinement:${e.target.value}`)}
          >
            {regions.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name}
              </option>
            ))}
          </select>
        </label>
      )}
      {region && (
        <section className="cfx-card">
          <CFDText
            label="Refinement name"
            value={region.name}
            onChange={(name) => editRegion({ ...region, name })}
          />
          <div className="cfx-grid">
            <label>
              Region shape
              <select
                aria-label="Refinement shape"
                value={region.shape}
                onChange={(e) => {
                  const shape = e.target.value as typeof region.shape;
                  editRegion({
                    ...region,
                    shape,
                    sizeMm:
                      shape === "sphere"
                        ? [region.sizeMm[0], region.sizeMm[0], region.sizeMm[0]]
                        : region.sizeMm,
                    objectId:
                      shape === "object"
                        ? (solids[0]?.id ?? null)
                        : region.objectId,
                  });
                }}
              >
                <option value="box">Cuboid</option>
                <option value="sphere">Sphere</option>
                <option value="object" disabled={!solids.length}>
                  Object extents
                </option>
              </select>
            </label>
            <label>
              snappyHexMesh refinement level
              <select
                aria-label="Refinement level"
                value={region.level ?? "custom"}
                onChange={(e) => {
                  const level =
                    e.target.value === "custom" ? null : Number(e.target.value);
                  const cellMm =
                    level === null
                      ? region.cellMm
                      : scenario.mesh.baseCellMm / 2 ** level;
                  onChange({
                    ...scenario,
                    mesh: {
                      ...scenario.mesh,
                      preset: "Custom",
                      minCellMm: Math.min(scenario.mesh.minCellMm, cellMm),
                      refinements: regions.map((r) =>
                        r.id === region.id ? { ...region, level, cellMm } : r,
                      ),
                    },
                  });
                }}
              >
                {Array.from({ length: 11 }, (_, level) => (
                  <option key={level} value={level}>
                    Level {level} ·{" "}
                    {(scenario.mesh.baseCellMm / 2 ** level).toLocaleString()}{" "}
                    mm
                  </option>
                ))}
                <option value="custom">Custom cell size</option>
              </select>
            </label>
            {region.level === null ? (
              <>
                <CFDNumber
                  label="Refinement cell size (mm)"
                  value={region.cellMm}
                  onChange={(cellMm) => editRegion({ ...region, cellMm })}
                />
                <p className="cfx-caption">
                  Target {region.cellMm.toLocaleString()} mm rounds to level{" "}
                  {refinementLevel(scenario.mesh.baseCellMm, region)} · nominal{" "}
                  {refinementCell(
                    scenario.mesh.baseCellMm,
                    region,
                  ).toLocaleString()}{" "}
                  mm. Global limits apply to the rounded size too.
                </p>
              </>
            ) : (
              <p className="cfx-caption">
                Each level halves the base cell along X, Y and Z. Level{" "}
                {region.level} uses base ÷ 2<sup>{region.level}</sup>; colours
                are identical in the list and viewer.
              </p>
            )}
          </div>
          {region.shape === "object" ? (
            <label>
              Source object
              <select
                aria-label="Refinement object"
                value={region.objectId ?? ""}
                onChange={(e) =>
                  editRegion({ ...region, objectId: e.target.value || null })
                }
              >
                {!solids.some((o) => o.id === region.objectId) && (
                  <option value={region.objectId ?? ""}>
                    Missing solid · reassign
                  </option>
                )}
                {solids.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.name}
                  </option>
                ))}
              </select>
              <small>
                Extents follow the last checked solid proxy. Refresh after
                changing its source placement.
              </small>
            </label>
          ) : (
            <>
              <div className="cfx-grid cfx-three">
                {region.centerMm.map((v, i) => (
                  <CFDNumber
                    key={i}
                    label={`Refinement centre ${["X", "Y", "Z"][i]} (mm)`}
                    value={v}
                    onChange={(value) =>
                      editRegion({
                        ...region,
                        centerMm: region.centerMm.map((x, j) =>
                          j === i ? value : x,
                        ) as [number, number, number],
                      })
                    }
                  />
                ))}
              </div>
              {region.shape === "sphere" ? (
                <CFDNumber
                  label="Refinement diameter (mm)"
                  value={region.sizeMm[0]}
                  onChange={(d) => editRegion({ ...region, sizeMm: [d, d, d] })}
                />
              ) : (
                <div className="cfx-grid cfx-three">
                  {region.sizeMm.map((v, i) => (
                    <CFDNumber
                      key={i}
                      label={`Refinement size ${["X", "Y", "Z"][i]} (mm)`}
                      value={v}
                      onChange={(value) =>
                        editRegion({
                          ...region,
                          sizeMm: region.sizeMm.map((x, j) =>
                            j === i ? value : x,
                          ) as [number, number, number],
                        })
                      }
                    />
                  ))}
                </div>
              )}
            </>
          )}
        </section>
      )}
      <details>
        <summary>Refinements, layers, tolerances &amp; quality intent</summary>
        <Parameters
          value={scenario.mesh}
          omit={[
            "preset",
            "baseCellMm",
            "minCellMm",
            "maxCellMm",
            "targetCells",
            "maxCells",
            "refinements",
          ]}
          onChange={(v) =>
            onChange({
              ...scenario,
              mesh: { ...v, preset: "Custom" } as typeof scenario.mesh,
            })
          }
        />
      </details>
    </>
  );
}
