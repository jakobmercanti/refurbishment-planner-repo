"""Safe preparation-only provider. No subprocess, shell, job queue or solver claims."""

import math
from datetime import UTC, datetime
from typing import Any, Protocol

from shapely import unary_union
from shapely.geometry import Point, Polygon, box

from database.cfd_proxies import cfd_proxy_for
from geometry.cfd import build_cfd_mesh
from geometry.cfd_profiles import PROFILES
from geometry.climoptix_domain import (
    Domain,
    boundary_faces,
    canonical_hash,
    discover_domain,
    measurement,
    source_geometry,
)
from geometry.climoptix_models import (
    Boundary,
    Diagnostic,
    JobHandle,
    PreparedCase,
    ProviderCapabilities,
    ResultManifest,
    Scenario,
    Thermal,
    ValidationStamp,
)
from geometry.climoptix_surface import (
    Face,
    cross,
    face_from_ring,
    merge_planar_faces,
    polygons,
    sub,
    triangulate_skin,
)
from geometry.climoptix_workflow import refinement_cell_mm, refinement_level


class UnsupportedProviderOperation(RuntimeError):
    pass


class CFDProvider(Protocol):
    def capabilities(self) -> ProviderCapabilities: ...
    def validate_scenario(
        self, project: dict[str, Any], scenario: Scenario, client_revision: str
    ) -> dict[str, Any]: ...
    def prepare_geometry(self, project: dict[str, Any], scenario: Scenario) -> Domain: ...
    def prepare_mesh_recipe(self, scenario: Scenario, volume_m3: float) -> dict[str, Any]: ...
    def generate_case(self, scenario: Scenario) -> PreparedCase: ...
    def submit_mesh(self, scenario: Scenario) -> JobHandle: ...
    def submit_run(self, scenario: Scenario) -> JobHandle: ...
    def get_job_status(self, job_id: str) -> JobHandle: ...
    def cancel_job(self, job_id: str) -> JobHandle: ...
    def get_result_manifest(self, job_id: str) -> ResultManifest: ...


def _issue(
    items: list[Diagnostic],
    severity: str,
    group: str,
    code: str,
    message: str,
    repair: str,
    object_id: str | None = None,
) -> None:
    items.append(
        Diagnostic(severity=severity, group=group, code=code, message=message, repair=repair, objectId=object_id)
    )


