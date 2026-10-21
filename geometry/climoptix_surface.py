"""Conforming tagged planar skin, not a CFD volume mesh or a general solid modeller."""

import math
from collections import Counter
from dataclasses import dataclass
from itertools import pairwise, product
from typing import TypedDict

from shapely import constrained_delaunay_triangles, get_parts, set_precision, unary_union
from shapely.geometry import Point, Polygon, box
from shapely.geometry.base import BaseGeometry
from shapely.strtree import STRtree

Vec3 = tuple[float, float, float]
# Numerical round-off only (0.00001 mm), NOT the user geometry-healing tolerance.
NUMERICAL_WELD_MM = 1e-5


def dot(a: Vec3, b: Vec3) -> float:
    return sum(x * y for x, y in zip(a, b, strict=True))


def sub(a: Vec3, b: Vec3) -> Vec3:
    return a[0] - b[0], a[1] - b[1], a[2] - b[2]


def cross(a: Vec3, b: Vec3) -> Vec3:
    return a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]


def unit(v: Vec3) -> Vec3:
    length = math.sqrt(dot(v, v))
    if length < 1e-12:
        raise ValueError("Degenerate surface normal.")
    return v[0] / length, v[1] / length, v[2] / length


def polygons(value: BaseGeometry) -> list[Polygon]:
    return [p for p in get_parts(value) if isinstance(p, Polygon) and p.area > 1e-6]


@dataclass
class Face:
    patch: str
    origin: Vec3
    u: Vec3
    v: Vec3
    normal: Vec3
    polygon: BaseGeometry

    def lift(self, p: tuple[float, float]) -> Vec3:
        return tuple(self.origin[i] + p[0] * self.u[i] + p[1] * self.v[i] for i in range(3))  # type: ignore[return-value]

    def project(self, p: Vec3) -> tuple[float, float]:
        delta = sub(p, self.origin)
        return dot(delta, self.u), dot(delta, self.v)


def face_from_ring(patch: str, ring: list[Vec3], normal: Vec3) -> Face:
    n = unit(normal)
    u = unit(sub(ring[1], ring[0]))
    v = unit(cross(n, u))
    face = Face(patch, ring[0], u, v, n, Polygon())
    face.polygon = Polygon([face.project(p) for p in ring])
    if not face.polygon.is_valid or face.polygon.area < 1e-6:
        raise ValueError("Invalid planar CFD face.")
    return face


class BoundarySkin(TypedDict):
    units: str
    verticesMm: list[Vec3]
    triangles: list[list[int]]
    trianglePatches: list[str]
    closed: bool
    badEdges: int
    volumeM3: float
    triangleCount: int
    kind: str


def _rounded(p: Vec3) -> Vec3:
    return round(p[0], 7), round(p[1], 7), round(p[2], 7)


