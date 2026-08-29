"""FreeCAD-only worker. Run with FreeCADCmd, never regular CPython."""

from __future__ import annotations

import json
import math
import os
import re
from pathlib import Path

import FreeCAD as App
import Part


def vector(point: dict[str, float], z: float = 0.0) -> App.Vector:
    return App.Vector(float(point["x"]), float(point["y"]), z)


def safe_name(prefix: str, identifier: str) -> str:
    cleaned = re.sub(r"[^A-Za-z0-9_]", "_", identifier)
    return f"{prefix}_{cleaned}"


def add_feature(document: object, group: object, name: str, label: str, shape: object) -> object:
    feature = document.addObject("PartDesign::Feature", name)
    feature.Label = label
    feature.Shape = shape
    group.addObject(feature)
    return feature


def face_from_points(points: list[App.Vector]) -> object:
    return Part.Face(Part.makePolygon([*points, points[0]]))


def edge_geometry(start: dict[str, float], end: dict[str, float]) -> tuple[float, float, float, float, float]:
    dx = float(end["x"]) - float(start["x"])
    dy = float(end["y"]) - float(start["y"])
    length = math.hypot(dx, dy)
    return dx / length, dy / length, dy / length, -dx / length, length


def opening_cut_shape(
    start: dict[str, float],
    end: dict[str, float],
    opening: dict[str, object],
    thickness: float,
) -> object:
    ux, uy, exterior_x, exterior_y, _ = edge_geometry(start, end)
    offset = float(opening["offset_mm"])
    width = float(opening["width"]["value"])
    sill = float(opening.get("sill_height_mm", 0.0))
    height = float(opening["height"]["value"])
    tolerance = 0.5
    p1 = App.Vector(
        float(start["x"]) + ux * (offset - tolerance) - exterior_x * tolerance,
        float(start["y"]) + uy * (offset - tolerance) - exterior_y * tolerance,
        sill,
    )
    p2 = App.Vector(
        float(start["x"]) + ux * (offset + width + tolerance) - exterior_x * tolerance,
        float(start["y"]) + uy * (offset + width + tolerance) - exterior_y * tolerance,
        sill,
    )
    p3 = p2 + App.Vector(exterior_x * (thickness + 2 * tolerance), exterior_y * (thickness + 2 * tolerance), 0)
    p4 = p1 + App.Vector(exterior_x * (thickness + 2 * tolerance), exterior_y * (thickness + 2 * tolerance), 0)
    return face_from_points([p1, p2, p3, p4]).extrude(App.Vector(0, 0, height))


def door_leaf_swing_shape(
    hinge_x: float,
    hinge_y: float,
    initial: float,
    direction: float,
    width: float,
    swing_angle: float,
) -> object:
    sweep = math.radians(swing_angle) * direction
    points = [App.Vector(hinge_x, hinge_y, 0)]
    for step in range(49):
        angle = initial + sweep * step / 48.0
        points.append(App.Vector(hinge_x + width * math.cos(angle), hinge_y + width * math.sin(angle), 0))
    return face_from_points(points).extrude(App.Vector(0, 0, 10.0))


def door_swing_shape(start: dict[str, float], end: dict[str, float], opening: dict[str, object]) -> object:
    ux, uy, _, _, _ = edge_geometry(start, end)
    offset = float(opening["offset_mm"])
    width = float(opening["width"]["value"])
    swing_angle = float(opening.get("swing_angle_deg", 90.0))
    inward = bool(opening.get("opens_inward"))
    start_x = float(start["x"]) + ux * offset
    start_y = float(start["y"]) + uy * offset
    end_x = start_x + ux * width
    end_y = start_y + uy * width
    if opening.get("door_type") == "DOUBLE":
        half_width = width / 2.0
        first = door_leaf_swing_shape(
            start_x,
            start_y,
            math.atan2(uy, ux),
            1.0 if inward else -1.0,
            half_width,
            swing_angle,
        )
        second = door_leaf_swing_shape(
            end_x,
            end_y,
            math.atan2(-uy, -ux),
            -1.0 if inward else 1.0,
            half_width,
            swing_angle,
        )
        return Part.makeCompound([first, second])
    hinge_at_start = opening.get("hinge_side") == "START"
    if hinge_at_start:
        hinge_x = start_x
        hinge_y = start_y
        initial = math.atan2(uy, ux)
        direction = 1.0 if inward else -1.0
    else:
        hinge_x = end_x
        hinge_y = end_y
        initial = math.atan2(-uy, -ux)
        direction = -1.0 if inward else 1.0
    return door_leaf_swing_shape(hinge_x, hinge_y, initial, direction, width, swing_angle)


