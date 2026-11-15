"use client";

import type { CFDReport } from "@/lib/climoptix";

export function CFDWorkbenchStatus({ checking, stale, report, failure, runIssue, onIssues, onDismissFailure, showFailure = true }: {
  checking: boolean; stale: boolean; report: CFDReport | null; failure: string; onIssues: () => void;
  showFailure?: boolean;
  runIssue?: string;
  onDismissFailure?: () => void;
}) {
  const errors = report?.validation.errors ?? 0, warnings = report?.validation.warnings ?? 0;
  const label = failure ? "Changes need attention" : checking ? "Checking current setup…" : stale ? "Checks out of date" : errors
    ? `${errors} blocking ${errors === 1 ? "issue" : "issues"}` : report?.surface.exportable ? "Geometry ready" : "Domain not ready";
  return <section className={`cfx-workbench-status${failure || runIssue || !stale && errors ? " has-issues" : ""}`} aria-label="Simulation readiness">
    <div><strong role="status">{label}</strong>{failure && showFailure ? <div className="cfx-input-failure" role="alert"><p>{failure}</p>
      {failure.startsWith("Changes not applied") && onDismissFailure && <button onClick={onDismissFailure}>Keep saved values</button>}</div>
      : !stale && warnings > 0 ? <small>{warnings} {warnings === 1 ? "warning" : "warnings"} · review before running</small> : null}
    {runIssue && <small className="cfx-run-issue">{runIssue}</small>}</div>
    <button onClick={onIssues}>Review issues</button>
  </section>;
}
