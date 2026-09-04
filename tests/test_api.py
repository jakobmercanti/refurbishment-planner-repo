from __future__ import annotations

import asyncio
import base64
from io import BytesIO
import shutil
from uuid import uuid4

import backend.app.main as api_main

from fastapi.testclient import TestClient
from PIL import Image

from backend.app.main import app
from database.catalog import SessionLocal, _backfill_new_clearance_columns, initialise_catalogue
from database.catalogue_assets import asset_root
from database.models import FurnitureCategoryRecord, FurnitureItemRecord
from geometry.fixtures import build_l_shaped_fixture
from geometry.models import DoorType, OpeningKind, PersonMockup, Point2D

client = TestClient(app)


def picture_data_url(image_format: str = "PNG", size: tuple[int, int] = (2, 2)) -> str:
    stream = BytesIO()
    Image.new("RGB", size, "navy").save(stream, format=image_format)
    media_type = "jpeg" if image_format == "JPEG" else image_format.lower()
    return f"data:image/{media_type};base64,{base64.b64encode(stream.getvalue()).decode()}"


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


def test_layout_endpoint_checks_only_placed_elements() -> None:
    fixture = build_l_shaped_fixture()
    room = fixture.room.model_copy(update={"openings": [], "obstacles": []})
    response = client.post("/layout-checks", json=room.model_dump(mode="json"))
    assert response.status_code == 201
    assert response.json()["status"] == "VERIFY"
    assert response.json()["collision_ids"] == []


def test_layout_endpoint_detects_element_overlap() -> None:
    fixture = build_l_shaped_fixture()
    first = fixture.room.obstacles[0]
    second = first.model_copy(update={"id": "cabinet-002", "name": "Storage cabinet"})
    room = fixture.room.model_copy(update={"openings": [], "obstacles": [first, second]})
    response = client.post("/layout-checks", json=room.model_dump(mode="json"))
    assert response.status_code == 201
    payload = response.json()
    assert payload["status"] == "FAIL"
    assert payload["collision_ids"] == ["cabinet-002", "vanity-001"]
    assert any(check["check_id"].startswith("item-collision:") for check in payload["checks"])


def test_layout_endpoint_detects_person_element_collision() -> None:
    fixture = build_l_shaped_fixture()
    obstacle = fixture.room.obstacles[0]
    person = PersonMockup(center=obstacle.center, movement_clearance_mm=0)
    room = fixture.room.model_copy(update={"openings": [], "person_mockup": person})
    response = client.post("/layout-checks", json=room.model_dump(mode="json"))
    assert response.status_code == 201
    payload = response.json()
    assert payload["status"] == "FAIL"
    assert "person-001" in payload["collision_ids"]
    assert obstacle.id in payload["collision_ids"]
    assert any(check["check_id"].startswith("person-collision:") for check in payload["checks"])


def test_layout_endpoint_marks_restricted_person_movement_for_verification() -> None:
    fixture = build_l_shaped_fixture()
    person = PersonMockup(
        center=Point2D(x=250.0, y=250.0),
        shoulder_width_mm=300.0,
        body_depth_mm=200.0,
        movement_clearance_mm=300.0,
    )
    room = fixture.room.model_copy(update={"openings": [], "obstacles": [], "person_mockup": person})
    response = client.post("/layout-checks", json=room.model_dump(mode="json"))
    assert response.status_code == 201
    payload = response.json()
    assert payload["status"] == "VERIFY"
    assert payload["collision_ids"] == []
    assert any(check["check_id"].startswith("person-movement-boundary:") for check in payload["checks"])


def test_crouching_posture_uses_reduced_effective_height() -> None:
    fixture = build_l_shaped_fixture()
    person = PersonMockup(
        center=Point2D(x=1200.0, y=1200.0),
        posture="CROUCHING",
        height_mm=2500.0,
        eye_height_mm=900.0,
        movement_clearance_mm=0.0,
    )
    room = fixture.room.model_copy(update={"openings": [], "obstacles": [], "person_mockup": person})
    response = client.post("/layout-checks", json=room.model_dump(mode="json"))
    assert response.status_code == 201
    payload = response.json()
    assert payload["status"] == "FIT"
    height_check = next(check for check in payload["checks"] if check["check_id"].startswith("person-height:"))
    assert height_check["status"] == "PASS"


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


