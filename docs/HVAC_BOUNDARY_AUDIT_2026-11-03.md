# Heating, Ventilation and Insulation boundary audit

Baseline: `eb1f2e0`. Requested outcome: account for workbench inputs as appropriate
CFD boundary conditions when entering CFD, keep them synchronized and audit error
states. This review covers the source document, derived transport, real Python
geometry provider, prepared patch conditions, surface editor and source round trips.

## Findings and corrections

Radiator power and ventilation controls already reached prepared patches, but UFH
coverage and insulation were mostly handoff metadata. Extract backflow temperature
was dropped. The boundary editor could display an adiabatic group preset instead
of the provider's source condition. Those gaps are corrected.

The shared preparation contract is derived from the authoritative workbenches.
It is removed from saved case copies and rebuilt from current sources. The server
accepts bounded measured paths and source intent, never browser/display meshes.
The deterministic kernel constructs and checks the resulting air skin.

## Boundary accounting

- **Radiators, electric heaters, towel rails and hybrid room emitters:** retain
  the measured object ID and geometry. Heating's room-effective output, or its
  reviewed operating watts, is distributed once over the exposed proxy area.
  Water temperatures are not surface temperatures. Unknown output stays unknown;
  off sources contribute no declared heater power. Conflicting patch/group
  temperatures or fluxes are reported, including manual thermal inputs on an off
  heater. Existing labelled Heating estimates remain planning assumptions.
- **UFH:** use only heated circuit paths and their actual spacing. Union their
  spacing influence bands within each zone, clip them to actual air-facing floor
  geometry, remove exclusions and vent/void apertures, and normalize upward watts
  over that checked area. Manifold supply/return leads do not heat the room twice.
  The band is a uniform-flux planning approximation, not a resolved pipe/solid
  heat-transfer calculation. It never becomes a whole-floor temperature.
- **UFH plus floor insulation:** retain the outward fabric coefficient and
  ambient temperature, with a separate additive `sourceFluxWm2`. The contract is
  `q_into_air = h_out (T_ambient - T_surface) + q_UFH`. Heating watts are conserved
  across the heated parts; unheated parts retain their own fabric condition.
- **Ventilation:** preserve volume, mass, velocity or pressure control and actual
  canonical geometry/free area. Mass conversion uses the selected case/operation
  density. Supply temperature is prescribed; extraction uses zero-gradient
  outflow with the declared temperature on backflow (`inletOutlet`). CO₂ inlet
  and backflow values, turbulence inputs and pressure values are retained.
  Pressure control does not invent a known airflow. Return and outdoor exhaust
  remain distinct in conventional accounting; no automatic air-handler network
  or mixing model is claimed.
- **Insulation:** map selected constructions to actual wall, floor, ceiling/roof,
  door and window surface regions. Layer thickness converts from mm to m once.
  With declared films, `R_total = Rsi + sum(d/lambda or R_layer) + Rse` and
  `h_out = 1 / (R_total - Rsi)`. Rsi is removed once because the air-side condition
  resolves surface-to-air exchange; Rse is not added again. Direct U without
  declared Rsi, stale geometry and missing ground/adjacent temperatures require
  review rather than arbitrary coefficients or Heating fallback values.
- **Open doors/windows/caps:** use air backflow conditions when open; do not apply
  a solid leaf's U-value over an open airflow aperture. Closed leaves can use the
  declared construction. Unknown adjacent-air temperature is visible as missing.
- **Boilers, pipes and manifolds:** inventory is retained and explained. Boiler
  water-circuit ratings and undeclared distribution heat losses are not added as
  extra room heat. Exclusions remove UFH coverage and are not thermal sources.
- **People/equipment/solar zone gains and diffuse infiltration:** retain their
  entered values as unlocated inputs, with zero invented CFD contribution.
  They remain Needs input until an appropriate physical opening, object or
  receiving-surface model exists. Their presence prevents a false complete
  boundary-capture status. ACH targets, required-flow design temperatures and
  calculation duration are design criteria, not independent extra port conditions.

