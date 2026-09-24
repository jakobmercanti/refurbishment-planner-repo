"""Deterministic analysis of user-placed bathroom fixtures and furniture."""

from __future__ import annotations

import math
from itertools import combinations

from shapely.geometry import Polygon

from geometry.constants import ENGINE_VERSION, GEOMETRY_EPSILON_MM
from geometry.models import CheckStatus, FitCheck, FitStatus, LayoutResult, ObstacleDefinition, OpeningKind, PersonPosture, RoomDefinition
from geometry.shapes import door_swing_envelope, obstacle_footprint, oriented_box, z_intervals_overlap
from geometry.walls import room_polygon


def _check(
    check_id: str,
    status: CheckStatus,
    explanation: str,
    references: list[str],
    margin: float | None = None,
) -> FitCheck:
    return FitCheck(
        check_id=check_id,
        status=status,
        explanation=explanation,
        geometry_reference=references,
        margin_mm=margin,
    )


def _category_clearance_envelope(item: ObstacleDefinition) -> Polygon:
    """Return the required side/front envelope in the item's local orientation.

    The front of a fixture is its positive local-depth direction.  Side clearance
    is therefore applied symmetrically across the local width, while front
    clearance is applied only in front of the item rather than conservatively
    inflating all four sides.
    """

    side = item.side_clearance_mm or 0.0
    front = item.front_clearance_mm or 0.0
    dimensions = item.dimensions
    center = item.center
    rotation = item.rotation_deg
    angle = math.radians(rotation)
    # A local +Y vector rotates to (-sin(a), cos(a)) in world coordinates.
    front_center_offset = front / 2.0
    return oriented_box(
        center.x - math.sin(angle) * front_center_offset,
        center.y + math.cos(angle) * front_center_offset,
        dimensions.width.value + side * 2.0,
        dimensions.depth.value + front,
        rotation,
    )


