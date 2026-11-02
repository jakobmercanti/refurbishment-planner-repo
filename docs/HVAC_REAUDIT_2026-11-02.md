# HVAC full re-audit — second review of 3524733

The user requested a fresh two-pass audit against
`climoptix_hvac_ventilation_heating_cfd_integration_codex_prompt.txt`, corrections,
native UI consistency and a push to master. All 33 files in the initial change,
their store/serializer/provider dependencies and the legacy Heating import entry
point were reviewed. Unrelated website work and the prior checkpoint are excluded.

## Pass 1 — architecture, engineering and functional reliability

New regression cases first reproduced eight failures. The corrective work then
expanded to connected-room discovery, import recovery and full case provenance.

- Unchanged sibling CFD cases could overwrite a shared edit or restore a deleted
  vent. The command boundary now applies actual per-case deltas against the
  original effective views. Sibling order no longer changes the result.
- New conventional vents and canonical ordering did not appear in an already
  created case. Views now combine explicit references with the seed room and
  kernel-checked connected-room scope, in canonical order. Scope is tied to its
  seed and refreshed by real preparation; doors/windows still stop discovery.
- Case duplication could promote effective flow into baseline design values.
  Copies retain effective operating values as overrides. Conflicting imported
  geometry cannot silently mutate an existing design ID.
  Explicit case/group copies also clone the linked operating scenario, retaining
  heater off/power and vent overrides independently from the original case.
- Deleted case bindings accumulated. Current commands release them; import
  removes only references to missing cases, preserving devices and historical
  packages. Projects that previously cycled through more than 100 cases recover.
- Editing defaults in a second untouched room reused the first room's temporary
  scenario ID. Each room now obtains its own identity before its first save.
- Background validation and derived heater/physics projections could create
  spurious modelling history entries. Domain discovery and selection modes are
  excluded from modelling comparison; actual canonical edits remain undoable.
- A pressure outlet could hide prescribed extraction exceeding known inflow.
  Known extraction is checked independently; missing backflow conditions no
  longer produce a determinate sensible equilibrium.
- Unlinked CFD mass-flow conversion used a hard-coded density. It now uses the
  case density; linked cases use their shared operating density. Pure calculations
  also validate device records before computing outputs.
- Oversized operating overrides could pass import and fail during rendering.
  Frontend/backend now bound them consistently with the CFD vent contract.
- Boundary packages now explicitly retain all vent parameters, pressure values,
  free/outdoor area information, checked position/normal/patch provenance,
  turbulence and signed outward normal velocity. They also retain effective case
  physics, patch overrides, mesh settings and thermal application intent. A patch
  or mesh edit invalidates the package; raw and derived case views hash equally.
- The generic 100,000-character text limit prevented larger device snapshots.
  HVAC snapshot text alone now has a validated 1.5-million-character bound and an
  8 MB total project guard. Other project text limits are unchanged. Large
  packages remain independently downloadable when a history cannot be stored.
- Room changes during asynchronous preflight could publish the previous room's
  case. Requests are aborted and the handoff stamp includes room, floor and
  operating selection as well as project data.
- A legacy import dialog still allowed whole-floor UFH temperature substitution
  and conflicting manual radiator temperatures. Shared cases now reuse the shared
  operation controls through that entry point. The legacy floor substitution is
  disabled and rejected at its command boundary, including mixed selections.

## Pass 2 — native appearance, interaction and visual regression

The production export was rendered at 1440×1000, 820×1180 (dark) and 390×844.
Screenshots with long device names are in `.local-logs/hvac-reaudit-qa/`.

- Ventilation now uses the original panel grid and spacing throughout; adjacent
  sections no longer touch. Field fonts, foreground/background, padding and
  corner radii are asserted equal to actual Heating inputs in each viewport.
- Room/scenario selectors and Undo/Redo/Check use the existing compact two-/
  three-column patterns, improving phone access to the actual device actions.
- Selected top tabs have a theme-token underline in addition to native selection
  styling. Keyboard focus, Left/Right/Home/End, wrapping and page overflow are
  checked. No new colours, fonts or independent design system were introduced.
- Return/exhaust is editable as an explicit air-path choice. Operating quantity
  labels use HVAC terms and actual units, including pressure, instead of internal
  identifiers or a generic SI label. Validation displays concise messages rather
  than serialized schema internals. Source model labels are human-readable.
- Checked face previews are invalidated after measured geometry changes. They
  remain reusable across ordinary workbench switches. Source links select the
  actual room/floor and linked operating scenario before opening the workbench.
