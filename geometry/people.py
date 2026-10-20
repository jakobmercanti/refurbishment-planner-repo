"""Nominal occupant templates and explicit furniture contact, always in mm.

Generic proportions are not anthropometric/ergonomic certification. The measured
obstacle envelope remains authoritative; neither the render nor CFD surface is
used to decide fit.
"""

from __future__ import annotations

import json
import math
import re
from pathlib import Path
from typing import TYPE_CHECKING, Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator

if TYPE_CHECKING:
    from geometry.models import ObstacleDefinition

PERSON_MODELS = json.loads(
    (Path(__file__).resolve().parents[1] / "frontend/lib/personModels.json").read_text(encoding="utf8")
)
STATURE_PRESETS = (900, 1200, 1500, 1650, 1800, 1950)


class PersonSupport(BaseModel):
    model_config = ConfigDict(extra="forbid")
    obstacle_id: str = Field(min_length=1, max_length=150)
    surface_height_mm: float = Field(ge=0, le=20_000, allow_inf_nan=False)
    lateral_offset_mm: float = Field(default=0, ge=-20_000, le=20_000, allow_inf_nan=False)


class CataloguePerson(BaseModel):
    model_config = ConfigDict(extra="forbid")
    posture: Literal["STANDING", "SEATED", "LYING"]
    stature_mm: float = Field(ge=600, le=2300, allow_inf_nan=False)
    style: Literal["CASUAL", "SMART", "MANNEQUIN"] = "CASUAL"
    seat_height_mm: float = Field(default=450, ge=100, le=3000, allow_inf_nan=False)
    support: PersonSupport | None = None

    @model_validator(mode="after")
    def validate_support(self) -> CataloguePerson:
        if self.posture == "STANDING" and self.support is not None:
            raise ValueError("Standing people cannot be attached to furniture")
        return self


def person_dimensions(stature: float, posture: str, seat_height: float | None = None) -> tuple[float, float, float]:
    if not math.isfinite(stature) or not 600 <= stature <= 2300:
        raise ValueError("Person stature must be between 600 and 2300 mm")
    model = next((p for p in PERSON_MODELS if p["posture"] == posture), None)
    if model is None:
        raise ValueError("Unknown person posture")
    height = stature * model["heightFactor"]
    if posture == "SEATED" and seat_height is not None:
        if not math.isfinite(seat_height) or not 100 <= seat_height <= 3000:
            raise ValueError("Seat height must be between 100 and 3000 mm")
        height = seat_height + 0.52 * stature
    return float(stature * model["widthFactor"]), float(stature * model["depthFactor"]), float(height)


def supports_posture(key: str, posture: str) -> bool:
    return (
        bool(re.match(r"^furniture-bed-", key))
        if posture == "LYING"
        else bool(posture == "SEATED" and re.match(r"^furniture-(chair|armchair|sofa|bed|bench)(-|$)", key))
    )


def intentional_support_contact(person: ObstacleDefinition, host: ObstacleDefinition) -> bool:
    """Verify the declared nominal contact; never use render/CFD vertices for fit."""
    spec = person.person_spec
    if not spec or not spec.support or spec.support.obstacle_id != host.id:
        return False
    support = spec.support
    expected = person_dimensions(spec.stature_mm, spec.posture, spec.seat_height_mm)
    actual = (person.dimensions.width.value, person.dimensions.depth.value, person.dimensions.height.value)
    if any(abs(value - nominal) > 1 for value, nominal in zip(actual, expected, strict=True)):
        return False
    if (
        not supports_posture(host.representation_key, spec.posture)
        or support.surface_height_mm > host.dimensions.height.value
    ):
        return False
    if abs(support.lateral_offset_mm) + 0.1 * spec.stature_mm > 0.45 * host.dimensions.width.value:
        return False
    if spec.posture == "LYING" and person.dimensions.depth.value > 0.92 * host.dimensions.depth.value:
        return False
    angle = math.radians(host.rotation_deg)
    forward = 0.16 * spec.stature_mm if spec.posture == "SEATED" else 0.04 * host.dimensions.depth.value
    x = host.center.x + support.lateral_offset_mm * math.cos(angle) + forward * math.sin(angle)
    y = host.center.y + support.lateral_offset_mm * math.sin(angle) - forward * math.cos(angle)
    contact = host.base_z_mm + support.surface_height_mm
    aligned = (
        math.hypot(person.center.x - x, person.center.y - y) <= 1
        and abs((person.rotation_deg - host.rotation_deg + 180) % 360 - 180) <= 0.01
    )
    return aligned and (
        abs(spec.seat_height_mm - contact) <= 1 and abs(person.base_z_mm) <= 1
        if spec.posture == "SEATED"
        else abs(person.base_z_mm - contact) <= 1
    )
