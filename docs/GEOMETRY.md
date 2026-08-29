# Geometry convention

## Coordinates

- X and Y are horizontal millimetre axes.
- Z is vertical in millimetres; the finished floor is `Z = 0`.
- The room origin is an explicit project choice; the fixture uses its first polygon vertex.
- Room vertices are counter-clockwise (CCW) when viewed from +Z.
- Angles and placement rotations are degrees counter-clockwise about +Z.

The room polygon is the finished internal wall boundary. Its area is usable internal space. Wall
thickness is derived on the exterior/right side of every CCW directed edge and therefore never
shrinks the room.

For edge direction `(dx, dy) / length`:

- interior normal = `(-dy, dx)` (left normal)
- exterior normal = `(dy, -dx)` (right normal)

## Validation

Polygons must contain at least three distinct vertices, have no consecutive duplicates or
zero-length edges, be simple (no self-intersections), have positive area, and be CCW. Invalid input
is rejected with a specific error rather than repaired or guessed.

## 2.5D model

The fit kernel uses robust 2D footprints plus explicit Z intervals. Physical objects collide only
when both their XY geometry and vertical intervals overlap. Doors additionally expose a sampled
swept-sector clearance envelope. FreeCAD consumes the same footprint and height values to produce
solid geometry and actual opening cuts.

