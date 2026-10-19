# Multi-floor buildings and roof profiles (building schema v1)

This feature extends the shared planner, not a separate brand-specific editor.
All source geometry is millimetres. Plan X/Y stay in the same building coordinate
system on every floor. World vertical is Z in stored data. At the Three.js
boundary only, `(x,y,z)` becomes `(x/1000,z/1000,-y/1000)`.

## Stored model and migration

`ProjectDocument.schemaVersion` and the `.floorplan3d` package version remain 1.
The explicit, optional `building.version = 1` extension contains `activeFloorId`,
an ordered `floors` array and one `roof`. Older single-floor documents migrate
deterministically to `floor-ground`, with their original plan, room measurements,
objects, services and assets untouched, plus a default flat roof configuration.
The roof is hidden initially in the viewer to retain the familiar open-room view.
Older clients that do not understand this extension must reject it, not strip it.

Each floor has stable `id`, `name`, `elevationMm`, `heightMm`,
`slabThicknessMm` and semantic `openings`. Exactly one floor is active. Its
`rooms`, `floorplan`, `assetInstances` and optional electrical/heating/energy
documents reside in the existing project fields. Only *inactive* floors have a
`content` payload containing those fields. Geometry is therefore stored once.
Switching a floor swaps this projection; it does not translate coordinates.

Assets and their binary definitions, PlannerBuild schedules, quotations and the
render camera are project-wide. Placed asset instances are floor-local. Package
export collects referenced asset definitions and electrical photos across all
levels; shared immutable files are included once. Import validates every floor
and asset before writing a transaction. The backend project validator accepts the
same versioned extension without changing cloud API endpoints or publishing data.

## Levels, heights and copying

Elevation is the finished walking-surface height. A slab extends downward from
its own walking surface. `heightMm` is the distance to the next floor's walking
surface; clear height underneath the next slab is
`next.elevationMm - next.slabThicknessMm - floor.elevationMm`.
For the top level, the roof/ceiling profile determines the architectural ceiling.
The next slab is never counted twice.

Levels form one contiguous stack: each next elevation equals the preceding
elevation plus its storey height. Editing an upper elevation adjusts the storey
below; changing height reflows levels above. Reordering moves the level's
independent contents and recomputes elevations. Minimum clear height is 1800 mm.
This is a geometry guard, not a statutory headroom recommendation. Split levels
are not supported. Limits: 20 levels, 100 voids per level, 200 vertices per void;
existing project/package size limits remain enforced.

`+ Floor` opens a separate properties window for a blank new top floor.
**Duplicate** belongs to each floor's row in the building list. It inserts an
independent copy directly above that source, moving higher floors up. A larger
ground floor can therefore be duplicated beneath an existing smaller upper
floor without introducing an overhang. The confirmation offers an optional
furniture/assets copy. Duplicating remaps room, wall, opening, instance and service IDs,
including references and per-room label/finish maps. Shared asset definitions,
local `wall-001` identifiers, material enums and user text are not remapped.
Excluding furniture/assets also clears copied service layouts rather than
leaving dangling electrical/heating references. No objects reference mutable
content on the original level.

The floor selector and adjacent **+** management button overlay the top-right
of the drawing/viewer, without reserving a row of canvas space. **Floors &
building** is a movable, resizable, roof-first list, followed by floors from
highest to lowest. Each floor has Select, Edit, Duplicate and Delete actions.
Drag its grip to reorder, or focus the grip and use the up/down arrow keys.
Reordering is atomic and subject to the same footprint guards as drawing.
The roof remains a fixed independent entry, editable from any selected level.
Floor and roof properties open in separate movable windows with Cancel/Apply
and contextual help. Re-selecting Edit raises an existing window without losing
its draft. Unedited floor fields follow changes made in the manager, so a
reorder does not accidentally restore an old elevation when applying a name.
A compact three-column toolbar contains only Add floor,
Undo and Redo; no redundant global move, duplicate, delete, export or Done
buttons remain. Floor sections reuse the existing Overall properties
header/body styling and retain their local help.
The obsolete Build floorplan wall-height field is removed; level heights are
managed in Floor properties and top-floor roof heights in Roof & ceiling.
The floor selector reuses the main workspace dropdown class with the same panel
background in idle/hover states, plus 14 px between its label and dropdown.
It sits above ordinary canvas-toolbar shadows but below menus/dialogs. The
planner header retains a shallow header shadow rather than inheriting the
generic dialog shadow, which otherwise visibly tints this white control.
Floor/roof controls share existing theme colours and focus treatment in
Light/Dark and both UI densities.

