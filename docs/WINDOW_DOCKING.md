# Workbench window docking

CFD and Floorplan (2D and 3D) share the native window layout controls. Drag a
titlebar to a workspace side to see its proposed dock rectangle; release to
attach. Moving away removes the preview. Escape or a cancelled pointer gesture
restores the pre-drag layout. Clicking a titlebar alone never undocks a window.
The titlebar's **Window layout** menu offers Maximise/Restore, Dock left, Dock right and Float window
without requiring a drag. Arrow keys, Home/End, Enter and Escape work in the menu.

Maximise fills the visible workbench below the application menu, respecting any
other docked rail. Restore returns to the prior floating or attached state without
discarding a draft. This action remains available when the screen is too small
to dock. Modal windows expose the same action in their header while retaining
their backdrop and modality. Existing titlebar double-click height fitting is
kept; double-clicking a fully maximised header restores it.

Attached windows reserve real canvas width. The SVG/R3F renderers receive the new
viewport size; neither model coordinates nor engineering inputs are transformed.
Both rails preserve a usable centre view. Windows on the same side share the
height, and closing one reflows the others. The inner rail edge changes width.
Dragging an attached titlebar restores its floating width and removes the canvas
reservation. Explicit docking is separate from the pre-existing automatic
floating-window arrangement, which remains an overlay until the user docks it.

Floating tools are also constrained to the free viewer rectangle while a rail
is occupied. This includes automatic legacy positions and portalled help/editors;
neither a wider panel nor its title actions can be stranded under an attached
window. Their preferred floating width and position are retained and return when
the rail is removed. Resizing either rail recomputes these constraints. Viewport
bounds exclude the persistent application header even after page scrolling.
Keyboard focus also raises a floating tool, so overlapping floating windows remain
recoverable without a pointer-only interaction.

The shared behavior covers study/setup and refinement editors, building/floor/roof
panels, view/element controls, electrical/heating/energy panels and their native
subwindows, and portalled help. Appearance, construction-layer and BOM property
editors also use the native frame, retain local drafts and pin Cancel/Done below
their scrollable controls. Narrow property editors stack controls and previews.
Blocking confirmations, account/settings and file dialogs remain modal; docking
must not bypass a destructive confirmation or file operation.

Dock layouts are session-only and owned by the workbench, not the project file.
They last for the current window instance; existing floor/project layout resets
can recreate a window in its default arrangement.
Hidden 2D panels do not reserve 3D space; hidden workbenches do not reserve active
workbench space. Closing/unmounting releases the reservation and observers.
On viewports narrower than 720px or shorter than 280px, docks are temporarily
suspended so the existing compact UI and full-width canvas remain usable. They
resume when enough space is available; Float window can also clear a suspended
dock. Preview and panel bounds use the visible workspace below the menu, including
visual-viewport offsets and browser resizing.

Implementation: `floatingWindowGeometry.ts` owns pure pixel layout/edge rules;
`windowDocking.ts` owns bounded, workbench-local external layout state and cleanup;
`FloatingToolbar.tsx` owns gestures and accessible window actions. Styles reserve
canvas space at the rendering boundary. No new backend or solver dependency is
introduced.

Regression coverage includes pure layout/width limits and production-browser
checks for previews, cancellation, clicking vs dragging, dock width changes,
floating restoration, state retention, both SVG/WebGL canvases, stacked native
and help windows, workbench/view isolation, compact suspension, both UI styles,
light/dark themes and construction-draft cancellation. The browser harness must
be run against a fresh `PLANNER_STATIC_EXPORT=true` `/planner` build, not a stale
`out/` directory. Full regression results are recorded with the CFD audit notes.

`windowControls.browser.mts` additionally checks maximise/restore and draft
retention, both-rail reflow, mobile header accessibility, modal maximisation,
background-click insulation deselection and contextual help. Empty background
clicks/taps clear both the energy and underlying wall selection; drags, cancelled
gestures, middle-button navigation and pinch gestures do not deselect. An empty
energy selector no longer silently edits the first wall. Static operating
instructions, calculation explanations and limitations belong in the relevant
help window; live results, provenance, missing-data warnings and errors stay in
the working UI. Official insulation guidance links remain accessible from help.

## Window-controls audit validation

- `pnpm test`: 579 unit and 19 project-persistence tests passed.
- `pnpm typecheck`, `pnpm lint` and the production `/planner` static build passed.
- Edge production-browser run: 26 scenarios passed across `windowControls`,
  `windowDocking`, `currentWorkflows` and `viewerConsistency`. Includes touch
  pinch/tap, desktop/tablet/mobile, both themes/styles, SVG/WebGL resizing,
  draft/geometry retention, help focus/stacking and parent-modal help.
- `uv run pytest -q`: 645 passed. Existing Starlette deprecation and pytest-cache
  write warnings were non-blocking; no backend or authoritative geometry changes.
- Static prose was reviewed across construction, catalogue, heating, viewer,
  preferences and CFD controls. Relocated guidance stays accessible from help;
  active workflow status, data qualifications and destructive-action summaries
  remain in context. Unused guidance-only CSS was removed.
