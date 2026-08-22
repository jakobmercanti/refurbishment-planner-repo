"""Deterministic footprints for products, obstacles, openings, and door sweeps."""

from __future__ import annotations

import math

from shapely import affinity
from shapely.geometry import LineString, Point, Polygon, box

from geometry.constants import DOOR_SWING_SEGMENTS, GEOMETRY_EPSILON_MM
from geometry.models import (
    GenericOpening,
    HingeSide,
    ObstacleDefinition,
    OpeningKind,
    Placement,
    ProductDefinition,
    RoomDefinition,
    WallSegment,
)
from geometry.walls import wall_by_id


def oriented_box(center_x: float, center_y: float, width: float, depth: float, angle: float) -> Polygon:
    footprint = box(-width / 2.0, -depth / 2.0, width / 2.0, depth / 2.0)
    footprint = affinity.rotate(footprint, angle, origin=(0.0, 0.0), use_radians=False)
    return affinity.translate(footprint, center_x, center_y)


def product_footprint(product: ProductDefinition, placement: Placement) -> Polygon:
    return oriented_box(
        placement.center.x,
        placement.center.y,
        product.nominal_dimensions.width.value,
        product.nominal_dimensions.depth.value,
        placement.rotation_deg,
    )


def product_geometry_uncertainty_mm(product: ProductDefinition) -> float:
    return max(
        product.nominal_dimensions.width.uncertainty_mm,
        product.nominal_dimensions.depth.uncertainty_mm,
    )


def obstacle_footprint(obstacle: ObstacleDefinition) -> Polygon:
    if obstacle.kind.value == "CYLINDER":
        radius = obstacle.dimensions.width.value / 2.0
        return Point(obstacle.center.x, obstacle.center.y).buffer(radius, quad_segs=32)
    return oriented_box(
        obstacle.center.x,
        obstacle.center.y,
        obstacle.dimensions.width.value,
        obstacle.dimensions.depth.value,
        obstacle.rotation_deg,
    )


def opening_endpoints(opening: GenericOpening, wall: WallSegment) -> tuple[Point, Point]:
    if opening.offset_mm + opening.width.value > wall.length_mm + GEOMETRY_EPSILON_MM:
        raise ValueError(f"opening {opening.id} exceeds parent wall {wall.id}")
    dx = (wall.end.x - wall.start.x) / wall.length_mm
    dy = (wall.end.y - wall.start.y) / wall.length_mm
    start = Point(wall.start.x + dx * opening.offset_mm, wall.start.y + dy * opening.offset_mm)
    end = Point(start.x + dx * opening.width.value, start.y + dy * opening.width.value)
    return start, end


def opening_line(room: RoomDefinition, opening: GenericOpening) -> LineString:
    wall = wall_by_id(room, opening.parent_wall_id)
    start, end = opening_endpoints(opening, wall)
    return LineString([(start.x, start.y), (end.x, end.y)])


def door_swing_envelope(room: RoomDefinition, door: GenericOpening) -> Polygon:
    if door.kind is not OpeningKind.DOOR:
        raise ValueError("door_swing_envelope requires a door opening")
    wall = wall_by_id(room, door.parent_wall_id)
    start, end = opening_endpoints(door, wall)
    if door.hinge_side is HingeSide.START:
        hinge = start
        closed_angle = math.atan2(end.y - start.y, end.x - start.x)
        direction = 1.0 if door.opens_inward else -1.0
    else:
        hinge = end
        closed_angle = math.atan2(start.y - end.y, start.x - end.x)
        direction = -1.0 if door.opens_inward else 1.0
    sweep_radians = math.radians(door.swing_angle_deg or 90.0) * direction
    radius = door.width.value
    arc_points = []
    for step in range(DOOR_SWING_SEGMENTS + 1):
        angle = closed_angle + sweep_radians * step / DOOR_SWING_SEGMENTS
        arc_points.append((hinge.x + radius * math.cos(angle), hinge.y + radius * math.sin(angle)))
    return Polygon([(hinge.x, hinge.y), *arc_points, (hinge.x, hinge.y)])


def z_intervals_overlap(base_a: float, height_a: float, base_b: float, height_b: float) -> bool:
    return min(base_a + height_a, base_b + height_b) - max(base_a, base_b) > GEOMETRY_EPSILON_MM
