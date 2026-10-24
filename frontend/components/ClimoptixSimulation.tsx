"use client";

import type { ReactNode } from "react";
import type { CFDScenario } from "@/lib/climoptixDocument";
import type { CFDReport } from "@/lib/climoptix";
import { samplingPlanes } from "@/lib/climoptixWorkflow";
import { CFD_SIMULATION_HELP } from "@/lib/climoptixHelp";
import { CFDNumber, Parameters, MeshPanel } from "./ClimoptixPanels";
import { WindowHelpButton } from "./WindowHelpButton";

export type SimulationTab = "mesh" | "run" | "monitor" | "post";

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
  onConvergence,
  connection,
}: {
  scenario: CFDScenario;
  onChange: (s: CFDScenario) => void;
  onExport: () => void;
  exporting: boolean;
  exportDisabled: boolean;
  onConvergence: () => void;
  connection?: RunConnection;
}) {
  const physics = scenario.physics;
  return (
    <>
      <p className="cfx-connection-status" role="status">
        {connection?.connected ? "Worker connected" : "Solver not connected"}
      </p>
      <details open><summary>Simulation &amp; resources</summary>
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
      </details>
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
              ? "Validate and submit this simulation"
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
  const requested = (["x", "y", "z"] as const).reduce((count, axis) => count + (post[axis].enabled ? post[axis].count : 0), 0);
  return (
    <>
      <details open><summary>Sampling planes</summary>
      <p className="cfx-caption">Equally spaced interior slices. The normal is perpendicular to the named plane; positions use the checked domain in millimetres.</p>
      <div className="cfx-post-planes" role="group" aria-label="Sampling plane directions">
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
            {{ x: "YZ slices (normal X)", y: "XZ slices (normal Y)", z: "XY slices (normal Z)" }[axis]}
          </label>
          <CFDNumber
            label={`${axis.toUpperCase()} plane count`}
            value={post[axis].count}
            min={1}
            max={100}
            disabled={!post[axis].enabled}
            onChange={(count) =>
              onChange({
                ...scenario,
                postProcessing: { ...post, [axis]: { ...post[axis], count } },
              })
            }
          />
        </div>
      ))}
      </div>
      </details>
      <details open><summary>Sampled fields &amp; output cadence</summary>
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
      <div className="cfx-grid">
        <CFDNumber label="Sample every N field writes" value={post.writeInterval} min={1} max={1000000}
          onChange={writeInterval => onChange({ ...scenario, postProcessing: { ...post, writeInterval } })} />
      </div>
      <small className="cfx-caption">One means every saved field set, not every solver iteration.</small>
      </details>
      <details>
        <summary>Plane positions · {report?.domain.boundsMm ? planes.length : `${requested} requested · domain pending`}</summary>
        {!report?.domain.boundsMm ? (
          <p>Choose a seed room in Domain and resolve preparation checks to calculate plane positions.</p>
        ) : !planes.length ? (
          <p>No sampling planes selected.</p>
        ) : (
          <ul className="cfx-inspector-list">
            {planes.map((p) => (
              <li key={p.id}>
                <strong>{p.id}</strong>
                <small>
                  {p.axis} ={" "}
                  {p.pointMm[["X", "Y", "Z"].indexOf(p.axis)].toLocaleString()}{" "}
                  mm · checked domain
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
      <div className="cfx-inline-toolbar">
      <div
        className="cfx-simulation-tabs"
        role="tablist"
        aria-label="Simulation setup"
      >
        {(
          [
            ["mesh", "Mesh"],
            ["run", "Run"],
            ["monitor", "Monitor"],
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
              const ids = ["mesh", "run", "monitor", "post"] as const,
                index = ids.indexOf(id);
              const next =
                e.key === "Home"
                  ? 0
                  : e.key === "End"
                    ? 3
                    : (index + (e.key === "ArrowRight" ? 1 : 3)) % 4;
              onTab(ids[next]);
              document.getElementById(`cfx-tab-${ids[next]}`)?.focus();
            }}
            tabIndex={tab === id ? 0 : -1}
          >
            {id === "post" ? "Post" : title}
          </button>
        ))}
      </div>
      <WindowHelpButton title="Mesh, Run & Post-processing" steps={CFD_SIMULATION_HELP} />
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
          onConvergence={onConvergence}
          connection={connection}
        />
      </section>
      <section role="tabpanel" id="cfx-panel-monitor" aria-labelledby="cfx-tab-monitor"
        className="cfx-simulation-panel" hidden={tab !== "monitor"}>
        <section aria-label="Convergence monitor">{convergence}</section>
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
