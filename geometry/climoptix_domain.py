"""Air-domain discovery from measured planner data, never from a display mesh.

Wall ownership mirrors the planner: a coincident partition is owned once,
preferentially by its opening-bearing room, and extends outward by its measured
thickness. Subtracting those solids leaves the actual room-facing air planes.
Doors/windows ALWAYS terminate discovery. Only explicit doorless profiles or
validated slab voids create graph edges. Tolerance does not turn gaps into doors.
"""

import hashlib
import json
import math
import re
from dataclasses import dataclass, field
from itertools import pairwise
from pathlib import Path
from typing import Any

from shapely import get_parts, unary_union
from shapely.geometry import LineString, Point, Polygon
from shapely.geometry.base import BaseGeometry
from shapely.geometry.polygon import orient
from shapely.strtree import STRtree

from geometry.climoptix_models import Diagnostic, Scenario
from geometry.climoptix_surface import Face, Vec3, cross, face_from_ring, polygons, sub, unit
from geometry.opening_profiles import passage_polygon_mm

ADAPTER_VERSION = 1
TOLERANCE_MM = 0.01
# Application-owned semantic definitions, not user-supplied mesh semantics.
_DOOR_MODELS = json.loads((Path(__file__).resolve().parents[1] / "frontend/lib/doorModels.json").read_text())
PASSAGES = {m["key"]: m["profile"] for m in _DOOR_MODELS if m["operation"] == "OPENING"}
ACTUAL_DOORS = {m["key"] for m in _DOOR_MODELS if m["operation"] != "OPENING"}


def canonical_hash(value: Any) -> str:
    return hashlib.sha256(
        json.dumps(value, sort_keys=True, separators=(",", ":"), allow_nan=False).encode()
    ).hexdigest()


def measurement(value: Any) -> float:
    number = value.get("value") if isinstance(value, dict) else value
    if isinstance(number, bool) or not isinstance(number, (int, float)) or not math.isfinite(number):
        raise ValueError("A source measurement is missing or non-finite.")
    return float(number)


def polygon_mm(vertices: list[dict[str, Any]]) -> Polygon:
    if not 3 <= len(vertices) <= 500:
        raise ValueError("Use 3–500 vertices per CFD region.")
    points = [(measurement(p["x"]), measurement(p["y"])) for p in vertices]
    if any(abs(v) > 1e7 for p in points for v in p):
        raise ValueError("Source coordinates exceed the supported millimetre range.")
    polygon = Polygon(points)
    if not polygon.is_valid or polygon.area < 1:
        raise ValueError("Source polygon is self-intersecting, degenerate or invalid.")
    return polygon


@dataclass
class Edge:
    room_id: str
    index: int
    line: LineString
    thickness: float
    outward: tuple[float, float]
    has_opening: bool
    source_key: str


@dataclass
class Ceiling:
    polygon: Polygon
    a: float
    b: float
    c: float

    def height(self, x: float, y: float) -> float:
        return self.a * x + self.b * y + self.c


@dataclass
class Region:
    id: str
    floor_id: str
    name: str
    raw: dict[str, Any]
    original: Polygon
    air: Polygon
    base: float
    ceiling: list[Ceiling] = field(default_factory=list)
    edges: list[Edge] = field(default_factory=list)

    def top(self, x: float, y: float) -> float:
        heights = [c.height(x, y) for c in self.ceiling if c.polygon.buffer(1e-6).covers(Point(x, y))]
        if not heights:
            raise ValueError("No interior ceiling covers this point.")
        return min(heights)


@dataclass
class Portal:
    id: str
    floor_id: str
    kind: str
    room_ids: list[str]
    raw: dict[str, Any]
    # Analytic aperture polygon on each participating room's actual air face.
    rings: dict[str, list[Vec3]]
    traversable: bool
    reason: str


@dataclass
class Domain:
    regions: list[Region]
    portals: list[Portal]
    included: set[str]
    diagnostics: list[Diagnostic]
    floor_voids: list[dict[str, Any]]
    source_hash: str


