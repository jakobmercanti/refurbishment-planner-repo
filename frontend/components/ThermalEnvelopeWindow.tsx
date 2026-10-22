"use client";

import { useEffect, useRef, useState } from "react";
import type { ProjectDocument } from "@/lib/projectDocument";
import { projectFloors } from "@/lib/buildingDocument";
import type { CFDScenario } from "@/lib/climoptixDocument";
import { downloadCFD } from "@/lib/climoptix";
import {
  thermalCSV,
  thermalGainSchema,
  thermalOverrideSchema,
  thermalSetupSchema,
  type ThermalMetric,
  type ThermalPackage,
  type ThermalSetup,
  type ThermalSurface,
} from "@/lib/thermalDocument";
import { importEPW, type EPWData } from "@/lib/thermalClient";
import type { ReactNode } from "react";
import { FloatingToolbar } from "./FloatingToolbar";
import { WindowHelpButton } from "./WindowHelpButton";
import { SurfaceOverride, ThermalNumber, ThermalText } from "./ThermalFields";

const STEPS = [
  "Envelope & insulation",
  "Location & sun",
  "Weather / scenario",
  "Gains & ventilation",
  "Modelling & advanced",
  "Review & apply",
];
const HELP = [
  {
    heading: "One construction source",
    text: "Refresh imports exact selected-domain surfaces and saved constructions per floor. Missing data stays missing. Edit in Insulation uses the existing source editor; return here to refresh. CFD overrides never rewrite those assemblies.",
  },
  {
    heading: "Screening, not CFD",
    text: "The preliminary estimate balances a single well-mixed sensible-only zone at one instant with HVAC off. It does not model thermal mass, annual peaks, latent heat, ray-traced shading or interior radiation. Positive heat enters the selected air domain.",
  },
  {
    heading: "Explicit inputs",
    text: "Enter location/timezone, date, weather provenance and outdoor temperature, choose air exchange including None, and review the assumptions. Solar needs DNI/DHI and albedo or per-face forcing. Ground and adjacent zones need their own temperatures. Enter or Tab commits a valid number. Optional fields may be blank; Escape restores the saved value.",
  },
  {
    heading: "Films and handoff",
    text: "Screening uses overall U including films. Robin removes declared Rsi exactly once and is blocked when the film split is unknown. Fixed flux is an approximation at the stated reference temperature. Glazing solar and internal gains are separate lumped air sources, not duplicated glass convection.",
  },
  {
    heading: "Apply, save and history",
    text: "Calculate explicitly after changing inputs. Apply stores a versioned immutable contract with source hashes, preserving flow and scalar conditions. Changes make previous results stale; up to three applied packages are retained in the project. No OpenFOAM worker is connected, so exports are not executable cases and do not represent a run.",
  },
];
const fmt = (n: number | null | undefined, digits = 2) =>
  n == null
    ? "Not supplied"
    : (Math.abs(n) < 0.5 * 10 ** -digits ? 0 : n).toLocaleString(undefined, {
        maximumFractionDigits: digits,
      });
const downloadThermal = (name: string, content: string, type: string) =>
  downloadCFD(new Blob([content], { type }), name);
const SOURCE_LABELS: Record<string, string> = {
  insulationLayers: "Insulation layers",
  enteredU: "Entered whole-element U",
  heatingEstimate: "Heating estimate · unverified",
  missing: "Not supplied",
  override: "CFD override",
};
const surfaceName = (face: ThermalSurface) => {
  const key = face.elementId.split("|")[1] ?? face.kind;
  const wall = /^wall:(\d+)(?::(\d+))?$/.exec(key);
  if (wall)
    return `Wall ${Number(wall[1]) + 1}${wall[2] == null ? "" : ` · segment ${Number(wall[2]) + 1}`}`;
  if (key.startsWith("reveal:")) return "Opening reveal";
  if (key.startsWith("opening:"))
    return `${face.category === "window" ? "Window" : face.category === "door" ? "Door" : "Opening"} · ${key.slice(8, 16)}`;
  return key === "roof" ? "Roof / ceiling" : key === "floor" ? "Floor" : key;
};

function Breakdown({ report }: { report: ThermalPackage }) {
  const items = ["wall", "roof", "floor", "window", "door"].map((category) => ({
    label: category,
    value: report.surfaces
      .filter((f) => f.category === category)
      .reduce((sum, f) => sum + (f.heatW ?? 0), 0),
  }));
  items.push(
    { label: "Internal gains", value: report.preview.internalGainsW },
    { label: "Glazing solar", value: report.preview.transmittedSolarW },
    { label: "Air exchange", value: report.preview.airExchangeW ?? 0 },
  );
  const max = Math.max(1, ...items.map((i) => Math.abs(i.value)));
  return (
    <figure className="thermal-breakdown">
      <figcaption>
        Sensible contribution breakdown · positive into room (W)
      </figcaption>
      <div
        className="thermal-bars"
        role="list"
        aria-label="Heat gain and loss contribution bars"
      >
        {items.map((item) => (
          <div className="thermal-bar-row" role="listitem" key={item.label}>
            <span>{item.label}</span>
            <div className="thermal-bar-track" aria-hidden="true">
              <i
                style={{
                  left: `${item.value < 0 ? 50 - (Math.abs(item.value) / max) * 50 : 50}%`,
                  width: `${(Math.abs(item.value) / max) * 50}%`,
                  background: item.value < 0 ? "#5088ba" : "#c87c46",
                }}
              />
            </div>
            <strong>{fmt(item.value, 1)} W</strong>
          </div>
        ))}
      </div>
      <p className="cfx-caption">
        Envelope bars include equivalent sol-air forcing. Glazing solar is
        counted separately, once. Residual includes all terms.
      </p>
    </figure>
  );
}

