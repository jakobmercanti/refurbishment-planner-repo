# Resume checkpoint — second UI audit

Historical pause record. The user resumed this audit on 2 November. The notes
below describe the state at the pause and are superseded by the completed work
and verification recorded in `UI_REAUDIT_2026-11-02.md`.

## Objective and baseline

User requested another complete audit of today's modifications, fixes for
anything missed, and a push to master after verification. Push authorization
already exists; do not request it again on resume.

Baseline local/remote master: `b95aa8eed854ce4de797f18173b7fab5501aa735`.
That commit implemented the three most recent screenshot lists and passed 660
unit, 19 persistence and 34 targeted browser cases. The checkpoint's new edits
have not inherited that verification. Previous scope/details are in
`HEATING_UFH_UI_AUDIT_2026-11-01.md` and `UI_WINDOW_SOCKET_AUDIT_2026-11-01.md`.

Preserve unrelated modified gitlink `freefloorplan3d-website`, untracked
`climoptix_website/`, `.codex-remote-attachments/`, and ignored generated files.
Do not stage them. Single-agent workflow; no Luna trigger or active goal.

## Findings and saved edits

- `EnergyNumberField.tsx`: merely focusing/blurring a shared U input previously
  emitted a change, which could replace a layer assignment with its displayed
  U-value. Commit now requires an actual draft, and unchanged numeric values do
  not emit changes.
- `SharedThermalValues.tsx`: editing a U-value previously dropped the existing
  assignment's boundary, adjacent temperature and opening metadata. It now
  spreads the resolved active/inherited assignment before replacing U/assembly.
  This is an important calculation/data-preservation regression to test.
- `HeatingLayoutPanel.tsx`: Apply spacing/count was never disabled during a
  worker job and could launch overlapping workers. Added a worker-ref guard,
  busy disabled/Generating label, 60-second timeout and cleanup. Stale-result
  check now includes rooms/geometry as well as Heating inputs. An unchanged
  result (locked circuits, missing manifold, invalid generation) now exposes its
  reason instead of silently discarding `result.changes`.
- Same panel: selecting a circuit/exclusion/manifold in another room left the
  previous room's controls open. Selection now derives the owning zone/room,
  retaining the current room for a shared manifold when appropriate.
- `SocketCircuitControls.tsx`: a deleted/import-missing socket remained in the
  route order but had no UI action to remove it. Every ordered socket now has
  an accessible Remove action; a missing consumer unit is explicitly labelled
  in its select until replaced.
- `EditableHeatingPath.tsx`: context menus could remain usable after a route was
  locked or replaced. Menus retain their source path and only render while it
  matches and is unlocked. Drag keeps a source path and pointer ID, rejects
  stale/locked changes, focuses the SVG group, and Escape cancels the current
  drag. Pointer cancellation rolls back the preview.
- `ReportExportPreview.tsx`: rapid option change/revert could re-enable a PDF URL
  already revoked by effect cleanup. Option edits now invalidate the preview
  immediately, and URL lifetime follows the preview object rather than options.
- `heatingDesign.ts`: invalid system-index fallback chose Minitec but failed to
  apply its explicit default temperatures; checks the selected dataset instead.
- `HeatingLayoutOverlay.tsx`: heated-path Shift-drag/double-click bypassed new
  bend/radius validation by editing arbitrary arc samples. Heated paths now use
  bend handles only for these gestures; lead routes retain segment/insertion
  editing. Manifold-end lead handles are hidden, and lead segment drags preserve
  both anchors via `moveHeatingRouteSegment`. Overlay drags store their source
  Heating document so completion cannot overwrite a newer edit.

## Immediate review/fix still needed before tests

1. Review every uncommitted diff; these are initial fixes, not a finished audit.
2. In `runDesign`, wrap `active.postMessage` so a synchronous clone/send failure
   calls cleanup immediately instead of leaving the worker ref busy until the
   timeout. Consider lifecycle cleanup/messageerror coverage without creating
   unnecessary abstractions. Current timeout cleanup uses `workerTimer` ref.
