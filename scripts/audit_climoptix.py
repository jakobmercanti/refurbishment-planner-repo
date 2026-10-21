"""Create portable manual-test scenes and optionally audit their real STL skins.

This developer QA tool is NOT called by the application/provider. Gmsh is an
optional local verification executable, not the application's CFD mesher.
"""

import argparse
import json
import math
from copy import deepcopy
from datetime import UTC, datetime
from pathlib import Path
from uuid import NAMESPACE_URL, uuid5
from zipfile import ZIP_DEFLATED, ZipFile

from backend.app.climoptix_provider import PreparationOnlyProvider
from geometry.climoptix_models import Scenario
from geometry.climoptix_surface import cross, sub, unit
from geometry.people import person_dimensions
from scripts.audit_cfd_assets import run_mesher


def measured(value):
    return {"value": value, "uncertainty_mm": 5, "verified": False, "source_type": "USER_MEASURED"}


def room(rid, x=0, width=4000):
    return {
        "id": rid,
        "source_floorplan_room_id": f"outline-{rid}",
        "name": rid.replace("-", " ").title(),
        "version": 1,
        "vertices": [{"x": x, "y": 0}, {"x": x + width, "y": 0}, {"x": x + width, "y": 6000}, {"x": x, "y": 6000}],
        "wall_height": measured(2400),
        "wall_thickness": measured(100),
        "openings": [],
        "obstacles": [],
    }


def plan(rooms):
    return {
        "walls": [{"id": f"wall-{r['id']}", "points": [*r["vertices"], r["vertices"][0]]} for r in rooms],
        "rooms": [
            {
                "id": r["source_floorplan_room_id"],
                "name": r["name"],
                "sourceWallId": f"wall-{r['id']}",
                "vertices": r["vertices"],
            }
            for r in rooms
        ],
        "openings": [],
        "measurements": [],
        "annotations": [],
        "dimensionOffsets": {},
        "hiddenDimensions": [],
        "canvasSize": {"width": 1100, "height": 700},
        "selectedRoomId": rooms[0]["source_floorplan_room_id"],
        "wallHeight": 2400,
        "wallThickness": 100,
        "squaredWalls": True,
        "snapEnabled": False,
        "snapSize": 100,
    }


def obstacle(oid, key, center, dimensions):
    return {
        "id": oid,
        "name": oid.replace("-", " ").title(),
        "kind": "BOX",
        "fixture_kind": "FURNITURE",
        "representation_key": key,
        "center": {"x": center[0], "y": center[1]},
        "base_z_mm": 0,
        "rotation_deg": 0,
        "verified": False,
        "dimensions": {k: measured(v) for k, v in zip(("width", "depth", "height"), dimensions, strict=True)},
    }


