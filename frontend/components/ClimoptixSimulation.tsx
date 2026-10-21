"use client";

import { useEffect, useRef, useState } from "react";
import type { CFDScenario } from "@/lib/climoptixDocument";
import type { CFDReport } from "@/lib/climoptix";
import { downloadCFD } from "@/lib/climoptix";
import {
  samplingPlanes,
  parseResidualLog,
  LEVEL_COLOURS,
  type ResidualSample,
} from "@/lib/climoptixWorkflow";
import { CFDNumber, Parameters, MeshPanel } from "./ClimoptixPanels";
import { WindowHelpButton } from "./WindowHelpButton";

export type SimulationTab = "mesh" | "run" | "post";

function Convergence({ samples }: { samples: ResidualSample[] }) {
  const fields = [...new Set(samples.map((s) => s.field))];
  const maxIteration = Math.max(1, ...samples.map((s) => s.iteration));
  return (
    <section
      className="cfx-convergence"
      aria-label="Imported convergence history"
    >
      <h3>Convergence · initial residuals</h3>
      {!samples.length ? (
        <p>
          No computed results or residuals. Import a real OpenFOAM solver log to
          inspect convergence.
        </p>
      ) : (
        <>
          <svg
            viewBox="0 0 360 220"
            role="img"
            aria-label={`Residual graph for ${fields.join(", ")}`}
          >
            {[-12, -9, -6, -3, 0].map((tick) => {
              const y = 185 - (tick + 12) * 13;
              return (
                <g key={tick}>
                  <line
                    x1="47"
                    x2="345"
                    y1={y}
                    y2={y}
                    stroke="currentColor"
                    opacity=".15"
                  />
                  <text x="3" y={y + 4} fill="currentColor" fontSize="11">
                    10^{tick}
                  </text>
                </g>
              );
            })}
            {fields.map((field, i) => {
              const data = samples.filter((s) => s.field === field);
              const stride = Math.max(1, Math.ceil(data.length / 1000));
              const points = data
                .filter((_, j) => j % stride === 0 || j === data.length - 1)
                .map(
                  (s) =>
                    `${47 + (s.iteration / maxIteration) * 298},${185 - (Math.max(-12, Math.min(0, Math.log10(Math.max(1e-12, s.initial)))) + 12) * 13}`,
                )
                .join(" ");
              return (
                <polyline
                  key={field}
                  points={points}
                  fill="none"
                  stroke={LEVEL_COLOURS[i % LEVEL_COLOURS.length]}
                  strokeWidth="2"
                />
              );
            })}
            <text x="47" y="210" fill="currentColor" fontSize="11">
              0
            </text>
            <text
              x="345"
              y="210"
              textAnchor="end"
              fill="currentColor"
              fontSize="11"
            >
              {maxIteration} iterations / time steps
            </text>
          </svg>
          <ul className="cfx-residual-legend">
            {fields.map((field, i) => {
              const last = samples.findLast((s) => s.field === field)!;
              return (
                <li key={field}>
                  <i
                    style={{
                      background: LEVEL_COLOURS[i % LEVEL_COLOURS.length],
                    }}
                  />
                  {field}: {last.initial.toExponential(2)}
                </li>
              );
            })}
          </ul>
          <p className="cfx-caption">
            Imported data, not a live run. Repeated pressure corrections are
            retained. Chart display is clipped to 10⁻¹²–1 and decimated for
            readability; the original log is unchanged. Residuals alone do not
            establish convergence or conservation.
          </p>
        </>
      )}
    </section>
  );
}

