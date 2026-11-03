from copy import deepcopy

import pytest
from test_climoptix import project, scenario

from backend.app.climoptix_provider import PreparationOnlyProvider
from geometry.climoptix_models import Scenario
from geometry.shared_boundary_models import SharedBoundaryInputs


def prepare(p, s):
    return PreparationOnlyProvider().validate_scenario(p, Scenario.model_validate(s.model_dump()), "b" * 64)


def shared_case():
    p = project()
    s = scenario(p)
    s.physics.energy = True
    s.sharedBoundaries = SharedBoundaryInputs.model_validate(
        {"version": 1, "captureEnvelope": True, "sources": [], "inventory": []}
    )
    s = Scenario.model_validate(s.model_dump())
    return p, s


def insulation(p, element="wall:0", *, u=None, boundary=None, ambient=None):
    assembly = dict(
        assemblyId="assembly",
        name="Reviewed insulation",
        category="floor" if element == "floor" else "wall",
        rsi=0.13,
        rse=0.04,
        directUValue=None,
        notes="",
        layers=[dict(layerId="layer", materialId="insulation", thicknessMm=100)],
    )
    assignment = dict(elementId=f"a|{element}", assemblyId="assembly", uValue=u)
    if boundary:
        assignment["boundary"] = boundary
    if ambient is not None:
        assignment["adjacentTemperatureC"] = ambient
    p["energyLayout"] = dict(
        version=1,
        activeScenarioId=None,
        existingAssignments=[assignment],
        scenarios=[],
        assemblies=[assembly],
        materials=[dict(materialId="insulation", name="Reviewed insulation", **{"lambda": 0.04})],
    )


def ufh(s, key="zone", *, watts=900, enabled=True, valid=True, x=1000):
    value = s.sharedBoundaries.model_dump()
    value["sources"].append(
        dict(
            id=key,
            name="UFH " + key,
            floorId="floor-ground",
            roomId="a",
            kind="ufh",
            watts=watts,
            enabled=enabled,
            geometryValid=valid,
            planningAreaM2=1,
            circuits=[dict(id="circuit-" + key, spacingMm=200, pathMm=[dict(x=x, y=500), dict(x=x, y=2500)])],
            exclusions=[],
        )
    )
    s.sharedBoundaries = type(s.sharedBoundaries).model_validate(value)


def test_layer_insulation_maps_robin_with_rsi_removed_once_and_changes_hash():
    p, s = shared_case()
    insulation(p)
    before = deepcopy(p)
    r = prepare(p, s)
    row = next(v for v in r["sharedBoundaryAudit"]["envelope"] if v["id"].endswith("wall:0"))
    assert row["status"] == "applied"
    assert row["uWm2K"] == pytest.approx(1 / 2.67)
    assert row["coefficientWm2K"] == pytest.approx(1 / 2.54)
    for patch in r["patches"]:
        if patch["id"] in row["patchIds"]:
            assert patch["boundary"]["thermal"]["type"] == "heatTransfer"
            assert patch["boundary"]["thermal"]["value"] == pytest.approx(1 / 2.54)
    assert p == before
    p["energyLayout"]["assemblies"][0]["layers"][0]["thicknessMm"] = 200
    after = prepare(p, s)
    assert after["validation"]["configurationHash"] != r["validation"]["configurationHash"]
    assert after["validation"]["sourceHash"] == r["validation"]["sourceHash"]


def test_entered_u_does_not_invent_inside_film_or_ground_temperature():
    p, s = shared_case()
    insulation(p, u=0.3)
    row = next(v for v in prepare(p, s)["sharedBoundaryAudit"]["envelope"] if v["uWm2K"] == 0.3)
    assert row["status"] == "incomplete" and "Rsi" in row["message"]
    insulation(p, "floor", boundary="Ground")
    row = next(v for v in prepare(p, s)["sharedBoundaryAudit"]["envelope"] if v["id"].endswith("floor"))
    assert row["status"] == "incomplete" and "temperature" in row["message"]


