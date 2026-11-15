"use client";

import type { CFDScenario } from "@/lib/climoptixDocument";
import type { RailwayCFDWorker } from "@/lib/railwayCFDWorker";
import { applyWorkerLimits, workerProfileIssues } from "@/lib/cfdWorkerProfile";

export function CFDWorkerConnection({ adapter, reason, onRefresh, scenario, onChange }: {
  adapter: RailwayCFDWorker | null; reason: string; onRefresh: () => void; scenario: CFDScenario; onChange: (scenario: CFDScenario) => void;
}) {
  const limits = adapter?.capabilities.limits;
  const quota = adapter?.capabilities.simulationQuota;
  const issues = limits ? workerProfileIssues(scenario, limits, adapter?.capabilities.rotatedGrid) : [];
  return <section className="cfx-worker-connection" aria-label="OpenFOAM connection">
    <div className="cfx-worker-controls"><p>{reason}</p><div className="cfx-worker-actions">
      <button onClick={onRefresh}>Refresh connection</button>
      {adapter && <button onClick={() => onChange(applyWorkerLimits(scenario, adapter.capabilities.limits))}>Use worker resource limits</button>}
    </div></div>
    {quota && limits && <p className="cfx-notice" role="status" aria-label="Free simulation allowance">
      Free tier · {quota.completed} of {quota.limit} completed simulations used · {quota.remaining} remaining (lifetime).
      {" "}Up to {limits.maxCells.toLocaleString()} cells, {limits.cpu} {limits.cpu === 1 ? "core" : "cores"}, and {limits.memoryGb} GB RAM.
      Failed/cancelled runs and mesh-only jobs do not use this allowance.
    </p>}
    {issues.length > 0 && <details className="cfx-worker-compatibility"><summary>Worker compatibility · {issues.length} {issues.length === 1 ? "item" : "items"} to review</summary>
      <ul>{issues.map(issue => <li key={issue}>{issue}</li>)}</ul>
      <p className="cfx-caption">Settings are saved as intent. The worker performs fresh, authoritative geometry and solver checks before accepting a job.</p>
    </details>}
  </section>;
}
