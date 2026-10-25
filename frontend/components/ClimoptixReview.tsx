"use client";

import { useEffect, useId, useState } from "react";
import { downloadCFD, preparationPackage, preparationSummary, type CFDReport } from "@/lib/climoptix";
import type { CFDScenario } from "@/lib/climoptixDocument";
import { WindowHelpButton } from "./WindowHelpButton";

const TABS = [["review", "Simulation review"], ["warnings", "Warnings & checks"], ["transfer", "Import / export"]] as const;

export function ClimoptixReview({ scenario, report, revision, stale, blocked, failure, onDismissFailure, onChange, onImport, onExport, onError, onRefresh, onInspect, issuesRequest = 0, submissionError }: {
  scenario: CFDScenario; report: CFDReport | null; revision: string; stale: boolean; blocked: boolean;
  onChange: (scenario: CFDScenario) => void; onImport: (file: File) => void; onExport: () => void;
  onError: (message: string) => void; onRefresh: () => void; onInspect: (id: string, group: string) => void;
  failure?: string; onDismissFailure?: () => void;
  issuesRequest?: number;
  submissionError?: string;
}) {
  const [tab, setTab] = useState<(typeof TABS)[number][0]>(issuesRequest ? "warnings" : "review");
  const [severity, setSeverity] = useState("all");
  const prefix = useId();
  useEffect(() => {
    if (!issuesRequest) return;
    document.getElementById(`${prefix}-warnings`)?.focus({ preventScroll: true });
  }, [issuesRequest, prefix]);
  const diagnostics = report?.diagnostics.filter(d => severity === "all" || d.severity === severity) ?? [];
  const save = (kind: "zip" | "summary") => {
    if (!report || stale || blocked) return;
    try {
      downloadCFD(kind === "zip" ? preparationPackage(scenario, report, revision) : new Blob([preparationSummary(scenario, report, revision)], { type: "text/plain;charset=utf-8" }),
        kind === "zip" ? `${scenario.name}.climoptix.zip` : `${scenario.name}-preflight.txt`);
    } catch (error) { onError(error instanceof Error ? error.message : "Export failed."); }
  };
  return <div className="cfx-review">
    <header className="cfx-inline-toolbar">
      <div className="cfx-segments" role="tablist" aria-label="Review and transfer">
        {TABS.map(([id, title], index) => <button key={id} role="tab" aria-label={title} id={`${prefix}-${id}`} aria-controls={`${prefix}-panel-${id}`}
          aria-selected={tab === id} tabIndex={tab === id ? 0 : -1} onClick={() => setTab(id)} onKeyDown={event => {
            if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
            event.preventDefault();
            const at = event.key === "Home" ? 0 : event.key === "End" ? TABS.length - 1 : (index + (event.key === "ArrowLeft" ? TABS.length - 1 : 1)) % TABS.length;
            setTab(TABS[at][0]); document.getElementById(`${prefix}-${TABS[at][0]}`)?.focus();
          }}>{id === "review" ? "Review" : id === "warnings" ? "Warnings" : title}{id === "warnings" && report ? ` (${report.diagnostics.filter(d => d.severity !== "info").length})` : ""}</button>)}
      </div>
      <WindowHelpButton title="Simulation review and transfer" steps={[
        { heading: "Checks and exports", text: "Checks refresh after committed edits. Use Refresh checks to retry. JSON transfers editable simulation settings; Import creates a separate simulation. Preparation ZIP and preflight exports are handoffs, not runnable OpenFOAM cases or computed results. Stale reports cannot be exported as current preparation." },
        ...((report?.limitations ?? []).map(text => ({ heading: "Provider limitation", text }))),
      ]} />
    </header>
    {failure && <div className="cfx-review-failure" role="alert"><p>{failure}</p>
      {failure.startsWith("Changes not applied") && <button onClick={onDismissFailure}>Keep saved values</button>}
      <small>Checks and preparation exports remain blocked until this is resolved. Use Refresh checks in Review or Warnings to retry.</small>
    </div>}
    <section role="tabpanel" id={`${prefix}-panel-review`} aria-labelledby={`${prefix}-review`} hidden={tab !== "review"}>
      <div className="cfx-inline-toolbar">
        <strong>{scenario.name}</strong>
        <span className="cfx-check-status">{blocked || failure ? "Checks blocked · resolve pending input" : stale ? "Checks out of date" : report
          ? report.validation.errors ? `Blocked · ${report.validation.errors} errors`
            : !report.surface.exportable ? "Boundary geometry unavailable"
            : `Geometry ready${report.validation.warnings ? ` · ${report.validation.warnings} warnings` : ""}`
          : "Not checked"}</span>
        <button onClick={onRefresh}>Refresh checks</button>
      </div>
      <label>Simulation notes<textarea rows={2} value={scenario.description} maxLength={2000} onChange={e => onChange({ ...scenario, description: e.target.value })} /></label>
      {report && !stale && <div className="cfx-review-outcome" role="status">
        {!scenario.seed ? <p>Choose a seed room in Domain to define the simulation&apos;s connected air volume.</p> :
          !report.surface.exportable && !report.validation.errors ? <p>No exportable boundary is available. Refresh checks and review the geometry diagnostics.</p> : null}
        {report.diagnostics.filter(d => d.severity === "error").map((d, i) => <p key={`${d.code}:${i}`}>
          {d.message} {d.repair} {d.objectId && <button onClick={() => onInspect(d.objectId!, d.group)}>Inspect</button>}
        </p>)}
        {report.surface.exportable && !report.validation.errors && <p>Preparation passed for {report.domain.includedRoomIds.length} connected rooms and {report.surface.triangleCount} boundary triangles. This is not a completed mesh or solver result.</p>}
      </div>}
      {report && <details><summary>Validation provenance</summary><dl className="cfx-review-metadata">
        <div><dt>Geometry SHA-256</dt><dd>{report.validation.sourceHash}</dd></div>
        <div><dt>Configuration SHA-256</dt><dd>{report.validation.configurationHash}</dd></div>
        <div><dt>Checked</dt><dd>{new Date(report.validation.checkedAt).toLocaleString()}</dd></div>
        <div><dt>Surface</dt><dd>{report.surface.exportable ? `${report.surface.triangleCount} boundary triangles · STL in metres` : report.surface.triangleCount ? `Unavailable · ${report.surface.badEdges} non-manifold/open edges` : "No boundary generated · select a valid seed room"}</dd></div>
      </dl></details>}
    </section>
    <section role="tabpanel" id={`${prefix}-panel-warnings`} aria-labelledby={`${prefix}-warnings`} hidden={tab !== "warnings"}>
      {submissionError && <p className="cfx-error" role="alert">Worker submission or status: {submissionError}</p>}
      <div className="cfx-inline-toolbar"><strong>Preflight diagnostics</strong>
        <select aria-label="CFD diagnostic severity" value={severity} onChange={e => setSeverity(e.target.value)}>
          <option value="all">All severities</option><option value="error">Blocking errors</option><option value="warning">Warnings</option><option value="info">Information</option>
        </select><button onClick={onRefresh}>Refresh checks</button>
      </div>
      {stale && <p className="cfx-stale">Checks out of date</p>}
      {diagnostics.map((d, index) => <article className={`cfx-diagnostic ${d.severity}`} key={`${d.code}:${d.objectId}:${index}`}>
        <strong>{d.severity.toUpperCase()} · {d.group}</strong><p>{d.message}</p><small>{d.repair}</small>
        {d.objectId && <button onClick={() => onInspect(d.objectId!, d.group)}>Inspect {d.objectId}</button>}
      </article>)}
      {!report ? <p>No validation report yet.</p> : !diagnostics.length ? <p>No diagnostics for this filter.</p> : null}
    </section>
    <section role="tabpanel" id={`${prefix}-panel-transfer`} aria-labelledby={`${prefix}-transfer`} hidden={tab !== "transfer"}>
      <div className="cfx-grid cfx-transfer-actions">
        <button onClick={onExport}>Export simulation JSON</button>
        <label className="cfx-file">Import simulation<input aria-label="Import CFD scenario" type="file" accept=".json,application/json"
          onChange={e => { const file = e.target.files?.[0]; e.target.value = ""; if (file) onImport(file); }} /></label>
        <button className="cfx-primary" disabled={!report || stale || blocked} onClick={() => save("zip")}>Export preparation ZIP</button>
        <button disabled={!report || stale || blocked} onClick={() => save("summary")}>Download settings &amp; preflight</button>
      </div>
    </section>
  </div>;
}
