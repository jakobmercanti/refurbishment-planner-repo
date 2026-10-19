# Planner UI conventions

## Controls and window layout

Use the shared palette and control tokens instead of hard-coded light surfaces.
Keep equivalent actions aligned in equal grid tracks (`minmax(0, 1fr)`), allowing
long labels to wrap. Buttons with different roles need not all share one width.

Window help uses `WindowHelpButton` and the shared `--window-icon-size`: 28 px in
Compact density, 32 px in Comfortable density and 36 px in a compact/touch
workspace. Header close controls use the same square contract. Form-button
minimum heights must not stretch question-mark buttons.

Docked windows divide the usable area *below* the pinned floor selector. Reserve
that strip for every slot, not just the first window; otherwise the first
window can cover the next header. Free windows remain independently movable.

## Appearance and data

Theme and density belong on the document root so body portals inherit them.
Check Default and Modern styles in Light and Dark, including selected, disabled,
empty and populated states. System appearance must follow device changes; fixed
Light/Dark must not. Appearance preferences must survive reload.

Pair foreground and background changes. Do not recolour project-owned room
fills, materials, symbols, activity colours or exported customer documents to
make application chrome dark. Gantt label contrast is derived at render time;
its progress overlay must preserve label contrast without editing the chosen
activity colour, dates or progress.

## Wording and contextual help

Use consistent British English and human-readable labels, never internal field
keys. Generic confirmation is **OK**; use Save, Apply, Done and destructive
labels only for the actions those controls actually perform. Keep unknown
values distinct from zero; `formatUiCount` handles singular/plural counts.

Match help to the actual window and controls before writing its instructions.
For example, electrical-layout import offers **Replace layout**, not a Merge
action. Explain validation, cancellation, what is replaced and the available
Undo/backup route without inventing a preview or an unsupported operation.

Specific tasks in `workspaceHelp` and quote topics take precedence over broad
legacy word matching in `windowHelp`. Service-field help includes its module
context: thermal display controls must not receive electrical routing help,
and roof *layers* must not receive architectural roof-shape help. Custom source
or calculation help can supply explicit steps.

Help is independent of an accordion's disclosure action. Opening it must not
apply a draft or close the original editor. Tab remains inside help; Escape
closes only help and returns focus to its opener, including inside native
dialogs. Check long help content at short and narrow viewports.

## Validation

Run frontend unit tests, project/package integration tests, lint and a production
build. For shared UI changes, also exercise floor management, roof previews,
electrical import/export and history, heating/UFH, insulation scenario isolation,
and theme persistence in a disposable browser with synthetic projects. Include
populated schedules with pale and dark activity colours, not only empty states.
Check the actual viewport outcome, bottom controls, overflow and keyboard focus.
Measured geometry, thermal results and stored millimetre values remain
authoritative and must not change when appearance settings are changed.
