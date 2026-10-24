# Climoptix → OpenFOAM worker handoff

Status: 23 October 2026. The preparation workflow and typed integration boundary
are implemented. **A real OpenFOAM worker is not implemented or connected.**
Foamlib dictionary round-trips are not OpenFOAM execution/semantic validation.
No meshing or solver executable was found on this development machine's PATH.

## Integration point

Implement `CFDWorkerAdapter` in `frontend/lib/climoptixJobs.ts` and supply the
adapter to `ClimoptixWorkspace.workerAdapter` at the composition root. Keep the
adapter instance stable across ordinary renders; replace it when connection or
capabilities change while retaining the same authenticated job namespace for
recovery.
Derive capabilities from the authenticated service, not browser preferences.
Existing public proxy rules deliberately deny job/execution endpoints; no worker
URL or permissive proxy route has been introduced by this UI change.

### Residual monitor readiness (24 October 2026)

The Monitor window and log parser/graph work with bounded, session-only imported
OpenFOAM logs. **Live residual streaming is not implemented.** The current
`status()` contract reports phase/progress only, not residual samples. Connecting
a worker to that interface alone will not make the chart update live. A future
authenticated telemetry adapter must bind samples to job ID, study ID and pinned
setup revision, provide ordered/cursor-based recovery, enforce bounded buffers,
and reject stale/cross-study samples. Verify reconnect, completion, cancellation
and worker failure against a real solver before describing it as a live monitor.

Supply and Extract can now be configured before host geometry is available.
Such drafts use the explicit `unassigned` host reference. Authoritative preparation
reports an error and refuses export/submission until a real validated host is
assigned; workers must not invent a face or silently drop the draft vent.

### Simulation-only objects (24 October 2026)

`scenario.objectGroups` stores only list organization and is excluded from the
physical input/configuration fingerprints. `objectCopies` creates independently
identified CFD instances referencing original measured objects; each instance's
`assetOverrides` supplies its own millimetre offset and source/treatment settings.
`hiddenObjectIds` excludes source objects only in this simulation. Neither action
mutates the Floorplan source document. Missing sources, duplicate identifiers,
overlaps and out-of-domain geometry must remain preflight blockers. Workers must
honour this contract when re-preparing; do not silently omit these fields or build
copies from Three.js meshes. Copy locations are not guaranteed valid merely
because a copy was created. Boundary-group duplication copies condition templates,
never physical faces.

`submit(request, signal)` receives a bounded, independently copied snapshot:

- `contractVersion: 1`, `dialect: "OpenCFD-v2312"`, `sourceUnits: "mm"`;
- `submissionId`, operation (`mesh` or `run`), study ID and client revision;
- geometry source/configuration hashes from fresh authoritative preparation;
- the measured preparation project and complete study settings, including mesh,
  physics, boundary conditions, resource limits, refinement regions and slices.

Snapshots use the bounded preparation source; unrelated studies, quotations and
historical thermal packages are not copied or sent. Current thermal setup and
construction inputs remain included and keep the same physical revision.
`thermalApplication` is null until Apply, otherwise it carries the last applied
case hash, source revision and timestamp, not its historical preview. A worker
must recompute the current thermal contract and match those hashes before using
it; reject stale or unsupported application rather than executing stored output.
Merely configuring or previewing Thermal must not apply its conditions to a run.

