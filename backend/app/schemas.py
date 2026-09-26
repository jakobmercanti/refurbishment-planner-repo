from __future__ import annotations

import base64
import binascii
from datetime import datetime
import re
from xml.etree import ElementTree
from pathlib import Path
from typing import Literal
from uuid import UUID, uuid4

from pydantic import BaseModel, Field, field_validator

from geometry.models import FitResult, Placement, Point2D, ProductDefinition, RoomDefinition


_PLAN_SVG_PREFIX = "data:image/svg+xml;base64,"
_PLAN_SVG_TAGS = {"svg", "g", "rect", "circle", "path", "text"}
_PLAN_SVG_ATTRIBUTES = {
    "viewBox", "fill", "stroke", "stroke-width", "stroke-linecap", "stroke-linejoin", "stroke-dasharray",
    "cx", "cy", "r", "x", "y", "d", "width", "height", "rx", "ry", "text-anchor",
    "font-family", "font-size",
}
_PLAN_SVG_COLOUR = re.compile(r"^(?:none|#[0-9a-fA-F]{3,8}|black|white)$")
_PLAN_SVG_NUMBERS = re.compile(r"^[\d.\s,+-]+$")
_PLAN_SVG_PATH = re.compile(r"^[MmLlHhVvCcSsQqTtAaZzEe\d.\s,+-]+$")


def validate_svg_plan_symbol(data_url: str) -> None:
    """Accept only a small, inert SVG subset for inline floorplan symbols."""
    if not data_url.startswith(_PLAN_SVG_PREFIX):
        raise ValueError("plan symbol must be a supported image data URL")
    try:
        encoded = data_url[len(_PLAN_SVG_PREFIX):]
        source = base64.b64decode(encoded, validate=True)
    except (binascii.Error, ValueError) as error:
        raise ValueError("plan symbol SVG must contain valid base64 data") from error
    if not source or len(source) > 500_000:
        raise ValueError("plan symbol SVG must be 500 KB or smaller")
    if re.search(rb"<!\s*(?:DOCTYPE|ENTITY)", source, re.IGNORECASE):
        raise ValueError("plan symbol SVG cannot contain document types or entities")
    try:
        root = ElementTree.fromstring(source)
    except ElementTree.ParseError as error:
        raise ValueError("plan symbol SVG is malformed") from error
    namespace, separator, root_name = root.tag.rpartition("}")
    if (separator and namespace.lstrip("{") != "http://www.w3.org/2000/svg") or (root_name if separator else root.tag) != "svg":
        raise ValueError("plan symbol must have an SVG root element")
    view_box = root.attrib.get("viewBox", "")
    if not re.fullmatch(r"[\d.\s,+-]+", view_box) or len(view_box.replace(",", " ").split()) != 4:
        raise ValueError("plan symbol SVG must define a numeric viewBox")
    for element in root.iter():
        namespace, separator, name = element.tag.rpartition("}")
        if (separator and namespace.lstrip("{") != "http://www.w3.org/2000/svg") or (name if separator else element.tag) not in _PLAN_SVG_TAGS:
            raise ValueError("plan symbol SVG contains an unsupported element")
        for attribute, value in element.attrib.items():
            if attribute not in _PLAN_SVG_ATTRIBUTES:
                raise ValueError("plan symbol SVG contains an unsupported attribute")
            if attribute in {"fill", "stroke"} and not _PLAN_SVG_COLOUR.fullmatch(value):
                raise ValueError("plan symbol SVG contains an unsupported colour")
            if attribute == "d" and not _PLAN_SVG_PATH.fullmatch(value):
                raise ValueError("plan symbol SVG contains an unsupported path")
            if attribute == "viewBox" or attribute in {"stroke-width", "stroke-dasharray", "cx", "cy", "r", "x", "y", "width", "height", "rx", "ry", "font-size"}:
                if not _PLAN_SVG_NUMBERS.fullmatch(value):
                    raise ValueError("plan symbol SVG contains an invalid numeric value")
            if attribute == "stroke-linecap" and value not in {"butt", "round", "square"}:
                raise ValueError("plan symbol SVG contains an unsupported line cap")
            if attribute == "stroke-linejoin" and value not in {"miter", "round", "bevel"}:
                raise ValueError("plan symbol SVG contains an unsupported line join")
            if attribute == "text-anchor" and value not in {"start", "middle", "end"}:
                raise ValueError("plan symbol SVG contains an unsupported text anchor")
            if attribute == "font-family" and value not in {"sans-serif", "serif", "monospace"}:
                raise ValueError("plan symbol SVG contains an unsupported font family")


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


class SoftwareToolbarSettings(BaseModel):
    layout_analysis: bool = True
    human_mockup: bool = False


