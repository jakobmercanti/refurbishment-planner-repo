# Results 2D slices: implementation and double-pass audit

Source: the user's Drive brief `climoptix_cfd_results_2d_slices_comparison.txt`,
version 1, file `1HPoKHJdKkewnsax0QXWaTSuO-XB07FaA`. Discovery and the pre-code
plan are in `CFD_2D_SLICES_IMPLEMENTATION.md`. The Drive original was not edited.

## User workflow

Open Climoptix → Results → **2D Slices**. Select an authorized retained run,
quantity/component, X/Y/Z plane and output iteration. Previous/Next and focused
Left/Right/Home/End browse actual available coordinates, without stacking planes.
Each axis remembers its coordinate. New inventory entries preserve the selected
plane and iteration. Native steady iterations are explicitly not physical seconds.

Compare Runs has independently chosen Baseline/Option and Swap. Quadrants are
Baseline top-left, Option top-right, Probe/Statistics bottom-left and Delta
bottom-right. Plots share a physical rectangle and common scalar range; pan/zoom
is linked by default, with Reset, optional unlinking and contained pane focus.
Narrow windows stack all four panes instead of dropping any of them.

V/the existing probe button enters one-point mode; Esc exits. Click replaces the
point, dragging pans, exact XYZ inputs use metres, and focused inspector arrows
move the point by one sampling-grid step. Hover is optional. Scalar/component
readout and full U vector/magnitude values are numerical, never colour lookups.
Compared readouts distinguish component ΔU, signed Δ|U| and nonnegative |ΔU|.
The shared probe controller's original 3D defaults and shortcuts remain intact.

Legends, percent denominator floor, quantity, time, coordinates, focus and run
choices are versioned, bounded local display preferences scoped by authenticated
worker namespace/user and project. They do not edit the project/solver document.
CSV exports physical cell-centre coordinates, both samples, masks and explicit
delta sign. JSON includes rasters, settings and pinned manifests/probes. PNGs
include quantity, run identity, plane/output, axes, units and current colour range.

## Scientific/data contract: pass one

- Brief §§0–1: discovery confirmed existing components, global SI case frame,
  authenticated SQLite run history and native OpenCFD ASCII plane output. No
  imagined Supabase result bucket, new solver or full-volume browser reader.
- §§2–3: `CFD2DSlices`, `CFDSlicePlot`, `availablePlanes`/`nearestPlane` implement
  the Results-contained layouts, exact direction labels, real irregular spacing,
  stable per-axis selection, physical aspect ratio and keyboard navigation.
- §§4–5: `cfd_slice_data.py` uses GEOS constrained source-cell triangulation and
  STRtree location, then NumPy barycentric point interpolation or stored cell
  tuples. Different meshes are sampled on one uniform area-centred physical
  grid. Holes/solids/outside/nonfinite data are masked, never extrapolated as zero.
  Equal-area quadrature produces min/max/mean/RMS, valid/missing counts, coverage
  of the union bounding rectangle and estimated common-valid area. It is not an
  exact analytic fluid-area integral; boundary accuracy depends on resolution.
- Delta is Option − Baseline, not subtraction of textures/array indices. Optional
  percent is 100*(option-baseline)/abs(baseline), masked at the configurable floor.
  |U_option−U_baseline| is explicitly separate from speed difference. Known Kelvin
  values may display Celsius, while differences and percent denominators remain
  based on consistent absolute units. Native p is m²/s², never silently Pa.
- Incompatible planes, frames, unknown/different units/components or uncertain
  pressure references block delta/cross-run values with reasons. Nearest planes
  can still be viewed non-quantitatively. Geometry changes use only common valid
  samples and are labelled; scenario/operating changes are not attributed solely
  to design. Foreign vector rotations are not guessed or silently normalized.
- §6: `CFDPointProbeControls`/`useCFDPointProbe` are reused, with a primitive scope
  key and optional Results metre/unit display. Stale readouts are cleared; points
  off the active plane are hidden rather than silently projected.
- §7: existing `list(projectId)` discovers owner-checked runs. New GET
  `/climoptix/worker/jobs/{id}/slices?projectId=...` returns a v1 manifest; POST
  `/climoptix/worker/slice-data` returns either the selected bounded raster or an
  exact physical point sample, optionally paired with another authorized run.
  Both selections recheck owner, project, expiry and asset identity. Routes are
  added only to the narrow authenticated, same-origin-write proxy allowlist.
