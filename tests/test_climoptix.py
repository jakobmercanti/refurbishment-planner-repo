import math
from copy import deepcopy
from datetime import UTC, datetime
from uuid import UUID, uuid4

import pytest
from fastapi.testclient import TestClient
from pydantic import ValidationError

from backend.app.climoptix_provider import PreparationOnlyProvider, UnsupportedProviderOperation
from backend.app.commercial_api import _validate_project
from geometry.climoptix_models import Scenario
from geometry.climoptix_scene import building_scene


@pytest.mark.parametrize(
    "profile,kind,connected",
    [(None, "DOOR", False), (None, "WINDOW", False), ("RECTANGULAR", "DOOR", True), ("ROUND_ARCH", "DOOR", True)],
)
def test_building_view_uses_kernel_connectivity_without_mutating_study(profile, kind, connected):
    p = project(True)
    opening = aperture(profile)
    opening["kind"] = kind
    p["rooms"][0]["openings"] = [opening]
    before = deepcopy(p)
    scene = building_scene(p)
    assert p == before
    assert scene["units"] == "mm"
    assert scene["airVolumes"] == ([["a", "b"]] if connected else [["a"], ["b"]])
    assert {patch["roomId"] for patch in scene["patches"]} == {"a", "b"}
    assert len(scene["triangles"]) == len(scene["trianglePatches"])
    assert all(0 <= index < len(scene["verticesMm"]) for triangle in scene["triangles"] for index in triangle)
    assert all(tag in {patch["id"] for patch in scene["patches"]} for tag in scene["trianglePatches"])


def test_building_view_covers_combined_roofs_without_flattening_them():
    p = building(project(True))
    p["building"]["roof"].update(roomRoofsEnabled=True, roomOverrides=[{"roomId": "a", "roof": roof("MONO")}])
    scene = building_scene(p)
    assert len(scene["rooms"]) == 2
    assert 3300 < max(vertex[2] for vertex in scene["verticesMm"]) < 3400  # Actual inset air face, not outer roof edge.
    p["rooms"] = []
    empty = building_scene(p)
    assert empty["airVolumes"] == empty["triangles"] == empty["rooms"] == []


def measured(value):
    return {"value": value, "verified": False, "uncertainty_mm": 0, "source_type": "USER_MEASURED"}


def room(rid="a", x=0):
    return {
        "id": rid,
        "name": rid.upper(),
        "version": 1,
        "vertices": [{"x": x, "y": 0}, {"x": x + 4000, "y": 0}, {"x": x + 4000, "y": 3000}, {"x": x, "y": 3000}],
        "wall_height": measured(2400),
        "wall_thickness": measured(100),
        "openings": [],
        "obstacles": [],
    }


def project(two=False):
    now = datetime.now(UTC).isoformat()
    return {
        "schemaVersion": 1,
        "projectId": str(uuid4()),
        "name": "CFD test",
        "units": "mm",
        "createdAt": now,
        "updatedAt": now,
        "generated": False,
        "rooms": [room(), *([room("b", 4000)] if two else [])],
        "floorplan": None,
        "assets": [],
        "assetInstances": [],
    }


def scenario(p):
    now = datetime.now(UTC)
    return Scenario(
        id="study",
        name="Study",
        sourceBuildingId=p["projectId"],
        createdAt=now,
        updatedAt=now,
        seed={"floorId": "floor-ground", "roomId": "a"},
    )


def aperture(profile=None, angle=90):
    return {
        "id": "opening",
        "kind": "DOOR",
        "parent_wall_id": "wall-002",
        "offset_mm": 1000,
        "width": measured(1000),
        "height": measured(2100),
        "sill_height_mm": 0,
        "swing_angle_deg": angle,
        **({"passage_profile": profile} if profile else {}),
    }


def prepare(p, s=None):
    return PreparationOnlyProvider().validate_scenario(p, s or scenario(p), "a" * 64)


def codes(report):
    return {d["code"] for d in report["diagnostics"] if d["severity"] == "error"}


def roof(kind="FLAT"):
    return {
        "type": kind,
        "lowHeightMm": 2400,
        "highHeightMm": 3400,
        "orientationDeg": 0,
        "splitFraction": 0.5,
        "thicknessMm": 180,
        "ceilingMode": "FOLLOWS_ROOF",
        "ceilingHeightMm": 2400,
    }


def building(p, kind="FLAT"):
    p["building"] = {
        "version": 1,
        "activeFloorId": "floor-ground",
        "floors": [
            {
                "id": "floor-ground",
                "name": "Ground",
                "elevationMm": 0,
                "heightMm": 2600,
                "slabThicknessMm": 200,
                "openings": [],
            }
        ],
        "roof": roof(kind),
    }
    return p


def test_single_room_closed_mm_skin_and_honest_provider():
    report = prepare(project())
    assert not codes(report)
    assert report["surface"]["closed"]
    assert report["domain"]["volumeM3"] == pytest.approx(28.8)
    assert report["caseGenerated"] is False and report["resultManifest"] is None
    assert report["provider"]["status"] == "notConnected"
    assert report["meshRecipe"]["kind"] == "meshIntent"
    assert report["meshRecipe"]["achievedQuality"] is None
    assert {p["kind"] for p in report["patches"]} == {"wall", "floor", "ceiling"}