def rotated_box(center: dict[str, float], dimensions: dict[str, object], base_z: float, rotation: float) -> object:
    width = float(dimensions["width"]["value"])
    depth = float(dimensions["depth"]["value"])
    height = float(dimensions["height"]["value"])
    shape = Part.makeBox(width, depth, height, App.Vector(-width / 2.0, -depth / 2.0, base_z))
    shape.Placement = App.Placement(
        App.Vector(float(center["x"]), float(center["y"]), 0),
        App.Rotation(App.Vector(0, 0, 1), rotation),
    )
    return shape


def main() -> None:
    snapshot_value = os.environ.get("RENOVATION_FIT_SNAPSHOT")
    output_value = os.environ.get("RENOVATION_FIT_OUTPUT")
    if not snapshot_value or not output_value:
        raise RuntimeError("RENOVATION_FIT_SNAPSHOT and RENOVATION_FIT_OUTPUT are required")
    snapshot_path = Path(snapshot_value)
    output_path = Path(output_value)
    data = json.loads(snapshot_path.read_text(encoding="utf-8"))
    room = data["room"]
    product = data["product"]
    placement = data["placement"]
    result = data["fit_result"]

    document = App.newDocument("RenovationFit")
    room_group = document.addObject("App::DocumentObjectGroup", "Room")
    walls_group = document.addObject("App::DocumentObjectGroup", "Walls")
    openings_group = document.addObject("App::DocumentObjectGroup", "Openings")
    fixed_group = document.addObject("App::DocumentObjectGroup", "FixedObjects")
    products_group = document.addObject("App::DocumentObjectGroup", "Products")
    clearances_group = document.addObject("App::DocumentObjectGroup", "Clearances")
    collision_group = document.addObject("App::DocumentObjectGroup", "CollisionMarkers")

    vertices = room["vertices"]
    floor_points = [vector(item, -20.0) for item in vertices]
    floor = face_from_points(floor_points).extrude(App.Vector(0, 0, 20.0))
    floor_object = add_feature(document, room_group, "InternalFloor", "Finished internal floor", floor)
    floor_object.addProperty("App::PropertyString", "AuthoritativeUnit")
    floor_object.AuthoritativeUnit = "mm"
    floor_object.addProperty("App::PropertyInteger", "RoomVersion")
    floor_object.RoomVersion = int(room["version"])

    wall_height = float(room["wall_height"]["value"])
    wall_thickness = float(room["wall_thickness"]["value"])
    wall_shapes: dict[str, object] = {}
    for index, start in enumerate(vertices):
        end = vertices[(index + 1) % len(vertices)]
        _, _, exterior_x, exterior_y, _ = edge_geometry(start, end)
        points = [
            vector(start),
            vector(end),
            App.Vector(float(end["x"]) + exterior_x * wall_thickness, float(end["y"]) + exterior_y * wall_thickness, 0),
            App.Vector(
                float(start["x"]) + exterior_x * wall_thickness, float(start["y"]) + exterior_y * wall_thickness, 0
            ),
        ]
        wall_id = f"wall-{index + 1:03d}"
        shape = face_from_points(points).extrude(App.Vector(0, 0, wall_height))
        for opening in room.get("openings", []):
            if opening["parent_wall_id"] == wall_id:
                cut = opening_cut_shape(start, end, opening, wall_thickness)
                shape = shape.cut(cut)
                opening_object = add_feature(
                    document,
                    openings_group,
                    safe_name("Opening", opening["id"]),
                    f"{opening['kind'].title()} {opening['id']} cut volume",
                    cut,
                )
                opening_object.Visibility = False
                if opening["kind"] == "DOOR":
                    swing = door_swing_shape(start, end, opening)
                    swing_object = add_feature(
                        document,
                        clearances_group,
                        safe_name("DoorSwing", opening["id"]),
                        f"Door swing {opening['id']}",
                        swing,
                    )
                    swing_object.addProperty("App::PropertyString", "EvidenceType")
                    swing_object.EvidenceType = "DETERMINISTIC_CLEARANCE_ENVELOPE"
        wall_shapes[wall_id] = shape
        wall_object = add_feature(
            document,
            walls_group,
            f"Wall_{index + 1:03d}",
            f"Wall {index + 1:03d} ({wall_id})",
            shape,
        )
        wall_object.addProperty("App::PropertyLength", "Thickness")
        wall_object.Thickness = wall_thickness
        wall_object.addProperty("App::PropertyLength", "Height")
        wall_object.Height = wall_height

    for obstacle in room.get("obstacles", []):
        shape = rotated_box(
            obstacle["center"],
            obstacle["dimensions"],
            float(obstacle.get("base_z_mm", 0.0)),
            float(obstacle.get("rotation_deg", 0.0)),
        )
        add_feature(
            document,
            fixed_group,
            safe_name("Fixed", obstacle["id"]),
            obstacle["name"],
            shape,
        )

    product_shape = rotated_box(
        placement["center"],
        product["nominal_dimensions"],
        float(placement.get("base_z_mm", 0.0)),
        float(placement.get("rotation_deg", 0.0)),
    )
    product_object = add_feature(
        document,
        products_group,
        safe_name("Product", product["sku"]),
        f"{product['manufacturer']} {product['sku']}",
        product_shape,
    )
    product_object.addProperty("App::PropertyString", "ProductVersion")
    product_object.ProductVersion = str(product["version"])
    product_object.addProperty("App::PropertyString", "FitStatus")
    product_object.FitStatus = result["status"]

    clearance = float(product.get("installation_clearance_mm", 0.0))
    if clearance > 0:
        dimensions = product["nominal_dimensions"]
        envelope_dimensions = {
            "width": {"value": float(dimensions["width"]["value"]) + 2 * clearance},
            "depth": {"value": float(dimensions["depth"]["value"]) + 2 * clearance},
            "height": {"value": 20.0},
        }
        clearance_shape = rotated_box(
            placement["center"],
            envelope_dimensions,
            float(placement.get("base_z_mm", 0.0)),
            float(placement.get("rotation_deg", 0.0)),
        )
        clearance_object = add_feature(
            document,
            clearances_group,
            "ProductInstallationEnvelope",
            f"Installation clearance {clearance:.1f} mm",
            clearance_shape,
        )
        clearance_object.addProperty("App::PropertyString", "EvidenceType")
        clearance_object.EvidenceType = "DETERMINISTIC_CLEARANCE_ENVELOPE"

    obstacle_lookup = {item["id"]: item for item in room.get("obstacles", [])}
    for index, collision in enumerate(result.get("collisions", []), start=1):
        obstacle = obstacle_lookup.get(collision["object_id"])
        if obstacle:
            marker = Part.makeSphere(
                50.0,
                App.Vector(float(obstacle["center"]["x"]), float(obstacle["center"]["y"]), 50.0),
            )
            add_feature(
                document,
                collision_group,
                f"Collision_{index:03d}",
                f"{collision['collision_type']} {collision['object_id']}",
                marker,
            )

    document.recompute()
    output_path.parent.mkdir(parents=True, exist_ok=True)
    document.saveAs(str(output_path))
    App.closeDocument(document.Name)


if __name__ == "__main__":
    main()
