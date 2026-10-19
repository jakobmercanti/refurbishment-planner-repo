"""Versioned building envelope validation; all coordinates and heights are mm.

The existing project envelope remains v1. Exactly one floor uses its legacy
active fields; inactive floor payloads are validated by the same project API.
"""

import math
import re
from collections.abc import Callable
from typing import Any

from fastapi import HTTPException
from shapely.errors import GEOSException
from shapely.geometry import LineString, Polygon
from shapely.ops import unary_union


def validate_building(
    building: Any, document: dict[str, Any], validate_content: Callable[[dict[str, Any]], Any]
) -> None:
    def fail(message: str) -> None:
        raise HTTPException(status_code=422, detail=message)

    def number(value: Any, low: float, high: float) -> bool:
        return type(value) in (int, float) and math.isfinite(value) and low <= value <= high

    def identifier(value: Any) -> bool:
        return isinstance(value, str) and re.fullmatch(r"[\w:-]{1,150}", value) is not None

    if not isinstance(building, dict) or set(building) != {"version", "activeFloorId", "floors", "roof"}:
        fail("Invalid building document.")
    if type(building["version"]) is not int or building["version"] != 1:
        fail("Unsupported building version.")
    if not identifier(building["activeFloorId"]):
        fail("Invalid selected-floor ID.")
    floors = building["floors"]
    if not isinstance(floors, list) or not 1 <= len(floors) <= 20:
        fail("A building must have 1-20 floors.")
    ids: set[str] = set()
    entity_ids: set[str] = set()
    for index, floor in enumerate(floors):
        if not isinstance(floor, dict) or set(floor) - {
            "id",
            "name",
            "elevationMm",
            "heightMm",
            "slabThicknessMm",
            "openings",
            "content",
        }:
            fail("Invalid floor document.")
        if not identifier(floor.get("id")) or floor["id"] in ids:
            fail("Floor IDs must be unique.")
        ids.add(floor["id"])
        if not isinstance(floor.get("name"), str) or not 1 <= len(floor["name"].strip()) <= 100:
            fail("Invalid floor name.")
        if (
            not number(floor.get("elevationMm"), -1e7, 1e7)
            or not number(floor.get("heightMm"), 2000, 20000)
            or not number(floor.get("slabThicknessMm"), 20, 1000)
        ):
            fail("Invalid floor heights.")
        if index:
            previous = floors[index - 1]
            if abs(floor["elevationMm"] - previous["elevationMm"] - previous["heightMm"]) > 0.001:
                fail("Floor elevations must form a contiguous stack.")
            if previous["heightMm"] - floor["slabThicknessMm"] < 1800:
                fail("Slabs must leave at least 1800 mm clear headroom.")
        active = floor["id"] == building["activeFloorId"]
        payload = document if active else floor.get("content")
        if (active and "content" in floor) or not isinstance(payload, dict):
            fail("Only inactive floors store a content payload.")
        if not active:
            if not {"rooms", "floorplan", "assetInstances"}.issubset(payload) or set(payload) - {
                "rooms",
                "floorplan",
                "assetInstances",
                "electricalLayout",
                "heatingLayout",
                "energyLayout",
            }:
                fail("Invalid inactive floor contents.")
            base = {
                k: v
                for k, v in document.items()
                if k not in {"building", "electricalLayout", "heatingLayout", "energyLayout"}
            }
            validate_content({**base, **payload})
        owned_ids: set[str] = set()
        for room in payload.get("rooms", []):
            if not isinstance(room, dict) or not identifier(room.get("id")):
                fail("Invalid floor room ID.")
            owned_ids.add(room["id"])
            obstacles = room.get("obstacles", [])
            if not isinstance(obstacles, list):
                fail("Invalid floor objects.")
            for obstacle in obstacles:
                if not isinstance(obstacle, dict) or not identifier(obstacle.get("id")):
                    fail("Invalid floor object ID.")
                owned_ids.add(obstacle["id"])
        for instance in payload.get("assetInstances", []):
            if not isinstance(instance, dict) or not identifier(instance.get("instanceId")):
                fail("Invalid floor asset-instance ID.")
            owned_ids.add(instance["instanceId"])
        if entity_ids.intersection(owned_ids):
            fail("Different floors cannot share room or placed-object IDs.")
        entity_ids.update(owned_ids)
        openings = floor.get("openings")
        if not isinstance(openings, list) or len(openings) > 100 or (index == 0 and openings):
            fail("Invalid floor openings.")
        opening_ids: set[str] = set()
        polygons: list[Polygon] = []
        rooms = payload.get("rooms", []) or (payload.get("floorplan") or {}).get("rooms", [])
        try:
            footprint = unary_union([Polygon([(p["x"], p["y"]) for p in room["vertices"]]) for room in rooms])
            plan = payload.get("floorplan") or {}
            walls = [
                (
                    a,
                    wall["points"][i + 1],
                    wall.get("thicknessOverridesMm", {}).get(str(i), plan.get("wallThickness", 100)),
                )
                for wall in plan.get("walls", [])
                for i, a in enumerate(wall["points"][:-1])
            ]
            if not walls:
                walls = [
                    (a, room["vertices"][(i + 1) % len(room["vertices"])], room["wall_thickness"]["value"])
                    for room in rooms
                    for i, a in enumerate(room["vertices"])
                ]
            for opening in openings:
                if (
                    not isinstance(opening, dict)
                    or set(opening) != {"id", "name", "shape", "vertices"}
                    or not identifier(opening.get("id"))
                    or opening["id"] in opening_ids
                    or not isinstance(opening.get("name"), str)
                    or not 1 <= len(opening["name"].strip()) <= 100
                    or opening.get("shape") not in {"RECTANGLE", "POLYGON"}
                ):
                    fail("Invalid floor-opening document.")
                opening_ids.add(opening["id"])
                vertices = opening["vertices"]
                if (
                    not isinstance(vertices, list)
                    or not 3 <= len(vertices) <= 200
                    or any(
                        not isinstance(p, dict)
                        or set(p) != {"x", "y"}
                        or not all(number(p[a], -1e7, 1e7) for a in ("x", "y"))
                        for p in vertices
                    )
                ):
                    fail("Invalid opening coordinates.")
                poly = Polygon([(p["x"], p["y"]) for p in vertices])
                if not poly.is_valid or poly.area < 10000 or not footprint.covers(poly):
                    fail("Opening must be a simple polygon inside the slab.")
                if any(
                    math.hypot(
                        p["x"] - vertices[(i + 1) % len(vertices)]["x"], p["y"] - vertices[(i + 1) % len(vertices)]["y"]
                    )
                    < 50
                    for i, p in enumerate(vertices)
                ):
                    fail("Opening edges must be at least 50 mm.")
                if any(
                    poly.intersection(
                        LineString([(a["x"], a["y"]), (b["x"], b["y"])]).buffer(t / 2 + 10, cap_style="flat")
                    ).area
                    > 0.01
                    for a, b, t in walls
                ):
                    fail("Opening crosses or touches a wall.")
                if any(poly.intersection(other).area > 0.01 for other in polygons):
                    fail("Floor openings cannot overlap.")
                if opening["shape"] == "RECTANGLE":
                    if (
                        len(vertices) != 4
                        or any(
                            abs(p["x"] - vertices[(i + 1) % 4]["x"]) > 0.001
                            and abs(p["y"] - vertices[(i + 1) % 4]["y"]) > 0.001
                            for i, p in enumerate(vertices)
                        )
                        or min(poly.bounds[2] - poly.bounds[0], poly.bounds[3] - poly.bounds[1]) < 100
                    ):
                        fail("Rectangle openings need four axis-aligned sides of at least 100 mm.")
                polygons.append(poly)
        except (KeyError, TypeError, ValueError, GEOSException):
            fail("Invalid floor/opening geometry.")
    if building["activeFloorId"] not in ids:
        fail("Selected floor does not exist.")
    if floors[-1]["heightMm"] - floors[-1]["slabThicknessMm"] < 1800:
        fail("Top floor has insufficient clear headroom.")
    roof = building["roof"]
    required_roof = {
        "type",
        "lowHeightMm",
        "highHeightMm",
        "orientationDeg",
        "splitFraction",
        "thicknessMm",
        "ceilingMode",
        "ceilingHeightMm",
    }
    if (
        not isinstance(roof, dict)
        or not required_roof.issubset(roof)
        or set(roof) - required_roof - {"enabled", "finish"}
    ):
        fail("Invalid roof document.")
    if "enabled" in roof and type(roof["enabled"]) is not bool:
        fail("Invalid roof visibility setting.")
    if "finish" in roof:
        finish = roof["finish"]
        if (
            not isinstance(finish, dict)
            or set(finish) != {"material", "colour", "tileWidthMm", "tileHeightMm"}
            or not isinstance(finish["material"], str)
            or finish["material"]
            not in {
                "CLAY_TILES",
                "CONCRETE_TILES",
                "SLATE",
                "CEMENT",
                "METAL",
                "ASPHALT_SHINGLES",
                "TIMBER_SHINGLES",
                "BITUMEN",
                "CORRUGATED_METAL",
            }
            or not isinstance(finish["colour"], str)
            or re.fullmatch(r"#[0-9a-fA-F]{6}", finish["colour"]) is None
            or not number(finish["tileWidthMm"], 100, 2000)
            or not number(finish["tileHeightMm"], 100, 4000)
        ):
            fail("Invalid roof finish.")
    if (
        not isinstance(roof["type"], str)
        or roof["type"] not in {"FLAT", "MONO", "GABLE", "STEPPED"}
        or not isinstance(roof["ceilingMode"], str)
        or roof["ceilingMode"] not in {"FOLLOWS_ROOF", "FLAT"}
    ):
        fail("Unsupported roof or ceiling mode.")
    for key, low, high in (
        ("lowHeightMm", 1800, 20000),
        ("highHeightMm", 1800, 20000),
        ("ceilingHeightMm", 1800, 20000),
        ("thicknessMm", 20, 1000),
        ("orientationDeg", 0, 360),
        ("splitFraction", 0.05, 0.95),
    ):
        if not number(roof[key], low, high):
            fail("Invalid roof dimensions.")
    if roof["type"] in {"MONO", "GABLE"} and roof["highHeightMm"] < roof["lowHeightMm"] + 50:
        fail("Ridge/high side must rise at least 50 mm.")
    if roof["type"] == "STEPPED" and abs(roof["highHeightMm"] - roof["lowHeightMm"]) < 50:
        fail("Stepped zones must differ by at least 50 mm.")
    lowest = min(roof["lowHeightMm"], roof["highHeightMm"]) if roof["type"] == "STEPPED" else roof["lowHeightMm"]
    if roof["ceilingMode"] == "FLAT" and roof["ceilingHeightMm"] > lowest:
        fail("Flat ceiling must not pass above the roof underside.")
