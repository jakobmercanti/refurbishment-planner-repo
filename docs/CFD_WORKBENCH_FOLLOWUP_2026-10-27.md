# CFD workbench follow-up — 27 October 2026

Local changes only. No commit, push, deployment, worker restart or production solve was performed. Earlier uncommitted work, the unrelated website gitlink and attachments were preserved.

## Implemented

- Picked 2D values have a black point and adjacent anchored text. V targets the focused comparison plane; Esc exits. The label follows the real picked position rather than a viewport corner.
- Summary & 3D no longer opens a separate plane inspector. Verified planes load into the main building viewer. External imports remain explicitly unverified and can be inspected in 2D.
- Comparisons use one bounded, contiguous 2×2 grid with collapsed floating controls. Fullscreen expansion preserves the data and display state. Indexed comparisons retain physical-coordinate sampling and authoritative numerical deltas; legacy workers do not invent missing delta data.
- Up/Down and previous/next actions browse verified native sampled planes in 2D and main 3D. Native coordinates are checked before changing planes. Navigation replaces the selected layer, preserves other layers and measured geometry, and is blocked when the result belongs to a different setup/job/study. It never translates solved geometry into an unsolved position.
- View properties is content-sized and includes independent results-only and results-visibility controls. These change presentation only.
- Domain is grouped into collapsible seed, mesh and connectivity categories, with Collapse all / Expand all.
- Physics import and disclosure actions share a row; Objects source editing shares the object-action row. Category typography, Results spacing and control spacing follow the workbench styles.
- Thermal is embedded in Bounds. Its body shrinks within the available workbench space, keeping aligned footer buttons visible; only its content scrolls.
- Optimisation uses a shorter guided layout, optional technical identifiers and collapsible advanced information. New drafts select a valid inlet and clip initial bounds to the rotated footprint and clearance before authoritative validation. Historical drafts and physical vents are not silently rewritten.

Main source changes: `ClimoptixWorkspace`, `ClimoptixViewer`, `ClimoptixResults`, `CFDResultsViewer`, `CFD2DSlices`, `CFDSlicePlot`, `CFDPointProbeControls`, `CFDLegacyPlane`, `ClimoptixDomain`, `ClimoptixObjects`, `ClimoptixPhysics`, `ClimoptixAdjoint`, `cfdAdjoint`, and scoped workbench CSS. Shared additions are `CFDFloatingControls` and `useCFDPlaneStepper`.

## Native optimisation remains unfinished

The reported default warning was not solely a bad default value: this repository has no validated native fixed-mesh adjoint runner or durable optimisation loop. Preparation continues to return `canRun=false`; no requested movement step is reported as an executed adjoint solve. Simplifying the interface and validating the default inlet do not implement the missing solver. Execution is still disabled.

The user was asked whether to pursue a native adjoint implementation or a separately labelled ordinary-CFD search. No reply was received during this UI implementation. No substitute method was added or described as adjoint optimisation.

Legacy-worker numerical deltas additionally require the existing indexed slice API to be released to the worker/proxy. Native planes remain available without starting a new solve.

## Verification

- 11 targeted browser regressions passed, no failures/skips: eight new workbench cases, one indexed-slice/delta/probe/navigation case using the real local numerical service, and two existing real Thermal calculate/apply and error-handling workflows. This is targeted coverage, not a claim that every historical browser selector was migrated to the new UI.
- 644 frontend unit and 19 persistence tests passed.
- 65 focused slice/adjoint-preparation backend regressions passed, including the retained real native archive. No new native CFD or adjoint solve was run. One existing Starlette/httpx deprecation warning remains.
- Static production build, lint/source-usage, TypeScript and whitespace checks passed. Generated `next-env.d.ts` paths were restored.

Evidence: `.local-logs/cfd-oct27-{browser-verified,unit,backend,build,lint,types}.log`. Screenshots are in `.local-logs/cfd-oct27-qa/`.

## Additional whole-workbench audit

