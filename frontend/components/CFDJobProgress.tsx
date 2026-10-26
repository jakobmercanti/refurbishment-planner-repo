import type { CFDOperation, CFDWorkerJob } from "@/lib/climoptixJobs";

/** Never invent a time-based percentage when the worker has not reported one. */
export function CFDJobProgress({ job, name, operation, pending }: { job?: CFDWorkerJob; name: string; operation?: CFDOperation; pending?: string }) {
  const idle = !job && !pending;
  const phase = job ? ({ Meshing: "Mesh", MeshCheck: "Mesh check", Running: "Running", Postprocess: "Post-processing",
    Completed: operation === "mesh" || job.operation === "mesh" ? "Mesh completed" : "Completed" } as Record<string, string>)[job.phase] ?? job.phase : pending ?? "Not submitted";
  const value = idle ? 0 : job?.progress;
  const text = `${phase} · ${value == null ? "progress not reported" : `${Math.floor(value*10)/10}%`}${job?.progressBasis === "iterationBudget" ? " of iteration budget" : job?.progressBasis === "steps" ? " of phase steps" : ""}${job?.message ? ` · ${job.message}` : ""}`;
  return <div className={`cfx-job-progress${idle ? " idle" : value == null ? " indeterminate" : ""}`} role="progressbar" aria-label={`${name} phase progress`}
    aria-valuemin={0} aria-valuemax={100} aria-valuenow={value ?? undefined} aria-valuetext={text}>
    <span className="cfx-progress-fill" style={{ width: value == null ? "35%" : `${value}%` }} />
    <strong className="cfx-progress-label">{text}</strong>
  </div>;
}
