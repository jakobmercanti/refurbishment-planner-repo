# Local interaction follow-up — 26 October 2026

No remote push, Railway deployment, worker restart or live solver job. Unrelated
website checkout and attachments remain untouched. This follows local a54891e.

## Four screenshot requests

1. **Checkbox/entry scroll jump:** reproduced on the existing static build:
   clicking a sampling checkbox changed the setup panel's scrollTop from 1185
   to zero. Shared FloatingToolbar intrinsic-height measurement temporarily
   expanded its content, causing nested scroll containers to be clamped to zero.
   It now snapshots and restores active nested/ancestor scroll positions around
   that synchronous measurement. Checkbox and numeric entry behavior is retained;
   no preventDefault or global forced-top behavior is used. Minimize restoration
   also focuses the titlebar without scrolling.
2. **Preferences consistency:** navigation, currency, temperature and flow use
   the same two-column label/control rows, with the input column aligned to the
   top right-hand density button. Each dropdown reserves the same help-button
   space and uses 12px bold text, including controls without a help button.
   Borders, background and rounded corners also match across all four selects.
3. **View properties:** checkboxes occupy two columns. “2D wall outlines” removes
   wall fills and shows edge geometry, preserving selectable checked wall planes,
   camera and authoritative model geometry. The offline building fallback reuses
   the existing display-only 2D cutaway mode. This is not a solver/model change.
4. **Cross-surface vent dragging:** captured-pointer motion considers real checked
   wall/floor/ceiling intersections instead of staying on its initial host plane.
   The same vent previews on its new host and commits once on release; placement
   editor drags remain draft-only until OK. UV frame/clearance snapping is retained;
   authoritative preparation still checks actual polygons, holes and obstructions.
   Flow, temperature, dimensions, IDs and source rooms are not rewritten.

## Scope

Shared window behavior: frontend/components/FloatingToolbar.tsx.
Preferences: SettingsDialog.tsx and app/density.css.
Display/dragging: ClimoptixViewer.tsx, ClimoptixWorkspace.tsx and the optional
read-only wall mode in EngineeringViewer.tsx. No backend/domain-kernel change.

## Verification

New browser coverage is in frontend/tests/browser/cfdFollowup.browser.mts:
sampling checkbox + numeric input scroll, independent thermal source checkbox
and Preferences modal scroll, all four Preferences dropdowns at desktop/phone
widths, two-column controls/real wall edge meshes, and eight actual pointer
transfers covering both inlet and outlet across adjacent walls, floor and ceiling.
Assertions preserve original rooms and all non-host vent properties.

Baseline failure: .local-logs/cfd-followup-baseline.tap.
Final verification:

- 38/38 browser regressions passed: .local-logs/cfd-followup-regressions.tap
  (new interaction cases plus defaults, units, real 3D placement, thermal editor
  round trips, invalid drafts, desktop/mobile themes and shared window controls).
- 5/5 focused cases passed again against the final matching-dropdown build:
  .local-logs/cfd-followup-final.tap. This also verifies all non-host vent settings
  survive the eight real pointer transfers. No synthetic event shortcut is used.
- Frontend unit: 626 passed; project persistence: 19 passed, in
  .local-logs/cfd-followup-unit.log.
- Production static build, TypeScript and lint/source-usage checks passed.
  Development next-env.d.ts imports restored after the build. No backend code
  changed, so a new native solver run was neither necessary nor performed.
- Visually inspected followup-preferences-1440.png and followup-wall-outlines.png
  in .local-logs/cfd-results-qa/. Preferences alignment also has 390px assertions.