class SoftwareToolbarSettingsUpdate(BaseModel):
    layout_analysis: bool | None = None
    human_mockup: bool | None = None


class SoftwareSettingsResponse(BaseModel):
    schema_version: Literal[1] = 1
    toolbars: SoftwareToolbarSettings
    ui: dict


class SoftwareUiUpdate(BaseModel):
    style: Literal["DEFAULT", "MODERN"]


class SoftwareSettingsUpdate(BaseModel):
    toolbars: SoftwareToolbarSettingsUpdate = Field(default_factory=SoftwareToolbarSettingsUpdate)
    ui: SoftwareUiUpdate | None = None


class CatalogueCategoryResponse(BaseModel):
    id: str
    name: str
    description: str
    item_count: int
    default_side_clearance_mm: float
    default_front_clearance_mm: float


class CatalogueCategoryUpdate(BaseModel):
    default_side_clearance_mm: float = Field(ge=0, le=5000)
    default_front_clearance_mm: float = Field(ge=0, le=5000)


class CatalogueImage(BaseModel):
    data_url: str | None = Field(default=None, max_length=700_000)
    url: str | None = Field(default=None, max_length=500)
    filename: str | None = Field(default=None, max_length=255)
    content_type: Literal["image/jpeg", "image/png", "image/webp"] | None = None
    size_bytes: int | None = Field(default=None, ge=0, le=500_000)
    alt: str = Field(min_length=1, max_length=200)

    @field_validator("data_url")
    @classmethod
    def validate_data_url(cls, value: str | None) -> str | None:
        if value is None:
            return None
        if not value.startswith(("data:image/jpeg;base64,", "data:image/png;base64,", "data:image/webp;base64,")):
            raise ValueError("picture must be a JPEG, PNG or WebP data URL")
        return value


class CatalogueItemInput(BaseModel):
    category_id: str = Field(min_length=1, max_length=50)
    fixture_kind: Literal["SHOWER", "BASIN", "TOILET", "FURNITURE", "DOOR", "WINDOW"]
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
    subcategory: str = Field(default="General", min_length=1, max_length=120)
    plan_shape: Literal["RECTANGLE", "ELLIPSE"] = "RECTANGLE"
    representation_key: str = Field(default="", max_length=80)
    representation_version: int = Field(default=1, ge=1, le=1000)
    plan_symbol_url: str = Field(default="", max_length=255, pattern=r"^(|/fixture-symbols/[a-z0-9-]+\.svg)$")
    plan_symbol_data_url: str | None = Field(default=None, max_length=700_000)

    @field_validator("plan_symbol_data_url")
    @classmethod
    def validate_plan_picture(cls, value: str | None) -> str | None:
        if value:
            if value.startswith(_PLAN_SVG_PREFIX):
                validate_svg_plan_symbol(value)
            else:
                CatalogueImage(data_url=value, alt="Floorplan symbol")
        return value

    images: list[CatalogueImage] = Field(default_factory=list, max_length=3)

    @field_validator("color_hex")
    @classmethod
    def normalize_hex(cls, value: str) -> str:
        return value.upper()


class ColourPartResponse(BaseModel):
    id: str
    label: str
    default_color_hex: str = Field(pattern=r"^#[0-9A-Fa-f]{6}$")
    legacy_field: str | None = None
    material_type: str | None = None
    default_fabric_id: str | None = None


class CatalogueItemResponse(CatalogueItemInput):
    colour_parts: list[ColourPartResponse] = Field(default_factory=list)
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


class CatalogueWebsiteImport(BaseModel):
    source_url: str = Field(min_length=8, max_length=2000)
    page: str = Field(default="", max_length=500)
    category_id: str = Field(min_length=1, max_length=50)
    subcategory: str = Field(min_length=1, max_length=120)
    fixture_kind: Literal["SHOWER", "BASIN", "TOILET", "FURNITURE", "DOOR", "WINDOW"]
    supplier: str = Field(min_length=1, max_length=200)
    fallback_name: str = Field(min_length=1, max_length=200)
    fallback_sku: str = Field(min_length=1, max_length=120)
    width_mm: float = Field(gt=0, le=20_000)
    depth_mm: float = Field(gt=0, le=20_000)
    height_mm: float = Field(gt=0, le=20_000)
    color_hex: str = Field(default="#B99B77", pattern=r"^#[0-9A-Fa-f]{6}$")
    plan_shape: Literal["RECTANGLE", "ELLIPSE"] = "RECTANGLE"

    @field_validator("color_hex")
    @classmethod
    def normalize_hex(cls, value: str) -> str:
        return value.upper()


class CatalogueWebsiteImportResponse(BaseModel):
    imported: list[CatalogueItemResponse]
    skipped: list[str]


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
