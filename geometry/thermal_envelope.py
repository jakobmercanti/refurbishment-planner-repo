"""Read-only insulation mapping onto analytically prepared CFD faces, in millimetres."""

import json
import math
from collections import defaultdict
from itertools import pairwise
from typing import Any

from shapely import constrained_delaunay_triangles, get_parts, unary_union
from shapely.geometry import LineString, Point, Polygon

from geometry.climoptix_domain import Domain, Region, canonical_hash, measurement
from geometry.climoptix_surface import Face, cross, dot, polygons, sub, unit
from geometry.thermal_models import ThermalSetup


def energy_floors(project: dict[str, Any]) -> dict[str, dict[str, Any]]:
    building = project.get("building")
    floors = building["floors"] if building else [{"id": "floor-ground", "elevationMm": 0, "slabThicknessMm": 200}]
    return {
        floor["id"]: {
            **floor,
            "content": project if not building or floor["id"] == building["activeFloorId"] else floor["content"],
        }
        for floor in floors
    }


def insulation_source(project: dict[str, Any]) -> dict[str, Any]:
    """Presentation and active-floor selection must not change the construction hash."""
    return {
        fid: {
            key: (floor["content"].get("energyLayout") or {}).get(key)
            for key in (
                "version",
                "materials",
                "assemblies",
                "existingAssignments",
                "scenarios",
                "activeScenarioId",
            )
        }
        for fid, floor in sorted(energy_floors(project).items())
    }


def assignments(energy: dict[str, Any], setup: ThermalSetup, floor_id: str) -> dict[str, dict[str, Any]]:
    scenario_id = setup.insulationScenarios.get(floor_id, energy.get("activeScenarioId"))
    selected = next((s for s in energy.get("scenarios", []) if s.get("scenarioId") == scenario_id), None)
    if scenario_id is not None and selected is None:
        raise ValueError(
            f"The selected insulation scenario on floor {floor_id} no longer exists. "
            "Choose an available scenario or Existing Building before refreshing."
        )
    values = [*energy.get("existingAssignments", []), *(selected.get("assignments", []) if selected else [])]
    return {a["elementId"]: a for a in values}


def _number(value: Any, label: str, minimum: float = 0, maximum: float = 1e8) -> float:
    number = measurement(value)
    if not minimum <= number <= maximum:
        raise ValueError(f"{label} is outside {minimum:g}–{maximum:g}.")
    return number