def test_ufh_maps_partial_floor_once_without_changing_closed_volume_or_inputs():
    p, s = shared_case()
    baseline = prepare(p, s)
    ufh(s)
    before = s.model_dump()
    r = prepare(p, s)
    row = r["sharedBoundaryAudit"]["sources"][0]
    assert row["status"] == "applied" and row["appliedW"] == pytest.approx(900)
    assert row["areaM2"] == pytest.approx(0.4)
    assert row["areaM2"] < sum(v["areaM2"] for v in r["patches"] if v["kind"] == "floor")
    assert r["surface"]["closed"] and r["surface"]["volumeM3"] == pytest.approx(baseline["surface"]["volumeM3"])
    assert s.model_dump() == before
    assert set(r["surface"]["trianglePatches"]) <= {v["id"] for v in r["patches"]}
    repeated = prepare(p, s)
    assert repeated["surface"] == r["surface"]
    assert repeated["sharedBoundaryAudit"] == r["sharedBoundaryAudit"]


def test_ufh_keeps_floor_insulation_and_adds_only_its_upward_source_flux():
    p, s = shared_case()
    insulation(p, "floor", boundary="Ground", ambient=10)
    ufh(s, watts=1000)
    r = prepare(p, s)
    row = r["sharedBoundaryAudit"]["sources"][0]
    assert row["appliedW"] == pytest.approx(1000)
    for patch in r["patches"]:
        if patch["id"] in row["patchIds"]:
            t = patch["boundary"]["thermal"]
            assert t["type"] == "heatTransfer" and t["ambientK"] == 283.15
            assert t["value"] == pytest.approx(1 / 2.54)
            assert t["sourceFluxWm2"] * patch["areaM2"] == pytest.approx(1000)


@pytest.mark.parametrize(
    "watts,enabled,valid,status",
    [(None, True, True, "incomplete"), (500, False, True, "off"), (500, True, False, "incomplete")],
)
def test_unreviewed_or_disabled_ufh_does_not_become_an_arbitrary_heat_boundary(watts, enabled, valid, status):
    p, s = shared_case()
    ufh(s, watts=watts, enabled=enabled, valid=valid)
    r = prepare(p, s)
    row = r["sharedBoundaryAudit"]["sources"][0]
    assert row["status"] == status and row["appliedW"] == 0
    assert not any(v["boundaryOrigin"].startswith("shared UFH") for v in r["patches"])


def test_overlapping_zones_are_rejected_together_without_order_dependent_heating():
    p, s = shared_case()
    ufh(s, "one")
    ufh(s, "two")
    r = prepare(p, s)
    assert all(v["status"] == "incomplete" and v["appliedW"] == 0 for v in r["sharedBoundaryAudit"]["sources"])


def test_exclusion_geometry_removes_heated_area_and_bad_paths_are_reported():
    p, s = shared_case()
    ufh(s)
    raw = s.sharedBoundaries.model_dump()
    raw["sources"][0]["exclusions"] = [
        [dict(x=950, y=1000), dict(x=1100, y=1000), dict(x=1100, y=1500), dict(x=950, y=1500)]
    ]
    s.sharedBoundaries = type(s.sharedBoundaries).model_validate(raw)
    r = prepare(p, s)
    row = r["sharedBoundaryAudit"]["sources"][0]
    assert row["status"] == "incomplete" and "crosses" in row["message"]
    assert r["surface"]["closed"]


def test_pressure_extract_preserves_temperature_and_scalar_backflow_conditions():
    from geometry.climoptix_models import Vent

    p, s = shared_case()
    s.physics.co2 = True
    s.vents = [
        Vent(
            id="return",
            name="Return",
            role="extract",
            control="pressure",
            valueSI=-10,
            temperatureK=300,
            co2Ppm=800,
            host={"patchId": "floor-ground:a:ceiling:0"},
        )
    ]
    # Use an actual kernel host rather than assuming a naming variant.
    s.vents[0].host.patchId = next(v["id"] for v in prepare(p, scenario(p))["patches"] if v["kind"] == "ceiling")
    r = prepare(p, s)
    patch = next(v for v in r["patches"] if v["kind"] == "extract")
    assert patch["boundary"]["thermal"]["type"] == "inletOutlet"
    assert patch["boundary"]["thermal"]["value"] == 300
    assert patch["boundary"]["scalarType"] == "inletOutlet" and patch["boundary"]["scalarPpm"] == 800


def test_zero_u_is_safe_when_explicitly_adiabatic():
    p, s = shared_case()
    insulation(p, u=0, boundary="Adiabatic")
    r = prepare(p, s)
    row = next(v for v in r["sharedBoundaryAudit"]["envelope"] if v["id"].endswith("wall:0"))
    assert row["status"] == "applied"
    assert all(v["boundary"]["thermal"]["type"] == "adiabatic" for v in r["patches"] if v["id"] in row["patchIds"])


