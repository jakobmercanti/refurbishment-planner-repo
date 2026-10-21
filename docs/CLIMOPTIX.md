# Climoptix CFD preparation

Climoptix is a workspace inside the existing planner, sharing the same building,
rooms, permanent openings, floor voids, furniture, occupants and project history.
It is **preparation software, not a connected CFD solver**. There is no new
pricing tier, payment gate, external job submission or executable case template.

The supplied requirements are preserved in [CLIMOPTIX_BRIEF.txt](CLIMOPTIX_BRIEF.txt).

## Integration and source map

The existing frontend is Next.js/React with React Three Fiber, shared measured
room/building documents, IndexedDB autosave, project history and `.floorplan3d`
packages. FastAPI serves the deterministic Python geometry/catalogue kernel.
Climoptix extends those documents and the workspace selector; it does not create
another editor, authentication system or asset database. Existing upper-floor
support/footprint checks, slab voids, interior roof definitions and low-detail
catalogue/people proxy recipes remain authoritative.

- `geometry/climoptix_models.py`: versioned SI/geometry/provider contracts.
- `geometry/climoptix_domain.py`, `climoptix_surface.py`: source adaptation,
  connectivity, interior faces and checked surface triangulation.
- `geometry/climoptix_workflow.py`, `backend/app/climoptix_foamlib.py`: mesh-level
  and plane contracts plus optional Foamlib settings-package serialization.
- `backend/app/climoptix_provider.py`, `climoptix_api.py`: preparation provider,
  source/device/BC/refinement diagnostics and stateless HTTP boundary.
- `frontend/lib/climoptixDocument.ts`, `climoptix.ts`, `climoptixPreview.ts`:
  matching client contracts, hashes/export and presentation-only helpers.
- `frontend/components/ClimoptixWorkspace.tsx`, `ClimoptixPanels.tsx`,
  `ClimoptixViewer.tsx`, `frontend/app/climoptix.css`: workflow and inspection UI.
- `ClimoptixSimulation.tsx`, `ClimoptixVTKViewer.tsx`, `climoptixWorkflow.ts` and
  `climoptixVTK.ts`: simulation tabs, imported-log charts and bounded VTK viewing.
- Existing planner/menu/layout, project document/repository/history/local hooks,
  backend project validation and `deployment/planner-worker.mjs` integrate it.
- `scripts/audit_climoptix.py` and the `climoptix*` Python/frontend/browser tests
  provide independent examples, contracts, persistence and interaction coverage.

## Use it

1. Draw or open a building in Floorplan. Select **Workspace → Climoptix CFD**.
2. Create a study, name it and select its seed floor and room. Studies can be
   duplicated, archived, deleted with confirmation, imported and restored by Undo.
3. Select **Validate & refresh** to discover the connected air region and prepare
   its tagged boundary. Inspect included/excluded rooms and passage/STOP markers.
4. In Equipment, add supply/extract devices or use **Place on face** in 3D. Use
   precise host U/V coordinates, or drag a vent in 2D/3D. Geometry and dimensions
   are millimetres. Numeric entries apply on Enter or leaving the field; rejected
   values are not persisted. New/moved vent markers show intent, not a checked
   perforated surface, until validation refreshes it.
5. Review object treatments, calibrated heat/CO₂ inputs and proxy assumptions.
   Excluded objects retain their settings but emit nothing. Source-only people
   can represent occupants supported by furniture without overlapping solids.
   Built-in visual assets can be compared with the independent CFD skin.
   **Edit source building & assets** returns to the shared placement tools without
   losing the study. Solid-object sensible power is distributed over its exposed
   surface area; positive heat flux means heat **into the air**. Source-only power
   remains a separately tagged source. Instance power/temperature and conflicting
   per-patch thermal controls cannot silently over-constrain the same object.
6. In Boundaries, set group conditions, search/select coloured patches and apply
   overrides. Vent conditions come from their devices. Removed host references
   are reported, not silently retargeted; stale overrides can be removed.