def test_room_validation_accepts_double_door_and_rejects_opening_beyond_wall() -> None:
    fixture = build_l_shaped_fixture()
    door = next(opening for opening in fixture.room.openings if opening.kind is OpeningKind.DOOR)
    double_door = door.model_copy(
        update={"door_type": DoorType.DOUBLE, "width": door.width.model_copy(update={"value": 1600.0})}
    )
    valid_room = fixture.room.model_copy(update={"openings": [double_door]})
    response = client.post("/rooms/validate", json=valid_room.model_dump(mode="json"))
    assert response.status_code == 200
    assert response.json()["invalidations"][0]["entity_id"] == "door-001"

    invalid_door = double_door.model_copy(update={"offset_mm": 2000.0})
    invalid_room = fixture.room.model_copy(update={"openings": [invalid_door]})
    response = client.post("/rooms/validate", json=invalid_room.model_dump(mode="json"))
    assert response.status_code == 422
    assert "beyond the 3200.0 mm wall" in response.json()["detail"]


def test_double_door_requires_door_fields() -> None:
    fixture = build_l_shaped_fixture()
    door = next(opening for opening in fixture.room.openings if opening.kind is OpeningKind.DOOR)
    payload = door.model_dump(mode="json")
    payload.update({"door_type": "DOUBLE", "hinge_side": None})
    response = client.post(f"/rooms/{fixture.room.id}/openings", json=payload)
    assert response.status_code == 422


def test_catalogue_supports_categories_and_supplier_entry_lifecycle() -> None:
    categories = client.get("/catalog/categories")
    assert categories.status_code == 200
    assert {category["id"] for category in categories.json()} == {"showers", "basins", "toilets", "storage"}
    category_defaults = {category["id"]: category for category in categories.json()}
    assert category_defaults["toilets"]["default_side_clearance_mm"] == 200
    assert category_defaults["toilets"]["default_front_clearance_mm"] == 400
    assert category_defaults["showers"]["default_side_clearance_mm"] == 0
    assert category_defaults["showers"]["default_front_clearance_mm"] == 500

    paint_collections = client.get("/catalog/materials?kind=PAINT")
    assert paint_collections.status_code == 200
    paints = {collection["id"]: collection for collection in paint_collections.json()}
    assert {"paints-default", "paints-dulux"}.issubset(paints)
    assert sum(len(family["items"]) for family in paints["paints-default"]["families"]) >= 200
    assert sum(len(family["items"]) for family in paints["paints-dulux"]["families"]) > 0
    tiles = client.get("/catalog/materials?kind=TILE")
    assert tiles.status_code == 200
    assert tiles.json()[0]["id"] == "tiles-default"

    suffix = uuid4().hex[:8]
    payload = {
        "category_id": "storage",
        "fixture_kind": "FURNITURE",
        "name": "Supplier test cabinet",
        "supplier": f"Test Supplier {suffix}",
        "sku": f"CAB-{suffix}",
        "width_mm": 610,
        "depth_mm": 420,
        "height_mm": 880,
        "color_hex": "#446688",
        "description": "Test-only supplier catalogue record.",
        "stl_filename": "cabinet.stl",
        "stl_base64": "data:model/stl;base64,U09MSUQ=",
        "side_clearance_mm": 150,
        "front_clearance_mm": 200,
    }
    created = client.post("/catalog/items", json=payload)
    assert created.status_code == 201
    item_id = created.json()["id"]
    try:
        assert created.json()["category_name"] == "Storage & furniture"
        assert created.json()["color_hex"] == "#446688"
        assert created.json()["is_default"] is False
        assert created.json()["stl_filename"] == "cabinet.stl"
        assert created.json()["stl_base64"].endswith("U09MSUQ=")
        assert created.json()["side_clearance_mm"] == 150
        assert created.json()["front_clearance_mm"] == 200
        updated = client.put(
            f"/catalog/items/{item_id}",
            json={**payload, "name": "Updated supplier cabinet", "color_hex": "#884466"},
        )
        assert updated.status_code == 200
        assert updated.json()["name"] == "Updated supplier cabinet"
        assert updated.json()["color_hex"] == "#884466"
        assert updated.json()["side_clearance_mm"] == 150
    finally:
        archived = client.delete(f"/catalog/items/{item_id}")
        assert archived.status_code == 204
        with SessionLocal() as session:
            test_record = session.get(FurnitureItemRecord, item_id)
            if test_record is not None and test_record.supplier.startswith("Test Supplier "):
                session.delete(test_record)
                session.commit()


