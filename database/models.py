"""Minimal versioned SQLAlchemy records for milestone-1 persistence."""

from __future__ import annotations

from datetime import UTC, datetime
from uuid import uuid4

from sqlalchemy import JSON, DateTime, ForeignKey, Integer, String, Text, UniqueConstraint
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