def triangulate_skin(faces: list[Face]) -> BoundarySkin:
    """Insert shared corners before triangulating; reject cracks rather than healing them."""
    if len(faces) > 6000:
        raise ValueError("Preparation supports at most 6000 analytic faces; simplify the scenario.")
    for face in faces:
        face.polygon = set_precision(face.polygon, 1e-7)
    raw = {
        _rounded(face.lift(p))
        for face in faces
        for poly in polygons(face.polygon)
        for ring in (poly.exterior, *poly.interiors)
        for p in list(ring.coords)[:-1]
    }
    if len(raw) > 15000:
        raise ValueError("Surface complexity exceeds the preparation limit; simplify the scenario.")
    buckets: dict[tuple[int, int, int], list[Vec3]] = {}

    def canonical(point: Vec3, create: bool = False) -> Vec3:
        key = tuple(math.floor(v / NUMERICAL_WELD_MM) for v in point)
        for dx, dy, dz in product((-1, 0, 1), repeat=3):
            for candidate in buckets.get((key[0] + dx, key[1] + dy, key[2] + dz), []):
                if max(abs(point[i] - candidate[i]) for i in range(3)) < NUMERICAL_WELD_MM:
                    return candidate
        if not create:
            raise ValueError("Triangulation introduced an unshared corner; surface export is blocked.")
        buckets.setdefault((key[0], key[1], key[2]), []).append(point)
        return point

    corners = sorted({canonical(p, True) for p in sorted(raw)})
    corner_tree = STRtree([Point(p[:2]) for p in corners])
    vertices: list[Vec3] = []
    lookup: dict[Vec3, int] = {}
    triangles: list[list[int]] = []
    tags: list[str] = []

    def vertex(face: Face, p: tuple[float, float]) -> int:
        point = canonical(_rounded(face.lift(p)))
        if point not in lookup:
            lookup[point] = len(vertices)
            vertices.append(point)
        return lookup[point]

    for face in faces:
        world = [
            face.lift(p)
            for polygon in polygons(face.polygon)
            for ring in (polygon.exterior, *polygon.interiors)
            for p in ring.coords
        ]
        if not world:
            continue
        bounds = box(
            min(p[0] for p in world) - NUMERICAL_WELD_MM,
            min(p[1] for p in world) - NUMERICAL_WELD_MM,
            max(p[0] for p in world) + NUMERICAL_WELD_MM,
            max(p[1] for p in world) + NUMERICAL_WELD_MM,
        )
        candidates = [
            face.project(corners[int(i)])
            for i in corner_tree.query(bounds)
            if abs(dot(sub(corners[int(i)], face.origin), face.normal)) < NUMERICAL_WELD_MM
        ]
        candidate_tree = STRtree([Point(p) for p in candidates])
        for poly in polygons(face.polygon):
            rings = []
            for ring in (poly.exterior, *poly.interiors):
                coords: list[tuple[float, float]] = []
                for a, b in pairwise(ring.coords):
                    dx, dy = b[0] - a[0], b[1] - a[1]
                    length2 = dx * dx + dy * dy
                    if length2 < 1e-12:
                        continue
                    cuts = {0.0: a}
                    local_bounds = box(
                        min(a[0], b[0]) - NUMERICAL_WELD_MM,
                        min(a[1], b[1]) - NUMERICAL_WELD_MM,
                        max(a[0], b[0]) + NUMERICAL_WELD_MM,
                        max(a[1], b[1]) + NUMERICAL_WELD_MM,
                    )
                    for index in candidate_tree.query(local_bounds):
                        p = candidates[int(index)]
                        t = ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / length2
                        endpoint_fraction = NUMERICAL_WELD_MM / math.sqrt(length2)
                        if (
                            endpoint_fraction < t < 1 - endpoint_fraction
                            and abs(dx * (p[1] - a[1]) - dy * (p[0] - a[0])) / math.sqrt(length2) < NUMERICAL_WELD_MM
                        ):
                            cuts[t] = p
                    coords.extend(p for _, p in sorted(cuts.items()))
                rings.append(coords)
            conforming = Polygon(rings[0], [r for r in rings[1:] if len(set(r)) >= 3])
            for triangle in get_parts(constrained_delaunay_triangles(conforming)):
                indices = [vertex(face, p) for p in list(triangle.exterior.coords)[:3]]
                a, b, c = [vertices[i] for i in indices]
                n = cross(sub(b, a), sub(c, a))
                if dot(n, face.normal) < 0:
                    indices.reverse()
                triangles.append(indices)
                tags.append(face.patch)
    counts: Counter[tuple[int, int]] = Counter()
    oriented: Counter[tuple[int, int]] = Counter()
    signed_volume = 0.0
    duplicate: set[tuple[int, ...]] = set()
    valid = bool(triangles)
    for tri in triangles:
        key = tuple(sorted(tri))
        if key in duplicate:
            valid = False
        duplicate.add(key)
        a, b, c = [vertices[i] for i in tri]
        if dot(cross(sub(b, a), sub(c, a)), cross(sub(b, a), sub(c, a))) < 1e-12:
            valid = False
        signed_volume += dot(a, cross(b, c)) / 6
        for i, j in zip(tri, [tri[1], tri[2], tri[0]], strict=True):
            counts[min(i, j), max(i, j)] += 1
            oriented[i, j] += 1
    bad_edges = sum(count != 2 or oriented[a, b] != 1 or oriented[b, a] != 1 for (a, b), count in counts.items())
    valid = valid and not bad_edges and signed_volume > 1e-6
    return {
        "units": "mm",
        "verticesMm": vertices,
        "triangles": triangles,
        "trianglePatches": tags,
        "closed": valid,
        "badEdges": bad_edges,
        "volumeM3": signed_volume * 1e-9,
        "triangleCount": len(triangles),
        "kind": "boundarySurface",
    }


def merge_planar_faces(faces: list[Face]) -> list[Face]:
    """Merge coplanar triangles on one object without erasing patch provenance."""
    groups: dict[tuple[object, ...], list[Face]] = {}
    for face in faces:
        key = (face.patch, *(round(n, 7) for n in face.normal), round(dot(face.origin, face.normal), 5))
        groups.setdefault(key, []).append(face)
    result = []
    for group in groups.values():
        first = group[0]
        parts = []
        for face in group:
            for poly in polygons(face.polygon):
                rings = [
                    [first.project(face.lift(p)) for p in ring.coords] for ring in (poly.exterior, *poly.interiors)
                ]
                parts.append(Polygon(rings[0], rings[1:]))
        result.append(Face(first.patch, first.origin, first.u, first.v, first.normal, unary_union(parts)))
    return result
