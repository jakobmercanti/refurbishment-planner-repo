# CFD screenshot requests: complete local re-audit

Baseline: local master `155ce95`. Scope: the 15-item workbench list and the
four-item interaction follow-up, with the earlier seven- and three-item results
requests rechecked as prerequisites. Later requests take precedence: residuals
now default to four individual graphs in two columns, not two combined plots.

No remote push, deployment, worker restart, live simulation, credential change
or modification of the user's browser/project was performed. Browser checks use
the production static build, isolated temporary browser profiles, real Python
preparation and retained native data. The harness blocks external network requests.
Mocked job responses test UI state transitions, not native numerical acceptance.

## Defects reproduced and fixed during this audit

1. A delayed plane download merged with the layer list from the render that
   started it. Removing plane-0 and importing external.vtk during that request
   restored plane-0 and discarded external.vtk. Result actions now merge against
   the current collection; removal uses file identity. External/verified status
   remains attached to each file. The eight-layer/64 MB aggregate limits remain.
2. Boundary navigation vanished while the independent thermal editor was open.
   Returning via Physics could leave no visible Thermal tab. The thermal branch
   now retains the Conditions/Thermal navigation, without remounting its draft.
3. Minimized windows could restore shorter: hidden-window measurement replaced
   their intrinsic height with a zero-layout minimum. Hidden panels are no longer
   measured. The two-window test waits for hidden resize observers before restoring
   and checks X, Y, width, height and edited values independently.
4. Solver subtabs displayed Not submitted / 0% during actual preflight, even though
   the simulation card correctly said Checking & submitting. The shared solver
   progress now receives the pending/unknown state and operation as well as its job.
5. Closing the folder with its in-body Close action did not reset file pagination.
   Reopening could start at page two. Both closing paths now reset it; the browser
   regression opens a 101-file archive, advances, closes and checks page one.
6. Empty live probe guidance still directed users to Physics. It now names
   Solver → Post and has a rendered-component regression test.

One older VTK test also had an ambiguous whole-workspace Back to geometry
lookup after the independent inspector was introduced. It now targets the actual
VTK viewer. Its field, rendered image change and byte-identical download assertions
are retained; no application assertion was weakened. The dark-navigation contrast
test also sampled a transitioning active button against a transparent parent's
black RGB channels. It now waits for the existing 120ms theme transition, targets
an inactive tab, composites its actual ancestor backgrounds and retains 4.5:1.

## List A: 15 workbench items

1. **Two simulation rows only.** Each card has name/actions and its progress bar;
   the old separate completion/message row is absent. Job messages live in the bar.
2. **Probe menus, XYZ and orange selection.** Solver → Post owns the probe rows,
   visible coordinates and duplicate/remove menus. Row and actual R3F marker selection
   agree, including the orange material and mm-to-scene position. Source rooms stay
   unchanged. Coverage: cfdSurfacePresentation and cfdDefaults browser suites.
3. **Actionable worker warnings.** Python rejection messages name conflicting
   equations/mode/coupling and repair locations. Review shows the actual current
   configuration and links to Physics/Run. Connected preparation no longer claims
   that no worker is connected. Backend worker tests exercise the conflict message.
4. **Probe/output location.** Requested outputs and coordinates are in Solver →
   Post, not Physics. The stale telemetry hint was corrected during this audit.
5. **Actual phase percentages.** Card and every solver subtab display reported
   mesh/check/post-processing task percentages. Solver percentage is explicitly
   iteration-budget usage, not convergence or predicted elapsed completion. The new
   browser test checks pending submission plus five phases across all four subtabs.
   Missing telemetry remains unknown; it must not be synthesized for older workers.
6. **Progress text inside the bar.** Phase, percentage, basis and current command
   are in the labelled progress element, including long/wrapping messages.
7. **Aligned actions.** Post actions share the equal-width two-column action grid;
   import labels participate in the same layout. Existing hierarchy/export alignment
   tests cover desktop and phone sizes.
8. **Navigable online folder.** A separate floating explorer opens the authenticated,
   hash-verified native archive. Folder rows open by double-click/keyboard, with Up,
   individual downloads, full archive and post-processing ZIP. Reopen pagination is
   now tested. This is a verified snapshot of private worker storage, not public hosting.
9. **Independent plane inspector.** Results opens a large separate viewer with a
   plane dropdown and independently scrolling controls. Loading a verified current
   plane into the main building viewer is an explicit action.
10. **Robust 3D results.** Retained native legacy FIELD planes render with p/U;
    polygon triangulation, orientation, units and current-geometry provenance are
    checked. Older/external results remain inspectable but cannot silently overlay
    changed measured geometry. Layer download races are now covered as well.
11. **Minimize/restore.** Shared header/layout-menu actions produce separate
    bottom-left task tabs; mounted values, layout and position survive restoration.
    The hidden-height regression above is fixed, not dismissed as a test issue.
12. **Navigation preference styling.** Navigation uses the same labelled control
    rows as the other Preferences dropdowns; desktop/phone alignment is measured.
13. **Selectable residual panels.** Ux, Uy, Uz and p default to a desktop 2×2 grid;
    dropdown actions add/remove graphs and switch initial/final measurements.
    Full available history is retained up to the disclosed bound. Repeated pressure
    corrections do not consume the history budget or create vertical fans.
