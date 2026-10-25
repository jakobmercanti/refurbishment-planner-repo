"""Shared validation for the default roof and optional, non-recursive room profiles."""

from typing import Any, Literal, Self

from pydantic import BaseModel, ConfigDict, Field, model_validator


class RoofFinish(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True, allow_inf_nan=False)
    material: Literal[
        "CLAY_TILES",
        "CONCRETE_TILES",
        "SLATE",
        "CEMENT",
        "METAL",
        "ASPHALT_SHINGLES",
        "TIMBER_SHINGLES",
        "BITUMEN",
        "CORRUGATED_METAL",
    ]
    colour: str = Field(pattern=r"^#[0-9a-fA-F]{6}$")
    tileWidthMm: float = Field(ge=100, le=2000)
    tileHeightMm: float = Field(ge=100, le=4000)


class RoofProfile(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True, allow_inf_nan=False)
    enabled: bool = True
    finish: RoofFinish | None = None
    type: Literal["FLAT", "MONO", "GABLE", "STEPPED"]
    lowHeightMm: float = Field(ge=1800, le=20000)
    highHeightMm: float = Field(ge=1800, le=20000)
    orientationDeg: float = Field(ge=0, le=360)
    splitFraction: float = Field(ge=0.05, le=0.95)
    thicknessMm: float = Field(ge=20, le=1000)
    ceilingMode: Literal["FOLLOWS_ROOF", "FLAT"]
    ceilingHeightMm: float = Field(ge=1800, le=20000)

    @model_validator(mode="after")
    def validate_heights(self) -> Self:
        if self.type in ("MONO", "GABLE") and self.highHeightMm < self.lowHeightMm + 50:
            raise ValueError("Ridge/high side must rise at least 50 mm.")
        if self.type == "STEPPED" and abs(self.highHeightMm - self.lowHeightMm) < 50:
            raise ValueError("Stepped zones must differ by at least 50 mm.")
        lowest = min(self.lowHeightMm, self.highHeightMm) if self.type == "STEPPED" else self.lowHeightMm
        if self.ceilingMode == "FLAT" and self.ceilingHeightMm > lowest:
            raise ValueError("Flat ceiling must not pass above the roof underside.")
        return self


class RoomRoof(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)
    roomId: str = Field(pattern=r"^[\w:-]{1,150}$")
    roof: RoofProfile


class RoofDocument(RoofProfile):
    roomRoofsEnabled: bool = False
    roomOverrides: list[RoomRoof] = Field(default_factory=list, max_length=500)


def validate_roof_document(value: Any, room_ids: set[str]) -> RoofDocument:
    if isinstance(value, dict) and "finish" in value and value["finish"] is None:
        raise ValueError("Roof finish cannot be null.")
    roof = RoofDocument.model_validate(value)
    ids = [item.roomId for item in roof.roomOverrides]
    if len(set(ids)) != len(ids) or set(ids) - room_ids:
        raise ValueError("Room roof definitions must reference distinct existing rooms.")
    if any(not item.roof.enabled for item in roof.roomOverrides):
        raise ValueError("Room roofs must be enabled; remove an override to use the shared roof.")
    if isinstance(value, dict) and any(
        "finish" in item["roof"] and item["roof"]["finish"] is None for item in value.get("roomOverrides", [])
    ):
        raise ValueError("Room roof finish cannot be null.")
    return roof