7. Configure Physics, then **Simulation → Mesh / Run / Post-processing**. Temperatures are K; pressure is Pa; velocity
   is m/s. Volume-flow display offers L/s, m³/h and m³/s. CO₂ concentration is ppm
   by volume (1 ppm = 10⁻⁶ fraction); object emissions are pure-CO₂ m³/s, not ppm/s.
   For example, 293.15 K is 20 °C. Presets are illustrative, not certified inputs.
   Named box/sphere/object refinement extents appear in 2D/3D as wireframe intent.
   Cuboids have editable X/Y/Z centres and dimensions, a numbered snappyHexMesh
   level and a matching colour in the region list and 2D/3D viewer. Level N means
   base cell / 2^N along each axis. The list supports selection, duplication,
   reordering and deletion; ordering does not override the highest overlapping
   refinement level. Legacy cell-size regions remain editable and round to the
   next sufficient level in the settings export. Changing the mesh preset preserves those regions; invalid local/global size
   combinations need review. Viewer arrows show prescribed discharge directions,
   not simulated velocities. **Isolate selection** inspects a selected patch.
8. Validate again. Review errors, warnings and source/configuration hashes. Export
   a study JSON or a preparation ZIP. A ZIP can contain blocking diagnostics;
   it includes a boundary STL only when the checked skin is valid and current.
   The STL is explicitly **metres**, X/Y plan and Z up. Source coordinates remain
   mm. Neither JSON nor STL is a runnable OpenFOAM case or finite-volume mesh.
   **Download settings & preflight** exports readable text; the ZIP also includes
   `summary.txt` alongside the complete structured inputs and diagnostics.

File → Save/Open includes every study in the existing `.floorplan3d` package.
Settings, selection and study edits survive switching between the workspaces.
Completed vent drags have independent Undo checkpoints. Numeric drafts commit on
blur/Enter, while text editing retains ordinary history coalescing.
Only a small in-memory preview cache is retained; triangles are not copied into
each saved project. After a reload, refresh the checked preview before exporting.

## Geometry and safety rules

- Discovery traverses explicit permanent doorless rectangular, round-arch,
  segmental-arch and chamfered passages whose room-facing apertures and ceilings
  match. It also traverses validated physical inter-storey slab voids.
- A door or window **always stops discovery**, independently of swing, sliding
  operation or whether its leaf is visible. It creates a named virtual cap.
  An open-cap pressure/opening suggestion does not connect the adjacent room.
- Adjacency, a missing leaf, a stair asset, room labels or merely sharing a
  building/floor do not establish a portal. Conflicting/overlapping apertures fail
  closed. There is no guessed connection across a geometric gap.
- The kernel uses measured source polygons, explicit wall ownership/thickness,
  capped/mitred wall junctions and interior ceilings, never GPU triangles. Flat,
  mono-pitch, gable, stepped and optional per-room roof/independent-ceiling
  definitions are supported. Slab tunnels have real side faces, not artificial
  lids. Variable wall thickness participates in the roof frame.
- Boundary construction retains passage reveals and explicit source provenance.
  It uses constrained triangulation and checks duplicate/degenerate facets,
  consistent edge orientation, manifold closure and positive signed volume.
  Numerical welding is 0.00001 mm, not permission to heal building gaps. It is not
  a general-purpose BRep repairer or a claim that every arbitrary CAD solid works.
- The existing catalogue proxy recipes are reused with source transforms and
  optional CFD-only offsets. Floor contacts are cut out rather than leaving
  coincident faces. Real prism intersections, not only overlapping bounding boxes,
  detect conflicting objects. Proxy simplifications and their limits are exported.
- Vent footprints must clear host edges, caps, voids, contacts and other devices.
  Actual/effective area, discharge coefficient and the single controlling flow
  quantity are separate. A pressure-controlled flow is unknown, not invented.
- Invalid shapes/settings block surface export. A complete worker must repeat
  validation before any future mesh/run; a browser validation stamp is not
  authorization to execute or spend resources.

## Persistence, identity and providers

Projects retain schema version 1, with optional `cfdScenarios`. Older projects
without it open with zero studies. Each strict version-1 study stores references
and overrides, not another building. Unsupported future versions, duplicate
scenario IDs, cross-project references, non-finite values and unknown scenario
fields are rejected. Missing source entities remain repairable diagnostics.

The client computes a SHA-256 input revision for staleness. The backend separately
hashes source geometry/provenance and scenario configuration, with an adapter
version. Camera, active-floor projection, study names and notes are not geometry
changes. Responses received after source/setup edits cannot mark the new state
validated. Project duplication rebinds studies and invalidates validation stamps.

