"use client";

import type { ReactNode } from "react";
import { MAX_SAMPLING_PLANES, MIN_SAMPLING_PLANES, type CFDScenario } from "@/lib/climoptixDocument";
import type { CFDReport } from "@/lib/climoptix";
import { CFD_SIMULATION_HELP } from "@/lib/climoptixHelp";
import { CFDNumber, Parameters } from "./CFDFields";
import { MeshPanel } from "./ClimoptixMesh";
import { WindowHelpButton } from "./WindowHelpButton";
import { CFDCollapseAll } from "./CFDCollapseAll";
import { CFDProbes } from "./CFDProbes";

const SOLVER_TABS = [
  ["mesh", "Mesh"], ["run", "Run"], ["monitor", "Monitor"],
  ["post", "Post-processing"], ["adjoint", "Optimisation"],
] as const;
export type SimulationTab = typeof SOLVER_TABS[number][0];

interface RunConnection {
  connected: boolean;
  canRun: boolean;
  busy: boolean;
  blockedReason?: string;
  onRun: () => void;
  onIssues: () => void;
  onAirflowCopy?: () => void;
}

function RunPanel({
  scenario,
  onChange,
  onExport,
  exporting,
  exportDisabled,
  connection,
}: {
  scenario: CFDScenario;
  onChange: (s: CFDScenario) => void;
  onExport: () => void;
  exporting: boolean;
  exportDisabled: boolean;
  connection?: RunConnection;
}) {
  const physics = scenario.physics;
  return (
    <div data-cfx-collapse-root className="cfx-run-panel">
      <details open><summary>Solver actions</summary>
      <div className="cfx-panel-actions">
        <button className="cfx-primary" aria-label="Run solver"
          disabled={!connection?.canRun || connection.busy || scenario.archived}
          title={connection?.blockedReason || (!connection?.connected ? "Sign in and connect the OpenFOAM worker" : undefined)}
          onClick={() => connection?.onRun()}>▶ Play</button>
        <button disabled={exportDisabled || exporting} onClick={onExport}>{exporting ? "Exporting…" : "Export OpenFOAM settings"}</button>
      </div>
      {connection?.blockedReason && <p className="cfx-notice" role="status">
        {connection.blockedReason} <button onClick={connection.onIssues}>Review submission issues</button>
        {connection.onAirflowCopy && <button type="button" onClick={connection.onAirflowCopy}>Create airflow copy</button>}
      </p>}
      </details>
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
          max={2}
          onChange={(cpu) =>
            onChange({ ...scenario, resources: { ...scenario.resources, cpu } })
          }
        />
        <CFDNumber
          label="Memory limit (GB)"
          value={scenario.resources.memoryGb}
          max={4}
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
    </div>
  );
}

function PostPanel({
  scenario,
  onChange,
  selected,
  onSelect,
  samplingPreview,
  onSamplingPreview,
}: {
  scenario: CFDScenario;
  onChange: (s: CFDScenario) => void;
  selected:string|null;
  onSelect:(id:string|null)=>void;
  samplingPreview: boolean;
  onSamplingPreview: (show: boolean) => void;
}) {
  const post = scenario.postProcessing;
  return (
    <section className="cfx-post-panel" data-cfx-collapse-root>
      <div className="cfx-inline-toolbar"><h3>Post-processing</h3><CFDCollapseAll/></div>
      <CFDProbes scenario={scenario} onChange={onChange} selected={selected} onSelect={onSelect}/>
      <details open><summary>Sampling planes</summary>
      <label className="cfx-check"><input type="checkbox" checked={samplingPreview} onChange={event => onSamplingPreview(event.target.checked)} />Preview sampling planes in 3D</label>
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
            min={MIN_SAMPLING_PLANES}
            max={MAX_SAMPLING_PLANES}
            disabled={!post[axis].enabled}
            validate={count => count < MIN_SAMPLING_PLANES
                ? `Enter at least ${MIN_SAMPLING_PLANES} planes.`
                : !Number.isInteger(count) || count > MAX_SAMPLING_PLANES
                  ? `Enter a whole number up to ${MAX_SAMPLING_PLANES}.` : undefined}
            onChange={count =>
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
    </section>
  );
}

export function ClimoptixSimulation({
  tab,
  onTab,
  samplingPreview,
  onSamplingPreview,
  scenario,
  report,
  selected,
  onSelect,
  onChange,
  onExport,
  exporting,
  exportDisabled,
  convergence,
  jobProgress,
  onShowRefinements,
  onEditRefinement,
  connection,
  domain,
  optimisation,
}: {
  tab: SimulationTab;
  onTab: (t: SimulationTab) => void;
  samplingPreview: boolean;
  onSamplingPreview: (show: boolean) => void;
  scenario: CFDScenario;
  report: CFDReport | null;
  selected: string | null;
  onSelect: (id: string | null) => void;
  onChange: (s: CFDScenario) => void;
  onExport: () => void;
  exporting: boolean;
  exportDisabled: boolean;
  convergence: ReactNode;
  jobProgress?: ReactNode;
  onShowRefinements: () => void;
  onEditRefinement: (id: string) => void;
  connection?: RunConnection;
  domain: ReactNode;
  optimisation: ReactNode;
}) {
  return (
    <>
      <div className="cfx-inline-toolbar cfx-solver-nav">
      <div
        className="cfx-simulation-tabs"
        role="tablist"
        aria-label="Simulation setup"
      >
        {SOLVER_TABS.map(([id, title], index) => (
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
              const count = SOLVER_TABS.length;
              const next =
                e.key === "Home"
                  ? 0
                  : e.key === "End"
                    ? count - 1
                    : (index + (e.key === "ArrowRight" ? 1 : -1) + count) % count;
              const [nextId] = SOLVER_TABS[next];
              onTab(nextId);
              document.getElementById(`cfx-tab-${nextId}`)?.focus();
            }}
            tabIndex={tab === id ? 0 : -1}
          >
            {id === "post" ? "Post" : title}
          </button>
        ))}
      </div>
      <WindowHelpButton title="Mesh, Run & Post-processing" steps={CFD_SIMULATION_HELP} />
      </div>
      {tab !== "adjoint" && jobProgress}
      <section
        role="tabpanel"
        id="cfx-panel-mesh"
        aria-labelledby="cfx-tab-mesh"
        className="cfx-simulation-panel"
        hidden={tab !== "mesh"}
      >
        <details id="cfx-setup-panel-domain" open><summary>Domain</summary>{domain}</details>
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
          onChange={onChange}
          selected={selected}
          onSelect={onSelect}
          samplingPreview={samplingPreview}
          onSamplingPreview={onSamplingPreview}
        />
      </section>
      <section role="tabpanel" id="cfx-panel-adjoint" aria-labelledby="cfx-tab-adjoint"
        className="cfx-simulation-panel" hidden={tab !== "adjoint"}>{optimisation}</section>
    </>
  );
}
