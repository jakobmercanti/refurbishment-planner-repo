"use client";

import { useEffect, useRef, useState } from "react";
import { duplicateCFDScenario, type CFDScenario, type CFDSimulationGroup } from "@/lib/climoptixDocument";
import type { ProjectDocument } from "@/lib/projectDocument";
import type { CFDOperation, CFDWorkerAdapter } from "@/lib/climoptixJobs";
import { terminalJob, workerConfigurationIssue, workerInput } from "@/lib/climoptixJobs";
import { insertAtBoundary, moveStudy } from "@/lib/climoptixStudies";
import { duplicateSimulationGroup, sameGroup, simulationGroups, uniqueGroupName } from "@/lib/climoptixGroups";
import { jobHasCheckedMesh, type CFDJobEntry } from "./useCFDJobs";
import { CFDReorderList } from "./CFDReorderList";
import { CFDRowMenu } from "./CFDRowMenu";
import { CFDCollapseAll } from "./CFDCollapseAll";
import { CFDConfirmAction } from "./CFDConfirmAction";
import { CFDJobProgress } from "./CFDJobProgress";

function InlineName({ value, label, maxLength = 120, onCommit, onDone }: {
  value: string; label: string; maxLength?: number; onCommit: (value: string) => void | boolean; onDone?: () => void;
}) {
  const [draft, setDraft] = useState(value);
  const input = useRef<HTMLInputElement>(null);
  const editing = !!onDone;
  useEffect(() => { if (editing) { input.current?.focus(); input.current?.select(); } }, [editing]);
  return <input ref={input} className="cfx-inline-name" aria-label={label} value={draft} maxLength={maxLength}
    onChange={e => setDraft(e.target.value)} onBlur={() => { if (!draft.trim() || onCommit(draft.trim()) === false) setDraft(value); onDone?.(); }}
    onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); e.currentTarget.blur(); }
      if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); setDraft(value); onDone?.(); } }} />;
}

