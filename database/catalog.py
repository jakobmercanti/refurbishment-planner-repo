"""Persistent SQLite catalogue for bathroom fixtures and furniture."""

from __future__ import annotations

import os
import json
import re
from collections.abc import Iterator
from pathlib import Path

from sqlalchemy import create_engine, event, select
from sqlalchemy.engine import Engine
from sqlalchemy.orm import Session, sessionmaker

from database.models import Base, FurnitureCategoryRecord, FurnitureItemRecord, MaterialCollectionRecord, MaterialFamilyRecord, MaterialItemRecord
from database.catalogue_assets import migrate_legacy_pictures
from database.fixture_defaults import LEGACY_DEFAULT_KEYS, seed_fixture_defaults


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
    ("showers", "Shower enclosures", "Corner, walk-in and framed shower enclosures.", 10, 0.0, 500.0),
    ("basins", "Basins & vanities", "Wall-mounted basins, vanity units and washstands.", 20, 0.0, 0.0),
    ("toilets", "Toilets", "Wall-hung, compact and close-coupled toilets.", 30, 200.0, 400.0),
    ("storage", "Storage & furniture", "Cabinets, benches and freestanding bathroom furniture.", 40, 0.0, 0.0),
    ("doors", "Doors", "Single and double doors for the floorplan.", 50, 0.0, 0.0),
    ("windows", "Windows", "Single-, double- and triple-pane windows for the floorplan.", 60, 0.0, 0.0),
]

def _material_sources() -> tuple[list[tuple[str, str, str, str, int]], list[tuple[str, str, str, int]], list[tuple[str, str, str, str, dict[str, object]]]]:
    root = Path(__file__).resolve().parents[1]
    collections = [
        ("paints-default", "PAINT", "Default colours", "https://www.ralcolorchart.com/", 10),
        ("paints-dulux", "PAINT", "Dulux paints", "https://www.dulux.co.uk/en/colour-details/filters", 20),
        ("tiles-default", "TILE", "Default colours", None, 10),
    ]
    families: list[tuple[str, str, str, int]] = []
    items: list[tuple[str, str, str, str, dict[str, object]]] = []
    ral_path = root / "frontend" / "node_modules" / "ral-colors" / "RAL" / "classic.js"
    pattern = re.compile(r"RAL(\d{4}):\s*\{\s*description:\s*'([^']+)'[^}]*HEX:\s*'?(#[0-9A-Fa-f]{6})'?")
    for index, match in enumerate(pattern.finditer(ral_path.read_text(encoding="utf8"))):
        family_id = f"ral-{match.group(1)[0]}xxx"
        if not any(item[0] == family_id for item in families):
            families.append((family_id, "paints-default", f"RAL {match.group(1)[0]}000 range", len(families)))
        code = f"RAL {match.group(1)}"
        items.append((f"ral-{match.group(1)}", family_id, f"{code} · {match.group(2)}", match.group(3).upper(), {"code": code, "description": match.group(2), "source": "RAL Classic"}))
    dulux = json.loads((root / "frontend" / "lib" / "duluxColours.generated.json").read_text(encoding="utf8"))
    for index, family in enumerate(dulux["families"]):
        family_id = f"dulux-{family['id'].lower()}"
        families.append((family_id, "paints-dulux", family["name"], index))
        for shade in family["shades"]:
            items.append((f"dulux-{family['id'].lower()}-{shade['id']}", family_id, shade["name"], shade["colour"], {"code": shade["name"], "ral_code": shade["ralCode"], "ral_name": shade["ralName"]}))
    families.append(("tiles-default", "tiles-default", "Default tiles", 0))
    for name, colour in (("Warm ivory", "#E8E1D6"), ("Soft grey", "#AAA69E"), ("Sage", "#879783"), ("Terracotta", "#B76E52")):
        items.append((f"tile-default-{name.lower().replace(' ', '-')}", "tiles-default", name, colour, {"code": name}))
    return collections, families, items


def _seed_materials(session: Session) -> None:
    collections, families, items = _material_sources()
    for row in collections:
        record = session.get(MaterialCollectionRecord, row[0])
        if record is None:
            session.add(MaterialCollectionRecord(id=row[0], kind=row[1], name=row[2], source_url=row[3], sort_order=row[4]))
        else:
            record.kind, record.name, record.source_url, record.sort_order = row[1:]
    session.flush()
    for row in families:
        record = session.get(MaterialFamilyRecord, row[0])
        if record is None:
            session.add(MaterialFamilyRecord(id=row[0], collection_id=row[1], name=row[2], sort_order=row[3]))
        else:
            record.collection_id, record.name, record.sort_order = row[1:]
    session.flush()
    for row in items:
        record = session.get(MaterialItemRecord, row[0])
        if record is None:
            session.add(MaterialItemRecord(id=row[0], family_id=row[1], name=row[2], code=row[4].get("code"), color_hex=row[3], metadata_json=row[4]))
        else:
            record.family_id, record.name, record.code, record.color_hex, record.metadata_json = row[1], row[2], row[4].get("code"), row[3], row[4]


