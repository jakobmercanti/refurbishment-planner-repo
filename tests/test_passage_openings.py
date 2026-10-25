import json
from pathlib import Path

import pytest
from pydantic import ValidationError
from shapely.geometry import Polygon
from sqlalchemy import create_engine, select
from sqlalchemy.orm import Session

from cad.generator import _snapshot
from database.catalog import seed_catalogue_categories
from database.fixture_defaults import DOOR_MODELS, seed_fixture_defaults
from database.models import Base, FurnitureCategoryRecord, FurnitureItemRecord
from geometry.engine import check_fit
from geometry.fixtures import build_l_shaped_fixture
from geometry.layout_engine import analyse_layout
from geometry.models import GenericOpening, OpeningKind, PassageProfile, RoomDefinition
from geometry.opening_profiles import passage_height_mm, passage_polygon_mm
from geometry.shapes import door_swing_envelope


def test_openings_family_seeds_six_real_catalogue_entries_idempotently_without_editing_other_products():
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(engine)
    with Session(engine) as session:
        seed_catalogue_categories(session)
        seed_fixture_defaults(session)
        session.commit()
        unrelated = session.scalar(select(FurnitureItemRecord).where(FurnitureItemRecord.category_id == "doors"))
        unrelated.name, unrelated.width_mm, unrelated.active = "User edited door", 777, False
        expected = (unrelated.name, unrelated.width_mm, unrelated.active)
        for _ in range(2):
            seed_fixture_defaults(session, category_ids=frozenset({"doors-openings"}))
            session.commit()
        assert session.get(FurnitureCategoryRecord, "doors-openings").name == "Openings"
        items = session.scalars(
            select(FurnitureItemRecord).where(FurnitureItemRecord.category_id == "doors-openings")
        ).all()
        assert len(items) == 6
        models = {m["key"]: m for m in DOOR_MODELS if m["operation"] == "OPENING"}
        assert {item.representation_key for item in items} == set(models)
        for item in items:
            assert item.fixture_kind == "DOOR" and models[item.representation_key]["leaves"] == 0
            assert (item.width_mm, item.depth_mm, item.height_mm) == tuple(
                models[item.representation_key][axis] for axis in ("width", "depth", "height")
            )
            assert (Path("frontend/public") / item.plan_symbol_url.lstrip("/")).is_file()
            assert Path(f"frontend/public/fixture-previews/{item.representation_key}.png").is_file()
        assert (unrelated.name, unrelated.width_mm, unrelated.active) == expected


@pytest.mark.parametrize("profile", list(PassageProfile))
def test_passages_roundtrip_and_never_generate_door_sweep_collisions(profile):
    fixture = build_l_shaped_fixture()
    room = fixture.room.model_copy(deep=True)
    door = next(o for o in room.openings if o.kind is OpeningKind.DOOR)
    door.passage_profile = profile
    door.hinge_side = door.door_type = door.swing_angle_deg = door.opens_inward = None
    restored = RoomDefinition.model_validate_json(room.model_dump_json())
    passage = next(o for o in restored.openings if o.id == door.id)
    assert passage.passage_profile == profile
    assert door_swing_envelope(restored, passage).is_empty
    result = check_fit(restored, fixture.product, fixture.placements["FIT"])
    assert not any(check.check_id.startswith("door-swing:") for check in result.checks)
    assert not any(
        check.check_id.startswith(("door-swing:", "person-door")) for check in analyse_layout(restored).checks
    )
    snapshot = _snapshot(restored, fixture.product, fixture.placements["FIT"], result)
    exported = next(o for o in snapshot["room"]["openings"] if o["id"] == door.id)
    points = exported["profile_points_mm"]
    assert points == passage_polygon_mm(profile, door.width.value, door.height.value)
    assert Polygon(points).is_valid
    assert max(z for _, z in points) == pytest.approx(door.height.value)


def test_passage_profiles_are_validated_without_weakening_existing_door_rules():
    door = next(o for o in build_l_shaped_fixture().room.openings if o.kind is OpeningKind.DOOR).model_dump()
    for invalid in ("unknown", "round_arch", 42):
        with pytest.raises(ValidationError):
            GenericOpening.model_validate({**door, "passage_profile": invalid})
    with pytest.raises(ValidationError, match="doorway"):
        GenericOpening.model_validate({**door, "kind": "WINDOW", "passage_profile": "ROUND_ARCH"})
    with pytest.raises(ValidationError, match="hinge_side"):
        GenericOpening.model_validate({**door, "hinge_side": None})


@pytest.mark.parametrize("profile", list(PassageProfile))
def test_profile_elevation_is_symmetric_bounded_and_keeps_the_crown_height(profile):
    for width, height in ((900, 2100), (1800, 2200), (3000, 2000)):
        values = [passage_height_mm(profile, width, height, width * i / 100) for i in range(101)]
        assert values == pytest.approx(list(reversed(values)))
        assert all(0 < z <= height for z in values)
        assert values[50] == pytest.approx(height)
        area = Polygon(passage_polygon_mm(profile, width, height)).area
        assert 0 < area <= width * height


def test_door_model_profiles_and_domain_profiles_are_the_same_contract():
    models = json.loads(Path("frontend/lib/doorModels.json").read_text(encoding="utf8"))
    assert {m["profile"] for m in models if m["operation"] == "OPENING"} == {p.value for p in PassageProfile}
