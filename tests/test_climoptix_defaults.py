from copy import deepcopy

import pytest

from backend.app.climoptix_defaults import default_setup
from backend.app.climoptix_provider import PreparationOnlyProvider
from backend.app.openfoam_case import validate_submission
from backend.app.openfoam_smoke import fixture
from geometry.climoptix_models import Boundary


def test_default_replaces_invalid_settings_without_modifying_source():
    request = fixture()
    project_before = deepcopy(request.project)
    request.scenario.resources.cpu = 4
    request.scenario.physics.energy = True
    request.scenario.boundaries.groups["floor"] = Boundary.model_validate({"flow": {"type": "volumeFlow"}, "thermal": {"type": "temperature", "value": 300}})
    before = request.scenario.model_dump()
    scenario = default_setup(request.project, request.scenario, request.clientRevision)
    assert request.project == project_before
    assert request.scenario.model_dump() == before
    assert scenario.seed == request.scenario.seed
    assert scenario.physics.turbulence == "laminar"
    assert not scenario.physics.energy
    assert scenario.resources.cpu == 1
    assert scenario.resources.memoryGb == 4
    assert not scenario.boundaries.patches
    assert not scenario.boundaries.collections
    assert len(scenario.vents) == 2
    assert len(scenario.outputs.probesMm) == 1
    assert {v.role for v in scenario.vents} == {"supply", "extract"}
    report = PreparationOnlyProvider().validate_scenario(request.project, scenario, request.clientRevision)
    assert report["validation"]["errors"] == 0
    assert report["surface"]["exportable"]
    normals = [v["outwardNormal"] for v in report["vents"]]
    assert sum(a * b for a, b in zip(*normals, strict=True)) < -.999
    assert all(p["boundary"]["thermal"]["type"] == "adiabatic" for p in report["patches"])
    assert all(p["boundary"]["flow"]["type"] == "noSlip" for p in report["patches"] if p["kind"] not in ("supply", "extract"))
    request.scenario = scenario
    request.sourceHash = report["validation"]["sourceHash"]
    request.configurationHash = report["validation"]["configurationHash"]
    validate_submission(request)


def test_default_selects_first_measured_room_and_repeats_safely():
    request = fixture()
    request.scenario.seed = None
    first = default_setup(request.project, request.scenario, request.clientRevision)
    second = default_setup(request.project, first, request.clientRevision)
    assert first.seed.roomId == "room"
    assert [v.model_dump() for v in first.vents] == [v.model_dump() for v in second.vents]


def test_default_does_not_invent_a_room_or_opposing_walls():
    request = fixture()
    request.project["rooms"] = []
    with pytest.raises(ValueError, match="enclosed measured room"):
        default_setup(request.project, request.scenario, request.clientRevision)
    request = fixture()
    request.project["rooms"][0]["vertices"] = [{"x": 0, "y": 0}, {"x": 2000, "y": 0}, {"x": 1000, "y": 2000}]
    with pytest.raises(ValueError, match="opposing planar walls"):
        default_setup(request.project, request.scenario, request.clientRevision)


def test_default_endpoint_uses_project_guards_and_returns_an_editable_scenario():
    from fastapi.testclient import TestClient
    from backend.app.main import app

    request = fixture()
    body = {"project": request.project, "scenario": request.scenario.model_dump(mode="json"), "clientRevision": request.clientRevision}
    client = TestClient(app)
    result = client.post("/climoptix/default-setup", json=body)
    assert result.status_code == 200, result.text
    assert len(result.json()["vents"]) == 2
    assert result.json()["id"] == request.scenario.id
    assert client.post("/climoptix/default-setup", content='{"value":1e999}', headers={"Content-Type": "application/json"}).status_code == 422
