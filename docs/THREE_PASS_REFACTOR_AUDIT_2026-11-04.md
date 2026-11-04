# Three-pass refactor and UX audit — 4 November 2026

Scope: the recent Heating, UFH, Ventilation and CFD integration, its shared
editors and window/help controls, and the adjacent thermal, insulation and
building interfaces. Reviewed against the integration discovery and previous
HVAC/UI audit records. Unrelated website repositories and existing local files
were left outside this change.

## Pass 1 — structure and maintainability

- Centralized permanent vent edits in `updateVentDevice`: validation, device
  identity, current-room operation selection and override reconciliation now
  follow the same command in the inline and floorplan editors.
- Reused the measured-point projection in `ventPlacement` for the conventional
  plan, keeping all authoritative positions in millimetres and kernel checks
  authoritative for openings, holes, clearances and overlaps.
- Removed unused preflight state, the obsolete section-help escape hatch,
  serialized help-context comparison, an unused CSS rule and conflicting
  room-action layout rules. Existing two-column actions are retained.
- Shared runtime validation of help metadata protects both the main guide and
  its remembered topics from malformed arrays or links.

## Pass 2 — reliability and state ownership

- Reproduced pressure-to-flow control changes retaining a number in different
  units, including valid zero-pressure overrides becoming invalid flow inputs.
  Control changes now start with an explicit valid value and remove obsolete
  flow overrides across every operation and CFD binding. Temperature and
  enabled overrides remain. The editor and main guide explain this behavior.
- Same-quantity edits still preserve independent scenarios. Geometry-only CFD
  changes continue to preserve design ratings and effective operation values.
- Host reports are independent of full vent validation; a late hosts-only
  response cannot overwrite a newer complete check. Loading and error states
  have an explicit retry in both editors.
- Preparation has a 25-second deadline and preserves caller cancellation.
  Superseded inputs cancel requests and cannot receive a stale failure.
  Host caches and accepted reports also include the API endpoint identity.

## Pass 3 — observable UX and regression audit

- Explicit Heating/Ventilation and Heating-section navigation starts at the
  top of the new section. Data edits retain scroll. Heating tabs now have
  roving keyboard focus, Arrow/Home/End navigation and a labelled tab panel.
- Checked single main help, full retained guidance, equal grouped action
  heights, clipping and horizontal overflow across desktop/tablet/phone,
  light/dark, both styles and both densities.
- Screenshot review found the floorplan Export shortcut covering the mobile
  vent editor's enabled checkbox. A browser hit-test reproduced the obstruction.
  Export and floor-selection controls now sit below floating tool windows;
  the regression checks actual pointer targeting as well as visual bounds.
- Rechecked UFH valid/invalid run counts, layered plan controls, manifold
  labels, result filtering, native export cancellation, vent dragging/editing,
  undo/reload, independent operations and inverse CFD synchronization.

## Verification

- `pnpm test`: 737 unit and 19 project/persistence tests passed.
- `uv run --no-sync pytest`: 810 passed; one optional retained native-solve
  archive test skipped because `CFD_NATIVE_ARCHIVE` was not supplied. The
  Starlette/httpx dependency warning is non-fatal. The targeted HVAC/CFD/heating
  subset also passed all 170 cases.
- Browser regression audit: 80 distinct cases passed across the focused,
  Heating, responsive UI, HVAC synchronization, CFD, thermal, building and
  docking suites. The 44 cases in the final release run passed, including the
  mobile obstruction regression, retries and stale-result guards. The shared
  control matrix checks 76 window/profile combinations; the full vent editor
  additionally passes desktop and phone checks and screenshot review.
- `pnpm lint`, `pnpm typecheck`, static production build and `git diff --check`
  passed. Source usage found no orphaned modules. Generated build-only changes
  were excluded. No remaining blocker was found in this scope.

No solver physics or geometry rules were changed. The optional native archive
audit needs `CFD_NATIVE_ARCHIVE`; native thermal execution remains outside the
supported worker capabilities described in `HVAC_INTEGRATION.md`.
