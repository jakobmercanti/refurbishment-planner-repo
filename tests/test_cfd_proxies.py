import math
from collections import Counter, defaultdict
from itertools import combinations
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient
from pydantic import ValidationError
from shapely.geometry import Point, Polygon
from sqlalchemy import create_engine, select
from sqlalchemy.orm import Session, sessionmaker

from backend.app.main import app
from database.catalog import seed_catalogue_categories
from database.cfd_proxies import cfd_proxy_for, seed_cfd_proxies
from database.fixture_defaults import seed_fixture_defaults
from database.models import Base, FurnitureCategoryRecord, FurnitureItemRecord
from geometry.cfd import PROFILES, CfdProxySpec, build_cfd_mesh, cfd_stl


def union_volume(solids):
    """Independent inclusion-exclusion check, not the surface union algorithm."""
    total = 0
    for count in range(1, len(solids) + 1):
        for selected in combinations(solids, count):
            footprint = Polygon(selected[0].footprint)
            for solid in selected[1:]:
                footprint = footprint.intersection(Polygon(solid.footprint))
            volume = footprint.area * max(0, min(s.top for s in selected) - max(s.bottom for s in selected))
            total += volume * (-1 if count % 2 == 0 else 1)
    return total


@pytest.mark.parametrize("profile", PROFILES)
@pytest.mark.parametrize("dimensions", [(1200, 850, 950), (310, 2100, 425)])
def test_every_cfd_surface_is_closed_connected_outward_and_has_no_internal_faces(profile, dimensions):
    assert CfdProxySpec(profile=profile).profile == profile, "Every recipe must be valid in persisted references"
    mesh = build_cfd_mesh(profile, *dimensions)
    assert mesh == build_cfd_mesh(profile, *dimensions)
    assert isinstance(mesh.vertices_mm, tuple) and isinstance(mesh.triangles, tuple), "Cached geometry is immutable"
    assert mesh.units == "mm" and mesh.dimensions_mm == dimensions and mesh.geometry_revision == 2
    assert 12 <= len(mesh.triangles) <= 128, "Keep a bounded, low-detail surface"
    solids = PROFILES[profile].solids()
    points = [(x, y, z) for solid in solids for x, y in solid.footprint for z in (solid.bottom, solid.top)]
    for axis, size in enumerate(dimensions):
        assert min(v[axis] for v in mesh.vertices_mm) == pytest.approx(min(v[axis] for v in points) * size, abs=1e-5)
        assert max(v[axis] for v in mesh.vertices_mm) == pytest.approx(max(v[axis] for v in points) * size, abs=1e-5)
        assert min(v[axis] for v in mesh.vertices_mm) >= 0
        assert max(v[axis] for v in mesh.vertices_mm) <= size
    edges, directed, graph = Counter(), Counter(), defaultdict(set)
    volume = 0
    polygons = [Polygon(s.footprint) for s in solids]
    for triangle in mesh.triangles:
        assert len(set(triangle)) == 3
        a, b, c = [mesh.vertices_mm[index] for index in triangle]
        ab, ac = [b[i] - a[i] for i in range(3)], [c[i] - a[i] for i in range(3)]
        cross = [ab[(i + 1) % 3] * ac[(i + 2) % 3] - ab[(i + 2) % 3] * ac[(i + 1) % 3] for i in range(3)]
        area2 = math.sqrt(sum(v * v for v in cross))
        assert area2 > 1e-6, "No sliver/zero-area triangles"
        volume += sum(a[i] * (b[(i + 1) % 3] * c[(i + 2) % 3] - b[(i + 2) % 3] * c[(i + 1) % 3]) for i in range(3)) / 6
        centre = [sum(p[i] for p in (a, b, c)) / 3 / dimensions[i] for i in range(3)]
        normal = [value / area2 for value in cross]

        def inside(sign, centre=centre, normal=normal):
            sample = [centre[i] + sign * normal[i] * 1e-6 for i in range(3)]
            return any(
                s.bottom < sample[2] < s.top and polygon.contains(Point(sample[:2]))
                for s, polygon in zip(solids, polygons, strict=True)
            )

        assert inside(-1) and not inside(1), "Only external faces with outward winding"
        for u, v in zip(triangle, (*triangle[1:], triangle[0]), strict=True):
            edges[tuple(sorted((u, v)))] += 1
            directed[u, v] += 1
            graph[u].add(v)
    assert set(edges.values()) == {2}
    assert all(directed[v, u] == count for (u, v), count in directed.items())
    visited, pending = set(), [0]
    while pending:
        vertex = pending.pop()
        if vertex not in visited:
            visited.add(vertex)
            pending.extend(graph[vertex] - visited)
    assert len(visited) == len(mesh.vertices_mm), "One connected obstruction, no loose details"
    assert volume == pytest.approx(union_volume(solids) * math.prod(dimensions), rel=1e-8)


