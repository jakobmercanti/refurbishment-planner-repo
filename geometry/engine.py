"""Deterministic fit-rule engine. No CAD, database, HTTP, or AI dependencies."""

from __future__ import annotations

import math

from shapely import affinity
from shapely.geometry import LineString, Polygon
from shapely.geometry.base import BaseGeometry

from geometry.constants import ENGINE_VERSION, GEOMETRY_EPSILON_MM
from geometry.models import (
    CheckStatus,
    Collision,
    FitCheck,
    FitResult,
    FitStatus,
    OpeningKind,
    Placement,
    ProductDefinition,
    RoomDefinition,
    VerificationStatus,
)
from geometry.shapes import (
    door_swing_envelope,
    obstacle_footprint,
    opening_line,
    product_footprint,
    product_geometry_uncertainty_mm,
    z_intervals_overlap,
)
from geometry.walls import room_polygon, wall_by_id


def _check(
    check_id: str,
    status: CheckStatus,
    explanation: str,
    *,
    measured: str | float | None = None,
    required: str | float | None = None,
    margin: float | None = None,
    uncertainty: float = 0.0,
    references: list[str] | None = None,
    critical: bool = True,
) -> FitCheck:
    return FitCheck(
        check_id=check_id,
        status=status,
        explanation=explanation,
        measured_value=measured,
        required_value=required,
        margin_mm=margin,
        uncertainty_mm=uncertainty,
        geometry_reference=references or [],
        critical=critical,
    )


def _penetration_mm(intersection: BaseGeometry) -> float | None:
    if intersection.is_empty:
        return None
    min_x, min_y, max_x, max_y = intersection.bounds
    return min(max_x - min_x, max_y - min_y)


def _allowed_rotation(rotation: float, allowed: list[float]) -> bool:
    normalised = rotation % 360.0
    return any(abs((normalised - candidate + 180.0) % 360.0 - 180.0) <= GEOMETRY_EPSILON_MM for candidate in allowed)


def _operational_envelope(product: ProductDefinition, placement: Placement) -> Polygon | None:
    radius = product.operational_swing_radius_mm
    if radius is None:
        return None
    width = product.nominal_dimensions.width.value
    depth = product.nominal_dimensions.depth.value
    hinge_x = -width / 2.0 if product.handedness != "RIGHT" else width / 2.0
    hinge_y = -depth / 2.0
    direction = -1.0 if product.handedness != "RIGHT" else 1.0
    closed_angle = 0.0 if direction < 0 else math.pi
    points = [(hinge_x, hinge_y)]
    for step in range(49):
        angle = closed_angle + direction * (math.pi / 2.0) * step / 48.0
        points.append((hinge_x + radius * math.cos(angle), hinge_y + radius * math.sin(angle)))
    points.append((hinge_x, hinge_y))
    envelope = Polygon(points)
    envelope = affinity.rotate(envelope, placement.rotation_deg, origin=(0.0, 0.0))
    return affinity.translate(envelope, placement.center.x, placement.center.y)