def construction(
    energy: dict[str, Any], assignment: dict[str, Any], assembly_override: str | None = None
) -> dict[str, Any]:
    aid = assembly_override or assignment.get("assemblyId")
    assembly = next((a for a in energy.get("assemblies", []) if a["assemblyId"] == aid), None)
    materials = {m["materialId"]: m for m in energy.get("materials", [])}
    layers, warnings = [], []
    estimated = False
    retained = False
    total = 0.0
    if assembly:
        total = _number(assembly["rsi"], "Inside film resistance", maximum=10) + _number(
            assembly["rse"], "Outside film resistance", maximum=10
        )
        for layer in assembly.get("layers", []):
            material = materials.get(layer["materialId"], {})
            thickness = _number(layer["thicknessMm"], "Layer thickness (mm)", maximum=3000)
            conductivity = layer.get("lambdaOverride") or material.get("lambda")
            resistance = layer.get("resistanceOverride")
            retained |= layer["materialId"] == "existing-resistance"
            estimated |= layer.get("resistanceSource") == "HEATING_ESTIMATE"
            if resistance is not None:
                resistance = _number(resistance, "Layer resistance")
            elif layer.get("lambdaOverride") is None and material.get("resistance") is not None:
                minimum = material.get("resistanceMinThicknessMm", 0)
                reference = material.get("resistanceReferenceThicknessMm")
                if thickness < minimum or (reference is not None and abs(thickness - reference) >= 0.001):
                    resistance = None
                else:
                    resistance = _number(material["resistance"], "Material resistance")
            elif conductivity is not None:
                conductivity = _number(conductivity, "Conductivity", 1e-12, 20)
                resistance = thickness / 1000 / conductivity
            layers.append(
                {
                    "layerId": layer["layerId"],
                    "name": material.get("name", "Unknown material"),
                    "thicknessMm": thickness,
                    "lambdaWMK": conductivity,
                    "rM2KW": resistance,
                    "reference": material.get("reference", ""),
                }
            )
            if resistance is not None:
                total += resistance
        if any(layer["rM2KW"] is None for layer in layers) or not layers:
            warnings.append("Construction layers are incomplete; no Heating fallback is substituted.")
    direct = None if assembly_override else assignment.get("uValue")
    if direct is None and assembly:
        direct = assembly.get("directUValue")
    calculated = bool(assembly and layers and not warnings and total > 0)
    u = _number(direct, "Declared U-value", 1e-12, 100) if direct is not None else 1 / total if calculated else None
    films_known = bool(calculated and direct is None and not retained)
    if assembly and assembly.get("notes", "").strip():
        warnings.append("Construction source note: " + assembly["notes"][:2000])
    if retained:
        warnings.append(
            "Retained whole-element resistance includes an unknown film split; enter Rsi for Robin projection."
        )
    if estimated:
        warnings.append("This assembly retains a Heating estimate, not a verified measured construction.")
    revision = canonical_hash(
        {
            "assignment": assignment,
            "assembly": assembly,
            "materials": {
                layer.get("materialId"): materials.get(layer.get("materialId"))
                for layer in (assembly or {}).get("layers", [])
            },
        }
    )
    return {
        "assemblyId": aid,
        "assemblyName": (assembly or {}).get("name", "No construction assigned"),
        "assemblyRevision": revision,
        "assemblyLayers": layers,
        "uWm2K": u,
        "rTotalM2KW": 1 / u if u else None,
        "rsi": assembly["rsi"] if films_known else None,
        "rse": assembly["rse"] if films_known else None,
        "source": "heatingEstimate"
        if estimated
        else "enteredU"
        if direct is not None
        else "insulationLayers"
        if u is not None
        else "missing",
        "warnings": warnings,
    }


def _skin_faces(report: dict[str, Any]) -> list[Face]:
    """Use freshly generated kernel triangles, never a client/display mesh."""
    patch_kinds = {p["id"]: p["kind"] for p in report["patches"]}
    points = report["surface"]["verticesMm"]
    grouped: dict[tuple[Any, ...], list[Polygon]] = defaultdict(list)
    frames: dict[tuple[Any, ...], Face] = {}
    for triangle, patch in zip(report["surface"]["triangles"], report["surface"]["trianglePatches"], strict=True):
        if patch_kinds.get(patch) in ("object", "supply", "extract"):
            continue
        a, b, c = [tuple(points[i]) for i in triangle]
        n = unit(cross(sub(b, a), sub(c, a)))
        key = (patch, *(round(v, 8) for v in n), round(dot(n, a), 5))
        if key not in frames:
            u = unit(sub(b, a))
            frames[key] = Face(patch, a, u, unit(cross(n, u)), n, Polygon())
        frame = frames[key]
        grouped[key].append(Polygon([frame.project(p) for p in (a, b, c)]))
    result = []
    for key in sorted(grouped):
        face = frames[key]
        face.polygon = unary_union(grouped[key])
        result.append(face)
    return result