@pytest.mark.parametrize(
    "dimensions", [(0, 800, 900), (-1, 800, 900), (math.inf, 10, 10), (math.nan, 10, 10), (20_001, 5, 5)]
)
def test_cfd_rejects_unsafe_dimensions(dimensions):
    with pytest.raises(ValueError):
        build_cfd_mesh("block", *dimensions)


def test_profile_validation_exclusions_and_large_airflow_gaps():
    with pytest.raises(ValidationError):
        CfdProxySpec(profile="unknown")
    with pytest.raises(ValueError):
        build_cfd_mesh("unknown", 10, 10, 10)
    for category, kind, key in [
        ("electric", "FURNITURE", ""),
        ("storage", "FURNITURE", "electrical-socket-single"),
        ("doors-openings", "DOOR", "door-opening-arch"),
        ("windows", "WINDOW", "window-single-pane"),
        ("staircases-straight", "FURNITURE", "furniture-stair-straight"),
    ]:
        assert cfd_proxy_for(category, kind, key) is None
    for profile in ("table", "chair", "stool", "bed", "armchair", "basin", "toilet-wall"):
        assert not any(
            s.bottom < 0.05 < s.top and Polygon(s.footprint).contains(Point(0.5, 0.5))
            for s in PROFILES[profile].solids()
        )
    assert cfd_proxy_for("living-sofas", "FURNITURE", "furniture-sofa-corner-left-3")["profile"] == "sofa-left"


def mesh_contains(mesh, point):
    """Independent ray/triangle parity check of the exported, not recipe, surface."""
    direction = (0.731, 0.247, 1.0)

    def cross(a, b):
        return tuple(a[(i + 1) % 3] * b[(i + 2) % 3] - a[(i + 2) % 3] * b[(i + 1) % 3] for i in range(3))

    def dot(a, b):
        return sum(x * y for x, y in zip(a, b, strict=True))

    hits = set()
    for face in mesh.triangles:
        a, b, c = [mesh.vertices_mm[i] for i in face]
        ab, ac, origin = ([end[i] - a[i] for i in range(3)] for end in (b, c, point))
        p = cross(direction, ac)
        determinant = dot(ab, p)
        if abs(determinant) < 1e-12:
            continue
        u = dot(origin, p) / determinant
        q = cross(origin, ab)
        v = dot(direction, q) / determinant
        distance = dot(ac, q) / determinant
        if -1e-9 <= u <= 1 + 1e-9 and v >= -1e-9 and u + v <= 1 + 1e-9 and distance > 1e-9:
            hits.add(round(distance, 8))
    return len(hits) % 2 == 1