def _prepare_objects(
    domain: Domain, scenario: Scenario, faces: list[Face], patches: dict[str, dict[str, Any]], project: dict[str, Any]
) -> list[dict[str, Any]]:
    result: list[dict[str, Any]] = []
    overrides = {o.objectId: o for o in scenario.assetOverrides}
    footprint_solids: list[tuple[Polygon, float, float, str]] = []
    known = set()
    for room in domain.regions:
        if room.id not in domain.included:
            continue
        for obj in room.raw.get("obstacles", []):
            oid = obj["id"]
            if oid in known:
                _issue(
                    domain.diagnostics,
                    "error",
                    "geometry",
                    "duplicate-source-object",
                    "Two source objects share an ID.",
                    "Repair the source IDs before assigning per-instance CFD settings.",
                    oid,
                )
                continue
            known.add(oid)
            key = obj.get("representation_key", "")
            spec = cfd_proxy_for("electric" if key.startswith("electrical-") else "", obj.get("fixture_kind", ""), key)
            override = overrides.get(oid)
            mode = override.mode if override else "solidProxy" if spec else "none"
            record = {
                "id": oid,
                "name": obj.get("name", "Object"),
                "roomId": room.id,
                "floorId": room.floor_id,
                "mode": mode,
                "profile": spec["profile"] if spec else None,
                "sourceTransform": {
                    "centerMm": obj["center"],
                    "rotationDeg": obj.get("rotation_deg", 0),
                    "baseMm": room.base + obj.get("base_z_mm", 0),
                },
                "heatW": override.heatW * override.count if override and mode != "none" else 0,
                "co2M3S": override.co2M3S * override.count if override and mode != "none" else 0,
                "notes": override.notes if override else "",
                "triangles": [],
                "verticesMm": [],
            }
            result.append(record)
            if mode == "none":
                continue
            cx, cy = measurement(obj["center"]["x"]), measurement(obj["center"]["y"])
            local_base = measurement(obj.get("base_z_mm", 0))
            width, depth, height = [measurement(obj["dimensions"][axis]) for axis in ("width", "depth", "height")]
            if max(abs(cx), abs(cy), abs(local_base)) > 1e7 or not all(0 < d <= 20000 for d in (width, depth, height)):
                raise ValueError(f"Object {oid} has unsupported source dimensions or coordinates.")
            if key.startswith(("electrical-", "door-", "window-", "furniture-stair-")):
                _issue(
                    domain.diagnostics,
                    "error",
                    "geometry",
                    "ineligible-object",
                    "This asset is not a CFD obstruction.",
                    "Exclude it; use a real slab void or a boundary condition instead.",
                    oid,
                )
                continue
            if mode == "porousProxy":
                _issue(
                    domain.diagnostics,
                    "error",
                    "physics",
                    "porous-not-supported",
                    "Porous resistance is not implemented by this provider.",
                    "Use a solid proxy, source-only or exclude the object.",
                    oid,
                )
                continue
            offset = override.offsetMm if override else (0, 0, 0)
            source_point = (
                cx + offset[0],
                cy + offset[1],
                room.base + local_base + offset[2] + height / 2,
            )
            record["sourcePointMm"] = source_point
            if not room.air.covers(Point(source_point[:2])) or not room.base <= source_point[2] <= room.top(
                *source_point[:2]
            ):
                _issue(
                    domain.diagnostics,
                    "error",
                    "geometry",
                    "source-outside-domain",
                    "The effective source location lies outside its air region.",
                    "Review source dimensions, placement and the CFD-only offset.",
                    oid,
                )
                continue
            if mode == "sourceOnly":
                continue
            if spec is None:
                spec = {"profile": "block"}
                record["profile"] = "block"
                _issue(
                    domain.diagnostics,
                    "warning",
                    "geometry",
                    "bounding-box-fallback",
                    "No catalogue proxy exists; a conservative box is used.",
                    "Review its obstruction and clearances before any future solver export.",
                    oid,
                )
            mesh = build_cfd_mesh(str(spec["profile"]), width, depth, height)
            record["assumptions"] = list(mesh.assumptions)
            angle = math.radians(measurement(obj.get("rotation_deg", 0)) % 360)
            cos, sin = math.cos(angle), math.sin(angle)
            offset = override.offsetMm if override else (0, 0, 0)
            base = room.base + measurement(obj.get("base_z_mm", 0)) + offset[2]
            vertices = []
            for x, y, z in mesh.vertices_mm:
                # Catalogue local +y is scene +Z; source plan +y is scene -Z.
                x, y = x - width / 2, depth / 2 - y
                vertices.append(
                    (
                        obj["center"]["x"] + offset[0] + cos * x - sin * y,
                        obj["center"]["y"] + offset[1] + sin * x + cos * y,
                        base + z,
                    )
                )
            record["verticesMm"], record["triangles"] = vertices, mesh.triangles
            footprint = unary_union(
                [
                    Polygon(
                        [
                            (vertices[a][0], vertices[a][1]),
                            (vertices[b][0], vertices[b][1]),
                            (vertices[c][0], vertices[c][1]),
                        ]
                    )
                    for a, b, c in mesh.triangles
                ]
            )
            if not room.air.covers(footprint) or any(
                z > room.top(x, y) + 0.01 or z < room.base - 0.01 for x, y, z in vertices
            ):
                _issue(
                    domain.diagnostics,
                    "error",
                    "geometry",
                    "object-outside-domain",
                    "A solid proxy crosses a wall, floor or interior ceiling.",
                    "Move/resize the source asset, adjust the CFD offset or exclude it.",
                    oid,
                )
                continue
            object_parts = []
            for solid in PROFILES[str(spec["profile"])].solids():
                points = []
                for px, py in solid.footprint:
                    px, py = (px - 0.5) * width, (0.5 - py) * depth
                    points.append(
                        (
                            obj["center"]["x"] + offset[0] + cos * px - sin * py,
                            obj["center"]["y"] + offset[1] + sin * px + cos * py,
                        )
                    )
                object_parts.append((Polygon(points), base + solid.bottom * height, base + solid.top * height, oid))
            collided = set()
            for part, part_bottom, part_top, _ in object_parts:
                for previous, bottom, top, other_id in footprint_solids:
                    if min(top, part_top) - max(bottom, part_bottom) > 0.01 and part.intersection(previous).area > 0.01:
                        collided.add(other_id)
            for other_id in collided:
                _issue(
                    domain.diagnostics,
                    "error",
                    "geometry",
                    "object-overlap",
                    f"Solid proxies overlap ({other_id}).",
                    "Review support contact, use a source-only occupant, or separate/exclude proxies. "
                    "Automatic unions are not assumed.",
                    oid,
                )
            footprint_solids.extend(object_parts)
            pid = f"{room.floor_id}:{room.id}:object:{oid}"
            patches[pid] = {
                "id": pid,
                "kind": "object",
                "roomId": room.id,
                "floorId": room.floor_id,
                "sourceId": oid,
                "hostable": False,
            }
            contacts = []
            floor = next(f for f in faces if f.patch == f"{room.floor_id}:{room.id}:floor")
            for a, b, c in mesh.triangles:
                ring = [vertices[a], vertices[b], vertices[c]]
                n = cross(sub(ring[1], ring[0]), sub(ring[2], ring[0]))
                # Coordinate reflection inverted the catalogue winding. Fluid
                # surface points INTO the obstruction, restoring that winding.
                if all(abs(p[2] - room.base) < 1e-5 for p in ring):
                    contact = Polygon([(p[0], p[1]) for p in ring])
                    if floor.polygon.covers(contact):
                        contacts.append(contact)
                        continue
                faces.append(face_from_ring(pid, ring, n))
            if contacts:
                floor.polygon = floor.polygon.difference(unary_union(contacts))
            if len(faces) > 6000:
                raise ValueError("The obstruction skin exceeds 6000 faces. Simplify or exclude objects.")
            if override and (override.count > 1):
                _issue(
                    domain.diagnostics,
                    "warning",
                    "physics",
                    "source-count-not-geometry",
                    "Count multiplies emissions, not geometric copies.",
                    "Place separate source assets if distinct obstructions are required.",
                    oid,
                )
    included_floors = {r.floor_id for r in domain.regions if r.id in domain.included}
    for floor in source_geometry(project)["floors"]:
        if floor["id"] not in included_floors:
            continue
        for instance in floor["assetInstances"]:
            oid = instance["instanceId"]
            known.add(oid)
            override = overrides.get(oid)
            result.append(
                {
                    "id": oid,
                    "name": "Imported visual model",
                    "roomId": "unresolved",
                    "floorId": floor["id"],
                    "mode": override.mode if override else "none",
                    "profile": None,
                    "heatW": 0,
                    "co2M3S": 0,
                    "notes": "Requires a measured obstruction adapter, not an inferred display mesh.",
                    "verticesMm": [],
                    "triangles": [],
                }
            )
            if override is None or override.mode != "none":
                _issue(
                    domain.diagnostics,
                    "error",
                    "geometry",
                    "imported-asset-adapter-pending",
                    "A placed visual model has no measured CFD obstruction adapter.",
                    "Explicitly confirm Excluded in Equipment, or wait for the imported-model adapter.",
                    oid,
                )
    for oid in overrides.keys() - known:
        _issue(
            domain.diagnostics,
            "warning",
            "geometry",
            "stale-object-reference",
            "An override refers to an object outside the current domain or deleted from the building.",
            "Remove it or select a seed whose domain contains the object.",
            oid,
        )
    for void in domain.floor_voids:
        if (void.get("balustrade") or {}).get("enabled") and void["upper"] in domain.included:
            _issue(
                domain.diagnostics,
                "error",
                "geometry",
                "assembled-guard-pending",
                "This slab void has an assembled balustrade not yet included in the fluid skin.",
                "Nominal proxies exist, but assembled guard contact handling needs the next geometry adapter. "
                "Surface export is blocked.",
                void["id"],
            )
    return result