def source_geometry(project: dict[str, Any]) -> dict[str, Any]:
    """Active-floor selection, labels, themes and camera never change geometry hash."""
    building = project.get("building")
    floors: list[dict[str, Any]] = (
        building["floors"]
        if building
        else [
            {
                "id": "floor-ground",
                "elevationMm": 0,
                "heightMm": max([measurement(r["wall_height"]) for r in project["rooms"]] or [2400]) + 200,
                "slabThicknessMm": 200,
                "openings": [],
            }
        ]
    )
    result: list[dict[str, Any]] = []
    for floor in floors:
        content = project if not building or floor["id"] == building["activeFloorId"] else floor["content"]
        plan = content.get("floorplan")
        if plan is not None and not isinstance(plan, dict):
            raise ValueError("Source floorplan must be a planner document or null.")
        runs = []
        for wall in (plan or {}).get("walls", []):
            points = wall["points"]
            if not isinstance(points, list) or len(points) < 2:
                raise ValueError("Source wall runs need at least two finite points.")
            coordinates = [(measurement(p["x"]), measurement(p["y"])) for p in points]
            if any(abs(v) > 1e7 for point in coordinates for v in point):
                raise ValueError("Source wall coordinates exceed the supported millimetre range.")
            runs.append({"id": wall["id"], "points": coordinates, "cornerNumbers": wall.get("cornerNumbers", {})})
        if sum(len(w["points"]) - 1 for w in runs) > 5000:
            raise ValueError("Preparation supports at most 5000 source wall-run segments.")
        rooms = []
        for room in content["rooms"]:
            if not isinstance(room.get("id"), str) or not re.fullmatch(r"[A-Za-z0-9_:-]{1,150}", room["id"]):
                raise ValueError("Source room IDs must be stable planner identifiers.")
            rooms.append(
                {
                    k: room.get(k)
                    for k in (
                        "id",
                        "vertices",
                        "wall_height",
                        "wall_thickness",
                        "wall_thickness_overrides_mm",
                        "openings",
                        "obstacles",
                        "source_floorplan_room_id",
                    )
                }
            )
        result.append(
            {
                **{k: floor[k] for k in ("id", "elevationMm", "heightMm", "slabThicknessMm", "openings")},
                "rooms": rooms,
                "assetInstances": content.get("assetInstances", []),
                "wallRuns": runs,
            }
        )
    return {
        "adapterVersion": ADAPTER_VERSION,
        "floors": result,
        "roof": building.get("roof") if building else None,
        "assets": project.get("assets", []),
    }


def _source_segments(runs: list[dict[str, Any]]) -> tuple[list[tuple[str, LineString, list[Any]]], STRtree]:
    segments = []
    for run in runs:
        corners = run["cornerNumbers"] if isinstance(run["cornerNumbers"], dict) else {}
        # Closed runs may repeat their first corner at the final point, or omit
        # that redundant entry. Both represent the same physical closing edge.
        corners = dict(corners)
        if run["points"][0] == run["points"][-1]:
            closing = str(len(run["points"]) - 1)
            if closing not in corners or corners[closing] == corners.get("0"):
                corners.pop(closing, None)
                closing_id = corners.get("0")
            else:
                closing_id = corners[closing]
        else:
            closing_id = None
        values = list(corners.values())
        valid_ids = all(type(v) is int and 0 <= v <= 1e9 for v in values) and len(set(values)) == len(values)
        for i, (a, b) in enumerate(pairwise(run["points"])):
            line = LineString([a, b])
            if line.length > 1e-6:
                end_id = (
                    closing_id
                    if i + 1 == len(run["points"]) - 1 and closing_id is not None
                    else corners.get(str(i + 1))
                )
                segments.append((str(run["id"]), line, [corners.get(str(i)), end_id] if valid_ids else [None, None]))
    return segments, STRtree([line.buffer(1e-6, cap_style="flat") for _, line, _ in segments])


def _edges(
    room: dict[str, Any], polygon: Polygon, sources: tuple[list[tuple[str, LineString, list[Any]]], STRtree]
) -> list[Edge]:
    ccw = polygon.exterior.is_ccw
    result = []
    for i, (a, b) in enumerate(pairwise(polygon.exterior.coords)):
        line = LineString([a, b])
        if line.length < 0.01:
            raise ValueError("A source wall is shorter than 0.01 mm.")
        wall_id = f"wall-{i + 1:03d}"
        t = measurement((room.get("wall_thickness_overrides_mm") or {}).get(wall_id, room["wall_thickness"]))
        if not 1 <= t <= 2000:
            raise ValueError("CFD wall thickness must be 1–2000 mm.")
        sign = 1 if ccw else -1
        outward = (sign * (b[1] - a[1]) / line.length, sign * (a[0] - b[0]) / line.length)
        references = []
        segments, tree = sources
        for source_index in tree.query(line, predicate="covered_by"):
            source_id, segment, corner_ids = segments[int(source_index)]
            if all(type(value) is int for value in corner_ids):
                parameters = [segment.project(Point(p)) / segment.length for p in (a, b)]
                # Source run direction is not physical identity. Canonical UV
                # parameters let reversing a run preserve the same host.
                if corner_ids[0] > corner_ids[1]:
                    parameters = [1 - value for value in parameters]
                references.append(["corners", source_id, *sorted(corner_ids), *sorted(round(v, 8) for v in parameters)])
        # Preserve corner-backed host identities through edits. Legacy geometry
        # without stable corners must orphan, never retarget, an old BC/vent.
        identity = (
            sorted(references, key=lambda value: json.dumps(value))[0]
            if references
            else ["geometry", sorted([tuple(round(v, 6) for v in a), tuple(round(v, 6) for v in b)])]
        )
        source_key = canonical_hash(identity)[:24]
        result.append(
            Edge(
                room["id"],
                i,
                line,
                t,
                outward,
                any(o["parent_wall_id"] == wall_id for o in room.get("openings", [])),
                source_key,
            )
        )
    return result