function RunPanel({
  scenario,
  onChange,
  onExport,
  exporting,
  exportDisabled,
}: {
  scenario: CFDScenario;
  onChange: (s: CFDScenario) => void;
  onExport: () => void;
  exporting: boolean;
  exportDisabled: boolean;
}) {
  const [log, setLog] = useState<{
    file: File;
    samples: ResidualSample[];
  } | null>(null);
  const [error, setError] = useState("");
  const logRead = useRef(0);
  useEffect(
    () => () => {
      logRead.current++;
    },
    [],
  );
  const physics = scenario.physics;
  return (
    <>
      <div className="cfx-notice">
        <strong>Solver not connected</strong>
        <small>
          Save the run settings now. Play becomes available only when an
          isolated OpenFOAM worker can mesh, check and run this study. No
          background job is submitted.
        </small>
      </div>
      <div className="cfx-grid">
        <label>
          Simulation type
          <select
            aria-label="Simulation type"
            value={physics.mode}
            onChange={(e) => {
              const mode = e.target.value as typeof physics.mode;
              onChange({
                ...scenario,
                physics: {
                  ...physics,
                  mode,
                  numerics: {
                    ...physics.numerics,
                    coupling: mode === "steady" ? "SIMPLE" : "PIMPLE",
                  },
                },
              });
            }}
          >
            <option value="steady">Steady · SIMPLE</option>
            <option value="transient">Transient · PIMPLE</option>
          </select>
        </label>
        <CFDNumber
          label="CPU cores"
          value={scenario.resources.cpu}
          min={1}
          max={1024}
          onChange={(cpu) =>
            onChange({ ...scenario, resources: { ...scenario.resources, cpu } })
          }
        />
      </div>
      <div className="cfx-grid">
        <CFDNumber
          label="Memory limit (GB)"
          value={scenario.resources.memoryGb}
          onChange={(memoryGb) =>
            onChange({
              ...scenario,
              resources: { ...scenario.resources, memoryGb },
            })
          }
        />
        <CFDNumber
          label="Time limit (minutes)"
          value={scenario.resources.wallTimeMinutes}
          onChange={(wallTimeMinutes) =>
            onChange({
              ...scenario,
              resources: { ...scenario.resources, wallTimeMinutes },
            })
          }
        />
      </div>
      <details open>
        <summary>
          {physics.mode === "steady"
            ? "Iterations & convergence targets"
            : "Time stepping & output intervals"}
        </summary>
        <Parameters
          value={physics.mode === "steady" ? physics.numerics : physics.time}
          onChange={(value) =>
            onChange({
              ...scenario,
              physics:
                physics.mode === "steady"
                  ? { ...physics, numerics: value as typeof physics.numerics }
                  : { ...physics, time: value as typeof physics.time },
            })
          }
        />
      </details>
      <details>
        <summary>Resources & retention</summary>
        <Parameters
          value={scenario.resources}
          omit={["cpu", "memoryGb", "wallTimeMinutes"]}
          onChange={(v) =>
            onChange({ ...scenario, resources: v as typeof scenario.resources })
          }
        />
      </details>
      <div className="cfx-actions">
        <button
          className="cfx-primary"
          disabled
          title="No OpenFOAM worker is connected"
          aria-label="Run solver"
        >
          ▶ Play
        </button>
        <button disabled>Cancel job</button>
        <button disabled={exportDisabled || exporting} onClick={onExport}>
          {exporting ? "Exporting…" : "Export OpenFOAM settings"}
        </button>
      </div>
      <p className="cfx-caption">
        Foamlib generates settings for OpenCFD v2312, including cores, run
        control, refinement regions and named slices. The ZIP is a configuration
        handoff, not a runnable case. Validate this study before exporting.
      </p>
      <label className="cfx-file">
        Import solver log
        <input
          type="file"
          accept=".log,.txt,text/plain"
          aria-label="Import solver log"
          onChange={async (e) => {
            const file = e.target.files?.[0];
            e.target.value = "";
            if (!file) return;
            const request = ++logRead.current;
            setError("");
            try {
              if (file.size > 8 * 1024 * 1024)
                throw new Error("Solver logs must be at most 8 MB.");
              const text = await file.text();
              if (request !== logRead.current) return;
              const result = parseResidualLog(text);
              if (!result.samples.length)
                throw new Error(
                  "No OpenFOAM residual records were found in this file.",
                );
              setLog({ file, samples: result.samples });
              setError(
                result.truncated
                  ? "Display limited to 20,000 records and 32 fields. Download keeps the complete imported log."
                  : "",
              );
            } catch (e) {
              if (request === logRead.current)
                setError(
                  e instanceof Error ? e.message : "Cannot read this log.",
                );
            }
          }}
        />
      </label>
      {error && (
        <p role="alert" className="cfx-error">
          {error}
        </p>
      )}
      {log && (
        <div className="cfx-actions">
          <span>{log.file.name}</span>
          <button onClick={() => downloadCFD(log.file, log.file.name)}>
            Download original log
          </button>
          <button
            onClick={() => {
              logRead.current++;
              setLog(null);
              setError("");
            }}
          >
            Clear log
          </button>
        </div>
      )}
      <Convergence samples={log?.samples ?? []} />
    </>
  );
}

