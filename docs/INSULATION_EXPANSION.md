# Insulation expansion implementation record

Source brief: `New Features/insulation_expansion.txt` on the user's Google Drive,
file ID `1qd2fygqvt_Zxv3VD7nf5kDIB_gx3Sc84`, read 21 October 2026.

## Stage 0 — architecture discovery

- Construction source of truth is the **per-floor** `EnergyProject` in
  `frontend/lib/energyDocument.ts`. `scenarioAssignments` and
  `calculateAssemblyUValue` in `energyCalculations.ts` resolve existing/retrofit
  assignments. Retained Heating estimates explicitly include unknown films and
  must not be promoted to verified layer constructions.
- Existing source editing uses `EnergyLayoutPanel` / `WallLayersEditor`, owned
  by `FullFloorplanEditor` and `EnergyLayoutProvider`. The implementation will
  reuse these editors, preserve their draft/Cancel/Done behaviour and provide a
  return path, not create another layer editor.
- The canonical multi-floor room/roof model is `buildingDocument.ts` and
  `geometry/climoptix_domain.py`. `discover_domain` and `boundary_faces` already
  enforce door/window stops, real passages/voids and piecewise roof planes.
  Their analytic millimetre faces, not display geometry or Heating footprint
  areas, will drive the thermal ledger.
- Climoptix boundaries are `ClimoptixWorkspace` → `BoundariesPanel`. Shared
  viewer is `ClimoptixViewer`, with source X/Y/Z to scene conversion only at
  its rendering boundary. Thermal colouring will remain presentation-only.
- Project persistence/history is `useLocalProject` / `projectDocument.ts`;
  version-1 CFD studies are validated by Zod and Pydantic. Optional thermal
  settings/snapshots must leave old projects readable and source geometry intact.
- Existing preparation requests intentionally strip service/insulation data.
  The thermal endpoint therefore needs an explicitly bounded, validated
  insulation payload, and independent geometry/construction/configuration hashes.
- FastAPI integration is `backend/app/climoptix_api.py`; real deterministic
  preparation is `PreparationOnlyProvider`. OpenFOAM is **not connected**.
  Thermal Apply/export must not manufacture a run or silently produce an
  executable energy case from the current settings-only adapter.
- Verification uses `uv run pytest`, frontend unit/persistence suites,
  production static export and the existing Playwright browser harness. It can
  exercise actual local Python calculations behind intercepted transport.

## Planned stages and engineering boundary

1. Strict optional thermal contracts and analytic envelope/assembly mapping.
2. Existing-style, six-step Thermal Envelope & Solar Conditions window and
   source-editor round trip, with no duplicated construction state.
3. Validated timezone/weather, pvlib NREL SPA solar position/isotropic tilted
   irradiance, explicit no-HVAC lumped balance and contribution ledger.
4. Versioned non-executed Robin/fixed-flux package, immutable applied snapshots,
   stale detection, JSON/CSV and thermal handoff alongside existing settings.
5. Existing 2D/3D overlays, source/provenance warnings and responsive help.
6. Independent engineering and rendered-UI audit passes, recorded below with
   actual test results and explicit unsupported physics.

No location/weather is fetched implicitly. Unknown properties stay unknown.
Indoor film resistance is subtracted exactly once for a Robin handoff; an
unknown film split blocks that method instead of assuming one. Solar transmitted
through glazing is a distinct, labelled lumped source, not glass convection.
Full ray shading, latent heat, transient storage and actual CFD execution remain
outside the brief's supported screening model.

## Implemented integration

Entry: **Climoptix → Boundaries → Thermal Envelope & Solar Conditions**.
The six-step floating window uses the existing window chrome, help, design
tokens and project history. It is not a separate application or layer editor.

- `geometry/thermal_models.py`: strict version-1 settings, surface records,
  sources, preview, boundary contract and historical snapshot types.
- `geometry/thermal_envelope.py`: read-only per-floor construction import,
  source-signature reconciliation and exact prepared-kernel face splitting.
  Known selected-zone contacts, passage reveals and slab-void reveals are
  inapplicable to exterior heat loss. Inactive-floor constructions are included.
  Original insulation values are retained separately from effective CFD overrides.
- `geometry/thermal_solar.py`: offline pvlib 0.16.1 NREL SPA, local/IANA or
  fixed-standard-time resolution, explicit DST ambiguity handling and isotropic
  direct/sky/ground transposition. The small sun-position cache is bounded to 64.