@pytest.mark.parametrize("angle", [0, 1, 45, 90, 180])
@pytest.mark.parametrize("kind", ["DOOR", "WINDOW"])
def test_door_window_is_a_hard_stop_at_every_open_state(angle, kind):
    p = project(True)
    p["rooms"][0]["openings"] = [{**aperture(angle=angle), "kind": kind}]
    report = prepare(p)
    assert report["domain"]["includedRoomIds"] == ["a"]
    assert not report["domain"]["portals"][0]["traversed"]
    caps = [patch for patch in report["patches"] if patch["kind"] == kind.lower()]
    assert len(caps) == 1 and caps[0]["areaM2"] == pytest.approx(2.1)
    assert caps[0]["boundary"]["flow"]["type"] == ("opening" if angle > 0 else "noSlip")
    assert report["surface"]["closed"] and not codes(report)


@pytest.mark.parametrize("profile", ["RECTANGULAR", "ROUND_ARCH", "SEGMENTAL_ARCH", "CHAMFERED"])
def test_explicit_doorless_passage_traverses_and_retains_reveals(profile):
    p = project(True)
    p["rooms"][0]["openings"] = [aperture(profile)]
    report = prepare(p)
    assert report["domain"]["includedRoomIds"] == ["a", "b"]
    assert report["domain"]["portals"][0]["traversed"]
    assert not codes(report), report["diagnostics"]
    assert report["surface"]["closed"]
    if profile == "RECTANGULAR":
        assert report["domain"]["volumeM3"] == pytest.approx(57.09)
    assert not any(p["kind"] in ("door", "cap") for p in report["patches"])


def test_catalogue_semantics_not_missing_door_leaf_control_connectivity():
    p = project(True)
    o = aperture()
    o["metadata"] = {"representation_key": "door-opening-arch"}
    p["rooms"][0]["openings"] = [o]
    assert prepare(p)["domain"]["includedRoomIds"] == ["a", "b"]
    o["metadata"] = {"representation_key": "door-sliding-double", "leaf_visible": False}
    assert prepare(p)["domain"]["includedRoomIds"] == ["a"]


def test_adjacent_regions_stairs_and_narrow_gaps_do_not_create_connectivity():
    p = project(True)
    assert prepare(p)["domain"]["includedRoomIds"] == ["a"]
    p["rooms"][1] = room("b", 4001)
    p["rooms"][0]["openings"] = [aperture("RECTANGULAR")]
    assert prepare(p)["domain"]["includedRoomIds"] == ["a"]


def test_conflicting_mirrored_door_passage_stops_traversal():
    p = project(True)
    p["rooms"][0]["openings"] = [aperture("RECTANGULAR")]
    p["rooms"][1]["openings"] = [{**aperture(), "parent_wall_id": "wall-004"}]
    report = prepare(p)
    assert "conflicting-portal" in codes(report)
    assert report["domain"]["includedRoomIds"] == ["a"]
    assert not report["surface"]["exportable"]


@pytest.mark.parametrize("kind", ["FLAT", "MONO", "GABLE", "STEPPED"])
def test_internal_ceiling_profiles_have_closed_air_skins(kind):
    p = building(project(), kind)
    report = prepare(p)
    assert not codes(report), report["diagnostics"]
    assert report["surface"]["closed"]
    if kind in ("MONO", "STEPPED"):
        assert report["domain"]["volumeM3"] == pytest.approx(34.8)
    p["building"]["roof"]["ceilingMode"] = "FLAT"
    assert prepare(p)["domain"]["volumeM3"] == pytest.approx(28.8)


def test_room_roof_overrides_and_disabled_roof():
    p = building(project(True))
    p["building"]["roof"].update(roomRoofsEnabled=True, roomOverrides=[{"roomId": "a", "roof": roof("MONO")}])
    assert prepare(p)["domain"]["volumeM3"] == pytest.approx(34.8)
    p["building"]["roof"]["enabled"] = False
    assert "unbounded-ceiling" in codes(prepare(p))


def test_multifloor_void_is_a_real_connection_and_has_slab_sides():
    p = building(project())
    upper = {"rooms": [room("upper")], "floorplan": None, "assetInstances": []}
    p["building"]["floors"].append(
        {
            "id": "upper-floor",
            "name": "Upper",
            "elevationMm": 2600,
            "heightMm": 2600,
            "slabThicknessMm": 200,
            "content": upper,
            "openings": [],
        }
    )
    assert prepare(p)["domain"]["includedRoomIds"] == ["a"]
    p["building"]["floors"][1]["openings"] = [
        {
            "id": "void",
            "name": "Atrium",
            "shape": "RECTANGLE",
            "vertices": [
                {"x": 1000, "y": 1000},
                {"x": 2000, "y": 1000},
                {"x": 2000, "y": 2000},
                {"x": 1000, "y": 2000},
            ],
        }
    ]
    report = prepare(p)
    assert report["domain"]["includedRoomIds"] == ["a", "upper"]
    assert report["surface"]["closed"], report["diagnostics"]
    assert report["domain"]["volumeM3"] == pytest.approx(57.8)
    assert len([p for p in report["patches"] if p["kind"] == "slabSide"]) == 4
    scene = building_scene(p)
    assert scene["airVolumes"] == [["a", "upper"]]
    assert len([patch for patch in scene["patches"] if patch["kind"] == "slabSide"]) == 4


def test_concave_nonrectilinear_room_surface():
    p = project()
    p["rooms"][0]["vertices"] = [
        {"x": x, "y": y} for x, y in [(0, 0), (4000, 0), (4000, 1500), (2000, 1500), (1500, 3000), (0, 3000)]
    ]
    assert prepare(p)["surface"]["closed"]