def _host_manifest(face: Face) -> dict[str, Any]:
    x, y, u, v = face.polygon.bounds
    return {
        "originMm": face.lift((x, y)),
        "uAxis": face.u,
        "vAxis": face.v,
        "normal": face.normal,
        "widthMm": u - x,
        "heightMm": v - y,
        "polygonsMm": [
            [[(a - x, b - y) for a, b in ring.coords] for ring in (p.exterior, *p.interiors)]
            for p in polygons(face.polygon)
        ],
    }


def _prepare_vents(
    domain: Domain, scenario: Scenario, faces: list[Face], patches: dict[str, dict[str, Any]]
) -> list[dict[str, Any]]:
    result = []
    occupied: dict[str, list[tuple[Polygon, float]]] = {}
    hosts: dict[str, list[Face]] = {}
    for face in faces:
        if patches[face.patch]["hostable"] and face.polygon.area > 1e-6:
            hosts.setdefault(face.patch, []).append(face)
    for pid, host_faces in hosts.items():
        # A split non-planar host is deliberately not advertised as one plane.
        if len(host_faces) == 1:
            patches[pid]["host"] = _host_manifest(host_faces[0])
        else:
            patches[pid]["hostable"] = False
    # Shapely geometries are immutable. Retain the original eligible face while
    # host.polygon is progressively perforated for the actual fluid boundary.
    original_hosts = {pid: group[0].polygon for pid, group in hosts.items() if len(group) == 1}
    for vent in scenario.vents:
        candidates = hosts.get(vent.host.patchId, [])
        if len(candidates) != 1:
            _issue(
                domain.diagnostics,
                "error",
                "vents",
                "missing-vent-host",
                "Vent host is missing, non-planar or outside the selected domain.",
                "Select a current planar wall, floor or interior ceiling face.",
                vent.id,
            )
            continue
        host = candidates[0]
        # Normalised u/v are anchored to the ORIGINAL host bounds, not a
        # progressively perforated face; adding another vent must not move it.
        manifest = patches[vent.host.patchId]["host"]
        minx, miny = host.project(tuple(manifest["originMm"]))
        width, height = manifest["widthMm"], manifest["heightMm"]
        x, y = minx + vent.host.u * width, miny + vent.host.v * height
        if vent.shape == "circle":
            hole = Point(x, y).buffer(vent.diameterMm / 2, quad_segs=16)
            actual = math.pi * (vent.diameterMm * 0.001) ** 2 / 4
        else:
            from shapely.affinity import rotate

            hole = rotate(
                box(x - vent.widthMm / 2, y - vent.heightMm / 2, x + vent.widthMm / 2, y + vent.heightMm / 2),
                vent.rotationDeg,
                origin=(x, y),
            )
            actual = vent.widthMm * vent.heightMm * 1e-6
        if not original_hosts[vent.host.patchId].covers(hole.buffer(vent.edgeClearanceMm)):
            _issue(
                domain.diagnostics,
                "error",
                "vents",
                "vent-outside-host",
                "Vent touches a host edge, door/window cap, void or obstruction.",
                "Move it inwards, reduce its dimensions or increase spacing.",
                vent.id,
            )
            continue
        spacing = max(vent.edgeClearanceMm, vent.optimization.minSpacingMm)
        if any(
            hole.buffer(max(spacing, other_spacing)).intersects(other)
            for other, other_spacing in occupied.get(vent.host.patchId, [])
        ):
            _issue(
                domain.diagnostics,
                "error",
                "vents",
                "vent-spacing",
                "Vent spacing is smaller than either device's required clearance.",
                "Separate vents or explicitly reduce the minimum spacing.",
                vent.id,
            )
            continue
        if vent.optimization.allowablePolygon:
            region = Polygon(vent.optimization.allowablePolygon)
            if not region.is_valid or not region.covers(Point(vent.host.u, vent.host.v)):
                _issue(
                    domain.diagnostics,
                    "error",
                    "vents",
                    "vent-allowable-region",
                    "Vent lies outside a valid allowable movement polygon.",
                    "Correct the normalized host-local polygon or move the vent.",
                    vent.id,
                )
        occupied.setdefault(vent.host.patchId, []).append((hole, spacing))
        pid = f"vent:{vent.id}"
        faces.append(Face(pid, host.origin, host.u, host.v, host.normal, hole))
        host.polygon = host.polygon.difference(hole)
        patches[pid] = {
            "id": pid,
            "kind": vent.role,
            "roomId": patches[vent.host.patchId]["roomId"],
            "floorId": patches[vent.host.patchId]["floorId"],
            "sourceId": vent.id,
            "hostable": False,
        }
        effective = actual * vent.openAreaFraction
        yaw, pitch = math.radians(vent.yawDeg), math.radians(vent.pitchDeg)
        sign = -1 if vent.role == "supply" else 1
        direction = [
            sign * host.normal[i] * math.cos(yaw) * math.cos(pitch)
            + host.u[i] * math.sin(yaw) * math.cos(pitch)
            + host.v[i] * math.sin(pitch)
            for i in range(3)
        ]
        if abs(math.cos(yaw) * math.cos(pitch)) < 1e-6:
            _issue(
                domain.diagnostics,
                "error",
                "vents",
                "tangent-jet",
                "Jet direction is tangential to its aperture.",
                "Use yaw and pitch below 90° so the device has a normal flow component.",
                vent.id,
            )
        rho = scenario.physics.densityKgM3
        flow = (
            vent.valueSI
            if vent.control == "volumeFlow"
            else vent.valueSI / rho
            if vent.control == "massFlow"
            else vent.valueSI * effective
            if vent.control == "velocity"
            else None
        )
        result.append(
            {
                "id": vent.id,
                "patchId": pid,
                "actualAreaM2": actual,
                "effectiveAreaM2": effective,
                "dischargeCoefficient": vent.dischargeCoefficient,
                "volumeFlowM3S": flow,
                "meanVelocityMS": flow / effective if flow is not None else None,
                "centerMm": host.lift((x, y)),
                "outwardNormal": host.normal,
                "jetDirection": direction,
                "role": vent.role,
            }
        )
    return result


