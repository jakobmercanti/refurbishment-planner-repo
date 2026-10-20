"""Conforming low-detail boundary of a union of upright polygonal prisms.

Coplanar patches are merged before constrained triangulation. Shared feature
vertices are inserted on both adjacent faces: simplification must never create
T-junctions, internal faces or cracks in an exported obstruction.
"""

from itertools import pairwise

from shapely import Geometry, constrained_delaunay_triangles, get_parts, unary_union
from shapely.geometry import Polygon
from shapely.geometry.polygon import orient

from geometry.cfd_profiles import Prism

Point3 = tuple[float, float, float]
Plane = tuple[float, float, float, float]


def _polygons(geometry: Geometry) -> list[Polygon]:
    return [part for part in get_parts(geometry) if isinstance(part, Polygon) and part.area > 1e-14]


def _drop(plane: Plane) -> int:
    return max(range(3), key=lambda i: abs(plane[i]))


def _project(point: Point3, plane: Plane) -> tuple[float, float]:
    axes = [i for i in range(3) if i != _drop(plane)]
    return point[axes[0]], point[axes[1]]


def _lift(point: tuple[float, float], plane: Plane) -> Point3:
    drop = _drop(plane)
    axes = [i for i in range(3) if i != drop]
    xyz = [0.0, 0.0, 0.0]
    xyz[axes[0]], xyz[axes[1]] = point
    xyz[drop] = (plane[3] - sum(plane[i] * xyz[i] for i in axes)) / plane[drop]
    return xyz[0], xyz[1], xyz[2]


def surface_mesh(prisms: tuple[Prism, ...]) -> tuple[tuple[Point3, ...], tuple[tuple[int, int, int], ...]]:
    levels = sorted({solid.bottom for solid in prisms} | {solid.top for solid in prisms})
    polygons = [Polygon([(round(x, 10), round(y, 10)) for x, y in solid.footprint]) for solid in prisms]
    if any(not polygon.is_valid or polygon.area <= 0 for polygon in polygons):
        raise ValueError("Invalid CFD prism footprint")
    sections = [
        unary_union(
            [
                polygon
                for solid, polygon in zip(prisms, polygons, strict=True)
                if solid.bottom < (lo + hi) / 2 < solid.top
            ]
        )
        for lo, hi in pairwise(levels)
    ]
    patches: dict[Plane, list[Polygon]] = {}

    def add_face(normal: Point3, rings: list[list[Point3]]) -> None:
        scale = max(abs(v) for v in normal)
        unit = tuple(round(v / scale, 10) for v in normal)
        offset = round(sum(unit[i] * rings[0][0][i] for i in range(3)), 10)
        plane = (unit[0], unit[1], unit[2], offset)
        projected = [[_project(point, plane) for point in ring] for ring in rings]
        patches.setdefault(plane, []).append(Polygon(projected[0], projected[1:]))

    for level_index, height in enumerate(levels):
        below = sections[level_index - 1] if level_index else Polygon()
        above = sections[level_index] if level_index < len(sections) else Polygon()
        for boundary, sign in ((below.difference(above), 1), (above.difference(below), -1)):
            for polygon in _polygons(boundary):
                add_face(
                    (0, 0, sign),
                    [[(x, y, height) for x, y in ring.coords] for ring in (polygon.exterior, *polygon.interiors)],
                )
    for section, (bottom, top) in zip(sections, pairwise(levels), strict=True):
        for polygon in _polygons(section):
            oriented = orient(polygon, sign=1)
            for ring in (oriented.exterior, *oriented.interiors):
                for (x, y), (u, v) in pairwise(ring.coords):
                    if abs(x - u) + abs(y - v) < 1e-12:
                        continue
                    add_face((v - y, x - u, 0), [[(x, y, bottom), (u, v, bottom), (u, v, top), (x, y, top)]])
    faces = [
        (plane, polygon)
        for plane in sorted(patches)
        for polygon in _polygons(unary_union(patches[plane]).simplify(1e-10, preserve_topology=True))
    ]
    raw_corners = sorted(
        {
            tuple(round(c, 10) for c in _lift(point, plane))
            for plane, polygon in faces
            for ring in (polygon.exterior, *polygon.interiors)
            for point in list(ring.coords)[:-1]
        }
    )
    # The same analytic corner lifted from two oblique planes can differ by a
    # rounding ulp. Weld before triangulation, not by discarding shared edges.
    corners: list[Point3] = []
    for point in raw_corners:
        if not any(max(abs(point[i] - other[i]) for i in range(3)) < 1e-8 for other in corners):
            corners.append((point[0], point[1], point[2]))
    vertices: list[Point3] = []
    indices: dict[Point3, int] = {}
    triangles = []

    def vertex(point: tuple[float, float], plane: Plane) -> int:
        lifted = _lift(point, plane)
        snapped = min(corners, key=lambda candidate: sum((candidate[i] - lifted[i]) ** 2 for i in range(3)))
        if max(abs(snapped[i] - lifted[i]) for i in range(3)) > 2e-8:
            raise ValueError("CFD triangulation introduced an unshared vertex")
        canonical = (min(1.0, max(0.0, snapped[0])), min(1.0, max(0.0, snapped[1])), min(1.0, max(0.0, snapped[2])))
        if canonical not in indices:
            indices[canonical] = len(vertices)
            vertices.append(canonical)
        return indices[canonical]

    for plane, polygon in faces:
        candidates = [
            _project(point, plane)
            for point in corners
            if abs(sum(plane[i] * point[i] for i in range(3)) - plane[3]) < 1e-8
        ]
        rings = []
        for ring in (polygon.exterior, *polygon.interiors):
            points: list[tuple[float, float]] = []
            for a, b in pairwise(ring.coords):
                dx, dy = b[0] - a[0], b[1] - a[1]
                length2 = dx * dx + dy * dy
                if length2 < 1e-20:
                    continue
                cuts = {0.0: a}
                for point in candidates:
                    along = ((point[0] - a[0]) * dx + (point[1] - a[1]) * dy) / length2
                    if 1e-9 < along < 1 - 1e-9 and abs(dx * (point[1] - a[1]) - dy * (point[0] - a[0])) < 1e-9:
                        cuts[along] = point
                points.extend(point for _, point in sorted(cuts.items()))
            rings.append(points)
        conforming = Polygon(rings[0], rings[1:])
        for triangle in get_parts(constrained_delaunay_triangles(conforming)):
            face = [vertex(point, plane) for point in list(triangle.exterior.coords)[:3]]
            a, b, c = [vertices[i] for i in face]
            ab, ac = [b[i] - a[i] for i in range(3)], [c[i] - a[i] for i in range(3)]
            normal = [ab[(i + 1) % 3] * ac[(i + 2) % 3] - ab[(i + 2) % 3] * ac[(i + 1) % 3] for i in range(3)]
            if sum(normal[i] * plane[i] for i in range(3)) < 0:
                face.reverse()
            triangles.append((face[0], face[1], face[2]))
    return tuple(vertices), tuple(triangles)
