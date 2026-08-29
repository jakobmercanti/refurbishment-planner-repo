"""Persistent SQLite catalogue for bathroom fixtures and furniture."""

from __future__ import annotations

import os
from collections.abc import Iterator
from pathlib import Path

from sqlalchemy import create_engine, event, select
from sqlalchemy.engine import Engine
from sqlalchemy.orm import Session, sessionmaker

from database.models import Base, FurnitureCategoryRecord, FurnitureItemRecord


def database_path() -> Path:
    configured = os.environ.get("RENOVATION_FIT_DATABASE")
    project_root = Path(__file__).resolve().parents[1]
    path = Path(configured) if configured else project_root / "data" / "renovation_fit.sqlite3"
    path.parent.mkdir(parents=True, exist_ok=True)
    return path.resolve()


ENGINE = create_engine(
    f"sqlite:///{database_path().as_posix()}",
    connect_args={"check_same_thread": False},
)
SessionLocal = sessionmaker(bind=ENGINE, expire_on_commit=False)


@event.listens_for(Engine, "connect")
def configure_sqlite(connection: object, _record: object) -> None:
    cursor = connection.cursor()  # type: ignore[attr-defined]
    cursor.execute("PRAGMA foreign_keys=ON")
    cursor.execute("PRAGMA journal_mode=WAL")
    cursor.close()


CATEGORIES = [
    ("showers", "Shower enclosures", "Corner, walk-in and framed shower enclosures.", 10),
    ("basins", "Basins & vanities", "Wall-mounted basins, vanity units and washstands.", 20),
    ("toilets", "Toilets", "Wall-hung, compact and close-coupled toilets.", 30),
    ("storage", "Storage & furniture", "Cabinets, benches and freestanding bathroom furniture.", 40),
]

SEED_ITEMS = [
    ("showers", "SHOWER", "Corner enclosure 800 × 800", "Renovation Fit", "RF-SH-800", 800, 800, 1950, "#b9e1e8"),
    ("showers", "SHOWER", "Corner enclosure 900 × 900", "Renovation Fit", "RF-SH-900", 900, 900, 2000, "#a8d5df"),
    ("showers", "SHOWER", "Walk-in enclosure 1200 × 800", "Renovation Fit", "RF-SH-1200", 1200, 800, 2000, "#c6e7ec"),
    ("basins", "BASIN", "Compact basin 450 × 350", "Renovation Fit", "RF-BA-450", 450, 350, 850, "#f1f0eb"),
    ("basins", "BASIN", "Vanity basin 600 × 500", "Renovation Fit", "RF-VA-600", 600, 500, 850, "#9d8067"),
    ("basins", "BASIN", "Double vanity 1200 × 500", "Renovation Fit", "RF-VA-1200", 1200, 500, 850, "#7f6653"),
    ("toilets", "TOILET", "Wall-hung toilet 360 × 540", "Renovation Fit", "RF-WC-360", 360, 540, 400, "#f7f7f3"),
    ("toilets", "TOILET", "Compact toilet 365 × 600", "Renovation Fit", "RF-WC-365", 365, 600, 780, "#e9ece9"),
    ("toilets", "TOILET", "Close-coupled toilet 380 × 650", "Renovation Fit", "RF-WC-380", 380, 650, 800, "#f4f2e9"),
    ("storage", "FURNITURE", "Base cabinet 600 × 450", "Renovation Fit", "RF-FU-600", 600, 450, 850, "#b99b77"),
    ("storage", "FURNITURE", "Tall storage unit 400 × 350", "Renovation Fit", "RF-FU-400", 400, 350, 1800, "#7d927e"),
    ("storage", "FURNITURE", "Bathroom bench 800 × 350", "Renovation Fit", "RF-BE-800", 800, 350, 450, "#a88762"),
]


def initialise_catalogue() -> None:
    Base.metadata.create_all(ENGINE)
    with ENGINE.begin() as connection:
        existing_columns = {
            row[1] for row in connection.exec_driver_sql("PRAGMA table_info(furniture_items)").fetchall()
        }
        if "is_default" not in existing_columns:
            connection.exec_driver_sql("ALTER TABLE furniture_items ADD COLUMN is_default BOOLEAN NOT NULL DEFAULT 0")
        if "default_key" not in existing_columns:
            connection.exec_driver_sql("ALTER TABLE furniture_items ADD COLUMN default_key VARCHAR(120)")
            connection.exec_driver_sql("CREATE UNIQUE INDEX IF NOT EXISTS uq_furniture_items_default_key ON furniture_items (default_key)")
        if "stl_filename" not in existing_columns:
            connection.exec_driver_sql("ALTER TABLE furniture_items ADD COLUMN stl_filename VARCHAR(255)")
        if "stl_base64" not in existing_columns:
            connection.exec_driver_sql("ALTER TABLE furniture_items ADD COLUMN stl_base64 TEXT")
        for obsolete_index in (
            "ix_furniture_items_category_id",
            "ix_furniture_items_fixture_kind",
            "ix_furniture_items_name",
            "ix_furniture_items_supplier",
            "ix_furniture_items_sku",
        ):
            connection.exec_driver_sql(f"DROP INDEX IF EXISTS {obsolete_index}")
    with SessionLocal() as session:
        if session.scalar(select(FurnitureCategoryRecord.id).limit(1)) is None:
            session.add_all(
                FurnitureCategoryRecord(id=item[0], name=item[1], description=item[2], sort_order=item[3])
                for item in CATEGORIES
            )
            session.flush()
        for item in SEED_ITEMS:
            default_key = item[4]
            existing = session.scalar(
                select(FurnitureItemRecord).where(FurnitureItemRecord.default_key == default_key)
            )
            if existing is None:
                existing = session.scalar(
                    select(FurnitureItemRecord).where(
                        FurnitureItemRecord.supplier == item[3],
                        FurnitureItemRecord.sku == item[4],
                    )
                )
            if existing is None:
                session.add(FurnitureItemRecord(
                    category_id=item[0], fixture_kind=item[1], name=item[2], supplier=item[3], sku=item[4],
                    width_mm=item[5], depth_mm=item[6], height_mm=item[7], color_hex=item[8],
                    description="Built-in bathroom catalogue object. Dimensions and appearance can be modified.",
                    is_default=True, default_key=default_key, supplier_editable=True,
                ))
            else:
                existing.is_default = True
                existing.default_key = default_key
                existing.active = True
                existing.supplier_editable = True
        session.commit()
        session.execute(select(FurnitureItemRecord.id).limit(1)).all()
        session.connection().exec_driver_sql("PRAGMA optimize")


def catalogue_session() -> Iterator[Session]:
    with SessionLocal() as session:
        yield session