- Native surfaces already execute at field-write cadence during solve. A later
  logged iteration proves an earlier write completed; Postprocess/terminal files
  must also parse fully and contain required arrays. Stable-size/mtime checks and
  atomic immutable snapshot publication precede ready status. No growing current
  write is advertised as ready. Failed jobs retain earlier valid outputs.
- SHA-256 snapshot integrity, source/configuration/revision/frame/reference/time
  metadata and all numerical settings identify exports/cache tuples. The browser
  loads only the chosen raster and cancels stale requests. It rejects wrong run,
  asset, field, component, sampling settings, picked coordinates or raster sizes.
  No full OpenFOAM mesh is transferred for this 2D workflow.
- §8: explicit no-data, pending, unauthorized, expired, failed and missing-field
  states are kept separate from real zero data. All-nonfinite fields have no
  invented numeric range or usable PNG action. Legend changes alter display only.
- §§9–10: physical plotted axes are Y/Z for X, X/Z for Y and X/Y for Z. Source
  project geometry remains authoritative in mm; only result presentation uses SI.

### Bounded scope and deployment requirements

This is LOCAL implementation, not an online rollout. The corresponding worker
and narrow proxy routes must be released together before the online planner can
use the new API; an older worker correctly produces an unavailable/error state.
No database migration or solver configuration change is required. NumPy is now
an explicit dependency (already in the lock through existing dependencies).

Current native solver remains steady isothermal U/p. This does not add temperature,
CO2, transient solving, pressure-reference normalization, rotated-frame registration,
glyphs, streamlines or line profiles. Known-unit future fields can use the same
adapter; absent fields are never synthesized. Original VTK/VTP/VTI imports and the
independent 3D inspector remain in Summary & 3D, not repurposed as fake run records.

Limits: last 100 project runs; latest ten retained write iterations, up to 200
plane records; 25 MB/source plane, 250k points, 500k triangles; at most 128 MB of
inventory reads per refresh and 128 MB of immutable display snapshots across the
worker store. Two numerical requests and two cached parsed planes are allowed.
Raster resolution is 16–512 per axis (UI 96/128/256/512). Older raw writes remain
in native storage/archives. Display caches live **outside** case folders under
`slice-views/{job-id}` and expire with the existing job retention cleanup; they
cannot alter case inputs, per-case archives or solver storage accounting.

## UX/accessibility/operability: pass two

The actual production static application was tested through isolated headless
Chrome profiles and a fixture-only local FastAPI service running the REAL reader,
manifest and comparison routes. No production test bypass was added. The user's
browser, cloud service and saved project were not used or modified.

Desktop 1440px, laptop 1280px, tablet 800px and phone 390px checks cover labelled
four-pane layout, physical navigation, shared scale, linked zoom, Swap, legends,
V/pick/Escape, exact readout, exports, reload persistence, progressive inventory
and permission/plane mismatch errors. Light/dark screenshots were inspected.
Colour is not the sole pane identifier; controls use existing tokens, native
styled selects, visible focus rings and clear labels. Arrow navigation stays out
of text/select/button controls; wheel zoom is confined to the focused plot.

Audit fixes included:

- Explicit float coordinate grids prevent integer input truncation.
- Affine-difference interpolation preserves constant fields exactly, avoiding a
  false rainbow from rounding noise. Constant legends are explicitly labelled;
  zero delta uses a stable ±1 display range without changing zero numeric data.
- Nonfinite/unrenderable source samples are masked. Entirely missing rasters do
  not masquerade as constant zero, including exports and download availability.
- Asset IDs include source path/time plus digest, so byte-identical files from
  different output iterations cannot select the wrong time.
- Display caches were moved out of live case folders after reviewing packaging
  and storage interactions. Tampering invalidates the parsed-plane cache.
- Loading labels use the selected axis, not an unrelated fallback axis; request
  identity and abort guards prevent old contours/readouts under new labels.
- The first automatically chosen coordinate is saved, preventing newly arrived
  middle planes from unexpectedly moving the current view.
- Incompatible planes do not show a misleading synchronized probe crosshair.
- PNG labels remain readable on phones, include scientific units/output identity,
  and tiny legend values use scientific notation instead of repeated zero labels.
- Existing main building/floorplan viewer source and layout were not changed.
  `ClimoptixWorkspace` changes only pass projectId into Results. Shared probe
  options default to the prior behaviour; 3D result/probe regressions are tested.

## Verification record