def test_layout_check_resolves_category_clearance_when_item_has_no_override() -> None:
    toilet = next(item for item in client.get("/catalog/items?category_id=toilets").json() if item["is_default"])
    fixture = build_l_shaped_fixture()
    obstacle = fixture.room.obstacles[0].model_copy(
        update={"model_id": toilet["id"], "side_clearance_mm": None, "front_clearance_mm": None}
    )
    room = fixture.room.model_copy(update={"openings": [], "obstacles": [obstacle], "person_mockup": None})
    response = client.post("/layout-checks", json=room.model_dump(mode="json"))
    assert response.status_code == 201
    clearance_check = next(check for check in response.json()["checks"] if check["check_id"] == f"category-clearance:{obstacle.id}")
    assert "200 mm side and 400 mm front" in clearance_check["explanation"]


def test_layout_check_detects_an_item_inside_a_directional_clearance_zone() -> None:
    fixture = build_l_shaped_fixture()
    first = fixture.room.obstacles[0].model_copy(
        update={
            "id": "clearance-owner",
            "center": Point2D(x=1200.0, y=1000.0),
            "rotation_deg": 0.0,
            "side_clearance_mm": 0.0,
            "front_clearance_mm": 400.0,
        }
    )
    second = first.model_copy(
        update={
            "id": "clearance-intruder",
            "center": Point2D(x=1200.0, y=1650.0),
            "side_clearance_mm": None,
            "front_clearance_mm": None,
        }
    )
    room = fixture.room.model_copy(update={"openings": [], "obstacles": [first, second], "person_mockup": None})
    response = client.post("/layout-checks", json=room.model_dump(mode="json"))
    assert response.status_code == 201
    assert any(check["check_id"] == "category-clearance:clearance-owner:item:clearance-intruder" for check in response.json()["checks"])


def test_catalogue_highlights_and_preserves_builtin_defaults() -> None:
    response = client.get("/catalog/items?category_id=basins")
    assert response.status_code == 200
    defaults = [item for item in response.json() if item["is_default"]]
    assert defaults
    assert all(item["supplier_editable"] for item in defaults)
    archived = client.delete(f"/catalog/items/{defaults[0]['id']}")
    assert archived.status_code == 403
    assert "modified but not archived" in archived.json()["detail"]


def test_catalogue_category_defaults_can_be_updated_without_changing_item_overrides() -> None:
    original = next(category for category in client.get("/catalog/categories").json() if category["id"] == "storage")
    try:
        updated = client.patch("/catalog/categories/storage", json={"default_side_clearance_mm": 125, "default_front_clearance_mm": 275})
        assert updated.status_code == 200
        assert updated.json()["default_side_clearance_mm"] == 125
        assert updated.json()["default_front_clearance_mm"] == 275
        initialise_catalogue()
        persisted = next(category for category in client.get("/catalog/categories").json() if category["id"] == "storage")
        assert persisted["default_side_clearance_mm"] == 125
        assert persisted["default_front_clearance_mm"] == 275
    finally:
        client.patch("/catalog/categories/storage", json={"default_side_clearance_mm": original["default_side_clearance_mm"], "default_front_clearance_mm": original["default_front_clearance_mm"]})


def test_clearance_migration_backfills_only_the_column_that_was_added() -> None:
    with SessionLocal() as session:
        storage = session.get(FurnitureCategoryRecord, "storage")
        assert storage is not None
        original = (storage.default_side_clearance_mm, storage.default_front_clearance_mm)
        try:
            storage.default_side_clearance_mm = 321
            storage.default_front_clearance_mm = 654
            _backfill_new_clearance_columns(session, side_added=True, front_added=False)
            assert storage.default_side_clearance_mm == 0
            assert storage.default_front_clearance_mm == 654
            storage.default_side_clearance_mm = 321
            _backfill_new_clearance_columns(session, side_added=False, front_added=True)
            assert storage.default_side_clearance_mm == 321
            assert storage.default_front_clearance_mm == 0
        finally:
            storage.default_side_clearance_mm, storage.default_front_clearance_mm = original
            session.commit()


