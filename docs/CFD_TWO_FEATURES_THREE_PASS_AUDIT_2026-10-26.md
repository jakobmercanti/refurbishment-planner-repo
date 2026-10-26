# CFD results comparison and adjoint preparation: three-pass audit

## Scope and release boundary

This audit covers the two most recently added features: Results → 2D Slices/run
comparison (`bfcd303`) and Adjoint Optimisation **preparation** (`db208ff`). It is
a three-pass audit by the implementing agent, not an independent external review.
The prior implementation/discovery and mathematical audit notes remain historical
records; the validation below is the current rerun.

The user's latest release instruction is **keep changes local for now**. All work
stays on local `master`: no remote push, deployment, worker restart, new native
simulation, account/credential change or database migration. The unrelated website
gitlink and user attachments are preserved and excluded from the commit.

## Pass 1 — data contracts, geometry and reliability

Reviewed both features from authoritative geometry/data through transport,
asynchronous UI state, persistence, plotting and exports. Fixed:

- Incompatible option units/components or plane orientations could be sampled
  and then labelled with baseline units/axes. They now produce unavailable option
  values rather than misleading numbers. Same-axis shifted planes remain
  viewable, explicitly without quantitative delta/cross-run probing.
- Percent outputs were labelled simply as subtraction. The numerical definition
  now explicitly reads `100 × (Option − Baseline) / |Baseline|` in the API, plot
  and exports; the near-zero denominator mask remains authoritative.
- A shifted Option plot could export the Baseline coordinate. Plot headers and
  PNGs now use that pane's manifest coordinate, including older v1 responses
  without the newly optional option-coordinate metadata.
- Old slice-cache entries/copies could accumulate and consume the snapshot quota.
  Only current indexed candidates are retained; only generated digest-named
  cache copies are evicted. Original native outputs remain untouched. Damaged
  index roots, missing copies and inconsistent cached metadata rebuild safely.
  Modified snapshot bytes still fail closed with an integrity error.
- Sampling numeric contracts reject booleans/text rather than coercing them.
  Reading parsed snapshot data is protected against concurrent cache pruning.
- A completed mesh could be captured as a baseline flow-run reference. Only a
  current-input, completed `run` operation with a valid UUID is now eligible.
- Readiness responses additionally verify the checked source/configuration
  hashes. Refresh clears the previous verdict immediately; an unsuccessful
  retry cannot leave an earlier success visible. Errors are scoped to the
  current study/revision, and leaving the tab cancels its request.
- Swept vent-footprint clearance now uses exact polygon coverage and boundary
  distance, avoiding the inscribed circular-buffer approximation at corners.
- The analytical normalized-flux derivative is algebraically rescaled to avoid
  area-squared overflow/underflow. Regression covers common area factors from
  `1e-200` to `1e200`; the normalization derivative is retained.
- Restoring slice defaults returns independent objects, and impossible saved
  single-run Option/Delta focus is normalized to the visible layout.

Refactoring removes the duplicated bounded-response readers in favour of one
streaming limiter that cancels oversized streams and releases its reader lock.
Also removed a duplicate effect, an unused manifest domain entry and an unstyled
comparison-mode class. No unrelated geometry or visual code was removed.

## Pass 2 — observable usability and visual consistency

Built the actual production static export and exercised it in isolated headless
Chrome against local fixtures using the real Python reader/preparation service.
External browser requests are blocked by the harness. The user's saved project,
browser and live services were not used for tests.

Checked desktop 1440×1000, laptop 1280×900, tablet 800×1000 and phone 390×900,
including light/dark screenshots and detailed region/error states. Fixed:

- Both features inherit shared control fonts, density, borders and panel radii.
  Navigation/execution actions use equal-width responsive grids; plot footer
  actions have equal width and height, and paired canvases align vertically.
- Long pane headings have a bounded height and a full-title tooltip/accessibility
  label, instead of misaligning the comparison plots.
- Phone screenshot inspection found axis numbers overlapping the coloured plot.
  A reserved lower margin and right-aligned outer Y ticks keep coordinate labels
  outside the contours; this last display-only change receives a separate rerun.