export function ClimoptixStudies({ project, scenarios, scenario, showArchived, onShowArchived, onSelect,
  onChange, onOrder, onAdd, onDelete, onClear, onReset, resetting, onImport, entries, worker, onSubmit, onOpenResults, onUndo, onRedo, canUndo, canRedo,
}: {
  project: ProjectDocument; scenarios: CFDScenario[]; scenario?: CFDScenario; showArchived: boolean;
  onShowArchived: (show: boolean) => void; onSelect: (id: string) => void;
  onChange: (s: CFDScenario, checkpoint?: boolean) => void;
  onOrder: (s: CFDScenario[], groups?: CFDSimulationGroup[], copiedFrom?: Record<string, string>) => void;
  onAdd: (group: string | undefined, opener: HTMLButtonElement) => void;
  onDelete: (id: string, opener: HTMLButtonElement) => void;
  onClear: (opener: HTMLButtonElement) => void;
  onReset: () => void; resetting: boolean;
  onImport: (f: File) => void;
  entries: Record<string, CFDJobEntry>; worker: CFDWorkerAdapter | null;
  onSubmit: (operation: CFDOperation, studies: CFDScenario[]) => void;
  onOpenResults: (studyId: string, jobId?: string) => void;
  onUndo: () => void; onRedo: () => void; canUndo: boolean; canRedo: boolean;
}) {
  const visible = scenarios.filter(s => showArchived || !s.archived);
  const groups = simulationGroups(scenarios, project.cfdSimulationGroups);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [selectedGroup, setSelectedGroup] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set());
  const targetGroup = groups.find(g => g.id === selectedGroup) ?? groups.find(g => sameGroup(g.name, scenario?.group ?? "")) ?? groups[0];
  const busy = (s: CFDScenario) => !!entries[s.id]?.submitting || !!(entries[s.id]?.job && !terminalJob(entries[s.id].job!));
  const renameGroup = (group: CFDSimulationGroup, name: string) => {
    if (groups.some(g => g.id !== group.id && sameGroup(g.name, name))) { setError("A group already has that name."); return false; }
    setError("");
    onOrder(scenarios.map(s => sameGroup(s.group, group.name) ? { ...s, group: name } : s), groups.map(g => g.id === group.id ? { ...g, name } : g));
    return true;
  };
  const deleteGroup = (group: CFDSimulationGroup) => {
    const members = scenarios.filter(s => sameGroup(s.group, group.name));
    const remaining = groups.filter(g => g.id !== group.id);
    let destination = remaining.find(g => sameGroup(g.name, "Ungrouped"));
    if (members.length && !destination) { destination = { id: crypto.randomUUID(), name: "Ungrouped" }; remaining.push(destination); }
    onOrder(scenarios.map(s => sameGroup(s.group, group.name) ? { ...s, group: destination!.name } : s), remaining);
  };
  return <div className="cfx-studies" data-cfx-collapse-root>
    <details open><summary>Manage simulations</summary>
    <div className="cfx-study-tools">
      <div className="cfx-study-tools-primary">
      <button className="cfx-primary" onClick={event => { if (targetGroup) setCollapsed(v => new Set([...v].filter(id => id !== targetGroup.id))); onAdd(targetGroup?.name, event.currentTarget); }} disabled={resetting || scenarios.length >= 100}>New simulation</button>
      <button disabled={groups.length >= 100} onClick={() => {
        const group = { id: crypto.randomUUID(), name: uniqueGroupName(groups.map(g => g.name)) };
        onOrder(scenarios, [...groups, group]); setSelectedGroup(group.id);
      }}>Add group</button>
      <button className="cfx-danger" disabled={resetting || (!scenarios.length && !groups.length) || scenarios.some(s => busy(s) || entries[s.id]?.dispatched)}
        title={scenarios.some(s => busy(s) || entries[s.id]?.dispatched) ? "Resolve active or unknown worker submissions before clearing simulations" : undefined}
        onClick={e => onClear(e.currentTarget)}>Clear all</button>
      <CFDConfirmAction label={resetting ? "Preparing defaults…" : "Restore default"} title="Restore the default workbench?" confirmLabel="Restore default"
        disabled={resetting || scenarios.some(s => busy(s) || entries[s.id]?.dispatched)}
        description="Back up the workbench, then replace its simulations with one starter case. This clears loaded results and permanently deletes their saved worker files, including archived simulations’ results. The starter inlet and outlet replace shared vents in the checked rooms. Undo restores simulation settings and vents. Deleted result files cannot be recovered."
        onConfirm={onReset} />
      </div>
      <label className="cfx-check"><input type="checkbox" checked={showArchived} onChange={e => onShowArchived(e.target.checked)} />Archived</label>
      <div className="cfx-history"><button disabled={!canUndo} onClick={onUndo}>Undo</button><button disabled={!canRedo} onClick={onRedo}>Redo</button></div>
      <CFDCollapseAll onToggle={open=>setCollapsed(new Set(open?[]:groups.map(group=>group.id)))}/>
    </div>
    {error && <p className="cfx-error" role="alert">{error}</p>}
    {!scenarios.length && <div className="cfx-welcome"><h3>No simulations</h3>
      <div className="cfx-actions"><button onClick={event => onAdd(targetGroup?.name, event.currentTarget)}>Create first simulation</button>
      <label className="cfx-file">Import simulation<input aria-label="Import CFD scenario" type="file" accept=".json,application/json"
        onChange={e => { const file = e.target.files?.[0]; e.target.value = ""; if (file) onImport(file); }} /></label>
      </div>
    </div>}
    <div className="cfx-group-tree">
      <CFDReorderList items={groups} label="Simulation groups" scope={`simulation-groups:${project.projectId}`}
        onMove={(id, at) => onOrder(scenarios, insertAtBoundary(groups, id, at))}>
        {group => {
          const members = visible.filter(s => sameGroup(s.group, group.name));
          const allMembers = scenarios.filter(s => sameGroup(s.group, group.name));
          return <section className={`cfx-study-group${targetGroup?.id === group.id ? " selected-group" : ""}`} aria-label={`Simulation group ${group.name}`}
            onClickCapture={() => setSelectedGroup(group.id)}>
            <CFDReorderList items={members} label={`${group.name} simulations`} scope={`simulations:${project.projectId}`}
              collapsed={collapsed.has(group.id)}
              header={<header className="cfx-group-heading">
              <button className="cfx-collapse" aria-label={`${collapsed.has(group.id) ? "Expand" : "Collapse"} group ${group.name}`} aria-expanded={!collapsed.has(group.id)}
                onClick={() => setCollapsed(previous => { const next = new Set(previous); if (next.has(group.id)) next.delete(group.id); else next.add(group.id); return next; })}>{collapsed.has(group.id) ? "▸" : "▾"}</button>
              <InlineName key={`${group.id}:${group.name}`} value={group.name} label={`Rename group ${group.name}`} maxLength={80} onCommit={name => renameGroup(group, name)} />
              <div className="cfx-group-actions">
                <button className="cfx-add-sim" aria-label={`Add simulation to ${group.name}`} disabled={resetting || scenarios.length >= 100} onClick={event => { setCollapsed(v => new Set([...v].filter(id => id !== group.id))); onAdd(group.name, event.currentTarget); }}>+ sim</button>
                <button aria-label={`Duplicate group ${group.name}`} disabled={scenarios.length + allMembers.length > 100 || groups.length >= 100}
                  onClick={() => { const copy = duplicateSimulationGroup(scenarios, groups, group.id); if (copy) { const sources = scenarios.filter(s => sameGroup(s.group, group.name)), added = copy.scenarios.filter(s => !scenarios.some(old => old.id === s.id)); onOrder(copy.scenarios, copy.groups, Object.fromEntries(added.map((s, i) => [s.id, sources[i].id]))); setSelectedGroup(copy.groups.find(g => !groups.some(old => old.id === g.id))!.id); } }}>Duplicate</button>
                <button className="cfx-danger" aria-label={`Delete group ${group.name}`} title="Remove this folder; keep its simulations in Ungrouped"
                  onClick={() => deleteGroup(group)}>Delete</button>
              </div>
            </header>}
              onMove={(id, at) => {
                const anchor = members[at]?.id;
                const original = scenarios.filter(s => sameGroup(s.group, group.name));
                const boundary = anchor ? original.findIndex(s => s.id === anchor) : original.length;
                onOrder(moveStudy(scenarios, id, group.name, boundary), groups);
                setSelectedGroup(group.id);
              }}>
              {s => {
                const entry = entries[s.id], job = entry?.job;
                const currentInput = !!entry && entry.input === workerInput(project, s);
                const stale = !!job && !currentInput;
                const operation = job?.operation ?? entry?.operation;
                const currentJob = currentInput ? job : undefined;
                const checkedMesh = currentInput && (entry.meshChecked || jobHasCheckedMesh(currentJob));
                const solved = !!currentJob && operation === "run" && ["Postprocess", "Completed"].includes(currentJob.phase);
                const posted = solved && currentJob?.phase === "Completed";
                const working = currentInput && busy(s);
                const running = currentJob?.phase === "Running" || (working && operation === "run" && checkedMesh);
                const nextOperation = entry?.dispatched ? entry.operation
                  : posted ? undefined : checkedMesh || currentInput && operation === "run" ? "run" : "mesh";
                const showResults = job?.phase === "Completed" && operation === "run";
                const stages = [
                  { label: "Mesh", state: checkedMesh ? "completed" : working ? "running" : "pending" },
                  { label: "Run", state: solved ? "completed" : running ? "running" : "pending" },
                  { label: "Post", state: posted ? "completed" : currentJob?.phase === "Postprocess" ? "running" : "pending" },
                ];
                const phase = entry?.submitting ? "Checking & submitting…" : job ? `${job.phase}${stale ? " · older setup" : ""}` : entry?.dispatched ? "Submission status unknown" : "Not submitted";
                const checkConfiguration = (operation: CFDOperation) => entry?.dispatched ? undefined : workerConfigurationIssue(project, s, worker, operation);
                const configurationIssue = checkConfiguration("run");
                const hasIssues = !!(entry?.error || configurationIssue || s.validation?.errors ||
                  (!entry?.dispatched && worker?.capabilities.connected && !worker.capabilities.run));
                const reason = (operation: CFDOperation) => resetting ? "Wait for default setup to finish" : s.archived ? "Unarchive this simulation before submitting" : busy(s) ? "Wait for this job to finish" :
                  entry?.dispatched && entry.operation !== operation ? `Recover the previous ${entry.operation} submission first` :
                  !worker?.capabilities.connected ? worker?.capabilities.reason || "Connect an OpenFOAM worker to submit this simulation" :
                  entry?.dispatched ? undefined :
                  !worker.capabilities[operation] ? worker.capabilities.reason || `This worker does not support ${operation}` : operation === "run" ? configurationIssue : checkConfiguration(operation);
                const blocked = nextOperation ? reason(nextOperation) : undefined;
                return <article className={`cfx-study-row${s.id === scenario?.id ? " selected" : ""}`}>
                  {renaming === s.id ? <InlineName key={s.id} value={s.name} label="Simulation name" onCommit={name => onChange({ ...s, name }, true)} onDone={() => setRenaming(null)} /> :
                    <button className="cfx-study-name" aria-label={`Select ${s.name}`} aria-pressed={s.id === scenario?.id}
                      aria-describedby={`cfx-study-status-${s.id} cfx-study-phases-${s.id}`} title={`${s.name} · ${phase}`} onClick={() => onSelect(s.id)} onDoubleClick={() => setRenaming(s.id)}>
                      <span className="cfx-study-description">
                        <strong>{s.name}</strong><small id={`cfx-study-status-${s.id}`}>{s.archived ? "Archived · " : ""}{hasIssues ? "Issues · see top panel" : phase}</small>
                      </span>
                      <span className="cfx-study-phases" id={`cfx-study-phases-${s.id}`}>
                        {stages.map(stage => <span key={stage.label} data-state={stage.state} aria-label={`${stage.label}: ${stage.state}`}>{stage.label}</span>)}
                      </span>
                    </button>}
                  <div className="cfx-study-actions">
                    {nextOperation && <button
                      aria-label={`${nextOperation === "mesh" ? "Mesh" : "Run"} ${s.name}`}
                      data-field-help={blocked ?? (nextOperation === "mesh"
                        ? "Generate and check the mesh for this study."
                        : "Run the solver and generate the configured post-processing results in one submission.")}
                      disabled={!!blocked} title={blocked} onClick={() => onSubmit(nextOperation, [s])}>
                      {nextOperation === "mesh" ? "Mesh" : "Run"}</button>}
                    {!nextOperation && showResults && <button aria-label={`Results for ${s.name}`} onClick={() => onOpenResults(s.id)}>Results</button>}
                    <button aria-label={`Delete ${s.name}`} className="cfx-danger" disabled={busy(s) || entry?.dispatched}
                      title={entry?.dispatched ? "Recover the previous submission before deleting this simulation" : undefined} onClick={e => onDelete(s.id, e.currentTarget)}>Delete</button>
                  </div>
                  <CFDRowMenu label={`Actions for ${s.name}`}>
                    {showResults &&
                      <button onClick={event => { event.currentTarget.closest("details")!.open = false; onOpenResults(s.id,job.id); }}>Load post-processing plane in 3D</button>
                    }
                    <button onClick={e => { e.currentTarget.closest("details")!.open = false; setRenaming(s.id); }}>Rename</button>
                    <button disabled={scenarios.length >= 100} onClick={() => { const copy = duplicateCFDScenario(s); onOrder([...scenarios, copy], groups, { [copy.id]: s.id }); onSelect(copy.id); }}>Duplicate simulation</button>
                    <button disabled={busy(s) || entry?.dispatched} onClick={() => onChange({ ...s, archived: !s.archived }, true)}>{s.archived ? "Unarchive" : "Archive"}</button>
                    <label>Move to group<select aria-label={`Move ${s.name} to group`} value={group.id} onChange={e => {
                      const target = groups.find(g => g.id === e.target.value)!;
                      e.currentTarget.closest("details")!.open = false;
                      onOrder(moveStudy(scenarios, s.id, target.name, scenarios.filter(v => sameGroup(v.group, target.name)).length), groups);
                    }}>{groups.map(g => <option key={g.id} value={g.id}>{g.name}</option>)}</select></label>
                  </CFDRowMenu>
                  {(job || entry?.submitting || entry?.dispatched) && <div className="cfx-study-status">
                    <CFDJobProgress job={job} name={s.name} operation={entry?.operation} pending={entry?.submitting || entry?.dispatched ? phase : undefined} />
                  </div>}
                </article>;
              }}
            </CFDReorderList>
            {!members.length && !collapsed.has(group.id) && <p className="cfx-empty-drop">{allMembers.length ? "Archived simulations" : "Empty group"}</p>}
          </section>;
        }}
      </CFDReorderList>
    </div>
    </details>
  </div>;
}