def analyse_layout(room: RoomDefinition) -> LayoutResult:
    """Check placed elements and the optional human usability envelope."""

    room_shape = room_polygon(room)
    checks: list[FitCheck] = []
    collision_ids: set[str] = set()

    for item in room.obstacles:
        footprint = obstacle_footprint(item)
        outside_area = footprint.difference(room_shape).area
        if outside_area > GEOMETRY_EPSILON_MM**2:
            collision_ids.add(item.id)
            checks.append(_check(
                f"room-boundary:{item.id}",
                CheckStatus.FAIL,
                f"{item.name} extends {outside_area:.1f} mm² beyond the internal room boundary.",
                [item.id, str(room.id)],
                -math.sqrt(outside_area),
            ))
        else:
            clearance = footprint.distance(room_shape.boundary)
            checks.append(_check(
                f"room-boundary:{item.id}",
                CheckStatus.PASS,
                f"{item.name} is inside the room with {clearance:.1f} mm minimum boundary clearance.",
                [item.id, str(room.id)],
                clearance,
            ))

        side_clearance = item.side_clearance_mm or 0.0
        front_clearance = item.front_clearance_mm or 0.0
        if side_clearance or front_clearance:
            clearance_zone = _category_clearance_envelope(item)
            outside_clearance = clearance_zone.difference(room_shape).area
            status = CheckStatus.FAIL if outside_clearance > GEOMETRY_EPSILON_MM**2 else CheckStatus.PASS
            if status is CheckStatus.FAIL:
                collision_ids.add(item.id)
            checks.append(_check(
                f"category-clearance:{item.id}", status,
                (f"{item.name} requires {side_clearance:.0f} mm side and {front_clearance:.0f} mm front clearance; the directional clearance envelope {'crosses the room boundary' if status is CheckStatus.FAIL else 'fits inside the room'}.'"),
                [item.id, str(room.id)],
                -math.sqrt(outside_clearance) if status is CheckStatus.FAIL else clearance_zone.distance(room_shape.boundary),
            ))

        top = item.base_z_mm + item.dimensions.height.value
        vertical_margin = room.wall_height.value - top
        vertical_status = CheckStatus.PASS if vertical_margin >= -GEOMETRY_EPSILON_MM else CheckStatus.FAIL
        if vertical_status is CheckStatus.FAIL:
            collision_ids.add(item.id)
        checks.append(_check(
            f"vertical-clearance:{item.id}",
            vertical_status,
            (
                f"{item.name} has {max(vertical_margin, 0):.1f} mm clearance below the room height."
                if vertical_status is CheckStatus.PASS
                else f"{item.name} exceeds the room height by {-vertical_margin:.1f} mm."
            ),
            [item.id, str(room.id)],
            vertical_margin,
        ))

    for first, second in combinations(room.obstacles, 2):
        if not z_intervals_overlap(
            first.base_z_mm,
            first.dimensions.height.value,
            second.base_z_mm,
            second.dimensions.height.value,
        ):
            continue
        first_shape = obstacle_footprint(first)
        second_shape = obstacle_footprint(second)
        overlap = first_shape.intersection(second_shape).area
        if overlap > GEOMETRY_EPSILON_MM**2:
            collision_ids.update((first.id, second.id))
            checks.append(_check(
                f"item-collision:{first.id}:{second.id}",
                CheckStatus.FAIL,
                f"{first.name} overlaps {second.name} by {overlap:.1f} mm².",
                [first.id, second.id],
                -math.sqrt(overlap),
            ))
        for owner, other, other_shape in ((first, second, second_shape), (second, first, first_shape)):
            if not (owner.side_clearance_mm or owner.front_clearance_mm):
                continue
            clearance_overlap = _category_clearance_envelope(owner).intersection(other_shape).area
            if clearance_overlap > GEOMETRY_EPSILON_MM**2:
                collision_ids.update((owner.id, other.id))
                checks.append(_check(
                    f"category-clearance:{owner.id}:item:{other.id}",
                    CheckStatus.FAIL,
                    f"{other.name} occupies {clearance_overlap:.1f} mm² of {owner.name}'s required directional clearance zone.",
                    [owner.id, other.id],
                    -math.sqrt(clearance_overlap),
                ))

    for door in (opening for opening in room.openings if opening.kind is OpeningKind.DOOR):
        swing = door_swing_envelope(room, door)
        for item in room.obstacles:
            if not z_intervals_overlap(0, door.height.value, item.base_z_mm, item.dimensions.height.value):
                continue
            overlap = swing.intersection(obstacle_footprint(item)).area
            if overlap > GEOMETRY_EPSILON_MM**2:
                collision_ids.add(item.id)
                checks.append(_check(
                    f"door-swing:{door.id}:{item.id}",
                    CheckStatus.FAIL,
                    f"{item.name} obstructs the {door.id} swept opening by {overlap:.1f} mm².",
                    [door.id, item.id],
                    -math.sqrt(overlap),
                ))

    person = room.person_mockup
    person_is_checked = bool(person and person.enabled and person.include_in_analysis)
    if person_is_checked and person is not None:
        effective_height = (
            person.height_mm
            if person.posture is PersonPosture.STANDING
            else min(person.height_mm, person.eye_height_mm + person.height_mm * 0.08)
        )
        body = oriented_box(
            person.center.x,
            person.center.y,
            person.shoulder_width_mm,
            person.body_depth_mm,
            person.rotation_deg,
        )
        movement = body.buffer(person.movement_clearance_mm, join_style="round")
        outside_area = body.difference(room_shape).area
        if outside_area > GEOMETRY_EPSILON_MM**2:
            collision_ids.add(person.id)
            checks.append(_check(
                f"person-boundary:{person.id}",
                CheckStatus.FAIL,
                f"The human body envelope extends {outside_area:.1f} mm² beyond the room boundary.",
                [person.id, str(room.id)],
                -math.sqrt(outside_area),
            ))
        else:
            clearance = body.distance(room_shape.boundary)
            checks.append(_check(
                f"person-boundary:{person.id}",
                CheckStatus.PASS,
                f"The human body envelope is inside the room with {clearance:.1f} mm boundary clearance.",
                [person.id, str(room.id)],
                clearance,
            ))

        height_margin = room.wall_height.value - effective_height
        height_status = CheckStatus.PASS if height_margin >= -GEOMETRY_EPSILON_MM else CheckStatus.FAIL
        if height_status is CheckStatus.FAIL:
            collision_ids.add(person.id)
        checks.append(_check(
            f"person-height:{person.id}",
            height_status,
            (
                f"The configured person has {max(height_margin, 0):.1f} mm headroom."
                if height_status is CheckStatus.PASS
                else f"The configured person exceeds the room height by {-height_margin:.1f} mm."
            ),
            [person.id, str(room.id)],
            height_margin,
        ))

        movement_outside = movement.difference(room_shape).area
        if movement_outside > GEOMETRY_EPSILON_MM**2:
            checks.append(_check(
                f"person-movement-boundary:{person.id}",
                CheckStatus.VERIFY,
                "The requested movement clearance is restricted by a wall; verify usability at this position.",
                [person.id, str(room.id)],
                -math.sqrt(movement_outside),
            ))
        else:
            checks.append(_check(
                f"person-movement-boundary:{person.id}",
                CheckStatus.PASS,
                "The requested movement clearance remains inside the room.",
                [person.id, str(room.id)],
                movement.distance(room_shape.boundary),
            ))

        for item in room.obstacles:
            if item.base_z_mm >= effective_height - GEOMETRY_EPSILON_MM:
                continue
            footprint = obstacle_footprint(item)
            overlap = body.intersection(footprint).area
            if overlap > GEOMETRY_EPSILON_MM**2:
                collision_ids.update((person.id, item.id))
                checks.append(_check(
                    f"person-collision:{person.id}:{item.id}",
                    CheckStatus.FAIL,
                    f"The human body envelope overlaps {item.name} by {overlap:.1f} mm².",
                    [person.id, item.id],
                    -math.sqrt(overlap),
                ))
            elif movement.intersects(footprint):
                checks.append(_check(
                    f"person-movement:{person.id}:{item.id}",
                    CheckStatus.VERIFY,
                    f"{item.name} enters the requested movement clearance; verify the intended activity.",
                    [person.id, item.id],
                    body.distance(footprint) - person.movement_clearance_mm,
                ))

        for door in (opening for opening in room.openings if opening.kind is OpeningKind.DOOR):
            if door.height.value <= 0:
                continue
            swing = door_swing_envelope(room, door)
            overlap = body.intersection(swing).area
            if overlap > GEOMETRY_EPSILON_MM**2:
                collision_ids.add(person.id)
                checks.append(_check(
                    f"person-door-swing:{person.id}:{door.id}",
                    CheckStatus.FAIL,
                    "The human body envelope obstructs the door sweep.",
                    [person.id, door.id],
                    -math.sqrt(overlap),
                ))
            elif movement.intersects(swing):
                checks.append(_check(
                    f"person-door-clearance:{person.id}:{door.id}",
                    CheckStatus.VERIFY,
                    "The door sweep enters the requested movement clearance; verify simultaneous use.",
                    [person.id, door.id],
                    body.distance(swing) - person.movement_clearance_mm,
                ))

    failures = sum(check.status is CheckStatus.FAIL for check in checks)
    verifications = sum(check.status is CheckStatus.VERIFY for check in checks)
    checked_items = len(room.obstacles) + (1 if person_is_checked else 0)
    if checked_items == 0:
        status = FitStatus.VERIFY
        summary = "VERIFY — Add fixtures, furniture or a person before running a complete layout check."
    elif failures:
        status = FitStatus.FAIL
        summary = f"FAIL — {failures} layout conflict{'s' if failures != 1 else ''} require attention."
    elif verifications:
        status = FitStatus.VERIFY
        suffix = "s" if verifications != 1 else ""
        summary = f"VERIFY — {verifications} usability clearance check{suffix} require review."
    else:
        status = FitStatus.FIT
        suffix = "s" if checked_items != 1 else ""
        summary = f"FIT — All {checked_items} placed model{suffix} fit the checked room geometry."

    return LayoutResult(
        status=status,
        summary=summary,
        checks=checks,
        collision_ids=sorted(collision_ids),
        engine_version=ENGINE_VERSION,
        room_id=room.id,
        room_version=room.version,
    )
