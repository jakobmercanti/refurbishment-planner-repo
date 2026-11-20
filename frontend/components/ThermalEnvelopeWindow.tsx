"use client";

import { useEffect, useRef, useState } from "react";
import type { CFDScenario } from "@/lib/climoptixDocument";
import { defaultThermalSetup, type ThermalMetric, type ThermalPackage, type ThermalSetup } from "@/lib/thermalDocument";
import { importEPW, type EPWData } from "@/lib/thermalClient";
import { ThermalNumber, ThermalText } from "./ThermalFields";

const fmt = (value: number, maximumFractionDigits = 1) => value.toLocaleString(undefined, {maximumFractionDigits});

export function ThermalEnvelopeWindow({ scenario, apiUrl, report, busy, error, metric, onMetric, onChange }: {
  scenario: CFDScenario;
  apiUrl: string;
  report: ThermalPackage | null;
  busy: boolean;
  error: string;
  metric: ThermalMetric;
  onMetric: (metric: ThermalMetric) => void;
  onChange: (scenario: CFDScenario) => void;
}) {
  const [epw, setEPW] = useState<EPWData | null>(null);
  const [epwError, setEPWError] = useState("");
  const [importing, setImporting] = useState(false);
  const importAbort = useRef<AbortController | null>(null);
  const latest = useRef({ scenario, onChange });
  useEffect(() => { latest.current = {scenario, onChange}; }, [scenario, onChange]);
  useEffect(() => () => importAbort.current?.abort(), []);
  const setup = scenario.thermalEnvelope ?? defaultThermalSetup();
  const update = (patch: Partial<ThermalSetup>) => onChange({...scenario, thermalEnvelope: {...setup, ...patch}});
  const location = (patch: Partial<ThermalSetup["location"]>) => update({location: {...setup.location, ...patch}});
  const weather = (patch: Partial<ThermalSetup["weather"]>) => update({weather: {...setup.weather, ...patch}});
  const num = (key: "northDeg" | "groundAlbedo", label: string, min: number, max: number) =>
    <ThermalNumber label={label} value={setup[key]} min={min} max={max} nullable={key === "groundAlbedo"}
      onChange={value => update({[key]:value})} />;
  const selectEPW = (index: number, data = epw) => {
    const row = data?.records[index];
    if (!row || !data) return;
    // Merge the imported hour into the latest version of this scenario.
    const { scenario: live, onChange: commit } = latest.current;
    const liveSetup = live.thermalEnvelope ?? defaultThermalSetup();
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

  return <div className="thermal-content cfx-live-thermal" aria-busy={busy}>
    {error && <p className="cfx-error" role="alert">{error}</p>}
    <details open><summary>Location &amp; sun</summary>
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
      <label className="cfx-check" data-field-help="Accept the editable reference weather, elevation and screening assumptions after reviewing them. This enables thermal preparation; the native CFD worker still requires an energy solver for thermal execution.">
        <input type="checkbox" checked={setup.assumptionsAccepted} onChange={event => update({assumptionsAccepted:event.target.checked})}/>
        Accept reference assumptions for thermal calculation
      </label>
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
          <h3>Calculated sun position</h3>
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
      <label>Viewer overlay<select value={metric} onChange={event => onMetric(event.target.value as ThermalMetric)}>
        <option value="off">Off</option><option value="u">U-values</option>
        <option value="exposure">Surface exposure</option><option value="heat">Sensible heat flow</option>
        <option value="missing">Missing / stale data</option>
      </select></label>
    </details>
    <details open><summary>Weather / scenario</summary>
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
          aria-label="Solar forcing"
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
          {setup.weather.solarMode === "perSurface" && <option value="perSurface">
            Manual incident irradiance on each outdoor face
          </option>}
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
            EPW record: {setup.weather.epwRecord}
          </p>
        )}
      </details>
    </details>
  </div>;
}
