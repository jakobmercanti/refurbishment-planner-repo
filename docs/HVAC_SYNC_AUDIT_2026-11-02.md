# Heating / Ventilation / CFD synchronization audit

Baseline: `ea1af72`. The user requested a direct check that changes in the
conventional workbenches and CFD reach the same data, followed by a final audit.
This review follows actual project creation order, source commands, saved
documents, derived CFD transport and rendered controls.

## Reproduced faults and corrections

Four new failing domain regressions demonstrated real gaps in the earlier work:

- An empty CFD case created before HVAC setup had no binding. Later Ventilation
  devices were absent until a separate handoff created another case. Idempotent
  reconciliation now creates the missing design binding on load and on project
  updates. Existing independent air settings are retained until the user selects
  a shared operation in CFD.
- Heating-only projects never initialized this connection without a vent.
  Placed radiators and UFH now establish shared design access independently.
- Editing a CFD case could save generated radiator watts as an independent
  treatment. Deleting the physical radiator then left that stale treatment.
  Reconciliation and CFD commits remove generated treatments for canonical
  radiator IDs. The transport view derives current heat each time; unrelated
  object treatments remain intact.
- A retained case override could hide a newer linked CFD operating edit. Explicit
  edits now replace the corresponding old case field, update the common
  operation and retain unrelated override fields. Geometry-only edits do not
  manufacture new operating values.

The source navigation review also found that an individual radiator's CFD link
opened Heating without selecting its actual floor/room. It now focuses that
source and the linked operation; Heating honors the room request.

CFD now exposes **Shared operating scenario** using the existing native selector
style. Existing independent case settings stay explicit. Selecting a conventional
scenario uses its operating values, clears case-only vent overrides and selects
the same operation for the conventional workbench. Design geometry/ratings are
shared regardless of the selected operating scenario.

## Final audit coverage

- A case existing before Ventilation setup receives a new supply without a new
  handoff. CFD geometry/design-flow edits return to Ventilation; scenario flow
  overrides retain the design flow. Undo, redo and reload preserve the result.
- A Heating-only radiator is resized and assigned a reviewed rating through its
  real editor. The deterministic CFD report is checked for 750 mm geometry and
  1600 W. A subsequent CFD mesh edit, source deletion and undo verify that no
  duplicate/stale radiator treatment survives.
- UFH floor build-up edits reach the exported zone and real circuit footprints.
  CFD effective-watt overrides update conventional room input and the explicit
  Heating operating-status section, while design floor settings remain intact.
- CFD density/cp edits reach Ventilation; Ventilation room temperature reaches CFD.
  Switching the common operating scenario selects the same scenario in both,
  while a sibling scenario retains its own conditions.
- An older case's independent room temperature survives automatic design
  connection. The exported package changes to the shared room temperature only
  after selecting its operation explicitly.
- A radiator on the upper floor's second room returns to that exact Heating room.
- Water-temperature changes reduce hydronic output consistently in conventional
  room input and CFD surface power. Legacy generated treatments are removed on
  load, reconciliation is idempotent, and historical handoff packages stay fixed.
- Shared radiator duplication/deletion remains routed to Heating; CFD group-copy
  and clear-object controls retain their existing source protections.

## Validation

- Backend: `uv run pytest` — **784 passed, 1 optional native-archive test skipped**.
  Warnings concern the existing FastAPI startup deprecation and local cache access.
- Frontend: `pnpm --dir frontend test` — **707 unit tests and 19 persistence tests
  passed**, including eight new synchronization domain regressions.
- Broad production-browser audit — **38/38 passed**. After the final explicit-link
  preservation correction, the complete synchronization suite passed **6/6** on
  the final production build. These runs verify **39 distinct browser scenarios**.
- Production static build and TypeScript — **passed**. Full frontend lint and
  source-usage check — **passed**, 498 modules without orphans. `git diff --check`
  — **passed**.
- Final source review checked write boundaries, stable IDs, derived-only radiator
  transport, live case freshness, retained historical snapshots, room ownership,
  independent operating settings and the run-submission block. No unresolved
  synchronization defect remains within these tested paths.
- Screenshots of the source room, CFD controls and new operation selector were
  visually inspected. Controls retain the native workbench appearance; the broad
  audit also passes desktop, dark tablet and phone checks.

Evidence logs: `.local-logs/hvac-sync-{tests,build,lint,pytest,browser,browser-final}.log`.
New coverage is in `frontend/tests/hvacSync.test.mts` and
`frontend/tests/browser/hvacSync.browser.mts`; the existing HVAC, earlier re-audit,
Heating and CFD browser suites are included in the regression matrix.

## Explicit boundaries

Design values and scenario overrides have separate meanings. A CFD case using
its own air settings must select a shared operation to share operating values;
the selector and caption make that state visible. Source geometry is edited in
Heating and referenced in CFD, rather than independently copied.

The native worker remains isothermal. Unlinked Heating-only radiator/UFH cases
now also fail closed at the run UI and submission boundary. Synchronization and
export are verified; thermal solving and partial UFH face-flux execution are not
claimed. Completed result packages are historical evidence and do not change
when live design inputs change.
