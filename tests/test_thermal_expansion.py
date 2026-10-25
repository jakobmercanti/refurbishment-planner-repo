"""Synthetic, offline engineering acceptance fixtures for thermal envelope v1."""

from copy import deepcopy
from datetime import UTC

import pytest
from fastapi.testclient import TestClient
from pydantic import ValidationError
from test_climoptix import aperture, building, measured, prepare, project, room, scenario

from geometry.thermal_balance import thermal_package
from geometry.thermal_epw import parse_epw
from geometry.thermal_models import ThermalOverride, ThermalSetup, ThermalSnapshot
from geometry.thermal_solar import irradiance, local_instant, sun_position


def thermal_fixture(two=False):
    p = project(two)
    p["energyLayout"] = {
        "version": 1,
        "activeScenarioId": None,
        "scenarios": [],
        "thermalBridges": [],
        "materials": [
            {"materialId": "test", "name": "Synthetic insulation", "lambda": 0.04, "reference": "Analytical fixture"}
        ],
        "assemblies": [
            {
                "assemblyId": "test",
                "name": "Test wall",
                "category": "wall",
                "rsi": 0.13,
                "rse": 0.04,
                "directUValue": None,
                "layers": [{"layerId": "test", "materialId": "test", "thicknessMm": 100}],
            }
        ],
        "existingAssignments": [
            {"elementId": f"{r['id']}|{kind}", "assemblyId": "test"}
            for r in p["rooms"]
            for kind in ("floor", "roof", "wall:0", "wall:1", "wall:2", "wall:3")
        ],
    }
    s = scenario(p)
    s.physics.energy = True
    s.thermalEnvelope = ThermalSetup.model_validate(
        {
            "location": {
                "name": "Offline London fixture",
                "latitude": 51.5,
                "longitude": 0.0,
                "timezone": "UTC",
                "source": "Synthetic test coordinates",
            },
            "localDateTime": "2026-06-21T12:00",
            "weather": {"source": "Analytical test", "temperatureC": 20},
            "airExchange": {"mode": "none"},
            "groundTemperatureC": 20,
            "assumptionsAccepted": True,
        }
    )
    return p, s


def calculate(p, s, calc=True):
    return thermal_package(p, s, prepare(p, s), calculate=calc)


def test_01_zero_load_night_equilibrium_and_mm_units():
    p, s = thermal_fixture()
    s.thermalEnvelope.localDateTime = "2026-06-21T00:00"
    result = calculate(p, s)
    assert result.validation.previewReady, result.validation.errors
    assert result.validation.applyReady, result.validation.projectionErrors
    assert result.preview.equilibriumAirTempC == pytest.approx(20)
    assert result.preview.heatBalanceResidualW == pytest.approx(0, abs=1e-10)
    assert sum(f.areaM2 for f in result.surfaces) == pytest.approx(57.6)
    assert result.preview.totalConductanceWK == pytest.approx(57.6 / 2.67)
    assert all(f.heatW == pytest.approx(0, abs=1e-10) for f in result.surfaces)


def test_02_03_gains_conservation_and_doubled_u():
    p, s = thermal_fixture()
    s.thermalEnvelope.weather.temperatureC = 5
    s.thermalEnvelope.groundTemperatureC = 5
    from geometry.thermal_models import ThermalGain

    s.thermalEnvelope.gains = [
        ThermalGain(id="gain", name="People", kind="people", count=2, powerW=100, source="Analytical fixture")
    ]
    first = calculate(p, s)
    assert first.preview.equilibriumAirTempC == pytest.approx(5 + 200 / first.preview.totalConductanceWK)
    assert abs(first.preview.heatBalanceResidualW) < 1e-9
    p["energyLayout"]["assemblies"][0]["layers"][0]["thicknessMm"] = 46.6
    second = calculate(p, s)
    assert second.preview.totalConductanceWK == pytest.approx(2 * first.preview.totalConductanceWK)
    assert second.preview.equilibriumAirTempC == pytest.approx(5 + (first.preview.equilibriumAirTempC - 5) / 2)
    assert second.caseHash != first.caseHash


