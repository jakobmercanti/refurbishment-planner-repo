from pathlib import Path

import pytest
from pydantic import ValidationError
from backend.app.schemas import CatalogueItemInput

from sqlalchemy import create_engine, select
from sqlalchemy.orm import Session

from database.fixture_defaults import FIXTURE_DEFAULTS, seed_fixture_defaults
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
        assert len(items) == 17
        for category, (_, variants) in FIXTURE_DEFAULTS.items():
            assert 3 <= len(variants) <= 10
            assert {item.subcategory for item in items if item.category_id == category} == {v[1] for v in variants}
        for item in items:
            assert item.name == "Default"
            assert (Path("frontend/public") / item.plan_symbol_url.lstrip("/")).is_file()
            assert (Path("frontend/public/fixture-previews") / f"{item.representation_key}.svg").is_file()
        items[0].width_mm = 777
        items[0].name = "Edited default"
        session.commit()
        seed_fixture_defaults(session)
        session.commit()
        assert len(session.scalars(select(FurnitureItemRecord)).all()) == 17
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
