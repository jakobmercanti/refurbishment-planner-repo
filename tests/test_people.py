import math

import pytest
from fastapi.testclient import TestClient
from pydantic import ValidationError
from sqlalchemy import create_engine, select
from sqlalchemy.orm import Session

from backend.app.main import app
from database.catalog import seed_catalogue_categories
from database.cfd_proxies import seed_cfd_proxies
from database.models import Base, FurnitureItemRecord
from database.people_defaults import seed_people_defaults
from geometry.cfd import build_cfd_mesh
from geometry.layout_engine import analyse_layout
from geometry.models import ObstacleDefinition, RoomDefinition
from geometry.people import (
    PERSON_MODELS,
    STATURE_PRESETS,
    CataloguePerson,
    intentional_support_contact,
    person_dimensions,
)


def measurement(value):
    return {"value": value, "source_type": "USER_MEASURED", "uncertainty_mm": 0, "verified": False}


def obstacle(identifier, key, dimensions, center=(2000, 2000), **kwargs):
    return ObstacleDefinition(
        id=identifier,
        name=identifier,
        representation_key=key,
        center={"x": center[0], "y": center[1]},
        dimensions=dict(zip(("width", "depth", "height"), map(measurement, dimensions), strict=True)),
        source_type="USER_MEASURED",
        fixture_kind="FURNITURE",
        **kwargs,
    )


def seated_pair():
    host = obstacle("seat", "furniture-chair-modern", (550, 550, 850))
    spec = CataloguePerson(
        posture="SEATED",
        stature_mm=1650,
        seat_height_mm=450,
        support={"obstacle_id": host.id, "surface_height_mm": 450},
    )
    person = obstacle(
        "occupant",
        "people-seated",
        person_dimensions(1650, "SEATED", 450),
        center=(2000, 2000 - 0.16 * 1650),
        person_spec=spec,
    )
    return person, host


def room(items):
    return RoomDefinition(
        name="Occupant QA",
        vertices=[{"x": 0, "y": 0}, {"x": 5000, "y": 0}, {"x": 5000, "y": 5000}, {"x": 0, "y": 5000}],
        wall_height=measurement(2600),
        wall_thickness=measurement(100),
        obstacles=items,
    )


@pytest.mark.parametrize("model", PERSON_MODELS, ids=lambda p: p["posture"])
@pytest.mark.parametrize("stature", STATURE_PRESETS)
def test_every_person_preset_has_a_deterministic_posed_mm_envelope(model, stature):
    dimensions = person_dimensions(stature, model["posture"])
    assert dimensions == pytest.approx(
        (stature * model["widthFactor"], stature * model["depthFactor"], stature * model["heightFactor"])
    )
    assert all(math.isfinite(v) and 0 < v <= 2300 for v in dimensions)
    assert person_dimensions(stature, "SEATED", 400)[2] == pytest.approx(400 + 0.52 * stature)


@pytest.mark.parametrize(
    "change",
    [
        {"stature_mm": 599},
        {"stature_mm": math.inf},
        {"seat_height_mm": math.nan},
        {"posture": "CROUCHING"},
        {"style": "UNKNOWN"},
        {"support": {"obstacle_id": "seat", "surface_height_mm": 450}},
    ],
)
def test_invalid_occupant_configuration_is_rejected(change):
    with pytest.raises(ValidationError):
        CataloguePerson.model_validate({"posture": "STANDING", "stature_mm": 1800, **change})


def test_people_seeding_is_additive_idempotent_and_retains_customisation():
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(engine)
    with Session(engine) as session:
        seed_catalogue_categories(session)
        session.flush()
        assert seed_people_defaults(session) == 18
        session.flush()
        assert seed_people_defaults(session) == 0
        entries = session.scalars(select(FurnitureItemRecord).where(FurnitureItemRecord.category_id == "people")).all()
        item = entries[0]
        item.name, item.width_mm, item.active = "Keep my occupant", 777, False
        session.flush()
        assert seed_people_defaults(session) == 0
        assert (item.name, item.width_mm, item.active) == ("Keep my occupant", 777, False)
        seed_cfd_proxies(session)
        assert len(entries) == 18 and {i.cfd_proxy["profile"] for i in entries} == {m["key"] for m in PERSON_MODELS}


def test_intended_support_is_a_verify_not_a_false_collision_and_other_collisions_remain_authoritative():
    person, host = seated_pair()
    assert intentional_support_contact(person, host)
    result = analyse_layout(room([person, host]))
    assert any(c.check_id.startswith("person-support:") and c.status == "VERIFY" for c in result.checks)
    assert not result.collision_ids
    other = obstacle("unrelated", "furniture-storage-unit", (500, 500, 900), center=(2000, 1600))
    result = analyse_layout(room([person, host, other]))
    assert "occupant" in result.collision_ids and "unrelated" in result.collision_ids
    person.center.x += 200
    assert not intentional_support_contact(person, host)
    assert "occupant" in analyse_layout(room([person, host])).collision_ids
    person.center.x -= 200
    person.dimensions.width.value *= 2
    assert not intentional_support_contact(person, host), "Stale posture metadata cannot mask a resized envelope"
    assert "occupant" in analyse_layout(room([person, host])).collision_ids


def test_dangling_self_or_wrong_posture_support_cannot_survive_backend_validation():
    person, host = seated_pair()
    with pytest.raises(ValidationError, match="same room"):
        room([person])
    for key, posture in [("people-standing", "SEATED"), ("people-seated", "LYING")]:
        with pytest.raises(ValidationError, match="does not match"):
            obstacle("bad", key, (500, 500, 1200), person_spec={"posture": posture, "stature_mm": 1800})
    person.person_spec.support.obstacle_id = person.id
    with pytest.raises(ValidationError, match="same room"):
        room([person, host])


def test_people_are_a_top_level_catalogue_category_and_export_separate_cfd_geometry():
    client = TestClient(app)
    categories = client.get("/catalog/categories").json()
    assert next(c for c in categories if c["id"] == "people")["name"] == "People"
    entries = client.get("/catalog/items", params={"category_id": "people"}).json()
    assert len(entries) == 18
    for item in entries:
        assert item["cfd_proxy"]["profile"] == item["representation_key"]
        mesh = client.get(f"/catalog/items/{item['id']}/cfd")
        assert mesh.status_code == 200
        assert mesh.json()["dimensions_mm"] == [item["width_mm"], item["depth_mm"], item["height_mm"]]
        assert len(mesh.json()["triangles"]) <= 128
        assert client.get(f"/catalog/items/{item['id']}/cfd.stl").status_code == 200


@pytest.mark.parametrize("stature", STATURE_PRESETS)
def test_posture_changes_do_not_artificially_inflate_nominal_occupant_volume(stature):
    volumes = []
    for model in PERSON_MODELS:
        mesh = build_cfd_mesh(model["key"], *person_dimensions(stature, model["posture"]))
        volume = 0
        for face in mesh.triangles:
            a, b, c = [mesh.vertices_mm[i] for i in face]
            volume += (
                sum(a[i] * (b[(i + 1) % 3] * c[(i + 2) % 3] - b[(i + 2) % 3] * c[(i + 1) % 3]) for i in range(3)) / 6
            )
        volumes.append(volume)
    assert max(volumes) / min(volumes) < 1.10, "Pose simplification must not invent large body-volume changes"