def test_exclusions_clip_tube_influence_without_replacing_the_physical_floor():
    p, s = shared_case()
    ufh(s)
    raw = s.sharedBoundaries.model_dump()
    raw["sources"][0]["exclusions"] = [
        [dict(x=1050, y=1000), dict(x=1150, y=1000), dict(x=1150, y=1500), dict(x=1050, y=1500)]
    ]
    s.sharedBoundaries = type(s.sharedBoundaries).model_validate(raw)
    r = prepare(p, s)
    row = r["sharedBoundaryAudit"]["sources"][0]
    assert row["status"] == "applied" and row["areaM2"] == pytest.approx(0.375)
    assert row["appliedW"] == pytest.approx(900)
    assert r["surface"]["closed"]


def test_nonoverlapping_zones_conserve_power_independently_and_keep_stable_ids():
    p, s = shared_case()
    ufh(s, "one", watts=500)
    ufh(s, "two", x=2000, watts=700)
    before = prepare(p, s)
    assert [v["appliedW"] for v in before["sharedBoundaryAudit"]["sources"]] == pytest.approx([500, 700])
    s.sharedBoundaries.sources[0].watts = 1000
    after = prepare(p, s)
    assert [v["patchIds"] for v in after["sharedBoundaryAudit"]["sources"]] == [
        v["patchIds"] for v in before["sharedBoundaryAudit"]["sources"]
    ]
    assert after["sharedBoundaryAudit"]["sources"][0]["appliedW"] == pytest.approx(1000)


def test_whole_floor_temperature_override_propagates_to_split_faces_and_blocks_ufh():
    from geometry.climoptix_models import Boundary

    p, s = shared_case()
    floor = next(v["id"] for v in prepare(p, s)["patches"] if v["kind"] == "floor")
    s.boundaries.patches[floor] = Boundary(thermal={"type": "temperature", "value": 310})
    ufh(s)
    r = prepare(p, s)
    row = r["sharedBoundaryAudit"]["sources"][0]
    assert row["status"] == "incomplete" and row["appliedW"] == 0
    assert all(v["boundary"]["thermal"]["value"] == 310 for v in r["patches"] if v["kind"] == "floor")


def test_floor_vent_aperture_is_not_heated_and_does_not_change_surface_closure():
    from geometry.climoptix_models import Vent

    p, s = shared_case()
    ufh(s)
    floor = next(v for v in prepare(p, s)["patches"] if v["kind"] == "floor" and v.get("hostable"))
    host = floor["host"]
    delta = [1000 - host["originMm"][0], 1500 - host["originMm"][1], -host["originMm"][2]]
    u = sum(x * a for x, a in zip(delta, host["uAxis"], strict=True)) / host["widthMm"]
    v = sum(x * a for x, a in zip(delta, host["vAxis"], strict=True)) / host["heightMm"]
    s.vents = [
        Vent(
            id="supply",
            name="Floor supply",
            role="supply",
            widthMm=100,
            heightMm=100,
            host={"patchId": floor["id"], "u": u, "v": v},
        )
    ]
    r = prepare(p, s)
    row = r["sharedBoundaryAudit"]["sources"][0]
    assert row["areaM2"] == pytest.approx(0.39)
    assert row["appliedW"] == pytest.approx(900) and r["surface"]["closed"]
    assert not any(v["kind"] == "supply" for v in r["patches"] if v["id"] in row["patchIds"])


def test_geometry_changes_do_not_reuse_stale_wall_insulation():
    import json

    p, s = shared_case()
    insulation(p)
    p["energyLayout"]["existingAssignments"][0]["geometrySignature"] = json.dumps(p["rooms"][0]["vertices"][:2])
    p["rooms"][0]["vertices"][1]["x"] = 4500
    row = next(v for v in prepare(p, s)["sharedBoundaryAudit"]["envelope"] if v["id"].endswith("wall:0"))
    assert row["status"] == "incomplete" and row["coefficientWm2K"] is None


