# CFD surface and setup UI audit — 24 October 2026

Scope: the ten screenshots in this round. Changes are simulation-local; measured source rooms, objects and dimensions remain authoritative and unchanged.

## Screenshot checks

1. Refinements render as filled, double-sided translucent cuboids in their refinement-level colour, rather than triangulated wireframes. The actual production renderer's geometry and material were inspected in the browser test.
2. Supply/extract devices render as opaque blue/pink surface patches. Their vertices lie on the canonical wall, floor or ceiling host plane, with a 2 mm display-only offset to avoid z-fighting. Selecting a device or refinement uses orange and centres the camera. Level 5 no longer uses orange; boundary-group colours do not override vent-role colours. Selecting a device outside the current room view reveals the building and focuses that device. Existing vents can be repositioned using **Place this vent on face…** without duplicating them.
3. The legend retains colour keys and removes both lower explanatory text lines.
4. Form grids use three columns at the reported 960 px window width and four at wider widths. Related XYZ vectors keep their own three-column groups. Narrow layouts remain reachable without horizontal overflow.
5. The full-width preparation error/retry row is removed. Preparation failures remain actionable in Export → Review/Warnings using Refresh checks. Rejected input/import feedback remains visible in its active form; safeguards are not suppressed.
6. Boundary groups have explicit condition and surface-assignment actions. The assignment checklist transfers unique existing surfaces into a group and returns unchecked members to Default surfaces. Overrides and stale references are preserved for explicit review. Device conditions remain controlled from Objects. Empty groups can hold condition templates before a domain is available.
7. Every probe has explicit **Probe n X/Y/Z (mm)** labels. Remove shares the coordinate input row. The browser verifies vertical alignment.
8. Connection state is plain status text, not a bordered pill or button, with consistent section spacing.
9. Post-processing separates sampling directions, fields/cadence and calculated plane positions. YZ/XZ/XY slice labels identify the corresponding X/Y/Z normal. Counts disable when their direction is unchecked. Missing domains show requested counts and domain guidance rather than a misleading zero-plane result. Output cadence explains saved field sets versus iterations.
10. Import and export actions centre text horizontally and vertically. Equal-width transfer tabs retain tab semantics, with help kept at the right of the same row even on phones. Text bounds, help alignment and overflow were checked at 1440, 960 and 390 px.

## Validation

- `pnpm lint`: passed, including source-usage checks.
- `pnpm typecheck`: passed after restoring generated development declaration paths.
- Production static export: passed with `/planner` base path and programmer tools disabled.
- `pnpm test`: 588 unit tests and 19 project tests passed.
- `uv run pytest tests/test_climoptix.py -q`: 153 passed. Existing FastAPI/httpx deprecation and pytest-cache permission warnings do not affect results.
- New production Edge browser audit: all four scenarios passed, inspecting actual rendered materials/camera and performing real pointer placement, boundary assignment, responsive layouts and missing-domain checks. Screenshots were visually reviewed; ignored local evidence is under `.local-logs/cfd-surface-*`.
- Existing production Edge regressions: all 26 tests passed across `climoptix.browser.mts`, `climoptixWorkflow.browser.mts`, `compactCFD.browser.mts` and `screenshotFixes.browser.mts`, including input rejection/recovery, dragging, navigation, light/dark layouts, phone layouts and fullscreen restoration.
- After the final phone help-alignment adjustment, the four targeted scenarios and six compact/responsive regressions were repeated together: all ten passed.
- Public preparation and geometry API regression: drawing-only empty/prefixed symbol URLs are omitted from CFD requests on active and inactive floors without mutating the document. Measured geometry and opening representation metadata remain intact. Unknown external URLs are still rejected by the unchanged server security guard.

## Safety boundaries retained

Snapping proposes a host-plane UV location and keeps the rotated footprint within the host frame. Only the deterministic provider validates real polygon edges, holes, obstructions, clearances and overlaps. A seed room and current preparation are still required for surface assignment. Missing/invalid domains cannot produce runnable OpenFOAM settings or run a solver. Diagnostic preparation ZIPs may still contain blocked preflight reports, but do not include an exportable STL for invalid geometry. No mesher, solver output or residual data is fabricated.

Unrelated nested-checkout and attachment changes are excluded from this commit.