def test_04_05_solar_orientation_night_and_rotation():
    p, s = thermal_fixture()
    setup = s.thermalEnvelope
    setup.weather.solarMode = "components"
    setup.weather.dniWm2, setup.weather.dhiWm2 = 800, 100
    setup.groundAlbedo, setup.opaqueAbsorptance, setup.weather.externalH = 0.2, 0.6, 25
    first = calculate(p, s)
    assert first.validation.previewReady, first.validation.errors
    assert first.cardinalIrradianceWm2["South"] > first.cardinalIrradianceWm2["North"]
    setup.northDeg = 180
    second = calculate(p, s)
    by_id = {f.surfaceId: f for f in second.surfaces}
    for face in first.surfaces:
        assert by_id[face.surfaceId].areaM2 == face.areaM2
        assert by_id[face.surfaceId].verticesMm == face.verticesMm
        assert by_id[face.surfaceId].azimuthDeg == pytest.approx((face.azimuthDeg + 180) % 360)
    setup.localDateTime = "2026-06-21T00:00"
    setup.weather.dhiWm2 = 0
    sun = sun_position(setup)
    assert sun["elevationDeg"] < 0
    assert irradiance(90, 180, setup, sun)["beamWm2"] == 0
    for hour in ("03:00", "21:00"):
        setup.localDateTime = "2026-06-21T" + hour
        sun = sun_position(setup)
        if sun["elevationDeg"] < 0:
            assert irradiance(45, 180, setup, sun)["beamWm2"] == 0


def test_06_gable_exact_area_normals_and_ceiling_mapping():
    p, s = thermal_fixture()
    building(p, "GABLE")
    result = calculate(p, s)
    roofs = [f for f in result.surfaces if f.category == "roof"]
    assert len(roofs) == 2
    assert all(0 < f.tiltDeg < 90 and f.normal[2] > 0 and f.assemblyId == "test" for f in roofs)
    assert sum(f.areaM2 * f.normal[2] for f in roofs) == pytest.approx(12)


def test_07_17_passages_exclude_internal_contacts_and_reveals():
    p, s = thermal_fixture(True)
    p["rooms"][0]["openings"] = [aperture("RECTANGULAR")]
    result = calculate(p, s)
    assert set(prepare(p, s)["domain"]["includedRoomIds"]) == {"a", "b"}
    reveals = [f for f in result.surfaces if ":passage:" in f.patchId]
    assert reveals and all(f.exposure == "internal" and f.incidentWm2 == 0 and f.heatW == 0 for f in reveals)
    assert not any(f.exposure == "outdoors" and f.neighborRoomId for f in result.surfaces)


def test_08_window_conduction_and_transmission_once():
    p, s = thermal_fixture()
    opening = aperture()
    opening.update(kind="WINDOW", sill_height_mm=500)
    opening["height"]["value"] = 1000
    p["rooms"][0]["openings"] = [opening]
    p["energyLayout"]["existingAssignments"].append(
        {"elementId": "a|opening:opening", "uValue": 1.4, "solarGainValue": 0.5}
    )
    s.thermalEnvelope.weather.solarMode = "perSurface"
    source = calculate(p, s, False)
    for face in source.surfaces:
        if face.exposure == "outdoors":
            s.thermalEnvelope.overrides[face.surfaceId] = ThermalOverride(
                incidentWm2=100,
                rsi=0.13,
                alpha=0.6,
                externalH=25,
                reason="Synthetic fixed forcing",
                acknowledgedAssemblyRevision=face.insulationRevision,
            )
    result = calculate(p, s)
    assert result.validation.previewReady, result.validation.errors
    windows = [f for f in result.surfaces if f.kind == "window"]
    assert sum(f.areaM2 for f in windows) == pytest.approx(1)
    assert result.preview.transmittedSolarW == pytest.approx(50)
    assert sum(source.powerW for source in result.internalSources if source.id.startswith("solar:")) == pytest.approx(
        50
    )
    assert result.preview.internalGainsW == 0
    assert all(f.absorbedWm2 == 0 and f.equivalentC == 20 for f in windows)
    assert abs(result.preview.heatBalanceResidualW) < 1e-9


