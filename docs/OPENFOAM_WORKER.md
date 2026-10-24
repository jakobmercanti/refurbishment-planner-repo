# Climoptix OpenFOAM worker

## Deployment and access

The dedicated Railway service `climoptix-openfoam` is separate from the existing
preparation/commercial API. Its URL is
`https://climoptix-openfoam-production.up.railway.app`.
The planner forwards narrowly allowlisted `/climoptix/worker/*` routes through
its same-origin engineering proxy using `CFD_WORKER_ORIGIN`. Every worker route
except the minimal health endpoint requires a Supabase bearer token. The worker
verifies the token with Supabase and restricts execution to its server-configured,
verified `CFD_ALLOWED_EMAIL`. Account tokens never enter URLs or localStorage.
No service-role key, billing secret or browser-supplied executable is required.

Railway project: `45ec36d9-5b66-437c-a1b3-d85bdfb5a97f`.
Production: `e1e7e064-a93e-4c5d-8f96-fa21dcc00e2b`.
Worker service: `535fa69d-bd31-4595-bec3-b2a00c1f66b1`.
Persistent volume: `1b6af3cf-5607-47e7-8b75-294febbbfff2`, mounted at `/data`.

## Supported initial profile

- OpenCFD v2312 `simpleFoam`, steady isothermal SIMPLE.
- Serial laminar, kEpsilon and kOmegaSST adapters.
- Canonical room surfaces, full-open normal-flow devices and solid proxies.
- Generated background/snappy mesh, checked topology and measured quality limits.
- Canonical box/sphere/object, jet-neighbourhood and obstacle-wake refinements.
- Actual residual logs, boundary flux balance, probes, ASCII legacy VTK slices and
  an original native-case ZIP with source/configuration provenance and hashes.

MPI startup failed under this container's constraints. Parallel requests are
explicitly rejected; the worker never silently substitutes serial execution.
Thermal/CO2/comfort/age-of-air, transient solvers, porous sources, angled jets,
partial-open/discharge models, boundary layers, rotated background grids and
slab-void cases remain disabled. Unsupported requests return actionable errors.
This worker does not change deterministic fit/uncertainty decisions.

Source geometry remains in millimetres. The compiler converts once to solver
metres, without the renderer's coordinate transform. Native incompressible `p`
is kinematic pressure (m²/s²), not Pa; multiply by the recorded density when
converting to dynamic pressure. Absolute reference pressure is not added.
The convection selector controls momentum; turbulence equations use upwind.
Equation under-relaxation uses the requested factor; pressure uses the adapter's
fixed 0.3 factor. Snap search is normalized by the requested minimum cell size;
it is not a certified maximum physical displacement of the meshed surface.
The generated dictionaries in the native archive record these choices explicitly.

## Resource and persistence policy

The Railway replica is hard-capped at **2 vCPU and 4 GB RAM**. The initial
execution profile uses **one serial job**, with at most 4 GB requested memory,
15 minutes wall time, 500,000 checked cells and 1 GB case storage. Child memory,
CPU time, file size and descriptor/process counts are bounded. The queue is
single-runner/volume locked, with one active job per account, four queue slots,
20 submissions per account per day and a 3 GB admission threshold. Results
expire after the requested retention, at most three days. The volume can incur
storage charges even when there are no jobs.
After expiry, a small owner/submission digest tombstone remains, without source
payload or artifacts, so late retries cannot create another paid execution.

Use **Solver → Run → Use worker resource limits** to explicitly adapt the
study's resources and cell budget. This does not change physics. Defaults in
older studies exceed the worker policy and are not silently clamped on submit.

SQLite persists immutable requests and unique `(owner, submissionId)` keys.
Identical retries return the accepted job; conflicting reuse is rejected.
Job lists recover after reload under the authenticated namespace. Interrupted
active jobs fail explicitly after restart; queued jobs survive. Cancellation
terminates the native process group and is distinct from aborting a browser
request. Logs use bounded byte cursors and are pinned to job/study/revision.
Downloads are owner checked and hash verified; old setup results are labelled.

## Runtime acceptance and validation

Every service startup runs a trusted measured-room/device fixture through the
same preparation/compiler/execution path for all three advertised serial models:
blockMesh → surfaceFeatureExtract → snappyHexMesh → checkMesh → simpleFoam →
convergence/flux checks → ASCII slices/native artifacts. Capabilities remain
disabled until all cases pass. `/health` distinguishes HTTP health from
`executionReady`; a successful container deployment alone proves no CFD result.
Acceptance passed against the pinned real runtime on 24 October 2026.

Backend tests cover canonical units, resource/unsupported-feature rejection,
stale hashes, idempotency/conflicts, ownership, cancellation, restart recovery,
finite/bounded JSON, cursor ordering and artifact integrity. Browser tests cover
the HTTP adapter, live log graph, cancellation/reload, grouped lists, boundary
surface assignment, deselection, compact panels and responsive navigation.
Live anonymous and invalid-token requests were rejected. An end-to-end run using
the user's actual signed-in account still requires that user's authenticated
browser session; administrator acceptance does not impersonate it.

## Deploying changes

Use `deployment/package-openfoam.ps1 -Deploy` from the repository root. It uploads
only tracked runtime inputs plus the explicit worker sources to the exact worker
service; it does not recursively upload a dirty checkout or touch the existing API.
The worker is CLI-upload deployed, not automatically redeployed by pushing `cfd`.
Its Docker/health settings are configured on that separate Railway service; the
root API's legacy `railway.json` must not override the worker's build.
The pinned OpenCFD image includes GPL-licensed software, as does the optional
Foamlib compiler dependency. Preserve upstream notices when distributing images.

Planner publishing follows `deployment/README.md` after a static build, lint,
typecheck, unit/project tests, proxy tests and browser audit. Do not overwrite
`frontend/out/` while a browser test is using it. Restore only Next's generated
`next-env.d.ts` imports to `.next/dev/types` after a production build.

Never print raw Railway config/variable dumps: shared secrets may be included.
Filter inside the command before returning output. A prior configuration dump
was reported to the user; recommended credential rotation remains separate from
this worker connection and must not unexpectedly disrupt existing services.
