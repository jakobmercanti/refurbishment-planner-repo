# Paused UI work — 6 November 2026

Completed on 7 November 2026. Commit `9b055bf155e6459e04d945566e7679db1906fbc2` was pushed to GitHub `master` and the remote revision was verified. The production build, lint, type-check, 741 unit tests and 19 project tests passed. The service and docking suite passed all 24 browser cases. The two remaining CFD layout failures passed on the release build alongside the CFD phase survey and both vent drag checks. The notes below describe the original pause.

User explicitly requested stopping in a resumable state. No current-task commit, push or deployment was made. All edits are saved in the working tree. Resume only when asked. All test/build processes started for this task have finished.

## Scope to finish

Latest user list: vertically centred menu entries; separate internal ceiling/all-roof display with wall transparency also applied to roofs; vent dragging across measured walls; docked width expansion; no overflowing simulation buttons; identical conventional/CFD vent rows; vent settings only through Edit; screen-facing service text in 3D; one contextual help button on each main collapsible section without internal duplicates; Export moved into Results with a better name; UFH regenerated and recalculated after a room resize.

Standing permission before the pause: push master after verification, including if automatic deployment triggers. Do not ask again on resume. Single agent. Follow root/frontend AGENTS.md. Preserve unrelated changes listed below.

## Source state

Base master/remote before this task: `a711b6ac12cc015252c184e37362a6afd3528155` (previous service-workbench work). This task has uncommitted changes across frontend components/lib/styles/tests. No changes were discarded.

Unrelated existing state to preserve and NOT stage: modified `freefloorplan3d-website` gitlink, untracked `climoptix_website/`, `.codex-remote-attachments/`, `docs/UI_REAUDIT_CHECKPOINT_2026-11-01.md`. `.local-logs/` is ignored.

## Implemented, pending final verification

- `BuildingControls.tsx`: optional `BuildingView.ceiling`. `ApplicationMenuBar.tsx`: Show internal roof only / Show all roof. Service entry hides both. `BuildingSurfaces.tsx`: filters to CEILING, transparent material for every roof part, new InternalFloorCeiling for lower floors. `EngineeringViewer.tsx`: propagates both modes/transparency to active and passive floors; View properties has Internal ceiling and All roof. Latest edits allow internal ceiling even when external roof disabled. Check passive floors and disabled-roof edge cases.
- `floatingWindowGeometry.ts`: dock width no longer capped at560px; bounded by workspace and minimum viewer space. CSS exposes inside resize edge. Geometry tests updated and passed targeted run. Dock browser tests mostly pass, one obsolete <=561px assertion was updated after its run.
- `ui-controls.css`: centres menu/disclosure text, help button placement, simulation row uses two columns with actions in a full-width wrapping row to prevent trailing menu overflow. Remove orphan CSS if found; `.service-fabric-label` already removed after corresponding component removal.
- `serviceMenuHelp.ts`: decorates main summaries in every FloatingToolbar with one help button, excluding nested details and row menus. Stops toggle propagation, dispatches section-specific windowHelpSteps. Internal WindowHelpButtons remain hidden topic markers. Need verify contextual content, no duplicates, spacing, help doesn't open accordion. All main FloatingToolbars use this hook; standalone dialogs may require audit.
- `VentilationPanel.tsx`: removed redundant position table, selected inline editor and scenario override controls. Shared EquipmentListRow remains. `HvacVentEditor.tsx`: added X/Y/Z readout and scenario overrides within Edit. Design edits still use existing updateVentDevice (clears relevant operation overrides). Removed unused editVents and imports. Check flow quantities/units and all old inline browser tests.
- `ventPlacement.ts`: new ventHostAtPoint matches checked wall/floor/ceiling, hole-aware polygon test,8mm plane tolerance, existing snapVentUV for footprint. `HvacContext.tsx.moveVent`: optional patchId; atomic host/floor/room update with existing stale-drag guard. `HvacSceneMarkers.tsx`: scene raycast finds host hit, prefers inward-facing walls, updates draft host/plane/orientation, commits once. Keeps4px drag threshold, grab offset, Escape. Real cross-wall browser test newly added but not yet run. Potential concerns: rendered wall face vs canonical host offset, hidden walls filtered out, correct normal preference. Never loosen authoritative backend checks.
- New `lib/heatingRoomResize.ts`: on changed vertices with UFH, maps exclusions/manifold/room label to new bounds, unlocks and regenerates each zone, restores stable existing circuit IDs/lock flags, updates manifold capacity<=50. Moves each manifold once per room (fixed repeat-zone scaling). Shared manifolds in other rooms stay put. Source immutable. `useLocalProject.ts.update` applies this with room edit in same history/save; catches error and restores old project. `changeFloorplan` returns error. Need browser resize/undo/reload proof and audit editBuilding/direct dimension paths; avoid regeneration on floor switches/imports. Existing physical spacing/radius retained.
- CFD Export top phase removed from ClimoptixWindowMenu/Workspace, compatibility `review` ID aliases Results -> new Review & files tab. Results controlled subview state in Workspace. Review content reused, submission error path updated. Harness cfdWindow maps Review & export to Results/Review & files. Verify issues navigation, tab keyboard, imports and solver review path.
- `ServiceViewContext` scene adds `labels` SVG and ServiceLabelPortal. `ServiceSceneLayers`: separate fullscreen SVG with per-frame camera projection for screen-facing label anchors. Shared geometry stays on measured floor via Html transform. Native duplicate FabricFace Html labels removed; coloured meshes retained. `FullFloorplanEditor` labelPortal maps plan screen anchors back to mm and portals label nodes into projected SVG. Heating room summaries, pipe/circuit/manifold/radiator output labels and Energy wall/cards use this; Electrical connection/reference labels also use it. Capture fallback on portalled label node. Radiator/manifold labels now outside rotated physical symbol. Test visible size under perspective newly added, not yet run.