def _resolve_boundaries(
    scenario: Scenario, domain: Domain, patches: dict[str, dict[str, Any]], objects: list[dict[str, Any]]
) -> None:
    devices = {f"vent:{v.id}": v for v in scenario.vents}
    assets = {a.objectId: a for a in scenario.assetOverrides}
    powers = {o["id"]: o["heatW"] for o in objects}
    collections = {pid: group for group in scenario.boundaries.collections if group.id != "all-surfaces" for pid in group.patchIds}
    default_group = next((g for g in scenario.boundaries.collections if g.id == "all-surfaces"), None)
    for pid, patch in patches.items():
        kind = patch["kind"]
        collection = collections.get(pid, default_group)
        group_bc = (collection.boundary if collection and collection.boundary is not None else
                    default_group.boundary if default_group else None)
        bc = scenario.boundaries.patches.get(pid) or group_bc or scenario.boundaries.groups.get(kind)
        condition_group = collection if collection and collection.boundary is not None else default_group
        origin = ("patch override" if pid in scenario.boundaries.patches else
                  f"boundary group: {condition_group.name}" if group_bc and condition_group else
                  "group preset" if bc else "sample default")
        if kind in ("supply", "extract"):
            vent = devices[pid]
            bc = Boundary.model_validate(
                {
                    "flow": {"type": vent.control, "value": vent.valueSI},
                    "thermal": {
                        "type": "temperature" if vent.role == "supply" and scenario.physics.energy else "adiabatic",
                        "value": vent.temperatureK if vent.role == "supply" and scenario.physics.energy else 0,
                    },
                    "scalarPpm": vent.co2Ppm,
                    "scalarType": "concentration" if vent.role == "supply" and scenario.physics.co2 else "zeroFlux",
                    "turbulenceIntensity": vent.turbulenceIntensity,
                    "turbulenceLengthM": vent.turbulenceLengthM,
                }
            )
            origin = "vent control"
        if bc is None:
            portal = next((p for p in domain.portals if p.id == patch["sourceId"]), None)
            if kind == "cap" or (kind in ("door", "window") and portal and portal.raw.get("swing_angle_deg", 0) > 0):
                bc = Boundary.model_validate({"flow": {"type": "opening", "value": 0}})
                origin = "open-cap suggestion; review"
            else:
                bc = Boundary()
        if kind == "object":
            asset = assets.get(patch["sourceId"])
            if asset and asset.temperatureK is not None:
                if (pid in scenario.boundaries.patches or group_bc) and bc.thermal.type != "adiabatic":
                    _issue(
                        domain.diagnostics,
                        "error",
                        "boundaries",
                        "object-thermal-conflict",
                        "A fixed object temperature conflicts with a per-patch thermal condition.",
                        "Keep one controlling thermal input: the instance setting or its patch override.",
                        pid,
                    )
                bc = bc.model_copy(update={"thermal": Thermal(type="temperature", value=asset.temperatureK)})
                origin = "asset temperature"
            heat = powers.get(patch["sourceId"], 0)
            if heat > 0:
                if (pid in scenario.boundaries.patches or group_bc) and bc.thermal.type != "adiabatic":
                    _issue(
                        domain.diagnostics,
                        "error",
                        "boundaries",
                        "object-thermal-conflict",
                        "An object heat-power input conflicts with a per-patch thermal condition.",
                        "Remove that patch override or the object's power input; do not over-constrain the source.",
                        pid,
                    )
                flux = heat / patch["areaM2"] if patch["areaM2"] > 0 else math.inf
                if not math.isfinite(flux) or flux > 1e6:
                    _issue(
                        domain.diagnostics,
                        "error",
                        "physics",
                        "object-flux-range",
                        "Object heat power exceeds the supported exposed-surface heat-flux range.",
                        "Review power, count, dimensions and units.",
                        patch["sourceId"],
                    )
                else:
                    bc = bc.model_copy(update={"thermal": Thermal(type="heatFlux", value=flux)})
                    origin = "asset power / exposed surface"
        patch["boundary"], patch["boundaryOrigin"] = bc.model_dump(), origin
        if kind in ("wall", "object", "floor", "ceiling", "slabSide") and bc.flow.type in (
            "volumeFlow",
            "massFlow",
            "velocity",
            "pressure",
            "opening",
        ):
            _issue(
                domain.diagnostics,
                "error",
                "boundaries",
                "flow-on-solid",
                "Flow inlet/outlet assigned to an ordinary solid patch.",
                "Place a vent or use a physically appropriate wall condition.",
                pid,
            )
        if origin == "sample default" or origin.startswith("open-cap suggestion"):
            patch["needsReview"] = True
    for pid in scenario.boundaries.patches.keys() - patches.keys():
        _issue(
            domain.diagnostics,
            "warning",
            "boundaries",
            "orphan-boundary",
            "A patch override no longer matches current geometry.",
            "Remove the override or reassign it to the current patch.",
            pid,
        )
    for pid in collections.keys() - patches.keys():
        _issue(domain.diagnostics, "warning", "boundaries", "orphan-boundary-group",
               "A grouped surface no longer matches the current geometry.",
               "Review the boundary group and remove or reassign this surface.", pid)