14. **Insulation/heating handoff — preparation implemented; thermal solving not
    implemented.** Independent import windows use the shared insulation contract,
    measured radiators and checked UFH floors with explicit surface temperatures.
    Sources are not duplicated and watts are cleared when temperature is applied.
    Source-editor round trips, stale checks, units and invalid drafts are covered.
    The current worker cannot compute temperature/buoyancy, so actual radiator/UFH
    thermal CFD is still unavailable. The UI discloses this and blocks incompatible
    isothermal submissions. This item is not certified as an end-to-end thermal solve.
15. **Preference dropdowns.** Navigation, currency, temperature and flow share
    alignment, width, 12px bold typography, border, background and radius. Conversion
    preferences do not alter authoritative mm/K/SI storage.

## List B: four interaction items

1. **Checkbox/input scroll retention.** Shared intrinsic measurement preserves
   nested/ancestor scroll positions. Browser cases cover sampling checkboxes, plane
   count edits, independent thermal source checkboxes and Preferences. No blanket
   preventDefault or forced scroll-to-top behavior was introduced.
2. **Narrower aligned dropdowns.** All four Preferences selects align with the
   right-hand density button column and reserve equal help space, at 1440 and 390px.
3. **View controls and simplified walls.** Five checkboxes occupy two columns;
   2D wall outlines removes wall fills, retains checked selectable host planes and
   does not change source geometry/camera/scenario. Offline fallback uses the existing
   2D cutaway rendering. This is a display simplification, not a new 2D CFD model.
4. **Cross-surface inlet/outlet drags.** Eight real pointer transfers cover both
   devices across adjacent walls, floor and ceiling. Checked host frames/clearance
   snapping are used; identity, flow, temperature, dimensions and rooms are unchanged.
   Ceiling visibility is available in View properties. Polygon/obstruction acceptance
   remains authoritative preparation's responsibility, not the visualization's.

## Earlier seven- and three-item requests

- Clear all removes simulation/object/boundary presentation groups as well as
  entries, including empty groups; measured building surfaces/furniture are preserved.
- Restore default confirms and backs up, then creates exactly one General group
  and one fully configured coarse case with opposing supply/extract walls. It does
  not invent a completed run or start a job. Stale replies and backup failures fail closed.
- Header selector height and equal vertical spacing have direct browser measurements.
- Idle/new simulations have visible 0% progress bars; unknown worker progress stays unknown.
- Monitor sections are collapsible. Residuals use the latest four-panel default above.
- Final measured metrics use readable common text and responsive four/three/one-column
  layouts, with pressure clearly labelled kinematic m²/s², not Pa.
- Plane and archive choices are dropdowns. Native legacy VTK FIELD output, actual
  stored post-processing downloads and inspector-to-building loading are exercised.
- Field/component choice, legend ranges/palettes, per-object visibility, zoom/fit,
  real VTI slices and computed scalar isosurfaces are verified. Native passive scalar
  transport is not implemented: isosurfaces require actual imported scalar volume data.

## Validation

Fresh backend: 696 passed (`cfd-complete-audit-backend.log`); pre-existing
Starlette/httpx deprecation and pytest cache-permission warnings only.
Frontend: 627 unit + 19 persistence tests, lint/source usage (449 modules, no
orphans), typecheck and production static build passed. Deployment proxy/auth/
preview checks: 29 passed. Evidence files are under `.local-logs/` with the
`cfd-complete-audit-` prefix; generated next-env imports were restored afterwards.

The initial 75-case browser sweep had 72 passes and three failures, reproduced
and addressed above. Separate baseline reproductions also demonstrate the layer
race and the false pending/idle progress. Six targeted corrected-build cases passed.
The corrected-build full sweep completed with 76 of 77 passing; its only failure
was the contrast test's transient 2.19:1 sample. The unchanged isolated rerun passed;
after correcting the contrast measurement, the entire seven-case viewer workflow
suite passed (`cfd-complete-audit-workflow-final.tap`). Thus all 77 distinct browser
cases have passing corrected-build results across the sweep and final rerun. This
is not described as an uninterrupted 77/77 command. All original failure logs are
retained rather than overwritten or treated as successful runs.

Visual inspection covered the narrow Preferences controls, the multi-plane desktop
inspector, the mobile scalar isosurface viewport and measured telemetry typography
in `.local-logs/cfd-results-qa/`. The independent inspector stays onscreen while
its sidebar scrolls; original result and geometry provenance labels remain visible.

Detailed phase telemetry and server-generated post-processing ZIP code remain
local until a separately authorized worker release. Older workers use the verified
native archive fallback. No fresh native solve was performed; the retained archive
tests demonstrate real-file compatibility, not new solver acceptance or deployment.

## Changed source files

- frontend/components/ClimoptixResults.tsx: latest-collection result merges/removal.
- frontend/components/ClimoptixWorkspace.tsx: thermal navigation and pending progress.
- frontend/components/FloatingToolbar.tsx: skip hidden intrinsic-height measurement.
- frontend/components/CFDResultFiles.tsx: reset explorer pagination on Close.
- frontend/components/CFDWorkerTelemetry.tsx: correct the probe editor location.
- Regression changes: cfdResults, cfdReadiness, openfoamRecovery, windowControls,
  climoptixWorkflow browser files and cfdWorkerTelemetry component tests.

No backend, solver, dependency or deployment configuration was changed. Unrelated
website checkout and remote attachments remain excluded from this audit's changes.