### Most recent fix requiring rebuild

FullFloorplanEditor rendered `serviceLayers` both in hidden 2D SVG and the 3D SVG, causing BOTH instances to portal screen labels into the same visible SVG. Browser diagnosed identical overlapping labels intercepting clicks. Fixed original 2D render to `{!serviceView?.in3D && serviceLayers}` at~5416. Scene render remains `{serviceLayers}` at~5104. **Not rebuilt or retested after this fix.** Also audit duplicate Energy overlays when heating heat-loss surfaces AND previously enabled Energy data are both visible (read-only overlay plus normal overlay conditions may both hold).

## Validation so far (do not claim final pass)

- Typecheck passed before latest roof/test/duplicate fixes (`.local-logs/audit-typecheck2.log`). Run again.
- Lint passed, source usage533 modules, before latest changes (`audit-lint.log`). Run again.
- Static production build passed (`audit-build.log`) before latest small edits. `out/` is STALE. Rebuild before browser checks.
- Targeted tests20/20 passed: heatingRoomResize and floatingWindowGeometry (`audit-target-unit.log`). Tests verify new coverage/demand, actual spacing, source immutable, locks/IDs, exclusion/label mapping and other room unchanged.
- Full unit run741 tests,739 passed,2 failures (`audit-full-unit.log`):
  1. heatingPresentation.test.mts:75 expects old inverse `rotate(-180)` markup. New output is upright because its label is outside the rotated symbol. Update meaningful assertion to verify output label has no rotated ancestor, not just delete test.
  2. New ventPlacement.test.mts omitted required role and host. **Already fixed test fixture** after run; rerun. It uses realPreparation+canonical geometry and checks all walls/floor/ceiling and holes. Follow-up geometric mismatch still possible.
  Full script stops before projects suite on failure; rerun both once fixed.