def test_catalogue_items_normalise_hex_and_persist_subcategory_shape_and_three_small_pictures() -> None:
    suffix = uuid4().hex[:8]
    picture = picture_data_url()
    payload = {
        "category_id": "storage", "fixture_kind": "FURNITURE", "name": "Round storage",
        "supplier": f"Shape Supplier {suffix}", "sku": f"ROUND-{suffix}", "width_mm": 500,
        "depth_mm": 500, "height_mm": 600, "color_hex": "#aabbcc", "subcategory": "Stools",
        "plan_shape": "ELLIPSE", "images": [{"data_url": picture, "alt": f"Picture {index}"} for index in range(3)],
    }
    created = client.post("/catalog/items", json=payload)
    assert created.status_code == 201
    item_id = created.json()["id"]
    try:
        assert created.json()["color_hex"] == "#AABBCC"
        assert created.json()["subcategory"] == "Stools"
        assert created.json()["plan_shape"] == "ELLIPSE"
        assert len(created.json()["images"]) == 3
        assert all(not image.get("data_url") and image["url"].startswith(f"/catalog/items/{item_id}/images/") for image in created.json()["images"])
        listing = next(item for item in client.get("/catalog/items?category_id=storage").json() if item["id"] == item_id)
        assert "base64" not in str(listing["images"])
        picture_response = client.get(listing["images"][0]["url"])
        assert picture_response.status_code == 200
        assert picture_response.headers["content-type"].startswith("image/png")
        assert picture_response.content.startswith(b"\x89PNG\r\n\x1a\n")
        reduced = client.put(f"/catalog/items/{item_id}", json={**payload, "images": [created.json()["images"][0]]})
        assert reduced.status_code == 200
        assert len(reduced.json()["images"]) == 1
        assert len(list((asset_root() / item_id).iterdir())) == 1
        too_many = client.post("/catalog/items", json={**payload, "sku": f"TOO-MANY-{suffix}", "images": payload["images"] * 2})
        assert too_many.status_code == 422
        wrong_signature = client.post("/catalog/items", json={**payload, "sku": f"BAD-IMAGE-{suffix}", "images": [{"data_url": "data:image/png;base64," + base64.b64encode(b"not-png").decode(), "alt": "Invalid"}]})
        assert wrong_signature.status_code == 422
        assert "do not match" in wrong_signature.json()["detail"]
        corrupt = client.post("/catalog/items", json={**payload, "sku": f"CORRUPT-{suffix}", "images": [{"data_url": "data:image/png;base64," + base64.b64encode(b"\x89PNG\r\n\x1a\ntruncated").decode(), "alt": "Corrupt"}]})
        assert corrupt.status_code == 422
        assert "corrupt or incomplete" in corrupt.json()["detail"]
        too_wide = client.post("/catalog/items", json={**payload, "sku": f"WIDE-{suffix}", "images": [{"data_url": picture_data_url(size=(4097, 1)), "alt": "Too wide"}]})
        assert too_wide.status_code == 422
        assert "dimensions" in too_wide.json()["detail"]
    finally:
        client.delete(f"/catalog/items/{item_id}")
        assert not (asset_root() / item_id).exists()
        with SessionLocal() as session:
            record = session.get(FurnitureItemRecord, item_id)
            if record is not None:
                session.delete(record)
                session.commit()


def test_picture_replacement_restores_old_asset_when_database_commit_fails(monkeypatch) -> None:
    suffix = uuid4().hex[:8]
    original_picture = picture_data_url()
    payload = {
        "category_id": "storage", "fixture_kind": "FURNITURE", "name": "Rollback storage",
        "supplier": f"Rollback Supplier {suffix}", "sku": f"ROLLBACK-{suffix}", "width_mm": 500,
        "depth_mm": 400, "height_mm": 600, "color_hex": "#112233", "subcategory": "General",
        "plan_shape": "RECTANGLE", "images": [{"data_url": original_picture, "alt": "Original"}],
    }
    created = client.post("/catalog/items", json=payload)
    assert created.status_code == 201
    item_id = created.json()["id"]
    original_bytes = client.get(created.json()["images"][0]["url"]).content
    real_commit = api_main.Session.commit

    def fail_commit(_session) -> None:
        raise RuntimeError("simulated commit failure")

    try:
        with monkeypatch.context() as patch:
            patch.setattr(api_main.Session, "commit", fail_commit)
            failed = client.put(f"/catalog/items/{item_id}", json={**payload, "images": [{"data_url": picture_data_url("JPEG"), "alt": "Replacement"}]})
            assert failed.status_code == 500
        assert api_main.Session.commit is real_commit
        assert client.get(created.json()["images"][0]["url"]).content == original_bytes
    finally:
        client.delete(f"/catalog/items/{item_id}")
        with SessionLocal() as session:
            record = session.get(FurnitureItemRecord, item_id)
            if record is not None:
                session.delete(record)
                session.commit()


