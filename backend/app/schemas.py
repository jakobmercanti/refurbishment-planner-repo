from __future__ import annotations

from datetime import datetime
from pathlib import Path
from uuid import UUID, uuid4

from pydantic import BaseModel, Field

from geometry.models import FitResult, Placement, Point2D, ProductDefinition, RoomDefinition


class ProjectCreate(BaseModel):
    name: str = Field(min_length=1, max_length=200)


class ProjectResponse(BaseModel):
    id: UUID = Field(default_factory=uuid4)
    name: str
    created_at: datetime


class PolygonUpdate(BaseModel):
    vertices: list[Point2D] = Field(min_length=3)


class WallSummary(BaseModel):
    id: str
    start: Point2D
    end: Point2D
    length_mm: float


class GeometryInvalidation(BaseModel):
    entity_id: str
    entity_type: str
    reason: str


class RoomValidationResponse(BaseModel):
    valid: bool = True
    area_mm2: float
    perimeter_mm: float
    orientation: str = "CCW"
    walls: list[WallSummary]
    invalidations: list[GeometryInvalidation]
    warnings: list[str]


class FitRequest(BaseModel):
    room: RoomDefinition
    product: ProductDefinition
    placement: Placement


class DemoResponse(BaseModel):
    room: RoomDefinition
    product: ProductDefinition
    placements: dict[str, Placement]
    results: dict[str, FitResult]


class CADResponse(BaseModel):
    artifact_id: UUID
    path: Path
    evidence_label: str = "visualisation, not dimensional evidence"
