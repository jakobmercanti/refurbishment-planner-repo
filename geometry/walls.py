"""Room polygon validation and outward wall derivation."""

from __future__ import annotations

import math

from shapely import BufferCapStyle, BufferJoinStyle
from shapely.geometry import LineString, Polygon
from shapely.validation import explain_validity

from geometry.constants import GEOMETRY_EPSILON_MM
from geometry.models import Point2D, RoomDefinition, WallSegment


class PolygonValidationError(ValueError):
    """Raised when an internal room boundary is not valid engineering geometry."""


def room_polygon(room: RoomDefinition) -> Polygon:
    coordinates = [(vertex.x, vertex.y) for vertex in room.vertices]
    polygon = Polygon(coordinates)
    if not polygon.is_valid:
        raise PolygonValidationError(f"invalid room polygon: {explain_validity(polygon)}")
    if polygon.is_empty or polygon.area <= GEOMETRY_EPSILON_MM**2:
        raise PolygonValidationError("room polygon has zero usable area")
    if not polygon.exterior.is_ccw:
        raise PolygonValidationError("room polygon vertices must be counter-clockwise")
    return polygon


def derive_walls(room: RoomDefinition) -> list[WallSegment]:
    room_polygon(room)
    walls: list[WallSegment] = []
    vertices = room.vertices
    for index, (start, end) in enumerate(zip(vertices, vertices[1:] + vertices[:1], strict=True), start=1):
        dx = end.x - start.x
        dy = end.y - start.y
        length = math.hypot(dx, dy)
        if length <= GEOMETRY_EPSILON_MM:
            raise PolygonValidationError(f"wall {index} has zero length")
        unit_x, unit_y = dx / length, dy / length
        walls.append(
            WallSegment(
                id=f"wall-{index:03d}",
                start=start,
                end=end,
                length_mm=length,
                height_mm=room.wall_height.value,
                thickness_mm=room.wall_thickness_overrides_mm.get(f"wall-{index:03d}", room.wall_thickness.value),
                interior_normal=Point2D(x=-unit_y, y=unit_x),
                exterior_normal=Point2D(x=unit_y, y=-unit_x),
            )
        )
    return walls


def outward_wall_footprint(wall: WallSegment) -> Polygon:
    """Create a flat-capped wall footprint strictly on the exterior/right side."""

    line = LineString([(wall.start.x, wall.start.y), (wall.end.x, wall.end.y)])
    footprint = line.buffer(
        -wall.thickness_mm,
        single_sided=True,
        cap_style=BufferCapStyle.flat,
        join_style=BufferJoinStyle.mitre,
    )
    if not isinstance(footprint, Polygon) or footprint.is_empty:
        raise RuntimeError(f"failed to derive outward footprint for {wall.id}")
    return footprint


def wall_by_id(room: RoomDefinition, wall_id: str) -> WallSegment:
    for wall in derive_walls(room):
        if wall.id == wall_id:
            return wall
    raise ValueError(f"unknown parent wall: {wall_id}")