def _wall_solids(regions: list[Region]) -> tuple[BaseGeometry, BaseGeometry]:
    edges = [e for r in regions for e in r.edges]
    index = STRtree([e.line.buffer(1e-6, cap_style="flat") for e in edges])
    rooms = {r.id: r for r in regions}
    spans = []
    solids = []
    for atomic in get_parts(unary_union([e.line for e in edges])):
        if not isinstance(atomic, LineString) or atomic.length < 1e-6:
            continue
        owners = [edges[int(i)] for i in sorted(index.query(atomic, predicate="covered_by"))]
        if not owners:
            raise ValueError("A wall has ambiguous source ownership.")
        owner = sorted(owners, key=lambda e: not e.has_opening)[0]
        a, b = atomic.coords[0], atomic.coords[-1]
        if owner.line.project(Point(a)) > owner.line.project(Point(b)):
            a, b = b, a
        spans.append((owner, a, b))
    incident: dict[tuple[float, float], set[tuple[float, float]]] = {}

    def key(p: tuple[float, ...]) -> tuple[float, float]:
        return round(p[0], 6), round(p[1], 6)

    for _, a, b in spans:
        incident.setdefault(key(a), set()).add(key(b))
        incident.setdefault(key(b), set()).add(key(a))

    def corner(region: Region, i: int) -> tuple[float, float]:
        count = len(region.edges)
        incoming, outgoing = region.edges[(i - 1) % count], region.edges[i % count]
        vertex = outgoing.line.coords[0]
        a = (vertex[0] + incoming.outward[0] * incoming.thickness, vertex[1] + incoming.outward[1] * incoming.thickness)
        b = (vertex[0] + outgoing.outward[0] * outgoing.thickness, vertex[1] + outgoing.outward[1] * outgoing.thickness)
        ix, iy = (
            incoming.line.coords[-1][0] - incoming.line.coords[0][0],
            incoming.line.coords[-1][1] - incoming.line.coords[0][1],
        )
        ox, oy = (
            outgoing.line.coords[-1][0] - outgoing.line.coords[0][0],
            outgoing.line.coords[-1][1] - outgoing.line.coords[0][1],
        )
        ix, iy = ix / incoming.line.length, iy / incoming.line.length
        ox, oy = ox / outgoing.line.length, oy / outgoing.line.length
        denominator = ix * oy - iy * ox
        average = ((a[0] + b[0]) / 2, (a[1] + b[1]) / 2)
        if abs(denominator) < 1e-9:
            return average
        t = ((b[0] - a[0]) * oy - (b[1] - a[1]) * ox) / denominator
        intersection = (a[0] + ix * t, a[1] + iy * t)
        return (
            average
            if math.dist(intersection, vertex) > max(incoming.thickness, outgoing.thickness) * 4
            else intersection
        )

    for owner, a, b in spans:
        dx, dy = owner.outward[0] * owner.thickness, owner.outward[1] * owner.thickness
        region = rooms[owner.room_id]
        start = (
            (a[0] + dx, a[1] + dy)
            if owner.line.project(Point(a)) > 0.5 or len(incident[key(a)]) > 2
            else corner(region, owner.index)
        )
        end = (
            (b[0] + dx, b[1] + dy)
            if owner.line.project(Point(b)) < owner.line.length - 0.5 or len(incident[key(b)]) > 2
            else corner(region, owner.index + 1)
        )
        solid = Polygon([a, b, end, start])
        if not solid.is_valid:
            raise ValueError("A measured wall envelope crosses itself; repair its source corner.")
        solids.append(solid)
    walls = unary_union(solids)
    return walls, unary_union([*solids, *[r.original for r in regions]])


