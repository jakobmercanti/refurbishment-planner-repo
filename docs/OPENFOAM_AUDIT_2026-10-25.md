# OpenFOAM audit and local fixes — 25 October 2026

Scope: `master`, baseline `a8898d738a90d7997f06eba719c310bd3c64c140`.
This records the initial local/uncommitted audit checkpoint. No push, deployment,
production job, account change or SSH-key registration was performed at that
checkpoint. The later refactor, final validation and Git publication are recorded
in `CFD_WORKBENCH_ASSESSMENT.md`; counts below remain historical evidence.

## Verdict

The existing real OpenCFD v2312 worker has successful native startup acceptance
for serial laminar, kEpsilon and kOmegaSST, and reported `executionReady: true`.
Its existing deployment logs show blockMesh, surfaceFeatureExtract,
snappyHexMesh, checkMesh, simpleFoam and native artifact generation for all three
models. This is evidence of real solver execution, not just passing mock tests.

The audit nevertheless found five integration/reliability gaps. They are now
addressed in local source, with failure-path regressions. Production continues
to use its previously deployed code until publication is explicitly authorized.

## Findings addressed locally

1. **Definite validation failures were incorrectly treated as unknown dispatches.**
   A real HTTP 422 kept the immutable rejected payload and disabled deletion;
   after changing CPU from 4 to 1, retry still sent CPU 4. `useCFDJobs.ts` now
   releases definite 422 requests and prepares corrected inputs under a fresh
   submission ID. Genuine ambiguous acceptance still retains its original ID.

2. **The production API settings export was missing Foamlib.**
   A synthetic diagnostic request to the public API returned HTTP 503 with
   `Foamlib is not installed on this service`. The root Dockerfile now installs
   the existing pinned `cfd` extra. Local dependency resolution confirms
   `foamlib==1.7.3`. This is a settings ZIP, not an executable solver case.

3. **A capability outage could erase an ambiguous submission.**
   Closing the protected workspace unmounted the job hook; if job-list recovery
   also failed, retry created a different submission ID. An immutable per-tab
   session journal is now saved before dispatch, scoped by authenticated worker
   namespace and project. It survives workspace closure/reload and does not
   store bearer credentials. Storage failure blocks dispatch rather than
   creating an unrecoverable paid job. The worker remains the deduplication
   authority, and private workspace visibility still fails closed.

4. **A result-fetch outage silently hid native output controls.**
   The terminal result request was one-shot with its error swallowed. It now
   retries with bounded backoff, reports the failure, and has an explicit
   read-only retry button. Failed/cancelled jobs without a manifest are explained
   separately. Download/cancellation errors are no longer cleared by successful
   log polling. Retrying retrieval never submits another solve.

5. **Probe/flux data and detailed acceptance metrics were not exposed by Monitor.**
   Native probes and flux files already existed, but the frontend showed only
   residuals and stripped mesh/conservation details from result metadata.
   Protected logs now include bounded recent native telemetry, with common
   iteration timestamps for every expected flux patch. Monitor displays probe
   XYZ velocity, kinematic pressure, histories, balance, final measured metrics
   and explicit-unit CSV export. Missing samples are not filled with zero or
   mixed across iterations. Pressure remains m²/s², not Pa. Full files remain in
   the native archive. Older workers explicitly show telemetry unavailable.

The updated startup acceptance fixture now also requires native probe U/p and
aligned boundary-flux evidence for every supported model before enabling runs.
The worker packaging helper includes the new native-reader module.

## Control-path coverage

- Workspace visibility/connection refresh → authenticated worker capabilities.
- Row Mesh/Run and Run-panel Play → immutable authoritative preflight, protected
  submission, persistent queue, status polling and per-study provenance.
- Resource-limit action → explicit study settings (not a silent solver clamp).
- Open monitor → authenticated log feed, residuals, probes/flux and native result.
- Cancel → authenticated cancellation; browser abort is not reported as cancellation.
- Worker log/native ZIP downloads → bounded protected reads and integrity checks.
- View slice → SHA-verified VTK, field selection/zoom/fit/back/original download.
- Probe selection and telemetry CSV → the same native values with explicit units.
- Settings export → preparation-only API ZIP, dependent on the API's cfd extra.

## Verification and limitations

- Full backend suite: 685 passed; native reader/worker focused suite: 33 passed.
- Frontend unit suite: 611 passed; project persistence suite: 19 passed.
- New recovery/telemetry browser suite: 6 passed, including desktop/mobile
  no-horizontal-overflow, CSV, VTK and native downloads.
- Existing account/HTTP-worker/job-hook browser suites also passed; the initial
  download-test helper needed an awaited file path and passed after correction.
- Lint, typecheck and static Webpack build passed; generated Next imports were
  restored to their development paths. Proxy routes were not widened.

No fresh real native solve was run with these local changes. This Windows
environment has no usable local Docker/OpenFOAM installation; remote SSH lacked
registered keys, which were not added. The previous native acceptance and current
healthy deployment were read-only evidence, not a new end-user job. The new
startup gate must pass on the updated worker when deployment is authorized.

The supported solve profile remains serial steady isothermal SIMPLE only.
Thermal/CO2/transient/parallel, porous sources, unsupported device models and
boundary-layer requests remain explicitly rejected; these fixes do not add or
silently substitute those solvers. Passing a fixture is not validation of every
user geometry or a certification of physical accuracy.