Wall patch identities use stable source-corner provenance where available. Legacy
walls without stable corners use geometry identities so an old condition becomes
an orphan rather than being assigned to a newly numbered, different wall.
Ceiling partitions distinguish single, sloped multi-facet and stepped surfaces.

`backend/app/climoptix_provider.py` defines the `CFDProvider` protocol and the real
`PreparationOnlyProvider`. Capabilities, scenario validation, geometry preparation
and mesh recipes work. Typed future case/job/result contracts exist, but case
generation, mesh submission, running, cancellation, status and results explicitly
raise unsupported-operation errors. There are no run/job HTTP routes.

`GET /climoptix/capabilities`, stateless `POST /climoptix/prepare` and optional
`POST /climoptix/openfoam-settings` are the only CFD endpoints. The public proxy
permits exactly those operations; POST requires
the application's origin and has a bounded streaming 4 MiB body limit. The API
rejects invalid/non-finite JSON before model error serialization. Preparation
omits unrelated studies, quotations, service layouts, reference annotations and
embedded plan-symbol pictures; nothing is saved to a server job directory.

## Explicitly staged / unavailable

- Production CFD volume meshing, achieved quality/y+, convergence, residuals,
  simulation fields, comfort results, remote workers, adjoint/DOE optimization and
  runnable solver dictionaries are **not implemented**, as the brief requires.
  Mesh counts/memory are uncertain planning estimates, never achieved quantities.
- Imported visual GLBs need a measured obstruction adapter. They must be explicitly
  excluded for a checked surface; their render bounds are not silently treated as
  authoritative solids. Nominal balustrade catalogue proxies exist, but assembled
  opening-guard contact/union handling is not yet part of the air-skin adapter.
  Such guards block surface export rather than disappearing from a supposedly
  complete CFD model.
- Partial internal wall runs not represented by enclosed room boundaries are
  detected and block surface export. Missing source-wall coverage is also checked.
  A dedicated partial-wall solid/room-partition adapter remains necessary.
- Intersecting furniture/people proxies require an explicit modelling choice.
  General solid unions, arbitrary solid clipping against sloped roofs/walls,
  calibrated porous resistance, radiation models and executable source schedules
  remain staged. Ineligible electrical/door/window/stair assets are not obstacles.
- Movement polygons and optimization objectives are saved intent only. No gradients,
  autonomous placement or optimization results are manufactured.
- Dedicated elevation drawing, a full arbitrary HVAC/fan/recirculation network,
  additional proxy-fidelity editing and full imperial CFD-field display remain
  staged. Shared source placement is available, geometry fields explicitly show
  mm, and physics uses labelled SI. Recirculation, radiant fractions and schedules
  are clearly marked metadata rather than working source/solver models.

Current preparation limits are 200 rooms, 2,000 room boundary segments, 5,000 source
wall-run segments, 1,000 source apertures, 500 devices, 6,000 analytic skin faces
and 15,000 shared corners. Oversized/unsupported cases fail with a useful error;
there is no claim of unlimited model or solver capacity.
Global cell-size inputs are bounded to 0.01–10,000,000 mm and open-area fraction
to 10⁻⁶–1, preventing numerically unsafe underflow/overflow in preparation estimates.

## Repeatable validation and examples

Use the existing project checks: `uv run pytest`, and from `frontend/` run
`pnpm test`, `pnpm typecheck`, `pnpm lint`, the production export and browser suite.
The new `test_climoptix.py`, `climoptix.test.mts`, `climoptix.integration.mts` and
`browser/climoptix.browser.mts` cover topology, all door/window states, profiles,
ceilings, source/host edits, object contacts, strict configuration, persistence,
undo, export, late responses, unavailable services and responsive/dark UI.
Additional preview tests compare UV transforms and prescribed directions to the
real provider. L/T/U-shaped domains with rotated flat/mono/gable/stepped roofs,
heat-power conservation, malformed/extreme input, source selection, refinement
editing and all five portable project imports have explicit regression coverage.

The Python test runner currently reports an existing FastAPI/Starlette TestClient
deprecation warning. It is not a test failure and no runtime dependency was
changed to suppress it.

For local development, run the existing FastAPI application and point the same
frontend at it. In separate terminals from the repository root:

```powershell
uv run --extra cfd --inexact uvicorn backend.app.main:app --reload
```

```powershell
Set-Location frontend
$env:ENGINEERING_API_ORIGIN='http://127.0.0.1:8000'
$env:NEXT_PUBLIC_API_URL='/engineering-api'
pnpm dev
```

