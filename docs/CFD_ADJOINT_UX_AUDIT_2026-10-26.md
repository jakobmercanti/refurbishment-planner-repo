# Pass two: separate interaction and visual audit

## Scope and method

Actual production static export, isolated headless Chrome, real deterministic Python geometry/preparation behind the local test route. External browser traffic is blocked. Test accounts are harness-only fixtures, not a production bypass. This is a distinct UX pass by the implementing agent, not an independent external review. No simulation was submitted and no production service, account, token or deployment was changed.

## Observable workflows checked

- Open **Adjoint Optimisation** through the existing main-window tab or narrow-window Phase selector. The main floorplan/3D viewer is not forked.
- Capture a current setup, select an existing port marker through the established selection handler, enable movement, enter bounds and a positive accepted-step count, validate against actual authoritative geometry, export real configuration JSON and reopen the saved project.
- Fixed ports and measured rooms/vents compare exactly before and after configuration actions. Capturing/editing a study does not translate or clone any physical vent.
- Empty/no-port state, no selected movable port, infeasible swept footprint, invalid zero-step input, baseline changes, API failure, clone/remove confirmation and Escape cancellation have specific tested outcomes.
- Run remains disabled with a visible reason and `aria-describedby`; no fabricated objective, history, best layout or pause/resume controls are provided.
- A pending validation is cancelled on leaving the tab; reopening allows a fresh validation and a delayed obsolete response cannot display a readiness result.
- JSON explicitly labels preparation/execution unavailable and has an empty iteration array. CSV contains configuration values and units, not fictitious solver history.
- Desktop 1440×1000, tablet 800×1000 and phone 390×900 checked; no horizontal panel overflow. Narrow layouts use the shared Phase selector, wrapping action rows and single-column engineering inputs. Both light and dark states captured.
- Baseline result, mesh setup, Objects and Boundary Conditions navigation use existing phases. Full optimisation history, running/paused states, sensitivity overlays, ghosts, apply-best and real baseline-vs-best cannot be walked through because their backend stages are not implemented. They are explicitly unavailable, not claimed as UI-audited functionality.

## Issues fixed and retested

1. Reading request refs during render violated the installed React hook rules. Replaced render-time ref access with request-key/signal state; final lint/type checks pass.
2. Aborting on tab exit could leave a stale busy key on return. The busy state now includes the actual aborted signal; delayed-response/navigation regression verifies recovery.
3. Captured dimensions/coordinates initially followed current geometry. Frozen baseline snapshots now preserve the historical footprint/frame, while selection is clearly labelled as the current baseline viewer marker.
4. The browser invalidation test tried editing a disabled X sampling count. Corrected the reproduction to enable its YZ slice stack first, then edit the count. The real UI setting change invalidates the old configuration.
5. JSON persistence normalizes numeric −0 to 0. Corrected the roundtrip test to compare the canonical JSON representation rather than treating the sign of zero in a tangent axis as a geometry change.

## Evidence

Local screenshots in `.local-logs/cfd-results-qa/`:

- `adjoint-desktop.png`, `adjoint-tablet.png`, `adjoint-mobile.png`, `adjoint-mobile-dark.png`.
- `adjoint-regions-desktop.png`, `adjoint-regions-tablet.png`, `adjoint-regions-mobile.png` show the actual bounds controls.

Screenshots are local QA evidence, not committed user-project assets. The gate notice, existing tab style, readable hashes, adaptive action rows, native dropdowns and non-overflowing window were visually inspected. No claim of native CFD success is made from a screenshot.

## Regression evidence and release boundary

The final serial sweep passed **40/40 browser tests with no skips** in 387.735 seconds. Five cases cover the new tab. Full frontend suites passed 640 unit and 19 persistence tests; backend regression passed 219 tests including read-only retained native output; the matching proxy suite passed 21 tests. Build, lint and types passed. After adding more detailed responsive region screenshots, the five new-tab cases were rerun separately; see `adjoint-browser-focused.log`.

The browser sweep includes the new preparation cases and the existing `cfdSlices`, `cfdPointProbe`, `cfdResults`, `cfdFollowup`, `cfdSurfacePresentation` and `windowControls` suites, run serially against the production export. These cover V/Esc real-value picking, readout replacement, 2D comparisons, real native FIELD planes, residual multi-graph selection, thermal handoff, scroll retention, minimising/docking and actual inlet/outlet rehosting across walls/floor/ceiling.

Numerical/backend and full unit/persistence results are listed in the mathematical audit and local logs. The native ZIP tests read a retained ordinary solve; no new native or cloud optimisation job was run.

Everything is local-only. A future authorised online release of even this preparation stage needs the matching frontend, public API and planner proxy; the worker capability change advertises its unavailability and does not enable a runner. The unverified native engineering stages must be completed before any Run control is enabled.