def test_09_10_override_source_edit_acknowledgement_and_reset():
    p, s = thermal_fixture()
    first = calculate(p, s)
    face = first.surfaces[0]
    s.thermalEnvelope.overrides[face.surfaceId] = ThermalOverride(
        uWm2K=0.5,
        uIncludesFilms=True,
        rsi=0.13,
        acknowledgedAssemblyRevision=face.insulationRevision,
        reason="Measured overall U",
    )
    overridden = calculate(p, s)
    assert next(f for f in overridden.surfaces if f.surfaceId == face.surfaceId).uWm2K == 0.5
    source = next(f for f in overridden.surfaces if f.surfaceId == face.surfaceId)
    assert source.insulationUWm2K == pytest.approx(1 / 2.67)
    assert source.insulationAssemblyId == "test"
    p["energyLayout"]["assemblies"][0]["layers"][0]["thicknessMm"] = 120
    stale = calculate(p, s)
    assert not stale.validation.applyReady
    assert next(f for f in stale.surfaces if f.surfaceId == face.surfaceId).status == "stale"
    s.thermalEnvelope.overrides.clear()
    reset = calculate(p, s)
    assert next(f for f in reset.surfaces if f.surfaceId == face.surfaceId).uWm2K == pytest.approx(1 / 3.17)
    assert reset.caseHash != first.caseHash


@pytest.mark.parametrize("kind", ["DOOR", "WINDOW"])
def test_11_open_door_and_window_still_stop_domain(kind):
    p, s = thermal_fixture(True)
    p["rooms"][0]["openings"] = [{**aperture(angle=90), "kind": kind}]
    assert prepare(p, s)["domain"]["includedRoomIds"] == ["a"]
    records = calculate(p, s, False).surfaces
    assert all(f.incidentWm2 is None for f in records)
    assert any(f.kind == kind.lower() and f.exposure == "adjacent" for f in records)


def test_12_adiabatic_indeterminate_and_film_split_not_invented():
    p, s = thermal_fixture()
    from geometry.thermal_models import ThermalGain

    s.thermalEnvelope.gains = [
        ThermalGain(id="positive", name="Positive sensible load", powerW=100, source="Underdetermined fixture")
    ]
    for assignment in p["energyLayout"]["existingAssignments"]:
        assignment["boundary"] = "Adiabatic"
    result = calculate(p, s)
    assert result.preview.equilibriumAirTempC is None
    assert any("indeterminate" in e for e in result.validation.errors)
    for assignment in p["energyLayout"]["existingAssignments"]:
        assignment.pop("boundary")
        assignment["uValue"] = 0.4
    result = calculate(p, s)
    assert result.validation.previewReady and not result.validation.applyReady
    assert any("Rsi" in e for e in result.validation.projectionErrors)
    s.thermalEnvelope.method = "fixedFlux"
    assert calculate(p, s).validation.applyReady


def test_13_15_snapshot_immutability_hash_and_legacy_serialization():
    p, s = thermal_fixture()
    first = calculate(p, s)
    snap = ThermalSnapshot(
        schemaVersion=1,
        caseHash=first.caseHash,
        sourceRevision=first.sourceRevision,
        createdAt="2026-10-21T12:00:00Z",
        package=first,
    )
    s.thermalSnapshots = [snap]
    assert calculate(p, s).caseHash == first.caseHash
    s.thermalEnvelope.northDeg = 45
    assert calculate(p, s).caseHash != first.caseHash
    assert snap.package.scenario.northDeg == 0
    assert s.model_validate_json(s.model_dump_json()).thermalEnvelope == s.thermalEnvelope
    assert scenario(p).thermalEnvelope is None