Use the frontend address printed by Next.js. For the static public deployment,
both the updated backend and worker allowlist must be deployed; the old remote
backend does not gain preparation endpoints just by changing the local UI.
Nothing in the preparation workflow submits remote solver jobs or deploys/pushes
the repository.

Generate five portable examples with:

```powershell
uv run python -m scripts.audit_climoptix --output-dir .local-logs/climoptix-examples
```

Open the resulting `.floorplan3d` files through File → Open: connected passages,
an open-door hard stop, a two-floor atrium, a sloping office and an office with
standing/seated occupants. They are illustrative—not certified ventilation cases.

An independent **developer-only** STL-to-tetrahedra check can be added using an
explicit local Gmsh executable:

```powershell
uv run python -m scripts.audit_climoptix --output-dir .local-logs/climoptix-examples --gmsh 'C:/Program Files/FreeCAD 26.3/bin/gmsh.exe'
```

All five exported skins have passed that check, with positive tetrahedral cells
and matching volumes. These QA cells are not exposed as application mesh/results.

### Initial preparation verification — 21 October 2026

All checks below passed on the local working tree:

- Full Python suite: **565 passed** (one existing TestClient deprecation warning).
- Frontend `pnpm test`: **537 unit + 19 project/persistence tests passed**.
- Full production `pnpm test:browser`: **39 passed**, including seven Climoptix
  flows and the existing catalogue, floors/roofs, People, services and account UI.
- Public worker `node --test deployment/planner-worker.test.mjs`: **12 passed**.
- Total automated regression cases: **1,172 passed, zero failures/skips**.
- `pnpm lint`: ESLint and source-usage checks passed (339 modules, no orphans).
- `pnpm typecheck` and production static build: passed.
- Mypy: 52 source files clean; scoped Ruff checks passed.
- Five independent Gmsh export checks: positive tetrahedra and matching volumes.
- Desktop, dark and mobile screenshots inspected; narrow-plan labels have
  readable screen-sized type and theme-aware contrast. Real 2D/3D vent dragging,
  independent Undo, patch/object selection, refinement shapes, stale responses,
  source-editor navigation and report downloads are exercised in the browser.

Commands used the existing `.venv` (`uv run --python .venv/Scripts/python.exe
--no-sync pytest -q -p no:cacheprovider`) and the normal frontend scripts. The
static build used `PLANNER_STATIC_EXPORT=true` and `NEXT_PUBLIC_BASE_PATH=/planner`.
Browser tests exercised that production export, with the actual local Python
preparation provider behind the preparation route—not synthetic solver results.
Evidence logs/screenshots and generated example packages are in `.local-logs/`.

No commit, push, remote deployment or solver job was made. Existing unrelated
working-tree changes, including the earlier room-roof/balustrade work, are kept.

## Mesh / Run / Post-processing extension

The top-right selector contains Floorplan, PlannerBuild and Climoptix CFD, in
that order. They share the same saved building; Climoptix retains its independent
study and setup controls when switching between all three workspaces.

**Simulation** contains three keyboard-accessible tabs:

- **Mesh:** global cell sizes and budgets plus an insulation-style list of local
  regions. Cuboids use measured millimetre dimensions. Levels 0–10 have a stable
  palette, shared between the list, 2D footprint and 3D wireframe. Explicit levels
  take precedence over the retained legacy `cellMm` field. Selecting a finer
  level lowers the global minimum limit as needed, subject to its safety bounds.
  A custom millimetre target rounds down to the nominal cell size at the resolved
  snappyHexMesh level; validation checks that actual size against the global limits.
  The list and export manifest show the resolved level and nominal cell size,
  while the original requested target remains saved separately.
- **Run:** steady/transient mode, CPU cores, memory/time budgets, convergence and
  time-step controls. Changing mode sets SIMPLE/PIMPLE coupling appropriately.
  Play and Cancel are visibly unavailable until an isolated worker exists.
  Importing an actual OpenFOAM solver log draws initial-residual curves, with
  latest values and original-log download. No live convergence is fabricated.
  The chart clips its display to 10⁻¹²–1; zero residuals remain zero in the source.
  Logs are limited to 8 MiB / 20,000 displayed records / 32 fields and are not stored in the
  project. Residuals alone do not establish physical convergence/conservation.
