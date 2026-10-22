"use client";

import { useState } from "react";
import type { CFDScenario } from "@/lib/climoptixDocument";
import type { ProjectDocument } from "@/lib/projectDocument";
import { preparationInput } from "@/lib/climoptix";
import type { CFDOperation, CFDWorkerAdapter } from "@/lib/climoptixJobs";
import { terminalJob } from "@/lib/climoptixJobs";
import { moveStudy } from "@/lib/climoptixStudies";
import type { CFDJobEntry } from "./useCFDJobs";
import { CFDReorderList } from "./CFDReorderList";
import { CFDText } from "./ClimoptixPanels";

export function ClimoptixStudies({
  project,
  scenarios,
  scenario,
  showArchived,
  onShowArchived,
  onSelect,
  onChange,
  onOrder,
  onAdd,
  onDuplicate,
  onDelete,
  onImport,
  onConvergence,
  entries,
  worker,
  onSubmit,
  onUndo,
  onRedo,
  canUndo,
  canRedo,
}: {
  project: ProjectDocument;
  scenarios: CFDScenario[];
  scenario?: CFDScenario;
  showArchived: boolean;
  onShowArchived: (show: boolean) => void;
  onSelect: (id: string) => void;
  onChange: (s: CFDScenario, checkpoint?: boolean) => void;
  onOrder: (s: CFDScenario[]) => void;
  onAdd: () => void;
  onDuplicate: () => void;
  onDelete: (id: string, opener: HTMLButtonElement) => void;
  onImport: (f: File) => void;
  onConvergence: () => void;
  entries: Record<string, CFDJobEntry>;
  worker: CFDWorkerAdapter | null;
  onSubmit: (operation: CFDOperation, studies: CFDScenario[]) => void;
  onUndo: () => void;
  onRedo: () => void;
  canUndo: boolean;
  canRedo: boolean;
}) {
  const [chosen, setChosen] = useState<string[]>([]);
  const visible = scenarios.filter((s) => showArchived || !s.archived);
  const groups = [...new Set(visible.map((s) => s.group))];
  const selected = scenarios.filter(
    (s) => chosen.includes(s.id) && !s.archived,
  );
  const busy = (s: CFDScenario) =>
    entries[s.id]?.submitting ||
    (entries[s.id]?.job && !terminalJob(entries[s.id].job!));
  const blocked = !selected.length || selected.some((s) => busy(s));
  return (
    <div className="cfx-studies">
      <header className="cfx-study-heading">
        <div>
          <span className="cfx-eyebrow">
            ONE BUILDING · INDEPENDENT SIMULATIONS
          </span>
          <h2>Studies</h2>
        </div>
        <span className="cfx-provider">
          {worker?.capabilities.connected
            ? "Worker connected"
            : "Preparation only · solver not connected"}
        </span>
      </header>
      <div className="cfx-study-tools">
        <button
          className="cfx-primary"
          onClick={onAdd}
          disabled={scenarios.length >= 100}
        >
          New study
        </button>
        <button
          onClick={onDuplicate}
          disabled={!scenario || scenarios.length >= 100}
        >
          Duplicate
        </button>
        <button
          onClick={() =>
            scenario &&
            onChange({ ...scenario, archived: !scenario.archived }, true)
          }
          disabled={!scenario || !!busy(scenario)}
        >
          {scenario?.archived ? "Unarchive" : "Archive"}
        </button>
        <button onClick={onConvergence} disabled={!scenario}>
          Convergence
        </button>
        <label className="cfx-check">
          <input
            type="checkbox"
            checked={showArchived}
            onChange={(e) => onShowArchived(e.target.checked)}
          />
          Archived
        </label>
        <div className="cfx-history">
          <button disabled={!canUndo} onClick={onUndo}>
            Undo
          </button>
          <button disabled={!canRedo} onClick={onRedo}>
            Redo
          </button>
        </div>
      </div>
      <div className="cfx-batch" aria-label="Simulation submissions">
        <label className="cfx-check">
          <input
            type="checkbox"
            aria-label="Select all simulations"
            checked={
              visible.some((s) => !s.archived) &&
              visible
                .filter((s) => !s.archived)
                .every((s) => chosen.includes(s.id))
            }
            onChange={(e) =>
              setChosen(
                e.target.checked
                  ? visible.filter((s) => !s.archived).map((s) => s.id)
                  : [],
              )
            }
          />
          {selected.length} selected
        </label>
        <button
          disabled={
            blocked ||
            !worker?.capabilities.connected ||
            !worker.capabilities.mesh
          }
          onClick={() => onSubmit("mesh", selected)}
        >
          Mesh
        </button>
        <button
          className="cfx-primary"
          disabled={
            blocked ||
            !worker?.capabilities.connected ||
            !worker.capabilities.run
          }
          onClick={() => onSubmit("run", selected)}
        >
          Run
        </button>
        <small>
          {worker?.capabilities.connected
            ? "Each study is validated before submission. Jobs run independently."
            : "Worker not connected. Settings are saved; Mesh and Run become available when a trusted worker is connected."}
        </small>
        {worker?.capabilities.reason && (
          <small>{worker.capabilities.reason}</small>
        )}
      </div>
      {!visible.length && (
        <div className="cfx-welcome">
          <h3>Start with the building you already designed.</h3>
          <p>
            Create a study or import its settings. Your shared building remains
            authoritative.
          </p>
          <button onClick={onAdd}>Create first study</button>
          <label className="cfx-file">
            Import study
            <input
              aria-label="Import CFD scenario"
              type="file"
              accept=".json,application/json"
              onChange={(e) => {
                const file = e.target.files?.[0];
                e.target.value = "";
                if (file) onImport(file);
              }}
            />
          </label>
        </div>
      )}
      {groups.map((group) => (
        <section
          className="cfx-study-group"
          key={group}
          aria-label={`Simulation group ${group}`}
        >
          <h3>
            {group}
            <small>
              {visible.filter((s) => s.group === group).length} studies
            </small>
          </h3>
          <CFDReorderList
            items={visible.filter((s) => s.group === group)}
            label={`${group} simulations`}
            scope={`studies:${project.projectId}`}
            onMove={(id, boundary) => {
              // Archived rows hidden from this list must not shift insertion targets.
              const shown = visible.filter((s) => s.group === group);
              const anchor = shown[boundary]?.id;
              const all = scenarios.filter((s) => s.group === group);
              const at = anchor
                ? all.findIndex((s) => s.id === anchor)
                : all.length;
              onOrder(moveStudy(scenarios, id, group, at));
            }}
          >
            {(s) => {
              const entry = entries[s.id];
              const job = entry?.job;
              const stale =
                !!job && entry.input !== preparationInput(project, s);
              const phase = entry?.submitting
                ? "Checking & submitting…"
                : job
                  ? `${job.phase}${stale ? " · older setup" : ""}`
                  : "Not submitted";
              const progress = job?.progress;
              return (
                <article
                  className={`cfx-study-row${s.id === scenario?.id ? " selected" : ""}`}
                >
                  <label className="cfx-check">
                    <input
                      type="checkbox"
                      aria-label={`Queue ${s.name}`}
                      disabled={s.archived}
                      checked={chosen.includes(s.id)}
                      onChange={(e) =>
                        setChosen((ids) =>
                          e.target.checked
                            ? [...ids.filter((id) => id !== s.id), s.id]
                            : ids.filter((id) => id !== s.id),
                        )
                      }
                    />
                    <span className="sr-only">Select for batch</span>
                  </label>
                  <button
                    className="cfx-study-name"
                    aria-label={`Select ${s.name}`}
                    aria-pressed={s.id === scenario?.id}
                    onClick={() => onSelect(s.id)}
                  >
                    <strong>{s.name}</strong>
                    <small>
                      {s.archived ? "Archived · " : ""}
                      {phase}
                    </small>
                  </button>
                  <button
                    aria-label={`Delete ${s.name}`}
                    className="cfx-danger"
                    disabled={!!busy(s)}
                    title={
                      busy(s)
                        ? "Wait for this worker job to finish before deleting the study"
                        : undefined
                    }
                    onClick={(e) => onDelete(s.id, e.currentTarget)}
                  >
                    Delete
                  </button>
                  <div
                    className="cfx-job-progress"
                    role="progressbar"
                    aria-label={`${s.name} phase progress`}
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-valuenow={progress ?? undefined}
                    aria-valuetext={
                      job
                        ? `${phase}${progress == null ? " · progress not reported" : ` · ${progress}%`}`
                        : phase
                    }
                  >
                    <span style={{ width: `${progress ?? 0}%` }} />
                  </div>
                  {job && (
                    <small className="cfx-job-detail">
                      {job.phase}
                      {progress != null
                        ? ` · ${progress}% of phase`
                        : " · awaiting phase progress"}
                      {job.message && ` · ${job.message}`}
                    </small>
                  )}
                  {entry?.error && (
                    <p className="cfx-error" role="alert">
                      {entry.error}
                    </p>
                  )}
                </article>
              );
            }}
          </CFDReorderList>
        </section>
      ))}
      {scenario && (
        <section
          className="cfx-card cfx-grid"
          aria-label="Selected study details"
          key={scenario.id}
        >
          <CFDText
            label="Study name"
            value={scenario.name}
            onChange={(name) => onChange({ ...scenario, name })}
          />
          <CFDText
            label="Simulation group"
            value={scenario.group}
            maxLength={80}
            onChange={(group) =>
              onChange({ ...scenario, group: group.trim() }, true)
            }
          />
          <p className="cfx-caption">
            Select a name to load its settings in every tab. Drag the grip to
            reorder or move between groups; Arrow Up/Down reorders within a
            group. Enter a new group name here to create one.
          </p>
        </section>
      )}
    </div>
  );
}