- `geometry/thermal_epw.py`: bounded local CSV import, 8784 hourly rows maximum,
  invalid/missing/duplicate-row reporting, header validation and file SHA-256.
- `geometry/thermal_balance.py`: deterministic sensible balance, explicit
  ventilation/gains, source/geometry/configuration hashing, validation and
  non-executed Robin/fixed-flux/temperature/adiabatic projection.
- `backend/app/climoptix_api.py`: stateless, typed `/thermal-envelope` and
  `/thermal-preview`; bounded `/thermal-epw`. Source projects are independently
  validated and prepared; clients cannot supply trusted areas or reports.
- `backend/app/climoptix_foamlib.py`: optional fresh thermal contract in the
  settings ZIP. Manifest readiness is explicit; no executable `0/T` is generated.
- `frontend/lib/thermalDocument.ts` and `thermalClient.ts`: bounded Zod contracts,
  checked study/revision responses, local upload and safe CSV generation.
- `frontend/components/ThermalEnvelopeWindow.tsx`, `ThermalFields.tsx` and
  `frontend/app/thermal.css`: six steps, original-source/effective-value inspector,
  overrides/reset/acknowledgement, explicit assumptions, gains, review breakdown,
  JSON/CSV and applied-history exports. Calculate is explicit, not per-keystroke.
- `ClimoptixWorkspace.tsx`, `ClimoptixViewer.tsx`, `climoptix.ts` and
  `climoptixDocument.ts`: shared 2D/3D overlays, source staleness, scoped requests,
  history Apply and the existing study/document lifecycle.
- `planner-client.tsx`, `EnergyLayoutContext.tsx`, `FullFloorplanEditor.tsx`:
  source-floor/surface/scenario navigation and Return to Climoptix, including
  segmented-wall selection. The original layer editor still owns Cancel/Done.
- `EnergyLayoutPanel.tsx` and its CSS: a source Openings tab for whole-element
  door/window U and glazing g. It does not misrepresent glazing/frame systems
  as serial wall layers or introduce a duplicate editor.
- `geometry/climoptix_models.py`, `pyproject.toml` and `uv.lock`: optional CFD
  thermal fields and pinned solar/runtime dependencies.

## Contracts, persistence and units

Existing project and CFD study versions remain 1. Thermal settings and histories
are optional, so projects without the feature remain readable and do not acquire
empty history properties. Duplicating a study copies its intentions, not another
study's applied history. IndexedDB, portable packages and project Undo/Redo keep
using their existing validation/history boundary.

`thermalEnvelope` stores user choices; `thermalSnapshots` retains at most three
immutable applied contracts. Replacing a fourth distinct contract requires
confirmation; removal is explicit and undoable. Apply checks the existing 8 MB
project limit. Histories are excluded from request/configuration hashes and are
never trusted as server calculation input. Geometry, insulation, weather, time,
north, sources, BCs and selected-domain changes invalidate current readiness.

The preparation/thermal request remains bounded to 4 MB. Only the thermal-enabled
request includes insulation; quotations, other studies and irrelevant service
layouts are not transmitted. The backend independently derives geometry and
construction/configuration hashes. Overrides that no longer map are errors, not
silently ignored inputs. Changed source assemblies require renewed acknowledgement.

Coordinates and face vertices stay in **mm**, area in m², conductance in W/K,
flux in W/m², power in W, airflow in m³/s or kg/s. Display temperatures are °C;
handoff temperatures are explicitly K. Scene conversion occurs only inside the
existing Three.js rendering boundary. North is the clockwise true-north bearing
of plan +Y; the SVG plan's downward +Y is accounted for by its compass.

Apply stores the durable solver-agnostic package, preserving geometry and all
existing flow/scalar settings. Conflicting active legacy envelope thermal BCs,
unknown pressure/opening enthalpy, unbalanced devices, unknown films or an
incompatible energy mode block handoff readiness. Switching to steady buoyant
physics is an explicit user action and preserves the other physics controls.

## Physics and supported approximations

The preview solves `H = Σ(U A) + ρ cp Vdot` and
`Ti = [Σ(Hs Teq,s) + Hv Tsupply + Qinternal + Qtransmitted + Qforced] / H`.
It reports the individual terms and a recomputed residual. Zero heat-removal
conductance is indeterminate even if the net source is zero; no finite result is
fabricated. Missing or Heating-estimated U cannot silently become verified input.

