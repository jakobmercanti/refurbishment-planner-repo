# Workbench window docking

CFD and Floorplan (2D and 3D) share the native window layout controls. Drag a
titlebar to a workspace side to see its proposed dock rectangle; release to
attach. Moving away removes the preview. Escape or a cancelled pointer gesture
restores the pre-drag layout. Clicking a titlebar alone never undocks a window.
The titlebar's **Window layout** menu offers Dock left, Dock right and Float window
without requiring a drag. Arrow keys, Home/End, Enter and Escape work in the menu.

Attached windows reserve real canvas width. The SVG/R3F renderers receive the new
viewport size; neither model coordinates nor engineering inputs are transformed.
Both rails preserve a usable centre view. Windows on the same side share the
height, and closing one reflows the others. The inner rail edge changes width.
Dragging an attached titlebar restores its floating width and removes the canvas
reservation. Explicit docking is separate from the pre-existing automatic
floating-window arrangement, which remains an overlay until the user docks it.

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
