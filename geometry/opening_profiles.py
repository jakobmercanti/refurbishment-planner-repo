"""Deterministic doorless aperture elevations, in millimetres. No renderer dependency."""

import math


def passage_height_mm(profile: str, width: float, height: float, x: float) -> float:
    along = max(0.0, min(width, x))
    if profile == "RECTANGULAR":
        return height
    if profile not in ("ROUND_ARCH", "SEGMENTAL_ARCH", "CHAMFERED"):
        raise ValueError("Unknown passage profile")
    rise = min(width * (0.5 if profile == "ROUND_ARCH" else 0.2 if profile == "CHAMFERED" else 0.18), height * 0.45)
    if profile == "CHAMFERED":
        return height - rise + rise * min(1.0, along / (width * 0.18), (width - along) / (width * 0.18))
    t = 2 * along / width - 1
    return height - rise + rise * math.sqrt(max(0.0, 1 - t * t))


def passage_polygon_mm(profile: str, width: float, height: float) -> list[tuple[float, float]]:
    knots = (
        [width * 0.18, width * 0.82]
        if profile == "CHAMFERED"
        else [width * (1 - math.cos(i * math.pi / 64)) / 2 for i in range(1, 64)]
    )
    return [
        (0.0, 0.0),
        (width, 0.0),
        *[(x, passage_height_mm(profile, width, height, x)) for x in [width, *reversed(knots), 0.0]],
    ]