def test_14_dst_validation_and_epw_standard_time():
    _, s = thermal_fixture()
    setup = s.thermalEnvelope
    setup.location.timezone = "Europe/London"
    setup.localDateTime = "2026-03-29T01:30"
    with pytest.raises(ValueError, match="does not exist"):
        local_instant(setup)
    setup.localDateTime = "2026-10-25T01:30"
    with pytest.raises(ValueError, match="occurs twice"):
        local_instant(setup)
    setup.dstChoice = "earlier"
    earlier = local_instant(setup).astimezone(UTC)
    setup.dstChoice = "later"
    assert (local_instant(setup).astimezone(UTC) - earlier).total_seconds() == 3600
    for patch in ({"latitude": 91}, {"longitude": -181}):
        with pytest.raises(ValidationError):
            setup.location.model_validate({**setup.location.model_dump(), **patch})
    for patch in ({"uWm2K": 0}, {"gValue": 1.1}, {"uWm2K": float("nan")}):
        with pytest.raises(ValidationError):
            ThermalOverride.model_validate(patch)
    row = ["2026", "6", "21", "1", "60", "", "15", "", "50", "", "", "", "", "0", "0", "0", "", "", "", "", "", "2"]
    text = "LOCATION,Fixture,,GB,Test,0,51.5,0,1,10\n" + "header\n" * 7 + ",".join(row)
    epw = parse_epw(text, "fixture.epw")
    assert epw["records"][0]["localDateTime"] == "2026-06-21T00:30"
    assert epw["location"]["fixedUtcOffsetMinutes"] == 60
    row[6] = "99.9"
    row[8] = "999"
    with pytest.raises(ValueError, match="No valid"):
        parse_epw("LOCATION,Fixture,,GB,Test,0,51.5,0,1,10\n" + "header\n" * 7 + ",".join(row), "bad.epw")


def test_16_18_api_unknown_data_and_honest_adapter():
    from backend.app.main import app

    p, s = thermal_fixture()
    p["energyLayout"]["existingAssignments"].clear()
    client = TestClient(app)
    body = {"project": p, "scenario": s.model_dump(mode="json"), "clientRevision": "a" * 64}
    response = client.post("/climoptix/thermal-preview", json=body)
    assert response.status_code == 200, response.text
    result = response.json()
    assert result["validation"]["errors"]
    assert all(f["uWm2K"] is None for f in result["surfaces"])
    assert result["preview"]["equilibriumAirTempC"] is None
    assert result["adapter"] == "OpenCFD-v2312-contract-only"
    assert result["executed"] is False and result["runnable"] is False


def test_airflow_ach_and_units_balance():
    p, s = thermal_fixture()
    from geometry.thermal_models import ThermalAirExchange

    s.thermalEnvelope.airExchange = ThermalAirExchange(
        mode="ach", value=1, extractValue=1, supplyTemperatureC=10, source="Analytical ACH"
    )
    result = calculate(p, s)
    assert result.airExchange.volumeFlowM3S == pytest.approx(28.8 / 3600)
    assert result.preview.airConductanceWK == pytest.approx(1.2 * 1005 * 28.8 / 3600)
    assert abs(result.preview.heatBalanceResidualW) < 1e-9
    s.thermalEnvelope.airExchange.extractValue = 0.5
    assert not calculate(p, s).validation.previewReady


def test_invalid_insulation_layer_is_rejected_not_repaired():
    p, s = thermal_fixture()
    p["energyLayout"]["assemblies"][0]["layers"][0]["thicknessMm"] = -1
    with pytest.raises(ValueError, match="thickness"):
        calculate(p, s)


def test_removed_insulation_scenario_never_silently_falls_back_to_existing():
    p, s = thermal_fixture()
    s.thermalEnvelope.insulationScenarios["floor-ground"] = "removed-upgrade"
    with pytest.raises(ValueError, match="no longer exists"):
        calculate(p, s, False)
    s.thermalEnvelope.insulationScenarios["floor-ground"] = None
    assert calculate(p, s).validation.previewReady


def test_robin_resistance_and_absolute_temperature_units():
    p, s = thermal_fixture()
    result = calculate(p, s)
    for face in result.surfaces:
        assert face.cfdBC.rOutwardM2KW == pytest.approx(2.67 - 0.13)
        assert face.cfdBC.tEqOutsideK == pytest.approx(293.15)
        assert face.cfdBC.fluxIntoRoomWm2 is None
    target = result.surfaces[0]
    s.thermalEnvelope.overrides[target.surfaceId] = ThermalOverride(
        rsi=0.2, rse=0.1, reason="Explicit revised film model", acknowledgedAssemblyRevision=target.insulationRevision
    )
    revised = next(f for f in calculate(p, s).surfaces if f.surfaceId == target.surfaceId)
    assert revised.uWm2K == pytest.approx(1 / 2.8)
    assert revised.cfdBC.rOutwardM2KW == pytest.approx(2.6)