def test_archive_remains_successful_and_asset_inaccessible_when_cleanup_fails(monkeypatch) -> None:
    suffix = uuid4().hex[:8]
    payload = {
        "category_id": "storage", "fixture_kind": "FURNITURE", "name": "Archive storage",
        "supplier": f"Archive Supplier {suffix}", "sku": f"ARCHIVE-{suffix}", "width_mm": 500,
        "depth_mm": 400, "height_mm": 600, "color_hex": "#112233", "subcategory": "General",
        "plan_shape": "RECTANGLE", "images": [{"data_url": picture_data_url(), "alt": "Archive"}],
    }
    created = client.post("/catalog/items", json=payload)
    assert created.status_code == 201
    item_id = created.json()["id"]
    image_url = created.json()["images"][0]["url"]
    try:
        with monkeypatch.context() as patch:
            patch.setattr(api_main, "remove_item_pictures", lambda _item_id: (_ for _ in ()).throw(OSError("busy")))
            assert client.delete(f"/catalog/items/{item_id}").status_code == 204
        assert client.get(image_url).status_code == 404
        assert (asset_root() / item_id).exists()
        assert client.delete(f"/catalog/items/{item_id}").status_code == 404
        assert not (asset_root() / item_id).exists()
    finally:
        shutil.rmtree(asset_root() / item_id, ignore_errors=True)
        with SessionLocal() as session:
            record = session.get(FurnitureItemRecord, item_id)
            if record is not None:
                session.delete(record)
                session.commit()


def test_website_import_rejects_private_hosts_before_fetching() -> None:
    response = client.post("/catalog/import-website", json={
        "source_url": "http://127.0.0.1/products", "page": "", "category_id": "storage",
        "subcategory": "Imported", "fixture_kind": "FURNITURE", "supplier": "Unsafe supplier",
        "fallback_name": "Fallback", "fallback_sku": "UNSAFE", "width_mm": 500, "depth_mm": 400,
        "height_mm": 600, "color_hex": "#112233", "plan_shape": "RECTANGLE",
    })
    assert response.status_code == 422
    assert "private" in response.json()["detail"]


def test_catalogue_source_rejects_malformed_port() -> None:
    try:
        api_main.resolve_public_catalogue_url("https://supplier.example:not-a-port/products")
        raise AssertionError("malformed port should be rejected")
    except api_main.HTTPException as error:
        assert error.status_code == 422
        assert "invalid port" in error.detail


def test_streaming_request_body_limit_rejects_chunked_body_without_trusting_content_length() -> None:
    called = False
    sent: list[dict[str, object]] = []
    incoming = iter([
        {"type": "http.request", "body": b"123456", "more_body": True},
        {"type": "http.request", "body": b"789012", "more_body": False},
    ])

    async def downstream(_scope, _receive, _send) -> None:
        nonlocal called
        called = True

    async def receive() -> dict[str, object]:
        return next(incoming)

    async def send(message: dict[str, object]) -> None:
        sent.append(message)

    scope = {
        "type": "http", "method": "POST", "path": "/catalog/items",
        "headers": [(b"content-length", b"1")],
    }
    asyncio.run(api_main.RequestBodyLimitMiddleware(downstream, default_limit=10)(scope, receive, send))
    assert not called
    assert sent[0]["status"] == 413


def test_catalogue_fetch_connects_to_the_validated_ip(monkeypatch) -> None:
    calls: list[object] = []

    class FakeResponse:
        status = 200
        def getheader(self, _name: str): return None
        def read(self, _limit: int): return b"catalogue"
        def close(self): pass

    class FakeConnection:
        def __init__(self, host: str, port: int, timeout: int): calls.append((host, port, timeout))
        def request(self, method: str, path: str, headers: dict[str, str]): calls.append((method, path, headers))
        def getresponse(self): return FakeResponse()

    monkeypatch.setattr(api_main.socket, "getaddrinfo", lambda *_args, **_kwargs: [(api_main.socket.AF_INET, api_main.socket.SOCK_STREAM, 6, "", ("93.184.216.34", 80))])
    monkeypatch.setattr(api_main.http.client, "HTTPConnection", FakeConnection)
    assert api_main.fetch_catalogue_page("http://supplier.example/products") == "catalogue"
    assert calls[0] == ("93.184.216.34", 80, 6)
    assert calls[1][2]["Host"] == "supplier.example"


