from fastapi.testclient import TestClient
from sqlalchemy import create_engine, select
from sqlalchemy.orm import Session

from backend.app.main import app
from database.balustrade_defaults import seed_balustrade_defaults
from database.catalog import seed_catalogue_categories
from database.cfd_proxies import cfd_proxy_for, seed_cfd_proxies
from database.models import Base, FurnitureItemRecord
from geometry.balustrades import BALUSTRADE_STYLES, BalustradeConfiguration, balustrade_footprint
from geometry.cfd import build_cfd_mesh
from geometry.cfd_profiles import PROFILES


def test_balustrade_defaults_are_additive_idempotent_and_have_independent_cfd_profiles():
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(engine)
    try:
        with Session(engine) as session:
            seed_catalogue_categories(session)
            session.flush()
            assert seed_balustrade_defaults(session) == 5
            session.flush()
            assert seed_cfd_proxies(session) == 5
            session.flush()
            items = session.scalars(select(FurnitureItemRecord)).all()
            assert len(items) == 5
            items[0].name = "My custom guard"
            items[0].width_mm = 1234
            items[0].active = False
            session.flush()
            assert seed_balustrade_defaults(session) == 0
            assert seed_cfd_proxies(session) == 0
            assert (items[0].name, items[0].width_mm, items[0].active) == ("My custom guard", 1234, False)
            for item in items:
                assert item.category_id == "balustrades" and item.fixture_kind == "FURNITURE"
                mesh = build_cfd_mesh(item.cfd_proxy["profile"], item.width_mm, item.depth_mm, item.height_mm)
                assert 12 <= len(mesh.triangles) <= 100
    finally:
        engine.dispose()


def test_balustrade_catalogue_api_offers_all_styles_and_closed_mm_cfd_exports():
    client = TestClient(app)
    entries = client.get("/catalog/items", params={"category_id": "balustrades"}).json()
    assert {item["representation_key"] for item in entries} == {style["key"] for style in BALUSTRADE_STYLES}
    for item in entries:
        response = client.get(f"/catalog/items/{item['id']}/cfd")
        assert response.status_code == 200
        mesh = response.json()
        assert mesh["units"] == "mm"
        assert mesh["dimensions_mm"] == [item["width_mm"], item["depth_mm"], item["height_mm"]]
        assert len(mesh["triangles"]) <= 100
        stl = client.get(f"/catalog/items/{item['id']}/cfd.stl")
        assert stl.status_code == 200 and "catalogue_cfd_mm" in stl.text
        assert "Nominal single section" in " ".join(mesh["assumptions"])


def test_open_railing_cfd_keeps_large_passages_and_closed_panels_remain_sealed():
    from shapely.geometry import Point, Polygon

    def blocked(profile, x, y, z):
        return any(
            solid.bottom < z < solid.top and Polygon(solid.footprint).contains(Point(x, y))
            for solid in PROFILES[profile].solids()
        )

    assert not blocked("balustrade-open", 0.5, 0.5, 0.5)
    assert blocked("balustrade-open", 0.5, 0.5, 0.98)
    assert blocked("balustrade-rails", 0.5, 0.5, 0.5)
    assert not blocked("balustrade-rails", 0.5, 0.5, 0.25)
    assert blocked("balustrade-solid", 0.5, 0.5, 0.5)
    assert blocked("balustrade-glass", 0.5, 0.5, 0.5)
    assert not blocked("balustrade-glass", 0.5, 0.5, 0.05)
    assert cfd_proxy_for("balustrades", "FURNITURE", "balustrade-unknown") is None


def test_concave_guard_envelope_preserves_the_void_for_all_five_styles():
    from shapely.geometry import Polygon

    vertices = [
        {"x": x, "y": y}
        for x, y in [(1000, 1000), (3000, 1000), (3000, 2000), (2000, 2000), (2000, 4000), (1000, 4000)]
    ]
    void = Polygon([(point["x"], point["y"]) for point in vertices])
    for style in BALUSTRADE_STYLES:
        config = BalustradeConfiguration(enabled=True, style=style["id"], heightMm=1100, colour=style["colour"])
        guard = balustrade_footprint(vertices, config)
        assert guard.is_valid and guard.intersection(void).area < 0.001