- The conventional measured-host plan now supports dragging, one committed undo
  step, pointer cancellation and Escape. Concurrent source changes refuse the
  stale drag. Wall height is retained; cutout/overlap decisions remain with the
  deterministic preparation kernel, never the SVG preview.
- Existing Heating, insulation data, pipe/UFH editing, exports, native windows,
  docking and CFD picking/dragging are covered by the final regression matrix.
- The portable-report browser test started its download timeout before navigating
  to Export. It now waits at the actual export click and retains its file-content
  assertion. The new copy test also opens the real row Actions menu before
  selecting Duplicate; no production control was changed to accommodate a test.

## Prompt acceptance ledger

1–4. Shared add/edit/inverse edit/position: `hvacDocument.ts`, `HvacVentPlan.tsx`,
`VentilationPanel.tsx`, `ClimoptixWorkspace.tsx`. The new browser cases exercise
additions in existing cases, inverse CFD additions, return changes and plan drag.

5–8. Identity, deletion, order, undo, operating overrides, rooms/floors and legacy
reconciliation: the multi-case, case-copy, scope, dead-binding, snapshot and
room-default cases in `hvacReaudit.test.mts` and `hvacReaudit.browser.mts`, plus
the existing `hvac.test.mts` migration and persistence cases.

9–16. ACH, signed sensible gain, required flow, equilibrium, outdoor/recirculated
separation, invalid inputs, units and no double-counting: existing numerical
reference cases plus the new pressure-deficit and density regression cases.
The source engine remains pure and independent of a CFD connection.

17–18. Radiator geometry/rating authority remains the placed Heating object.
Room-effective watts/off overrides use the shared operation. Existing real Python
1000 W mapping and browser inverse-operation cases remain in the regression set.

19–21. UFH zone/loop/exclusion/coverage identity and source watts are exported and
visualized without replacing them with a whole-floor condition. Kernel room/floor
membership controls domain labels. **Capability limit:** partial heated-floor
face-flux execution is not implemented in the native isothermal worker.

22–23. Real preflight, selected-room provenance, complete boundary manifest and
immutable historical packages: inverse-navigation, delayed-preflight, boundary/
mesh invalidation and raw/derived hash-equivalence cases.

24. Missing thermal execution is labelled and blocked in the run UI and worker
submission boundary, including custom adapters advertising run capability.

25–27. Pressure flow remains unknown; signed normal velocity and density are
explicit where prescribed. Existing deterministic host/cutout/mesh and
door/window/permanent-opening checks are retained. Native CFD 3D drag cases
remain part of the executed regression set.

28–30. Native-style equality, long names, dark mode, phone/tablet layout, tab
focus, new controls, validation, cancellation and source navigation are exercised
in the rendered browser suites and inspected screenshots.

31. Full backend/frontend unit and persistence suites, production/TypeScript,
lint/source-usage, targeted Ruff, Heating/CFD and shared-window regressions.

## Validation evidence

- `uv run pytest`: **784 passed, 1 optional native-archive test skipped**.
  The two warnings concern the existing FastAPI startup deprecation and local
  pytest cache permissions.
- `pnpm --dir frontend test`: **699 unit tests and 19 persistence tests passed**.
- Focused HVAC/legacy-import regression set: **35 passed**.
- Production static export with `/planner` base path and TypeScript checking:
  **passed**. `pnpm --dir frontend lint`, source-usage checks, targeted Ruff and
  `git diff --check`: **passed**.
- Broad production-browser matrix: **55 of 56 passed**. The only failure was the
  new test's missing row-menu click described above. After correcting that test,
  the complete nine-case re-audit browser suite passed **9 of 9**, including
  independent heater-off copying and all three visual viewports. Every distinct
  case in the 56-case matrix has a passing execution against the final production
  code. The matrix covers HVAC, Heating, CFD, UI consistency and native windows/
  docking; no native thermal solver execution is claimed.

Logs are `.local-logs/hvac-reaudit-{core,tests,lint,build,browser,browser-final}.log`
and `.local-logs/hvac-pytest.log`. The screenshots were visually inspected in
addition to the computed-style and overflow assertions.

## Remaining supported boundary

This audit does not claim a native thermal solve. The existing worker is
isothermal; partial UFH face-flux mapping and located gain/infiltration/envelope
energy execution need a compatible adapter. Their inputs and assumptions are
reviewable/exportable and execution is blocked. Conventional room volume retains
the explicitly labelled Heating prism approximation. No local comfort, humidity,
fan-energy or regulatory-compliance result is fabricated.