def _backfill_new_clearance_columns(session: Session, *, side_added: bool, front_added: bool) -> None:
    if not side_added and not front_added:
        return
    for category_id, _name, _description, _sort, side, front in CATEGORIES:
        category = session.get(FurnitureCategoryRecord, category_id)
        if category is not None:
            if side_added:
                category.default_side_clearance_mm = side
            if front_added:
                category.default_front_clearance_mm = front


def _archive_obsolete_default_items(session: Session) -> None:
    for item in session.scalars(
        select(FurnitureItemRecord).where(FurnitureItemRecord.default_key.in_(LEGACY_DEFAULT_KEYS))
    ).all():
        item.active = False
        item.is_default = False


def initialise_catalogue() -> None:
    Base.metadata.create_all(ENGINE)
    added_side_clearance = False
    added_front_clearance = False
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
        if "side_clearance_mm" not in existing_columns:
            connection.exec_driver_sql("ALTER TABLE furniture_items ADD COLUMN side_clearance_mm FLOAT")
        if "front_clearance_mm" not in existing_columns:
            connection.exec_driver_sql("ALTER TABLE furniture_items ADD COLUMN front_clearance_mm FLOAT")
        if "subcategory" not in existing_columns:
            connection.exec_driver_sql("ALTER TABLE furniture_items ADD COLUMN subcategory VARCHAR(120) NOT NULL DEFAULT 'General'")
        if "representation_key" not in existing_columns:
            connection.exec_driver_sql("ALTER TABLE furniture_items ADD COLUMN representation_key VARCHAR(80) NOT NULL DEFAULT ''")
        if "plan_symbol_url" not in existing_columns:
            connection.exec_driver_sql("ALTER TABLE furniture_items ADD COLUMN plan_symbol_url VARCHAR(255) NOT NULL DEFAULT ''")
        if "plan_symbol_data_url" not in existing_columns:
            connection.exec_driver_sql("ALTER TABLE furniture_items ADD COLUMN plan_symbol_data_url TEXT")
        if "plan_shape" not in existing_columns:
            connection.exec_driver_sql("ALTER TABLE furniture_items ADD COLUMN plan_shape VARCHAR(12) NOT NULL DEFAULT 'RECTANGLE'")
        if "image_data_json" not in existing_columns:
            connection.exec_driver_sql("ALTER TABLE furniture_items ADD COLUMN image_data_json TEXT NOT NULL DEFAULT '[]'")
        category_columns = {row[1] for row in connection.exec_driver_sql("PRAGMA table_info(furniture_categories)").fetchall()}
        if "default_side_clearance_mm" not in category_columns:
            connection.exec_driver_sql("ALTER TABLE furniture_categories ADD COLUMN default_side_clearance_mm FLOAT NOT NULL DEFAULT 0")
            added_side_clearance = True
        if "default_front_clearance_mm" not in category_columns:
            connection.exec_driver_sql("ALTER TABLE furniture_categories ADD COLUMN default_front_clearance_mm FLOAT NOT NULL DEFAULT 0")
            added_front_clearance = True
        for obsolete_index in (
            "ix_furniture_items_category_id",
            "ix_furniture_items_fixture_kind",
            "ix_furniture_items_name",
            "ix_furniture_items_supplier",
            "ix_furniture_items_sku",
        ):
            connection.exec_driver_sql(f"DROP INDEX IF EXISTS {obsolete_index}")
    with SessionLocal() as session:
        # Keep catalogue upgrades additive. Existing installations may already
        # contain custom category clearance settings, so only missing categories
        # receive the defaults while existing records retain their settings.
        for category_id, name, description, sort_order, side, front in CATEGORIES:
            category = session.get(FurnitureCategoryRecord, category_id)
            if category is None:
                session.add(FurnitureCategoryRecord(id=category_id, name=name, description=description, sort_order=sort_order, default_side_clearance_mm=side, default_front_clearance_mm=front))
        session.flush()
        _backfill_new_clearance_columns(session, side_added=added_side_clearance, front_added=added_front_clearance)
        _archive_obsolete_default_items(session)
        seed_fixture_defaults(session)
        _seed_materials(session)
        for catalogue_item in session.scalars(select(FurnitureItemRecord)).all():
            catalogue_item.image_data_json = migrate_legacy_pictures(catalogue_item.id, catalogue_item.image_data_json)
        session.commit()
        session.execute(select(FurnitureItemRecord.id).limit(1)).all()
        session.connection().exec_driver_sql("PRAGMA optimize")


def catalogue_session() -> Iterator[Session]:
    with SessionLocal() as session:
        yield session