@pytest.mark.parametrize(
    "key",
    [
        "furniture-table-dining",
        "furniture-chair-classic",
        "furniture-sofa-straight",
        "furniture-bed-double",
        "people-standing",
    ],
)
@pytest.mark.parametrize("rotation", [0, 33, 90])
def test_transformed_catalogue_proxies_and_floor_contacts_form_closed_fluid_skin(key, rotation):
    p = project()
    p["rooms"][0]["obstacles"] = [
        {
            "id": "object",
            "name": "Test object",
            "fixture_kind": "FURNITURE",
            "representation_key": key,
            "center": {"x": 2000, "y": 1500},
            "rotation_deg": rotation,
            "base_z_mm": 0,
            "dimensions": {
                k: measured(v) for k, v in zip(("width", "depth", "height"), (1000, 700, 1000), strict=True)
            },
        }
    ]
    report = prepare(p)
    assert not codes(report), report["diagnostics"]
    assert report["surface"]["closed"]
    assert 0 < report["domain"]["volumeM3"] < 28.8
    assert len(report["objects"]) == 1


def test_actual_door_model_with_a_passage_flag_still_stops():
    p = project(True)
    opening = aperture("RECTANGULAR")
    opening["metadata"] = {"representation_key": "door-single"}
    p["rooms"][0]["openings"] = [opening]
    report = prepare(p)
    assert "door-passage-conflict" in codes(report)
    assert report["domain"]["includedRoomIds"] == ["a"]


def test_overlapping_apertures_are_ambiguous_and_not_traversed():
    p = project(True)
    p["rooms"][0]["openings"] = [aperture("RECTANGULAR"), {**aperture("ROUND_ARCH"), "id": "second", "offset_mm": 1200}]
    report = prepare(p)
    assert "overlapping-apertures" in codes(report)
    assert report["domain"]["includedRoomIds"] == ["a"]


def test_missing_seed_does_not_generate_a_valid_domain():
    p = project()
    s = scenario(p)
    s.seed = None
    report = prepare(p, s)
    assert {"missing-seed", "non-manifold-skin"} <= codes(report)
    assert report["domain"]["includedRoomIds"] == []
    assert not report["surface"]["exportable"]


def test_imported_visual_model_requires_explicit_exclusion():
    p = project()
    p["assetInstances"] = [
        {"instanceId": "visual-instance", "assetId": "asset", "positionMm": {"x": 2000, "y": 0, "z": -1500}}
    ]
    report = prepare(p)
    assert "imported-asset-adapter-pending" in codes(report)
    data = scenario(p).model_dump()
    data["assetOverrides"] = [{"objectId": "visual-instance", "mode": "none"}]
    assert "imported-asset-adapter-pending" not in codes(prepare(p, Scenario.model_validate(data)))


def test_vent_host_area_flow_and_actual_partitioned_patch():
    p = project()
    s = scenario(p)
    data = s.model_dump()
    data["vents"] = [
        {
            "id": "vent",
            "name": "Supply",
            "role": "supply",
            "shape": "circle",
            "host": {"patchId": "floor-ground:a:ceiling:0", "u": 0.4, "v": 0.5},
            "diameterMm": 200,
            "openAreaFraction": 0.6,
            "control": "velocity",
            "valueSI": 2,
        }
    ]  # validated below
    s = Scenario.model_validate(data)
    report = prepare(p, s)
    assert not codes(report), report["diagnostics"]
    v = report["vents"][0]
    assert v["actualAreaM2"] == pytest.approx(math.pi * 0.1**2)
    assert v["effectiveAreaM2"] == pytest.approx(math.pi * 0.1**2 * 0.6)
    assert v["volumeFlowM3S"] == pytest.approx(v["effectiveAreaM2"] * 2)
    assert report["surface"]["closed"]


@pytest.mark.parametrize("u,code", [(0, "vent-outside-host"), (0.5, "vent-spacing")])
def test_vent_edges_and_overlap_are_rejected(u, code):
    p = project()
    data = scenario(p).model_dump()
    data["vents"] = [
        {"id": "one", "name": "Supply", "role": "supply", "host": {"patchId": "floor-ground:a:ceiling:0", "u": u}},
        {"id": "two", "name": "Extract", "role": "extract", "host": {"patchId": "floor-ground:a:ceiling:0", "u": 0.6}},
    ]
    report = prepare(p, Scenario.model_validate(data))
    assert code in codes(report)
    assert not report["surface"]["exportable"]


def test_source_geometry_hash_ignores_active_floor_camera_and_names_but_tracks_changes():
    p = building(project())
    first = prepare(p)["validation"]["sourceHash"]
    p["renderCamera"] = {"anything": "view-only"}
    p["rooms"][0]["name"] = "Renamed"
    assert prepare(p)["validation"]["sourceHash"] == first
    p["building"]["roof"]["lowHeightMm"] = 2500
    assert prepare(p)["validation"]["sourceHash"] != first


def test_incompatible_physics_and_mesh_are_rejected():
    data = scenario(project()).model_dump()
    for field, values in [
        ("physics", {"boussinesq": True, "energy": False}),
        ("mesh", {"baseCellMm": 1000, "maxCellMm": 100}),
        ("mesh", {"baseCellMm": float("nan")}),
    ]:
        changed = deepcopy(data)
        changed[field].update(values)
        with pytest.raises(ValidationError):
            Scenario.model_validate(changed)


def test_persistence_rejects_future_versions_duplicates_and_wrong_project():
    p = project()
    p["cfdScenarios"] = [scenario(p).model_dump(mode="json")]
    _validate_project(p, UUID(p["projectId"]))
    p["cfdScenarios"][0]["version"] = 2
    with pytest.raises(Exception, match="Invalid Climoptix"):
        _validate_project(p, UUID(p["projectId"]))


