# People catalogue and furniture placement

People is a top-level Object catalogue category and a top-level mode alongside Doors and Windows in the 2D/3D Add elements windows. Eighteen additive defaults cover Standing, Seated and Lying down at 900, 1200, 1500, 1650, 1800 and 1950 mm standing stature. Custom stature accepts 600–2300 mm. Stature is not the height of the posed envelope: a lying person's long dimension is depth, while seated height includes the seat datum and upper body. All saved values are millimetres.

Display styles are Casual, Smart and Mannequin. The detailed procedural model includes shaped clothing, articulated limbs/joints, shoes, hair and facial features where appropriate. Skin, hair, top, trousers and shoes have independent colour regions. The large catalogue preview supports orbit, zoom, Fit and style switching. Catalogue thumbnails are generated from the same renderer. These are generic illustrations, not anatomical scans, ergonomic certification or manufacturer data.

## Place a person on furniture

1. Select People in Add elements and choose a posture/stature.
2. For Seated or Lying down, select suitable furniture already in the current room. Seats, sofas, armchairs, benches and beds support seated poses; lying poses require a bed.
3. Review the contact height above the furniture's base. Defaults are nominal estimates (seat/cushion or mattress/blanket datum), not measurements. Choose Centre, or Left/Right on a sufficiently wide support, then Align to furniture.
4. Add person on furniture commits a new supported person directly. Free-standing placements continue to use the standard placement cursor. Existing people update through the normal edit workflow.

The pelvis or lying-body datum aligns to the selected surface. Seated legs adapt to the seat height; short occupants can have dangling feet. Long beds retain a rear allowance for the headboard. Support width/length, room boundaries and room height are checked before alignment. These guards do not certify real-world body/furniture fit.

Support links are local to the room. Moving/rotating furniture updates attached people. Manually moving a person detaches it. Deleting, transferring or invalidating its support detaches it at its last safe pose instead of deleting the person. Floor duplication rewrites links to the copied furniture. Pose, appearance and support information survive project save/reload, IndexedDB and portable project packages. The existing one-per-room Human mock-up usability tool remains separate and unchanged.

`Obstacle.person_spec` stores posture, standing stature, display style, seated datum and optional furniture ID/surface height/lateral offset. Import validation rejects malformed configurations, mismatched model/posture and missing or unsuitable support references. Catalogue templates remain ordinary reusable fixture records; no new fixture-kind enum or mandatory project migration is needed. Re-running the People seed does not overwrite customised names, dimensions or active status.

## CFD and fit separation

Each posture has an independent versioned CFD profile in `furniture_items.cfd_proxy`, visible through the existing CFD shape button and millimetre STL download. The three profiles contain 100–112 triangles, with limbs joined into watertight surfaces. Arms are merged into coarse torso/lap volumes; face, hair, fingers, clothing and other small features are omitted. Major leg passages remain open. Nominal solid volume stays within 10% across postures at every stature preset; this is a consistency guard, not body-mass calibration. Detailed display styles and colours do not change these surfaces.

Exports describe **catalogue-local nominal templates**, not an assembled room simulation. They do not include the chosen furniture, room mounting transform, or an instance's adapted seated datum. When assembling a CFD case, set the actual stature, seat/support datum, placement and units explicitly, and union intentional contact surfaces as appropriate. Heat flux, respiration, metabolic loads, boundary layers, solver meshing and mesh-convergence assessment are not supplied by these geometry assets.

Measured obstacle envelopes remain authoritative for fit/collision/uncertainty checks. Neither detailed renders nor CFD vertices decide fit. A consistent, explicitly declared occupant/furniture support overlap is reported as VERIFY, not a false collision or a certified pass. Unrelated collisions remain active; stale/misaligned support metadata cannot bypass collision checking.

## Validation

Regression coverage includes all stature/posture presets, additive/idempotent seeding, API/CFD coverage, finite dimensions, every closed/outward/connected CFD surface, explicit support-contact safeguards, arbitrary furniture rotations, dragging/deletion, height/width/bed-length/room guards, duplicated links, persistence and malformed imports. Browser checks exercise all 18 entries and styles, direct supported placement, custom stature, in-building 3D, help, narrow layouts and light/dark themes. Optional Gmsh checks volume-mesh the actual exported STL surfaces and independent surrounding fluid domains; these do not constitute CFD accuracy validation.