- **Post-processing:** enable X/Y/Z plane stacks, 1–100 interior evenly spaced
  planes per axis, requested fields and sampling cadence. Stable names and exact
  positions are saved/exported; the 3D geometry view shows plane intent. Plane
  positions follow source X/Y plan, Z up, never the Three.js camera frame. T/CO₂
  requests require their equations. No solved values are used to draw intent.

### Foamlib export

Install the explicit optional backend extra with `uv sync --extra cfd --inexact`.
`--inexact` preserves other locally installed development tools. Normal geometry
preparation still works without this extra. Include `--extra cfd --inexact` on
subsequent `uv run` commands to keep the optional adapter enabled without removing
other development packages. Public/backend deployments must also install this
extra; the browser bundle alone cannot enable Foamlib on an older service.
The new export endpoint returns 503
with installation guidance when Foamlib is unavailable, and 422 for invalid source
or settings. It repeats source/preflight validation, accepts no browser report,
path or template, and uses the same 4 MiB finite-JSON/same-origin proxy controls.

The ZIP contains restricted `settings/system/snappyHexMeshDict`, `controlDict`
and `decomposeParDict`, written **and re-read with Foamlib 1.7.3**. It also contains
the full study, checked preparation, configuration/source hashes, stable plane
manifest and a clear `runnable: false` marker. Geometry positions are metres in
dictionaries; millimetre source positions remain explicit in the manifest.
Cuboids become `searchableBox` regions with `inside` refinement levels. Sampling
becomes named `cuttingPlane` entries with ASCII VTK output. OpenCFD's `solverInfo`
function is used for future performance output, not an invented monitoring file.

Target dialect is **OpenCFD v2312**, not a promise of cross-distribution executable
compatibility. This is a settings handoff, **not a runnable case**. A worker must
still supply the background mesh, interior location, boundary/field/source mapping,
complete snapping/layers, transport/numerics and hard resource/quality checks.
The boundary STL is available separately in the existing preparation ZIP.
`scenario.json` retains every setting, including those still awaiting translation.
Energy without Boussinesq and CO₂ require additional reviewed solver adapters;
incompressible solver pressure dimensions must not be mistaken for Pa.

Foamlib is GPL-3.0-only. It is an optional, lazy-loaded server dependency; no
repository licence was changed. Review distribution obligations before shipping.
VTK.js 37.4.2 is loaded on demand only for imported result inspection.

### Direct VTK inspection

Post-processing can open local **ASCII .vtp PolyData** or legacy **ASCII .vtk
POLYDATA** surface/slice files in the right-hand 3D viewer, without ParaView.
It supports point/cell scalar colouring, vector magnitude, orbit, zoom, Fit,
numeric colour range and unmodified original-data download for external tools.
Files stay local and are explicitly labelled **external / provenance and units
unverified**. They do not mark a study as run or validated. The viewer releases
its WebGL resources when closed or hidden.

For bounded browser memory, import is limited to 25 MiB, one piece, 250,000
points/cells, 64 arrays and 1,024 XML elements. Binary/compressed/appended XML,
entities/DTDs and VTU volume grids are rejected with useful guidance. Legacy
`FIELD` attributes are not silently discarded: export these as ASCII .vtp instead.
Full volume/multi-time results
and automatic worker-generated artifacts remain unavailable until connection;
the future worker should retain complete originals and supply bounded VTK
surfaces/slices for browser viewing. No data is silently presented as a full
volume result when it is only a surface or slice.

XML numeric arrays are checked before reaching VTK: exact tuple/value counts,
monotonic bounded cell offsets, connectivity and point references, declared
integer ranges and WebGL numeric limits. Only a canonical numeric tree is passed
to the reader. Invalid result fields are reported, not silently displayed as
zero-padded data; invalid geometry is rejected. FieldData metadata is not rendered.
Safe 64-bit integers are passed as doubles to avoid the reader's 32-bit wrapping.
The original downloaded file remains unchanged, including omitted metadata/fields.
An oblique initial camera makes X/Y/Z slices visible, and scalar colours are
unlit so that they correspond to the displayed colour scale.