def test_provider_has_no_executable_job_operations():
    provider = PreparationOnlyProvider()
    for operation in (provider.generate_case, provider.submit_mesh, provider.submit_run):
        with pytest.raises(UnsupportedProviderOperation):
            operation(scenario(project()))
    for operation in (provider.get_job_status, provider.cancel_job, provider.get_result_manifest):
        with pytest.raises(UnsupportedProviderOperation):
            operation("not-a-job")


def test_preparation_api_is_stateless_and_solver_routes_do_not_exist():
    from backend.app.main import app

    p = project()
    client = TestClient(app)
    assert client.get("/climoptix/capabilities").json()["canRun"] is False
    response = client.post(
        "/climoptix/prepare",
        json={"project": p, "scenario": scenario(p).model_dump(mode="json"), "clientRevision": "a" * 64},
    )
    assert response.status_code == 200, response.text
    assert response.json()["surface"]["closed"]
    assert client.post("/climoptix/run", json={"command": "anything"}).status_code == 404


def test_building_view_api_needs_no_study_and_rejects_bad_geometry_or_extra_fields():
    from backend.app.main import app

    client = TestClient(app)
    p = project(True)
    before = deepcopy(p)
    response = client.post("/climoptix/geometry", json={"project": p})
    assert response.status_code == 200, response.text
    assert response.json()["airVolumes"] == [["a"], ["b"]]
    assert {patch["roomId"] for patch in response.json()["patches"]} == {"a", "b"}
    assert p == before
    assert client.post("/climoptix/geometry", json={"project": p, "scenario": {}}).status_code == 422
    p["rooms"][0]["vertices"] = [{"x": 0, "y": 0}] * 3
    assert client.post("/climoptix/geometry", json={"project": p}).status_code == 422


@pytest.mark.parametrize("body", ['{"x":NaN}', '{"x":Infinity}', '{"x":1e999}', "[" * 10000 + "]" * 10000])
@pytest.mark.parametrize("operation", ["geometry", "thermal-envelope", "thermal-preview", "thermal-epw"])
def test_view_and_thermal_json_guard_rejects_nonfinite_values_and_deep_nesting(body, operation):
    from backend.app.main import app

    response = TestClient(app).post(
        f"/climoptix/{operation}", content=body, headers={"Content-Type": "application/json"}
    )
    assert response.status_code == 422


@pytest.mark.parametrize("operation", ["geometry", "thermal-envelope", "thermal-preview", "thermal-epw"])
def test_view_and_thermal_bodies_are_bounded_before_project_parsing(operation):
    from backend.app.main import app

    response = TestClient(app).post(f"/climoptix/{operation}", content=" " * (4 * 1024 * 1024 + 1))
    assert response.status_code == 413


def source_runs(p, stable=False):
    p["floorplan"] = {
        "walls": [
            {
                "id": "outline-" + r["id"],
                "points": deepcopy([*r["vertices"], r["vertices"][0]]),
                "cornerNumbers": {str(i): i + 1 for i in range(len(r["vertices"]))} if stable else {},
            }
            for r in p["rooms"]
        ]
    }
    return p


def wall_patch(report, normal):
    return next(p for p in report["patches"] if p["kind"] == "wall" and tuple(p["normal"]) == normal)


def test_wall_conditions_follow_physical_edges_not_vertex_indices():
    p = project()
    original = wall_patch(prepare(p), (0, -1, 0))["id"]
    data = scenario(p).model_dump()
    data["boundaries"]["patches"][original] = {"flow": {"type": "slip"}}
    s = Scenario.model_validate(data)
    vertices = p["rooms"][0]["vertices"]
    p["rooms"][0]["vertices"] = vertices[1:] + vertices[:1]
    report = prepare(p, s)
    assert wall_patch(report, (0, -1, 0))["id"] == original
    assert wall_patch(report, (0, -1, 0))["boundary"]["flow"]["type"] == "slip"
    for point in p["rooms"][0]["vertices"]:
        point["y"] += 100
    report = prepare(p, s)
    assert any(d["code"] == "orphan-boundary" for d in report["diagnostics"])
    assert all(p["boundary"]["flow"]["type"] != "slip" for p in report["patches"])


@pytest.mark.parametrize("closing_entry", [False, True])
def test_stable_source_corners_keep_closing_wall_host_through_moves_and_run_reversal(closing_entry):
    p = source_runs(project(), stable=True)
    if closing_entry:
        p["floorplan"]["walls"][0]["cornerNumbers"]["4"] = 1
    patch = wall_patch(prepare(p), (-1, 0, 0))
    data = scenario(p).model_dump()
    data["vents"] = [{"id": "vent", "name": "Supply", "role": "supply", "host": {"patchId": patch["id"]}}]
    s = Scenario.model_validate(data)
    before = prepare(p, s)
    for point in p["rooms"][0]["vertices"]:
        point["x"] += 200
        point["y"] += 100
    run = p["floorplan"]["walls"][0]
    run["points"] = deepcopy([*p["rooms"][0]["vertices"], p["rooms"][0]["vertices"][0]])
    run["points"].reverse()
    run["cornerNumbers"] = {"0": 1, "1": 4, "2": 3, "3": 2}
    report = prepare(p, s)
    assert not codes(report), report["diagnostics"]
    assert report["surface"]["closed"]
    assert wall_patch(report, (-1, 0, 0))["id"] == patch["id"]
    assert report["vents"][0]["centerMm"] == pytest.approx(
        [a + b for a, b in zip(before["vents"][0]["centerMm"], [200, 100, 0], strict=True)]
    )


