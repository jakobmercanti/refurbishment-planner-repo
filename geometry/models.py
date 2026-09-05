"""Validated domain models, independent of HTTP, persistence, CAD, and rendering."""

from __future__ import annotations

import math
from datetime import UTC, datetime
from enum import StrEnum
from typing import Any, Literal
from uuid import UUID, uuid4

from pydantic import BaseModel, Field, field_validator, model_validator

from geometry.constants import MAX_REASONABLE_LENGTH_MM


def utc_now() -> datetime:
    return datetime.now(UTC)


def _finite(value: float, field_name: str) -> float:
    if not math.isfinite(value):
        raise ValueError(f"{field_name} must be finite")
    return value


class SourceType(StrEnum):
    USER_MEASURED = "USER_MEASURED"
    MANUFACTURER_DATASHEET = "MANUFACTURER_DATASHEET"
    CAD_FILE = "CAD_FILE"
    ROOM_SCAN = "ROOM_SCAN"
    IMAGE_ESTIMATE = "IMAGE_ESTIMATE"
    AI_EXTRACTED = "AI_EXTRACTED"
    MANUALLY_VERIFIED = "MANUALLY_VERIFIED"


class VerificationStatus(StrEnum):
    VERIFIED = "VERIFIED"
    UNVERIFIED = "UNVERIFIED"
    SUPERSEDED = "SUPERSEDED"


class OpeningKind(StrEnum):
    DOOR = "DOOR"
    WINDOW = "WINDOW"
    GENERIC = "GENERIC"


class ObstacleKind(StrEnum):
    BOX = "BOX"
    CYLINDER = "CYLINDER"


class PersonPosture(StrEnum):
    STANDING = "STANDING"
    SEATED = "SEATED"
    CROUCHING = "CROUCHING"


class HingeSide(StrEnum):
    START = "START"
    END = "END"


class DoorType(StrEnum):
    SINGLE = "SINGLE"
    DOUBLE = "DOUBLE"


class FitStatus(StrEnum):
    FIT = "FIT"
    VERIFY = "VERIFY"
    FAIL = "FAIL"


class CheckStatus(StrEnum):
    PASS = "PASS"
    VERIFY = "VERIFY"
    FAIL = "FAIL"
    NOT_APPLICABLE = "NOT_APPLICABLE"


class Measurement(BaseModel):
    value: float = Field(ge=0.0)
    unit: Literal["mm"] = "mm"
    source_type: SourceType
    source_reference: str | None = None
    verified: bool = False
    uncertainty_mm: float = Field(default=0.0, ge=0.0)
    timestamp: datetime = Field(default_factory=utc_now)

    @field_validator("value", "uncertainty_mm", mode="before")
    @classmethod
    def validate_finite(cls, value: Any, info: Any) -> Any:
        if isinstance(value, (int, float)) and not math.isfinite(value):
            raise ValueError(f"{info.field_name} must be finite")
        return value

    @model_validator(mode="after")
    def validate_measurement(self) -> Measurement:
        if self.value < 0 or self.value > MAX_REASONABLE_LENGTH_MM:
            raise ValueError(f"measurement must be between 0 and {MAX_REASONABLE_LENGTH_MM} mm")
        if self.uncertainty_mm > self.value and self.value > 0:
            raise ValueError("uncertainty cannot exceed a positive measured value")
        if self.source_type is SourceType.AI_EXTRACTED and self.verified:
            raise ValueError("AI-extracted measurements require manual verification first")
        return self

    @property
    def lower_mm(self) -> float:
        return self.value - self.uncertainty_mm

    @property
    def upper_mm(self) -> float:
        return self.value + self.uncertainty_mm


class MeasurementRange(BaseModel):
    minimum_mm: float = Field(ge=0.0)
    maximum_mm: float = Field(ge=0.0)
    source_type: SourceType
    source_reference: str | None = None
    verified: bool = False

    @field_validator("minimum_mm", "maximum_mm")
    @classmethod
    def validate_finite(cls, value: float, info: Any) -> float:
        return _finite(value, info.field_name)

    @model_validator(mode="after")
    def validate_order(self) -> MeasurementRange:
        if self.minimum_mm > self.maximum_mm:
            raise ValueError("minimum_mm cannot exceed maximum_mm")
        if self.maximum_mm > MAX_REASONABLE_LENGTH_MM:
            raise ValueError("measurement range exceeds the supported engineering limit")
        return self


class Point2D(BaseModel):
    x: float
    y: float

    @field_validator("x", "y")
    @classmethod
    def validate_coordinate(cls, value: float, info: Any) -> float:
        value = _finite(value, info.field_name)
        if abs(value) > MAX_REASONABLE_LENGTH_MM:
            raise ValueError("coordinate exceeds the supported engineering limit")
        return value