function PostPanel({
  scenario,
  report,
  onChange,
  onVTK,
}: {
  scenario: CFDScenario;
  report: CFDReport | null;
  onChange: (s: CFDScenario) => void;
  onVTK: (f: File) => void;
}) {
  const post = scenario.postProcessing,
    planes = samplingPlanes(report?.domain.boundsMm ?? null, post);
  return (
    <>
      <p className="cfx-intro">
        Define slices before running. Planes are normal to source X, Y or Z and
        are evenly spaced inside the validated domain bounds. OpenFOAM exports
        the selected fields on those named planes.
      </p>
      {(["x", "y", "z"] as const).map((axis) => (
        <div className="cfx-slice-row" key={axis}>
          <label className="cfx-check">
            <input
              type="checkbox"
              checked={post[axis].enabled}
              onChange={(e) =>
                onChange({
                  ...scenario,
                  postProcessing: {
                    ...post,
                    [axis]: { ...post[axis], enabled: e.target.checked },
                  },
                })
              }
            />
            {axis.toUpperCase()} planes
          </label>
          <CFDNumber
            label={`${axis.toUpperCase()} plane count`}
            value={post[axis].count}
            min={1}
            max={100}
            onChange={(count) =>
              onChange({
                ...scenario,
                postProcessing: { ...post, [axis]: { ...post[axis], count } },
              })
            }
          />
        </div>
      ))}
      <fieldset>
        <legend>Fields to sample</legend>
        <div className="cfx-grid">
          {(["U", "p", "T", "CO2"] as const).map((field) => (
            <label className="cfx-check" key={field}>
              <input
                type="checkbox"
                checked={post.fields.includes(field)}
                disabled={
                  !post.fields.includes(field) &&
                  ((field === "T" && !scenario.physics.energy) ||
                    (field === "CO2" && !scenario.physics.co2))
                }
                onChange={(e) =>
                  onChange({
                    ...scenario,
                    postProcessing: {
                      ...post,
                      fields: e.target.checked
                        ? [...post.fields, field]
                        : post.fields.filter((f) => f !== field),
                    },
                  })
                }
              />
              {
                {
                  U: "Velocity U",
                  p: "Pressure p",
                  T: "Temperature T",
                  CO2: "CO₂",
                }[field]
              }
            </label>
          ))}
        </div>
      </fieldset>
      <CFDNumber
        label="Sample every N field writes"
        value={post.writeInterval}
        min={1}
        max={1000000}
        onChange={(writeInterval) =>
          onChange({ ...scenario, postProcessing: { ...post, writeInterval } })
        }
      />
      <details>
        <summary>Named planes · {planes.length}</summary>
        {!report ? (
          <p>Validate the domain to resolve plane positions.</p>
        ) : (
          <ul className="cfx-inspector-list">
            {planes.map((p) => (
              <li key={p.id}>
                <strong>{p.id}</strong>
                <small>
                  {p.axis} ={" "}
                  {p.pointMm[["X", "Y", "Z"].indexOf(p.axis)].toLocaleString()}{" "}
                  mm
                </small>
              </li>
            ))}
          </ul>
        )}
      </details>
      <div className="cfx-notice">
        <strong>VTK · direct 3D field inspection</strong>
        <small>
          Import a VTK PolyData surface or slice from a real result. It stays
          local and is labelled external/unverified; it is not evidence that
          this study has run. Full volume/multi-time solver output will remain
          available as original artifacts when a worker is connected.
        </small>
      </div>
      <label className="cfx-file">
        Open VTK result
        <input
          type="file"
          aria-label="Open VTK result"
          accept=".vtp,.vtk"
          onChange={(e) => {
            const f = e.target.files?.[0];
            e.target.value = "";
            if (f) onVTK(f);
          }}
        />
      </label>
      <p className="cfx-caption">
        Supports bounded ASCII .vtp and legacy POLYDATA .vtk (25 MB). Choose a
        scalar or vector magnitude, orbit, zoom and Fit in the viewer. Download
        preserves the original data for ParaView. VTU volume grids and
        compressed/binary files require a worker-side surface/slice export.
      </p>
    </>
  );
}