Sources used for the adapter:
[Foamlib file API](https://foamlib.readthedocs.io/en/stable/files.html),
[snappyHexMesh regions](https://doc.openfoam.com/2306/tools/pre-processing/mesh/generation/snappyhexmesh/castellation/),
[cutting planes](https://doc.openfoam.com/2306/tools/post-processing/function-objects/sampling/surfaces/cuttingPlane/),
[solverInfo](https://api.openfoam.com/2312/classFoam_1_1functionObjects_1_1solverInfo.html),
[VTK.js](https://kitware.github.io/vtk-js/).

### Workflow extension verification — 21 October 2026

- Full Python suite: **576 passed** (the existing TestClient deprecation warning remains).
- Frontend: **541 unit + 19 persistence/project tests passed**.
- Full production-browser suite: **42 passed**, including Mesh/Run/Post-processing,
  level colours, duplicate/delete/Undo, saved cores/slices, real Foamlib export,
  real-format residual logs, VTP and legacy VTK point/cell fields, download,
  rejected oversized imports, dark contrast and narrow-screen controls.
- Public worker/proxy: **13 passed**. Total: **1,191 automated cases passed**.
- Production static build, `pnpm lint`, `pnpm typecheck`, source reachability
  (346 modules), Mypy (54 files), scoped Ruff and whitespace checks passed.
- All five example studies independently exported Foamlib settings, including
  spherical and object-bound regions. The missing-Foamlib API path returned 503
  with installation guidance; no fake package or successful job was returned.

The audit corrected a real asynchronous workspace-selection race: a late
PlannerBuild access lookup could previously override a more recent Climoptix
choice. All workspace changes now invalidate older requests. A deterministic
browser regression delays that lookup until after the user returns to Climoptix
and checks that the selection, study settings and export remain intact.
It also corrected the VTK XML runtime entry point, WebGL cleanup, inactive
dark-mode navigation contrast, integer-only refinement levels and import bounds.

Evidence logs and screenshots are in `.local-logs/climoptix-workflow-*`.
Validation used the optional `cfd` extra and the existing production-browser
harness, with the actual local Python provider/Foamlib adapter behind requests.
No solver, remote job, deployment, commit or push was performed.

### Independent audit — 21 October 2026

Fresh reproductions exposed and corrected these issues:

- Custom refinement targets could round to a cell finer than the global minimum
  while the list still showed the unrounded target. Validation, display and
  export now agree on the discrete nominal size; the manifest preserves both.
- Extremely small positive refinement targets could overflow the ratio used to
  compute the level and crash validation. Log differences and bounded exponent
  scaling now produce actionable diagnostics instead of an exception.
- X/Y slices initially appeared edge-on. An oblique initial camera makes all
  axis planes visible; lighting no longer alters quantitative scalar colours.
- A slow solver-log import could overwrite a newer file or repopulate a cleared
  chart. Generation guards cover new imports, Clear and unmount.
- The VTK XML reader could zero-pad incomplete arrays, allocate from unchecked
  offsets/metadata, and wrap 64-bit integers. Canonical pre-reader validation now
  prevents these cases, bounds XML complexity, and reports unusable fields.
  Invalid geometry is rejected before creating a WebGL canvas.

The browser regressions use delayed file reads, actual result pixels, malformed
numeric arrays/connectivity, harmless metadata isolation, preserved 64-bit values,
and real application theme transitions. Original result downloads are unchanged.
All five example studies were independently revalidated and their Foamlib
dictionaries re-read. No settings package is marked runnable; OpenFOAM remains
unconnected and Play remains disabled.

Final verification on the production export:

- **580 Python, 543 frontend unit, 19 project/persistence, 46 browser and 13
  worker/proxy tests passed: 1,201 cases, zero failures/skips.** The existing
  TestClient deprecation warning remains.
- The seven Climoptix workflow browser cases passed again after the final
  screenshot checks were changed to capture settled application themes rather
  than a partially transitioned palette. Desktop, mobile and X/Y/Z images were
  inspected.
- Production build, ESLint/source reachability (346 modules), frontend
  TypeScript, Mypy (54 files), scoped Ruff, formatting and whitespace checks passed.
- Evidence is in `.local-logs/climoptix-audit-*`. Tests use the actual local
  preparation provider and Foamlib adapter, not fabricated solver results.

At this checkpoint, changes were local; no solver, deployment, commit or push
had been performed.

### Three-pass CFD refactoring audit — 21 October 2026

The audit started from commit `a683ba2` on `cfd`, preserving the unrelated website
checkout, generated Next.js declaration and temporary attachment.

**Pass 1 — contracts, geometry and data flow.** Fresh failing regressions exposed
order-dependent vent spacing and backend coercion of booleans/text in nested
numeric arrays. Both devices' clearance requirements now apply symmetrically;
host-edge checks use the original eligible surface, not progressively cut vent
holes. Nested numeric contracts now agree with the frontend. The preflight text
reports discrete refinement levels/nominal cells and named sampling planes,
rather than an obsolete retained cell target.

**Pass 2 — application state and user experience.** Delayed study imports recheck
the current 100-study limit; obsolete reads cannot apply after replacement.
OpenFOAM-settings requests are aborted on workbench disposal, preventing a late
download from a replaced project. Boundary search now searches displayed room
and surface names as well as identifiers, and reports empty results. The delete
confirmation reuses shared window/header/control styles while keeping native
modal focus trapping, a safe Cancel default, nested help, Escape and focus return.
Deleting the last study focuses New study; Undo restores it.

**Pass 3 — independent integration and visual review.** Every phase and simulation
tab is traversed in both Default and Modern styles, light/dark, comfortable/compact
density, and 1440×1000, 1024×768 and 390×844 viewports. This reproduced a shared
Default-style Preferences overlay behind the top bar; the base modal layer now
matches Modern, eliminating the redundant theme-specific layering override.
Wrapped labels retain aligned input baselines, and form checkboxes have full-height
click targets. All three CFD help entry points are exercised. The legacy VTK reader's 32-bit
wrapping was independently reproduced with 3,000,000,000 becoming a negative
result. A bounded numeric preflight now checks complete arrays, declared integer
ranges, cell counts/connectivity and field associations before decoding. Tabs
and empty cell blocks are normalised only in the display copy. Unsupported legacy
FIELD, colour/texture sections or 64-bit IDs require an ASCII .vtp export; originals
are not altered. The supported subset follows the
[VTK legacy format](https://docs.vtk.org/en/v9.6.1/vtk_file_formats/vtk_legacy_file_format.html)
and the actual pinned vtk.js reader, not an assumed reader API.

Refactoring removes the unused frontend result-manifest declaration, the second
time-mode control and duplicate time/numerics editors, the duplicate refinement
Delete action, obsolete dialog styling and duplicate modal-layer rules. Run
controls have one home in Simulation → Run, including transient expert numerics;
Physics retains initial fields. Numeric validation is shared between XML/legacy
imports. Source-input derivation and convergence grouping are memoised, and
boundary/device/source lookups no longer rescan entire collections per patch.
The provider's explicit future case/job/result contracts are retained because
they are part of the requested adapter boundary, not obsolete runtime code.

A three-run local microbenchmark resolving 2,000 object boundaries improved its
median from **378.37 ms to 127.10 ms**, with identical boundary values and
diagnostics. This measures lookup refactoring only, not meshing or solver speed.
Evidence and before-fix reproductions are in `.local-logs/cfd-pass*`; final
regression logs use `.local-logs/cfd-final-*`.

Verification:

- **586 Python + 545 frontend unit + 19 project/persistence + 53 browser + 13
  worker/proxy tests passed: 1,216 cases, zero failures/skips.** The existing
  TestClient deprecation warning remains.
- All **21 CFD browser flows passed again** after the final form-alignment
  adjustment, including exact input-baseline assertions when labels wrap.
  Fresh Default/Modern desktop/mobile, light/dark and delete-dialog images were
  inspected.
- All five examples retained closed skins, positive volume and zero bad edges;
  their three generated dictionaries each round-tripped through Foamlib.
- Production build, ESLint/source reachability (347 modules, no orphans), frontend
  TypeScript, Mypy (54 files), scoped Ruff, formatting and whitespace checks passed.
  All 55 CFD stylesheet class names have matching component usage.
- Optional coverage instrumentation conflicted with NumPy import; the standard
  uninstrumented suite passed. No coverage percentage is claimed.

No solver, deployment or remote job is enabled by these changes.

## Smallest next solver milestone

Choose and license-review one OpenFOAM distribution/version, then implement one
isolated worker adapter for a validated steady isothermal case. It must consume
the versioned geometry/patch/recipe manifest, enforce CPU/memory/time limits,
generate restricted dictionaries, run real meshing and quality checks, and return
provenance-bound job/artifact manifests. Add real log/cancellation/failure tests
before enabling any Mesh or Run control. Do not launch a solver from the browser
or accept arbitrary shell commands, filesystem paths or executable user templates.
