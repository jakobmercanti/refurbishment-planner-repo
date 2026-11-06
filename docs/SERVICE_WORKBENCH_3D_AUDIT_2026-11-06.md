# Service workbenches in both floorplan views

## Requested behaviour

- Quiet ventilation markers that respect walls, appear only while Ventilation or its vent editor is open, and deselect on background clicks.
- The 3D visibility control reads **Clearances**.
- Constant spacing between menu entries, including toolbar lists and nested wall-display entries.
- Heating, Ventilation, Electrical Layout and Energy & Insulation open from Tools in either view and keep the same document, controls, history, files and calculations.

## Implementation and review

`ServiceViewContext` retains the service window host and selections across view changes. `FullFloorplanEditor` supplies its existing controls and interactive SVG layers; there is no separate 3D copy of the service document or its controllers. The shared fitting catalogue replaces the general catalogue while it is being used in 3D.

The SVG editors occupy the measured floor in `ServiceSceneLayers`. Pointer rays intersect that floor and convert to millimetres at the rendering boundary. Picking rejects solid walls in front of the floor. Opening a service workbench uses cutaway walls and hides the roof so the editing surface is usable immediately. Parallel and perspective views use an explicit, correctly sized occlusion surface. Block SVG layout removes the inline-baseline offset between the visible floor and pointer coordinates.

Insulation/heating wall colours and U/W labels use `energyElements` and the active source-floor rooms, including their neighbours. Presentation height adjustments do not enter these calculations. Displayed wall height affects only the coloured geometry. Colours are temporary view overrides; stored finishes are retained. The existing layer, scenario and report editors remain the same components.

Heating retains UFH generation, bend controls, manifolds, exclusions, pipe drawing/editing, radiator controls and history. Electrical retains fitting selection, connections, route editing, circuit/ring controls, individual test mode, BOM and file operations. Native 3D fitting movements participate in the relevant history. An active drag is cancelled when changing views.

Vent meshes and labels no longer bypass depth testing or force their picking distance to zero. Labels respect scene occlusion as well. Clicks and double-clicks only select/edit; movement needs a real drag, keeps the initial grab offset and commits once. Background deselection also clears the shared HVAC selection in CFD.

## Verification

The review covered code/data flow, observable browser workflows and a final visual/reliability pass. Regression fixtures use the real local geometry preparation provider and isolated browser storage; they do not submit live simulations.

- Full frontend unit suite: 738 passing cases.
- Project persistence/package suite: 19 passing cases.
- Browser checks cover quiet/conditional vents, occlusion and click invariance, constant menu gaps, shared 2D/3D windows, UFH creation and dragging, precise pipe drawing/editing/undo, insulation Cancel/Apply/Undo, electrical ring testing, catalogue access, file save and BOM access.
- Final lint, production build and browser results are recorded in the release verification below.

Local logs and screenshots are in `.local-logs/service-view-*` and `.local-logs/services-3d-qa/` (ignored).

## Release verification

- Production static export and TypeScript: passed (`service-view-build-release.log`).
- `pnpm lint`: passed without warnings; 532 source modules, no orphaned modules (`service-view-lint-release.log`).
- 33 distinct browser workflows verified across the complete audit and subsequent focused reruns. The final build passed all 15 service/consistency cases (`service-view-browser-confirmed.log`); the HVAC and viewer cases also passed their release rerun (`service-view-browser-release.log`).
- Visual review confirmed full-floor UFH rendering, coloured insulation walls, selected-wall controls, vent occlusion and the electrical workbench.
- Pipe placement was checked in perspective against requested millimetre coordinates; the same suite checked corner editing and keyboard undo. Parallel UFH dragging and view-switch persistence were checked separately.
