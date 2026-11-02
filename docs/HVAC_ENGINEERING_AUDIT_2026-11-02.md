# HVAC audit, pass 1 — architecture, engineering and reliability

This pass reviews the implementation against the New Features integration brief.
The separate UI pass is in `HVAC_UI_AUDIT_2026-11-02.md`. Discovery and source
authority are recorded in `HVAC_INTEGRATION_DISCOVERY.md`; usage and supported
physics are in `HVAC_INTEGRATION.md`.

## Requirement and evidence ledger

1. Acceptance 1–8: `hvacDocument.ts` owns versioned vent designs, scenario
   operations and legacy reconciliation. `commitHvacCFD`, `removeVent` and the
   project setter handle shared edits; no polling or pair of device stores.
   The HVAC unit suite exercises identity, global edit/delete/duplicate,
   project undo/redo, scenario overrides, host-room reassignment, idempotent
   migration and conflicting legacy geometry. The browser suite exercises CRUD,
   filtered room navigation, saved IDs, reload and the full inverse CFD path.
2. Acceptance 9–16: `hvacCalculations.ts` tests 100 m³ / 0.1 m³/s = 3.6 ACH;
   20°C supply / 25°C room = −603 W at ρ=1.2 and cp=1005; 1000 W / 10 K =
   0.0829187 m³/s; opposing/zero driving temperatures; mixed-stream equilibrium
   residual; missing removal paths; unknown pressure flow; fresh/recirculated
   separation; unit round trips; free area; invalid density/cp/geometry; and
   entered people/area rates. Heating/Insulation conductances are reused once.
3. Acceptance 17–21: `hvacBridge.ts` references existing placed radiators and UFH
   zone/circuit IDs. A real Python preparation test checks one 1000 W electric
   radiator remains one 1000 W source. Conventional and CFD operating off states
   propagate without changing ratings. The UFH test checks coverage/circuit
   export and proves no whole-floor thermal condition was inserted. Region
   membership uses checked domain floor/room IDs; out-of-domain entries are
   labelled. Partial UFH face-flux execution is explicitly unsupported.
4. Acceptance 22–27: `VentilationPanel.tsx` builds a real deterministic preflight,
   shows connected-volume differences, retains full operating/device inputs and
   creates a new case. Hash-labelled bounded packages are immutable; changed
   inputs invalidate their current status. `climoptix.ts` resolves canonical
   data for hashing and transport; `climoptixJobs.ts` rejects unconnected HVAC
   thermal runs even for a custom adapter advertising run capability. Existing
   Python domain/surface tests and the HVAC real-provider test preserve the
   permanent-opening/door/window distinction. Existing CFD browser tests verify
   actual 3D picking/dragging and boundary preparation.
5. Acceptance 28–31: the UI audit records actual production-rendered checks,
   native controls, keyboard navigation, responsive screenshots, round-trip
   editing, unavailable preflight, Heating/UFH and legacy CFD regression cases.

## Defects corrected during this pass

- HVAC was initially absent from project-history edit comparison; shared edits
  now create independent undo checkpoints.
- Host changes initially retained the seed room association; canonical ownership
  now follows the measured host's floor/room prefix.
- A geometry edit with an active operating override could promote effective
  flow/temperature into baseline design fields. Geometry now preserves both;
  explicit permanent operating edits clear only the corresponding override.
  The regression `permanent geometry edits never copy effective operating
  overrides into the design` verifies this distinction.
- Negative scenario flow/effective heat and malformed snapshots now fail before
  project mutation. Server/client validators agree on the shared contract, and
  CFD operation errors are displayed without losing the previous inputs.
- Generic CFD radiator copy/treatment/temperature controls could create a second
  thermal authority. Shared heaters now link to Heating for design geometry;
  scenario watts/off are edited in the shared operation panel. Power and fixed
  temperature cannot silently double-constrain one radiator.
- Unresolved thermal mapping must never be submitted as an exact solved HVAC
  case. Both the UI run action and worker submission boundary now fail closed.
- Window visibility/display fields are excluded from engineering staleness
  tokens. Geometry, operation, equipment and envelope changes remain included.
- Vent flow-unit choice now survives workbench/tab switches in the shared UI
  context; it does not alter stored SI values or create a device edit.

## Executed validation

- `uv run pytest` (backend/domain suite).
- `pnpm test` in `frontend` (unit and persistence suites).
- `pnpm lint` in `frontend` (ESLint and source-usage graph).
- `pnpm build` with `PLANNER_STATIC_EXPORT=true` and
  `NEXT_PUBLIC_BASE_PATH=/planner` (production export and TypeScript).
- `python -m ruff check --no-cache backend/app/hvac_document.py tests/test_hvac_document.py`.
- Browser commands and observed layouts are recorded in the separate UI report.

Final numerical outcomes are recorded after the final release verification in
the UI audit's validation section. No native thermal solve or independent
finite-volume UFH mapping is claimed. The optional retained-native-slice audit
requires `CFD_NATIVE_ARCHIVE`; it is unrelated to this preparation extension.