def _ceilings(region: Region, roof: dict[str, Any] | None, frame: BaseGeometry, clear_height: float) -> list[Ceiling]:
    if not roof:
        return [Ceiling(region.air, 0, 0, region.base + clear_height)]
    if roof.get("ceilingMode") == "FLAT":
        return [Ceiling(region.air, 0, 0, region.base + roof["ceilingHeightMm"])]
    angle = math.radians(roof["orientationDeg"] + (90 if roof["type"] == "GABLE" else 0))
    ux, uy = math.cos(angle), math.sin(angle)
    points = [p for poly in polygons(frame) for p in poly.exterior.coords]
    coordinates = [x * ux + y * uy for x, y in points]
    lo, hi = min(coordinates), max(coordinates)
    if hi - lo < 1:
        raise ValueError("Roof frame is degenerate.")
    low, high = roof["lowHeightMm"] + region.base, roof["highHeightMm"] + region.base
    kind = roof["type"]
    if kind == "FLAT":
        return [Ceiling(region.air, 0, 0, low)]
    if kind == "MONO":
        slope = (high - low) / (hi - lo)
        return [Ceiling(region.air, slope * ux, slope * uy, low - lo * slope)]
    split = lo + (hi - lo) * (roof["splitFraction"] if kind == "STEPPED" else 0.5)
    pad = max(abs(c) for p in points for c in p) * 4 + 100000
    # u/v-space half planes, converted to global plan coordinates.
    halves = []
    for first, last in ((lo - pad, split), (split, hi + pad)):
        corners = [
            (u * ux - v * uy, u * uy + v * ux) for u, v in ((first, -pad), (last, -pad), (last, pad), (first, pad))
        ]
        halves.append(region.air.intersection(Polygon(corners)))
    result: list[Ceiling] = []
    for i, half in enumerate(halves):
        slope = 0.0 if kind == "STEPPED" else (high - low) / (hi - lo) * (2 if i == 0 else -2)
        c = (low if i == 0 else high) if kind == "STEPPED" else low - lo * slope if i == 0 else low - hi * slope
        result.extend(Ceiling(p, slope * ux, slope * uy, c) for p in polygons(half))
    return result


def _air_line(region: Region, edge: Edge, start: tuple[float, float], end: tuple[float, float]) -> LineString | None:
    """Locate an unbroken room-facing plane; never snap across a missing wall."""
    dx, dy = end[0] - start[0], end[1] - start[1]
    length = math.hypot(dx, dy)
    if length < 1:
        return None
    ux, uy = dx / length, dy / length
    candidates = []
    for a, b in pairwise(region.air.exterior.coords):
        vx, vy = b[0] - a[0], b[1] - a[1]
        if abs(vx * uy - vy * ux) > 1e-5:
            continue
        offset = (a[0] - start[0]) * edge.outward[0] + (a[1] - start[1]) * edge.outward[1]
        if abs(offset) > 2000 + TOLERANCE_MM:
            continue
        p = (start[0] + edge.outward[0] * offset, start[1] + edge.outward[1] * offset)
        q = (end[0] + edge.outward[0] * offset, end[1] + edge.outward[1] * offset)
        if LineString([a, b]).buffer(TOLERANCE_MM, cap_style="flat").covers(LineString([p, q])):
            candidates.append((abs(offset), LineString([p, q])))
    return min(candidates, key=lambda c: c[0])[1] if candidates else None


