# CFD compact UI audit — 24 October 2026

Scope: the annotated compact-layout request, plus shared-window regressions.
Object Duplicate/Delete is explicitly simulation-only; the shared Floorplan is
not edited by these actions.

## Implemented and reviewed

- Compact scales control/row heights, padding, gaps and table cells as well as
  typography. Touch controls retain larger hit targets. The shared contract
  covers floating windows, dialogs, menus, Floorplan, CFD and PlannerBuild.
- Gantt dependency endpoints measure actual row centres, so density changes,
  wrapped labels and font loading cannot leave arrows at fixed-height offsets.
- The desktop simulation selector is in the titlebar without a label row.
  Narrow/touch layouts show the current name there and use one Phase selector;
  Simulations remains the place to switch simulations on those layouts.
- Simulation groups highlight selection, direct New simulation into that group,
  collapse/expand, reorder and accept transfers even when empty or collapsed.
  Grip-only mouse/touch transfers require an internal session token; Escape
  cancels. Keyboard reordering and Move to group remain available.
- Clear all uses a cancel-first confirmation, includes archived simulations,
  preserves the measured building/folders and participates in Undo. Active or
  unresolved worker submissions block it. Pending imports/exports cannot revive
  or download cleared simulations.
- Empty-state actions share a wrapping row. Per-simulation Mesh/Run/Delete have
  equal widths; docked/maximised rows and nested groups use density-aware spacing.
  Narrow rails ellipsise long names without wrapping, with full tooltip and
  accessible names retained.
- Mesh/physics parameters adapt through four, three, two and one columns as the
  actual window width changes. Seed floor/room remain a paired field group;
  related X/Y/Z components retain their own three-column vector group.
- Objects and devices share grouped, draggable rows with Edit/Duplicate/Delete
  and non-drag move menus. Source-building editing stays in the header. Floating
  editors are portalled outside scrolling phase panels and restore focus.
- CFD copies reuse measured source dimensions and independent millimetre offsets.
  Source exclusion, restoration and unavailable-input cleanup are simulation-only.
  TypeScript/Python schemas enforce bounded, unique organization/instance data.
  Group organization is not a physical-input fingerprint change.
- Bounds combines Conditions/Thermal, Add group and Find surface in one wrapping
  toolbar. Group/surface actions, collapsing, transfers and independent editors
  share the list interaction model. Duplicate copies condition templates, never
  physical faces; deleting assignments/groups preserves the building surfaces.
- Standard, CAD and Blender-style mouse preferences persist and apply to both
  3D viewers. Right click opens the toolbar menu; right drag changes the view
  without opening it or starting a person/vent placement edit. Modal text is not
  treated as a viewer background. Floorplan's projection-aware zoom handler also
  honours Standard/CAD middle drag; Blender-style keeps middle-button orbit.
  The old hard-coded navigation legend has moved into View properties help.
- Refinement actions and the mesh estimate share a toolbar; refinement entries
  use compact inline actions and preserve independent measured dimensions.
- Export has separate Review, Warnings & checks, and Import / export tabs.
  Provenance remains visible as data; provider limitations and instructions are
  in contextual help. Current-report checks still guard preparation downloads.

## Verification

Backend: `uv run pytest -q` — 651 passed.

Frontend: `pnpm test` — 583 unit and 19 persistence tests passed.
`pnpm lint`, `pnpm typecheck` and the static production build also passed.

Production Edge browser regressions: 80 distinct cases passed (43 CFD workflows
and 37 compact/shared-window workflows). The shared-window suite was rerun after
the middle-button navigation fix, including parallel and perspective views.
A further focused production layout matrix passed after the X/Y/Z grid fix,
covering both densities at 390, 760, 1050 and 1900 px across every setup phase.

Coverage includes real preparation-provider responses; immutable source geometry;
copy/exclusion/overlap checks; protected drag/drop and touch cancellation;
confirmation/Undo and delayed imports; saved preferences; real rendered camera
changes; 390–1900 px layouts; both densities, styles and themes; scrolling,
focus, docking/maximising and existing Floorplan workflows.

Bugbot was requested, but its skill requires a dedicated `bugbot` subagent that
this session does not expose. No Bugbot result is claimed; code inspection and
executable regressions were used instead.

## OpenFOAM boundary

No OpenFOAM worker is connected and no run/mesh progress is invented. The typed
adapter, immutable preflight and honest job states remain in place. The handoff
document describes the new simulation-only object fields and required worker
behaviour. See [the worker handoff](CLIMOPTIX_OPENFOAM_HANDOFF.md); preparation
and settings exports are not runnable cases or evidence of a completed solve.