Mesh/Run controls submit the study on their own row, independently of the active
selection. Reserve submissions synchronously before asynchronous preparation
(including every study if a caller uses the hook's multi-study API). Preflight failures
are per-study; changed, archived or deleted studies are rejected before dispatch.
Non-exportable geometry is rejected even if a malformed report claims no errors.
The worker must independently parse both schemas, re-prepare the pinned input and
compare hashes. A frontend preflight or enabled capability is not authorization
to execute an unvalidated case.

Persistently deduplicate `(authenticated owner, submissionId)` before creating a
job. Repeated requests with the same ID and immutable payload must return the
same job; reject reuse with a different payload. The UI retains an ID after an
ambiguous response/connection failure, so retry can recover an accepted request
without creating another job. An unresolved submission is labelled unknown, not
Not submitted, and cannot be archived/deleted. Retry resends the original payload
even after settings edits; resolve that request before changing operation. Once
resolved/terminal, a new run gets a fresh ID and uses the current settings. This
browser-session mechanism does not replace durable server queue/reconnection
recovery.

`status(jobId, signal)` returns the `workerJobSchema` shape: job ID, study ID,
client revision, phase, `progress` (0–100 for that phase, or `null` if unknown),
and an optional bounded message. Supported phases are Queued, Meshing, MeshCheck,
Running, Postprocess, Completed, Failed, Cancelled and Stale. Mismatched responses
are rejected. A single non-overlapping polling loop retains IDs through transient
errors and stops for terminal jobs. Progress never comes from elapsed time.
Changing setup labels an existing job as older setup; it must not silently become
the result of the new revision. Honor AbortSignal and enforce network deadlines.
Aborting a request is **not** proof that an accepted remote job was cancelled.

## Required worker pipeline — not yet implemented

1. Authenticate and isolate each case. Enforce server-side CPU, memory, wall-time,
   storage, concurrency and retention limits. Accept no shell commands, user
   executable templates, includes, dynamic code or arbitrary filesystem paths.
2. Pin/revalidate canonical geometry, room connectivity, obstacle proxies, patch
   mapping and thermal/source provenance. Rendering fallbacks never supply CFD
   validity. Use only the server-owned case directory and generated safe names.
3. Convert measured millimetres to metres exactly once at the OpenFOAM export
   boundary. Do not copy the Three.js display-axis transform into physical data.
   Physics uses the declared schema units: kelvin, pascals and CO₂ ppm by volume;
   adapters must convert pressure dimensions and scalar/source conventions for
   the selected solver explicitly.
4. Construct a complete case using restricted, reviewed Foamlib dictionaries and
   a pinned OpenCFD v2312 runtime. Existing settings ZIPs are **not runnable**:
   background mesh, `locationInMesh`, surface patch/refinement mapping, complete
   snapping/layer controls, initial fields, transport/source models, `fvSchemes`
   and `fvSolution` still require translation. Boundary STL comes from canonical
   preparation, not a screenshot or detailed display asset.
5. Run real background meshing, snappyHexMesh and checkMesh in isolation. Enforce
   quality/cell limits before allowing the solver. Record actual phase outcomes,
   measured counts and diagnostics; estimates and requested quality are not
   measured results. A Mesh operation stops after the checked mesh.
6. Run only explicitly supported model combinations. Start with one steady
   isothermal case; reject unsupported energy/CO₂/thermal/comfort requests, rather
   than falling back to a simpler solver. Thermal face splits, Robin film removal
   and lumped solar/gain sources need their own reviewed adapters.
7. Resolve named X/Y/Z cutting planes against the pinned domain before running;
   export coordinates in metres and record sampled fields/write cadence. Produce
   bounded ASCII VTK surfaces/slices for the current viewer and preserve original
   full-volume/multi-time artifacts for external tools.
8. Return provenance-bound artifacts and real logs. Add authenticated log/artifact
   access, durable job recovery and real cancellation before exposing those job
   actions. Monitor currently imports external session-only logs; Results imports
   external VTK. Neither import certifies that the selected study has run.

## Acceptance gate before enabling production Mesh/Run

Custom boundary collections are resolved by authoritative preparation before
export or worker submission. A worker must use the resolved patch conditions,
not reinterpret folder colours or display ordering as physical membership.
Explicit patch overrides take priority over named groups, the default group and
legacy surface-type presets. Device boundaries remain device-controlled; object
thermal conflicts block export. Simulation folders are organizational metadata
and are stripped from the source snapshot. All other existing revision, resource
and artifact-provenance checks still apply.

Run a pinned real worker case through preparation → mesh → quality check → solve
→ convergence/conservation checks → plane export → result inspection. Cover serial
and parallel resource limits, idempotent retries, cross-user access rejection,
malformed/stale inputs, unsupported physics, mesh/solver failures, cancellation,
worker restart, reconnect/reload, artifact provenance and retention. Verify
pressure/scalar dimensions and sampling cadence against the chosen runtime.
Only then advertise the matching capabilities. A passing mock adapter test is
evidence for the UI integration boundary, not for CFD solver correctness.

## Verification sources

- [OpenCFD controlDict documentation](https://doc.openfoam.com/2312/fundamentals/case-structure/controldict/)
  describes runtime dictionaries; it does not make a partial settings ZIP a case.
- [OpenCFD cuttingPlane documentation](https://doc.openfoam.com/2306/tools/post-processing/function-objects/sampling/surfaces/cuttingPlane/)
  documents the point/normal sampling representation; runtime acceptance remains
  part of the pinned-worker tests above.
- [Foamlib case manipulation](https://foamlib.readthedocs.io/en/stable/cases.html)
  distinguishes case-file access from actual OpenFOAM execution. This repository
  pins Foamlib 1.7.3 as a lazy, optional GPL-3.0-only dependency; review distribution
  licensing before shipping a worker.
