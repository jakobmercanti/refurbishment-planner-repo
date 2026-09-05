"""Minimal versioned SQLAlchemy records for milestone-1 persistence."""

from __future__ import annotations

from datetime import UTC, datetime
from uuid import uuid4

from sqlalchemy import JSON, Boolean, DateTime, Float, ForeignKey, Index, Integer, String, Text, UniqueConstraint
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, relationship


def utc_now() -> datetime:
    return datetime.now(UTC)


class Base(DeclarativeBase):
    pass


class ProjectRecord(Base):
    __tablename__ = "projects"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid4()))
    name: Mapped[str] = mapped_column(String(200))
    organisation_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now, onupdate=utc_now)
    rooms: Mapped[list[RoomVersionRecord]] = relationship(back_populates="project")


class RoomVersionRecord(Base):
    __tablename__ = "room_versions"
    __table_args__ = (UniqueConstraint("room_id", "version", name="uq_room_version"),)

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid4()))
    room_id: Mapped[str] = mapped_column(String(36), index=True)
    project_id: Mapped[str] = mapped_column(ForeignKey("projects.id"), index=True)
    version: Mapped[int] = mapped_column(Integer)
    engineering_snapshot: Mapped[dict[str, object]] = mapped_column(JSON)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)
    project: Mapped[ProjectRecord] = relationship(back_populates="rooms")


class ProductVersionRecord(Base):
    __tablename__ = "product_versions"
    __table_args__ = (UniqueConstraint("product_id", "version", name="uq_product_version"),)

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid4()))
    product_id: Mapped[str] = mapped_column(String(36), index=True)
    version: Mapped[int] = mapped_column(Integer)
    manufacturer: Mapped[str] = mapped_column(String(200))
    sku: Mapped[str] = mapped_column(String(120), index=True)
    engineering_snapshot: Mapped[dict[str, object]] = mapped_column(JSON)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)


class FitAnalysisRecord(Base):
    __tablename__ = "fit_analyses"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid4()))
    room_id: Mapped[str] = mapped_column(String(36), index=True)
    room_version: Mapped[int] = mapped_column(Integer)
    product_id: Mapped[str] = mapped_column(String(36), index=True)
    product_version: Mapped[int] = mapped_column(Integer)
    engine_version: Mapped[str] = mapped_column(String(40))
    status: Mapped[str] = mapped_column(String(12), index=True)
    input_snapshot: Mapped[dict[str, object]] = mapped_column(JSON)
    result_snapshot: Mapped[dict[str, object]] = mapped_column(JSON)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)


class ArtifactRecord(Base):
    __tablename__ = "artifacts"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid4()))
    fit_analysis_id: Mapped[str] = mapped_column(ForeignKey("fit_analyses.id"), index=True)
    artifact_type: Mapped[str] = mapped_column(String(30))
    location: Mapped[str] = mapped_column(Text)
    evidence_label: Mapped[str] = mapped_column(String(100), default="visualisation, not dimensional evidence")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)


class FurnitureCategoryRecord(Base):
    __tablename__ = "furniture_categories"

    id: Mapped[str] = mapped_column(String(50), primary_key=True)
    name: Mapped[str] = mapped_column(String(120), unique=True)
    description: Mapped[str] = mapped_column(Text, default="")
    sort_order: Mapped[int] = mapped_column(Integer, default=0)
    default_side_clearance_mm: Mapped[float] = mapped_column(Float, default=0.0)
    default_front_clearance_mm: Mapped[float] = mapped_column(Float, default=0.0)
    items: Mapped[list[FurnitureItemRecord]] = relationship(back_populates="category")


class FurnitureItemRecord(Base):
    __tablename__ = "furniture_items"
    __table_args__ = (
        UniqueConstraint("supplier", "sku", name="uq_furniture_supplier_sku"),
        Index("idx_furniture_category_active", "category_id", "active"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid4()))
    category_id: Mapped[str] = mapped_column(ForeignKey("furniture_categories.id"))
    fixture_kind: Mapped[str] = mapped_column(String(20))
    name: Mapped[str] = mapped_column(String(200))
    supplier: Mapped[str] = mapped_column(String(200))
    sku: Mapped[str] = mapped_column(String(120))
    width_mm: Mapped[float] = mapped_column(Float)
    depth_mm: Mapped[float] = mapped_column(Float)
    height_mm: Mapped[float] = mapped_column(Float)
    color_hex: Mapped[str] = mapped_column(String(7), default="#b99b77")
    description: Mapped[str] = mapped_column(Text, default="")
    is_default: Mapped[bool] = mapped_column(Boolean, default=False)
    default_key: Mapped[str | None] = mapped_column(String(120), nullable=True, unique=True)
    stl_filename: Mapped[str | None] = mapped_column(String(255), nullable=True)
    stl_base64: Mapped[str | None] = mapped_column(Text, nullable=True)
    supplier_editable: Mapped[bool] = mapped_column(Boolean, default=True)
    side_clearance_mm: Mapped[float | None] = mapped_column(Float, nullable=True)
    front_clearance_mm: Mapped[float | None] = mapped_column(Float, nullable=True)
    subcategory: Mapped[str] = mapped_column(String(120), default="General")
    representation_key: Mapped[str] = mapped_column(String(80), default="")
    plan_symbol_url: Mapped[str] = mapped_column(String(255), default="")
    plan_symbol_data_url: Mapped[str | None] = mapped_column(Text, nullable=True)
    plan_shape: Mapped[str] = mapped_column(String(12), default="RECTANGLE")
    image_data_json: Mapped[str] = mapped_column(Text, default="[]")
    active: Mapped[bool] = mapped_column(Boolean, default=True, index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now, onupdate=utc_now)
    category: Mapped[FurnitureCategoryRecord] = relationship(back_populates="items")


class MaterialCollectionRecord(Base):
    __tablename__ = "material_collections"

    id: Mapped[str] = mapped_column(String(80), primary_key=True)
    kind: Mapped[str] = mapped_column(String(12), index=True)
    name: Mapped[str] = mapped_column(String(120))
    source_url: Mapped[str | None] = mapped_column(Text, nullable=True)
    sort_order: Mapped[int] = mapped_column(Integer, default=0)


class MaterialFamilyRecord(Base):
    __tablename__ = "material_families"

    id: Mapped[str] = mapped_column(String(160), primary_key=True)
    collection_id: Mapped[str] = mapped_column(ForeignKey("material_collections.id"), index=True)
    name: Mapped[str] = mapped_column(String(120))
    sort_order: Mapped[int] = mapped_column(Integer, default=0)


class MaterialItemRecord(Base):
    __tablename__ = "material_items"
    __table_args__ = (Index("idx_material_items_family", "family_id", "name"),)

    id: Mapped[str] = mapped_column(String(200), primary_key=True)
    family_id: Mapped[str] = mapped_column(ForeignKey("material_families.id"), index=True)
    name: Mapped[str] = mapped_column(String(200))
    code: Mapped[str | None] = mapped_column(String(120), nullable=True)
    color_hex: Mapped[str] = mapped_column(String(7))
    metadata_json: Mapped[dict[str, object]] = mapped_column(JSON, default=dict)