def _clip_region(face: Face, region: Region, source_line: LineString | None) -> Any:
    if source_line is None:
        # Horizontal contacts are bounded by the actual adjacent footprint.
        rings = [
            [face.project((x, y, face.origin[2])) for x, y in ring.coords]
            for ring in (region.original.exterior, *region.original.interiors)
        ]
        return Polygon(rings[0], rings[1:])
    contact = source_line.intersection(region.original.boundary)
    if contact.length < 0.01:
        return Polygon()
    items = []
    for line in get_parts(contact):
        if not isinstance(line, LineString) or line.length < 0.01:
            continue
        for a, b in pairwise(line.coords):
            # Project along the wall normal to the current room's air-facing plane.
            def lift(x: float, y: float, z: float) -> tuple[float, float, float]:
                distance = dot(sub(face.origin, (x, y, z)), face.normal)
                return x + face.normal[0] * distance, y + face.normal[1] * distance, z

            try:
                top_a, top_b = region.top(*a), region.top(*b)
            except ValueError:
                # Roof edges can be inset by measured wall thickness. Resolve from
                # the covering source ceiling plane, not an arbitrary room height.
                ceilings = sorted(region.ceiling, key=lambda c: c.polygon.distance(line.centroid))
                if not ceilings:
                    continue
                top_a, top_b = ceilings[0].height(*a), ceilings[0].height(*b)
            ring = [lift(*a, region.base), lift(*b, region.base), lift(*b, top_b), lift(*a, top_a)]
            polygon = Polygon([face.project(p) for p in ring])
            if polygon.is_valid:
                items.append(polygon)
    return unary_union(items)


def _exposure_parts(
    face: Face, patch: dict[str, Any], room: Region, domain: Domain, floors: dict[str, dict[str, Any]]
) -> list[tuple[Any, str, str | None]]:
    if patch["kind"] == "slabSide" or ":passage:" in patch["id"]:
        return [(face.polygon, "internal", None)]
    remainder = face.polygon
    result = []
    wall = abs(face.normal[2]) < 1e-7 and patch["kind"] != "ceiling"
    floor = patch["kind"] == "floor"
    edge = next((edge for edge in room.edges if f"wall-{edge.index + 1:03d}" == patch["sourceId"]), None)
    if edge is None and wall:
        center = face.lift((face.polygon.centroid.x, face.polygon.centroid.y))
        edge = min(room.edges, key=lambda item: item.line.distance(Point(center[:2])))
    for other in sorted(domain.regions, key=lambda item: item.id):
        if other.id == room.id:
            continue
        same_level = other.floor_id == room.floor_id
        if wall and not same_level:
            continue
        if not wall:
            if abs(face.normal[2]) < 1 - 1e-7:
                continue  # A pitched external roof is not a horizontal inter-storey contact.
            if floor:
                underside = room.base - floors[room.floor_id]["slabThicknessMm"]
                if other.base >= room.base or not any(
                    abs(c.height(c.polygon.centroid.x, c.polygon.centroid.y) - underside) < 0.01 for c in other.ceiling
                ):
                    continue
            elif (
                abs(other.base - floors[room.floor_id]["elevationMm"] - floors[room.floor_id].get("heightMm", 0)) > 0.01
            ):
                continue
        clipped = remainder.intersection(_clip_region(face, other, edge.line if wall and edge else None))
        if clipped.area > 1e-5:
            result.append((clipped, "internal" if other.id in domain.included else "adjacent", other.id))
            remainder = remainder.difference(clipped)
    if remainder.area > 1e-5:
        lowest = min(item["elevationMm"] for item in floors.values())
        result.append((remainder, "ground" if floor and abs(room.base - lowest) < 0.01 else "outdoors", None))
    return result


def _signature_matches(saved: Any, expected: list[tuple[float, float]]) -> bool:
    if not isinstance(saved, list) or len(saved) != 2:
        return False
    try:
        return all(
            abs(measurement(saved[i][axis]) - expected[i][j])
            <= 16 * math.ulp(1.0) * max(1, abs(measurement(saved[i][axis])), abs(expected[i][j]))
            for i in (0, 1)
            for j, axis in enumerate(("x", "y"))
        )
    except (ValueError, TypeError, KeyError):
        return False


