# Room roofs and opening balustrades

Roof & ceiling keeps a shared roof by default. Enable **Different roofs by room**,
select a room on the highest floor, and enable its custom roof. Each room can use
its own profile, heights, direction, thickness, ceiling and finish. Unassigned
areas retain the shared roof and its original slope frame. Turning room roofs off
retains their settings; Cancel discards the complete draft. Room IDs survive floor
selection/reordering; copies receive independent overrides and deleting a room or
floor removes its references. New outline resets the roof as before.

The exact rendered exterior-wall envelope is partitioned once into non-overlapping
roof zones. These are architectural volumes with vertical junctions, not an
automatic valley/flashing, drainage, structure or insulation design. Lower-floor
terrace covers are unchanged. Fit/heating calculations still use measured room
geometry and explicit thermal inputs, not the rendering.

For an upper-floor slab opening, enable **Add balustrade** in its properties.
Choose Vertical metal, Horizontal rails, Glass panels, Timber spindles or Solid
parapet; set guard height and colour, then Apply opening. The entire perimeter is
guarded. This is generic visual guarding, not a certified stair/access or safety
design. The posts are set 25 mm back from the void onto the slab. Footprints must
remain clear of walls, every slab opening and other guards. Guard heights must
also fit below the slab above and their roof zone's lowest ceiling. Acute or narrow
corners that cannot support the selected section are rejected and can be reshaped
before applying. Both polygon windings are supported. Editing/moving the opening moves its guard; deleting the
opening deletes its guard; Undo and project packages preserve both.

Library → Object catalogue → **Balustrades** contains five reusable 1 m sections,
also available in Add elements. Detailed procedural rendering is separate from
four coarse CFD profiles. Open guarding keeps its large passages, but omits fine
spindles; horizontal guarding retains one coarse intermediate rail. Glass and
parapets use closed envelopes; glass retains its under-panel passage and has an
explicitly coarsened panel thickness. These choices change local drag: resolve actual
rails or calibrate porous resistance when guard pressure loss matters. Cell count
depends on the mesher; the models do not claim convergence or validated results.
Catalogue CFD previews/STLs describe individual sections, not an assembled-room
CFD export. All stored coordinates and STL labels are millimetres.
