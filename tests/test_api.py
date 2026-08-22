from __future__ import annotations

from fastapi.testclient import TestClient

from backend.app.main import app
from geometry.fixtures import build_l_shaped_fixture
from geometry.models import Point2D

client = TestClient(app)


def test_health_declares_authoritative_units() -> None:
    response = client.get("/health")
    assert response.status_code == 200
    assert response.json() == {"status": "ok", "engine": "deterministic", "unit": "mm"}


def test_demo_exposes_mandatory_three_outcomes() -> None:
    response = client.get("/demo")
    assert response.status_code == 200
    payload = response.json()
    assert payload["results"]["FIT"]["status"] == "FIT"
    assert payload["results"]["VERIFY"]["status"] == "VERIFY"
    assert payload["results"]["FAIL"]["status"] == "FAIL"
    assert len(payload["room"]["vertices"]) == 6


def test_fit_endpoint_uses_domain_engine() -> None:
    fixture = build_l_shaped_fixture()
    response = client.post(
        "/fit-checks",
        json={
            "room": fixture.room.model_dump(mode="json"),
            "product": fixture.product.model_dump(mode="json"),
            "placement": fixture.placements["VERIFY"].model_dump(mode="json"),
        },
    )
    assert response.status_code == 201
    payload = response.json()
    assert payload["status"] == "VERIFY"
    assert "1207.0 ± 12.0 mm" in payload["summary"]


def test_invalid_room_topology_is_rejected() -> None:
    fixture = build_l_shaped_fixture()
    payload = fixture.room.model_dump(mode="json")
    payload["vertices"] = [
        {"x": 0, "y": 0},
        {"x": 2000, "y": 2000},
        {"x": 0, "y": 2000},
        {"x": 2000, "y": 0},
    ]
    response = client.post("/rooms", json=payload)
    assert response.status_code == 422
    assert "Self-intersection" in response.json()["detail"]


def test_room_validation_returns_engineering_wall_summary_and_invalidations() -> None:
    fixture = build_l_shaped_fixture()
    response = client.post("/rooms/validate", json=fixture.room.model_dump(mode="json"))
    assert response.status_code == 200
    payload = response.json()
    assert payload["valid"] is True
    assert payload["orientation"] == "CCW"
    assert payload["area_mm2"] == 7_960_000.0
    assert [wall["length_mm"] for wall in payload["walls"]] == [
        3200.0,
        1800.0,
        1000.0,
        1000.0,
        2200.0,
        2800.0,
    ]
    assert {item["entity_id"] for item in payload["invalidations"]} == {
        "door-001",
        "window-001",
        "vanity-001",
    }
    assert "fit analyses" in payload["warnings"][0]


def test_room_save_rejects_mismatched_path_identifier() -> None:
    fixture = build_l_shaped_fixture()
    response = client.put(
        "/rooms/00000000-0000-0000-0000-000000009999",
        json=fixture.room.model_dump(mode="json"),
    )
    assert response.status_code == 409


def test_room_save_accepts_valid_generic_rectangle() -> None:
    fixture = build_l_shaped_fixture()
    room = fixture.room.model_copy(
        update={
            "vertices": [
                Point2D(x=0.0, y=0.0),
                Point2D(x=2600.0, y=0.0),
                Point2D(x=2600.0, y=2100.0),
                Point2D(x=0.0, y=2100.0),
            ],
            "openings": [],
            "obstacles": [],
            "version": 2,
        }
    )
    response = client.put(
        f"/rooms/{room.id}",
        json=room.model_dump(mode="json"),
    )
    assert response.status_code == 200
    assert len(response.json()["vertices"]) == 4
    assert response.json()["version"] == 2
