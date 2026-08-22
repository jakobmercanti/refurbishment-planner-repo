"""Deterministic analysis of user-placed bathroom fixtures and furniture."""

from __future__ import annotations

import math
from itertools import combinations

from geometry.constants import ENGINE_VERSION, GEOMETRY_EPSILON_MM
from geometry.models import CheckStatus, FitCheck, FitStatus, LayoutResult, OpeningKind, RoomDefinition
from geometry.shapes import door_swing_envelope, obstacle_footprint, z_intervals_overlap
from geometry.walls import room_polygon


def _check(check_id: str, status: CheckStatus, explanation: str, references: list[str], margin: float | None = None) -> FitCheck:
    return FitCheck(
        check_id=check_id,
        status=status,
        explanation=explanation,
        geometry_reference=references,
        margin_mm=margin,
    )


def analyse_layout(room: RoomDefinition) -> LayoutResult:
    """Check only the fixtures and furniture present in ``room.obstacles``."""

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

    failures = sum(check.status is CheckStatus.FAIL for check in checks)
    if not room.obstacles:
        status = FitStatus.VERIFY
        summary = "VERIFY — Add fixtures or furniture before running a complete layout check."
    elif failures:
        status = FitStatus.FAIL
        summary = f"FAIL — {failures} layout conflict{'s' if failures != 1 else ''} require attention."
    else:
        status = FitStatus.FIT
        summary = f"FIT — All {len(room.obstacles)} placed element{'s' if len(room.obstacles) != 1 else ''} fit the checked room geometry."

    return LayoutResult(
        status=status,
        summary=summary,
        checks=checks,
        collision_ids=sorted(collision_ids),
        engine_version=ENGINE_VERSION,
        room_id=room.id,
        room_version=room.version,
    )