def test_catalogue_fetch_revalidates_and_rejects_private_redirect(monkeypatch) -> None:
    class RedirectResponse:
        status = 302
        def getheader(self, _name: str): return "http://127.0.0.1/internal"
        def close(self): pass

    class FakeConnection:
        def __init__(self, _host: str, port: int, timeout: int): pass
        def request(self, _method: str, _path: str, headers: dict[str, str]): pass
        def getresponse(self): return RedirectResponse()

    def resolve(host: str, port: int, **_kwargs):
        address = "127.0.0.1" if host == "127.0.0.1" else "93.184.216.34"
        return [(api_main.socket.AF_INET, api_main.socket.SOCK_STREAM, 6, "", (address, port))]

    monkeypatch.setattr(api_main.socket, "getaddrinfo", resolve)
    monkeypatch.setattr(api_main.http.client, "HTTPConnection", FakeConnection)
    try:
        api_main.fetch_catalogue_page("http://supplier.example/products")
        raise AssertionError("private redirect should be rejected")
    except api_main.HTTPException as error:
        assert error.status_code == 422


def test_website_import_skips_malformed_and_duplicate_products_in_one_transaction(monkeypatch) -> None:
    suffix = uuid4().hex[:8]
    document = f'''<script type="application/ld+json">{{"@graph":[
      {{"@type":"Product","name":"Missing SKU"}},
      {{"@type":"Product","name":"Valid imported item","sku":"VALID-{suffix}"}},
      {{"@type":"Product","name":"Duplicate built in","sku":"RF-FU-600"}}
    ]}}</script>'''
    monkeypatch.setattr(api_main, "safe_catalogue_url", lambda _payload: "https://supplier.example/products")
    monkeypatch.setattr(api_main, "fetch_catalogue_page", lambda _url: document)
    response = client.post("/catalog/import-website", json={
        "source_url": "https://supplier.example", "page": "products", "category_id": "storage",
        "subcategory": "Imported", "fixture_kind": "FURNITURE", "supplier": "Renovation Fit",
        "fallback_name": "Fallback", "fallback_sku": f"FALLBACK-{suffix}", "width_mm": 500,
        "depth_mm": 400, "height_mm": 600, "color_hex": "#112233", "plan_shape": "RECTANGLE",
    })
    assert response.status_code == 200
    assert [item["sku"] for item in response.json()["imported"]] == [f"VALID-{suffix}"]
    assert any("missing valid" in reason for reason in response.json()["skipped"])
    assert any("already exists" in reason for reason in response.json()["skipped"])
    item_id = response.json()["imported"][0]["id"]
    client.delete(f"/catalog/items/{item_id}")
    with SessionLocal() as session:
        record = session.get(FurnitureItemRecord, item_id)
        if record is not None:
            session.delete(record)
            session.commit()


def test_person_clearance_visibility_is_visual_only() -> None:
    fixture = build_l_shaped_fixture()
    person = PersonMockup(center=Point2D(x=1200, y=900), movement_clearance_mm=300)
    visible = fixture.room.model_copy(update={"person_mockup": person.model_copy(update={"show_clearance": True})})
    hidden = fixture.room.model_copy(update={"person_mockup": person.model_copy(update={"show_clearance": False})})
    visible_result = client.post("/layout-checks", json=visible.model_dump(mode="json"))
    hidden_result = client.post("/layout-checks", json=hidden.model_dump(mode="json"))
    assert visible_result.status_code == hidden_result.status_code == 201
    assert visible_result.json()["checks"] == hidden_result.json()["checks"]


def test_room_validation_rejects_overlapping_openings_on_one_wall() -> None:
    fixture = build_l_shaped_fixture()
    door = next(opening for opening in fixture.room.openings if opening.kind is OpeningKind.DOOR)
    second = door.model_copy(update={"id": "door-002", "offset_mm": 500.0})
    room = fixture.room.model_copy(update={"openings": [door, second]})
    response = client.post("/rooms/validate", json=room.model_dump(mode="json"))
    assert response.status_code == 422
    assert "overlap on wall-001" in response.json()["detail"]