The subsequent request expanded the audit across all nine setup phases, all four Solver sub-tabs, review/transfer categories, equipment/refinement/boundary editors and all six embedded Thermal steps. The screenshot principles were applied where relevant: readable categories, predictable disclosure controls, compact desktop rows, reachable responsive actions, consistent spacing and data-first viewers.

### Findings fixed

- Mesh still inherited 10.8 px category text. Shared disclosure typography now also covers Solver and secondary editors.
- Simulations, Objects, Bounds, Mesh, external convergence, Export and secondary editors lacked equivalent bulk disclosure controls. Collapse/Expand now includes their groups and categories without opening row-action menus. Equipment and refinement fields are grouped by purpose. Essential error/capability notices remain explicit.
- Narrow boundary action labels overlapped. Action columns now have sufficient space, and narrow toolbars wrap instead of hiding Collapse/Expand offscreen. Desktop rows remain compact. Export actions use a balanced two-column layout.
- An external plane named like a worker artifact could become a verified plane after pressing Up. The old build reproduced this (`slice_Z_001.vtk` changed to `slice_Z_002.vtk`). Only the selected verified file can now use worker-stack navigation; external files remain view-only and cannot enter cross-run comparison. Verification and overlay eligibility are evaluated for the selected layer rather than unrelated cached imports.
- Re-downloading a verified plane creates a new browser File object. Unloading now matches the pinned study/name rather than File identity. Removing an external namesake does not unload a verified overlay.
- Compact styling unintentionally removed Expand viewer from standalone native/imported 2D inspection. Styling and comparison embedding are now separate; a standalone viewer can expand while an embedded comparison retains one shared expansion control.
- Escape now honours the focused comparison viewer before cancelling a different viewer's probe mode.
- Removed obsolete inspector request/ref state and the unused conversion of the full checked building surface into a separate inspector context. Authoritative millimetre geometry and solver settings are unchanged.

Additional source areas changed in this audit include `CFDCollapseAll`, `CFDHeatingImport`, `ClimoptixBoundaries`, `ClimoptixConvergence`, `ClimoptixEquipment`, `ClimoptixMesh`, `ClimoptixReview`, `ClimoptixStudies`, `ClimoptixSimulation`, `ClimoptixObjects`, Results/viewer/probe components and scoped density CSS.

### Final verification

- 23 distinct targeted browser checks passed: the final 22-case workbench run plus one mixed-provenance case. A separate three-case run strengthened re-download and focused-Escape assertions and rechecked mixed-source unloading. No failures or skips in these final runs.
- Layout checks cover 1440, 640 and 390 px widths, with explicit onscreen disclosure-button checks. Thermal covers every step in light/dark themes and comfortable/compact densities, with bounded content and aligned footer actions.
- Interaction checks include delayed-update scroll preservation, monitoring-probe dragging/cancellation, inlet/outlet rehosting across walls/floor/ceiling, actual native-plane navigation, stale-setup guards, anchored values and fullscreen expansion.
- Indexed slice checks use the real local numerical service: signed X/Y/Z comparisons across different meshes, vector and percentage definitions, point values and CSV physical-coordinate/provenance assertions.
- All 644 frontend unit tests and 19 persistence tests passed (663 total). All 65 focused slice/adjoint-preparation backend tests passed. Static build, lint/source usage, TypeScript and whitespace checks passed. One existing backend Starlette/httpx deprecation warning remains.

Evidence: `.local-logs/cfd-full-audit-browser-final.log`, `cfd-full-audit-provenance-focus.log`, `cfd-full-audit-{unit,backend,build,lint,types}.log`. Screenshots are in `.local-logs/cfd-full-audit-qa/`. Coverage is targeted: not every historical browser selector was migrated to the changed UI.

Native adjoint execution remains unimplemented, and legacy-worker deltas still need the indexed API release; neither was presented as functioning. No production solve or release was attempted. Everything remains uncommitted on local `master` at `0da8b87`; nothing was pushed or deployed. Unrelated local changes were preserved.
