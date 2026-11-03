# Heating and Ventilation UI audit — 3 November 2026

This update implements the twelve annotated screenshot requests. Changes use the existing window controls, theme tokens, density settings, measured geometry, shared HVAC document and CFD preparation path.

## Pass 1: requirements and implementation

1. Room target temperature guidance joins Room setup and the main Heating help. The field no longer reserves space for a question button.
2. UFH setup and drawing actions are collapsible. Their height follows the top tabs. Nested field guidance is retained in parent help instead of repeated buttons.
3. Manifold labels have an opaque white background and contrasting border/text over pipework.
4. Canvas layers use three columns when the window is wide, two when compact, with Select all and Deselect all inside the section.
5. Parallel-run Apply regenerates the selected zone's physical paths. Requested spacing respects the measured available span and minimum bend radius. Four equal actions form two columns and two rows; circuit summaries use small regular text and the duplicate covered-area paragraph is removed.
6. Add supplementary radiator is the fourth action inside the zone's collapsible section.
7. Heating result cards fill the section width and offer an All rooms / named-room filter.
8. Ventilation room/scenario field help joins the main guide.
9. Shared help controls consolidate nested guidance throughout floating windows and ordinary dialogs. Main help collects hidden topic content; Heating includes guidance for inactive tabs as well. Preferences and roof dialogs receive browser coverage.
10. Vent lists have more spacing and explicit Edit actions. The positions table edits normalized host U/V and shows measured X/Y/Z in millimetres. Checked host faces are obtained without first opening CFD. Main 2D and 3D floorplan markers move the canonical device, support cancellation, and open the shared full-parameter editor. Wall vents keep their height during 2D moves.
11. Conventional ventilation calculations use a semantic table with visible cell borders and small regular text, including ACH rows.
12. The action is named Evaluate in CFD. Export calculations requests the native Save As picker directly from the click, writes the chosen file, and handles cancellation. Browsers without that API retain a download fallback.

## Pass 2: robustness and visual audit

Reviewed state ownership, source staleness, geometry invalidation, undo, worker failure, locked circuits, independent scenarios and both viewer transforms. Corrected issues found during review:

- Reopening Heating no longer buries a shared modelling edit beneath a mode-only history entry.
- UFH errors appear once beside the affected zone; invalid generation preserves existing routes. Draft changes made during generation also prevent a stale result from replacing the newer input.
- Host requests are deduplicated, bounded, cancelled on geometry changes/unmount, and safely restart after an aborted request.
- Visible 3D service markers receive matching editor hit priority through foreground walls. Their labels stay below floating windows.
- Permanent edits from the separate vent editor follow the current room operation while retaining independent scenario overrides.
- Existing browser assertions now inspect canonical shared vents and the current Optimisation phase, rather than obsolete per-case vent copies or retired layouts.

Screenshots inspected for UFH controls, calculations and the 3D editor. Existing browser cases cover desktop/tablet/phone, light/dark, compact/comfortable, room isolation, reload, preflight failure, and two-way CFD changes.

## Validation

- `pnpm test`: 727 unit checks and 19 project/persistence checks passed. The final targeted help, preferences and UFH run-count checks also passed (16 checks).
- `pnpm lint`: passed without warnings; source usage checked 520 modules with no orphaned modules.
- `pnpm typecheck` and the static production build: passed.
- Browser audit: all 53 cases across Heating, HVAC, CFD UI, roof and viewer suites passed. A further six cases passed on the final release build, including one additional independent-scenario regression: 54 distinct browser cases passed overall.
- `uv run --no-sync pytest` for `test_hvac_document.py`, `test_climoptix.py`, `test_climoptix_defaults.py` and `test_heating_catalogue.py`: 170 passed. Two dependency/cache warnings were non-fatal; test temporary storage was redirected to the writable workspace.
- `git diff --check`: passed.

The final release browser run confirms real main-floorplan 2D and 3D dragging, keyboard Edit access, undo, valid/invalid UFH apply, responsive layer columns, native picker writing/cancellation, retained help, regular table typography and independent operating scenarios. No remaining blocker was found in this scope.

## Practical limits

In the reported 6.3 m² room, 30 runs require approximately 64.8 mm spacing. A 50 mm minimum bend radius requires at least 100 mm spacing for this serpentine generator. Apply explains the conflict and preserves the saved route; valid counts regenerate it. Minimum bend radius is never silently reduced.

Host-frame snapping is editing assistance. CFD preparation remains authoritative for polygon holes, opening intersections, clearances and overlapping vents. A reachable preparation API is required to obtain measured hosts; existing unassigned vents require an explicit host choice. This UI update does not change native solver capabilities.
