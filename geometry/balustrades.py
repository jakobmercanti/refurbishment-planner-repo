"""Millimetre guard envelopes. Appearance and CFD are never the fit authority."""

import json
import math
from pathlib import Path
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field
from shapely.geometry import Polygon
from shapely.geometry.base import BaseGeometry
from shapely.ops import unary_union

BALUSTRADE_STYLES: list[dict[str, Any]] = json.loads(
    (Path(__file__).resolve().parents[1] / "frontend/lib/balustradeStyles.json").read_text(encoding="utf-8")
)


class BalustradeConfiguration(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True, allow_inf_nan=False)
    enabled: bool
    style: Literal["VERTICAL", "HORIZONTAL", "GLASS", "TIMBER", "SOLID"]
    heightMm: float = Field(ge=600, le=2000)
    colour: str = Field(pattern=r"^#[0-9a-fA-F]{6}$")


def balustrade_footprint(vertices: list[dict[str, float]], config: BalustradeConfiguration) -> BaseGeometry:
    if not config.enabled:
        return Polygon()
    area = sum(
        a["x"] * vertices[(i + 1) % len(vertices)]["y"] - vertices[(i + 1) % len(vertices)]["x"] * a["y"]
        for i, a in enumerate(vertices)
    )
    sign = 1 if area >= 0 else -1
    depth = next(style["depthMm"] for style in BALUSTRADE_STYLES if style["id"] == config.style)
    offset = depth / 2 + 25
    normals: list[tuple[float, float]] = []
    for i, start in enumerate(vertices):
        end = vertices[(i + 1) % len(vertices)]
        length = math.hypot(end["x"] - start["x"], end["y"] - start["y"])
        if length < 1:
            raise ValueError("Balustrade edges need a positive length.")
        normals.append((sign * (end["y"] - start["y"]) / length, -sign * (end["x"] - start["x"]) / length))
    points: list[tuple[float, float]] = []
    for i, p in enumerate(vertices):
        a, b = normals[i - 1], normals[i]
        den = 1 + a[0] * b[0] + a[1] * b[1]
        if den < 0.125:
            raise ValueError("Opening corner is too sharp for a balustrade.")
        points.append((p["x"] + offset * (a[0] + b[0]) / den, p["y"] + offset * (a[1] + b[1]) / den))
    polygons = []
    for i, a in enumerate(points):
        b = points[(i + 1) % len(points)]
        length = math.hypot(b[0] - a[0], b[1] - a[1])
        if length < 1:
            raise ValueError("Opening corner is too narrow for a balustrade.")
        dx, dy = (b[0] - a[0]) / length * depth / 2, (b[1] - a[1]) / length * depth / 2
        polygons.append(
            Polygon(
                [
                    (a[0] - dx - dy, a[1] - dy + dx),
                    (b[0] + dx - dy, b[1] + dy + dx),
                    (b[0] + dx + dy, b[1] + dy - dx),
                    (a[0] - dx + dy, a[1] - dy - dx),
                ]
            )
        )
    return unary_union(polygons)