@pytest.mark.parametrize(
    "profile,point,blocked",
    [
        ("table", (0.5, 0.5, 0.4), False),
        ("table", (0.5, 0.5, 0.94), True),
        ("chair", (0.5, 0.1, 0.6), False),
        ("chair", (0.5, 0.1, 0.8), True),
        ("chair-open", (0.5, 0.08, 0.7), False),
        ("chair-open", (0.5, 0.08, 0.94), True),
        ("armchair", (0.5, 0.5, 0.15), False),
        ("armchair", (0.5, 0.5, 0.4), True),
        ("sofa", (0.5, 0.5, 0.15), False),
        ("sofa-left", (0.22, 0.7, 0.15), False),
        ("sofa-right", (0.78, 0.7, 0.15), False),
        ("sofa-left", (0.14, 0.85, 0.15), True),
        ("sofa-right", (0.85, 0.85, 0.15), True),
        ("bed", (0.5, 0.5, 0.04), False),
        ("bed", (0.5, 0.04, 0.04), True),
        ("bed", (0.5, 0.5, 0.12), True),
        ("sofa-left", (0.8, 0.8, 0.4), False),
        ("sofa-left", (0.2, 0.8, 0.4), True),
        ("sofa-right", (0.2, 0.8, 0.4), False),
        ("sofa-right", (0.8, 0.8, 0.4), True),
        ("basin", (0.5, 0.5, 0.4), False),
        ("basin", (0.5, 0.5, 0.8), True),
        ("basin-corner", (0.1, 0.1, 0.8), True),
        ("basin-corner", (0.9, 0.9, 0.8), False),
        ("toilet-wall", (0.5, 0.5, 0.15), False),
        ("toilet-wall", (0.5, 0.5, 0.6), True),
        ("toilet-low", (0.5, 0.5, 0.15), True),
        ("bath-oval", (0.05, 0.05, 0.4), False),
        ("bath-oval", (0.5, 0.5, 0.4), True),
        ("bath-raised", (0.5, 0.5, 0.1), False),
        ("bath-raised", (0.5, 0.5, 0.4), True),
        ("bath-corner", (0.95, 0.8, 0.4), True),
        ("bath-corner", (0.95, 0.1, 0.4), False),
        ("bath-corner", (0.05, 0.05, 0.4), True),
        ("shower-alcove", (0.5, 0.98, 0.5), True),
        ("shower-alcove", (0.02, 0.5, 0.5), False),
        ("shower-alcove", (0.5, 0.02, 0.5), False),
        ("shower-corner", (0.98, 0.5, 0.5), True),
        ("shower-corner", (0.5, 0.02, 0.5), False),
        ("shower-screen", (0.9, 0.98, 0.5), False),
        ("shower-screen", (0.3, 0.98, 0.5), True),
        ("shower-wet-room", (0.5, 0.98, 0.5), True),
        ("shower-wet-room", (0.1, 0.98, 0.5), False),
        ("shower-wet-room", (0.9, 0.98, 0.5), False),
        ("shower-enclosed", (0.5, 0.02, 0.5), True),
        ("shower-enclosed", (0.5, 0.5, 0.5), False),
        ("shower-quadrant", (0.98, 0.05, 0.5), True),
        ("shower-quadrant", (0.05, 0.98, 0.5), True),
        ("shower-quadrant", (0.1, 0.1, 0.5), False),
        ("shower-quadrant", (0.9, 0.9, 0.02), False),
        ("shower-quadrant", (0.1, 0.1, 0.02), True),
    ],
)
def test_major_airflow_paths_and_obstruction_orientation_survive_export(profile, point, blocked):
    assert mesh_contains(build_cfd_mesh(profile, 1, 1, 1), point) is blocked


@pytest.mark.parametrize(
    "kind,key,profile",
    [
        ("FURNITURE", "furniture-chair-classic", "chair-open"),
        ("FURNITURE", "furniture-chair-wishbone", "chair-open"),
        ("FURNITURE", "furniture-chair-ladder", "chair-open"),
        ("FURNITURE", "furniture-chair-crossback", "chair-open"),
        ("FURNITURE", "furniture-chair-modern", "chair"),
        ("FURNITURE", "furniture-armchair-scandi", "armchair"),
        ("FURNITURE", "furniture-bath-corner", "bath-corner"),
        ("FURNITURE", "furniture-bath-slipper", "bath-raised"),
        ("BASIN", "basin-corner", "basin-corner"),
        ("TOILET", "toilet-wall-mounted", "toilet-wall"),
        ("SHOWER", "shower-wet-room", "shower-wet-room"),
        ("SHOWER", "shower-freestanding", "shower-enclosed"),
        ("SHOWER", "shower-quadrant", "shower-quadrant"),
    ],
)
def test_specific_models_do_not_fall_back_to_incompatible_envelopes(kind, key, profile):
    assert cfd_proxy_for("custom", kind, key)["profile"] == profile


def test_seeding_audits_all_builtin_assets_without_changing_user_product_values():
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(engine)
    with Session(engine) as session:
        seed_catalogue_categories(session)
        session.flush()
        seed_fixture_defaults(session)
        session.flush()
        items = session.scalars(select(FurnitureItemRecord)).all()
        before = [(i.id, i.width_mm, i.depth_mm, i.height_mm, i.name, i.active, i.representation_key) for i in items]
        assert seed_cfd_proxies(session) > 0
        session.flush()
        assert seed_cfd_proxies(session) == 0
        for item in items:
            if item.cfd_proxy:
                spec = CfdProxySpec.model_validate(item.cfd_proxy)
                mesh = build_cfd_mesh(spec.profile, item.width_mm, item.depth_mm, item.height_mm)
                assert len(mesh.triangles) <= 128
            if item.fixture_kind in ("DOOR", "WINDOW"):
                assert item.cfd_proxy is None
        assert before == [
            (i.id, i.width_mm, i.depth_mm, i.height_mm, i.name, i.active, i.representation_key) for i in items
        ]