def test_sources_in_an_excluded_room_do_not_supply_the_selected_air_domain():
    p = project(True)
    _, s = shared_case()
    s.sourceBuildingId = p["projectId"]
    ufh(s)
    s.sharedBoundaries.sources[0].roomId = "b"
    r = prepare(p, s)
    assert r["sharedBoundaryAudit"]["sources"][0]["status"] == "outside"
    assert r["sharedBoundaryAudit"]["sources"][0]["appliedW"] == 0


def test_disabling_a_source_removes_heat_but_retains_the_valid_air_skin():
    p, s = shared_case()
    ufh(s)
    before = prepare(p, s)
    s.sharedBoundaries.sources[0].enabled = False
    after = prepare(p, s)
    assert after["sharedBoundaryAudit"]["sources"][0]["status"] == "off"
    assert after["surface"]["volumeM3"] == pytest.approx(before["surface"]["volumeM3"])
    assert after["surface"]["closed"]


def test_shared_floor_splits_do_not_change_insulation_override_surface_identity():
    from geometry.climoptix_domain import discover_domain
    from geometry.thermal_envelope import envelope_records

    p, s = shared_case()
    insulation(p, "floor", boundary="Ground", ambient=10)
    baseline = prepare(p, s)
    before = envelope_records(p, s, discover_domain(p, s), baseline)
    ufh(s)
    after_report = prepare(p, s)
    after = envelope_records(p, s, discover_domain(p, s), after_report)
    assert [v["surfaceId"] for v in after] == [v["surfaceId"] for v in before]
    assert [v["areaM2"] for v in after] == pytest.approx([v["areaM2"] for v in before])


@pytest.mark.parametrize("angle,thermal_type", [(0, "heatTransfer"), (90, "inletOutlet")])
def test_open_aperture_uses_backflow_temperature_and_closed_leaf_uses_insulation(angle, thermal_type):
    from test_climoptix import aperture

    p, s = shared_case()
    opening = aperture(angle=angle)
    p["rooms"][0]["openings"] = [opening]
    insulation(p, "opening:" + opening["id"], boundary="External", ambient=18)
    r = prepare(p, s)
    patch = next(v for v in r["patches"] if v["kind"] == "door")
    assert patch["boundary"]["thermal"]["type"] == thermal_type
    if angle:
        assert patch["boundary"]["flow"]["type"] == "opening"
        assert patch["boundary"]["thermal"]["value"] == s.physics.outdoorTemperatureK


@pytest.mark.parametrize("enabled,power", [(False, 0), (True, 500)])
def test_radiator_off_or_power_controls_report_conflicting_object_temperature(enabled, power):
    from test_climoptix import obstruction

    from geometry.climoptix_models import AssetOverride, Boundary

    p, s = shared_case()
    p["rooms"][0]["obstacles"] = [obstruction("radiator", "furniture-radiator-horizontal-2-1000", (1000, 100, 600))]
    s.assetOverrides = [AssetOverride(objectId="radiator", mode="solidProxy", heatW=power)]
    s.boundaries.groups["object"] = Boundary(thermal={"type": "temperature", "value": 310})
    raw = s.sharedBoundaries.model_dump()
    raw["sources"] = [
        dict(
            id="radiator",
            name="Radiator",
            floorId="floor-ground",
            roomId="a",
            kind="radiator",
            watts=power,
            enabled=enabled,
            geometryValid=True,
            planningAreaM2=None,
            circuits=[],
            exclusions=[],
        )
    ]
    s.sharedBoundaries = type(s.sharedBoundaries).model_validate(raw)
    r = prepare(p, s)
    assert r["sharedBoundaryAudit"]["sources"][0]["status"] == "incomplete"


def test_deleted_pinned_insulation_choice_is_reviewable_without_changing_it_or_losing_air_geometry():
    from geometry.thermal_models import ThermalSetup

    p, s = shared_case()
    insulation(p)
    s.thermalEnvelope = ThermalSetup(insulationScenarios={"floor-ground": "deleted-choice"})
    ufh(s)
    before = deepcopy(s.model_dump())
    r = prepare(p, s)
    assert r["surface"]["closed"]
    assert r["sharedBoundaryAudit"]["sources"][0]["appliedW"] == pytest.approx(900)
    assert r["sharedBoundaryAudit"]["envelope"][0]["status"] == "incomplete"
    assert "no longer exists" in r["sharedBoundaryAudit"]["envelope"][0]["message"]
    assert s.model_dump() == before