def test_ceiling_partition_change_orphans_old_host_instead_of_retargeting_a_facet():
    p = building(project())
    data = scenario(p).model_dump()
    data["vents"] = [
        {"id": "vent", "name": "Supply", "role": "supply", "host": {"patchId": "floor-ground:a:ceiling:0"}}
    ]
    s = Scenario.model_validate(data)
    assert not codes(prepare(p, s))
    p["building"]["roof"]["type"] = "GABLE"
    report = prepare(p, s)
    assert "missing-vent-host" in codes(report)
    assert not report["surface"]["exportable"]


def test_partial_internal_walls_and_missing_source_walls_cannot_disappear_from_a_valid_export():
    p = source_runs(project())
    p["floorplan"]["walls"].append({"id": "partial", "points": [{"x": 1500, "y": 0}, {"x": 1500, "y": 1000}]})
    report = prepare(p)
    assert "unmapped-internal-wall" in codes(report)
    assert not report["surface"]["exportable"]
    p["floorplan"]["walls"] = p["floorplan"]["walls"][:1]
    p["floorplan"]["walls"][0]["points"] = p["floorplan"]["walls"][0]["points"][:-1]
    assert "missing-source-wall" in codes(prepare(p))


def test_outside_domain_partial_wall_is_context_information_not_a_blocker():
    p = source_runs(project(True))
    p["floorplan"]["walls"].append({"id": "partial", "points": [{"x": 5500, "y": 0}, {"x": 5500, "y": 1000}]})
    report = prepare(p)
    assert not codes(report), report["diagnostics"]
    assert report["surface"]["exportable"]
    assert next(d for d in report["diagnostics"] if d["code"] == "unmapped-internal-wall")["severity"] == "info"


def obstruction(oid="object", key="furniture-table-rectangular", size=(1000, 700, 1000)):
    return {
        "id": oid,
        "name": oid,
        "fixture_kind": "FURNITURE",
        "representation_key": key,
        "center": {"x": 2000, "y": 1500},
        "base_z_mm": 0,
        "rotation_deg": 0,
        "dimensions": {k: measured(v) for k, v in zip(("width", "depth", "height"), size, strict=True)},
    }


def test_excluded_objects_retain_inputs_but_emit_nothing_and_source_offsets_are_checked():
    p = project()
    p["rooms"][0]["obstacles"] = [obstruction()]
    data = scenario(p).model_dump()
    data["assetOverrides"] = [{"objectId": "object", "mode": "none", "heatW": 75, "co2M3S": 1e-5}]
    report = prepare(p, Scenario.model_validate(data))
    assert not codes(report), report["diagnostics"]
    assert report["objects"][0]["heatW"] == report["objects"][0]["co2M3S"] == 0
    data["assetOverrides"] = [{"objectId": "object", "mode": "sourceOnly", "offsetMm": [5000, 0, 0]}]
    assert "source-outside-domain" in codes(prepare(p, Scenario.model_validate(data)))


def test_overlapping_object_bounds_with_real_under_table_gap_are_not_solid_collisions():
    p = project()
    p["rooms"][0]["obstacles"] = [obstruction(), obstruction("small", "measured-block", (200, 200, 200))]
    report = prepare(p)
    # An explicit solid treatment permits a reviewed conservative box fallback.
    data = scenario(p).model_dump()
    data["assetOverrides"] = [{"objectId": "small", "mode": "solidProxy"}]
    report = prepare(p, Scenario.model_validate(data))
    assert not codes(report), report["diagnostics"]
    assert report["surface"]["closed"] and report["surface"]["exportable"]
    assert report["objects"][1]["profile"] == "block"


@pytest.mark.parametrize(
    "change",
    [
        {"version": True},
        {"name": "   "},
        {"createdAt": "2026-10-20T10:00:00"},
        {"physics": {"energy": "false"}},
        {"physics": {"energy": 0}},
        {"physics": {"densityKgM3": "1.2"}},
        {"physics": {"gravityMS2": [True, 0, -9.81]}},
        {"assetOverrides": [{"objectId": "x", "heatW": 10, "temperatureK": 300}]},
        {"assetOverrides": [{"objectId": "x", "mode": "sourceOnly", "temperatureK": 300}]},
    ],
)
def test_contract_does_not_coerce_ambiguous_json_or_conflicting_thermal_controls(change):
    data = scenario(project()).model_dump()
    data.update(change)
    with pytest.raises(ValidationError):
        Scenario.model_validate(data)


@pytest.mark.parametrize("body", ['{"value":NaN}', '{"value":Infinity}', '{"value":1e999}', "[" * 10000 + "]" * 10000])
def test_nonfinite_or_deep_json_is_rejected_without_a_server_error(body):
    from backend.app.main import app

    response = TestClient(app).post("/climoptix/prepare", content=body, headers={"Content-Type": "application/json"})
    assert response.status_code == 422
    assert "valid JSON" in response.json()["detail"]


@pytest.mark.parametrize("case", ["cell-underflow", "cell-overflow", "area-underflow"])
def test_finite_extreme_inputs_are_rejected_before_numerical_estimates_or_flow_division(case):
    from backend.app.main import app

    p = project()
    data = scenario(p).model_dump(mode="json")
    if case.startswith("cell"):
        value = 1e-150 if case == "cell-underflow" else 1e100
        data["mesh"].update(baseCellMm=value, minCellMm=min(value, 25), maxCellMm=max(value, 400))
    else:
        data["vents"] = [
            {
                "id": "vent",
                "name": "Supply",
                "role": "supply",
                "openAreaFraction": 1e-320,
                "host": {"patchId": "floor-ground:a:ceiling:0"},
            }
        ]
    response = TestClient(app).post(
        "/climoptix/prepare", json={"project": p, "scenario": data, "clientRevision": "a" * 64}
    )
    assert response.status_code == 422, response.text