def discover_domain(project: dict[str, Any], scenario: Scenario) -> Domain:
    diagnostics: list[Diagnostic] = []
    scopes: dict[int, set[str]] = {}

    def issue(
        code: str,
        message: str,
        repair: str,
        object_id: str | None = None,
        group: str = "geometry",
        scope: set[str] | None = None,
    ) -> None:
        diagnostics.append(
            Diagnostic(severity="error", group=group, code=code, message=message, repair=repair, objectId=object_id)
        )
        if scope is not None:
            scopes[id(diagnostics[-1])] = scope

    source = source_geometry(project)
    regions: list[Region] = []
    by_floor: dict[str, list[Region]] = {}
    invalid_floors: set[str] = set()
    floors = source["floors"]
    for i, floor in enumerate(floors):
        local = []
        wall_sources = _source_segments(floor["wallRuns"])
        for raw in floor["rooms"]:
            original = polygon_mm(raw["vertices"])
            original_name = next(
                (
                    r.get("name", "Room")
                    for r in (
                        project
                        if not project.get("building") or floor["id"] == project["building"]["activeFloorId"]
                        else project["building"]["floors"][i]["content"]
                    )["rooms"]
                    if r["id"] == raw["id"]
                ),
                "Room",
            )
            region = Region(raw["id"], floor["id"], original_name, raw, original, original, floor["elevationMm"])
            region.edges = _edges(raw, original, wall_sources)
            local.append(region)
        if sum(len(r.edges) for r in [*regions, *local]) > 2000 or len(regions) + len(local) > 200:
            raise ValueError("A preparation supports up to 200 rooms and 2000 source wall segments.")
        for first_index, first in enumerate(local):
            for second in local[first_index + 1 :]:
                if first.original.intersection(second.original).area > 0.01:
                    invalid_floors.add(floor["id"])
                    issue(
                        "overlapping-regions",
                        "Measured room regions overlap.",
                        "Resolve overlapping room outlines.",
                        first.id,
                        scope={first.id, second.id},
                    )
        wall_solid, physical = (
            _wall_solids(local)
            if floor["id"] not in invalid_floors
            else (Polygon(), unary_union([r.original for r in local]))
        )
        for region in local:
            air = region.original.difference(wall_solid)
            if not isinstance(air, Polygon) or not air.is_valid or air.area < 1:
                issue(
                    "split-region",
                    "Wall solids split or erase this air region.",
                    "Repair the wall/room layout.",
                    region.id,
                )
                continue
            region.air = orient(air)
            roof = None
            frame = physical
            if i == len(floors) - 1 and source["roof"]:
                roof = source["roof"]
                if roof.get("enabled", True) is False:
                    issue(
                        "unbounded-ceiling",
                        "This top-floor region has no defined interior ceiling.",
                        "Enable a roof/ceiling definition before preparing this room.",
                        region.id,
                    )
                override = next((r["roof"] for r in roof.get("roomOverrides", []) if r["roomId"] == region.id), None)
                if roof.get("roomRoofsEnabled") and override:
                    roof = override
                    _, frame = _wall_solids([region])
            clear = floor["heightMm"] - (
                floors[i + 1]["slabThicknessMm"] if i + 1 < len(floors) else floor["slabThicknessMm"]
            )
            region.ceiling = _ceilings(region, roof, frame, clear)
            if any(c.height(x, y) <= region.base for c in region.ceiling for x, y in c.polygon.exterior.coords):
                issue(
                    "invalid-ceiling",
                    "Ceiling intersects the room floor.",
                    "Correct the floor or ceiling height.",
                    region.id,
                )
        by_floor[floor["id"]] = local
        if floor["wallRuns"]:
            run_lines = [LineString(w["points"]) for w in floor["wallRuns"]]
            boundary = unary_union([r.original.boundary for r in local]).buffer(1e-6)
            source_cover = unary_union(run_lines).buffer(1e-6)
            for region in local:
                if region.original.boundary.difference(source_cover).length > 0.01:
                    issue(
                        "missing-source-wall",
                        "A room boundary is not covered by its source wall runs.",
                        "Repair/regenerate the room from the current floorplan walls before preparing it.",
                        region.id,
                    )
            for wall, line in zip(floor["wallRuns"], run_lines, strict=True):
                free = line.difference(boundary)
                if free.length > 0.01:
                    for region in local:
                        if region.original.buffer(-1e-6).intersection(free).length > 0.01:
                            issue(
                                "unmapped-internal-wall",
                                "An internal wall run is not represented by an enclosed room boundary.",
                                "The partial-wall obstruction adapter is not implemented; "
                                "this wall cannot be silently omitted from a CFD case.",
                                wall["id"],
                                scope={region.id},
                            )
        regions.extend(local)
    room_by_id = {r.id: r for r in regions}
    if len(room_by_id) != len(regions):
        raise ValueError("Source room IDs must be unique across every floor.")
    edge_lists = {fid: [edge for region in local for edge in region.edges] for fid, local in by_floor.items()}
    edge_trees = {
        fid: STRtree([edge.line.buffer(TOLERANCE_MM, cap_style="flat") for edge in edges])
        for fid, edges in edge_lists.items()
    }
    if sum(len(r.raw.get("openings") or []) for r in regions) > 1000:
        raise ValueError("Preparation supports up to 1000 source wall apertures.")
    graph: dict[str, set[str]] = {r.id: set() for r in regions}
    portals: list[Portal] = []
    seen: dict[str, Portal] = {}
    for room in regions:
        for opening in room.raw.get("openings", []):
            edge = next((e for e in room.edges if opening["parent_wall_id"] == f"wall-{e.index + 1:03d}"), None)
            if edge is None:
                issue(
                    "missing-opening-host",
                    "Opening references a missing wall.",
                    "Reattach or delete the opening.",
                    opening["id"],
                )
                continue
            width, height = measurement(opening["width"]), measurement(opening["height"])
            offset, sill = measurement(opening["offset_mm"]), measurement(opening.get("sill_height_mm", 0))
            if min(width, height) <= 0 or min(offset, sill) < 0 or offset + width > edge.line.length + TOLERANCE_MM:
                issue(
                    "invalid-opening",
                    "Opening dimensions exceed their source wall.",
                    "Resize/reposition the opening.",
                    opening["id"],
                )
                continue
            start_point = edge.line.interpolate(offset)
            end_point = edge.line.interpolate(offset + width)
            start = (start_point.x, start_point.y)
            end = (end_point.x, end_point.y)
            aperture_line = LineString([start, end])
            candidates = [
                edge_lists[room.floor_id][int(i)]
                for i in edge_trees[room.floor_id].query(aperture_line, predicate="covered_by")
            ]
            neighbour_ids = {
                e.room_id
                for e in candidates
                if e.room_id != room.id
                and e.line.distance(aperture_line) < 1e-6
                and e.outward[0] * edge.outward[0] + e.outward[1] * edge.outward[1] < -0.99
            }
            neighbours = [r for r in by_floor[room.floor_id] if r.id in neighbour_ids]
            representation = (opening.get("metadata") or {}).get("representation_key")
            profile = opening.get("passage_profile") or PASSAGES.get(representation)
            if profile and representation in ACTUAL_DOORS:
                issue(
                    "door-passage-conflict",
                    "An actual door model cannot also be a permanent passage.",
                    "Choose a doorless opening model or remove the passage profile. This door remains a hard stop.",
                    opening["id"],
                    "connectivity",
                )
                profile = None
            actual_passage = opening.get("kind") == "DOOR" and profile is not None
            if profile and (
                profile not in {"RECTANGULAR", "ROUND_ARCH", "SEGMENTAL_ARCH", "CHAMFERED"} or not actual_passage
            ):
                issue(
                    "invalid-passage",
                    "Passage semantics are invalid.",
                    "Choose an explicit doorless catalogue opening.",
                    opening["id"],
                )
                continue
            kind = (
                "passage"
                if actual_passage
                else "door"
                if opening.get("kind") == "DOOR"
                else "window"
                if opening.get("kind") == "WINDOW"
                else "cap"
            )
            key = (
                room.floor_id
                + ":"
                + str(sorted((tuple(round(x, 5) for x in start), tuple(round(x, 5) for x in end))))
                + f":{sill}:{height}"
            )
            if key in seen:
                if seen[key].kind != kind:
                    seen[key].traversable = False
                    issue(
                        "conflicting-portal",
                        "The same aperture is both a passage and a door/window.",
                        "Resolve conflicting aperture definitions; doors/windows are always stops.",
                        opening["id"],
                    )
                continue
            participants = [room, *neighbours]
            rings = {}
            aperture = (
                passage_polygon_mm(str(profile), width, height)
                if actual_passage and profile != "RECTANGULAR"
                else [(0, 0), (width, 0), (width, height), (0, height)]
            )
            valid = len(neighbours) <= 1
            for participant in participants:
                target_edge = next(
                    (
                        e
                        for e in participant.edges
                        if e.line.buffer(TOLERANCE_MM, cap_style="flat").covers(LineString([start, end]))
                    ),
                    edge,
                )
                air_line = _air_line(participant, target_edge, start, end)
                if air_line is None:
                    valid = False
                    continue
                a, b = air_line.coords[0], air_line.coords[-1]
                ring = [
                    (a[0] + (b[0] - a[0]) * x / width, a[1] + (b[1] - a[1]) * x / width, room.base + sill + z)
                    for x, z in aperture
                ]
                if any(z > participant.top(x, y) + TOLERANCE_MM or z < participant.base for x, y, z in ring):
                    valid = False
                rings[participant.id] = ring
            traversable = valid and actual_passage and len(neighbours) == 1 and room.floor_id not in invalid_floors
            reason = (
                "Permanent doorless passage"
                if traversable
                else "Door/window hard stop"
                if kind in ("door", "window")
                else "Exterior passage is capped"
                if not neighbours
                else "Invalid or ambiguous passage"
            )
            portal = Portal(
                opening["id"], room.floor_id, kind, [r.id for r in participants], opening, rings, traversable, reason
            )
            seen[key] = portal
            portals.append(portal)
            if not valid:
                issue(
                    "invalid-portal-geometry",
                    "Aperture does not fit one unique pair of room-facing walls/ceilings.",
                    "Check wall coincidence, thickness, width, elevation and clear ceiling height.",
                    portal.id,
                    "connectivity",
                )
    # Overlapping apertures are ambiguous, not two alternative graph routes.
    for index, first_portal in enumerate(portals):
        for second_portal in portals[index + 1 :]:
            for rid in first_portal.rings.keys() & second_portal.rings.keys():
                ring_one, ring_two = first_portal.rings[rid], second_portal.rings[rid]
                plane = face_from_ring(
                    "check", ring_one, cross(sub(ring_one[1], ring_one[0]), sub(ring_one[2], ring_one[0]))
                )
                if all(
                    abs(sum((p[k] - plane.origin[k]) * plane.normal[k] for k in range(3))) < TOLERANCE_MM
                    for p in ring_two
                ):
                    if plane.polygon.intersection(Polygon([plane.project(p) for p in ring_two])).area > 0.01:
                        first_portal.traversable = second_portal.traversable = False
                        issue(
                            "overlapping-apertures",
                            "Two apertures overlap on the same room-facing wall.",
                            "Separate the apertures or remove the duplicate definition.",
                            first_portal.id,
                            "connectivity",
                        )
    # Conflicting semantics can have been discovered in a mirrored room record.
    for portal in portals:
        if portal.traversable:
            portal_a, portal_b = portal.room_ids
            graph[portal_a].add(portal_b)
            graph[portal_b].add(portal_a)
    voids = []
    for i, floor in enumerate(floors[1:], 1):
        for opening in floor["openings"]:
            poly = polygon_mm(opening["vertices"])
            lower = [r for r in by_floor[floors[i - 1]["id"]] if r.air.covers(poly)]
            upper = [r for r in by_floor[floor["id"]] if r.air.covers(poly)]
            valid = len(lower) == len(upper) == 1
            if valid:
                lower_region, upper_region = lower[0], upper[0]
                valid = all(
                    abs(lower_region.top(x, y) - (floor["elevationMm"] - floor["slabThicknessMm"])) < TOLERANCE_MM
                    for x, y in poly.exterior.coords
                )
            if not valid:
                issue(
                    "invalid-slab-portal",
                    "Slab void does not join one lower region to one upper region at the slab faces.",
                    "Keep the physical void inside aligned rooms and check slab/ceiling elevations.",
                    opening["id"],
                    "connectivity",
                )
                continue
            graph[lower_region.id].add(upper_region.id)
            graph[upper_region.id].add(lower_region.id)
            voids.append(
                {
                    "id": opening["id"],
                    "lower": lower_region.id,
                    "upper": upper_region.id,
                    "polygon": poly,
                    "bottom": floor["elevationMm"] - floor["slabThicknessMm"],
                    "top": floor["elevationMm"],
                    "balustrade": opening.get("balustrade"),
                }
            )
    included: set[str] = set()
    seed = scenario.seed
    if seed is None or seed.roomId not in room_by_id or room_by_id[seed.roomId].floor_id != seed.floorId:
        issue(
            "missing-seed", "Choose an existing seed room.", "Select a floor and room in Domain.", group="connectivity"
        )
    else:
        pending = [seed.roomId]
        while pending:
            current = pending.pop()
            if current in included:
                continue
            included.add(current)
            pending.extend(graph[current] - included)
    opening_scopes: dict[str, set[str]] = {}
    for region in regions:
        for opening in region.raw.get("openings") or []:
            opening_scopes.setdefault(opening["id"], set()).add(region.id)
    for diagnostic in diagnostics:
        scope = scopes.get(id(diagnostic))
        if scope is None and diagnostic.objectId is not None and diagnostic.objectId in room_by_id:
            scope = {diagnostic.objectId}
        if scope is None and diagnostic.objectId:
            scope = opening_scopes.get(diagnostic.objectId)
        if scope and not scope & included:
            diagnostic.severity = "info"
            diagnostic.message = "Outside the connected domain: " + diagnostic.message
    return Domain(regions, portals, included, diagnostics, voids, canonical_hash(source))


