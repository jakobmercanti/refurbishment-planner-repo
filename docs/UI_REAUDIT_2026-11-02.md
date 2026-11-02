# Follow-up audit of the 1 November UI changes

This audit reviews commit `b95aa8e` against the three screenshot lists and adds
regressions for cases the first audit missed. Work resumed on 2 November after
the user's requested pause. Unrelated website work remains outside this change.

## Corrections

- Focusing and leaving an unchanged U-value no longer writes a replacement
  construction assignment. Editing a shared U-value preserves the inherited
  boundary, adjacent temperature and opening metadata in the active scenario.
  Existing Building's assignment remains intact when editing an upgrade.
- UFH regeneration allows one worker job at a time and disables Apply while
  busy. Geometry and Heating changes invalidate pending results. Send failures,
  unreadable replies, timeouts and locked/invalid generation expose a reason and
  retain existing edits/routes. Worker resources are cleaned up on failure and
  unmount. The removed Design updates window is not reinstated.
- Selecting a UFH circuit, exclusion or manifold follows its owning room.
  A manifold shared by several zones retains the current room when applicable.
- Heated tube arcs are edited through their bend/radius handles instead of raw
  sampled vertices. Lead routes still support point insertion and segment edits;
  segment moves preserve the manifold and heated-path anchors. Concurrent newer
  document edits cannot be overwritten by an old drag snapshot.
- Pipe Escape/cancellation rolls back the current drag. Context menus close
  when their source route changes or becomes locked. Locked pipes cannot be
  modified by an old menu or an in-progress drag. Ordinary selection and
  draft/saved route editing continue to work.
- Missing socket memberships can be removed from the circuit's route order.
  A deleted/missing consumer unit is explicitly identified until replaced.
  Regenerated radial/ring routes continue to use real POWER edges and the
  individual connectivity test.
- Rapid PDF option change/revert cannot re-enable an already revoked blob URL.
  Options invalidate the preview immediately, and object URLs are released with
  their actual preview. Rendered page navigation and explicit downloads remain.
- An invalid UFH preset index uses the complete reference default, including
  manifold design temperatures. Spiral/shape fallback warnings persist with the
  generated route and appear in room review feedback. Manifold port capacity is
  evaluated against the current allocation rather than persisting an obsolete
  first-setup warning.
- Docking an unresized compact window through its menu retains its displayed
  width. The former implementation used its unscaled preferred width and made
  it jump wider. Dead radiator button/disclosure CSS was removed.

## Audit coverage

The review includes the earlier shared gutters and resize targets, compact
windows/dialogs, outlined chevrons, fitting selection, floorplan Export gating,
scenario actions, help deduplication, socket topology/import persistence, shared
thermal values, default UFH, pipe editing, collapsible layouts and report export.

New browser cases exercise inherited construction data preservation, single-job
and stale-result handling, send-failure recovery, locked generation feedback,
two-room selection, anchored lead editing, drag cancellation, locked menus,
missing socket/consumer-unit recovery and rapid PDF option reversal. Existing
current-project and shared window/docking suites are included in the regression
run. The full historical browser suite is not claimed as rerun.

Logs and screenshots are local under `.local-logs/reaudit-*` and
`.local-logs/heating-nov01-qa/`. Fixtures use isolated local IndexedDB and block
external services. No live simulation, account state or backend/worker release
is involved. The original calculation qualifications and published-data
boundaries documented in `HEATING_UFH_UI_AUDIT_2026-11-01.md` remain applicable.

## Verified result

- 663 frontend unit cases and 19 project/persistence cases pass.
- All 39 targeted browser cases pass in one run against the release export.
- `pnpm lint` and source usage pass: 483 modules, no orphaned modules.
- Production Webpack/static export and its TypeScript stage pass; the initial
  standalone typecheck also passed before the last warning/docking corrections.
- Reviewed compact desktop and two-room Heating screenshots, plus the updated
  PDF, UFH and phone screenshots from the regression run.
- `git diff --check` passes. Generated Next declaration imports are restored to
  the tracked development paths; unrelated website changes are excluded.

## Screenshot follow-up: chevrons and contextual help

Secondary fitting selectors and Appearance/Position chevrons use 12 px icons
beside the 16 px main category arrow, retaining the original button hit targets.
Manifold guides in the main Heating help, Underfloor setup and Edit manifold
explain the supply/return rails, placement, connections and capacity. The plan
symbol uses orange/blue rails and shows used/available loops; its settings label
reads Loop connection capacity.

Heating system temperatures, Compare system temperatures and Heating results
now have distinct task guides. Their previous shared content caused the
duplicate-help filter to suppress the question-mark controls. Deduplication is
retained, and the three controls now open the relevant guide without toggling
their section or changing project data.

45 focused tests and all 19 relevant browser cases pass, including arrow sizes,
button hit targets, manifold counts/colours and specific contextual help. Lint,
source usage and the production static build with TypeScript pass. Updated
screenshots were reviewed; evidence is in `.local-logs/help-chevron-*`.