@pytest.mark.parametrize(
    "name", ["connected-passages", "open-door-stop", "two-floor-atrium", "sloping-office", "office-occupants"]
)
def test_portable_examples_pass_real_api_and_preserve_preparation_only_contract(name):
    from backend.app.main import app
    from scripts.audit_climoptix import example_projects

    p = example_projects()[name]
    response = TestClient(app).post(
        "/climoptix/prepare",
        json={
            "project": p,
            "scenario": p["cfdScenarios"][0],
            "clientRevision": "a" * 64,
        },
    )
    assert response.status_code == 200, response.text
    result = response.json()
    assert not codes(result), result["diagnostics"]
    assert result["surface"]["closed"] and result["surface"]["exportable"]
    assert result["caseGenerated"] is False and result["resultManifest"] is None


def test_domain_bounds_are_measured_mm_and_thermal_dependencies_are_explicit():
    p = project()
    report = prepare(p)
    assert report["domain"]["floorIds"] == ["floor-ground"]
    assert report["domain"]["boundsMm"] == [[0, 0, 0], [4000, 3000, 2400]]
    data = scenario(p).model_dump()
    data["boundaries"]["groups"]["wall"] = {"thermal": {"type": "temperature", "value": 295}}
    assert "thermal-bc-needs-energy" in codes(prepare(p, Scenario.model_validate(data)))
    data["physics"]["energy"] = True
    assert "thermal-bc-needs-energy" not in codes(prepare(p, Scenario.model_validate(data)))


def test_isothermal_devices_retain_inactive_inputs_without_assigning_nonexistent_transport_equations():
    p = project()
    data = scenario(p).model_dump()
    data["vents"] = [
        {
            "id": "vent",
            "name": "Supply",
            "role": "supply",
            "temperatureK": 300,
            "co2Ppm": 800,
            "host": {"patchId": "floor-ground:a:ceiling:0"},
        }
    ]
    report = prepare(p, Scenario.model_validate(data))
    assert not codes(report), report["diagnostics"]
    boundary = next(p["boundary"] for p in report["patches"] if p["kind"] == "supply")
    assert boundary["thermal"]["type"] == "adiabatic" and boundary["scalarType"] == "zeroFlux"
    data["physics"].update(energy=True, co2=True)
    report = prepare(p, Scenario.model_validate(data))
    boundary = next(p["boundary"] for p in report["patches"] if p["kind"] == "supply")
    assert boundary["thermal"]["value"] == 300 and boundary["scalarPpm"] == 800
    assert boundary["thermal"]["type"] == "temperature" and boundary["scalarType"] == "concentration"


def test_solid_heat_power_is_conserved_over_exposed_area_and_cannot_conflict_with_temperature():
    p = project()
    p["rooms"][0]["obstacles"] = [obstruction()]
    data = scenario(p).model_dump()
    data["physics"]["energy"] = True
    data["assetOverrides"] = [{"objectId": "object", "heatW": 75, "count": 2}]
    report = prepare(p, Scenario.model_validate(data))
    assert not codes(report), report["diagnostics"]
    patch = next(p for p in report["patches"] if p["kind"] == "object")
    assert patch["boundary"]["thermal"]["type"] == "heatFlux"
    assert patch["boundary"]["thermal"]["value"] * patch["areaM2"] == pytest.approx(150)
    assert patch["boundaryOrigin"] == "asset power / exposed surface"
    data["boundaries"]["patches"][patch["id"]] = {"thermal": {"type": "temperature", "value": 300}}
    assert "object-thermal-conflict" in codes(prepare(p, Scenario.model_validate(data)))
    data["boundaries"]["patches"] = {}
    data["assetOverrides"][0].update(mode="sourceOnly")
    report = prepare(p, Scenario.model_validate(data))
    assert not any(p["kind"] == "object" for p in report["patches"])
    assert report["objects"][0]["heatW"] == 150


def test_staged_source_models_are_labelled_and_invalid_refinements_block_export():
    p = project()
    p["rooms"][0]["obstacles"] = [obstruction()]
    data = scenario(p).model_dump()
    data["assetOverrides"] = [{"objectId": "object", "schedule": "office hours", "radiantFraction": 0.3}]
    data["mesh"]["refinements"] = [
        {"id": "missing", "name": "Missing", "shape": "object", "objectId": "deleted"},
        {"id": "sphere", "name": "Sphere", "shape": "sphere", "sizeMm": [100, 200, 100], "cellMm": 1000},
    ]
    report = prepare(p, Scenario.model_validate(data))
    assert {"missing-refinement-object", "invalid-sphere-refinement", "refinement-cell-range"} <= codes(report)
    assert any(d["code"] == "future-source-model" and d["severity"] == "warning" for d in report["diagnostics"])
    assert not report["surface"]["exportable"]


