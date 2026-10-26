# CFD groups, progress and results — 25 October 2026

Historical implementation record. The final local-only audit and current solver
limits are in CFD_WORKBENCH_AUDIT_2026-10-25.md; earlier no-commit/test-status notes
below describe their original checkpoint, not a release authorization.

Local implementation on `master`, based on `140cc57`. No commit, push or
deployment was made. Earlier account/default/placement changes and unrelated
site/attachment edits remain intact. The user's browser was left alone.

## Seven requested outcomes

1. **Clear all includes folders.** Simulations remove saved groups as well as
   scenarios, including when only empty groups remain. Object groups are
   cleared without deleting measured source furniture. Boundary customizations
   and groups are cleared without recreating a synthetic Default group;
   physical surfaces remain available under Ungrouped building surfaces.
   Refinement/probe lists do not have separate group metadata. Confirmation,
   persistence and active/uncertain-job guards remain in place.
2. **Restore default replaces the CFD workbench.** It also works with no
   selected simulation. Confirmation explains that all previous CFD cases and
   folders are replaced by one General group and one Simulation 1. The factory
   chooses actual opposing wall faces, one supply and one pressure extract,
   adiabatic/no-slip solids, steady laminar isothermal SIMPLE, a coarse bounded
   mesh, 1 CPU / 4 GB / 15 minutes. Measured geometry is unchanged and no job
   starts automatically. A read-back-verified browser backup is written at
   `climoptix:before-restore:<projectId>` and the previous project is downloaded
   as `*-before-restore.project.json` before replacement. Undo remains available.
   Source/workbench changes during preparation and backup failures fail closed.
3. **Header selector spacing.** The shorter selector is centred vertically;
   browser assertions measure matching top/bottom spacing rather than relying
   on a screenshot alone.
4. **Phase progress inside the bar.** The label and percentage appear in the
   bar. New worker code reports measured mesh/packaging task steps and explicitly
   labelled solver iteration-budget usage, not predicted time or convergence.
   Unknown progress stays unknown, including on older deployed workers. Mesh-only
   completion is distinguished from a completed solver run.
5. **Collapsible monitor with two plots.** The residual selector supports all
   fields or an individual field. Initial residuals and final linear-solver
   residuals occupy two desktop columns, stacking on phones. Repeated pressure
   corrections within one outer step no longer produce a misleading vertical
   fan: the first initial and last final value are displayed. Worker controls,
   convergence, telemetry, final metrics, files and logs are collapsible.
6. **Private online folder and real downloads.** An authenticated, SHA-256-
   verified native archive supplies a browsable folder tree with native case
   settings, solution data and post-processing files. Individual downloads,
   plane viewing, the full native ZIP and a post-processing-only ZIP are
   connected. New worker code creates the latter directly; an older-worker
   fallback extracts the real `postProcessing/` subtree from the verified ZIP.
   There are no public file URLs or new storage permissions. Worker retention
   is shown; users must download data they need to keep longer.
7. **Interactive Results.** Results is usable before importing a file. Verified
   worker planes or external ASCII VTK/VTP/VTI data load as up to eight layers.
   Controls include layer visibility, field/vector components, palettes and
   legend ranges, opacity/wireframe, camera zoom/fit/axis views, and measured
   building/object context visibility when provenance matches. Actual VTI
   volumes support moving grid slices and computed scalar isosurfaces. Surface
   files cannot fabricate volumetric fields. Desktop controls use a bounded
   side inspector; phones put the scene first. Display actions never modify
   simulation inputs or authoritative geometry.

## Real-data defects found and corrected

- Native OpenFOAM slice exports use legacy VTK `FIELD` blocks for TimeValue
  metadata and pressure/velocity arrays. The importer previously rejected that
  real encoding, although smaller SCALARS/VECTORS fixtures rendered. It now
  validates numeric array names/types/counts/values, drops only global display
  metadata and normalizes attributes in an in-memory rendering copy. Downloads
  remain byte-for-byte unchanged. All three latest planes in the retained native
  archive render with p and U in the actual vtk.js browser renderer.