/** The thermal editor can share the setup window without nesting floating chrome. */
function ThermalFrame({
  embedded,
  onClose,
  children,
}: {
  embedded: boolean;
  onClose: () => void;
  children: ReactNode;
}) {
  return embedded ? (
    children
  ) : (
    <FloatingToolbar
      title="Thermal Envelope & Solar Conditions"
      help={false}
      className="thermal-window"
      defaultPosition={{ x: 24, y: 12 }}
      initialSize={{ width: 1160, height: 760 }}
      maxHeight={1000}
      bringToFront
      onClose={onClose}
    >
      {children}
    </FloatingToolbar>
  );
}
export function ThermalEnvelopeWindow({
  project,
  scenario,
  apiUrl,
  report,
  busy,
  error,
  stale,
  metric,
  onMetric,
  selected,
  onSelect,
  onChange,
  onRequest,
  onApply,
  onEditInsulation,
  onClose,
  embedded = false,
}: {
  project: ProjectDocument;
  scenario: CFDScenario;
  apiUrl: string;
  report: ThermalPackage | null;
  busy: boolean;
  error: string;
  stale: boolean;
  metric: ThermalMetric;
  onMetric: (metric: ThermalMetric) => void;
  selected: string | null;
  onSelect: (id: string) => void;
  onChange: (s: CFDScenario, checkpoint?: boolean) => void;
  onRequest: (calculate: boolean) => void;
  onApply: () => void;
  onEditInsulation: (face: ThermalSurface) => void;
  onClose: () => void;
  embedded?: boolean;
}) {
  const [step, setStep] = useState(0),
    [query, setQuery] = useState(""),
    [advanced, setAdvanced] = useState(false);
  const [epw, setEPW] = useState<EPWData | null>(null),
    [epwError, setEPWError] = useState(""),
    [importing, setImporting] = useState(false);
  const importAbort = useRef<AbortController | null>(null);
  const host = useRef<HTMLDivElement>(null);
  useEffect(() => {
    host.current
      ?.querySelector<HTMLButtonElement>(".floating-toolbar-close")
      ?.focus();
    return () => importAbort.current?.abort();
  }, []);
  const setup = scenario.thermalEnvelope ?? thermalSetupSchema.parse({});
  const latest = useRef({ scenario, onChange });
  useEffect(() => {
    latest.current = { scenario, onChange };
  }, [scenario, onChange]);
  // Numeric inputs keep a local draft until blur/Enter. Never calculate saved
  // values or unmount those drafts while a visible entry is invalid.
  const validDrafts = () => {
    const invalid = host.current?.querySelector<HTMLInputElement>(
      '.thermal-scroll input:invalid, .thermal-scroll input[aria-invalid="true"]',
    );
    if (!invalid) return true;
    for (
      let parent = invalid.parentElement;
      parent;
      parent = parent.parentElement
    ) {
      if (parent instanceof HTMLDetailsElement) parent.open = true;
      if (parent.classList.contains("thermal-scroll")) break;
    }
    invalid.scrollIntoView({ block: "center" });
    invalid.focus();
    invalid.reportValidity();
    return false;
  };
  const navigate = (index: number) => {
    if (validDrafts()) setStep(index);
  };
  const update = (patch: Partial<ThermalSetup>) =>
    onChange({ ...scenario, thermalEnvelope: { ...setup, ...patch } });
  const location = (patch: Partial<ThermalSetup["location"]>) =>
    update({ location: { ...setup.location, ...patch } });
  const weather = (patch: Partial<ThermalSetup["weather"]>) =>
    update({ weather: { ...setup.weather, ...patch } });
  const air = (patch: Partial<ThermalSetup["airExchange"]>) =>
    update({ airExchange: { ...setup.airExchange, ...patch } });
  const surfaces = report?.surfaces ?? [];
  const face =
    surfaces.find((f) => f.surfaceId === selected) ??
    surfaces.find((f) => f.patchId === selected) ??
    surfaces.find((f) => f.exposure !== "internal") ??
    surfaces[0];
  const rows = surfaces
    .filter((f) =>
      `${f.roomName} ${surfaceName(f)} ${f.elementId} ${f.exposure} ${f.status}`
        .toLowerCase()
        .includes(query.toLowerCase()),
    )
    .sort(
      (a, b) =>
        Number(a.exposure === "internal") - Number(b.exposure === "internal"),
    );
  const missing = surfaces.filter(
    (f) => f.status === "incomplete" || f.status === "stale",
  ).length;
  const sourceLayers =
    face?.insulationAssemblyLayers ?? face?.assemblyLayers ?? [];
  const sourceEnergy = projectFloors(project).find(
    (f) => f.id === face?.floorId,
  )?.content.energyLayout;
  const sourceChoice =
    face && Object.hasOwn(setup.insulationScenarios, face.floorId)
      ? setup.insulationScenarios[face.floorId]
      : (sourceEnergy?.activeScenarioId ?? null);
  const missingSourceScenario =
    sourceChoice != null &&
    !sourceEnergy?.scenarios.some((s) => s.scenarioId === sourceChoice);
  const applied = scenario.thermalSnapshots?.[0];
  const num = (
    key:
      | "northDeg"
      | "referenceIndoorC"
      | "rhoKgM3"
      | "cpJKgK"
      | "groundTemperatureC"
      | "opaqueAbsorptance"
      | "groundAlbedo"
      | "shadingFactor"
      | "longwaveWm2"
      | "balanceToleranceW",
    label: string,
    min: number,
    max: number,
  ) => (
    <ThermalNumber
      key={key}
      label={label}
      value={setup[key]}
      min={min}
      max={max}
      nullable={[
        "groundTemperatureC",
        "opaqueAbsorptance",
        "groundAlbedo",
      ].includes(key)}
      onChange={(value) => update({ [key]: value })}
    />
  );
  const selectEPW = (index: number, data = epw) => {
    const row = data?.records[index];
    if (!row || !data) return;
    // Upload completion may run after edits on another step. Merge weather
    // into the latest study, not the snapshot captured when upload started.
    const { scenario: live, onChange: commit } = latest.current;
    const liveSetup = live.thermalEnvelope ?? thermalSetupSchema.parse({});
    commit({
      ...live,
      thermalEnvelope: {
        ...liveSetup,
        location: data.location,
        localDateTime: row.localDateTime,
        dstChoice: "reject",
        weather: {
          ...liveSetup.weather,
          source: data.source,
          epwRecord: `${row.index} · ${row.localDateTime} · ${data.timeConvention}`,
          temperatureC: row.temperatureC,
          relativeHumidity: row.relativeHumidity,
          windMS: row.windMS,
          solarMode: "components",
          forcingBasis: "hourlyMean",
          ghiWm2: row.ghiWm2,
          dniWm2: row.dniWm2,
          dhiWm2: row.dhiWm2,
        },
      },
    });
  };
  return (
    <div
      ref={host}
      className={embedded ? "thermal-host thermal-embedded" : "thermal-host"}
      onKeyDown={(e) => {
        if (
          !embedded &&
          e.key === "Escape" &&
          !(
            e.target instanceof Element &&
            e.target.closest("input,textarea,select")
          )
        ) {
          e.stopPropagation();
          onClose();
        }
      }}
    >
      <ThermalFrame embedded={embedded} onClose={onClose}>
        <div
          className="thermal-content"
          role="region"
          aria-label="Thermal envelope setup"
          aria-busy={busy}
        >
          <header className="thermal-heading">
            <div>
              <span className="cfx-eyebrow">
                NO-HVAC · SENSIBLE-ONLY SCREENING
              </span>
              <h2>{scenario.name}</h2>
              <p>
                {report
                  ? `${surfaces.length} surfaces · ${missing} incomplete / stale · ${new Set(surfaces.map((f) => f.roomId)).size} connected rooms`
                  : busy
                    ? "Loading envelope…"
                    : "No envelope loaded"}
              </p>
            </div>
            <WindowHelpButton title="Thermal envelope help" steps={HELP} />
          </header>
          <nav className="thermal-steps" aria-label="Thermal setup steps">
            {STEPS.map((label, index) => (
              <button
                key={label}
                aria-current={step === index ? "step" : undefined}
                className={step === index ? "active" : ""}
                onClick={() => navigate(index)}
              >
                <small>{index + 1}</small>
                {label}
              </button>
            ))}
          </nav>
          <div className="thermal-scroll" key={step}>
            {error && (
              <p className="cfx-error" role="alert">
                {error}
              </p>
            )}
            {stale && report && (
              <p className="cfx-notice" role="status">
                Inputs or source construction changed. Displayed values are
                historical; refresh or calculate before applying.
              </p>
            )}
            {step === 0 && (
              <>
                <div className="cfx-actions">
                  <button
                    disabled={busy || !scenario.seed}
                    onClick={() => {
                      if (validDrafts()) onRequest(false);
                    }}
                  >
                    Refresh envelope
                  </button>
                  <label>
                    Viewer overlay
                    <select
                      value={metric}
                      onChange={(e) =>
                        onMetric(e.target.value as ThermalMetric)
                      }
                    >
                      <option value="off">Off</option>
                      <option value="u">Insulation U</option>
                      <option value="missing">Missing / stale data</option>
                      <option value="exposure">Exposure</option>
                      <option value="heat">Gain / loss estimate</option>
                    </select>
                  </label>
                </div>
                {!scenario.seed && (
                  <p className="cfx-notice">
                    Select a seed room in Climoptix → Domain first.
                  </p>
                )}
                {!report && (
                  <p className="cfx-notice">
                    Refresh to import saved insulation and exact boundaries of
                    the selected connected air volume. No default U-values are
                    substituted.
                  </p>
                )}
                <details>
                  <summary>Construction scenario per floor</summary>
                  {projectFloors(project).map((f) => (
                    <label key={f.id}>
                      {f.name}
                      <select
                        value={setup.insulationScenarios[f.id] ?? ""}
                        onChange={(e) =>
                          update({
                            insulationScenarios: {
                              ...setup.insulationScenarios,
                              [f.id]: e.target.value || null,
                            },
                          })
                        }
                      >
                        <option value="">Existing Building</option>
                        {setup.insulationScenarios[f.id] &&
                          !f.content.energyLayout?.scenarios.some(
                            (s) =>
                              s.scenarioId === setup.insulationScenarios[f.id],
                          ) && (
                            <option
                              value={setup.insulationScenarios[f.id]!}
                              disabled
                            >
                              Unavailable saved scenario · choose another
                            </option>
                          )}
                        {f.content.energyLayout?.scenarios.map((s) => (
                          <option key={s.scenarioId} value={s.scenarioId}>
                            {s.name}
                          </option>
                        ))}
                      </select>
                    </label>
                  ))}
                </details>
                <ThermalText
                  label="Find envelope surface"
                  value={query}
                  onChange={setQuery}
                  maxLength={200}
                  type="search"
                />
                {Object.keys(setup.overrides).some(
                  (id) => !surfaces.some((f) => f.surfaceId === id),
                ) &&
                  report && (
                    <details>
                      <summary>
                        Unavailable surface overrides · review after geometry
                        changes
                      </summary>
                      {Object.keys(setup.overrides)
                        .filter(
                          (id) => !surfaces.some((f) => f.surfaceId === id),
                        )
                        .map((id) => (
                          <button
                            key={id}
                            onClick={() => {
                              const overrides = { ...setup.overrides };
                              delete overrides[id];
                              update({ overrides });
                            }}
                          >
                            Reset unavailable override · {id}
                          </button>
                        ))}
                    </details>
                  )}
                <div className="thermal-envelope-grid">
                  <div
                    className="thermal-surface-list"
                    role="list"
                    aria-label="Thermal surfaces"
                  >
                    {rows.map((f) => (
                      <button
                        key={f.surfaceId}
                        className={
                          face?.surfaceId === f.surfaceId ? "active" : ""
                        }
                        aria-pressed={face?.surfaceId === f.surfaceId}
                        onClick={() => {
                          if (validDrafts()) onSelect(f.surfaceId);
                        }}
                      >
                        <strong>
                          {f.roomName} · {surfaceName(f)}
                        </strong>
                        <small>
                          {fmt(f.areaM2)} m² · {f.exposure} · {f.status}
                        </small>
                        <small>
                          {f.exposure === "internal"
                            ? "No external heat exchange"
                            : f.uWm2K == null
                              ? "U not supplied"
                              : `U ${fmt(f.uWm2K, 3)} W/m²K`}
                        </small>
                      </button>
                    ))}
                    {report && !rows.length && <p>No matching surfaces.</p>}
                  </div>
                  {face && (
                    <section
                      className="thermal-inspector"
                      aria-label="Thermal surface inspector"
                    >
                      <h3>
                        {face.roomName} · {surfaceName(face)}
                      </h3>
                      <dl className="thermal-properties">
                        <dt>Area</dt>
                        <dd>{fmt(face.areaM2)} m²</dd>
                        <dt>Azimuth / tilt</dt>
                        <dd>
                          {fmt(face.azimuthDeg, 1)}° / {fmt(face.tiltDeg, 1)}°
                        </dd>
                        <dt>Exposure / source</dt>
                        <dd>
                          {face.exposure} ·{" "}
                          {SOURCE_LABELS[face.source] ?? face.source}
                        </dd>
                        <dt>Overall U / R</dt>
                        <dd>
                          {fmt(face.uWm2K, 3)} W/m²K / {fmt(face.rTotalM2KW, 3)}{" "}
                          m²K/W
                        </dd>
                        <dt>Rsi / Rse</dt>
                        <dd>
                          {fmt(face.rsi, 3)} / {fmt(face.rse, 3)} m²K/W
                        </dd>
                        <dt>α / ε / g</dt>
                        <dd>
                          {fmt(face.alpha)} / {fmt(face.emissivity)} /{" "}
                          {fmt(face.gValue)}
                        </dd>
                      </dl>
                      <details>
                        <summary>Face identity &amp; CFD projection</summary>
                        <dl className="thermal-properties">
                          <dt>Surface / patch</dt>
                          <dd>
                            {face.surfaceId}
                            <br />
                            {face.patchId}
                          </dd>
                          <dt>Floor / room</dt>
                          <dd>
                            {face.floorId} / {face.roomId}
                          </dd>
                          <dt>Source element</dt>
                          <dd>{face.elementId}</dd>
                          <dt>Outward normal</dt>
                          <dd>
                            {face.normal.map((v) => fmt(v, 4)).join(", ")}
                          </dd>
                          <dt>Centroid (mm)</dt>
                          <dd>
                            {face.centroidMm.map((v) => fmt(v, 1)).join(", ")}
                          </dd>
                          <dt>CFD contract</dt>
                          <dd>{face.cfdBC?.model ?? "Calculate to project"}</dd>
                          {face.cfdBC?.rOutwardM2KW != null && (
                            <>
                              <dt>R outward</dt>
                              <dd>
                                {fmt(face.cfdBC.rOutwardM2KW, 4)} m²K/W · Rtotal
                                − Rsi
                              </dd>
                            </>
                          )}
                          {face.cfdBC?.tEqOutsideK != null && (
                            <>
                              <dt>Equivalent forcing</dt>
                              <dd>{fmt(face.cfdBC.tEqOutsideK)} K</dd>
                            </>
                          )}
                          {face.cfdBC?.fluxIntoRoomWm2 != null && (
                            <>
                              <dt>Fixed flux</dt>
                              <dd>
                                {fmt(face.cfdBC.fluxIntoRoomWm2)} W/m² at{" "}
                                {fmt(face.cfdBC.referenceIndoorK)} K reference
                              </dd>
                            </>
                          )}
                          {face.cfdBC?.temperatureK != null && (
                            <>
                              <dt>Prescribed surface</dt>
                              <dd>{fmt(face.cfdBC.temperatureK)} K</dd>
                            </>
                          )}
                        </dl>
                      </details>
                      <details open>
                        <summary>
                          View insulation data · {face.insulationAssemblyName}
                        </summary>
                        <p>
                          Original source U: {fmt(face.insulationUWm2K, 3)}{" "}
                          W/m²K · Rsi {fmt(face.insulationRsi, 3)} / Rse{" "}
                          {fmt(face.insulationRse, 3)} m²K/W. CFD overrides do
                          not change these source values.
                        </p>
                        {sourceLayers.length ? (
                          <ul>
                            {sourceLayers.map((layer) => (
                              <li key={layer.layerId}>
                                {layer.name} · {fmt(layer.thicknessMm)} mm · λ{" "}
                                {fmt(layer.lambdaWMK, 3)} W/mK · R{" "}
                                {fmt(layer.rM2KW, 3)} m²K/W
                                <small>{layer.reference}</small>
                              </li>
                            ))}
                          </ul>
                        ) : (
                          <p>
                            No layer construction is assigned. Entered U does
                            not define its film split.
                          </p>
                        )}
                        <small>
                          Source revision {face.insulationRevision.slice(0, 12)}
                        </small>
                      </details>
                      {face.override?.assemblyId && (
                        <details>
                          <summary>
                            Effective CFD construction · {face.assemblyName}
                          </summary>
                          <ul>
                            {face.assemblyLayers.map((layer) => (
                              <li key={layer.layerId}>
                                {layer.name} · {fmt(layer.thicknessMm)} mm · λ{" "}
                                {fmt(layer.lambdaWMK, 3)} W/mK · R{" "}
                                {fmt(layer.rM2KW, 3)} m²K/W
                              </li>
                            ))}
                          </ul>
                        </details>
                      )}
                      <button
                        disabled={
                          face.exposure === "internal" ||
                          face.kind === "slabSide" ||
                          missingSourceScenario
                        }
                        onClick={() => {
                          if (validDrafts()) onEditInsulation(face);
                        }}
                      >
                        Edit in Insulation
                      </button>
                      {missingSourceScenario && (
                        <p className="cfx-error">
                          The chosen construction scenario was removed. Select
                          an available scenario for this floor before editing or
                          calculating.
                        </p>
                      )}
                      <p className="cfx-caption">
                        Opens the existing editor on this floor and surface; use
                        Return to Climoptix afterwards.
                      </p>
                      {!!face.warnings.length && (
                        <ul className="cfx-error">
                          {face.warnings.map((w) => (
                            <li key={w}>{w}</li>
                          ))}
                        </ul>
                      )}
                      <details>
                        <summary>Advanced · surface override</summary>
                        <SurfaceOverride
                          key={face.surfaceId}
                          face={face}
                          assemblies={
                            projectFloors(project)
                              .find((f) => f.id === face.floorId)
                              ?.content.energyLayout?.assemblies.filter(
                                (a) => a.category === face.category,
                              ) ?? []
                          }
                          value={
                            setup.overrides[face.surfaceId] ??
                            thermalOverrideSchema.parse({})
                          }
                          onChange={(value) =>
                            update({
                              overrides: {
                                ...setup.overrides,
                                [face.surfaceId]: value,
                              },
                            })
                          }
                          onReset={() => {
                            const overrides = { ...setup.overrides };
                            delete overrides[face.surfaceId];
                            update({ overrides });
                          }}
                        />
                      </details>
                    </section>
                  )}
                </div>
              </>
            )}
            {step === 1 && (
              <>
                <h3>Location &amp; true north</h3>
                <p>
                  No location is detected or fetched. Plan +X is east and +Y is
                  north at 0°; the angle is the true-north clockwise bearing of
                  plan +Y. Rotating north does not move geometry.
                </p>
                <ThermalText
                  label="Location name / city"
                  value={setup.location.name}
                  onChange={(name) => location({ name })}
                />
                <div className="cfx-grid">
                  <ThermalNumber
                    label="Latitude (° north)"
                    min={-90}
                    max={90}
                    value={setup.location.latitude}
                    onChange={(latitude) => location({ latitude })}
                  />
                  <ThermalNumber
                    label="Longitude (° east)"
                    min={-180}
                    max={180}
                    value={setup.location.longitude}
                    onChange={(longitude) => location({ longitude })}
                  />
                  <ThermalText
                    label="IANA timezone"
                    value={setup.location.timezone}
                    onChange={(timezone) =>
                      location({ timezone, fixedUtcOffsetMinutes: null })
                    }
                  />
                  <ThermalNumber
                    label="Elevation (m) · assumption"
                    min={-500}
                    max={9000}
                    nullable={false}
                    value={setup.location.elevationM}
                    onChange={(elevationM) => {
                      if (elevationM !== null) location({ elevationM });
                    }}
                  />
                  {num("northDeg", "Plan north bearing (° clockwise)", 0, 360)}
                  <ThermalText
                    label="Local date & time"
                    type="datetime-local"
                    value={setup.localDateTime}
                    onChange={(localDateTime) => update({ localDateTime })}
                  />
                </div>
                <ThermalText
                  label="Location provenance"
                  value={setup.location.source}
                  onChange={(source) => location({ source })}
                />
                <label>
                  Ambiguous DST time
                  <select
                    value={setup.dstChoice}
                    onChange={(e) =>
                      update({
                        dstChoice: e.target.value as ThermalSetup["dstChoice"],
                      })
                    }
                  >
                    <option value="reject">Ask for an explicit choice</option>
                    <option value="earlier">Earlier occurrence</option>
                    <option value="later">Later occurrence</option>
                  </select>
                </label>
                {setup.location.fixedUtcOffsetMinutes !== null && (
                  <p className="cfx-notice">
                    EPW fixed standard offset: UTC{" "}
                    {setup.location.fixedUtcOffsetMinutes / 60} h · no DST.
                    Editing IANA timezone returns to timezone rules.
                  </p>
                )}
                <div
                  className="thermal-compass"
                  aria-label={`Plan north bearing ${setup.northDeg} degrees`}
                >
                  <span style={{ transform: `rotate(${setup.northDeg}deg)` }}>
                    ↓ N
                  </span>
                  <small>True north in the plan viewer · +X → · +Y ↓</small>
                </div>
                {report?.sun && (
                  <section className="cfx-card">
                    <h3>{stale ? "Previous" : "Calculated"} sun position</h3>
                    <p>
                      Elevation {fmt(report.sun.elevationDeg, 1)}° · azimuth{" "}
                      {fmt(report.sun.azimuthDeg, 1)}° · {report.sun.instantUtc}
                    </p>
                    <div className="thermal-summary">
                      {Object.entries(report.cardinalIrradianceWm2).map(
                        ([direction, value]) => (
                          <div key={direction}>
                            <span>{direction} wall</span>
                            <strong>{fmt(value, 1)} W/m²</strong>
                          </div>
                        ),
                      )}
                    </div>
                    <small>{report.sun.method}</small>
                  </section>
                )}
              </>
            )}
            {step === 2 && (
              <>
                <h3>One instant, explicit weather</h3>
                <p>
                  Preset names are labels, not regulatory design conditions. No
                  season, hemisphere or climate values are assumed.
                  Representative means one selected hour, not a full-day or peak
                  prediction.
                </p>
                <label>
                  Scenario label
                  <select
                    value={setup.weather.scenario}
                    onChange={(e) =>
                      weather({
                        scenario: e.target
                          .value as ThermalSetup["weather"]["scenario"],
                      })
                    }
                  >
                    <option value="custom">Custom instant</option>
                    <option value="summerDesign">
                      Summer design · user-defined
                    </option>
                    <option value="winterDesign">
                      Winter design · user-defined
                    </option>
                    <option value="summerDaytime">
                      Representative summer daytime
                    </option>
                    <option value="winterDaytime">
                      Representative winter daytime
                    </option>
                  </select>
                </label>
                <div className="cfx-grid">
                  <ThermalNumber
                    label="Outdoor dry-bulb (°C)"
                    value={setup.weather.temperatureC}
                    min={-100}
                    max={200}
                    onChange={(temperatureC) => weather({ temperatureC })}
                  />
                  <ThermalNumber
                    label="Relative humidity (0–1) · metadata"
                    value={setup.weather.relativeHumidity}
                    min={0}
                    max={1}
                    onChange={(relativeHumidity) =>
                      weather({ relativeHumidity })
                    }
                  />
                  <ThermalNumber
                    label="Wind speed (m/s) · metadata"
                    value={setup.weather.windMS}
                    min={0}
                    max={150}
                    onChange={(windMS) => weather({ windMS })}
                  />
                  <ThermalNumber
                    label="Exterior h for sol-air (W/m²K)"
                    value={setup.weather.externalH}
                    min={0.001}
                    max={1000}
                    onChange={(externalH) => weather({ externalH })}
                  />
                </div>
                <ThermalText
                  label="Weather source / assumptions"
                  value={setup.weather.source}
                  onChange={(source) => weather({ source })}
                />
                <label>
                  Solar forcing
                  <select
                    value={setup.weather.solarMode}
                    onChange={(e) =>
                      weather({
                        solarMode: e.target
                          .value as ThermalSetup["weather"]["solarMode"],
                      })
                    }
                  >
                    <option value="none">Explicitly no solar</option>
                    <option value="components">
                      DNI / DHI · isotropic sky
                    </option>
                    <option value="perSurface">
                      Manual incident irradiance on each outdoor face
                    </option>
                  </select>
                </label>
                <label>
                  Radiation time basis
                  <select
                    aria-label="Radiation time basis"
                    value={setup.weather.forcingBasis}
                    onChange={(e) =>
                      weather({
                        forcingBasis: e.target
                          .value as ThermalSetup["weather"]["forcingBasis"],
                      })
                    }
                  >
                    <option value="instant">
                      Instantaneous · check component consistency
                    </option>
                    <option value="hourlyMean">
                      Hourly mean · midpoint solar approximation
                    </option>
                  </select>
                </label>
                {setup.weather.solarMode === "components" && (
                  <div className="cfx-grid">
                    {(["dniWm2", "dhiWm2", "ghiWm2"] as const).map((key) => (
                      <ThermalNumber
                        key={key}
                        label={`${key.slice(0, 3).toUpperCase()} (W/m²)${key === "ghiWm2" ? " · optional consistency check" : ""}`}
                        value={setup.weather[key]}
                        min={0}
                        max={2000}
                        onChange={(value) => weather({ [key]: value })}
                      />
                    ))}
                    {num("groundAlbedo", "Ground albedo (0–1)", 0, 1)}
                  </div>
                )}
                {setup.weather.solarMode === "perSurface" && (
                  <p className="cfx-notice">
                    Use Envelope → Advanced surface override to enter irradiance
                    on every outdoor face, including zero on unlit faces. The
                    multiplier is applied once.
                  </p>
                )}
                <details>
                  <summary>Import an hourly EPW file</summary>
                  <label className="cfx-file">
                    {importing ? "Importing…" : "Choose local EPW (≤4 MB)"}
                    <input
                      type="file"
                      accept=".epw,text/plain"
                      disabled={importing}
                      onChange={async (e) => {
                        const file = e.target.files?.[0];
                        e.target.value = "";
                        if (!file) return;
                        importAbort.current?.abort();
                        const controller = new AbortController();
                        importAbort.current = controller;
                        setImporting(true);
                        setEPWError("");
                        try {
                          const data = await importEPW(
                            apiUrl,
                            file,
                            controller.signal,
                          );
                          if (!controller.signal.aborted) {
                            setEPW(data);
                            selectEPW(0, data);
                          }
                        } catch (error) {
                          if (!controller.signal.aborted)
                            setEPWError(
                              error instanceof Error
                                ? error.message
                                : "EPW import failed.",
                            );
                        } finally {
                          if (!controller.signal.aborted) setImporting(false);
                        }
                      }}
                    />
                  </label>
                  {epwError && (
                    <p role="alert" className="cfx-error">
                      {epwError}
                    </p>
                  )}
                  {epw && (
                    <>
                      <p>
                        {epw.timeConvention} {epw.rejectedRows} invalid/missing
                        rows rejected.
                      </p>
                      <label>
                        Weather hour
                        <select
                          value={epw.records.findIndex(
                            (r) => r.localDateTime === setup.localDateTime,
                          )}
                          onChange={(e) => selectEPW(Number(e.target.value))}
                        >
                          {epw.records.map((r, index) => (
                            <option key={r.index} value={index}>
                              {r.localDateTime} · {r.temperatureC} °C
                            </option>
                          ))}
                        </select>
                      </label>
                    </>
                  )}
                  {setup.weather.epwRecord && (
                    <p className="cfx-caption">
                      Saved selected record: {setup.weather.epwRecord}. Reimport
                      the file to select a different hour after reopening.
                    </p>
                  )}
                </details>
              </>
            )}
            {step === 3 && (
              <>
                <h3>HVAC off · outdoor air exchange remains independent</h3>
                <p>
                  Equipment geometry may remain, but do not include
                  heater/chiller output as an internal gain. No infiltration is
                  assumed. The preview requires balanced, known supply and
                  extract.
                </p>
                <p className="cfx-caption">
                  Each gain is count × heat per item × sensible fraction ×
                  operating fraction. Its radiant share is included once as
                  lumped sensible heat, not resolved radiation.
                </p>
                <label>
                  Air exchange model
                  <select
                    value={setup.airExchange.mode}
                    onChange={(e) =>
                      air({
                        mode: e.target
                          .value as ThermalSetup["airExchange"]["mode"],
                      })
                    }
                  >
                    <option value="unspecified">Choose explicitly…</option>
                    <option value="none">None · sealed zone</option>
                    <option value="ach">ACH (1/hour)</option>
                    <option value="volume">Volume flow (m³/s)</option>
                    <option value="mass">Mass flow (kg/s)</option>
                    <option value="devices">
                      Existing outdoor supply / extract devices
                    </option>
                  </select>
                </label>
                {["ach", "volume", "mass"].includes(setup.airExchange.mode) && (
                  <div className="cfx-grid">
                    <ThermalNumber
                      label={`Supply (${setup.airExchange.mode === "ach" ? "1/hour" : setup.airExchange.mode === "mass" ? "kg/s" : "m³/s"})`}
                      nullable={false}
                      value={setup.airExchange.value}
                      min={0}
                      max={1e6}
                      onChange={(value) => {
                        if (value !== null) air({ value });
                      }}
                    />
                    <ThermalNumber
                      label="Extract (same units as supply)"
                      value={setup.airExchange.extractValue}
                      min={0}
                      max={1e6}
                      onChange={(extractValue) => air({ extractValue })}
                    />
                    <ThermalNumber
                      label="Supply temperature (°C)"
                      value={setup.airExchange.supplyTemperatureC}
                      min={-100}
                      max={200}
                      onChange={(supplyTemperatureC) =>
                        air({ supplyTemperatureC })
                      }
                    />
                  </div>
                )}
                {setup.airExchange.mode !== "none" && (
                  <ThermalText
                    label="Air exchange provenance"
                    value={setup.airExchange.source}
                    onChange={(source) => air({ source })}
                  />
                )}
                <label className="cfx-check">
                  <input
                    type="checkbox"
                    checked={setup.includeCFDSources}
                    onChange={(e) =>
                      update({ includeCFDSources: e.target.checked })
                    }
                  />
                  Include explicitly configured CFD object sensible powers
                </label>
                <div className="thermal-gains">
                  {setup.gains.map((gain) => (
                    <section
                      className="cfx-card"
                      key={gain.id}
                      aria-label={`Internal gain: ${gain.name}`}
                    >
                      <div className="thermal-card-title">
                        <h3>{gain.name}</h3>
                        <button
                          onClick={() =>
                            update({
                              gains: setup.gains.filter(
                                (g) => g.id !== gain.id,
                              ),
                            })
                          }
                        >
                          Delete gain
                        </button>
                      </div>
                      <ThermalText
                        label="Gain name"
                        maxLength={120}
                        required
                        value={gain.name}
                        onChange={(name) =>
                          update({
                            gains: setup.gains.map((g) =>
                              g.id === gain.id ? { ...g, name } : g,
                            ),
                          })
                        }
                      />
                      <div className="cfx-grid">
                        <label>
                          Gain type
                          <select
                            value={gain.kind}
                            onChange={(e) =>
                              update({
                                gains: setup.gains.map((g) =>
                                  g.id === gain.id
                                    ? {
                                        ...g,
                                        kind: e.target
                                          .value as typeof gain.kind,
                                      }
                                    : g,
                                ),
                              })
                            }
                          >
                            <option value="people">People</option>
                            <option value="lighting">Lighting</option>
                            <option value="equipment">Equipment</option>
                            <option value="other">Other</option>
                          </select>
                        </label>
                        {(
                          [
                            "count",
                            "powerW",
                            "sensibleFraction",
                            "operatingFraction",
                            "radiantFraction",
                          ] as const
                        ).map((key) => (
                          <ThermalNumber
                            key={key}
                            label={
                              {
                                count: "Count",
                                powerW: "Heat per item (W)",
                                sensibleFraction: "Sensible fraction (0–1)",
                                operatingFraction: "Operating fraction (0–1)",
                                radiantFraction:
                                  "Radiant fraction · lumped (0–1)",
                              }[key]
                            }
                            value={gain[key]}
                            integer={key === "count"}
                            nullable={false}
                            min={0}
                            max={
                              key === "count"
                                ? 10000
                                : key === "powerW"
                                  ? 1e7
                                  : 1
                            }
                            onChange={(value) => {
                              if (value !== null)
                                update({
                                  gains: setup.gains.map((g) =>
                                    g.id === gain.id
                                      ? { ...g, [key]: value }
                                      : g,
                                  ),
                                });
                            }}
                          />
                        ))}
                        <label>
                          Source location
                          <select
                            value={gain.roomId ?? ""}
                            onChange={(e) =>
                              update({
                                gains: setup.gains.map((g) =>
                                  g.id === gain.id
                                    ? { ...g, roomId: e.target.value || null }
                                    : g,
                                ),
                              })
                            }
                          >
                            <option value="">Whole selected domain</option>
                            {[
                              ...new Map(
                                surfaces.map((f) => [f.roomId, f.roomName]),
                              ).entries(),
                            ].map(([id, name]) => (
                              <option value={id} key={id}>
                                {name}
                              </option>
                            ))}
                          </select>
                        </label>
                        <label>
                          Link to existing object (optional)
                          <select
                            value={gain.objectId ?? ""}
                            onChange={(e) =>
                              update({
                                gains: setup.gains.map((g) =>
                                  g.id === gain.id
                                    ? { ...g, objectId: e.target.value || null }
                                    : g,
                                ),
                              })
                            }
                          >
                            <option value="">Independent lumped source</option>
                            {projectFloors(project).flatMap((f) =>
                              f.content.rooms
                                .filter((r) =>
                                  surfaces.some((s) => s.roomId === r.id),
                                )
                                .flatMap((r) =>
                                  r.obstacles.map((obj) => (
                                    <option key={obj.id} value={obj.id}>
                                      {r.name} · {obj.name}
                                    </option>
                                  )),
                                ),
                            )}
                          </select>
                        </label>
                      </div>
                      <ThermalText
                        label="Gain provenance"
                        value={gain.source}
                        onChange={(source) =>
                          update({
                            gains: setup.gains.map((g) =>
                              g.id === gain.id ? { ...g, source } : g,
                            ),
                          })
                        }
                      />
                      <label className="cfx-check">
                        <input
                          type="checkbox"
                          checked={gain.enabled}
                          onChange={(e) =>
                            update({
                              gains: setup.gains.map((g) =>
                                g.id === gain.id
                                  ? { ...g, enabled: e.target.checked }
                                  : g,
                              ),
                            })
                          }
                        />
                        Source enabled
                      </label>
                    </section>
                  ))}
                </div>
                <button
                  disabled={setup.gains.length >= 2000}
                  onClick={() =>
                    update({
                      gains: [
                        ...setup.gains,
                        thermalGainSchema.parse({
                          id: crypto.randomUUID(),
                          name: `Sensible gain ${setup.gains.length + 1}`,
                        }),
                      ],
                    })
                  }
                >
                  + Internal gain
                </button>
              </>
            )}
            {step === 4 && (
              <>
                <h3>Transparent modelling assumptions</h3>
                <p>
                  Overall U is used only for the lumped balance. Robin uses
                  Rtotal − Rsi; unknown film splits block that projection.
                  Sol-air exterior h changes the equivalent forcing, not an
                  added exterior resistance.
                </p>
                <label>
                  Global CFD wall method
                  <select
                    value={setup.method}
                    onChange={(e) =>
                      update({
                        method: e.target.value as ThermalSetup["method"],
                      })
                    }
                  >
                    <option value="robin">
                      Robin · declared inside film removed once
                    </option>
                    <option value="fixedFlux">
                      Fixed-flux approximation at reference indoor temperature
                    </option>
                  </select>
                </label>
                <div className="cfx-grid">
                  {num(
                    "groundTemperatureC",
                    "Ground temperature (°C) · explicit approximation",
                    -100,
                    200,
                  )}
                  {num(
                    "opaqueAbsorptance",
                    "Opaque solar absorptance α (0–1)",
                    0,
                    1,
                  )}
                </div>
                <label className="cfx-check">
                  <input
                    type="checkbox"
                    checked={advanced}
                    onChange={(e) => setAdvanced(e.target.checked)}
                  />
                  Show advanced parameters
                </label>
                {advanced && (
                  <div className="cfx-grid">
                    {num(
                      "referenceIndoorC",
                      "Reference indoor temperature (°C) · assumption",
                      -100,
                      200,
                    )}
                    {num(
                      "rhoKgM3",
                      "Air density (kg/m³) · assumption",
                      0.001,
                      10,
                    )}
                    {num(
                      "cpJKgK",
                      "Air heat capacity (J/kgK) · assumption",
                      0.001,
                      10000,
                    )}
                    {num(
                      "shadingFactor",
                      "Global solar multiplier (0–1) · assumption",
                      0,
                      1,
                    )}
                    {num(
                      "longwaveWm2",
                      "Net longwave correction (W/m²) · assumption",
                      -2000,
                      2000,
                    )}
                    {num(
                      "balanceToleranceW",
                      "Sensible residual tolerance (W) · assumption",
                      0.000001,
                      100,
                    )}
                  </div>
                )}
                <p className="cfx-caption">
                  Defaults for review: 20 °C reference, 1.2 kg/m³, 1005 J/kgK,
                  unshaded multiplier 1, no longwave correction, 0.01 W residual
                  tolerance. Emissivity is metadata; it does not activate a
                  radiation model.
                </p>
                <ul>
                  {(
                    report?.limitations ?? HELP.slice(1, 4).map((h) => h.text)
                  ).map((text) => (
                    <li key={text}>{text}</li>
                  ))}
                </ul>
                <label className="cfx-check">
                  <input
                    type="checkbox"
                    checked={setup.assumptionsAccepted}
                    onChange={(e) =>
                      update({ assumptionsAccepted: e.target.checked })
                    }
                  />
                  I reviewed the displayed assumptions, air properties and
                  no-HVAC limitations
                </label>
                {!scenario.physics.energy ||
                scenario.physics.mode !== "steady" ? (
                  <button
                    onClick={() =>
                      onChange(
                        {
                          ...scenario,
                          physics: {
                            ...scenario.physics,
                            preset: "buoyant",
                            energy: true,
                            boussinesq: true,
                            mode: "steady",
                          },
                        },
                        true,
                      )
                    }
                  >
                    Use steady buoyant energy physics
                  </button>
                ) : (
                  <p className="cfx-notice">
                    Steady energy physics selected. No solver is connected; the
                    thermal adapter remains contract-only.
                  </p>
                )}
              </>
            )}
            {step === 5 && (
              <>
                <h3>Review · calculate · hand off</h3>
                <p>
                  No CFD solution is computed here. Results are a reduced steady
                  sensible balance; a finite equilibrium is returned only when
                  all required inputs and heat-removal routes are defined.
                </p>
                {report && (
                  <>
                    {applied?.caseHash === report.caseHash && !stale && (
                      <p className="cfx-notice" role="status">
                        Thermal contract saved with this study. Flow and scalar
                        conditions are unchanged. No CFD run was performed.
                      </p>
                    )}
                    <div className="thermal-summary">
                      <div>
                        <span>
                          {stale
                            ? "Previous estimate"
                            : "Free-floating estimate"}
                        </span>
                        <strong>
                          {report.validation.previewReady
                            ? `${fmt(report.preview.equilibriumAirTempC)} °C`
                            : "Not available"}
                        </strong>
                      </div>
                      <div>
                        <span>Heat-loss coefficient H</span>
                        <strong>
                          {report.validation.previewReady
                            ? `${fmt(report.preview.totalConductanceWK)} W/K`
                            : "Not available"}
                        </strong>
                      </div>
                      <div>
                        <span>Balance residual</span>
                        <strong>
                          {report.validation.previewReady
                            ? `${fmt(report.preview.heatBalanceResidualW, 5)} W`
                            : "Not available"}
                        </strong>
                      </div>
                      <div>
                        <span>Ready to apply</span>
                        <strong>
                          {!stale && report.validation.applyReady
                            ? "Contract ready"
                            : "Review required"}
                        </strong>
                      </div>
                    </div>
                    <p className="cfx-caption">
                      {report.scenario.weather.scenario} · north{" "}
                      {report.scenario.northDeg}° ·{" "}
                      {report.scenario.weather.temperatureC ?? "?"} °C outdoor ·{" "}
                      {report.scenario.localDateTime} ·{" "}
                      {report.scenario.location.name}
                    </p>
                    {!!report.validation.errors.length && (
                      <section className="cfx-error" role="status">
                        <h4>Required before preview</h4>
                        <ul>
                          {report.validation.errors.map((e) => (
                            <li key={e}>{e}</li>
                          ))}
                        </ul>
                      </section>
                    )}
                    {!!report.validation.projectionErrors.length && (
                      <section className="cfx-notice">
                        <h4>Required before CFD handoff</h4>
                        <ul>
                          {report.validation.projectionErrors.map((e) => (
                            <li key={e}>{e}</li>
                          ))}
                        </ul>
                      </section>
                    )}
                    {!!report.validation.warnings.length && (
                      <details>
                        <summary>
                          Source warnings ({report.validation.warnings.length})
                        </summary>
                        <ul>
                          {report.validation.warnings.map((e) => (
                            <li key={e}>{e}</li>
                          ))}
                        </ul>
                      </details>
                    )}
                    {report.validation.previewReady && (
                      <Breakdown report={report} />
                    )}
                    <details>
                      <summary>Per-face heat ledger</summary>
                      <div className="thermal-ledger">
                        <table>
                          <thead>
                            <tr>
                              {[
                                "Surface",
                                "A m²",
                                "U W/m²K",
                                "T eq °C",
                                "Incident W/m²",
                                "Absorbed W/m²",
                                "Transmitted W",
                                "q W/m²",
                                "Q W",
                              ].map((h) => (
                                <th key={h}>{h}</th>
                              ))}
                            </tr>
                          </thead>
                          <tbody>
                            {surfaces.map((f) => (
                              <tr key={f.surfaceId}>
                                <th scope="row">
                                  {f.roomName} · {f.elementId.split("|")[1]}
                                </th>
                                {[
                                  f.areaM2,
                                  f.uWm2K,
                                  f.equivalentC,
                                  f.incidentWm2,
                                  f.absorbedWm2,
                                  f.transmittedW,
                                  f.fluxWm2,
                                  f.heatW,
                                ].map((v, i) => (
                                  <td key={i}>{fmt(v)}</td>
                                ))}
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </details>
                    <div className="cfx-actions">
                      <button
                        onClick={() =>
                          downloadThermal(
                            "thermal-boundary-contract.json",
                            JSON.stringify(report, null, 2),
                            "application/json",
                          )
                        }
                      >
                        Export thermal JSON
                      </button>
                      <button
                        onClick={() =>
                          downloadThermal(
                            "thermal-surface-ledger.csv",
                            thermalCSV(report),
                            "text/csv",
                          )
                        }
                      >
                        Export surface CSV
                      </button>
                    </div>
                    <p className="cfx-caption">
                      Case {report.caseHash.slice(0, 16)} · OpenCFD v2312
                      contract only · not runnable / not executed. Sign:
                      positive into selected air. Handoff temperatures in K.
                    </p>
                  </>
                )}
                {applied && (
                  <details>
                    <summary>
                      Applied history ({scenario.thermalSnapshots?.length}/3)
                    </summary>
                    <p>
                      {applied.sourceRevision !== report?.sourceRevision ||
                      stale
                        ? "Previous applied contract is historical / stale."
                        : "Latest applied contract matches the displayed source revision."}
                    </p>
                    {scenario.thermalSnapshots?.map((snapshot) => (
                      <button
                        key={`${snapshot.caseHash}:${snapshot.createdAt}`}
                        onClick={() =>
                          downloadThermal(
                            `thermal-history-${snapshot.caseHash.slice(0, 10)}.json`,
                            JSON.stringify(snapshot.package, null, 2),
                            "application/json",
                          )
                        }
                      >
                        Export {snapshot.createdAt} ·{" "}
                        {snapshot.caseHash.slice(0, 10)}
                      </button>
                    ))}
                    <button
                      onClick={() => {
                        if (
                          window.confirm(
                            "Remove stored thermal histories from this study? Export them first if needed. Undo can restore this change.",
                          )
                        )
                          onChange({ ...scenario, thermalSnapshots: [] }, true);
                      }}
                    >
                      Remove stored thermal histories…
                    </button>
                  </details>
                )}
              </>
            )}
          </div>
          <footer className="thermal-footer">
            <div className="cfx-actions">
              <button disabled={step === 0} onClick={() => navigate(step - 1)}>
                Back
              </button>
              <button
                disabled={step === STEPS.length - 1}
                onClick={() => navigate(step + 1)}
              >
                Next
              </button>
            </div>
            <div className="cfx-actions">
              <button
                className="cfx-primary"
                disabled={busy || !scenario.seed}
                onClick={() => {
                  if (!validDrafts()) return;
                  setStep(5);
                  onRequest(true);
                }}
              >
                {busy ? "Calculating…" : "Calculate & preview"}
              </button>
              <button
                disabled={busy || stale || !report?.validation.applyReady}
                onClick={() => {
                  if (validDrafts()) onApply();
                }}
              >
                Apply to CFD boundaries
              </button>
            </div>
          </footer>
        </div>
      </ThermalFrame>
    </div>
  );
}
