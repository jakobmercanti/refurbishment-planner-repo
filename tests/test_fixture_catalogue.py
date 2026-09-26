from pathlib import Path

import pytest
from pydantic import ValidationError
from backend.app.schemas import CatalogueItemInput

from sqlalchemy import create_engine, select
from sqlalchemy.orm import Session

from database.fixture_defaults import FIXTURE_DEFAULTS, fixture_default_name, seed_fixture_defaults
from database.catalog import CATEGORIES, seed_catalogue_categories
from database.models import Base, FurnitureCategoryRecord, FurnitureItemRecord
from geometry.fixtures import build_l_shaped_fixture
from geometry.models import RoomDefinition


def test_generic_catalogue_hierarchy_assets_and_idempotence():
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(engine)
    with Session(engine) as session:
        for category in FIXTURE_DEFAULTS:
            session.add(FurnitureCategoryRecord(id=category, name=category, description="", sort_order=0))
        seed_fixture_defaults(session)
        session.commit()
        items = session.scalars(select(FurnitureItemRecord)).all()
        assert len(items) == 57
        for category, (_, variants) in FIXTURE_DEFAULTS.items():
            assert 1 <= len(variants) <= 10
            assert {item.subcategory for item in items if item.category_id == category} == {v[1] for v in variants}
            assert {item.name for item in items if item.category_id == category} == {fixture_default_name(category, slug, subcategory) for slug, subcategory, *_ in variants}
        for item in items:
            assert (Path("frontend/public") / item.plan_symbol_url.lstrip("/")).is_file()
            assert (Path("frontend/public/fixture-previews") / f"{item.representation_key}.svg").is_file()
        items[0].width_mm = 777
        items[0].name = "Edited default"
        session.commit()
        seed_fixture_defaults(session)
        session.commit()
        assert len(session.scalars(select(FurnitureItemRecord)).all()) == 57
        assert items[0].width_mm == 777
        assert items[0].name == "Edited default"


def test_representation_survives_room_serialisation():
    room = build_l_shaped_fixture().room
    obstacle = room.obstacles[0]
    obstacle.representation_key = "basin-wall-mounted"
    obstacle.plan_symbol_url = "/fixture-symbols/basin-wall-mounted.svg"
    obstacle.subcategory = "Wall mounted"
    obstacle.plan_symbol_data_url = "data:image/png;base64,aGVsbG8="
    restored = RoomDefinition.model_validate_json(room.model_dump_json())
    assert restored.obstacles[0].representation_key == "basin-wall-mounted"
    assert restored.obstacles[0].plan_symbol_url == obstacle.plan_symbol_url
    assert restored.obstacles[0].dimensions == obstacle.dimensions
    assert restored.obstacles[0].plan_symbol_data_url == obstacle.plan_symbol_data_url


def test_electric_category_seeds_idempotently_without_items_or_overwriting_existing_categories():
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(engine)
    with Session(engine) as session:
        session.add(FurnitureCategoryRecord(
            id="storage", name="Custom Storage Name", description="Keep this text.", sort_order=999,
            default_side_clearance_mm=42, default_front_clearance_mm=84,
        ))
        session.flush()
        seed_catalogue_categories(session)
        session.commit()

        electric = session.get(FurnitureCategoryRecord, "electric")
        assert electric is not None
        assert electric.name == "Electric"
        assert session.scalars(select(FurnitureItemRecord).where(FurnitureItemRecord.category_id == "electric")).all() == []
        expected_category_count = len({category[0] for category in CATEGORIES})
        assert len(session.scalars(select(FurnitureCategoryRecord)).all()) == expected_category_count

        seed_catalogue_categories(session)
        session.commit()
        assert len(session.scalars(select(FurnitureCategoryRecord)).all()) == expected_category_count
        storage = session.get(FurnitureCategoryRecord, "storage")
        assert storage is not None
        assert (storage.name, storage.description, storage.sort_order) == ("Custom Storage Name", "Keep this text.", 999)
        assert (storage.default_side_clearance_mm, storage.default_front_clearance_mm) == (42, 84)


def test_rendered_previews_are_persisted_and_preserve_customisations(tmp_path, monkeypatch):
    import json
    import hashlib
    from database.fixture_previews import install_fixture_previews
    monkeypatch.setenv("RENOVATION_FIT_DATABASE", str(tmp_path / "catalogue.sqlite3"))
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(engine)
    with Session(engine) as session:
        for category in FIXTURE_DEFAULTS:
            session.add(FurnitureCategoryRecord(id=category, name=category, description="", sort_order=0))
        seed_fixture_defaults(session)
        session.commit()
        items = session.scalars(select(FurnitureItemRecord)).all()
        items[0].width_mm = 777
        install_fixture_previews(session)
        for item in items:
            if not (Path("frontend/public/fixture-previews") / f"{item.representation_key}.png").is_file():
                assert (Path("frontend/public/fixture-previews") / f"{item.representation_key}.svg").is_file()
                continue
            picture = json.loads(item.image_data_json)[0]
            stored = tmp_path / "catalogue-assets" / item.id / picture["filename"]
            assert hashlib.sha256(stored.read_bytes()).hexdigest() == picture["sha256"]
            assert item.representation_version == 2
            assert picture["generated_representation"] == 2
        previous = {item.id: item.image_data_json for item in items}
        install_fixture_previews(session)
        assert {item.id: item.image_data_json for item in items} == previous
        assert items[0].width_mm == 777
        custom = '[{"url":"/supplier-photo.png","alt":"Supplier photograph"}]'
        items[0].image_data_json = custom
        session.commit()
        install_fixture_previews(session)
        assert items[0].image_data_json == custom


def test_manufacturer_plan_image_and_generic_symbol_validation():
    values = dict(category_id="toilets", fixture_kind="TOILET", name="Supplier WC",
                  supplier="Example", sku="WC-1", width_mm=360, depth_mm=540,
                  height_mm=420, color_hex="#FFFFFF", subcategory="Wall mounted",
                  representation_key="toilet-wall-mounted",
                  plan_symbol_url="/fixture-symbols/toilet-wall-mounted.svg",
                  plan_symbol_data_url="data:image/png;base64,aGVsbG8=")
    item = CatalogueItemInput(**values)
    assert CatalogueItemInput.model_validate_json(item.model_dump_json()) == item
    with pytest.raises(ValidationError):
        CatalogueItemInput(**{**values, "plan_symbol_data_url": "data:text/html;base64,aGVsbG8="})
    with pytest.raises(ValidationError):
        CatalogueItemInput(**{**values, "plan_symbol_url": "https://example.com/untrusted.svg"})