class PreparationOnlyProvider:
    def capabilities(self) -> ProviderCapabilities:
        return ProviderCapabilities()

    def prepare_geometry(self, project: dict[str, Any], scenario: Scenario) -> Domain:
        return discover_domain(project, scenario)

    def prepare_mesh_recipe(self, scenario: Scenario, volume_m3: float) -> dict[str, Any]:
        base = volume_m3 / (scenario.mesh.baseCellMm * 0.001) ** 3
        return {
            "kind": "meshIntent",
            "recipe": scenario.mesh.model_dump(mode="json"),
            "estimate": {
                "baseCells": math.ceil(max(base, 0)),
                "rangeCells": [math.ceil(max(base, 0)), math.ceil(max(base, 0) * 8)],
                "memoryRangeGb": [base * 1500 / 1e9, base * 8 * 4000 / 1e9],
                "disclaimer": "Order-of-magnitude estimate only; refinements, layers and mesher behaviour are unknown. "
                "No cells have been generated.",
            },
            "achievedQuality": None,
        }

    def validate_scenario(self, project: dict[str, Any], scenario: Scenario, client_revision: str) -> dict[str, Any]:
        domain = self.prepare_geometry(project, scenario)
        faces, patches = boundary_faces(domain)
        objects = _prepare_objects(domain, scenario, faces, patches, project)
        faces = [face for face in faces if face.polygon.area > 1e-6]
        live_ids = {face.patch for face in faces}
        patches = {pid: patch for pid, patch in patches.items() if pid in live_ids}
        vents = _prepare_vents(domain, scenario, faces, patches)
        faces = merge_planar_faces(faces)
        faces_by_patch: dict[str, list[Face]] = {}
        for face in faces:
            faces_by_patch.setdefault(face.patch, []).append(face)
        for pid, patch in patches.items():
            matching = faces_by_patch.get(pid, [])
            patch["areaM2"] = sum(f.polygon.area for f in matching) * 1e-6
            patch["normal"] = matching[0].normal if matching else (0, 0, 0)
            patch["label"] = (
                "Wall " + patch["sourceId"].rsplit("-", 1)[-1].lstrip("0")
                if patch["kind"] == "wall" and patch["sourceId"].startswith("wall-")
                else "Ceiling zone " + str(int(pid.rsplit(":", 1)[-1]) + 1)
                if ":ceiling:" in pid
                else patch["kind"].replace("slabSide", "Slab void side").title()
            )
        _resolve_boundaries(scenario, domain, patches, objects)
        skin = triangulate_skin(faces)
        if not skin["closed"]:
            _issue(
                domain.diagnostics,
                "error",
                "geometry",
                "non-manifold-skin",
                "The derived air skin is not closed, consistently oriented and manifold.",
                "Inspect source layout, apertures and contacts. Surface export is blocked; "
                "no automatic healing is performed.",
            )
        if scenario.sourceBuildingId != project["projectId"]:
            _issue(
                domain.diagnostics,
                "error",
                "geometry",
                "wrong-source-building",
                "Scenario references another project.",
                "Import/rebind the scenario explicitly.",
            )
        if not scenario.vents:
            _issue(
                domain.diagnostics,
                "warning",
                "vents",
                "no-vents",
                "No supply/extract devices are defined.",
                "Add vents or define an intentional natural-ventilation/closed-domain case.",
            )
        elif not {"supply", "extract"} <= {v["role"] for v in vents}:
            _issue(
                domain.diagnostics,
                "warning",
                "vents",
                "missing-flow-role",
                "Supply or extract is missing.",
                "Check pressure/opening boundaries and intended ventilation paths.",
            )
        supply = sum(v["volumeFlowM3S"] or 0 for v in vents if v["role"] == "supply")
        extract = sum(v["volumeFlowM3S"] or 0 for v in vents if v["role"] == "extract")
        pressure = any(p["boundary"]["flow"]["type"] in ("pressure", "opening") for p in patches.values())
        if (
            not pressure
            and max(supply, extract) > 0
            and abs(supply - extract) / max(supply, extract) > scenario.physics.numerics.balanceTolerance
        ):
            _issue(
                domain.diagnostics,
                "warning",
                "vents",
                "flow-imbalance",
                "Specified supply and extract flows are imbalanced without a pressure/opening boundary.",
                "Balance flows or provide a physically justified pressure path.",
            )
        if scenario.physics.energy is False and any(o["heatW"] > 0 for o in objects):
            _issue(
                domain.diagnostics,
                "error",
                "physics",
                "heat-needs-energy",
                "Heat sources are defined but energy is disabled.",
                "Enable energy/buoyancy or remove the heat sources.",
            )
        if not scenario.physics.energy and any(
            p["boundary"]["thermal"]["type"] != "adiabatic" for p in patches.values()
        ):
            _issue(
                domain.diagnostics,
                "error",
                "physics",
                "thermal-bc-needs-energy",
                "Thermal boundary conditions are defined but energy is disabled.",
                "Enable the energy equation or use adiabatic boundary intent.",
            )
        active_objects = {o["id"] for o in objects if o["mode"] != "none"}
        for override in scenario.assetOverrides:
            if override.objectId in active_objects and (
                override.radiantFraction > 0 or override.schedule != "constant"
            ):
                _issue(
                    domain.diagnostics,
                    "warning",
                    "physics",
                    "future-source-model",
                    "Radiation fractions and nonconstant source schedules are saved metadata only.",
                    "Their solver/source mapping is not implemented; review before future case generation.",
                    override.objectId,
                )
        if scenario.physics.co2 and any(
            o["mode"] != "none" and str(o["profile"]).startswith("person") and o["co2M3S"] == 0 for o in objects
        ):
            _issue(
                domain.diagnostics,
                "warning",
                "physics",
                "occupant-emission-review",
                "An included occupant has no calibrated CO₂ emission input.",
                "Set a reviewed pure-CO₂ m³/s rate, or confirm that a zero source is intentional.",
            )
        if any(v.recirculationPair for v in scenario.vents):
            _issue(
                domain.diagnostics,
                "warning",
                "vents",
                "recirculation-metadata",
                "Recirculation links are metadata, not a connected fan or air-handling model.",
                "Review paired supply/return mass, thermal and fresh-air balance before a future solver mapping.",
            )
        if not scenario.physics.co2 and any(o["co2M3S"] > 0 for o in objects):
            _issue(
                domain.diagnostics,
                "error",
                "physics",
                "source-needs-co2",
                "CO₂ sources are defined but scalar transport is disabled.",
                "Enable CO₂ or remove its sources.",
            )
        for output, enabled in (("temperature", scenario.physics.energy), ("co2", scenario.physics.co2)):
            if getattr(scenario.outputs, output) and not enabled:
                _issue(
                    domain.diagnostics,
                    "error",
                    "outputs",
                    "inactive-output",
                    f"{output} output requires its transport equation.",
                    "Enable the equation or deselect this output.",
                )
        solid_ids = {obj["id"] for obj in objects if obj["mode"] == "solidProxy"}
        for name in ("ventCellMm", "jetCellMm", "openingCellMm", "objectCellMm", "wakeCellMm", "wallCellMm"):
            if not scenario.mesh.minCellMm <= getattr(scenario.mesh, name) <= scenario.mesh.maxCellMm:
                _issue(
                    domain.diagnostics,
                    "error",
                    "mesh",
                    "local-cell-range",
                    f"{name} lies outside the recipe's minimum/maximum cell size.",
                    "Reconcile the local target and global limits in the advanced mesh intent controls.",
                )
        for region in scenario.mesh.refinements:
            if region.shape == "object" and region.objectId not in solid_ids:
                _issue(
                    domain.diagnostics,
                    "error",
                    "mesh",
                    "missing-refinement-object",
                    "An object refinement has no included solid proxy.",
                    "Select an included object, or use a box/sphere region for a source-only object.",
                    region.id,
                )
            if region.shape == "sphere" and max(region.sizeMm) - min(region.sizeMm) > 1e-6:
                _issue(
                    domain.diagnostics,
                    "error",
                    "mesh",
                    "invalid-sphere-refinement",
                    "A spherical refinement needs equal X/Y/Z diameters.",
                    "Use equal size components.",
                    region.id,
                )
            nominal_cell = refinement_cell_mm(scenario.mesh, region)
            targets = [nominal_cell, region.cellMm] if region.level is None else [nominal_cell]
            if any(not scenario.mesh.minCellMm <= target <= scenario.mesh.maxCellMm for target in targets):
                _issue(
                    domain.diagnostics,
                    "error",
                    "mesh",
                    "refinement-cell-range",
                    f"Level {refinement_level(scenario.mesh, region)} has a nominal {nominal_cell:g} mm cell; "
                    "the requested or rounded size lies outside the recipe's minimum/maximum.",
                    "Reconcile the requested target, discrete refinement level and global cell-size limits.",
                    region.id,
                )
            if refinement_level(scenario.mesh, region) > 10:
                _issue(
                    domain.diagnostics,
                    "error",
                    "mesh",
                    "refinement-level-range",
                    "A cell target needs more than 10 snappyHexMesh levels.",
                    "Increase its cell size.",
                    region.id,
                )
        for field in scenario.postProcessing.fields:
            if (field == "T" and not scenario.physics.energy) or (field == "CO2" and not scenario.physics.co2):
                _issue(
                    domain.diagnostics,
                    "error",
                    "outputs",
                    "inactive-slice-field",
                    f"Slice field {field} requires its transport equation.",
                    "Enable the equation or deselect the field.",
                )
        for probe in scenario.outputs.probesMm:
            if not any(
                r.id in domain.included and r.air.covers(Point(probe[:2])) and r.base <= probe[2] <= r.top(*probe[:2])
                for r in domain.regions
            ):
                in_void = any(
                    {v["lower"], v["upper"]} <= domain.included
                    and v["polygon"].covers(Point(probe[:2]))
                    and v["bottom"] <= probe[2] <= v["top"]
                    for v in domain.floor_voids
                )
                if not in_void:
                    _issue(
                        domain.diagnostics,
                        "warning",
                        "outputs",
                        "probe-outside-room-core",
                        "A probe is outside the included room cores (it may be in a passage reveal).",
                        "Review its millimetre coordinates against the air skin before future solver submission.",
                    )
        if scenario.physics.mode == "transient" and scenario.physics.numerics.coupling != "PIMPLE":
            _issue(
                domain.diagnostics,
                "warning",
                "physics",
                "transient-coupling",
                "Transient mode uses a steady coupling intent.",
                "Review the planned solver; PIMPLE is the transient preset.",
            )
        if scenario.physics.turbulence == "laminar" and scenario.mesh.layers.enabled:
            _issue(
                domain.diagnostics,
                "warning",
                "mesh",
                "laminar-yplus",
                "Target y+ is a wall-model intention, not an achieved laminar quantity.",
                "Review layer spacing using the actual viscous scales.",
            )
        volume = float(skin["volumeM3"])
        recipe = self.prepare_mesh_recipe(scenario, volume)
        if recipe["estimate"]["baseCells"] > scenario.mesh.maxCells:
            _issue(
                domain.diagnostics,
                "error",
                "mesh",
                "cell-budget",
                "Even the uniform base-cell estimate exceeds the hard cell budget.",
                "Increase cell size or raise the reviewed budget.",
            )
        if recipe["estimate"]["memoryRangeGb"][1] > scenario.resources.memoryGb:
            _issue(
                domain.diagnostics,
                "warning",
                "resources",
                "memory-budget",
                "The upper uncertain memory estimate exceeds the requested memory.",
                "Reduce refinements or review resources before connecting a mesher.",
            )
        if any(p.get("needsReview") for p in patches.values()):
            _issue(
                domain.diagnostics,
                "warning",
                "boundaries",
                "sample-boundaries",
                "Some patches still use unreviewed sample boundary conditions, including any open-cap suggestions.",
                "Review group presets and patch overrides; these are not certified defaults.",
            )
        _issue(
            domain.diagnostics,
            "info",
            "outputs",
            "preparation-only",
            self.capabilities().reason,
            "Connect a separately reviewed isolated worker provider for meshing or solving.",
        )
        errors = sum(d.severity == "error" for d in domain.diagnostics)
        warnings = sum(d.severity == "warning" for d in domain.diagnostics)
        config = scenario.model_dump(
            mode="json",
            exclude={
                "validation", "thermalSnapshots", "name", "description", "group", "archived", "createdAt", "updatedAt"
            },
        )
        stamp = ValidationStamp(
            clientRevision=client_revision,
            sourceHash=domain.source_hash,
            configurationHash=canonical_hash(config),
            checkedAt=datetime.now(UTC),
            errors=errors,
            warnings=warnings,
        )
        regions = [
            {
                "id": r.id,
                "floorId": r.floor_id,
                "name": r.name,
                "included": r.id in domain.included,
                "baseMm": r.base,
                "verticesMm": list(r.air.exterior.coords),
                "ceilingRangeMm": [
                    min(c.height(x, y) for c in r.ceiling for x, y in c.polygon.exterior.coords),
                    max(c.height(x, y) for c in r.ceiling for x, y in c.polygon.exterior.coords),
                ],
            }
            for r in domain.regions
            if r.ceiling
        ]
        vertices = skin["verticesMm"]
        bounds = (
            [[min(p[i] for p in vertices) for i in range(3)], [max(p[i] for p in vertices) for i in range(3)]]
            if vertices
            else None
        )
        return {
            "schemaVersion": 1,
            "kind": "ClimoptixPreparation",
            "adapterVersion": 1,
            "units": "mm",
            "solverTransform": {"scaleMmToM": 0.001, "axes": "right-handed X/Y plan, Z up", "originMm": [0, 0, 0]},
            "provider": self.capabilities().model_dump(),
            "state": "Draft" if errors else "Validated",
            "validation": stamp.model_dump(mode="json"),
            "diagnostics": [d.model_dump() for d in domain.diagnostics],
            "domain": {
                "regions": regions,
                "includedRoomIds": sorted(domain.included),
                "boundsMm": bounds,
                "floorIds": sorted({r.floor_id for r in domain.regions if r.id in domain.included}),
                "volumeM3": volume,
                "portals": [
                    {
                        "id": p.id,
                        "kind": p.kind,
                        "rooms": p.room_ids,
                        "traversed": p.traversable,
                        "reason": p.reason,
                        "ringsMm": p.rings,
                    }
                    for p in domain.portals
                ],
                "slabVoids": [
                    {k: v for k, v in void.items() if k not in ("polygon", "balustrade")} for void in domain.floor_voids
                ],
            },
            "patches": list(patches.values()),
            "vents": vents,
            "objects": objects,
            "meshRecipe": recipe,
            "flowBalance": {"supplyM3S": supply, "extractM3S": extract, "pressurePath": pressure},
            "surface": {**skin, "exportable": bool(skin["closed"]) and errors == 0},
            "resultManifest": None,
            "caseGenerated": False,
            "limitations": [
                "Boundary triangulation is not a finite-volume mesh or an OpenFOAM case.",
                "Proxy envelopes must not overlap; source-only occupants are available for furniture support contact.",
                "Imported visual meshes and assembled opening balustrades need the next exact-geometry adapter.",
            ],
        }

    def generate_case(self, scenario: Scenario) -> PreparedCase:
        raise UnsupportedProviderOperation("No case generator is connected.")

    def submit_mesh(self, scenario: Scenario) -> JobHandle:
        raise UnsupportedProviderOperation("No CFD volume mesher is connected.")

    def submit_run(self, scenario: Scenario) -> JobHandle:
        raise UnsupportedProviderOperation("No CFD solver is connected.")

    def get_job_status(self, job_id: str) -> JobHandle:
        raise UnsupportedProviderOperation("No job service is connected; this is not a job ID.")

    def cancel_job(self, job_id: str) -> JobHandle:
        raise UnsupportedProviderOperation("No cancellable job exists.")

    def get_result_manifest(self, job_id: str) -> ResultManifest:
        raise UnsupportedProviderOperation("No computed results exist.")
