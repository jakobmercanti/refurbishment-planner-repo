import json
from pathlib import Path
import pytest
from pydantic import ValidationError
from sqlalchemy import create_engine, select
from sqlalchemy.orm import Session
from database.models import Base, FurnitureItemRecord
from database.heating_defaults import seed_heating_defaults
from backend.app.schemas import CatalogueItemInput

def test_shared_heating_products_seed_idempotently_and_preserve_edits():
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(engine)
    with Session(engine) as session:
        seed_heating_defaults(session); session.flush()
        items = session.scalars(select(FurnitureItemRecord)).all()
        products = json.loads(Path("frontend/lib/heatingProducts.json").read_text())
        assert len(items) == len(products)
        first = items[0]; first.heating_spec = {**first.heating_spec, "ratedOutputW": 123}
        seed_heating_defaults(session); session.flush()
        assert len(session.scalars(select(FurnitureItemRecord)).all()) == len(products)
        assert first.heating_spec["ratedOutputW"] == 123
        assert all(item.category_id == ("heating-boilers" if item.heating_spec["category"] == "Boiler" else "heating") for item in items)

def test_heating_spec_is_validated_on_catalogue_writes():
    base = dict(category_id="heating", fixture_kind="FURNITURE", name="Test", supplier="Test", sku="Test", width_mm=600, height_mm=600, depth_mm=100, color_hex="#FFFFFF")
    payload = CatalogueItemInput(**base, heating_spec={"ratedOutputW": None})
    assert payload.heating_spec.ratedOutputW is None
    with pytest.raises(ValidationError):
        CatalogueItemInput(**base, heating_spec={"ratedOutputW": -1})

def test_existing_sqlite_catalogue_gets_additive_heating_spec_column(tmp_path, monkeypatch):
    from sqlalchemy.orm import sessionmaker
    from database import catalog
    location = tmp_path / "catalogue.sqlite3"
    engine = create_engine(f"sqlite:///{location.as_posix()}")
    Base.metadata.create_all(engine)
    with engine.begin() as connection:
        connection.exec_driver_sql("ALTER TABLE furniture_items DROP COLUMN heating_spec")
    monkeypatch.setenv("RENOVATION_FIT_DATABASE", str(location))
    monkeypatch.setattr(catalog, "ENGINE", engine)
    monkeypatch.setattr(catalog, "SessionLocal", sessionmaker(bind=engine, expire_on_commit=False))
    catalog.initialise_catalogue()
    with engine.connect() as connection:
        assert "heating_spec" in {row[1] for row in connection.exec_driver_sql("PRAGMA table_info(furniture_items)")}
    with Session(engine) as session:
        assert session.get(FurnitureItemRecord, "heating-purmo-c22-600-1000").heating_spec["ratedOutputW"] == 1709
        radiators = session.scalars(select(FurnitureItemRecord).where(FurnitureItemRecord.category_id.like("radiators-%"))).all()
        assert radiators and all(item.heating_spec["ratedOutputW"] > 0 and item.heating_spec["estimatedOutput"] for item in radiators)
        boilers = session.scalars(select(FurnitureItemRecord).where(FurnitureItemRecord.category_id == "heating-boilers")).all()
        assert sorted(item.heating_spec["ratedOutputW"] for item in boilers) == [12000, 18000, 24000]