def test_06_multifloor_void_contacts_and_different_footprints():
    p, s = thermal_fixture()
    building(p)
    upper = {
        "rooms": [room("upper")],
        "floorplan": None,
        "assetInstances": [],
        "energyLayout": deepcopy(p["energyLayout"]),
    }
    for a in upper["energyLayout"]["existingAssignments"]:
        a["elementId"] = a["elementId"].replace("a|", "upper|")
    p["building"]["floors"].append(
        {
            "id": "upper-floor",
            "name": "Upper",
            "elevationMm": 2600,
            "heightMm": 2600,
            "slabThicknessMm": 200,
            "content": upper,
            "openings": [
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
            ],
        }
    )
    result = calculate(p, s)
    assert result.validation.previewReady, result.validation.errors
    assert any(f.kind == "slabSide" and f.exposure == "internal" for f in result.surfaces)
    contacts = [f for f in result.surfaces if f.neighborRoomId]
    assert contacts and all(f.exposure == "internal" and f.conductanceWK == 0 for f in contacts)
    assert sum(f.areaM2 for f in result.surfaces if f.kind == "ceiling" and f.exposure == "outdoors") == pytest.approx(
        12
    )
    # Upper setback leaves a real outdoor terrace on the lower ceiling.
    upper["rooms"][0]["vertices"][1]["x"] = 3000
    upper["rooms"][0]["vertices"][2]["x"] = 3000
    result = calculate(p, s)
    exposed_lower = [
        f for f in result.surfaces if f.floorId == "floor-ground" and f.kind == "ceiling" and f.exposure == "outdoors"
    ]
    assert sum(f.areaM2 for f in exposed_lower) == pytest.approx(3)


@pytest.mark.parametrize("kind", ["MONO", "STEPPED", "GABLE"])
def test_distinct_roof_planes_and_flat_attic_is_not_solar_exposed(kind):
    p, s = thermal_fixture()
    building(p, kind)
    result = calculate(p, s)
    assert result.validation.previewReady, result.validation.errors
    assert all(f.normal[2] >= 0 for f in result.surfaces if f.category == "roof")
    p["building"]["roof"]["ceilingMode"] = "FLAT"
    result = calculate(p, s)
    assert not result.validation.previewReady
    assert all(f.exposure == "adjacent" and f.incidentWm2 is None for f in result.surfaces if f.category == "roof")


def test_split_wall_assemblies_and_unknown_segment_not_silently_reassigned():
    p, s = thermal_fixture()
    import json

    neighbor = room("neighbor")
    neighbor["vertices"] = [{"x": point["x"] / 2, "y": point["y"] - 3000} for point in neighbor["vertices"]]
    p["rooms"].append(neighbor)

    p["energyLayout"]["existingAssignments"].append(
        {
            "elementId": "a|wall:0:0",
            "uValue": 0.8,
            "geometrySignature": json.dumps([{"x": 0, "y": 0}, {"x": 2000, "y": 0}]),
        }
    )
    result = calculate(p, s, False)
    walls = [f for f in result.surfaces if f.elementId.startswith("a|wall:0")]
    assert {f.elementId for f in walls} == {"a|wall:0", "a|wall:0:0"}
    expected_area = sum(
        patch["areaM2"]
        for patch in prepare(p, s)["patches"]
        if patch["roomId"] == "a" and patch["sourceId"] == "wall-001"
    )
    assert sum(f.areaM2 for f in walls) == pytest.approx(expected_area)
    target = next(f for f in walls if f.elementId.endswith(":0:0"))
    assert target.uWm2K == 0.8 and target.status != "stale"
    neighbor["vertices"][1]["x"] = 2500
    neighbor["vertices"][2]["x"] = 2500
    assert any(f.status == "stale" for f in calculate(p, s, False).surfaces if f.elementId.startswith("a|wall:0"))


