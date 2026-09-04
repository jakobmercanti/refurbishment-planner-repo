from __future__ import annotations

from datetime import datetime
from pathlib import Path
from typing import Literal
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


class DetectedProjectRoom(BaseModel):
    id: str
    name: str
    vertices: list[Point2D] = Field(min_length=3)
    area_px2: float
    confidence: float = Field(ge=0, le=1)


class ProjectFloorplanResponse(BaseModel):
    source_width_px: int
    source_height_px: int
    rooms: list[DetectedProjectRoom]
    warning: str


class CatalogueCategoryResponse(BaseModel):
    id: str
    name: str
    description: str
    item_count: int
    default_side_clearance_mm: float
    default_front_clearance_mm: float


class CatalogueItemInput(BaseModel):
    category_id: str = Field(min_length=1, max_length=50)
    fixture_kind: Literal["SHOWER", "BASIN", "TOILET", "FURNITURE"]
    name: str = Field(min_length=1, max_length=200)
    supplier: str = Field(min_length=1, max_length=200)
    sku: str = Field(min_length=1, max_length=120)
    width_mm: float = Field(gt=0, le=20_000)
    depth_mm: float = Field(gt=0, le=20_000)
    height_mm: float = Field(gt=0, le=20_000)
    color_hex: str = Field(pattern=r"^#[0-9A-Fa-f]{6}$")
    description: str = Field(default="", max_length=2000)
    stl_filename: str | None = Field(default=None, max_length=255)
    stl_base64: str | None = Field(default=None, max_length=30_000_000)
    side_clearance_mm: float | None = Field(default=None, ge=0, le=5000)
    front_clearance_mm: float | None = Field(default=None, ge=0, le=5000)


class CatalogueItemResponse(CatalogueItemInput):
    id: str
    category_name: str
    is_default: bool
    supplier_editable: bool
    active: bool
    created_at: datetime
    updated_at: datetime


class MaterialItemResponse(BaseModel):
    id: str
    name: str
    code: str | None
    color_hex: str
    metadata: dict[str, object]


class MaterialFamilyResponse(BaseModel):
    id: str
    name: str
    items: list[MaterialItemResponse]


class MaterialCollectionResponse(BaseModel):
    id: str
    kind: str
    name: str
    source_url: str | None
    families: list[MaterialFamilyResponse]