def check_fit(
    room: RoomDefinition,
    product: ProductDefinition,
    placement: Placement,
) -> FitResult:
    """Evaluate all milestone rules and aggregate them into FIT/VERIFY/FAIL."""

    if placement.product_id != product.id:
        raise ValueError("placement product_id does not match the supplied product")

    room_shape = room_polygon(room)
    physical = product_footprint(product, placement)
    geometry_uncertainty = product_geometry_uncertainty_mm(product)
    expanded_physical = physical.buffer(geometry_uncertainty, join_style="mitre")
    checks: list[FitCheck] = []
    collisions: list[Collision] = []

    outside = physical.difference(room_shape)
    if outside.area > GEOMETRY_EPSILON_MM**2:
        checks.append(
            _check(
                "room-boundary-containment",
                CheckStatus.FAIL,
                f"Product extends {outside.area:.1f} mm² beyond the finished internal room boundary.",
                measured=f"outside area {outside.area:.1f} mm²",
                required="physical footprint fully inside internal polygon",
                margin=-math.sqrt(outside.area),
                uncertainty=geometry_uncertainty,
                references=[str(room.id), str(placement.id)],
            )
        )
    elif not room_shape.covers(expanded_physical):
        checks.append(
            _check(
                "room-boundary-containment",
                CheckStatus.VERIFY,
                "Nominal product geometry is inside the room, but dimensional uncertainty can "
                "cross the internal boundary.",
                measured=f"product geometry ± {geometry_uncertainty:.1f} mm",
                required="complete uncertainty envelope inside internal polygon",
                uncertainty=geometry_uncertainty,
                references=[str(room.id), str(placement.id)],
            )
        )
    else:
        clearance = physical.distance(room_shape.boundary)
        checks.append(
            _check(
                "room-boundary-containment",
                CheckStatus.PASS,
                f"Physical product and its ±{geometry_uncertainty:.1f} mm geometry envelope are inside the room.",
                measured=clearance,
                required=geometry_uncertainty,
                margin=clearance - geometry_uncertainty,
                uncertainty=geometry_uncertainty,
                references=[str(room.id), str(placement.id)],
            )
        )

    clearance = product.installation_clearance_mm
    installation_envelope = physical.buffer(clearance, join_style="mitre")
    if not room_shape.covers(installation_envelope):
        outside_installation = installation_envelope.difference(room_shape).area
        checks.append(
            _check(
                "installation-envelope",
                CheckStatus.FAIL,
                f"Required {clearance:.1f} mm installation envelope crosses the internal boundary "
                f"by {outside_installation:.1f} mm².",
                measured=f"outside area {outside_installation:.1f} mm²",
                required=f"{clearance:.1f} mm clear envelope",
                margin=-math.sqrt(max(outside_installation, 0.0)),
                references=[str(placement.id)],
            )
        )
    else:
        checks.append(
            _check(
                "installation-envelope",
                CheckStatus.PASS,
                f"The complete {clearance:.1f} mm installation envelope remains inside the room.",
                measured=clearance,
                required=clearance,
                margin=0.0,
                references=[str(placement.id)],
            )
        )

    product_top = placement.base_z_mm + product.nominal_dimensions.height.value
    room_height_lower = room.wall_height.lower_mm
    product_top_upper = product_top + product.nominal_dimensions.height.uncertainty_mm
    if product_top > room.wall_height.value + GEOMETRY_EPSILON_MM:
        status = CheckStatus.FAIL
        explanation = f"Product top is {product_top:.1f} mm, above the {room.wall_height.value:.1f} mm room height."
    elif product_top_upper > room_height_lower + GEOMETRY_EPSILON_MM:
        status = CheckStatus.VERIFY
        explanation = "Nominal height fits, but the height uncertainty intervals overlap the ceiling limit."
    else:
        status = CheckStatus.PASS
        explanation = (
            f"Product top is {product_top:.1f} mm with "
            f"{room_height_lower - product_top_upper:.1f} mm conservative vertical clearance."
        )
    checks.append(
        _check(
            "vertical-clearance",
            status,
            explanation,
            measured=product_top,
            required=room.wall_height.value,
            margin=room_height_lower - product_top_upper,
            uncertainty=room.wall_height.uncertainty_mm + product.nominal_dimensions.height.uncertainty_mm,
            references=[str(room.id), str(placement.id)],
        )
    )

    for obstacle in room.obstacles:
        if not z_intervals_overlap(
            placement.base_z_mm,
            product.nominal_dimensions.height.value,
            obstacle.base_z_mm,
            obstacle.dimensions.height.value,
        ):
            continue
        obstacle_shape = obstacle_footprint(obstacle)
        intersection = physical.intersection(obstacle_shape)
        if intersection.area > GEOMETRY_EPSILON_MM**2:
            penetration = _penetration_mm(intersection)
            collisions.append(
                Collision(
                    object_id=obstacle.id,
                    collision_type="physical-obstacle",
                    overlap_area_mm2=intersection.area,
                    estimated_penetration_mm=penetration,
                )
            )
            checks.append(
                _check(
                    f"obstacle-collision:{obstacle.id}",
                    CheckStatus.FAIL,
                    f"Product intersects {obstacle.name} by approximately {penetration or 0.0:.1f} mm "
                    f"({intersection.area:.1f} mm² overlap).",
                    measured=f"{intersection.area:.1f} mm² overlap",
                    required="0 mm² physical overlap",
                    margin=-(penetration or 0.0),
                    references=[obstacle.id, str(placement.id)],
                )
            )
        else:
            obstacle_uncertainty = max(
                obstacle.dimensions.width.uncertainty_mm,
                obstacle.dimensions.depth.uncertainty_mm,
            )
            conservative = expanded_physical.buffer(obstacle_uncertainty)
            if conservative.intersects(obstacle_shape):
                checks.append(
                    _check(
                        f"obstacle-collision:{obstacle.id}",
                        CheckStatus.VERIFY,
                        f"Nominal geometry clears {obstacle.name}, but combined dimensional uncertainty "
                        "can remove the clearance.",
                        measured=physical.distance(obstacle_shape),
                        required=geometry_uncertainty + obstacle_uncertainty,
                        margin=physical.distance(obstacle_shape) - geometry_uncertainty - obstacle_uncertainty,
                        uncertainty=geometry_uncertainty + obstacle_uncertainty,
                        references=[obstacle.id, str(placement.id)],
                    )
                )
            else:
                checks.append(
                    _check(
                        f"obstacle-collision:{obstacle.id}",
                        CheckStatus.PASS,
                        f"Product clears {obstacle.name} by {physical.distance(obstacle_shape):.1f} mm.",
                        measured=physical.distance(obstacle_shape),
                        required=geometry_uncertainty + obstacle_uncertainty,
                        margin=physical.distance(obstacle_shape) - geometry_uncertainty - obstacle_uncertainty,
                        uncertainty=geometry_uncertainty + obstacle_uncertainty,
                        references=[obstacle.id, str(placement.id)],
                    )
                )

    for opening in room.openings:
        if opening.kind is OpeningKind.DOOR:
            swing = door_swing_envelope(room, opening)
            intersection = physical.intersection(swing)
            if intersection.area > GEOMETRY_EPSILON_MM**2:
                penetration = _penetration_mm(intersection)
                collisions.append(
                    Collision(
                        object_id=opening.id,
                        collision_type="door-swing",
                        overlap_area_mm2=intersection.area,
                        estimated_penetration_mm=penetration,
                    )
                )
                checks.append(
                    _check(
                        f"door-swing:{opening.id}",
                        CheckStatus.FAIL,
                        f"Product intersects the {opening.id} swept door envelope by approximately "
                        f"{penetration or 0.0:.1f} mm.",
                        measured=f"{intersection.area:.1f} mm² overlap",
                        required="clear door sweep",
                        margin=-(penetration or 0.0),
                        references=[opening.id, str(placement.id)],
                    )
                )
            else:
                checks.append(
                    _check(
                        f"door-swing:{opening.id}",
                        CheckStatus.PASS,
                        f"Product clears the {opening.id} swept envelope by {physical.distance(swing):.1f} mm.",
                        measured=physical.distance(swing),
                        required=0.0,
                        margin=physical.distance(swing),
                        references=[opening.id, str(placement.id)],
                    )
                )
        elif opening.kind is OpeningKind.WINDOW:
            wall = wall_by_id(room, opening.parent_wall_id)
            line: LineString = opening_line(room, opening)
            inward_zone = line.buffer(
                max(product.installation_clearance_mm, GEOMETRY_EPSILON_MM),
                single_sided=True,
                cap_style="flat",
            )
            vertical_overlap = z_intervals_overlap(
                placement.base_z_mm,
                product.nominal_dimensions.height.value,
                opening.sill_height_mm,
                opening.height.value,
            )
            conflict = vertical_overlap and physical.intersection(inward_zone).area > GEOMETRY_EPSILON_MM**2
            checks.append(
                _check(
                    f"window-conflict:{opening.id}",
                    CheckStatus.FAIL if conflict else CheckStatus.PASS,
                    (
                        f"Product installation zone overlaps {opening.id} between Z={opening.sill_height_mm:.1f} and "
                        f"Z={opening.sill_height_mm + opening.height.value:.1f} mm."
                        if conflict
                        else f"Product does not conflict with the {opening.id} opening or sill zone."
                    ),
                    measured=physical.distance(line),
                    required=product.installation_clearance_mm,
                    margin=physical.distance(line) - product.installation_clearance_mm,
                    references=[opening.id, wall.id, str(placement.id)],
                )
            )

    operation = _operational_envelope(product, placement)
    if operation is None:
        checks.append(
            _check(
                "operational-envelope",
                CheckStatus.NOT_APPLICABLE,
                "Product has no operational swing envelope.",
                critical=False,
            )
        )
    else:
        operation_outside = operation.difference(room_shape)
        operation_colliders = [
            obstacle
            for obstacle in room.obstacles
            if operation.intersection(obstacle_footprint(obstacle)).area > GEOMETRY_EPSILON_MM**2
        ]
        if operation_outside.area > GEOMETRY_EPSILON_MM**2 or operation_colliders:
            collider_names = ", ".join(obstacle.name for obstacle in operation_colliders)
            detail = f" and intersects {collider_names}" if collider_names else ""
            checks.append(
                _check(
                    "operational-envelope",
                    CheckStatus.FAIL,
                    f"Product operational sweep leaves the room by {operation_outside.area:.1f} mm²{detail}.",
                    measured=f"{operation_outside.area:.1f} mm² outside",
                    required="operational sweep fully clear",
                    references=[str(placement.id), *[item.id for item in operation_colliders]],
                )
            )
        else:
            checks.append(
                _check(
                    "operational-envelope",
                    CheckStatus.PASS,
                    "Product operational sweep is inside the room and clear of fixed obstacles.",
                    measured=0.0,
                    required=0.0,
                    margin=operation.distance(room_shape.boundary),
                    references=[str(placement.id)],
                )
            )

    if not _allowed_rotation(placement.rotation_deg, product.allowed_rotations_deg):
        checks.append(
            _check(
                "orientation-rule",
                CheckStatus.FAIL,
                f"Rotation {placement.rotation_deg % 360.0:.1f}° is not permitted by the manufacturer.",
                measured=placement.rotation_deg % 360.0,
                required=str(product.allowed_rotations_deg),
                references=[str(product.id), str(placement.id)],
            )
        )
    else:
        checks.append(
            _check(
                "orientation-rule",
                CheckStatus.PASS,
                f"Rotation {placement.rotation_deg % 360.0:.1f}° is permitted.",
                measured=placement.rotation_deg % 360.0,
                required=str(product.allowed_rotations_deg),
                references=[str(product.id), str(placement.id)],
            )
        )

    allowed_range = product.installation_width_range
    available = placement.available_installation_width
    if allowed_range is None or available is None:
        checks.append(
            _check(
                "installation-adjustment-range",
                CheckStatus.VERIFY,
                "A verified finished installation width is required before ordering.",
                measured=None if available is None else available.value,
                required="verified installation range and site measurement",
                references=[str(product.id), str(placement.id)],
            )
        )
    else:
        low, high = available.lower_mm, available.upper_mm
        allowed_low, allowed_high = allowed_range.minimum_mm, allowed_range.maximum_mm
        if high < allowed_low - GEOMETRY_EPSILON_MM or low > allowed_high + GEOMETRY_EPSILON_MM:
            range_status = CheckStatus.FAIL
            explanation = (
                f"Finished opening {available.value:.1f} ± {available.uncertainty_mm:.1f} mm is outside "
                f"the verified {allowed_low:.1f}–{allowed_high:.1f} mm installation range."
            )
        elif low < allowed_low - GEOMETRY_EPSILON_MM or high > allowed_high + GEOMETRY_EPSILON_MM:
            range_status = CheckStatus.VERIFY
            explanation = (
                f"Scanned wall width is {available.value:.1f} ± {available.uncertainty_mm:.1f} mm while "
                f"the enclosure requires {allowed_low:.1f}–{allowed_high:.1f} mm. Confirm the finished "
                "wall-to-wall dimension manually."
            )
        else:
            range_status = CheckStatus.PASS
            explanation = (
                f"Complete measured interval {low:.1f}–{high:.1f} mm is inside the verified "
                f"{allowed_low:.1f}–{allowed_high:.1f} mm installation range."
            )
        margin = min(low - allowed_low, allowed_high - high)
        checks.append(
            _check(
                "installation-adjustment-range",
                range_status,
                explanation,
                measured=f"{available.value:.1f} ± {available.uncertainty_mm:.1f} mm",
                required=f"{allowed_low:.1f}–{allowed_high:.1f} mm",
                margin=margin,
                uncertainty=available.uncertainty_mm,
                references=[str(product.id), str(placement.id)],
            )
        )

    if product.verification_status is not VerificationStatus.VERIFIED:
        checks.append(
            _check(
                "product-specification-verification",
                CheckStatus.VERIFY,
                "Manufacturer engineering dimensions are not verified; confirm the current datasheet revision.",
                measured=product.verification_status.value,
                required=VerificationStatus.VERIFIED.value,
                references=[str(product.id)],
            )
        )
    else:
        checks.append(
            _check(
                "product-specification-verification",
                CheckStatus.PASS,
                "Product dimensions and installation range are marked verified.",
                measured=product.verification_status.value,
                required=VerificationStatus.VERIFIED.value,
                references=[str(product.id)],
            )
        )

    critical_checks = [check for check in checks if check.critical]
    failures = [check for check in critical_checks if check.status is CheckStatus.FAIL]
    verifications = [check for check in critical_checks if check.status is CheckStatus.VERIFY]
    if failures:
        overall = FitStatus.FAIL
        summary = f"FAIL — {failures[0].explanation}"
    elif verifications:
        overall = FitStatus.VERIFY
        summary = f"VERIFY — {verifications[0].explanation}"
    else:
        overall = FitStatus.FIT
        summary = "FIT — all critical deterministic checks pass across the stated uncertainty envelopes."

    manual_required = []
    for item in verifications:
        if item.check_id == "installation-adjustment-range":
            manual_required.append("Measure the finished wall-to-wall installation opening manually.")
        else:
            manual_required.append(item.explanation)

    minimum_clearance = physical.distance(room_shape.boundary) if room_shape.covers(physical) else 0.0
    for obstacle in room.obstacles:
        minimum_clearance = min(minimum_clearance, physical.distance(obstacle_footprint(obstacle)))

    return FitResult(
        status=overall,
        summary=summary,
        checks=checks,
        minimum_clearance_mm=minimum_clearance,
        collisions=collisions,
        manual_measurements_required=list(dict.fromkeys(manual_required)),
        engine_version=ENGINE_VERSION,
        room_id=room.id,
        room_version=room.version,
        product_id=product.id,
        product_version=product.version,
        placement=placement,
    )