@pytest.mark.parametrize(
    "vertices",
    [
        [(0, 0), (5000, 0), (5000, 1800), (2000, 1800), (2000, 4000), (0, 4000)],
        [(0, 0), (6000, 0), (6000, 1500), (4000, 1500), (4000, 4500), (2000, 4500), (2000, 1500), (0, 1500)],
        [(0, 0), (5000, 0), (5000, 4000), (3500, 4000), (3500, 1500), (1500, 1500), (1500, 4000), (0, 4000)],
    ],
)
@pytest.mark.parametrize("kind", ["FLAT", "MONO", "GABLE", "STEPPED"])
def test_l_t_u_footprints_have_closed_interior_skins_with_rotated_roof_frames(vertices, kind):
    p = building(project(), kind)
    p["rooms"][0]["vertices"] = [{"x": x, "y": y} for x, y in vertices]
    p["building"]["roof"]["orientationDeg"] = 37
    report = prepare(p)
    assert not codes(report), report["diagnostics"]
    assert report["surface"]["closed"] and report["surface"]["volumeM3"] > 0


def test_sampling_plane_settings_are_interior_and_deterministic_in_source_frame():
    from geometry.climoptix_models import PostProcessing
    from geometry.climoptix_workflow import sampling_planes

    post = PostProcessing(x={"enabled": True, "count": 2}, y={"enabled": True, "count": 1})
    planes = sampling_planes([[100, 200, 300], [3100, 2200, 4300]], post)
    assert [p["id"] for p in planes] == ["slice_x_001", "slice_x_002", "slice_y_001",
                                       "slice_z_001", "slice_z_002", "slice_z_003"]
    assert planes[0]["pointMm"] == [1100, 1200, 2300]
    assert planes[1]["pointMm"] == [2100, 1200, 2300]
    assert planes[2]["normal"] == [0, 1, 0]


@pytest.mark.parametrize("invalid", [0, 101, 1.5, True, "3"])
def test_slice_counts_reject_out_of_range_fractional_and_coerced_values(invalid):
    data = scenario(project()).model_dump(mode="json")
    data["postProcessing"]["x"]["count"] = invalid
    with pytest.raises(ValidationError):
        Scenario.model_validate(data)


def test_snappy_refinement_levels_use_base_halving_and_validate_the_effective_cell():
    from geometry.climoptix_workflow import refinement_cell_mm, refinement_level

    p = project()
    data = scenario(p).model_dump(mode="json")
    data["mesh"]["minCellMm"] = 1
    data["mesh"]["refinements"] = [{"id": "zone", "name": "Zone", "level": 5, "cellMm": 100}]
    s = Scenario.model_validate(data)
    assert refinement_level(s.mesh, s.mesh.refinements[0]) == 5
    assert refinement_cell_mm(s.mesh, s.mesh.refinements[0]) == 6.25
    assert "refinement-cell-range" not in codes(prepare(p, s))
    data["mesh"]["refinements"][0]["level"] = 10
    assert "refinement-cell-range" in codes(prepare(p, Scenario.model_validate(data)))
    data["mesh"]["refinements"][0].pop("level")
    data["mesh"]["refinements"][0]["cellMm"] = 70
    legacy = Scenario.model_validate(data)
    assert refinement_level(legacy.mesh, legacy.mesh.refinements[0]) == 2
    assert legacy.mesh.refinements[0].level is None
    for invalid in [True, "3", 1.5, 11, -1]:
        data["mesh"]["refinements"][0]["level"] = invalid
        with pytest.raises(ValidationError):
            Scenario.model_validate(data)


def test_post_fields_reject_duplicate_empty_and_inactive_transport_requests():
    p = project()
    data = scenario(p).model_dump(mode="json")
    for fields in [[], ["U", "U"], ["arbitraryCode"]]:
        data["postProcessing"]["fields"] = fields
        with pytest.raises(ValidationError):
            Scenario.model_validate(data)
    data["postProcessing"]["fields"] = ["T", "CO2"]
    assert "inactive-slice-field" in codes(prepare(p, Scenario.model_validate(data)))


@pytest.mark.parametrize("mode", ["steady", "transient"])
def test_foamlib_settings_zip_roundtrips_levels_cores_run_control_and_sampling(mode):
    import io
    import json
    from zipfile import ZipFile

    foamlib = pytest.importorskip("foamlib")
    from backend.app.climoptix_foamlib import settings_package

    p = project()
    data = scenario(p).model_dump(mode="json")
    data["physics"]["mode"] = mode
    data["physics"]["numerics"]["writeEveryIterations"] = 37
    data["resources"]["cpu"] = 8
    data["mesh"]["minCellMm"] = 5
    data["mesh"]["refinements"] = [{"id": "zone", "name": "Box; #codeStream", "level": 4,
                                     "centerMm": [1000, 1000, 1000], "sizeMm": [1000, 800, 600]}]
    data["postProcessing"]["x"] = {"enabled": True, "count": 2}
    s = Scenario.model_validate(data)
    report = prepare(p, s)
    assert report["surface"]["exportable"], report["diagnostics"]
    with ZipFile(io.BytesIO(settings_package(s, report))) as archive:
        manifest = json.loads(archive.read("manifest.json"))
        assert manifest["runnable"] is False
        assert manifest["refinements"][0]["level"] == 4
        assert len(manifest["samplingPlanes"]) == 5
        assert manifest["validation"]["sourceHash"] == report["validation"]["sourceHash"]
        assert not any("Allrun" in name or ".." in name for name in archive.namelist())
        snappy_bytes = archive.read("settings/system/snappyHexMeshDict")
        assert b"codeStream" not in snappy_bytes
        snappy = foamlib.FoamFile.loads(snappy_bytes)
        assert list(snappy["geometry"]["refinement_001"]["min"]) == [0.5, 0.6, 0.7]
        assert int(snappy["castellatedMeshControls"]["refinementRegions"]["refinement_001"]["levels"][0][1]) == 4
        decomposition = foamlib.FoamFile.loads(archive.read("settings/system/decomposeParDict"))
        assert decomposition["numberOfSubdomains"] == 8
        control = foamlib.FoamFile.loads(archive.read("settings/system/controlDict"))
        assert control["endTime"] == (1000 if mode == "steady" else 600)
        assert control["writeInterval"] == (37 if mode == "steady" else 10)
        assert control["application"] == ("simpleFoam" if mode == "steady" else "pimpleFoam")
        assert control["functions"]["solverInfo"]["type"] == "solverInfo"
        plane = control["functions"]["climoptixSlices"]["surfaces"]["slice_x_001"]
        assert plane["type"] == "cuttingPlane"
        assert float(plane["point"][0]) == pytest.approx(manifest["samplingPlanes"][0]["pointMm"][0] / 1000)
        assert json.loads(archive.read("scenario.json"))["postProcessing"] == s.postProcessing.model_dump()


