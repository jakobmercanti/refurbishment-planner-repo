# Floorplan code review implementation checklist

Source: [1 - code review floorplan](https://docs.google.com/document/d/1v9NH31ovANNTN6rERHOtpW1D_offMqkNAxjlt8qRsk8/edit), reviewed 4 September 2026, including all ten rendered pages and red-pencil annotations.

Branch: `09_01_code_review`, based on `master` at `b674215`.

The repeated Overall properties sections describe the same change and are tracked once. The global removal of redundant inner window titles takes precedence over older titles visible in the other illustrations.

## Acceptance checks

- [x] All 2D/3D floating windows use one larger, bold title without the duplicate inner numbered title.
- [x] Scrollbars remain clickable and draggable; outer borders still resize windows.
- [x] Compact `2D` / `3D` toggle replaces the top-right deterministic-engine label.
- [x] New outline / Modify are first; Undo / Redo follow construction actions.
- [x] Add room exposes explanatory text, a 2000 mm default depth, and an apply button.
- [x] Add room extends outside a boundary wall with three walls and two corners, preserving the original room.
- [x] Invalid/internal-wall room additions are rejected without modifying geometry.
- [x] Remove room requires confirmation and preserves neighbours' shared boundaries.
- [x] Build checkboxes have consistent dimensions and a two-column layout.
- [x] Show measurements replaces Show all measurements; redundant lower help text is removed.
- [x] Measurement visibility toggle includes wall, custom, door, and window measurements.
- [x] Selected wall length label matches the specification; input and apply button share a row.
- [x] Wall thickness uses explicit apply; default thickness affects only walls without individual overrides.
- [x] Obsolete Add point at midpoint / Remove wall segment controls are removed from the selected-wall panel.
- [x] Overall properties units appear inline in parentheses.
- [x] Coordinates have the requested instruction and Corner ID / X / Y headers, and use available resized height.
- [x] Room actions start with Validate geometry; Open selection in 3D is renamed; buttons are equally wide and consistently spaced.
- [x] Opening fields place Parent wall / Offset together, then Height / Width.
- [x] View properties places thickness checkbox and counts on separate rows.
- [x] Displayed wall thickness changes the spacing between thin wall edges, not the edge-line thickness.

## Review and validation

The team lead coordinates requirements and integration. Implementation is divided between editor/room operations and shared UI. Cross-review covers geometry safety and UI compliance; authors do not provide the sole review of their own changes.

- Backend baseline: `uv run pytest`: 58 passed (existing dependency/cache warnings).
- Room detection baseline: three tests passed; all `.test.mts` suites are now included in `pnpm test:geometry`.
- Final geometry suite: 97 tests passed, including 21 room-operation and two explicit-thickness regression tests.
- Production build and TypeScript checks passed. ESLint reports no errors and one existing mount-effect dependency warning.
- Browser verification used `http://127.0.0.1:3000/` to avoid overwriting the user's `localhost` draft.
- Native scrollbar click changed scroll position from 0 to 96 without resizing; outer-edge drag resized the panel from 340 to 440 pixels.
- Explicit 250 mm wall override survived changing the default from 100 to 200 mm. Typing a value did not alter geometry before Apply.
- Applying the current 200 mm default explicitly created an override; changing the default to 300 mm retained that wall at 200 mm and the earlier override at 250 mm.
- Adding the 2000 mm right-hand room retained corners 1-4 and created corners 5-6 at X=4400 mm; room validation returned 3,600,000 mm2 and a 7,600 mm perimeter.
- Removing that added room retained the original rectangle and its door/window; Undo restored both rooms and selected Room 2.
- Hiding measurements removed wall and opening dimension elements while retaining both opening graphics.
- Enlarging Coordinates to 429 pixels displayed its header and all six corner rows.
- Open selection in 3D switched to the expected room; the browser reported no captured errors.
- Geometry regression coverage includes all four room-extension directions, reversed winding, three-room removal, partial shared boundaries, metadata/lock retention, post-removal wall dragging, repeated operations, and 199/200 mm clearance boundaries.