def boundary_faces(domain: Domain) -> tuple[list[Face], dict[str, dict[str, Any]]]:
    """Analytic room skin, real passage reveals and slab-void sides with stable tags."""
    faces: list[Face] = []
    patches: dict[str, dict[str, Any]] = {}

    def add(face: Face, room: Region, kind: str, source_id: str, host: bool = False) -> None:
        faces.append(face)
        patches.setdefault(
            face.patch,
            {
                "id": face.patch,
                "kind": kind,
                "roomId": room.id,
                "floorId": room.floor_id,
                "sourceId": source_id,
                "hostable": host,
            },
        )

    for room in domain.regions:
        if room.id not in domain.included or not room.ceiling:
            continue
        prefix = f"{room.floor_id}:{room.id}"
        bottom_voids = [
            v["polygon"] for v in domain.floor_voids if v["upper"] == room.id and v["lower"] in domain.included
        ]
        top_voids = [
            v["polygon"] for v in domain.floor_voids if v["lower"] == room.id and v["upper"] in domain.included
        ]
        floor_poly = room.air.difference(unary_union(bottom_voids))
        floor_id = prefix + ":floor"
        add(
            Face(floor_id, (0, 0, room.base), (1, 0, 0), (0, 1, 0), (0, 0, -1), floor_poly),
            room,
            "floor",
            room.id,
            True,
        )
        for i, ceiling in enumerate(room.ceiling):
            family = "slopes" if any(abs(c.a) + abs(c.b) > 1e-9 for c in room.ceiling) else "levels"
            partition = f"{family}:{len(room.ceiling)}:" if len(room.ceiling) > 1 else ""
            pid = prefix + f":ceiling:{partition}{i}"
            n = unit((-ceiling.a, -ceiling.b, 1))
            u = unit((1, 0, ceiling.a))
            v = unit(cross(n, u))
            face = Face(pid, (0, 0, ceiling.c), u, v, n, Polygon())
            parts = []
            for poly in polygons(ceiling.polygon.difference(unary_union(top_voids))):
                rings = [
                    [face.project((x, y, ceiling.height(x, y))) for x, y in ring.coords]
                    for ring in (poly.exterior, *poly.interiors)
                ]
                parts.append(Polygon(rings[0], rings[1:]))
            face.polygon = unary_union(parts)
            add(face, room, "ceiling", room.id, True)
            # Walls are split at ceiling ridges/steps, not approximated by a flat lid.
            boundary = room.air.boundary.intersection(ceiling.polygon.boundary)
            for line in get_parts(boundary):
                if not isinstance(line, LineString):
                    continue
                for a, b in pairwise(line.coords):
                    if math.dist(a, b) < 1e-5:
                        continue
                    segment = LineString([a, b])
                    if not room.air.boundary.buffer(1e-6).covers(segment):
                        continue
                    # Recover CCW room-facing direction irrespective of intersection order.
                    original = next(
                        (
                            LineString([c, d])
                            for c, d in pairwise(room.air.exterior.coords)
                            if LineString([c, d]).buffer(1e-5).covers(segment)
                        ),
                        None,
                    )
                    if original is None:
                        raise ValueError("Cannot identify the authoritative room-facing wall.")
                    if original.project(Point(a)) > original.project(Point(b)):
                        a, b = b, a
                    normal = (b[1] - a[1], a[0] - b[0], 0)
                    source_edge = min(room.edges, key=lambda e: e.line.distance(segment.centroid))
                    wall_id = prefix + f":wall:{source_edge.source_key}"
                    wall = face_from_ring(
                        wall_id,
                        [
                            (a[0], a[1], room.base),
                            (b[0], b[1], room.base),
                            (b[0], b[1], ceiling.height(*b)),
                            (a[0], a[1], ceiling.height(*a)),
                        ],
                        normal,
                    )
                    for portal in domain.portals:
                        ring = portal.rings.get(room.id)
                        if not ring or any(
                            abs(sum((p[k] - wall.origin[k]) * wall.normal[k] for k in range(3))) > TOLERANCE_MM
                            for p in ring
                        ):
                            continue
                        hole = Polygon([wall.project(p) for p in ring])
                        cut = wall.polygon.intersection(hole)
                        if cut.area <= 1e-6:
                            continue
                        wall.polygon = wall.polygon.difference(cut)
                        if not portal.traversable:
                            cap_id = prefix + f":{portal.kind}:{portal.id}"
                            cap = Face(cap_id, wall.origin, wall.u, wall.v, wall.normal, cut)
                            add(cap, room, portal.kind if portal.kind in ("door", "window") else "cap", portal.id)
                    add(wall, room, "wall", f"wall-{source_edge.index + 1:03d}", True)
        for i, first in enumerate(room.ceiling):
            for second in room.ceiling[i + 1 :]:
                for line in get_parts(first.polygon.boundary.intersection(second.polygon.boundary)):
                    if not isinstance(line, LineString):
                        continue
                    for a, b in pairwise(line.coords):
                        h1, h2 = first.height(*a), second.height(*a)
                        if abs(h1 - h2) < TOLERANCE_MM:
                            continue
                        low, high = (first, second) if h1 < h2 else (second, first)
                        toward = low.polygon.representative_point()
                        nx, ny = b[1] - a[1], a[0] - b[0]
                        if nx * (toward.x - a[0]) + ny * (toward.y - a[1]) < 0:
                            nx, ny = -nx, -ny
                        face = face_from_ring(
                            prefix + f":step:{i}",
                            [
                                (a[0], a[1], low.height(*a)),
                                (b[0], b[1], low.height(*b)),
                                (b[0], b[1], high.height(*b)),
                                (a[0], a[1], high.height(*a)),
                            ],
                            (nx, ny, 0),
                        )
                        add(face, room, "ceiling", room.id)
    lookup = {r.id: r for r in domain.regions}
    for portal in domain.portals:
        if not portal.traversable or not all(r in domain.included for r in portal.room_ids):
            continue
        first_ring, second_ring = [portal.rings[r] for r in portal.room_ids]
        room = lookup[portal.room_ids[0]]
        for i in range(len(first_ring)):
            j = (i + 1) % len(first_ring)
            ring = [first_ring[i], first_ring[j], second_ring[j], second_ring[i]]
            n = cross(sub(ring[1], ring[0]), sub(ring[3], ring[0]))
            if sum(v * v for v in n) < 1e-10:
                continue
            center = tuple(sum(p[k] for p in [*first_ring, *second_ring]) / (len(first_ring) * 2) for k in range(3))
            if sum(n[k] * (center[k] - ring[0][k]) for k in range(3)) > 0:
                n = (-n[0], -n[1], -n[2])
            face = face_from_ring(f"{portal.floor_id}:passage:{portal.id}:reveal:{i}", ring, n)
            add(face, room, "wall", portal.id)
    for void in domain.floor_voids:
        if not {void["lower"], void["upper"]} <= domain.included:
            continue
        room = lookup[void["upper"]]
        # Void tunnel normals point out of fluid, i.e. outside the void footprint.
        for i, (a, b) in enumerate(pairwise(orient(void["polygon"]).exterior.coords)):
            ring = [
                (a[0], a[1], void["bottom"]),
                (b[0], b[1], void["bottom"]),
                (b[0], b[1], void["top"]),
                (a[0], a[1], void["top"]),
            ]
            add(
                face_from_ring(f"{room.floor_id}:void:{void['id']}:{i}", ring, (b[1] - a[1], a[0] - b[0], 0)),
                room,
                "slabSide",
                void["id"],
            )
    return faces, patches
