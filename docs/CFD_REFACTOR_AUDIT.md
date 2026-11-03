# CFD workbench refactor and verification

Baseline: `28457a2`. Scope: the shared Heating/Ventilation/Insulation code added
in the previous changes and the CFD workbench's preparation, thermal requests,
response contracts, report retention, source reconciliation and result-plane
navigation. The existing UI and deterministic engineering calculations remain
the behavior reference. This is an implementation refactor, not a new solver.

## Responsibility changes

- `useCFDPreparation` owns debouncing, hashing, cancellation, fresh validation
  responses and the preparation cache. `useCFDThermal` owns thermal requests and
  their cache. Both check project, study and complete input identity before
  accepting successes or failures. Hash failures are handled as request errors.
- Both report caches retain at most three studies, drop deleted entries on the
  next write and never display reports from a different project. Deleting removes
  cached reports; source guards reject late results for removed studies. Clearing
  studies or replacing the project cancels pending requests.
- `ClimoptixWorkspace` coordinates these hooks and its existing UI. The native
  delete dialog is a separate component; its appearance and keyboard behavior
  are preserved. General help content lives with the other workbench help.
- `climoptixReport` owns one runtime schema and infers its public TypeScript
  types. The former duplicate handwritten report interfaces and unchecked cast
  are removed. `climoptix` keeps its existing type exports as a compatibility
  facade for callers.
- `sharedSources` owns canonical emitter identity, source presence and seed-bound
  discovered rooms. `hvacHeating` owns conventional Heating calculations and the
  shared emitter/UFH projection. Live CFD resolution no longer constructs and
  serializes the entire review/export package to obtain its source inputs.
- Backend boundary preparation is split into envelope mapping, source masks,
  overlap review, floor mapping, unlocated input capture and finalization. Output
  rows have explicit types, and finalization indexes source patches once instead
  of scanning every patch for each source. Physical formulas and stable IDs are
  preserved.
- Result-plane stepping uses a synchronous request lock and scopes busy/error
  state to its adapter, job and file. Switching views does not carry an old
  pending plane's state into the new view; rapid clicks cannot double-dispatch.

## Removed or corrected

- Removed the unused provider protocol and unused adjoint message. Internal-only
  schemas, helpers and types no longer export an unused public API. These changes
  were checked against imports and whole-project type checking; active features,
  intentional unsupported-operation guards and test entry points are retained.
- The old report schema accepted null validation while its handwritten interface
  asserted a non-null record. The shared schema now requires the actual validation
  record before any viewer or export can use a response.
- Report parsing rejects duplicate patch/object/vent/audit IDs, invalid triangle
  indices/counts, orphan triangle/audit patch references and vent-role mismatches.
- Discovered domain membership compares seed fields, rather than JSON property
  order. Equivalent seed objects retain their scope; a different seed discards it.
- Plant/distribution-only Heating data now establishes shared inventory as well.
  It contributes no fabricated radiator or UFH heat.
- Frontend and backend shared input contracts both reject duplicate physical or
  unlocated source IDs and mismatched gain/infiltration units. The backend's
  unnecessary forward-reference rebuild is removed.
- Late thermal failures for an older input revision are ignored, including when
  the same study remains selected. Existing settings and newer requests survive.
- The requested Heating header adjustment removes the accumulated tab margin and
  toolbar padding. Its gap is 6 px in compact density and 10 px in comfortable
  density. Add element, Reset, Undo and Redo match the workbench tabs at 28/36 px
  respectively, verified at desktop and phone widths using the production UI.
- The desktop setup tabs use nine equal columns. The previous special-width
  Optimisation column broke the workbench's tab alignment. Labels retain their
  accessible names and titles, and truncate visually instead of overflowing.
- Browser audit fixtures now follow the current nine-phase setup, embedded
  Thermal navigation, wrapped footer pairs and Results layer-import controls.
  Menu helpers open the Toolbar idempotently. Existing integer-range rejection,
  field values, keyboard behavior and action containment assertions remain.

## Validation

The first review traced ownership, imports and asynchronous lifecycles. The
second reviewed numerical equivalence, missing/malformed inputs, synchronization,
persistence, worker gates and the observable UI. Verification includes:

- `uv run pytest`: **810 passed**, one optional retained-native-archive test
  skipped. Existing test-client deprecation/cache permission warnings remain.
- Frontend test suite: **723 unit/integration tests plus 19 persistence tests
  passed**. New tests cover reused study IDs across projects, stale sources,
  cache eviction, malformed reports, source units, seed ordering and inventory.
- Full frontend lint/source-usage checks passed: **510 modules, no orphans**.
  TypeScript checking, including unused locals/parameters, passed.
- Ruff and Python compilation passed for the changed Python files.
- Six full reports generated by the committed pre-refactor implementation and
  the refactored implementation match exactly, excluding check timestamps:
  insulation, UFH, combined fabric/UFH, off, overlapping zones and disjoint zones.
  This checks geometry, IDs, patch conditions, conservation, diagnostics, capture
  and provenance hashes on identical source inputs.
- Production static build passed with the final Heating spacing and equal-width
  CFD tabs. Desktop and phone Heating measurements verify all four action buttons
  match the tabs in both density modes.
- **78 distinct browser cases passed across the full sweep and corrective
  closing runs.** The initial sweep was 72 passed / 6 failed, exposing stale
  audit-fixture assumptions, a menu wait and unequal desktop tab widths. The
  corrected six cases all passed against the closing build (five in
  `cfd-refactor-browser-final.log`, then the final nine-tab window case in
  `cfd-refactor-window-final.log`). Physical value, invalid-input, source-sync,
  provenance, history, worker, keyboard and containment checks are retained.
- Full lint and the changed audit-fixture lint passed. Staged whitespace checks
  passed. No unresolved failure remains in these checks.

Local verification logs use `.local-logs/cfd-refactor-*`. Regression cases are
committed in `frontend/tests/cfdRefactor.test.mts`,
`tests/test_shared_boundaries.py` and the existing browser suites, including a
new delayed thermal failure case in `thermal.browser.mts`.

## Limits

The browser harness uses the production UI and actual Python preparation with
local intercepted service routes. It does not validate a live remote deployment.
Thermal boundary preparation/export is supported; the native worker remains
isothermal and thermal execution stays blocked. This refactor does not claim a
thermal solve, resolved conjugate solids/radiation, or physical mapping for
unlocated zone gains/infiltration. Frontend and backend must deploy together.