class Dimensions3D(BaseModel):
    width: Measurement
    depth: Measurement
    height: Measurement

    @model_validator(mode="after")
    def positive_dimensions(self) -> Dimensions3D:
        for name, measurement in (
            ("width", self.width),
            ("depth", self.depth),
            ("height", self.height),
        ):
            if measurement.value <= 0:
                raise ValueError(f"{name} must be greater than zero")
        return self


class GenericOpening(BaseModel):
    id: str
    kind: OpeningKind
    parent_wall_id: str
    offset_mm: float = Field(ge=0.0)
    width: Measurement
    height: Measurement
    sill_height_mm: float = Field(default=0.0, ge=0.0)
    reveal_depth_mm: float = Field(default=0.0, ge=0.0)
    hinge_side: HingeSide | None = None
    door_type: DoorType | None = None
    swing_angle_deg: float | None = Field(default=None, gt=0.0, le=180.0)
    opens_inward: bool | None = None
    metadata: dict[str, Any] = Field(default_factory=dict)

    @field_validator("offset_mm", "sill_height_mm", "reveal_depth_mm")
    @classmethod
    def finite_lengths(cls, value: float, info: Any) -> float:
        return _finite(value, info.field_name)

    @model_validator(mode="after")
    def validate_kind_fields(self) -> GenericOpening:
        if self.kind is OpeningKind.DOOR:
            if self.hinge_side is None or self.swing_angle_deg is None or self.opens_inward is None:
                raise ValueError("doors require hinge_side, swing_angle_deg, and opens_inward")
            if self.door_type is None:
                self.door_type = DoorType.SINGLE
            if self.sill_height_mm != 0:
                raise ValueError("milestone-1 doors must start at finished floor level")
        elif self.door_type is not None:
            raise ValueError("door_type is only valid for door openings")
        return self


class ObstacleDefinition(BaseModel):
    id: str
    name: str
    kind: ObstacleKind = ObstacleKind.BOX
    center: Point2D
    dimensions: Dimensions3D
    base_z_mm: float = Field(default=0.0, ge=0.0)
    rotation_deg: float = 0.0
    source_type: SourceType
    verified: bool = False
    fixture_kind: Literal["SHOWER", "BASIN", "TOILET", "FURNITURE"] | None = None
    model_id: str | None = None
    representation_key: str = ""
    plan_symbol_url: str = ""
    plan_symbol_data_url: str | None = Field(default=None, max_length=1_500_000)
    subcategory: str = "General"
    color_hex: str | None = Field(default=None, pattern=r"^#[0-9A-Fa-f]{6}$")
    wall_lock: bool = False
    stl_filename: str | None = None
    stl_base64: str | None = None
    side_clearance_mm: float | None = Field(default=None, ge=0.0, le=5000.0)
    front_clearance_mm: float | None = Field(default=None, ge=0.0, le=5000.0)

    @field_validator("base_z_mm", "rotation_deg")
    @classmethod
    def finite_values(cls, value: float, info: Any) -> float:
        return _finite(value, info.field_name)


class PersonMockup(BaseModel):
    id: str = "person-001"
    enabled: bool = True
    center: Point2D
    rotation_deg: float = 0.0
    posture: PersonPosture = PersonPosture.STANDING
    height_mm: float = Field(default=1750.0, gt=500.0, le=2500.0)
    shoulder_width_mm: float = Field(default=460.0, gt=200.0, le=1000.0)
    body_depth_mm: float = Field(default=280.0, gt=100.0, le=1000.0)
    eye_height_mm: float = Field(default=1630.0, gt=300.0, le=2400.0)
    movement_clearance_mm: float = Field(default=300.0, ge=0.0, le=2000.0)
    include_in_analysis: bool = True
    show_clearance: bool = True

    @field_validator(
        "rotation_deg",
        "height_mm",
        "shoulder_width_mm",
        "body_depth_mm",
        "eye_height_mm",
        "movement_clearance_mm",
    )
    @classmethod
    def finite_values(cls, value: float, info: Any) -> float:
        return _finite(value, info.field_name)

    @model_validator(mode="after")
    def validate_eye_height(self) -> PersonMockup:
        if self.eye_height_mm > self.height_mm:
            raise ValueError("eye_height_mm cannot exceed person height_mm")
        return self


