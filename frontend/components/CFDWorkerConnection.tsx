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
    {adapter?.capabilities.simulationQuota && <p className="cfx-notice" role="status" aria-label="Free simulation allowance">
      Free tier · {adapter.capabilities.simulationQuota.completed} of 5 completed simulations used · {adapter.capabilities.simulationQuota.remaining} remaining (lifetime).
      {" "}Up to 500,000 cells, 2 processors and 4 GB RAM. Failed/cancelled runs and mesh-only jobs do not use this allowance.
    </p>}
    {issues.length > 0 && <details className="cfx-worker-compatibility"><summary>Worker compatibility · {issues.length} {issues.length === 1 ? "item" : "items"} to review</summary>
      <ul>{issues.map(issue => <li key={issue}>{issue}</li>)}</ul>
      <p className="cfx-caption">Settings are saved as intent. The worker performs fresh, authoritative geometry and solver checks before accepting a job.</p>
    </details>}
  </section>;
}
