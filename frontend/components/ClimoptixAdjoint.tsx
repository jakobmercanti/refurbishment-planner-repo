"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { adjointStudySchema, type AdjointStudy } from "@/lib/cfdAdjointDocument";
import { adjointConfigurationCSV, newAdjointStudy, validateAdjoint, type AdjointReadiness } from "@/lib/cfdAdjoint";
import { downloadCFD, type CFDReport } from "@/lib/climoptix";
import type { CFDScenario } from "@/lib/climoptixDocument";
import type { ProjectDocument } from "@/lib/projectDocument";
import { CFDNumber, CFDText } from "./CFDFields";
import { CFDConfirmAction } from "./CFDConfirmAction";
import { WindowHelpButton } from "./WindowHelpButton";

export function ClimoptixAdjoint({ project, scenario, report, revision, checked, apiUrl, active, selected, baselineRunId, workerConnected, onSelect, onChange, onNavigate }: {
  project: ProjectDocument; scenario: CFDScenario; report: CFDReport | null; revision: string; checked: boolean; apiUrl: string; active: boolean;
  selected: string | null; baselineRunId: string | null; workerConnected: boolean; onSelect: (id: string) => void;
  onChange: (scenario: CFDScenario, checkpoint?: boolean) => void; onNavigate: (id: "equipment" | "boundaries" | "mesh" | "results") => void;
}) {
  const [chosen, setChosen] = useState("");
  const studies = scenario.adjointStudies ?? [];
  const saved = studies.find(study => study.id === chosen) ?? studies[0];
  const canCapture = checked && !!report?.surface.exportable && report.validation.errors === 0 && scenario.vents.length <= 100;
  const draft = useMemo(() => {
    if (canCapture && report) return newAdjointStudy(scenario, report, baselineRunId);
    // Display the complete editor while preparation is pending. This placeholder
    // is disabled and never persisted or submitted as a checked baseline.
    const emptyHash = "0".repeat(64);
    return adjointStudySchema.parse({ id: "pending-optimisation", name: "Vent position study",
      baseline: { sourceHash: emptyHash, configurationHash: emptyHash, clientRevision: emptyHash, runId: null },
      ports: scenario.vents.slice(0, 100).map(vent => ({ ventId: vent.id, movable: false,
        bounds: { uMinMm: 0, uMaxMm: 0, vMinMm: 0, vMaxMm: 0 } })),
    });
  }, [canCapture, report, scenario, baselineRunId]);
  const study = saved ?? draft;
  const editable = !!saved || canCapture;
  const stale = !!saved && (!checked || saved.baseline.clientRevision !== revision);
  const [result, setResult] = useState<{ key: string; value: AdjointReadiness } | null>(null);
  const [error, setError] = useState<{ key: string; message: string } | null>(null);
  const [pending, setPending] = useState<{ key: string; signal: AbortSignal } | null>(null);
  const controller = useRef<AbortController | null>(null), serial = useRef(0);
  const key = JSON.stringify([revision, study]);
  useEffect(() => () => { controller.current?.abort(); serial.current++; }, [key, active]);
  const readiness = result?.key === key ? result.value : null;
  const busy = pending?.key === key && !pending.signal.aborted && active;

  const save = (candidate: AdjointStudy) => {
    if (!editable) return false;
    const parsed = adjointStudySchema.safeParse(candidate);
    if (!parsed.success) {
      setError({ key, message: parsed.error.issues[0]?.message ?? "Review the configuration." });
      return false;
    }
    if (!saved && studies.length >= 20) return false;
    onChange({ ...scenario, adjointStudies: saved
      ? studies.map(item => item.id === candidate.id ? parsed.data : item)
      : [...studies, parsed.data] }, true);
    setChosen(parsed.data.id);
    setError(null);
    return true;
  };
  const add = () => {
    if (!canCapture || !report || studies.length >= 20) return;
    const next = newAdjointStudy(scenario, report, baselineRunId);
    onChange({ ...scenario, adjointStudies: [...studies, next] }, true);
    setChosen(next.id); setError(null);
  };
  const validate = async () => {
    if (!canCapture || stale || !save(study)) return;
    controller.current?.abort();
    const abort = new AbortController(); controller.current = abort;
    const number = ++serial.current, captured = key;
    setPending({ key: captured, signal: abort.signal }); setResult(null);
    try {
      const value = await validateAdjoint(apiUrl, project, scenario, revision, study, abort.signal, report?.validation);
      if (!abort.signal.aborted && number === serial.current) setResult({ key: captured, value });
    } catch (cause) {
      if (!abort.signal.aborted && number === serial.current)
        setError({ key: captured, message: cause instanceof Error ? cause.message : "Layout checks failed." });
    } finally { if (number === serial.current) setPending(null); }
  };
  const patchPort = (id: string, patch: Partial<AdjointStudy["ports"][number]>) =>
    save({ ...study, ports: study.ports.map(port => port.ventId === id ? { ...port, ...patch } : port) });

  return <section className="cfx-adjoint" data-cfx-collapse-root aria-label="Optimisation setup">
    {error?.key === key && <p role="alert" className="cfx-error cfx-adjoint-feedback">{error.message}</p>}
    <details open><summary>Configuration<WindowHelpButton section title="Optimisation — Configuration" steps={[
      { heading: "Save a configuration", text: "Start with the current checked CFD setup. Changes save automatically with this simulation. New configuration captures another baseline. Duplicate copies the selected configuration. Delete removes that configuration. Baseline geometry and solver results stay with the simulation." },
      { heading: "Changing the baseline", text: "After changing vents, physics or geometry, create a new configuration from the current setup. Saved configurations keep their original baseline for inspection and export." },
    ]} /></summary>
      {!canCapture && !saved && <p className="cfx-caption" role="status">Complete the geometry checks to configure vent movement.</p>}
      {scenario.vents.length > 100 && <p className="cfx-error" role="alert">Select a simulation with at most 100 vents.</p>}
      {stale && <p className="cfx-notice" role="status">The baseline changed. Create a new configuration to use the current setup.</p>}
      <fieldset className="cfx-adjoint-fields" disabled={!editable}><div className="cfx-adjoint-grid">
        <label>Configuration<select aria-label="Saved optimisation configuration" value={saved?.id ?? ""} onChange={event => { setChosen(event.target.value); setError(null); }}>
          {!saved && <option value="">Current CFD setup</option>}
          {studies.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
        </select></label>
        <CFDText label="Configuration name" value={study.name} onChange={name => save({ ...study, name })} />
      </div></fieldset>
      <div className="cfx-adjoint-actions">
        <button disabled={!canCapture || studies.length >= 20} onClick={saved ? add : () => save(study)}>{saved ? "New configuration" : "Save configuration"}</button>
        <button disabled={!saved || studies.length >= 20} onClick={() => {
          const next = { ...structuredClone(study), id: crypto.randomUUID(), name: study.name.slice(0, 110) + " copy" };
          onChange({ ...scenario, adjointStudies: [...studies, next] }, true); setChosen(next.id); setError(null);
        }}>Duplicate</button>
        <CFDConfirmAction label="Delete" title="Delete optimisation configuration?" description={"Delete " + study.name + " from this simulation."} disabled={!saved} onConfirm={() => {
          onChange({ ...scenario, adjointStudies: studies.filter(item => item.id !== study.id) }, true); setChosen(""); setError(null);
        }} />
        <button onClick={() => onNavigate("results")}>Baseline results</button>
      </div>
    </details>

    <details open><summary>Vents &amp; movement<WindowHelpButton section title="Optimisation — Vents & movement" steps={[
      { heading: "Allowed movement", text: "Movement coordinates are local U and V distances in millimetres on the existing wall or ceiling support. Size, orientation and support stay fixed. Select Move vent and set bounds around its centre. Lock U or V to restrict movement to the other direction. Layout checks include the complete swept footprint, clearances, openings and adjacent vents." },
      { heading: "Inspect a vent", text: "Select in 3D highlights the vent in the current building. Open Boundary groups to edit its surrounding conditions. Changes to the original vents require a new baseline configuration." },
    ]} /></summary>
      {!study.ports.length && <p className="cfx-caption">Add a supply or extract vent in Bounds → Objects.</p>}
      <fieldset className="cfx-adjoint-fields" disabled={!editable}>
        {study.ports.map(port => {
          const vent = scenario.vents.find(item => item.id === port.ventId);
          const fixed = study.baseline.ports.find(item => item.ventId === port.ventId);
          return <details className="cfx-adjoint-port" key={port.ventId} id={"cfx-adjoint-port-" + port.ventId} open>
            <summary>{vent?.name ?? fixed?.name ?? "Removed vent"}<span className="cfx-caption">{port.movable ? "Movable" : "Fixed"}</span></summary>
            {!vent && <p className="cfx-error">This vent was removed. Create a configuration from the current setup.</p>}
            <div className="cfx-adjoint-checks">
              {([["movable", "Move vent"], ["lockU", "Lock U"], ["lockV", "Lock V"]] as const).map(([field, label]) =>
                <label className="cfx-check" key={field}><input type="checkbox" disabled={!vent || field !== "movable" && !port.movable} checked={port[field]}
                  onChange={event => patchPort(port.ventId, { [field]: event.target.checked })} />{label}</label>)}
            </div>
            <fieldset disabled={!port.movable || !vent} className="cfx-adjoint-fields"><div className="cfx-adjoint-grid">
              {(["uMinMm", "uMaxMm", "vMinMm", "vMaxMm"] as const).map(field => <CFDNumber convert={false} key={field}
                label={field[0].toUpperCase() + (field.includes("Min") ? " minimum" : " maximum") + " (mm)"} value={port.bounds[field]} min={0}
                onChange={value => patchPort(port.ventId, { bounds: { ...port.bounds, [field]: value } })} />)}
              <CFDNumber convert={false} label="Clearance (mm)" value={port.clearanceMm} min={0} onChange={clearanceMm => patchPort(port.ventId, { clearanceMm })} />
              <CFDNumber convert={false} label="Maximum movement per step (mm)" value={port.maxDisplacementMm} min={0.01} max={10000} onChange={maxDisplacementMm => patchPort(port.ventId, { maxDisplacementMm })} />
            </div></fieldset>
            <button disabled={!vent} aria-pressed={selected === "vent:" + port.ventId} onClick={() => onSelect("vent:" + port.ventId)}>Select in 3D</button>
          </details>;
        })}
      </fieldset>
      <div className="cfx-adjoint-actions"><button onClick={() => onNavigate("equipment")}>Open objects</button><button onClick={() => onNavigate("boundaries")}>Boundary groups</button></div>
    </details>

    <details open><summary>Objective<WindowHelpButton section title="Optimisation — Objective" steps={[
      { heading: "Velocity uniformity", text: "Minimise the volume-weighted mean of (|U| − mean |U|)² / Uref² over the selected fluid volume. This dimensionless objective measures velocity variation. Fresh-air delivery and comfort need their own checks." },
      { heading: "Velocity threshold", text: "Minimise the volume-weighted mean of max(|U| − Utarget, 0)² / Uref². Reference velocity normalises the objective. The current preparation service validates these definitions. A connected adjoint runner is required to evaluate them." },
    ]} /></summary>
      <fieldset className="cfx-adjoint-fields" disabled={!editable}><div className="cfx-adjoint-grid">
        <label>Objective<select aria-label="Optimisation objective" value={study.objective.kind} onChange={event => save({ ...study, objective: { ...study.objective, kind: event.target.value as AdjointStudy["objective"]["kind"] } })}>
          <option value="velocityUniformity">Velocity uniformity</option><option value="draught">Limit high velocities</option>
        </select></label>
        <CFDNumber convert={false} label="Reference velocity (m/s)" value={study.objective.referenceVelocityMS} min={0.001} max={100} onChange={referenceVelocityMS => save({ ...study, objective: { ...study.objective, referenceVelocityMS } })} />
        {study.objective.kind === "draught" && <CFDNumber convert={false} label="Velocity threshold (m/s)" value={study.objective.targetVelocityMS} min={0} max={100} onChange={targetVelocityMS => save({ ...study, objective: { ...study.objective, targetVelocityMS } })} />}
      </div></fieldset>
    </details>

    <details open><summary>Movement &amp; budgets<WindowHelpButton section title="Optimisation — Movement & budgets" steps={[
      { heading: "Steps and budgets", text: "One accepted step is one vent-layout change. Translation sizes are in millimetres. Minimum ≤ initial ≤ maximum step. The solve budget must cover the baseline and every accepted movement, plus any rejected trials. The time budget is in seconds." },
      { heading: "Adjoint method", text: "The movement gradient uses the perimeter integral of the full reduced adjoint density multiplied by the outward in-plane edge normal. Descent follows the negative gradient. Inlet flux normalisation and outlet derivatives must be included. A future runner must verify mesh resolution and mask leakage, enforce every budget and recompute the adjoint after each accepted design." },
    ]} /></summary>
      <fieldset className="cfx-adjoint-fields" disabled={!editable}><div className="cfx-adjoint-grid">
        {([
          ["maxAcceptedSteps", "Accepted movement steps", 1, 50], ["initialStepMm", "Initial step (mm)", 0.01, 1000],
          ["minimumStepMm", "Minimum step (mm)", 0.01, 1000], ["maximumStepMm", "Maximum step (mm)", 0.01, 1000],
          ["maskTransitionMm", "Mask transition (mm)", 0.01, 1000], ["maxRejectedTrials", "Rejected trials", 0, 15],
          ["maxPrimalSolves", "Maximum solver runs", 1, 200], ["budgetSeconds", "Time budget (s)", 60, 3600],
        ] as const).map(([field, label, min, max]) => <CFDNumber convert={false} key={field} label={label} value={study.strategy[field]} min={min} max={max}
          onChange={value => save({ ...study, strategy: { ...study.strategy, [field]: value } })} />)}
      </div></fieldset>
      <button onClick={() => onNavigate("mesh")}>Mesh settings</button>
    </details>

    <details open><summary>Checks &amp; export<WindowHelpButton section title="Optimisation — Checks & export" steps={[
      { heading: "Validate the layout", text: "Validate setup checks the current configuration against its captured geometry and physical settings. Repair reported issues before exporting. JSON includes the baseline, movement settings and current readiness. CSV lists the configured vent limits. A saved configuration can be exported for a compatible solver." },
      { heading: "Execution", text: "Automated vent movement requires a validated adjoint worker. The current CFD worker supports ordinary solver runs. It cannot execute this optimisation. Exported files contain configuration settings and layout checks." },
    ]} /></summary>
      <p className="cfx-caption" role="status">{workerConnected ? "CFD worker connected" : "CFD worker disconnected"} · {study.baseline.runId ? "Baseline run saved" : "Baseline run pending"}</p>
      <div className="cfx-adjoint-actions">
        <button disabled={!canCapture || stale || busy} onClick={() => void validate()}>{busy ? "Checking layout…" : "Validate setup"}</button>
        <button disabled aria-describedby="cfx-adjoint-run-reason">Run optimisation</button>
        <button disabled={!saved} onClick={() => downloadCFD(new Blob([JSON.stringify({ kind: "AdjointPreparation", version: 1, units: "mm", study, readiness, execution: "unavailable", iterations: [] }, null, 2)], { type: "application/json" }), "adjoint-" + study.id + ".json")}>Export JSON</button>
        <button disabled={!saved} onClick={() => downloadCFD(new Blob([adjointConfigurationCSV(study)], { type: "text/csv" }), "adjoint-" + study.id + ".csv")}>Export CSV</button>
      </div>
      <p id="cfx-adjoint-run-reason" className="cfx-caption">Automated optimisation is currently unavailable.</p>
      {readiness && <div role="status"><strong>{readiness.configurationReady ? "Layout checks passed" : "Review the layout"}</strong>
        {readiness.issues.map((issue, index) => <article className="cfx-diagnostic cfx-adjoint-issue" key={issue.code + ":" + issue.ventId + ":" + index}>
          <div><p>{issue.message}</p><small>{issue.repair}</small></div>
          {issue.ventId && <button onClick={() => {
            onSelect("vent:" + issue.ventId);
            const target = document.getElementById("cfx-adjoint-port-" + issue.ventId);
            if (target instanceof HTMLDetailsElement) target.open = true;
            target?.scrollIntoView({ block: "nearest" });
          }}>Select vent</button>}
        </article>)}
      </div>}
    </details>
  </section>;
}