- Browser first run16 tests13 passed (`audit-browser1.log`): serviceWorkbenches3D6, ventListParity3, windowDocking7. Failures:
  1. Old native energy scene label selector (updated test to shared screen SVG selector); follow-up test diagnosed duplicate labels (fix above).
  2. Vent parity: compact768px action text WRAPS; real issue STILL UNFIXED. Both use shared EquipmentListRow.module.css but global parent styles may constrain layout. `floor` diagnostics at768: padding3px,gap3,radius7,bg rgb29,42,57; button font12/minHeight28/padding3px4px/radius9. equal=true,clipped=false,wrapped=true,overflow=false. Next test includes action widths to diagnose. Container `.collection` equipment-list; @container<=540px moves actions to second row,width270 max100%; `.cfx-reorder-item` flex with32px grip+8gap; module has actions width270,3 equal cols. Check specificity and available width; don't hide text or relax assertions. Modern theme now set correctly on BODY (`dataset.uiStyle`) in test; previously incorrectly on HTML. Shared design visually must match in both workbenches, all densities/themes.
  3. Dock property editor obsolete <=561px assertion updated to reserve viewer300px, not rerun.
- Follow-up2 browser tests both failed (`audit-parity-diag.log`): duplicate labels interception and compact vent wrapping described above. Last diagnostic test now logs widths in presentation too. It compares Floorplan/CFD style values; geometry width may differ, so don't assert equal pixel widths if actual parent sizes differ; widths were added only for diagnosis.
- Added two more tests to serviceWorkbenches3D.browser.mts after these runs: actual vent drag across two visible transparent-wall markers+undo; screen-facing heating summary dimensions under perspective and Help leaves section open state unchanged. NOT RUN. The help close label `Hide Help — Heating results` may need match actual title. Both intentionally assert observable behaviour.

## Remaining work on resume

1. Read current files/diff, fix compact vent action wrapping, update upright-label unit test; rerun new host unit test. Run typecheck (tests could have type-only issues, tsx doesn't check them).
2. Rebuild static output; run targeted new browser cases plus all previous selected tests. Fix any real failures. Add actual room-dimension resize -> regenerated UFH -> undo/reload browser proof (right-click `.wall-interaction-line` opens Wall length field/Apply wall length; or existing room-coordinate dimension edit). Check atomic undo with Floorplan local snapshots vs project history, stored floor content projection and heating context hydration.
3. Add roof mode/material verification and screenshots, wide/narrow simulation row containment, section-help consistency, Results tab/navigation, vent Edit-only entries. Audit all relevant windows for same issues. No claim of whole-UI coverage without testing it.
4. Check all latest diffs for unused code and edge cases, lint/typecheck/unit/projects/build and browser as appropriate. No backend edits so backend tests not presently necessary.
5. Restore generated `frontend/next-env.d.ts` imports to `.next/dev/types/routes.d.ts` and `.next/dev/types/root-params.d.ts` after final build. Stage only task files, diff --cached --check, commit and push master under standing authorization. Keep checkpoint update with accurate outcome; do not stage unrelated files.

## Commands/environment

Node/Pnpm PATH prefix:
`C:\Users\Dell\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin;C:\Users\Dell\.cache\codex-runtimes\codex-primary-runtime\dependencies\bin\fallback;`

Static build needs BOTH `$env:PLANNER_STATIC_EXPORT='true'` and `$env:NEXT_PUBLIC_BASE_PATH='/planner'`; then `pnpm --dir frontend build`.

Browser `$env:PLAYWRIGHT_MODULE='C:\Users\Dell\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\node_modules\playwright'` then `pnpm --dir frontend exec tsx --require ./tests/css-register.cjs --test --test-reporter=tap --test-concurrency=1 tests/browser/NAME.browser.mts` (optional --test-name-pattern before file paths). Harness uses isolated IndexedDB, real local Python geometry, mocked worker/account, external networking blocked. Existing test fixtures in test files must not be imported (registers duplicate tests).

Build/browser/git mutations generally need require_escalated in this managed Windows workspace. No rejection so far. Shell PowerShell; do not use bash brace file expansion. `.local-logs/*.cjs` mutation scripts are non-idempotent; inspect before any rerun. Avoid rerunning them wholesale. Test logs all stored under `.local-logs/`.