def test_override_library_revision_and_u_film_declaration():
    p, s = thermal_fixture()
    first = calculate(p, s)
    face = first.surfaces[0]
    other = deepcopy(p["energyLayout"]["assemblies"][0])
    other["assemblyId"] = "other"
    p["energyLayout"]["assemblies"].append(other)
    s.thermalEnvelope.overrides[face.surfaceId] = ThermalOverride(assemblyId="other", reason="Library selection")
    draft = calculate(p, s, False)
    target = next(f for f in draft.surfaces if f.surfaceId == face.surfaceId)
    s.thermalEnvelope.overrides[face.surfaceId].acknowledgedAssemblyRevision = target.insulationRevision
    assert calculate(p, s).validation.previewReady
    other["layers"][0]["thicknessMm"] = 150
    assert not calculate(p, s).validation.previewReady
    s.thermalEnvelope.overrides[face.surfaceId] = ThermalOverride(
        uWm2K=0.5, reason="Unknown film convention", acknowledgedAssemblyRevision=face.insulationRevision
    )
    assert not calculate(p, s).validation.previewReady


def test_pinned_adapter_exports_thermal_contract_but_no_temperature_dictionary():
    from io import BytesIO
    from zipfile import ZipFile

    from backend.app.climoptix_foamlib import settings_package

    p, s = thermal_fixture()
    report = prepare(p, s)
    thermal = thermal_package(p, s, report, calculate=True)
    with ZipFile(BytesIO(settings_package(s, report, thermal=thermal))) as archive:
        assert "thermal-boundary-contract.json" in archive.namelist()
        assert "0/T" not in archive.namelist()
        import json

        manifest = json.loads(archive.read("manifest.json"))
        assert manifest["runnable"] is False
        assert manifest["thermalContract"]["caseHash"] == thermal.caseHash


def test_unknown_epw_sentinels_and_hourly_mean_solar_are_explicit():
    _, s = thermal_fixture()
    s.thermalEnvelope.weather.solarMode = "components"
    s.thermalEnvelope.weather.dniWm2, s.thermalEnvelope.weather.dhiWm2 = 500, 100
    s.thermalEnvelope.weather.ghiWm2, s.thermalEnvelope.groundAlbedo = 100, 0.2
    sun = sun_position(s.thermalEnvelope)
    with pytest.raises(ValueError, match="inconsistent"):
        irradiance(45, 180, s.thermalEnvelope, sun)
    s.thermalEnvelope.weather.forcingBasis = "hourlyMean"
    assert irradiance(45, 180, s.thermalEnvelope, sun)["totalWm2"] > 0


def test_unmapped_override_and_conflicting_legacy_bc_block_handoff():
    p, s = thermal_fixture()
    s.thermalEnvelope.overrides["no-longer-present"] = ThermalOverride(reason="Old face")
    assert any("no longer map" in e for e in calculate(p, s).validation.errors)
    s.thermalEnvelope.overrides.clear()
    from geometry.climoptix_models import Boundary

    s.boundaries.groups["wall"] = Boundary(thermal={"type": "temperature", "value": 295})
    result = calculate(p, s)
    assert result.validation.previewReady and not result.validation.applyReady
    assert any("legacy thermal" in e for e in result.validation.projectionErrors)


def test_extreme_sol_air_forcing_never_exports_nonphysical_kelvin():
    p, s = thermal_fixture()
    s.thermalEnvelope.weather.solarMode = "components"
    s.thermalEnvelope.weather.dniWm2 = 800
    s.thermalEnvelope.weather.dhiWm2 = 100
    s.thermalEnvelope.weather.externalH = 0.000001
    s.thermalEnvelope.groundAlbedo = 0.2
    s.thermalEnvelope.opaqueAbsorptance = 0.6
    result = calculate(p, s)
    assert not result.validation.previewReady and not result.validation.applyReady
    assert any("equivalent surface forcing" in e for e in result.validation.errors)
    assert result.preview.equilibriumAirTempC is None


