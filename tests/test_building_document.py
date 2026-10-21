from copy import deepcopy
from uuid import uuid4

import pytest
from fastapi import HTTPException

from backend.app.commercial_api import _validate_project
from geometry.balustrades import BALUSTRADE_STYLES, BalustradeConfiguration, balustrade_footprint


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


@pytest.mark.parametrize("enabled", [False, True])
def test_optional_room_roofs_validate_without_mutating_the_shared_profile(enabled):
    value = project()
    roof = value["building"]["roof"]
    local = {**deepcopy(roof), "type": "MONO", "orientationDeg": 37.5, "highHeightMm": 4100}
    roof.update(roomRoofsEnabled=enabled, roomOverrides=[{"roomId": "r", "roof": local}])
    original = deepcopy(value)
    assert _validate_project(value, __import__("uuid").UUID(value["projectId"])) == (1, "Building")
    assert value == original


@pytest.mark.parametrize("change", ["missing", "duplicate", "nested", "ceiling", "disabled", "null-finish", "nan"])
def test_invalid_room_roof_definitions_are_rejected(change):
    value = project()
    local = deepcopy(value["building"]["roof"])
    entry = {"roomId": "r", "roof": local}
    value["building"]["roof"].update(roomRoofsEnabled=True, roomOverrides=[entry])
    if change == "missing":
        entry["roomId"] = "missing"
    elif change == "duplicate":
        value["building"]["roof"]["roomOverrides"].append(deepcopy(entry))
    elif change == "nested":
        local["roomOverrides"] = []
    elif change == "ceiling":
        local["ceilingHeightMm"] = 5000
    elif change == "disabled":
        local["enabled"] = False
    elif change == "null-finish":
        local["finish"] = None
    else:
        local["orientationDeg"] = float("nan")
    with pytest.raises(HTTPException) as exc:
        _validate_project(value, __import__("uuid").UUID(value["projectId"]))
    assert exc.value.status_code == 422


@pytest.mark.parametrize("style", BALUSTRADE_STYLES)
def test_floor_opening_guards_use_slab_side_offsets_and_round_trip(style):
    value = project()
    opening = value["building"]["floors"][1]["openings"][0]
    opening["balustrade"] = {"enabled": True, "style": style["id"], "heightMm": 1100, "colour": style["colour"]}
    before = deepcopy(value)
    _validate_project(value, __import__("uuid").UUID(value["projectId"]))
    assert value == before
    config = BalustradeConfiguration.model_validate(opening["balustrade"])
    shape = balustrade_footprint(opening["vertices"], config)
    reversed_shape = balustrade_footprint(list(reversed(opening["vertices"])), config)
    assert shape.is_valid and shape.area > 0
    assert shape.symmetric_difference(reversed_shape).area < 0.001
    if style["depthMm"] == 100:
        assert shape.area == pytest.approx(760000)


@pytest.mark.parametrize("change", ["wall", "void", "style", "height", "bool-height", "nan", "extra", "sharp"])
def test_floor_opening_guards_cannot_bypass_geometry_or_schema_checks(change):
    value = project()
    opening = value["building"]["floors"][1]["openings"][0]
    opening["balustrade"] = {"enabled": True, "style": "VERTICAL", "heightMm": 1100, "colour": "#394750"}
    if change == "wall":
        for point in opening["vertices"]:
            point["x"] -= 1900
    elif change == "void":
        other = deepcopy(opening)
        other["id"] = "nearby"
        other.pop("balustrade")
        other["vertices"] = [{"x": 4100, "y": 2000}, {"x": 4600, "y": 2000},
                             {"x": 4600, "y": 3500}, {"x": 4100, "y": 3500}]
        value["building"]["floors"][1]["openings"].append(other)
    elif change == "style":
        opening["balustrade"]["style"] = "unknown"
    elif change in ("height", "bool-height", "nan"):
        opening["balustrade"]["heightMm"] = (
            2200 if change == "height" else True if change == "bool-height" else float("nan")
        )
    elif change == "extra":
        opening["balustrade"]["unsafe"] = True
    else:
        opening["shape"] = "POLYGON"
        opening["vertices"] = [{"x": 2000, "y": 2000}, {"x": 4000, "y": 2000}, {"x": 2001, "y": 2060}]
    with pytest.raises(HTTPException) as exc:
        _validate_project(value, __import__("uuid").UUID(value["projectId"]))
    assert exc.value.status_code == 422


def test_guard_height_cannot_pass_through_a_custom_room_ceiling():
    value = project()
    opening = value["building"]["floors"][1]["openings"][0]
    opening["balustrade"] = {"enabled": True, "style": "GLASS", "heightMm": 2000, "colour": "#394750"}
    local = {**deepcopy(value["building"]["roof"]), "lowHeightMm": 1800, "ceilingHeightMm": 1800}
    value["building"]["roof"].update(roomRoofsEnabled=True, roomOverrides=[{"roomId": "r", "roof": local}])
    with pytest.raises(HTTPException, match="lowest clear ceiling"):
        _validate_project(value, __import__("uuid").UUID(value["projectId"]))


@pytest.mark.parametrize(
    "material",
    [
        "CLAY_TILES",
        "CONCRETE_TILES",
        "SLATE",
        "CEMENT",
        "METAL",
        "ASPHALT_SHINGLES",
        "TIMBER_SHINGLES",
        "BITUMEN",
        "CORRUGATED_METAL",
    ],
)
def test_roof_material_and_colour_are_preserved(material: str) -> None:
    value = project()
    value["building"]["roof"].update(
        enabled=True,
        orientationDeg=37.125,
        finish={"material": material, "colour": "#a65338", "tileWidthMm": 300, "tileHeightMm": 400},
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
