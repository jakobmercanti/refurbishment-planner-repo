from __future__ import annotations

from fastapi.testclient import TestClient

from backend.app.main import app
from geometry.fixtures import build_l_shaped_fixture

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