The flux/coefficient/temperature distinction follows the
[OpenFOAM thermal boundary model reference](https://api.openfoam.com/2312/classFoam_1_1externalWallHeatFluxTemperatureFvPatchScalarField.html).
The additive UFH-plus-Robin data is this application's explicit preparation
contract; it is not a claim that an unmodified native OpenFOAM dictionary already
executes the combination. The room-effective radiant/convection approximation
also remains distinct from a resolved surface/zone balance, as described in the
[EnergyPlus inside heat balance reference](https://bigladdersoftware.com/epx/docs/9-5/engineering-reference/inside-heat-balance.html).

## Synchronization and review behavior

- Entering CFD prepares current shared sources without requiring a new handoff.
  Operating values follow the explicitly linked shared operation; independent
  case air settings are preserved until the user chooses that operation.
- Insulation follows the current workbench construction by default. Explicit
  per-case construction choices stay pinned and visible. Opening Thermal no
  longer silently turns the current source choice into a pinned copy.
- Layer/material, operating-power, loop, exclusion and geometry edits invalidate
  the preparation revision. Configuration provenance includes current insulation;
  energy-only edits do not change the measured geometry hash. A layer edit that
  also changes measured wall thickness legitimately changes geometry.
- Stable source/host IDs survive thermal partitioning. Repeated preparation has
  identical geometry and capture data apart from the validation timestamp.
  Original host coordinates remain available for vent placement; displayed heat
  regions never determine authoritative geometry.
- Missing construction choices remain reviewable without substituting another
  scenario or losing valid air geometry. Overlapping UFH zones are rejected
  together; no array-order-dependent power mapping occurs.
- Generated thermal values are shown in the surface editor and cannot be
  accidentally saved as conflicting independent thermal overrides. Source-only
  refreshes do not create modelling undo entries. Real case-air edits remain
  undoable. Historical boundary packages stay unchanged.
- **Shared boundary capture** in Objects/Bounds lists actual mapped watts,
  areas, U-values, outward coefficients, temperatures and unresolved inputs.
  Checked exports include patch conditions. Stale capture is hidden while
  current checks run. The narrow-window Apply action now wraps within the native
  window instead of being clipped in a horizontal footer.

## Final validation

Pass 1 traced authoritative workbench data through derived transport to kernel
patches and checked units, film accounting, power conservation, exclusions,
overlaps, missing values and conflicting controls. Pass 2 checked source edits,
case selection, persistence, stale/failed validation, history, exports and actual
browser controls against the existing UI. The narrow Thermal footer overflow
found in this pass was corrected and its original browser assertion now passes.

- Backend: `uv run pytest` — 808 passed; one optional retained-native-archive
  test skipped because `CFD_NATIVE_ARCHIVE` is not supplied. Existing test-client
  deprecation and pytest-cache permission warnings remain.
- Frontend: `pnpm --dir frontend test` — 717 unit/integration tests and 19
  persistence tests passed. Integration tests call the actual Python provider.
- Browser: 39 passed against the production static build, using the actual UI
  and deterministic Python preparation through the local test harness. These
  comprise 6 new boundary-capture cases, 13 Thermal cases and 20 existing
  CFD/HVAC/synchronization cases. They cover real Insulation layer edits,
  radiator/UFH source and operating round trips, deletion/undo/reload, case
  isolation, delayed/failed preflight, source editor values, unlocated inputs,
  both themes and phone/tablet/desktop controls. No live remote deployment or
  native thermal solve is represented by this harness.
- `pnpm --dir frontend lint` passed, including source-usage checks for 502
  modules with no orphaned modules. Production static build passed.
- Ruff and Python compilation passed for all changed Python files.
  `git diff --check` passed.

Logs are `.local-logs/boundary-{core,bridge,tests,pytest,lint,build,browser,browser-final,browser-regression}.log`.
New regression coverage is in `tests/test_shared_boundaries.py`,
`frontend/tests/sharedBoundaries.test.mts` and
`frontend/tests/browser/sharedBoundaries.browser.mts`.

## Execution boundary

These are checked boundary/preparation conditions. The native worker is still
isothermal; thermal execution is blocked in the UI and submission boundary,
including detached transport/custom adapters advertising run capability.
Full conjugate solids, interior radiation and unlocated gain/infiltration mapping
are not claimed. Frontend and preparation service must deploy together for the
new optional shared-source contract. No thermal CFD result or certification is
fabricated from this audit.