3. Verify the changed SVG lead `path.map` ternary/type narrowing with TypeScript;
   last edit uses the guarded manifold-end expression inline. Check the tooltip
   still says double-click any corner although heated-path insertion was removed.
4. Exercise source-reference drag guards in real UI: selection changes must not
   cancel normal drags, and concurrent edits must not be overwritten.
5. Audit the remaining files from today's baseline commit, including the shared
   chevrons/gutters, compact sizing, help deduplication, socket connectivity and
   import persistence. No new regression tests have yet been added this audit.

## Suggested meaningful regression cases

- Layer-backed U input focus/Tab leaves Energy document byte-equivalent;
  actually editing it preserves boundary/adjacent temperature and inherited
  scenario/opening metadata. Check loss calculation still uses those inputs.
- Delay a real local Heating worker response in the browser harness, click
  Apply again and verify a single job; modify inputs/room geometry and ensure
  stale result is refused. Locked/invalid generation must display the reason.
- Two-room saved fixture with UFH in both rooms: click a tube/manifold/exclusion
  in room 2 while room 1 is selected and assert room 2 controls open.
- Missing socket membership can be removed, routes regenerated and tests pass;
  missing consumer unit can be replaced. Save/reload and layout import persist.
- Pipe drag cancellation/Escape, locked context-menu deletion prevention,
  saved/draft editing, UFH lead anchors and no raw heated-arc Shift mutation.
- PDF title/details rapid change-and-revert never downloads revoked/stale bytes;
  page navigation and rendered canvas still work, no download on Cancel.
- Unit case for invalid UFH system-index fallback matches default conditions.

## Runtime and verification

Workspace is `C:/Users/Dell/Documents/ChatGPT/Online refurbishment planner`.
Read/follow root and frontend AGENTS. Relevant installed Next guide was read:
`frontend/node_modules/next/dist/docs/01-app/03-api-reference/01-directives/use-client.md`.

PowerShell runtime PATH prefix:
`C:/Users/Dell/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin;C:/Users/Dell/.cache/codex-runtimes/codex-primary-runtime/dependencies/bin/fallback;`

Frontend: `pnpm lint`, `pnpm test`. Build with both environment variables:
`PLANNER_STATIC_EXPORT=true`, `NEXT_PUBLIC_BASE_PATH=/planner`, then `pnpm build`.
The browser harness serves `frontend/out`, so rebuild before using it for new
code. Escalation is needed for production builds/browser processes/network/git
mutations in this Windows environment. No approval was rejected.

Set PLAYWRIGHT_MODULE to
`C:/Users/Dell/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright`.
From frontend, run browser cases using
`pnpm exec tsx --require ./tests/css-register.cjs --test --test-reporter=tap --test-concurrency=1 ...`.
Relevant existing suites: `heatingWorkbench.browser.mts`,
`uiConsistency.browser.mts`, `currentWorkflows.browser.mts`,
`windowControls.browser.mts`, `windowDocking.browser.mts`.
The harness supports `.mjs` MIME for the local PDF.js worker.

Browser fixtures/helpers are in those files and `tests/browser/harness.mjs`.
Do not import a test file to reuse fixtures (it registers its tests again).
Screenshots/logs go under ignored `.local-logs/`. Use actual click/drag outcomes
and saved IndexedDB documents for verification. Prior logs `heating-verified-*`
and `heating-browser-release.log` belong to the previous commit, not these edits.

Builds regenerate `frontend/next-env.d.ts`; after final build restore only its
two imports to the tracked `.next/dev/types/routes.d.ts` and
`.next/dev/types/root-params.d.ts` to avoid unrelated drift.

After validation, update the audit notes, inspect staged scope, commit the
relevant fixes/tests/notes to master, push normally (no force), and verify remote
master matches HEAD. No worker/backend deployment is needed for these UI fixes.
