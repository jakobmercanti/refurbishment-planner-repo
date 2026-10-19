from copy import deepcopy
from uuid import uuid4

import pytest
from fastapi import HTTPException

from backend.app.commercial_api import _validate_project


def project() -> dict:
    points = [{"x": 0, "y": 0}, {"x": 8000, "y": 0}, {"x": 8000, "y": 6000}, {"x": 0, "y": 6000}]
    room = {"id": "r", "vertices": points, "wall_thickness": {"value": 100}}
    payload = {"rooms": [room], "floorplan": None, "assetInstances": []}
    ground = deepcopy(payload)
    ground["rooms"][0]["id"] = "ground-room"
    return {
        "schemaVersion": 1,
        "projectId": str(uuid4()),
        "name": "Building",
        "units": "mm",
        "createdAt": "2026-10-18T00:00:00Z",
        "updatedAt": "2026-10-18T00:00:00Z",
        "generated": False,
        **payload,
        "assets": [],
        "building": {
            "version": 1,
            "activeFloorId": "first",
            "floors": [
                {
                    "id": "ground",
                    "name": "Ground",
                    "elevationMm": 0,
                    "heightMm": 2600,
                    "slabThicknessMm": 200,
                    "openings": [],
                    "content": ground,
                },
                {
                    "id": "first",
                    "name": "First",
                    "elevationMm": 2600,
                    "heightMm": 2600,
                    "slabThicknessMm": 200,
                    "openings": [
                        {
                            "id": "void",
                            "name": "Stairwell",
                            "shape": "RECTANGLE",
                            "vertices": [
                                {"x": 2000, "y": 2000},
                                {"x": 4000, "y": 2000},
                                {"x": 4000, "y": 3500},
                                {"x": 2000, "y": 3500},
                            ],
                        }
                    ],
                },
            ],
            "roof": {
                "type": "GABLE",
                "lowHeightMm": 2400,
                "highHeightMm": 3400,
                "orientationDeg": 45,
                "splitFraction": 0.5,
                "thicknessMm": 180,
                "ceilingMode": "FLAT",
                "ceilingHeightMm": 2300,
            },
        },
    }


def test_cloud_validator_accepts_versioned_building_without_losing_other_floors() -> None:
    value = project()
    original = deepcopy(value)
    assert _validate_project(value, __import__("uuid").UUID(value["projectId"])) == (1, "Building")
    assert value == original


@pytest.mark.parametrize("material", ["CLAY_TILES", "CONCRETE_TILES", "SLATE", "CEMENT", "METAL"])
def test_roof_material_and_colour_are_preserved(material: str) -> None:
    value = project()
    value["building"]["roof"].update(
        enabled=True, finish={"material": material, "colour": "#a65338", "tileWidthMm": 300, "tileHeightMm": 400}
    )
    original = deepcopy(value)
    _validate_project(value, __import__("uuid").UUID(value["projectId"]))
    assert value == original


@pytest.mark.parametrize(
    "finish",
    [
        None,
        {},
        {"material": "CLAY_TILES", "colour": "red", "tileWidthMm": 300, "tileHeightMm": 400},
        {"material": "INVALID", "colour": "#ffffff", "tileWidthMm": 300, "tileHeightMm": 400},
        {"material": "SLATE", "colour": "#ffffff", "tileWidthMm": 0, "tileHeightMm": 400},
        {"material": "SLATE", "colour": "#ffffff", "tileWidthMm": 300, "tileHeightMm": float("nan")},
    ],
)
def test_invalid_roof_finishes_are_rejected(finish) -> None:
    value = project()
    value["building"]["roof"]["finish"] = finish
    with pytest.raises(HTTPException):
        _validate_project(value, __import__("uuid").UUID(value["projectId"]))


def test_roof_can_be_removed_without_removing_floors() -> None:
    value = project()
    value["building"]["roof"]["enabled"] = False
    _validate_project(value, __import__("uuid").UUID(value["projectId"]))
    assert len(value["building"]["floors"]) == 2
    value["building"]["roof"]["enabled"] = "false"
    with pytest.raises(HTTPException):
        _validate_project(value, __import__("uuid").UUID(value["projectId"]))


@pytest.mark.parametrize(
    "change",
    [
        lambda b: b.update(version=2),
        lambda b: b.update(activeFloorId="missing"),
        lambda b: b.update(activeFloorId=[]),
        lambda b: b.update(floors=[]),
        lambda b: b["floors"][0].update(heightMm=-1),
        lambda b: b["floors"][1].update(elevationMm=2700),
        lambda b: b["floors"][0].pop("content"),
        lambda b: b["floors"][1].update(content={}),
        lambda b: b["floors"][1].update(openings=b["floors"][1]["openings"] * 2),
        lambda b: b["floors"][1]["openings"][0]["vertices"][0].update(x=float("nan")),
        lambda b: b["floors"][1]["openings"][0]["vertices"][0].update(x=10000),
        lambda b: b["roof"].update(highHeightMm=2300),
        lambda b: b["roof"].update(ceilingHeightMm=3000),
        lambda b: b["roof"].update(type="DORMER"),
        lambda b: b["roof"].update(type=[]),
        lambda b: b["roof"].update(ceilingMode={}),
        lambda b: b["roof"].update(type="STEPPED", highHeightMm=2400),
        lambda b: b["floors"][0]["content"].update(assetInstances="invalid"),
        lambda b: b["floors"][0]["content"]["rooms"][0].update(id="r"),
    ],
)
def test_cloud_validator_rejects_invalid_floor_or_roof_without_writing(change) -> None:
    value = project()
    change(value["building"])
    with pytest.raises(HTTPException) as error:
        _validate_project(value, __import__("uuid").UUID(value["projectId"]))
    assert error.value.status_code == 422
