"use client";

import type { CFDScenario } from "@/lib/climoptixDocument";
import type { RailwayCFDWorker } from "@/lib/railwayCFDWorker";
import { applyWorkerLimits, workerProfileIssues } from "@/lib/cfdWorkerProfile";

export function CFDWorkerConnection({ adapter, reason, onRefresh, scenario, onChange }: {
  adapter: RailwayCFDWorker | null; reason: string; onRefresh: () => void; scenario: CFDScenario; onChange: (scenario: CFDScenario) => void;
}) {
  const issues = adapter ? workerProfileIssues(scenario, adapter.capabilities.limits) : [];
  return <section className="cfx-worker-connection" aria-label="OpenFOAM connection">
    <div className="cfx-worker-controls"><p>{reason}</p><div className="cfx-inline-toolbar">
      <button onClick={onRefresh}>Refresh connection</button>
      {adapter && <button onClick={() => onChange(applyWorkerLimits(scenario, adapter.capabilities.limits))}>Use worker resource limits</button>}
    </div></div>
    {issues.length > 0 && <details className="cfx-worker-compatibility"><summary>Worker compatibility · {issues.length} {issues.length === 1 ? "item" : "items"} to review</summary>
      <ul>{issues.map(issue => <li key={issue}>{issue}</li>)}</ul>
      <p className="cfx-caption">Settings are saved as intent. The worker performs fresh, authoritative geometry and solver checks before accepting a job.</p>
    </details>}
  </section>;
}