Commands/logs and final counts are recorded below after the final rerun. Earlier
failed checks were investigated, not counted as passes: the first UI run used an
old static export; tests were corrected to build /planner first. Empty-field tests
were corrected to use a fixture that actually contained the empty field and wait
for its asynchronous load. A concurrent headless WebGL drag regression was rerun
using the repository's default serial browser execution, without weakening it.

Screenshots: `.local-logs/cfd-results-qa/slices-{compare-desktop,compare-grid,
laptop,tablet,mobile,mobile-dark,permission-error}.png`. Browser tests also retain
existing native 3D planes, point probes and window interaction screenshots.

Final verification:

- `uv --cache-dir .local-logs/uv-cache run pytest -q --basetemp
  .local-logs/pytest-slices-final-08 -p no:cacheprovider --tb=short`, with
  CFD_NATIVE_ARCHIVE set to the retained acceptance case: **708 passed**. Log:
  `.local-logs/cfd-slices-backend-full.log`. This includes 12 new slice tests,
  real native U/p parsing, X/Y/Z, different grids, concave masks, signed/relative/
  vector differences, temperatures, snapshots, failure/expiry/ownership and
  256²/512² sampling. One existing Starlette/httpx deprecation warning remains.
- `pnpm test`: **636 unit + 19 persistence passed**, log
  `.local-logs/cfd-slices-unit.log`. This includes original point interpolation,
  new state/legend/CSV checks and strict wrong-run/point/settings response checks.
- `pnpm exec tsx --require ./tests/css-register.cjs --test --test-concurrency=1`
  over cfdSlices, cfdPointProbe, cfdResults, cfdFollowup, cfdSurfacePresentation and
  windowControls browser files, with CFD_NATIVE_ARCHIVE_PATH enabled:
  **35 passed, 0 failed, 0 skipped**, log `.local-logs/cfd-slices-final-browser.tap`.
  The serial sweep passed the unchanged real inlet/outlet dragging assertion.
- `node --test deployment/cfd-worker-proxy.test.mjs`: **4 passed**; new slice routes
  remain exact, bearer-authenticated, no-cache and protected against broad paths.
- `pnpm lint` including source-usage checking: passed, **459 modules, no orphans**.
  Log `.local-logs/cfd-slices-lint.log`.
- Local static Webpack production build (`PLANNER_STATIC_EXPORT=true`,
  `NEXT_PUBLIC_BASE_PATH=/planner`, `pnpm build`): passed; log
  `.local-logs/cfd-slices-static-build.log`. No export was uploaded.
- `pnpm typecheck`: passed, `.local-logs/cfd-slices-types.log`.
- Ruff over changed backend sources/tests: passed. Strict mypy over both new
  result modules with `--follow-imports=silent`: passed,
  `.local-logs/cfd-slices-mypy.log`. `git diff --check`: passed.

After the final explanatory-notice-only build, the five-case Results UI rerun
also passed: **5 passed, 0 failed, 0 skipped**. Its separate log is
`.local-logs/cfd-slices-final-focused.tap`; this final run additionally validates
actual CSV/JSON download contents and saves `slices-baseline-export.png`, which
was visually inspected. Do not conflate this with the preceding 35-case sweep.
All harnesses use isolated profiles/services and close afterwards. Progressive
publication was exercised with simulated native write cadence; no fresh live
OpenFOAM solve was performed or claimed.

### Files and compatibility

- Backend: `cfd_slice_data.py`, `cfd_slice_service.py`; owner-scoped routes and
  cache retention in `openfoam_service.py`. Native solver/compiler files unchanged.
- Proxy: `deployment/cfd-worker-proxy.mjs` and its route-boundary tests.
- Frontend: `CFD2DSlices`, `CFDSlicePlot`, `useCFDSlices`, `lib/cfdSlices`, scoped
  `app/cfd-slices.css`, and Results/worker-adapter wiring. `layout.tsx` imports the
  scoped stylesheet; shared probe controls gain backward-compatible options.
- Tests: `tests/test_cfd_slices.py`, frontend slice unit tests, worker response
  checks, five real API/browser cases and a fixture-only local service.
- Dependency metadata: explicit NumPy entry in pyproject/lock; no version churn.
- No database migration, cloud release, remote Git push, credentials changes,
  user-browser automation, native solve, or measured-building edit occurred.
  Unrelated website gitlink and attachments are preserved and excluded.

No known implementation/test blocker remains within the verified native output
scope. Online use still requires an explicitly authorized matching worker/proxy/
frontend release. Optional unsupported physics/registration/plots above are not
claimed as implemented; incompatible quantitative comparisons remain disabled.