def _wall_breaks(room: Region, index: int, regions: list[Region]) -> list[float]:
    """Match existing Insulation wallAdjacencies segmentation (1 mm tolerance)."""
    line = room.edges[index].line
    a, b = line.coords[0], line.coords[-1]
    dx, dy, length = b[0] - a[0], b[1] - a[1], line.length
    breaks = {0.0, length}
    for other in regions:
        if other.id == room.id or other.floor_id != room.floor_id:
            continue
        for p, q in pairwise(other.original.exterior.coords):
            if any(abs(dx * (point[1] - a[1]) - dy * (point[0] - a[0])) / length > 1 for point in (p, q)):
                continue
            lo, hi = sorted(
                max(0, min(length, ((point[0] - a[0]) * dx + (point[1] - a[1]) * dy) / length)) for point in (p, q)
            )
            if hi - lo > 1:
                breaks.update((lo, hi))
    return sorted(breaks)


def _assembly_parts(
    face: Face,
    polygon: Any,
    patch: dict[str, Any],
    room: Region,
    values: dict[str, dict[str, Any]],
    regions: list[Region],
) -> list[tuple[Any, str, dict[str, Any], bool]]:
    if patch["kind"] == "slabSide" or ":passage:" in patch["id"]:
        return [(polygon, f"{room.id}|reveal:{patch['sourceId']}", {}, False)]
    category = "roof" if patch["kind"] in ("ceiling", "slabSide") else patch["kind"]
    if category in ("window", "door", "cap"):
        element = f"{room.id}|opening:{patch['sourceId']}"
    elif category == "wall":
        index = int(patch["sourceId"].rsplit("-", 1)[-1]) - 1
        element = f"{room.id}|wall:{index}"
    else:
        element = f"{room.id}|{category}"
    default = values.get(element, {})
    remainder, result = polygon, []
    if category == "wall":
        source = room.raw["vertices"]
        current = [
            (measurement(source[index][key]), measurement(source[(index + 1) % len(source)][key])) for key in ("x", "y")
        ]
        if default.get("geometrySignature"):
            try:
                saved = json.loads(default["geometrySignature"])
                stale = not _signature_matches(saved, [(current[0][i], current[1][i]) for i in (0, 1)])
            except (ValueError, TypeError, KeyError, IndexError):
                stale = True
        else:
            stale = False
        edge = room.edges[index]
        breaks = _wall_breaks(room, index, regions)
        for key, assignment in sorted(values.items()):
            if not key.startswith(element + ":"):
                continue
            signature = assignment.get("geometrySignature")
            if not signature:
                stale = True
                continue
            try:
                points = json.loads(signature)
                line = LineString([(p["x"], p["y"]) for p in points])
                if not edge.line.buffer(0.01).covers(line):
                    stale = True
                    continue
                segment_index = int(key.rsplit(":", 1)[-1])
                expected = [tuple(edge.line.interpolate(breaks[segment_index + i]).coords[0]) for i in (0, 1)]
                segment_stale = not _signature_matches(points, expected)
                stale = stale or segment_stale
                a, b = line.coords[0], line.coords[-1]

                def project(x: float, y: float, z: float) -> Any:
                    distance = dot(sub(face.origin, (x, y, z)), face.normal)
                    return face.project((x + face.normal[0] * distance, y + face.normal[1] * distance, z))

                strip = Polygon([project(*a, -1e7), project(*b, -1e7), project(*b, 1e7), project(*a, 1e7)])
                cut = remainder.intersection(strip)
                if cut.area > 1e-5:
                    result.append((cut, key, assignment, segment_stale))
                    remainder = remainder.difference(cut)
            except (ValueError, TypeError, KeyError, IndexError):
                stale = True
                continue
    else:
        stale = False
    if remainder.area > 1e-5:
        result.append((remainder, element, default, stale))
    return result


def face_geometry(face: Face, polygon: Any) -> tuple[list[Any], list[list[int]]]:
    vertices, triangles, lookup = [], [], {}
    for part in polygons(polygon):
        for triangle in get_parts(constrained_delaunay_triangles(part)):
            ring = list(triangle.exterior.coords)[:3]
            world = [face.lift(point) for point in ring]
            if dot(cross(sub(world[1], world[0]), sub(world[2], world[0])), face.normal) < 0:
                world.reverse()
            indices = []
            for point in world:
                key = tuple(round(value, 7) for value in point)
                if key not in lookup:
                    lookup[key] = len(vertices)
                    vertices.append(list(key))
                indices.append(lookup[key])
            triangles.append(indices)
    return vertices, triangles