class RoomDefinition(BaseModel):
    id: UUID = Field(default_factory=uuid4)
    project_id: UUID = Field(default_factory=uuid4)
    name: str
    version: int = Field(default=1, ge=1)
    vertices: list[Point2D]
    wall_height: Measurement
    wall_thickness: Measurement
    wall_thickness_overrides_mm: dict[str, float] = Field(default_factory=dict)
    openings: list[GenericOpening] = Field(default_factory=list)
    obstacles: list[ObstacleDefinition] = Field(default_factory=list)
    person_mockup: PersonMockup | None = None
    finishes: dict[str, Any] = Field(default_factory=dict)
    created_at: datetime = Field(default_factory=utc_now)
    updated_at: datetime = Field(default_factory=utc_now)

    @model_validator(mode="after")
    def validate_basic_polygon(self) -> RoomDefinition:
        if len(self.vertices) < 3:
            raise ValueError("room polygon requires at least three vertices")
        pairs = list(zip(self.vertices, self.vertices[1:] + self.vertices[:1], strict=True))
        for index, (start, end) in enumerate(pairs):
            if start.x == end.x and start.y == end.y:
                raise ValueError(f"duplicate consecutive vertex creates zero-length wall {index + 1}")
        if self.wall_height.value <= 0 or self.wall_thickness.value <= 0:
            raise ValueError("wall height and thickness must be greater than zero")
        valid_wall_ids = {f"wall-{index:03d}" for index in range(1, len(self.vertices) + 1)}
        for wall_id, thickness_mm in self.wall_thickness_overrides_mm.items():
            if wall_id not in valid_wall_ids:
                raise ValueError(f"wall thickness override references unknown wall: {wall_id}")
            if not math.isfinite(thickness_mm) or thickness_mm <= 0:
                raise ValueError(f"wall thickness override for {wall_id} must be finite and greater than zero")
        return self


class ProductDefinition(BaseModel):
    id: UUID = Field(default_factory=uuid4)
    manufacturer: str
    sku: str
    name: str
    category: str
    version: int = Field(default=1, ge=1)
    nominal_dimensions: Dimensions3D
    installation_width_range: MeasurementRange | None = None
    installation_clearance_mm: float = Field(default=0.0, ge=0.0)
    service_clearance_mm: float = Field(default=0.0, ge=0.0)
    operational_swing_radius_mm: float | None = Field(default=None, gt=0.0)
    allowed_rotations_deg: list[float] = Field(default_factory=lambda: [0.0, 90.0, 180.0, 270.0])
    handedness: str | None = None
    source_documents: list[str] = Field(default_factory=list)
    verification_status: VerificationStatus
    notes: str | None = None

    @field_validator("installation_clearance_mm", "service_clearance_mm")
    @classmethod
    def finite_clearances(cls, value: float, info: Any) -> float:
        return _finite(value, info.field_name)

    @field_validator("allowed_rotations_deg")
    @classmethod
    def valid_rotations(cls, values: list[float]) -> list[float]:
        if not values:
            raise ValueError("at least one allowed rotation is required")
        return [_finite(value, "allowed_rotations_deg") % 360.0 for value in values]


class Placement(BaseModel):
    id: UUID = Field(default_factory=uuid4)
    product_id: UUID
    center: Point2D
    base_z_mm: float = Field(default=0.0, ge=0.0)
    rotation_deg: float = 0.0
    available_installation_width: Measurement | None = None

    @field_validator("base_z_mm", "rotation_deg")
    @classmethod
    def finite_values(cls, value: float, info: Any) -> float:
        return _finite(value, info.field_name)


class WallSegment(BaseModel):
    id: str
    start: Point2D
    end: Point2D
    length_mm: float
    height_mm: float
    thickness_mm: float
    interior_normal: Point2D
    exterior_normal: Point2D


class FitCheck(BaseModel):
    check_id: str
    status: CheckStatus
    critical: bool = True
    measured_value: str | float | None = None
    required_value: str | float | None = None
    margin_mm: float | None = None
    uncertainty_mm: float = 0.0
    explanation: str
    geometry_reference: list[str] = Field(default_factory=list)


class Collision(BaseModel):
    object_id: str
    collision_type: str
    overlap_area_mm2: float
    estimated_penetration_mm: float | None = None


class FitResult(BaseModel):
    status: FitStatus
    summary: str
    checks: list[FitCheck]
    minimum_clearance_mm: float | None
    collisions: list[Collision]
    manual_measurements_required: list[str]
    engine_version: str
    room_id: UUID
    room_version: int
    product_id: UUID
    product_version: int
    placement: Placement
    analysed_at: datetime = Field(default_factory=utc_now)


class LayoutResult(BaseModel):
    status: FitStatus
    summary: str
    checks: list[FitCheck]
    collision_ids: list[str]
    engine_version: str
    room_id: UUID
    room_version: int
    analysed_at: datetime = Field(default_factory=utc_now)


class FixtureBundle(BaseModel):
    room: RoomDefinition
    product: ProductDefinition
    placements: dict[str, Placement]
