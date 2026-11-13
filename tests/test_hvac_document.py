from copy import deepcopy
from uuid import UUID, uuid4

import pytest
from fastapi import HTTPException
from pydantic import ValidationError

from backend.app.commercial_api import _validate_project
from backend.app.hvac_document import HvacProject


def hvac():
    return {
        "version": 1,
        "devices": [
            {
                "vent": {"id": "supply-1", "name": "Supply 1", "role": "supply", "host": {"patchId": "unassigned"}},
                "floorId": "ground",
                "roomId": "room",
            }
        ],
        "bindings": {"case-1": {"deviceIds": ["supply-1"]}},
    }


def test_shared_hvac_roundtrip_and_unknown_pressure_outlet():
    value = hvac()
    value["devices"][0]["vent"].update(role="extract", control="pressure", valueSI=0)
    data = HvacProject.model_validate(value)
    assert data.devices[0].vent.control == "pressure"
    assert HvacProject.model_validate_json(data.model_dump_json()) == data


@pytest.mark.parametrize(
    "field,value", [("densityKgM3", 0), ("cpJKgK", -1), ("roomC", float("nan")), ("outdoorC", None)]
)
def test_invalid_conditions_fail_closed(field, value):
    data = hvac()
    data["scenarios"] = [
        {"id": "op", "name": "Winter", "floorId": "ground", "roomId": "room", "conditions": {field: value}}
    ]
    with pytest.raises(ValidationError):
        HvacProject.model_validate(data)


def test_duplicate_and_dangling_canonical_ids_are_rejected():
    data = hvac()
    data["devices"].append(deepcopy(data["devices"][0]))
    with pytest.raises(ValidationError, match="unique"):
        HvacProject.model_validate(data)


def test_invalid_scenario_flow_and_corrupt_snapshot_are_rejected():
    data = hvac()
    data["bindings"]["case-1"]["overrides"] = {"supply-1": {"valueSI": -1}}
    with pytest.raises(ValidationError, match="positive"):
        HvacProject.model_validate(data)


@pytest.mark.parametrize("mode", ["airflow", "thermal"])
def test_binding_keeps_explicit_analysis_mode(mode):
    data = hvac()
    data["bindings"]["case-1"]["analysisMode"] = mode
    assert HvacProject.model_validate(data).bindings["case-1"].analysisMode == mode


def test_domain_scope_and_bounded_overrides_match_client_contract():
    data = hvac()
    data["bindings"]["case-1"]["scopeRooms"] = [{"floorId": "ground", "roomId": "room"}]
    data["bindings"]["case-1"]["scopeSeed"] = {"floorId": "ground", "roomId": "room"}
    assert HvacProject.model_validate(data).bindings["case-1"].scopeRooms[0].roomId == "room"
    data["bindings"]["case-1"]["overrides"] = {"supply-1": {"valueSI": 1e50}}
    with pytest.raises(ValidationError):
        HvacProject.model_validate(data)
    data = hvac()
    data["snapshots"] = [
        {
            "caseId": "case-1",
            "operatingScenarioId": "op",
            "createdAt": "2026-11-02T00:00:00Z",
            "inputHash": "0" * 64,
            "boundaryJson": "broken JSON",
        }
    ]
    with pytest.raises(ValidationError):
        HvacProject.model_validate(data)
    data = hvac()
    data["bindings"]["case-1"]["deviceIds"] = ["missing"]
    with pytest.raises(ValidationError, match="shared device"):
        HvacProject.model_validate(data)


def test_cloud_project_accepts_shared_hvac_and_rejects_invalid_devices():
    project_id = uuid4()
    document = {
        "schemaVersion": 1,
        "projectId": str(project_id),
        "name": "HVAC",
        "units": "mm",
        "createdAt": "2026-11-02T00:00:00Z",
        "updatedAt": "2026-11-02T00:00:00Z",
        "generated": False,
        "rooms": [],
        "floorplan": None,
        "assets": [],
        "assetInstances": [],
        "hvac": hvac(),
    }
    assert _validate_project(document, UUID(str(project_id))) == (1, "HVAC")
    document["hvac"]["devices"][0]["vent"]["widthMm"] = -1
    with pytest.raises(HTTPException) as error:
        _validate_project(document, project_id)
    assert error.value.status_code == 422


def test_large_boundary_packages_have_a_separate_bounded_snapshot_limit():
    import json

    data = hvac()
    data["snapshots"] = [
        {
            "caseId": "case-1",
            "operatingScenarioId": "op",
            "createdAt": "2026-11-02T00:00:00Z",
            "inputHash": "0" * 64,
            "boundaryJson": json.dumps({"version": 1, "sourceInput": "x" * 150000}),
        }
    ]
    assert len(HvacProject.model_validate(data).snapshots[0].boundaryJson) > 100000
    data["snapshots"][0]["boundaryJson"] = "x" * 1500001
    with pytest.raises(ValidationError):
        HvacProject.model_validate(data)