def example_projects():
    now = datetime.now(UTC).isoformat().replace("+00:00", "Z")
    result = {}
    for name in ("connected-passages", "open-door-stop", "two-floor-atrium", "sloping-office", "office-occupants"):
        rooms = (
            [room("living"), room("study", 4000)]
            if name in ("connected-passages", "open-door-stop")
            else [room("office", width=8000)]
        )
        pid = str(uuid5(NAMESPACE_URL, "freefloorplan3d/climoptix/examples/" + name))
        roof = {
            "type": "MONO" if name == "sloping-office" else "FLAT",
            "lowHeightMm": 2400,
            "highHeightMm": 3400,
            "orientationDeg": 0,
            "splitFraction": 0.5,
            "thicknessMm": 180,
            "ceilingMode": "FOLLOWS_ROOF",
            "ceilingHeightMm": 2400,
        }
        p = {
            "schemaVersion": 1,
            "projectId": pid,
            "name": "Climoptix · " + name.replace("-", " "),
            "units": "mm",
            "createdAt": now,
            "updatedAt": now,
            "generated": False,
            "rooms": rooms,
            "floorplan": plan(rooms),
            "assets": [],
            "assetInstances": [],
            "quotes": [],
            "building": {
                "version": 1,
                "activeFloorId": "ground",
                "floors": [
                    {
                        "id": "ground",
                        "name": "Ground Floor",
                        "elevationMm": 0,
                        "heightMm": 2600,
                        "slabThicknessMm": 200,
                        "openings": [],
                    }
                ],
                "roof": roof,
            },
        }
        if len(rooms) == 2:
            passage = name == "connected-passages"
            key = "door-opening-double" if passage else "door-single"
            p["floorplan"]["openings"] = [
                {
                    "id": "link",
                    "kind": "DOOR",
                    "wallId": "wall-living",
                    "segmentIndex": 1,
                    "offset": 2000,
                    "width": 1800,
                    "height": 2200,
                    "sill": 0,
                    "hingeSide": "START",
                    "doorType": "DOUBLE",
                    "opensInward": True,
                    "representationKey": key,
                }
            ]
            for i, r in enumerate(rooms):
                r["openings"] = [
                    {
                        "id": "link",
                        "kind": "DOOR",
                        "parent_wall_id": "wall-004" if i else "wall-002",
                        "offset_mm": 2200 if i else 2000,
                        "width": measured(1800),
                        "height": measured(2200),
                        "sill_height_mm": 0,
                        "hinge_side": "START",
                        "door_type": "DOUBLE",
                        "swing_angle_deg": 90,
                        "opens_inward": True,
                        "metadata": {"representation_key": key},
                        **({"passage_profile": "RECTANGULAR"} if passage else {}),
                    }
                ]
        if name == "two-floor-atrium":
            upper = room("upper-office", width=8000)
            p["building"]["floors"].append(
                {
                    "id": "upper",
                    "name": "Upper Floor",
                    "elevationMm": 2600,
                    "heightMm": 2600,
                    "slabThicknessMm": 200,
                    "content": {"rooms": [upper], "floorplan": plan([upper]), "assetInstances": []},
                    "openings": [
                        {
                            "id": "atrium",
                            "name": "Atrium",
                            "shape": "RECTANGLE",
                            "vertices": [
                                {"x": 3000, "y": 2200},
                                {"x": 5000, "y": 2200},
                                {"x": 5000, "y": 4200},
                                {"x": 3000, "y": 4200},
                            ],
                        }
                    ],
                }
            )
        if name in ("sloping-office", "office-occupants"):
            rooms[0]["obstacles"] = [
                obstacle("desk", "furniture-table-rectangular", (4000, 2000), (1600, 800, 750)),
                obstacle("chair", "furniture-chair-classic", (4000, 3300), (600, 600, 850)),
            ]
        data = {
            "version": 1,
            "id": "example-study",
            "name": p["name"],
            "sourceBuildingId": pid,
            "createdAt": now,
            "updatedAt": now,
            "seed": {"floorId": "ground", "roomId": rooms[0]["id"]},
            "description": "Developer example. Illustrative values only; "
            "not certified ventilation or emissions inputs.",
            "vents": [
                {
                    "id": "supply",
                    "name": "Supply",
                    "role": "supply",
                    "host": {"patchId": f"ground:{rooms[0]['id']}:ceiling:0", "u": 0.25, "v": 0.3},
                    "valueSI": 0.1,
                },
                {
                    "id": "extract",
                    "name": "Extract",
                    "role": "extract",
                    "host": {"patchId": f"ground:{rooms[0]['id']}:ceiling:0", "u": 0.75, "v": 0.7},
                    "valueSI": 0.1,
                },
            ],
        }
        if name == "office-occupants":
            standing = obstacle(
                "standing-occupant", "people-standing", (1800, 2200), person_dimensions(1800, "STANDING")
            )
            standing["person_spec"] = {
                "posture": "STANDING",
                "stature_mm": 1800,
                "style": "CASUAL",
                "seat_height_mm": 450,
            }
            seated = obstacle(
                "seated-occupant", "people-seated", (4000, 3300 - 0.16 * 1650), person_dimensions(1650, "SEATED", 450)
            )
            seated["person_spec"] = {
                "posture": "SEATED",
                "stature_mm": 1650,
                "style": "SMART",
                "seat_height_mm": 450,
                "support": {"obstacle_id": "chair", "surface_height_mm": 450, "lateral_offset_mm": 0},
            }
            rooms[0]["obstacles"].extend([standing, seated])
            data["physics"] = {"preset": "co2", "energy": True, "boussinesq": True, "co2": True}
            data["outputs"] = {"temperature": True, "co2": True}
            data["assetOverrides"] = [
                {
                    "objectId": "standing-occupant",
                    "heatW": 75,
                    "co2M3S": 0,
                    "notes": "Illustrative heat power; supply calibrated emission data.",
                },
                {
                    "objectId": "seated-occupant",
                    "mode": "sourceOnly",
                    "heatW": 75,
                    "notes": "Source only avoids overlapping person/chair solids; illustrative heat input.",
                },
            ]
        s = Scenario.model_validate(data)
        p["cfdScenarios"] = [s.model_dump(mode="json")]
        result[name] = deepcopy(p)
    return result


