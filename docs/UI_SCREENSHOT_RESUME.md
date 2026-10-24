# Screenshot UI round — 24 October 2026

Resumed from the user's pause on branch `cfd`, starting at pushed baseline
`5a0dc47`. Both the previous eight-item screenshot round and the subsequent
fourteen CFD items are implemented and verified. The user authorized commit and
push of this round to `cfd`; Git history records the resulting commit.

## Changes

- Background menus dismiss on outside left presses, including floating UI.
- Pendant/ceiling electrical schematics share zoom scaling across existing
  symbols, previews and placements, preserving catalogue millimetres.
- Heating help/field alignment, temperature help and two-row room balance;
  compact Energy and layer editors without redundant headings.
- Fullscreen hides the app menu and unrelated windows without discarding draft
  or dock state. Related editors/help remain usable. Escape restores before
  normal close/cancel behaviour.
- Deliberate grip-only mouse/touch/pen and keyboard reordering for shared CFD
  lists, including cross-group moves, insertion feedback and Escape cancellation.
- Aligned group controls and viewport-clamped top-layer action popovers.
- Domain spacing and supported mesh origin/alignment controls; measured connected
  rooms remain authoritative for domain extents.
- Supply/Extract drafts may precede host assignment. Face placement requires a
  validated host, and real preparation blocks unassigned drafts from submission.
- Compact boundary group editors open only on Edit; default groups retain
  unassigned physical entries and duplication never duplicates physical faces.
- Collapsible Physics/Run sections, responsive three/four-column Post controls,
  adaptive colour legend and true export tabs.
- Refinement inspection retains the hidden setup window, with Return/Escape
  restoring its size, position, maximised state and tab.

## Validation

Production build, lint, typecheck, 585 unit tests and 19 project tests passed.
83 distinct production Edge browser cases passed across CFD, compact layout,
window controls/docking, viewer consistency and current-workflow suites. Updated
structural selectors and viewer-hit coordinates were rechecked in focused reruns;
those cases now pass. Phone-width refinement inspection also passed. Ignored
`.local-logs/` contains the logs and visually inspected production screenshots.

## Remaining integration boundary

Imported OpenFOAM log plotting works. Live residual streaming is **not implemented
or connected**: the current worker adapter reports job status only. Monitor and
`CLIMOPTIX_OPENFOAM_HANDOFF.md` explain the missing authenticated, revision-bound
telemetry adapter. No real solver run or end-to-end OpenFOAM validation is claimed.

## Unrelated work preserved

The modified `freefloorplan3d-website` checkout and untracked
`.codex-remote-attachments/01a0b951-9092-7d80-9c5e-e9651d872a7a/` are outside this
round. Build-generated `frontend/next-env.d.ts` imports have been restored to the
tracked `.next/dev/types/` paths. Stage only intended paths, not baseline dirt.