New upper-floor geometry must stay completely inside the actual footprint of
the floor immediately below. A smaller area alone is not sufficient: concave
recesses, courtyard holes and unfinished wall runs are checked too. An invalid
edit reports “A floor bigger than the one below is not supported.” and keeps the
previous saved geometry. Shrinking a lower floor, duplicating a larger floor or
reordering cannot leave an unsupported upper level. Blank levels remain allowed;
complete the supporting floor before drawing on a blank level above it.
Existing saved geometry is never silently cropped or translated on opening;
older unsupported overhangs must be repaired before further geometry/stack edits.

Reference snapping uses a 12-screen-pixel radius, before grid rounding. It prefers
exact lower-floor corners, including non-grid coordinates, then projects onto
its wall segments. It remains optional and independent of the containment guard:
turning the dotted reference or snapping off never permits an oversized floor.

Deleting a floor removes only that level's content. The last level cannot be
deleted. Deleting the lowest level additionally clears voids in the new lowest
slab, which is no longer inter-storey. This policy is stated in the confirmation.
The project history retains previous immutable snapshots; Undo/Redo includes
floor operations, roof configuration and openings. View-only settings do not
replace geometry authority.

New outline is a whole-building reset, not an active-floor-only replacement.
Its confirmation explains that upper floors and their contents will be removed.
The lowest floor is retained with a new blank/template plan, fresh room/service
content and default roof settings. Project-wide asset definitions, schedules
and quotations are kept. Cancel changes nothing; Undo restores the entire
previous building.

## Openings and meshes

Above the lowest floor, Floor properties offers rectangle and polygon drawing.
Rectangles use two clicks, polygons use corners followed by Enter/Finish/closing
the first vertex; Escape cancels. Selected contours can move, and corner handles
reshape them. Floor properties supports exact numeric dimensions or vertices,
including inserting/removing polygon corners. Nonpositive rectangle sizes are
rejected without mirroring or moving the opening. Contours become non-interactive
and greyed while electrical, heating or insulation editing is active.
New openings and completed moves validate before updating the project.

Reject nonfinite, self-intersecting/touching, degenerate and undersized polygons,
portions outside enclosed slab area, wall crossings and overlapping voids.
Rectangles require axis-aligned 100 mm sides; all edges require 50 mm and area
requires 0.01 m². A 10 mm wall-face guard is applied. Invalid wall edits that
would invalidate an existing opening are not persisted. No stair geometry is
inserted and no furniture is automatically removed by drawing a void.