- Mesher `Time = 0` headings were counted as solver iterations. Only headings
  with actual residual samples now count, avoiding an extra preliminary step.
- A duplicate study detail label called iteration-budget usage a percentage
  of phase. It was removed; the qualified label remains inside the progress bar.
- An old responsive test wrongly required Results to stay disabled before an
  import. Its assertion now tests the requested always-accessible Results tab.

## Reliability and bounds

Shared result retrieval is job/study/revision scoped, abortable and read-only,
with bounded retry; retry never launches another simulation. Download actions
have a synchronous duplicate-action lock and abort when their monitor closes.
The proxy retains exact route matching, bearer authentication, no-cache and
no-redirect restrictions. Archive listing does not inflate every solution file;
path traversal, duplicate/prototype names and oversized archives are rejected.
The folder browser is bounded to 5,000 entries / 512 MB declared expansion;
native download limit is 128 MB. Older-worker post-processing repackaging is
limited to 64 MB; larger data retains the full native ZIP download path.

Result imports are ASCII-only, at most 25 MB/file, eight layers / 64 MB total,
with validated connectivity, finite renderer-safe values and bounded XML/array
counts. VTI volumes are limited to 250,000 points/cells; interactive isosurfaces
to 50,000 cells. Unsupported cell-centred VTI fields require explicit point-data
export rather than guessed interpolation. Renderer objects and stale async
work are cleaned up. The former duplicate viewer implementation is replaced
by a compatibility re-export to the shared renderer.

## Validation evidence

- Full backend: **695 passed**. Only the existing Starlette/httpx deprecation
  and unwritable pytest-cache warnings remain.
- Full frontend unit and project suites: passed; project suite **19 passed**.
- Auth/CFD/production proxy and release preview suites: **29 passed**.
- Focused production-bundle browser run: **45/45 passed**, including all seven
  outcomes, real retained native planes, post-processing ZIP contents, folder
  navigation/downloads, scalar slice and computed isosurface geometry,
  responsive themes, actual R3F camera/vent interactions, worker cancellation,
  reload/ambiguous-submission recovery and read-only result retry.
- After the final review corrections and rebuild, the five results-specific
  browser cases passed again (**5/5**), including Clear all when only an empty
  folder exists and rendering all three retained native planes.
- Lint/source usage, TypeScript and production static build are checked locally.
  Generated development type imports are restored after the build.
- Screenshots: `.local-logs/cfd-results-qa/results-retained-native-planes.png`,
  `results-folder-and-planes.png`, `results-scalar-isosurface.png`.

## Deployment and numerical limitations

Nothing was published. The deployed worker remains its existing version:
new detailed phase-step telemetry and the server-created post-processing ZIP
need a separately authorized worker rollout. The client fallback supports the
older native archive; unavailable live telemetry is not invented.

The native solver currently solves velocity and kinematic pressure, **not
passive scalar transport**. Scalar isosurfaces were verified using actual
imported structured scalar data; this is not a claim that native CO2 transport
has been implemented. Pressure is labelled m²/s², not Pa.

The retained real accepted run from the preceding task used OpenCFD v2312,
71,944 cells and converged in 161 SIMPLE iterations with passing conservation.
Its archive is `.local-logs/cfd-defaults-qa/native-accepted-case.zip`; that
numerical evidence is described in `CFD_DEFAULTS_VALIDATION_2026-10-25.md`.
This task rendered its three latest native planes offline; it did **not** run
a new native solve or exercise the updated packaging/progress code on the
hosted worker. The factory's subsequently added monitoring probe still has
preparation/submission coverage, not a second live native-run claim.

Default generation still requires valid measured room geometry with suitable
opposing walls; a connected, authorized worker is required to run. No default
can truthfully guarantee acceptance for arbitrary invalid measured geometry.