def test_device_mass_flow_source_gains_and_api_import_validation():
    p, s = thermal_fixture()
    from geometry.climoptix_models import Vent
    from geometry.thermal_models import ThermalAirExchange, ThermalGain

    host = next(patch for patch in prepare(p, s)["patches"] if patch["hostable"] and patch["kind"] == "ceiling")
    s.vents = [
        Vent(
            id="supply",
            name="Supply",
            role="supply",
            host={"patchId": host["id"], "u": 0.3},
            control="massFlow",
            valueSI=0.012,
            temperatureK=283.15,
        ),
        Vent(
            id="extract",
            name="Extract",
            role="extract",
            host={"patchId": host["id"], "u": 0.7},
            control="massFlow",
            valueSI=0.012,
        ),
    ]
    s.thermalEnvelope.airExchange = ThermalAirExchange(
        mode="devices", source="Measured balanced outdoor supply / extract"
    )
    s.thermalEnvelope.gains = [
        ThermalGain(
            id="people",
            name="People",
            powerW=100,
            count=2,
            sensibleFraction=0.8,
            operatingFraction=0.5,
            radiantFraction=0.4,
            source="Explicit sensible fixture",
        )
    ]
    result = calculate(p, s)
    assert result.validation.previewReady, result.validation.errors
    assert result.airExchange.massFlowKgS == pytest.approx(0.012)
    assert result.preview.airConductanceWK == pytest.approx(0.012 * 1005)
    assert result.preview.internalGainsW == 80
    assert any("density" in e for e in result.validation.projectionErrors)
    s.physics.densityKgM3 = s.thermalEnvelope.rhoKgM3
    assert calculate(p, s).validation.applyReady
    from backend.app.main import app

    client = TestClient(app)
    assert client.post("/climoptix/thermal-epw", json={"text": "invalid", "filename": "bad.epw"}).status_code == 422


def test_double_height_and_realistic_connected_domain_without_reusing_footprint_areas():
    from time import perf_counter

    p, s = thermal_fixture()
    p["rooms"][0]["wall_height"]["value"] = 4800
    result = calculate(p, s)
    assert result.validation.previewReady, result.validation.errors
    assert sum(f.areaM2 for f in result.surfaces if f.kind == "wall") == pytest.approx(14 * 4.8)
    # Eight connected source rooms exercise reconstruction/mapping, not display
    # triangles or hand-entered areas. Timing is reported, not a flaky CI limit.
    p["rooms"] = [room(f"r{i}", i * 4000) for i in range(8)]
    for index, source in enumerate(p["rooms"][:-1]):
        source["openings"] = [{**aperture("RECTANGULAR"), "id": f"passage{index}"}]
    s.seed.roomId = "r0"
    p["energyLayout"]["existingAssignments"] = [
        {"elementId": f"{r['id']}|{key}", "assemblyId": "test"}
        for r in p["rooms"]
        for key in ("floor", "roof", "wall:0", "wall:1", "wall:2", "wall:3")
    ]
    started = perf_counter()
    result = calculate(p, s)
    elapsed = perf_counter() - started
    assert result.validation.previewReady, result.validation.errors
    assert len({f.roomId for f in result.surfaces}) == 8
    assert abs(result.preview.heatBalanceResidualW) < 0.01
    print(f"Eight-room analytic thermal calculation: {elapsed:.3f}s, {len(result.surfaces)} split faces")


def test_source_only_heat_does_not_claim_an_airflow_obstruction():
    p, s = thermal_fixture()
    p["rooms"][0]["obstacles"] = [
        {
            "id": "person",
            "name": "Person",
            "fixture_kind": "FURNITURE",
            "representation_key": "people-standing",
            "center": {"x": 1000, "y": 1000},
            "rotation_deg": 0,
            "base_z_mm": 0,
            "dimensions": {
                key: measured(value) for key, value in zip(("width", "depth", "height"), (500, 300, 1700), strict=True)
            },
        }
    ]
    from geometry.climoptix_models import AssetOverride

    s.assetOverrides = [AssetOverride(objectId="person", mode="sourceOnly", heatW=80, count=2)]
    s.thermalEnvelope.includeCFDSources = True
    result = calculate(p, s)
    assert result.validation.previewReady, result.validation.errors
    assert result.preview.internalGainsW == 160
    assert any("no airflow obstruction" in warning for warning in result.validation.warnings)
    s.thermalEnvelope.includeCFDSources = False
    result = calculate(p, s)
    assert result.preview.internalGainsW == 0
    assert not any("retained as an airflow obstruction" in warning for warning in result.validation.warnings)