Pinned dependency: `polygon-clipping@0.15.7` (MIT,
<https://github.com/mfogel/polygon-clipping>). The existing Three.js Earcut/Shape
triangulation supports holes but does not subtract arbitrary overlapping slab
regions. Polygon-clipping performs union, difference and profile-region
intersection. Derived polygons and Three.js meshes are never serialized.
The slab's top, thickness and bottom share the same real cut-out shape. The
upper slab's bottom is the lower ceiling; no intact separate ceiling caps the
void. Raycast and triangulated-area tests verify this.

Structural roof and slab footprints union actual arbitrary/concave room
polygons with the exact rendered exterior wall quads, including unequal wall
thicknesses, mitred corners and capped junctions. Slab edges therefore align
with the outer wall faces rather than stopping at the measured inner room
boundary. Measured areas and support/fit decisions still use the unchanged
domain footprint. Exposed lower-floor portions are the Boolean difference from the level above and get
automatic flat weather covers. These are part of roof visibility, not extra
editable pitched roofs on intermediate levels.

## Roof and interior ceiling

One building roof attaches to the highest level at render time, never a saved
fixed floor ID. Add/delete/reorder therefore cannot leave an obsolete roof.
Roof & ceiling is available from its independent row regardless of the selected
floor. Removing the roof does not remove floors or change wall clear heights;
the row remains available to add it back.

- Flat: constant underside height.
- Mono-pitch: low and high underside heights define one plane along direction.
- Gabled: eaves and ridge heights define two planes. Direction follows the ridge.
- Stepped: two horizontal zones, one dividing fraction and a vertical step face.

All use one shared profile/frame and surface generator. Boolean clipping splits
polygons at a ridge/step before triangulation; triangles cannot span the two
planes. Tiny degenerate clipping slivers are discarded. Boundary closure faces
and roof thickness are generated explicitly. A pitched high side/ridge and
distinct step zones require at least 50 mm rise. An independent flat ceiling
must not cross the lowest roof underside.

The roof exterior and interior ceiling are separate surfaces. Following-ceiling
mode uses the underside; independent-flat mode adds a separate horizontal cap
and retains the void between it and the roof. Drafts preview without saving;
Apply commits and Cancel discards. The optional `enabled` and `finish` roof
fields preserve legacy roof documents. Finish contains material, hexadecimal
colour and physical tile/panel repeat sizes in millimetres. Clay tiles, concrete
tiles, slate, cement and standing-seam metal use deterministic procedural
textures, appropriate roughness/bump and matching fascia. This is visual finish,
not thermal performance or a product specification.

**All floors** and **Roof** are non-destructive toggles in the 3D viewer and
Settings → View. Revealing a roof from a lower selected floor also reveals the
whole stack. **Exterior view** selects solid walls, the whole building, roof,
perspective and a fitted camera. Furniture, imported
models and people receive the floor elevation once at their group boundary.
Changing floors closes floor-specific heating/insulation editors without
remounting the building manager or losing its independent property windows.
Restored docked canvas tools register behind existing editors; manually focused
windows, including service editors, still share the normal foreground stack.

## Exports and engineering scope

Project Save contains all levels. Existing detailed 2D SVG/image/PDF exports
remain selected-floor exports and omit opening edit handles. The unconnected
floor-set PDF generator and its obsolete test were removed during the audit;
there is no hidden export action in Floors & building. Portable project exports
still contain every floor and referenced model. Existing 3D captures use the
selected inspection view.

This is an architectural modelling feature, not structural design, stair design,
roof framing, dormers, intersecting multi-wing roof systems, split levels or CFD.
Opening semantics and separate ceiling surfaces are hooks for future air volumes;
no simulation/meshing coupling was added. Existing room-based fit and heating
tools retain their measured-room inputs and assumptions. Review slab support,
sloped clearances and inter-storey heat-transfer boundaries separately; the new
visual model is never used as evidence of product fit or regulatory compliance.

## QA checklist

Automated coverage: `building.test.mts`, `buildingRevision.test.mts`, `buildingAudit.test.mts`, `buildingInteractions.test.mts`, `buildingPersistence.integration.mts`,
`test_building_document.py`, plus the existing frontend/backend suites.

1. Open a legacy project; verify room shapes, furniture, doors/windows and flat
   roof configuration; save and reopen the full package.
2. Copy ground to first; rename/edit/move furniture upstairs; return downstairs
   and verify no change. Repeat with a blank floor and assets excluded.
3. Use floor-below reference and snapping with a smaller upper L/U footprint.
4. Draw rectangle/polygon voids; try overlap, wall crossing and self-crossing;
   verify rejection, exact edits, dragging, Undo/Redo and reload.
5. Inspect whole building in 3D with roof hidden: see through the upper slab to
   the lower room. Check slab edges, exposed lower covers and furniture heights.
6. Preview/apply/cancel every roof profile at 0/45/90 degrees and both ceiling
   modes. Edit the roof while an intermediate floor is selected; check all five
   finishes, colour persistence and both sets of roof visibility controls.
7. Add/delete/reorder the top level, confirm roof reattachment and no old roof.
8. Export selected-floor drawings, the complete project package and 3D captures. Save/load assets
   referenced only by an inactive floor.
9. At desktop and 320–390 px widths / 520 px heights, expand floor/roof help and all
   properties; reach the final button without horizontal clipping.
10. Duplicate a larger lower floor beneath a smaller top, drag/keyboard reorder,
    reject an unsupported move, and verify isolated Edit/Cancel/Apply and delete.
11. From an upper floor, cancel and confirm New outline; only the lowest floor
    survives and Undo restores the complete building.

All development and testing on `multifloors` is local; no push or deployment is
part of this implementation request.

## Validation recorded for this implementation

- Frontend: 465 unit tests and 10 persistence/package integration tests pass.
- Backend: 190 tests pass. The existing Starlette/httpx deprecation warning
  remains; no dependency upgrade was bundled into this feature.
- Frontend lint, TypeScript and the local production/static build pass.
- Disposable-browser checks pass for legacy migration, copy/select/rename,
  opening drawing/validation/resize/history/reload, all four roof types,
  independent ceilings, three-dimensional stacking, roof visibility, blank-floor
  saves/deletion, contextual help and small-screen bottom access.
- A three-storey browser check resizes real upper-floor walls and moves copied
  furniture without changing either lower level, then inspects the smaller top
  footprint and automatic exposed lower-level weather cover in 3D.
- Browser boundary checks reject oversized corner drags and unfinished wall
  runs without changing the saved floor, then verify near-miss clicks land on
  exact dotted reference corners. Overlay bounds confirm no canvas height is
  reserved for floor controls; the management window remains scrollable at
  390 px widths / 520 px heights.
- Existing electrical, heating and insulation browser workflows pass, including
  module-specific history, exports, UFH resets and insulation U-value regressions.
- Floor-control checks use the actual Default/Modern palettes in Light/Dark and
  both densities, including narrow/short viewports, scrollable property windows,
  a roof-first responsive list, compact actions and the existing dropdown style.
  New browser regressions cover lower-floor duplication, independent property
  edits, mouse/keyboard reordering and rejection, blank-floor reference snapping,
  roof finish previews/Cancel/persistence, both visibility menus and the
  whole-building New outline reset.
  Mouse, keyboard and touch reorder paths pass. Floor changes close service
  editors without closing the building manager. Header/selector controls and
  floating-window close buttons remain reachable after repeated resizing.
  Roof deletion also removes the 2D ridge indicator, with Undo restoring it.
- Additional browser checks cover L-shaped/notched outline resets, furniture
  exclusion, Add floor help, draft-preserving refocus, service-window stacking
  and a rename applied after reordering with the properties window still open.
  Cutaway slab and textured exterior screenshots were visually inspected.

Obsolete catalogue/style/currency test expectations were aligned with the
already-shipped defaults; those product defaults were not changed here.

## Independent follow-up audit

Later user requests supersede the original brief's top-floor-only editor and
copy-below popup: the roof is now an independent building entry, and a floor is
duplicated from its own row. Likewise the old button grid and redundant export
action were intentionally replaced, not retained as parallel workflows.

New regression tests reproduced four unit-level failures and five browser
failures before the follow-up fixes:

- Floor selection/viewport state consumed modelling history and cleared Redo.
  History now compares canonical level contents independently of the active
  legacy projection, ignoring viewport fields on every floor.
  A deeper browser trace found that entering a floor regenerated verified
  measurements with 5 mm uncertainty and added detector defaults. Restoring a
  floor now preserves measurement values, sources, uncertainty and verification;
  only an explicit dimension edit creates a new unverified measurement.
  Benign detector/default hydration does not create a model-history step.
  History comparison also canonicalizes object-key ordering introduced by
  schema parsing, without discarding array order or measurement changes.
- A live roof draft forced roof visibility even after pressing Hide roof.
  Draft geometry and view visibility are now independent; preview availability
  is shared by the viewer and Settings menu.
- Selecting another floor discarded the displayed roof draft despite leaving
  the editor open. Draft ownership now stays with the independent roof window.
- Switching profile replaced a valid entered ridge height with a default rise.
  Only an invalid rise is repaired; the minimum roof underside calculation is
  shared between validation, ceiling controls and the scene.
- The 2D ridge used the inner outline while the 3D roof used exterior walls.
  Both now use the same millimetre-authoritative structural footprint.
- Global opening shortcuts could delete a void while a toolbar button was
  focused. Drawing shortcuts now respect form, toolbar and dialog focus.

File replacement and New outline start a fresh document session, including
when reopening a file with identical persisted IDs. Session-scoped callbacks
reject late writes; property drafts, drawing tools and selections are cleared.
Ordinary floor selection does not reset an independent roof draft.
Legacy measured ceilings between 1800 and 2400 mm are no longer silently raised
to the 2400 mm empty-project default. The independent roof editor explicitly
identifies its owning top floor.

Cleanup removes the test-only legacy copy-below branch, unreachable PDF code,
obsolete add-dialog selectors and unused upper-floor visibility flag. A single
floor-editor target replaces conflicting Add/Edit booleans. Persisted legacy
floorplan height fields remain necessary for compatibility and room geometry;
they are not obsolete merely because their old UI control was removed.

The new browser audit uses a fresh 6400 × 4200 mm three-storey fixture with
unequal wall thicknesses and a stair void. It checks draft visibility using
rendered pixels, profile height preservation, keyboard focus isolation,
navigation/Undo/Redo, project replacement, reset behaviour, and a separate
24-case dropdown/theme/density/viewport matrix. Earlier comprehensive workflows
remain regression checks, not substitutes for these new cases.

Final follow-up results: all 10 new browser workflow groups pass, including the
24-case UI matrix, verified-measurement preservation and single-step Undo/Redo
after navigation. The broader 40-case UI matrix, independent-window/non-rectangular
outline checks and existing electrical, heating and insulation regressions also
pass. Frontend lint, TypeScript/static production build, 460 unit tests, 10
package/persistence tests and 190 backend tests pass. The backend emits one
existing Starlette/httpx deprecation warning. Checks used disposable local browser
profiles and synthetic projects; nothing was pushed or deployed.

## Seven-point interaction follow-up

- New outline first chooses the template, then opens a separate destructive
  permission dialog listing the removed contents. Its default action is Cancel;
  Cancel/Escape returns to the chooser without changing the project. Only
  **Delete contents & start** applies the reset. Project Undo restores the stack.
- Floor grips now use pointer capture for mouse, touch and pen instead of mixing
  native dragging with a separate touch-only path. Keyboard arrows and native
  row drops remain supported. Reordering preserves names; the roof stays fixed.
- Rectangle/Polygon opening actions use two equal full-width grid columns.
- The floor dropdown offers **Whole building** in 3D, synchronized with the
  existing All floors view setting. Selecting a named floor restores selected-
  level mode. This changes viewing, not the active floor's geometry.
  Returning to Exterior preview retains an independently edited roof draft.
  Entering 3D cancels unfinished opening tools and clears their 2D selection.
- Clicking the opening canvas explicitly transfers keyboard focus to it.
  Enter/Return finishes valid polygons; right-click does not open unrelated
  toolbar menus during drawing. Backspace/Delete removes the last draft corner,
  so an invalid self-crossing draft can be corrected without starting again.
- **Keep opening sides square** is available in the opening section and drawing
  strip. It constrains new polygon edges, closes the final corner orthogonally,
  and retains adjacent right angles when dragging a vertex. Turn it off for
  angled polygons. Rectangles always remain square. No measured wall moves.
- Roof & ceiling opens as a larger movable window, with all settings on the
  left and a live orbitable, zoomable 3D preview on the right. The preview reuses
  `BuildingRoof`, including real profile/ceiling surfaces and procedural finishes.
  Invalid dimensions pause preview rather than generating broken geometry.
  Fit restores framing. Narrow windows stack the panels and shorten the preview
  for short screens; all bottom controls remain scrollable and reachable.

Focused domain regressions live in `buildingInteractions.test.mts`. Disposable
browser checks exercise the seven reported workflows, including real grip
dragging, warning cancellation, self-crossing correction, roof Apply/Cancel and
32 actual palette/theme/density/viewport combinations. The production build and
existing building/service regression suites are rerun before branch publication.

Validation of this follow-up: all seven focused browser groups and all ten
independent compatibility groups pass. The broader 40-case building UI checks,
32-case roof UI checks and existing electrical/heating/insulation workflows pass.
Frontend lint, TypeScript, the static production build, 465 unit tests, ten
persistence/package tests and 190 backend tests pass; the existing backend
Starlette/httpx deprecation warning is unchanged. No deployment is part of this
branch publication.