def test_openfoam_settings_endpoint_revalidates_and_remains_non_executable():
    pytest.importorskip("foamlib")
    from backend.app.main import app

    p = project()
    client = TestClient(app)
    request = {"project": p, "scenario": scenario(p).model_dump(mode="json"), "clientRevision": "a" * 64}
    response = client.post("/climoptix/openfoam-settings", json=request)
    assert response.status_code == 200, response.text
    assert response.headers["content-type"] == "application/zip"
    request["scenario"]["seed"]["roomId"] = "missing"
    assert client.post("/climoptix/openfoam-settings", json=request).status_code == 422
    assert client.post("/climoptix/openfoam-settings", content='{"value": 1e999}').status_code == 422
    assert client.post("/climoptix/run", json={}).status_code == 404


def test_custom_refinement_rounding_cannot_cross_the_global_minimum():
    from geometry.climoptix_models import Refinement

    p = project()
    s = scenario(p)
    s.mesh.minCellMm = 60
    for name in ("ventCellMm", "jetCellMm", "openingCellMm", "objectCellMm", "wakeCellMm", "wallCellMm"):
        setattr(s.mesh, name, 70)
    s.mesh.refinements = [Refinement(id="rounded", name="Rounded target", cellMm=70)]
    report = prepare(p, s)
    assert "refinement-cell-range" in codes(report), "70 mm rounds to level 2 / 50 mm, below the 60 mm minimum"
    assert not report["surface"]["exportable"]


@pytest.mark.parametrize("target", [1e-310, 5e-324])
def test_extreme_positive_refinement_targets_report_diagnostics_instead_of_crashing(target):
    from geometry.climoptix_models import Refinement

    p = project()
    s = scenario(p)
    s.mesh.refinements = [Refinement(id="small", name="Tiny target", cellMm=target)]
    report = prepare(p, s)
    assert {"refinement-cell-range", "refinement-level-range"} <= codes(report)
    assert not report["surface"]["exportable"]


def test_foamlib_manifest_preserves_custom_target_and_states_the_discrete_cell_size():
    import io
    import json
    from zipfile import ZipFile

    pytest.importorskip("foamlib")
    from backend.app.climoptix_foamlib import settings_package
    from geometry.climoptix_models import Refinement

    p = project()
    s = scenario(p)
    s.mesh.refinements = [Refinement(id="target", name="Custom target", cellMm=70)]
    with ZipFile(io.BytesIO(settings_package(s, prepare(p, s)))) as archive:
        record = json.loads(archive.read("manifest.json"))["refinements"][0]
        assert record["level"] == 2
        assert record["requestedCellMm"] == 70
        assert record["nominalCellMm"] == 50
        assert json.loads(archive.read("scenario.json"))["mesh"]["refinements"][0]["cellMm"] == 70


@pytest.mark.parametrize("bad", [True, "0.5"])
@pytest.mark.parametrize("field", ["sizeMm", "allowablePolygon"])
def test_nested_numeric_values_are_not_coerced_from_text_or_booleans(field, bad):
    data = scenario(project()).model_dump(mode="json")
    if field == "sizeMm":
        data["mesh"]["refinements"] = [{"id": "r", "name": "Region", "sizeMm": [bad, 1000, 1000]}]
    else:
        data["vents"] = [{"id": "v", "name": "Vent", "role": "supply", "host": {"patchId": "host"},
                          "optimization": {"allowablePolygon": [[bad, 0], [1, 0], [0, 1]]}}]
    with pytest.raises(ValidationError):
        Scenario.model_validate(data)


@pytest.mark.parametrize("clearance", ["minSpacingMm", "edgeClearanceMm"])
def test_both_vent_clearances_are_respected_independently_of_list_order(clearance):
    p = project()
    data = scenario(p).model_dump(mode="json")
    data["vents"] = [
        {"id": name, "name": name, "role": "supply", "widthMm": 300, "heightMm": 200,
         "edgeClearanceMm": 0, "optimization": {"minSpacingMm": 0},
         "host": {"patchId": "floor-ground:a:ceiling:0", "u": u, "v": 0.5}}
        for name, u in [("one", 0.4), ("two", 0.55)]
    ]
    if clearance == "minSpacingMm":
        data["vents"][0]["optimization"][clearance] = 500
    else:
        data["vents"][0][clearance] = 500
    for vents in [data["vents"], list(reversed(data["vents"]))]:
        report = prepare(p, Scenario.model_validate({**data, "vents": vents}))
        assert "vent-spacing" in codes(report), "Clearance must not depend on which vent was processed last"
        assert not report["surface"]["exportable"]