export function ClimoptixSimulation({
  tab,
  onTab,
  scenario,
  report,
  selected,
  onSelect,
  onChange,
  onExport,
  exporting,
  exportDisabled,
  onVTK,
}: {
  tab: SimulationTab;
  onTab: (t: SimulationTab) => void;
  scenario: CFDScenario;
  report: CFDReport | null;
  selected: string | null;
  onSelect: (id: string) => void;
  onChange: (s: CFDScenario) => void;
  onExport: () => void;
  exporting: boolean;
  exportDisabled: boolean;
  onVTK: (f: File) => void;
}) {
  return (
    <>
      <div className="cfx-simulation-title">
        <h3>Simulation controls</h3>
        <WindowHelpButton
          title="Mesh, Run & Post-processing"
          steps={[
            {
              heading: "Mesh",
              text: "Set the global base cell size. Add cuboids with precise millimetre centres and dimensions, then assign a snappyHexMesh level. Each level halves the cell along every axis. Colours match in the list and 2D/3D viewer. The highest overlapping level wins; list order is for organisation.",
            },
            {
              heading: "Run",
              text: "Select steady/transient, cores and resource limits. Export the Foamlib settings ZIP after validation. Play stays unavailable until a trusted worker is connected. Imported log plots show real residual records, never invented live convergence.",
            },
            {
              heading: "Post-processing",
              text: "Choose how many interior X/Y/Z planes to sample and which solved fields to write. Settings are saved with the study and exported as named cutting planes. VTK surface/slice files can be inspected directly and downloaded unchanged for ParaView. Imported results are external and not bound to this study.",
            },
          ]}
        />
      </div>
      <div
        className="cfx-simulation-tabs"
        role="tablist"
        aria-label="Simulation setup"
      >
        {(
          [
            ["mesh", "Mesh"],
            ["run", "Run"],
            ["post", "Post-processing"],
          ] as const
        ).map(([id, title]) => (
          <button
            key={id}
            role="tab"
            id={`cfx-tab-${id}`}
            aria-controls={`cfx-panel-${id}`}
            aria-selected={tab === id}
            className={tab === id ? "active" : ""}
            onClick={() => onTab(id)}
            onKeyDown={(e) => {
              if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(e.key))
                return;
              e.preventDefault();
              const ids = ["mesh", "run", "post"] as const,
                index = ids.indexOf(id);
              const next =
                e.key === "Home"
                  ? 0
                  : e.key === "End"
                    ? 2
                    : (index + (e.key === "ArrowRight" ? 1 : 2)) % 3;
              onTab(ids[next]);
              document.getElementById(`cfx-tab-${ids[next]}`)?.focus();
            }}
            tabIndex={tab === id ? 0 : -1}
          >
            {title}
          </button>
        ))}
      </div>
      <section
        role="tabpanel"
        id="cfx-panel-mesh"
        aria-labelledby="cfx-tab-mesh"
        className="cfx-simulation-panel"
        hidden={tab !== "mesh"}
      >
        <MeshPanel
          scenario={scenario}
          report={report}
          selected={selected}
          onSelect={onSelect}
          onChange={onChange}
        />
      </section>
      <section
        role="tabpanel"
        id="cfx-panel-run"
        aria-labelledby="cfx-tab-run"
        className="cfx-simulation-panel"
        hidden={tab !== "run"}
      >
        <RunPanel
          key={scenario.id}
          scenario={scenario}
          onChange={onChange}
          onExport={onExport}
          exporting={exporting}
          exportDisabled={exportDisabled}
        />
      </section>
      <section
        role="tabpanel"
        id="cfx-panel-post"
        aria-labelledby="cfx-tab-post"
        className="cfx-simulation-panel"
        hidden={tab !== "post"}
      >
        <PostPanel
          scenario={scenario}
          report={report}
          onChange={onChange}
          onVTK={onVTK}
        />
      </section>
    </>
  );
}