Opaque forcing uses `Teq = Tambient + (α I − qLW) / hout`; `qLW` is explicitly
entered, not inferred from emissivity. Glazing transmission is counted once as
`A g I × multiplier` and handed off as a separate labelled lumped sensible source.
Solar/radiant gains are **not** also applied as glass convection. Source sensible,
operating and count fractions are explicit. Linked HVAC output is off in the
no-HVAC scenario; recirculated HVAC is not treated as fresh-air heat exchange.

Robin uses `Routward = Rtotal − Rsi` once. Entered overall U does not establish a
film split. Explicit film changes to a known layer construction update its total
resistance; declaring films inside an entered overall U does not add them twice.
Sol-air h affects equivalent forcing only; it does not add another exterior
resistance. A discrepancy with the declared Rse is reported for engineering review.
Forced inner-surface temperatures need a declared positive Rsi for screening.
Fixed-flux projection states its indoor reference and does not promise feedback
as CFD air temperature changes. Equivalent forcing and equilibrium are bounded
to the supported −100–200 °C screening range.

The package's `internalSources` is the complete thermal source list for this
screening/handoff, not an instruction to add the legacy object powers again.
`includeCFDSources` explicitly imports those powers into that list. A future
worker must replace its thermal source inputs with this list, while preserving
unrelated flow/scalar controls. Source-only heat and repeated heat counts have
explicit geometry/source warnings; source count does not duplicate obstructions.

EPW hourly radiation is an **hourly mean** evaluated at the interval midpoint:
EPW hour 1/minute 60 becomes 00:30 at the file's fixed local standard offset,
without DST. Hourly GHI is retained for reflection, not forced through an
instantaneous DNI/DHI identity. Manual instantaneous inputs have a 5% or 10 W/m²
consistency check. Retiming EPW forcing with manual timezone rules is flagged.
Invalid sentinels (including dry-bulb 99.9), invalid rows and unsupported
sub-hourly data are not silently interpolated. Reimport is needed to choose a
different hour after closing the upload session; the chosen record is persisted.

The explicit assumptions include air density/cp, reference temperature, solar
multiplier, zero longwave correction and residual tolerance. No latitude,
weather, U, infiltration, absorptance or albedo is supplied silently. Preset
names do not imply UK weather, a hemisphere or regulatory design-day validity.