def envelope_records(
    project: dict[str, Any], scenario: Any, domain: Domain, report: dict[str, Any]
) -> list[dict[str, Any]]:
    setup = scenario.thermalEnvelope or ThermalSetup()
    floors, records = energy_floors(project), []
    rooms = {room.id: room for room in domain.regions}
    patches = {patch["id"]: patch for patch in report["patches"]}
    planes: dict[str, int] = defaultdict(int)
    for face in _skin_faces(report):
        patch = patches[face.patch]
        room = rooms[patch["roomId"]]
        energy = floors[room.floor_id]["content"].get("energyLayout") or {}
        values = assignments(energy, setup, room.floor_id)
        plane = planes[face.patch]
        planes[face.patch] += 1
        for exposure_part, exposure, neighbor in _exposure_parts(face, patch, room, domain, floors):
            for part, element_id, assignment, stale in _assembly_parts(
                face, exposure_part, patch, room, values, domain.regions
            ):
                sid = f"{face.patch}:thermal:{plane}:{neighbor or exposure}:{element_id.rsplit('|', 1)[-1]}"
                override = setup.overrides.get(sid)
                original = construction(energy, assignment)
                data = (
                    construction(energy, assignment, override.assemblyId)
                    if override and override.assemblyId
                    else dict(original)
                )
                warnings = list(data.pop("warnings"))
                roof = (project.get("building") or {}).get("roof") or {}
                if roof.get("roomRoofsEnabled"):
                    roof = next((r["roof"] for r in roof.get("roomOverrides", []) if r["roomId"] == room.id), roof)
                top_floor = max(floors, key=lambda fid: floors[fid]["elevationMm"])
                if (
                    exposure == "outdoors"
                    and patch["kind"] == "ceiling"
                    and room.floor_id == top_floor
                    and roof.get("type") != "FLAT"
                    and roof.get("ceilingMode") == "FLAT"
                ):
                    exposure = "adjacent"
                    warnings.append(
                        "Flat ceiling below a pitched roof: attic coupling and geometric solar are unsupported. "
                        "Enter an explicit adjacent attic temperature or a reviewed equivalent forcing override."
                    )
                if stale:
                    data.update(uWm2K=None, rsi=None, rse=None, rTotalM2KW=None, source="missing")
                    warnings.append(
                        "The insulation assignment no longer matches its wall geometry. Reassign it in Insulation."
                    )
                boundary = assignment.get("boundary", "Auto")
                if exposure != "internal":
                    if boundary == "Adiabatic":
                        exposure = "adiabatic"
                    elif boundary == "Ground":
                        exposure = "ground"
                    elif boundary in ("Heated", "Unheated"):
                        exposure = "adjacent"
                if override:
                    if override.uWm2K is None and data["rsi"] is not None and data["rse"] is not None:
                        # Changing a known layer construction's film changes its
                        # overall U. Declaring the split of an entered overall U
                        # is different: do not add those films a second time.
                        revised = (
                            data["rTotalM2KW"]
                            - data["rsi"]
                            - data["rse"]
                            + (override.rsi if override.rsi is not None else data["rsi"])
                            + (override.rse if override.rse is not None else data["rse"])
                        )
                        if revised <= 0:
                            raise ValueError("Film overrides leave no positive construction resistance.")
                        data.update(rTotalM2KW=revised, uWm2K=1 / revised)
                    if override.exposure != "auto" and exposure != "internal":
                        if neighbor and override.exposure == "outdoors":
                            warnings.append(
                                "Known adjacent room prevents outdoor/solar classification; "
                                "use adjacent-zone conditions."
                            )
                        else:
                            exposure = override.exposure
                    if override.uWm2K is not None:
                        data.update(
                            uWm2K=override.uWm2K, rTotalM2KW=1 / override.uWm2K, rsi=None, rse=None, source="override"
                        )
                        if override.uIncludesFilms is None:
                            data["uWm2K"] = None
                            warnings.append("Declare whether the entered U includes inside and outside films.")
                    if override.rsi is not None:
                        data["rsi"] = override.rsi
                    if override.rse is not None:
                        data["rse"] = override.rse
                    if override.uWm2K is not None and override.uIncludesFilms is False:
                        if data["rsi"] is not None and data["rse"] is not None:
                            data["rTotalM2KW"] += data["rsi"] + data["rse"]
                            data["uWm2K"] = 1 / data["rTotalM2KW"]
                        else:
                            data["uWm2K"] = None
                            warnings.append(
                                "Construction-only U requires explicit inside and outside film resistances."
                            )
                normal = face.normal
                vertices, triangles = face_geometry(face, part)
                category = "roof" if patch["kind"] == "ceiling" else patch["kind"]
                overridden = bool(override)
                insulation_revision = (
                    canonical_hash({"base": original["assemblyRevision"], "selected": data["assemblyRevision"]})
                    if override and override.assemblyId
                    else original["assemblyRevision"]
                )
                stale_override = bool(override and override.acknowledgedAssemblyRevision != insulation_revision)
                if stale_override:
                    warnings.append(
                        "The source construction changed or this override is unconfirmed; "
                        "review and confirm it before applying."
                    )
                centroid = part.centroid
                records.append(
                    {
                        "surfaceId": sid,
                        "patchId": face.patch,
                        "roomId": room.id,
                        "roomName": room.name,
                        "floorId": room.floor_id,
                        "elementId": element_id,
                        "kind": patch["kind"],
                        "category": category,
                        "exposure": exposure,
                        "neighborRoomId": neighbor,
                        "areaM2": part.area * 1e-6,
                        "normal": list(normal),
                        "centroidMm": list(face.lift((centroid.x, centroid.y))),
                        "azimuthDeg": (math.degrees(math.atan2(normal[0], normal[1])) + setup.northDeg) % 360,
                        "tiltDeg": math.degrees(math.acos(max(-1, min(1, normal[2])))),
                        "verticesMm": vertices,
                        "triangles": triangles,
                        **data,
                        "insulationRevision": insulation_revision,
                        "insulationAssemblyId": original["assemblyId"],
                        "insulationAssemblyName": original["assemblyName"],
                        "insulationUWm2K": original["uWm2K"] if not stale else None,
                        "insulationRsi": original["rsi"] if not stale else None,
                        "insulationRse": original["rse"] if not stale else None,
                        "insulationAssemblyLayers": original["assemblyLayers"]
                        if override and override.assemblyId
                        else None,
                        "alpha": override.alpha if override and override.alpha is not None else setup.opaqueAbsorptance,
                        "emissivity": override.emissivity if override else None,
                        "gValue": override.gValue
                        if override and override.gValue is not None
                        else assignment.get("solarGainValue"),
                        "shadingFactor": override.shadingFactor
                        if override and override.shadingFactor is not None
                        else setup.shadingFactor,
                        "ambientC": override.ambientC
                        if override and override.ambientC is not None
                        else assignment.get("adjacentTemperatureC"),
                        "status": "stale"
                        if stale or stale_override
                        else "inapplicable"
                        if exposure in ("internal", "adiabatic")
                        else "overridden"
                        if overridden
                        else "valid"
                        if data["uWm2K"] is not None
                        else "incomplete",
                        "warnings": warnings,
                        "override": override.model_dump(mode="json") if override else None,
                        "method": override.method if override and override.method != "inherit" else setup.method,
                        "incidentWm2": None,
                        "absorbedWm2": None,
                        "transmittedW": None,
                        "equivalentC": None,
                        "conductanceWK": None,
                        "fluxWm2": None,
                        "heatW": None,
                        "cfdBC": None,
                    }
                )
                if len(records) > 6000:
                    raise ValueError(
                        "Thermal envelope supports at most 6000 split surfaces. Simplify the selected domain."
                    )
    return sorted(records, key=lambda record: record["surfaceId"])