def test_cfd_catalogue_api_persists_spec_exports_mm_and_tracks_dimension_edits():
    client = TestClient(app)
    payload = dict(
        category_id="living-tables",
        fixture_kind="FURNITURE",
        name="CFD regression table",
        supplier="QA",
        sku=str(uuid4()),
        width_mm=1400,
        depth_mm=800,
        height_mm=750,
        color_hex="#AABBCC",
        representation_key="furniture-table-dining",
    )
    created = client.post("/catalog/items", json=payload)
    assert created.status_code == 201, created.text
    item = created.json()
    try:
        assert item["cfd_proxy"] == {"version": 1, "profile": "table"}
        response = client.get(f"/catalog/items/{item['id']}/cfd")
        assert response.status_code == 200
        assert response.json()["dimensions_mm"] == [1400, 800, 750]
        assert response.json()["geometry_revision"] == 2
        stl = client.get(f"/catalog/items/{item['id']}/cfd.stl")
        assert stl.status_code == 200 and "attachment" in stl.headers["content-disposition"]
        assert stl.text == cfd_stl(build_cfd_mesh("table", 1400, 800, 750))
        changed = client.put(f"/catalog/items/{item['id']}", json={**payload, "width_mm": 1800})
        assert changed.status_code == 200
        assert client.get(f"/catalog/items/{item['id']}/cfd").json()["dimensions_mm"] == [1800, 800, 750]
    finally:
        client.delete(f"/catalog/items/{item['id']}")
    assert client.get(f"/catalog/items/{item['id']}/cfd").status_code == 404
    assert client.get("/catalog/items/missing/cfd").status_code == 404
    for category in ("doors", "doors-openings", "windows", "electric"):
        entry = next(i for i in client.get("/catalog/items", params={"category_id": category}).json() if i["active"])
        assert entry["cfd_proxy"] is None
        assert client.get(f"/catalog/items/{entry['id']}/cfd").status_code == 404


def test_cfd_column_upgrade_is_additive_idempotent_and_preserves_custom_records(tmp_path, monkeypatch):
    import database.catalog as catalogue

    engine = create_engine(f"sqlite:///{(tmp_path / 'old-catalogue.sqlite3').as_posix()}")
    Base.metadata.create_all(engine)
    factory = sessionmaker(bind=engine, expire_on_commit=False)
    with factory() as session:
        session.add(FurnitureCategoryRecord(id="storage", name="My storage", default_side_clearance_mm=37))
        session.flush()
        session.add(
            FurnitureItemRecord(
                id="user-cfd-fixture",
                category_id="storage",
                fixture_kind="FURNITURE",
                name="Keep my custom table",
                supplier="User",
                sku="retain",
                width_mm=1234,
                depth_mm=567,
                height_mm=789,
                color_hex="#aabbcc",
                description="Keep my notes",
                representation_key="furniture-table-coffee",
                active=False,
            )
        )
        session.commit()
    with engine.begin() as connection:
        connection.exec_driver_sql("ALTER TABLE furniture_items DROP COLUMN cfd_proxy")
    monkeypatch.setattr(catalogue, "ENGINE", engine)
    monkeypatch.setattr(catalogue, "SessionLocal", factory)
    try:
        for _ in range(2):
            catalogue.initialise_catalogue()
            with factory() as session:
                item = session.get(FurnitureItemRecord, "user-cfd-fixture")
                assert item.cfd_proxy == {"version": 1, "profile": "table"}
                assert (
                    item.name,
                    item.width_mm,
                    item.depth_mm,
                    item.height_mm,
                    item.description,
                    item.color_hex,
                    item.active,
                ) == (
                    "Keep my custom table",
                    1234,
                    567,
                    789,
                    "Keep my notes",
                    "#aabbcc",
                    False,
                )
                assert session.get(FurnitureCategoryRecord, "storage").default_side_clearance_mm == 37
    finally:
        engine.dispose()