def stl(report):
    lines = ["solid climoptix_air_mm"]
    for tri in report["surface"]["triangles"]:
        a, b, c = [report["surface"]["verticesMm"][i] for i in tri]
        normal = unit(cross(sub(b, a), sub(c, a)))
        lines.extend(
            [
                "facet normal " + " ".join(map(str, normal)),
                "outer loop",
                *["vertex " + " ".join(map(str, p)) for p in (a, b, c)],
                "endloop",
                "endfacet",
            ]
        )
    return "\n".join([*lines, "endsolid climoptix_air_mm"])


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output-dir", type=Path, required=True)
    parser.add_argument("--gmsh", type=Path)
    args = parser.parse_args()
    args.output_dir.mkdir(parents=True, exist_ok=True)
    summary = []
    for name, p in example_projects().items():
        scenario = Scenario.model_validate(p["cfdScenarios"][0])
        report = PreparationOnlyProvider().validate_scenario(p, scenario, "a" * 64)
        errors = [d for d in report["diagnostics"] if d["severity"] == "error"]
        if errors or not report["surface"]["exportable"]:
            raise RuntimeError(f"Invalid example {name}: {errors}")
        (args.output_dir / f"{name}.json").write_text(json.dumps(p, indent=2), encoding="utf8")
        with ZipFile(args.output_dir / f"{name}.floorplan3d", "w", ZIP_DEFLATED) as package:
            package.writestr(
                "manifest.json", json.dumps({"packageVersion": 1, "builtinCatalogueVersion": 1, "project": p})
            )
        item = {
            "example": name,
            "included_rooms": report["domain"]["includedRoomIds"],
            "volume_m3": report["domain"]["volumeM3"],
            "boundary_triangles": report["surface"]["triangleCount"],
        }
        if args.gmsh:
            path = args.output_dir / f"{name}.stl"
            path.write_text(stl(report), encoding="utf8")
            geo = path.with_suffix(".geo")
            geo.write_text(
                f'Merge "{path.name}";\nsl=newsl; Surface Loop(sl)={{Surface{{:}}}};\n'
                "v=newv; Volume(v)={sl};\nPhysical Volume(1)={v};\nMesh.MshFileVersion=2.2;",
                encoding="utf8",
            )
            mesh = run_mesher(args.gmsh.resolve(), geo.resolve())
            if not math.isclose(mesh["volume_mm3"] * 1e-9, item["volume_m3"], rel_tol=1e-6):
                raise RuntimeError(f"Independent mesh volume mismatch in {name}")
            item["qa_tetrahedra"] = mesh["tetrahedra"]
        summary.append(item)
        print(json.dumps(item), flush=True)
    (args.output_dir / "audit.json").write_text(json.dumps(summary, indent=2), encoding="utf8")


if __name__ == "__main__":
    main()
