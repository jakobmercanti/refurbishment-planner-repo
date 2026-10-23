"use client";

import type { ReactNode } from "react";
import type { CFDScenario } from "@/lib/climoptixDocument";
import type { CFDReport } from "@/lib/climoptix";
import { samplingPlanes } from "@/lib/climoptixWorkflow";
import { CFD_SIMULATION_HELP } from "@/lib/climoptixHelp";
import { CFDNumber, Parameters, MeshPanel } from "./ClimoptixPanels";
import { WindowHelpButton } from "./WindowHelpButton";

export type SimulationTab = "mesh" | "run" | "post";

export interface RunConnection {
  connected: boolean;
  canRun: boolean;
  busy: boolean;
  blockedReason?: string;
  onRun: () => void;
}

function RunPanel({
  scenario,
  onChange,
  onExport,
  exporting,
  exportDisabled,
  convergence,
  onConvergence,
  connection,
}: {
  scenario: CFDScenario;
  onChange: (s: CFDScenario) => void;
  onExport: () => void;
  exporting: boolean;
  exportDisabled: boolean;
  convergence: ReactNode;
  onConvergence: () => void;
  connection?: RunConnection;
}) {
  const physics = scenario.physics;
  return (
    <>
      <span className="cfx-provider">
        {connection?.connected ? "Worker connected" : "Solver not connected"}
      </span>
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
      {physics.mode === "transient" && (
        <details>
          <summary>Advanced numerics &amp; convergence targets</summary>
          <Parameters
            value={physics.numerics}
            onChange={(value) =>
              onChange({
                ...scenario,
                physics: {
                  ...physics,
                  numerics: value as typeof physics.numerics,
                },
              })
            }
          />
        </details>
      )}
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
          disabled={!connection?.canRun || connection.busy || scenario.archived}
          onClick={() => connection?.onRun()}
          title={
            connection?.blockedReason ||
            (connection?.canRun
              ? "Validate and submit this study"
              : connection?.connected
                ? "The worker does not support Run"
                : "No OpenFOAM worker is connected")
          }
          aria-label="Run solver"
        >
          ▶ Play
        </button>
        <button disabled={exportDisabled || exporting} onClick={onExport}>
          {exporting ? "Exporting…" : "Export OpenFOAM settings"}
        </button>
      </div>
      <button onClick={onConvergence}>Open monitor</button>
      {convergence}
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
          <p>Plane positions pending validation.</p>
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
      <small className="cfx-caption">
        ASCII .vtp / .vtk · 25 MB · external, unverified
      </small>
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
  convergence,
  onConvergence,
  onShowRefinements,
  onEditRefinement,
  connection,
}: {
  tab: SimulationTab;
  onTab: (t: SimulationTab) => void;
  scenario: CFDScenario;
  report: CFDReport | null;
  selected: string | null;
  onSelect: (id: string | null) => void;
  onChange: (s: CFDScenario) => void;
  onExport: () => void;
  exporting: boolean;
  exportDisabled: boolean;
  convergence: ReactNode;
  onConvergence: () => void;
  onShowRefinements: () => void;
  onEditRefinement: (id: string) => void;
  connection?: RunConnection;
  onVTK: (f: File) => void;
}) {
  return (
    <>
      <div className="cfx-simulation-title">
        <h3>Simulation controls</h3>
        <WindowHelpButton
          title="Mesh, Run & Post-processing"
          steps={CFD_SIMULATION_HELP}
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
            aria-label={title}
            title={title}
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
            {id === "post" ? "Post" : title}
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
          onShowRefinements={onShowRefinements}
          onEditRefinement={onEditRefinement}
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
          convergence={convergence}
          onConvergence={onConvergence}
          connection={connection}
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