References: [pvlib solar position](https://pvlib-python.readthedocs.io/en/stable/reference/generated/pvlib.solarposition.get_solarposition.html),
[pvlib tilted irradiation](https://pvlib-python.readthedocs.io/en/stable/reference/generated/pvlib.irradiance.get_total_irradiance.html),
[OpenCFD v2312 thermal BC catalogue](https://doc.openfoam.com/2312/tools/processing/boundary-conditions/rtm/derived/thermal/).
The pinned adapter is a **contract stub**, not a claimed verified implementation
of an OpenFOAM temperature dictionary.

## Pass 1 — engineering and completeness audit

The completed data path was reviewed independently of its presentation, using
analytical offline fixtures and real kernel/API outputs. Corrections included:

- passage/slab reveals misclassified as exterior walls, including a passage
  source-ID parsing crash;
- inter-storey contacts, setbacks and vertical stepped-roof classification;
- flat ceilings below pitched roofs now require an explicit attic-temperature
  approximation rather than receiving direct roof solar;
- original insulation and effective overrides now remain distinguishable;
- deleting a selected retrofit scenario no longer silently falls back to
  Existing Building; the user must choose an available source scenario;
- inside/outside film overrides update layer-based total R without double films;
- stale segment signatures now use the same segmentation and numeric tolerance
  as the source Insulation editor; unavailable overrides cannot be ignored;
- device mass-flow conversion, air-property agreement and sensible gain fractions;
- separately deposited glazing solar, legacy thermal BC conflicts, and
  unsupported pressure/recirculation paths;
- extreme sol-air forcing, EPW missing sentinels and hourly-mean time semantics;
- history-free revision hashing, legacy duplication serialization and scoped
  asynchronous-result rejection.

Requirement-to-code/test coverage (test names are in
`tests/test_thermal_expansion.py` unless another path is stated):

- Brief §1 / §8 native workflow: `ThermalEnvelopeWindow`, `ClimoptixWorkspace`,
  `ThermalFields`; `frontend/tests/browser/thermal.browser.mts` exercises the
  entry, six steps, Calculate/Apply, source editing, overrides, help and exports.
- §2 canonical envelope and source data: `thermal_envelope`, `climoptix_domain`,
  `thermal_models`; fixtures 06, 07/17, 09/10, 11, 16/18, plus segmented-wall,
  roof, library-revision and double-height tests.
- §3 / §4 sun, north, weather and time: `thermal_solar`, `thermal_epw`;
  fixtures 04/05 and 14, `test_unknown_epw_sentinels_and_hourly_mean_solar_are_explicit`,
  `test_extreme_sol_air_forcing_never_exports_nonphysical_kelvin`.
- §5 balance, gains and exchange: `thermal_balance`; fixtures 01, 02/03, 08,
  12, `test_airflow_ach_and_units_balance`,
  `test_device_mass_flow_source_gains_and_api_import_validation`.
- §6 film/BC/adapter separation: `thermal_balance`, `climoptix_foamlib`;
  `test_robin_resistance_and_absolute_temperature_units`, fixture 12,
  `test_pinned_adapter_exports_thermal_contract_but_no_temperature_dictionary`,
  `test_unmapped_override_and_conflicting_legacy_bc_block_handoff`.
- §7 overrides and assumptions: `thermal_models`, `thermal_envelope`,
  `ThermalFields`; fixtures 09/10 and 12, override/library test, browser missing
  input/invalid count/service-error workflow.
- §9 persistence, backwards compatibility and performance: `climoptixDocument`,
  `climoptix`, `thermalClient`, existing `useLocalProject`; fixtures 13/15 and 16/18,
  `frontend/tests/thermal.test.ts`, existing `climoptix.integration.mts`, plus
  `test_double_height_and_realistic_connected_domain_without_reusing_footprint_areas`.
- §10 acceptance 1 → fixture 01; 2–3 → 02/03; 4–5 → 04/05; 6 → 06 plus roof,
  multi-floor and double-height fixtures; 7/17 → 07/17; 8 → 08; 9–10 → 09/10
  plus the browser source-editor flow; 11 → 11 plus existing CFD angle coverage;
  12 → 12 with a positive load; 13/15 → snapshot/hash and frontend persistence
  tests; 14 → DST/EPW/range tests; 16/18 → real API/adapter and missing-U fixtures.

The eight-room, 76-face analytic fixture measured **0.309 s** on this machine
after library imports; this is an observed sample, not a general performance
guarantee or CFD mesh benchmark. Expensive geometry is requested explicitly.

## Pass 2 — rendered UI and production audit

Real production Chrome, real local Python thermal calculations behind intercepted
transport, no synthetic solver results. The full 64-browser-test regression passed.
Thermal screenshots cover Default and Modern styles, Light and Dark preferences,
1440×1000 desktop, 900×1000 tablet and 390×844 mobile. Every step was checked for
horizontal overflow and a reachable sticky footer. The Modern window was dragged
and resized using its actual shared window controls.

Functional checks include JSON and CSV downloads, immutable history, reload,
source-editor Cancel and a real 100→120 mm layer edit/return, reset-to-source,
stale readiness, integer validation, malformed EPW and unavailable service states.
Help uses the real shared help window, keyboard Escape and focus return, not an
invented modal. Existing Floorplan/PlannerBuild/account, roof, openings, people,
heating, library, VTK and CFD workflows are exercised by the regression suite.

Screenshot review identified and corrected active-step colour transitions with
temporarily poor Modern contrast, wide-window Back/Next stacking, oversized
scaled SVG chart labels, and negative-zero presentation. The breakdown now uses
responsive native bars with fixed-size readable text; rounded zero is displayed
as zero while JSON retains the full residual. An explicit ≥4.5:1 active-step
contrast assertion was added. Final post-polish receipts are recorded below.

Local screenshots/logs are in the ignored `.local-logs/` directory, including
`thermal-{default,modern}-{light,dark}-{1440,900,390}.png`.

## Follow-up audit — 21 October 2026

Two new passes were requested after the initial implementation. This was not
just a rerun of its original happy-path tests.

### Pass A — input integrity and asynchronous workflows

New browser reproductions initially failed on three independent paths:

- An invalid gain count of `1.5` could run a calculation using the previously
  saved count of `1`. `ThermalEnvelopeWindow` now validates numeric drafts before
  navigation, refresh, surface changes, source editing, calculation and Apply.
  Invalid inputs remain visible and receive focus; closed containing details
  reopen. `ThermalFields` declares required numeric fields and associates error
  text with its input. Escape explicitly restores the saved value.
- An EPW upload completed after a north-bearing edit of `70°`, restoring the
  older `0°` study snapshot. Import now merges its intentional location/weather
  changes into the latest study. Newer unrelated choices are preserved.
- A manually resized desktop window of about 450 px overflowed its envelope
  inspector. Internal container queries now respond to the actual window width,
  not only the device viewport, without duplicating a mobile-only layout.

A fourth reproduction switched studies while a calculation was in flight: a
late 503 error from the first study appeared in the second. `ClimoptixWorkspace`
now scopes thermal loading and error state to the initiating study. The second
study remains usable and does not receive the first study's failure.

A further ordinary-keyboard check found that clearing a required gain name to
replace it immediately reinserted its old value. Required gain names now retain a
local draft until Enter/Tab, explain blank entries inline and support Escape to
restore the saved name. Optional search/text fields still update immediately.

`thermalClient` now turns incompatible successful responses into concise recovery
instructions rather than displaying raw schema diagnostics. Imported EPW response
values are range-checked before they can become project settings. A frontend unit
test covers malformed thermal/EPW responses, impossible weather and server errors.

### Pass B — usability, language and rendered layout

- Review no longer presents an uncalculated/default conductance as `0 W/K`, or
  appends units to an unknown result. Unavailable outputs are explicit, alongside
  the validation instructions; successful Apply has feedback inside the window.
- Surface names are human-readable and walls are numbered from 1. Full source,
  surface and patch identities remain available in the inspector and exports.
  Internal reveals say they have no external exchange rather than implying a
  missing exterior U-value, and follow useful envelope faces in the list. Search
  matches both readable names and stable IDs. Construction source labels no
  longer expose camelCase implementation names.
- The setup compass now uses the same downward plan +Y and bearing rotation as
  the actual 2D viewer; the axis convention is labelled. Geometry is unchanged.
- Gains have consistent card spacing and named regions, a shorter power label
  and a visible explanation of the applied count/fraction calculation. Boundary
  ambient-temperature wording includes the outdoor override use case.
- Help explains Enter/Tab, optional blanks and Escape accurately. Source-editor
  scenario help now refers to construction changes, not only walls; empty-opening
  grammar is corrected.
- Footer buttons stretch consistently when a label wraps. The existing Modern
  theme recognises `cfx-primary` and `cfx-danger` through the same shared palette
  contract used elsewhere, restoring clear primary/destructive affordances in
  Climoptix and the thermal window without adding a competing theme.

New regression paths in `frontend/tests/browser/thermal.browser.mts` are prefixed
`audit:`: invalid drafts/closed details, uncalculated outputs/compass agreement,
gain-name replacement, cross-study errors, delayed EPW edits and manually
narrowed desktop windows, plus a door-performance source-editor round trip.
Screenshots now include every step at desktop/mobile sizes in both actual styles
and both themes, plus the narrowed desktop case. Existing workbench checks cover
roof windows, floors, wall modes, catalogue/CFD previews, people, heating,
insulation source editing, account navigation, VTK and simulation setup.

The requested Bugbot skill was inspected, but this session does not expose its
required Bugbot runner. No Bugbot findings or automated reviewer completion are
claimed; the two manual audit passes and executable tests are the evidence.

### Follow-up validation receipts

- Full backend rerun: **616 passed**, including all 30 thermal fixtures; the
  existing Starlette/httpx deprecation warning remains.
- Final `pnpm test`: **550 unit + 19 persistence tests passed**.
- Clean final `pnpm test:browser`: **71 passed, 0 failed**, across 12 production
  browser files, in 480.7 s. This includes all 12 thermal browser workflows and
  the seven new `audit:` paths. Receipt: `.local-logs/thermal-audit-browser-final.log`.
- Final production build, including TypeScript and nine static pages: passed.
  Receipt: `.local-logs/thermal-audit-build.log`.
- Final `pnpm lint`: passed; 356 source modules, no orphans. Touched-backend Ruff
  and `git diff --check` passed as well.
- The screenshot matrix asserts active-step contrast ≥4.5:1, aligned footer
  button heights, primary-action distinction, bounded scrolling and reachable
  actions. Final desktop/mobile screenshots and the required-name error state
  were visually inspected, alongside representative roof/catalogue/CFD screens.

Audit runs deliberately reproduced the defects before their fixes. Two new-test
assertions were also corrected: a scoped locator and an assertion comparing empty
appearance-metadata hydration rather than physical opening geometry. Physical
dimensions, topology, representation IDs and study identity remain asserted; no
checks were skipped. The subsequent clean full run above is the final receipt.

At audit completion these changes were local on `cfd`, not committed, pushed or
deployed. The user's subsequent “Commit and push” request authorizes publishing
the audited implementation on that branch. No actual CFD solver run was possible
or claimed; the preparation/export-only boundary remains.

## Initial implementation validation receipts

- Full backend: `uv run --extra cfd --no-sync --python .venv/Scripts/python.exe
  pytest -q -p no:cacheprovider` — **616 passed**. One pre-existing Starlette/httpx
  deprecation warning; no test failures.
- Targeted thermal engineering/API/contracts: **30 fixtures** included in that
  passing backend suite, including separate original-source versus effective-
  override assertions, removed-scenario validation and source-only occupant
  gain/obstruction warnings.
- `pnpm test` — **549 unit + 19 persistence tests passed**.
- `pnpm test:browser` — **64 passed**, 12 production browser test files.
- Production static `pnpm build` with `PLANNER_STATIC_EXPORT=true` and
  `NEXT_PUBLIC_BASE_PATH=/planner` — passed, including TypeScript and nine pages.
- `pnpm lint` — passed; 356 source modules, no orphaned modules.
- Targeted backend Ruff checks and `git diff --check` — passed.
- Final post-polish thermal browser/contrast rerun: **5 passed**. Default and
  Modern active steps satisfy the explicit ≥4.5:1 contrast assertion at all
  three viewports in Light and Dark; original-source displays and effective
  overrides remain separately traceable.

Windows sandbox permissions initially prevented temporary test SQLite access
and a generated Next chunk directory. The same commands succeeded with the
approved test/build execution permissions. These were not bypassed or reported
as successful runs before retrying. No existing user data was deleted.

## Explicit limitations and remaining integration work

- **Integration / out of scope:** no OpenFOAM mesher, solver, job service or
  executable temperature adapter is connected. Packages are review/export
  contracts, `runnable=false`, `executed=false`; there was no CFD run.
- **Model fidelity:** single well-mixed sensible-only instant; no transient mass,
  annual/peak prediction, latent heat, thermal bridges, conjugate solids,
  inter-surface radiation, regulatory certification or geometric shadow casting.
- **Ground/attic:** explicit planar U*A temperature exchange, not a soil field,
  ventilated-attic calculation or a certified ground-floor method. A flat ceiling
  below a pitched roof must use a reviewed adjacent condition.
- **Sources:** solar/radiant heat uses named lumped air deposition, not resolved
  radiation. Pressure-only exchange, unknown film splits for Robin, conflicting
  active thermal BCs and recirculation do not receive invented physics.
- **Weather:** representative labels are not design-day datasets; EPW forcing is
  hourly/midpoint and user uploaded, with no implicit download or interpolation.
- **Verification:** screenshots are headless desktop Chrome with actual responsive
  viewports, not testing on every physical phone/browser or engineering certification.

No known unresolved implementation defect is being concealed as a supported
physical feature. Revalidate on the target deployment after installing the lockfile
dependencies. Publication was authorized separately by the user's subsequent
“Commit and push” request; deployment is not claimed. Pre-existing gitlink and attachment changes
were preserved. Next regenerated its managed declaration during the production
build; no source or project data was discarded.

Risk/next-action classification:

- **Integration gate, intentional:** no runnable energy adapter/worker. Keep Run
  disabled; independently implement and validate the pinned v2312 adapter before
  executing any case. A prepared thermal contract is not a solved case.
- **Medium engineering-use risk:** reduced, user-entered screening assumptions
  cannot establish design/certification accuracy. Compare representative cases
  against measured or resolved references before design use.
- **Low compatibility risk:** the rendered audit covers Chrome's responsive
  viewports, not every physical device/browser. Check the intended deployment
  devices before a broader release.
- **Low tooling debt:** the existing Starlette/httpx deprecation warning remains;
  update that shared test transport in a separate scoped maintenance change.