- Validation errors are visible beside the current form in a sticky alert; rejected
  numeric edits explicitly say they were not saved. Current physical settings
  are no longer presented as though they were a historical frozen simulation.
- Every slice dropdown has a stable explicit accessible name. The initial new
  regression failed to locate Delta definition because its implicit name included
  all option text; corrected the control rather than weakening the test.
- Selecting a scalar field exits vector-only delta mode. Incompatible Option and
  Delta panes cannot enter point-picking mode, with a visible explanation.
- Plot picking ignores axes/legend clicks. Primary-pointer identity and
  cancellation/lost-capture handling prevent phantom drag gestures.

Tested actual run/axis/time selection, progressive inventory, nearest-plane
warnings, Swap, shared/manual legends, percent/vector modes, linked pan/zoom,
V/Esc, replacement readouts, CSV/JSON/PNG downloads and reload persistence.
Adjoint checks cover capture, selection, bounds, invalid edits, validation,
clone/remove confirmation, failed refresh, request cancellation, exports and
reopening without changing baseline vents or measured rooms.

Local evidence: `.local-logs/cfd-three-pass-qa/`, including
`adjoint-{desktop,tablet,mobile,mobile-dark}.png`, region screenshots,
`adjoint-audit-validation-feedback.png`, `slices-compare-grid.png`,
`slices-{laptop,tablet,mobile,mobile-dark}.png` and the real exported PNG.
These are QA artifacts, not committed application assets.

## Pass 3 — final regression and cleanup

The final corrected export is used for a serial browser sweep, including the
existing native FIELD results, V/Esc point probes, scroll retention, multi-graph
residual selection, thermal handoff, actual vent rehosting and minimize/docking
workflows. No scientific, geometry or alignment assertion was relaxed.

Verified results:

- Complete backend suite: **747 passed**, no skips; retained native result archive
  supplied read-only. `.local-logs/cfd-three-pass-backend-full.log`.
- Frontend: **642 unit + 19 persistence passed**, no skips.
  `.local-logs/cfd-three-pass-unit.log`.
- Local proxy regression: **25 passed**, no skips.
  `.local-logs/cfd-three-pass-proxy.log`.
- Final serial browser sweep: **42 passed**, no failures/skips (394.264 seconds).
  `.local-logs/cfd-three-pass-ui-final.log`.
- The strengthened percent/scalar-field regression also passed separately;
  `.local-logs/cfd-three-pass-percent-focused.log`. It verifies the numerical 20%
  result and waits for the real pressure plot before its phone screenshot.
- Final slice rerun after the axis-margin-only adjustment: **6 passed**, no
  failures/skips (54.608 seconds); updated phone and exported PNG inspected.
  `.local-logs/cfd-three-pass-slices-final.log`.
- Static production build, frontend lint and TypeScript: passed.
  `.local-logs/cfd-three-pass-{build,lint,types}.log`.
- Source-usage check: **465 modules, no orphaned modules**.
- Strict mypy: three audited Python sources passed.
  `.local-logs/cfd-three-pass-mypy.log`.
- Ruff lint/format and whitespace/diff review: passed.

One existing Starlette/httpx deprecation warning remains in the backend suite.
It is not a test failure. Build-generated `next-env.d.ts` changes are restored,
and generated test/build/cache artifacts are excluded.

## Explicit engineering limits

The ordinary native worker still supports steady isothermal SIMPLE U/p. Native
pressure is kinematic `m²/s²`, not Pa. Slice holes/nonfinite/unavailable values
remain masked; no result is inferred from colours or synthesized for absent
physics. Geometry authority remains in millimetres; slice presentation uses SI.

Adjoint controls prepare a configuration only. There is still no validated
fixed-mesh movable-vent boundary law, native adjoint or checkpointed multi-step
optimiser. `canRun` remains false and Run remains disabled. This audit does not
claim native sensitivities, accepted optimisation steps, best designs or solver
convergence that have not occurred.

Online availability still requires a separately authorized coordinated release
of matching components. Nothing from this audit is pushed or deployed.
