"""Deterministic insulation/UFH projection onto the prepared air skin.

Heat flux is positive into air. Robin uses Rtotal - Rsi once; UFH supplies
additional reviewed upward watts, never water temperature or whole-floor heat.
"""

from copy import deepcopy
from typing import Any

from shapely import unary_union
from shapely.geometry import LineString, Polygon

from geometry.climoptix_domain import canonical_hash
from geometry.climoptix_models import Diagnostic, Thermal
from geometry.climoptix_surface import Face, dot, sub, triangulate_skin
from geometry.thermal_envelope import envelope_records


def _row(key: str, name: str, floor: str, room: str, kind: str) -> dict[str, Any]:
    return dict(
        id=key,
        name=name,
        floorId=floor,
        roomId=room,
        kind=kind,
        status="incomplete",
        patchIds=[],
        areaM2=0.0,
        watts=None,
        appliedW=0.0,
        uWm2K=None,
        rsiM2KW=None,
        coefficientWm2K=None,
        ambientK=None,
        message="",
    )


def _issue(domain: Any, row: dict[str, Any], code: str, severity: str = "warning") -> None:
    domain.diagnostics.append(
        Diagnostic(
            severity=severity,
            group="boundaries",
            code=code,
            objectId=row["id"],
            message=f"{row['name']}: {row['message']}",
            repair="Review the shared source or the explicit thermal override; no missing value is invented.",
        )
    )


def _envelope_condition(record: dict[str, Any], scenario: Any) -> tuple[dict[str, Any] | None, str, str]:
    if record["status"] == "stale":
        return None, "incomplete", "Construction geometry or override is stale; reassign/review it."
    if record.get("openAir"):
        if not scenario.physics.energy:
            return None, "unassigned", "Open aperture: thermal transport is off; no solid U-value is imposed."
        ambient = record["ambientC"]
        setup = scenario.thermalEnvelope
        if record["exposure"] == "outdoors":
            ambient = (
                setup.weather.temperatureC
                if setup and setup.weather.temperatureC is not None
                else scenario.physics.outdoorTemperatureK - 273.15
            )
        if ambient is None:
            return (
                None,
                "incomplete",
                "Open aperture needs an explicit adjacent-air backflow temperature; no solid U-value is imposed.",
            )
        return (
            Thermal(type="inletOutlet", value=ambient + 273.15).model_dump(),
            "applied",
            "Open aperture: outflow gradient / declared inflow temperature. Door/window U is not imposed on open air.",
        )
    if record["exposure"] == "adiabatic" or record["method"] == "adiabatic":
        return Thermal().model_dump(), "applied", "Declared adiabatic surface; no fabric heat transfer."
    if record["exposure"] == "internal":
        return None, "unassigned", "Internal surface: coupled solid heat redistribution is not represented."
    override = record["override"] or {}
    method = record["method"]
    if method == "temperature":
        value = override.get("fixedTemperatureC")
        if value is None:
            return None, "incomplete", "A reviewed inner-surface temperature is required."
        return (
            Thermal(type="temperature", value=value + 273.15).model_dump(),
            "applied",
            "Reviewed surface temperature.",
        )
    if method == "fixedFlux" and override.get("fixedFluxWm2") is not None:
        return (
            Thermal(type="heatFlux", value=override["fixedFluxWm2"]).model_dump(),
            "applied",
            "Reviewed fixed flux into air.",
        )
    u, rsi = record["uWm2K"], record["rsi"]
    if u is None or u <= 0 or record["source"] == "heatingEstimate":
        return None, "unassigned", "No positive verified Insulation U-value; Heating estimates are not substituted."
    setup = scenario.thermalEnvelope
    if setup and (setup.weather.solarMode != "none" or setup.longwaveWm2 != 0 or override.get("longwaveWm2")):
        return (
            None,
            "incomplete",
            "Solar/longwave forcing needs the reviewed Thermal Envelope contract; base U alone is insufficient.",
        )
    ambient = record["ambientC"]
    if record["exposure"] == "outdoors":
        ambient = (
            setup.weather.temperatureC
            if setup and setup.weather.temperatureC is not None
            else scenario.physics.outdoorTemperatureK - 273.15
        )
    elif record["exposure"] == "ground" and ambient is None and setup:
        ambient = setup.groundTemperatureC
    if ambient is None:
        return None, "incomplete", "An explicit ground/adjacent-zone temperature is required."
    if method == "fixedFlux":
        reference = setup.referenceIndoorC if setup else scenario.physics.referenceTemperatureK - 273.15
        return (
            Thermal(type="heatFlux", value=u * (ambient - reference)).model_dump(),
            "applied",
            "Fixed-flux approximation at the declared room reference temperature.",
        )
    outward = 1 / u - rsi if rsi is not None else None
    if outward is None or outward <= 0:
        return (
            None,
            "incomplete",
            "Robin mapping needs declared Rsi and positive Rtotal - Rsi; choose a reviewed method.",
        )
    if 1 / outward > 1e6:
        return None, "incomplete", "The outward coefficient exceeds the supported range; review resistance units."
    return (
        Thermal(type="heatTransfer", value=1 / outward, ambientK=ambient + 273.15).model_dump(),
        "applied",
        "Robin: q into air = (Toutside - Tsurface) / (Rtotal - Rsi).",
    )


def _record_polygon(record: dict[str, Any], face: Face) -> Any:
    vertices = record["verticesMm"]
    if not vertices or abs(dot(sub(tuple(vertices[0]), face.origin), face.normal)) > 1e-4:
        return Polygon()
    return unary_union(
        [Polygon([face.project(tuple(vertices[i])) for i in triangle]) for triangle in record["triangles"]]
    )


def _clone_patch(patches: dict[str, Any], parent: str, key: str, label: str) -> str:
    pid = parent + ":" + key
    if pid not in patches:
        patches[pid] = {**deepcopy(patches[parent]), "id": pid, "label": label, "hostable": False}
        patches[pid]["envelopeHostPatchId"] = patches[parent].get("envelopeHostPatchId", parent)
        patches[pid].pop("host", None)
    return pid


def prepare_shared_surfaces(
    project: dict[str, Any], scenario: Any, domain: Any, faces: list[Face], patches: dict[str, Any]
) -> tuple[list[Face], dict[str, Any]]:
    inputs = scenario.sharedBoundaries
    audit: dict[str, Any] = dict(
        version=1, state="complete", sources=[], envelope=[], inventory=[i.model_dump() for i in inputs.inventory]
    )
    if inputs.captureEnvelope:
        try:
            records = envelope_records(
                project, scenario, domain, {"patches": list(patches.values()), "surface": triangulate_skin(faces)}
            )
        except ValueError as error:
            row = _row("insulation:unavailable", "Insulation source", "", "", "insulation")
            row["message"] = str(error)[:1000]
            audit["envelope"].append(row)
            records = []
        assigned: set[str] = set()
        new_faces: list[Face] = []
        by_patch: dict[str, list[dict[str, Any]]] = {}
        for record in records:
            by_patch.setdefault(record["patchId"], []).append(record)
            patch = patches[record["patchId"]]
            portal = next((p for p in domain.portals if p.id == patch["sourceId"]), None)
            record["openAir"] = patch["kind"] == "cap" or (
                patch["kind"] in ("door", "window") and portal is not None and portal.raw.get("swing_angle_deg", 0) > 0
            )
            row = _row(
                record["surfaceId"],
                f"{record['roomName']} · {record['elementId'].split('|')[-1]}",
                record["floorId"],
                record["roomId"],
                "insulation",
            )
            thermal, row["status"], row["message"] = _envelope_condition(record, scenario)
            row.update(uWm2K=record["uWm2K"], rsiM2KW=record["rsi"])
            if thermal and thermal["type"] == "heatTransfer":
                row.update(coefficientWm2K=thermal["value"], ambientK=thermal["ambientK"])
            record["sharedRow"], record["sharedThermal"] = row, thermal
            audit["envelope"].append(row)
        # Preserve each original host ID on its first part. Host coordinates
        # still describe the original measured host, independent of face splits.
        child_for_record: dict[str, str] = {}
        for face in faces:
            remaining = face.polygon
            for record in by_patch.get(face.patch, []):
                cut = remaining.intersection(_record_polygon(record, face))
                if cut.area <= 1e-6:
                    continue
                sid = record["surfaceId"]
                if sid not in child_for_record:
                    pid = (
                        face.patch
                        if face.patch not in assigned
                        else _clone_patch(
                            patches, face.patch, "ins:" + canonical_hash(sid)[:12], record["sharedRow"]["name"]
                        )
                    )
                    child_for_record[sid] = pid
                    assigned.add(face.patch)
                pid = child_for_record[sid]
                patches[pid]["sharedEnvelopeId"] = sid
                patches[pid]["sharedThermal"] = record["sharedThermal"]
                new_faces.append(Face(pid, face.origin, face.u, face.v, face.normal, cut))
                remaining = remaining.difference(cut)
            if remaining.area > 1e-6:
                new_faces.append(Face(face.patch, face.origin, face.u, face.v, face.normal, remaining))
        faces = new_faces
    regions = {(r.floor_id, r.id): r for r in domain.regions if r.id in domain.included}
    masks: dict[str, Any] = {}
    source_rows: dict[str, dict[str, Any]] = {}
    for source in inputs.sources:
        row = _row(source.id, source.name, source.floorId, source.roomId, source.kind)
        row["watts"] = source.watts
        audit["sources"].append(row)
        source_rows[source.id] = row
        room = regions.get((source.floorId, source.roomId))
        if not room:
            row.update(status="outside", message="Outside the checked connected air domain.")
        elif not source.enabled or source.watts == 0:
            row.update(status="off", message="Room heat is off; source geometry is retained.")
        elif source.watts is None:
            row["message"] = "Effective room watts are unknown; enter reviewed operating watts."
        elif source.kind == "radiator":
            row.update(status="applied", message="Room-effective power distributed once over exposed proxy surfaces.")
        elif not source.geometryValid or not source.circuits:
            row["message"] = "UFH geometry is stale or unreviewed; regenerate/review saved circuits."
        else:
            try:
                holes = [Polygon([(p.x, p.y) for p in ring]) for ring in source.exclusions]
                if any(not h.is_valid or h.area <= 0 for h in holes):
                    raise ValueError("UFH exclusions need valid nonzero polygons.")
                allowed = room.original.difference(unary_union(holes))
                paths = [LineString([(p.x, p.y) for p in circuit.pathMm]) for circuit in source.circuits]
                if any(p.length <= 0 or not p.is_simple or not allowed.buffer(1e-6).covers(p) for p in paths):
                    raise ValueError("UFH path crosses its measured room/exclusion or has zero length.")
                mask = unary_union(
                    [
                        path.buffer(c.spacingMm / 2, cap_style="flat", join_style="mitre")
                        for path, c in zip(paths, source.circuits, strict=True)
                    ]
                ).intersection(allowed)
                if mask.area <= 1e-6:
                    raise ValueError("UFH has no nonzero tube-spacing footprint.")
                masks[source.id] = mask
                row.update(
                    status="applied",
                    message=(
                        "Uniform upward watts on tube-spacing footprints clipped to actual air-floor faces; "
                        "not a resolved pipe/solid model."
                    ),
                )
            except ValueError as error:
                row["message"] = str(error)
    ids = sorted(masks)
    for i, key in enumerate(ids):
        for other in ids[i + 1 :]:
            a, b = source_rows[key], source_rows[other]
            if (a["floorId"], a["roomId"]) == (b["floorId"], b["roomId"]) and masks[key].intersection(
                masks[other]
            ).area > 1e-3:
                for row in (a, b):
                    row.update(
                        status="incomplete",
                        message="UFH zones overlap. Review disjoint heated coverage before mapping power.",
                    )
    for key in ids:
        row = source_rows[key]
        if row["status"] != "applied":
            continue
        parts: list[tuple[Face, Any]] = []
        for face in faces:
            patch = patches[face.patch]
            if patch["kind"] != "floor" or (patch["floorId"], patch["roomId"]) != (row["floorId"], row["roomId"]):
                continue
            if abs(face.normal[2]) < 0.999999:
                continue
            rings = [masks[key]] if isinstance(masks[key], Polygon) else list(masks[key].geoms)
            projected = unary_union(
                [
                    Polygon(
                        [face.project((x, y, face.origin[2])) for x, y in ring.exterior.coords],
                        [[face.project((x, y, face.origin[2])) for x, y in hole.coords] for hole in ring.interiors],
                    )
                    for ring in rings
                    if isinstance(ring, Polygon)
                ]
            )
            cut = face.polygon.intersection(projected)
            if cut.area > 1e-6:
                parts.append((face, cut))
        area = sum(part.area for _, part in parts) * 1e-6
        if area <= 0 or row["watts"] / area > 1e6:
            row.update(
                status="incomplete", message="UFH has no exposed floor area or exceeds the supported flux range."
            )
            continue
        flux = row["watts"] / area
        used = {id(face): part for face, part in parts}
        updated: list[Face] = []
        for face in faces:
            cut = used.get(id(face))
            if cut is None:
                updated.append(face)
                continue
            remaining = face.polygon.difference(cut)
            pid = (
                _clone_patch(patches, face.patch, "ufh:" + key, f"UFH · {row['name']}")
                if remaining.area > 1e-6
                else face.patch
            )
            patches[pid]["sharedSourceId"], patches[pid]["sharedSourceFlux"] = key, flux
            updated.append(Face(pid, face.origin, face.u, face.v, face.normal, cut))
            if remaining.area > 1e-6:
                updated.append(Face(face.patch, face.origin, face.u, face.v, face.normal, remaining))
        faces = updated
    for value in inputs.unlocated:
        row = _row(value.id, value.name, value.floorId, value.roomId, value.kind)
        row["watts"] = value.valueSI if value.units == "W" else None
        row["status"] = "incomplete" if (value.floorId, value.roomId) in regions else "outside"
        row["message"] = (
            f"{value.valueSI:g} {value.units} is captured as zone-average input, but has no physical "
            "opening/object/receiving-surface mapping. It is not added as an arbitrary CFD boundary."
        )
        audit["sources"].append(row)
    return faces, audit


def finalize_shared_boundaries(scenario: Any, domain: Any, patches: dict[str, Any], audit: dict[str, Any]) -> None:
    envelope = {r["id"]: r for r in audit["envelope"]}
    for patch in patches.values():
        row = envelope.get(patch.get("sharedEnvelopeId"))
        if not row:
            continue
        row["patchIds"].append(patch["id"])
        row["areaM2"] += patch["areaM2"]
        wanted = patch.pop("sharedThermal", None)
        if wanted is not None:
            if patch["boundary"]["thermal"]["type"] != "adiabatic":
                row.update(
                    status="incomplete",
                    message=(
                        "An explicit CFD thermal condition conflicts with shared insulation. "
                        "Keep one controlling fabric model."
                    ),
                )
            else:
                patch["boundary"]["thermal"] = wanted
                patch["boundaryOrigin"] = "shared insulation"
                patch.pop("needsReview", None)
    for row in audit["sources"]:
        if row["kind"] not in ("radiator", "ufh"):
            if row["status"] == "incomplete":
                _issue(domain, row, "shared-source-unlocated")
            continue
        if row["kind"] == "ufh":
            found = [p for p in patches.values() if p.get("sharedSourceId") == row["id"]]
            if row["status"] == "applied" and any(
                p["boundary"]["thermal"]["type"] not in ("adiabatic", "heatTransfer") for p in found
            ):
                row.update(
                    status="incomplete",
                    message="A fixed temperature/flux conflicts with UFH power; choose one floor source model.",
                )
            for patch in found:
                row["patchIds"].append(patch["id"])
                row["areaM2"] += patch["areaM2"]
                flux = patch.pop("sharedSourceFlux")
                if row["status"] == "applied":
                    thermal = patch["boundary"]["thermal"]
                    if thermal["type"] == "heatTransfer":
                        thermal["sourceFluxWm2"] = flux
                    else:
                        patch["boundary"]["thermal"] = Thermal(type="heatFlux", value=flux).model_dump()
                    patch["boundaryOrigin"] = (
                        "shared UFH + insulation" if thermal["type"] == "heatTransfer" else "shared UFH"
                    )
                    patch.pop("needsReview", None)
                    row["appliedW"] += flux * patch["areaM2"]
        else:
            found = [p for p in patches.values() if p["kind"] == "object" and p["sourceId"] == row["id"]]
            row["patchIds"] = [p["id"] for p in found]
            row["areaM2"] = sum(p["areaM2"] for p in found)
            row["appliedW"] = sum(
                p["boundary"]["thermal"]["value"] * p["areaM2"]
                for p in found
                if p["boundary"]["thermal"]["type"] == "heatFlux"
            )
            if row["status"] == "off" and any(p["boundary"]["thermal"]["type"] != "adiabatic" for p in found):
                row.update(
                    status="incomplete",
                    message=(
                        "Heating is off but an explicit CFD thermal condition is active on its proxy. "
                        "Remove the conflicting override."
                    ),
                )
            if any(d.severity == "error" and d.objectId in {row["id"], *row["patchIds"]} for d in domain.diagnostics):
                row.update(
                    status="incomplete",
                    message="Source geometry or thermal controls are invalid; review the reported source issues.",
                )
            if row["status"] == "applied" and (
                not found or abs(row["appliedW"] - row["watts"]) > max(0.01, row["watts"] * 1e-8)
            ):
                row.update(
                    status="incomplete",
                    message="The measured radiator proxy does not conserve its declared room power.",
                )
        if row["status"] == "incomplete":
            _issue(domain, row, "shared-source-incomplete")
    for row in audit["envelope"]:
        if row["status"] in ("incomplete", "unassigned"):
            _issue(domain, row, "shared-insulation-review")
    audit["state"] = (
        "review"
        if any(r["status"] in ("incomplete", "unassigned") for r in [*audit["sources"], *audit["envelope"]])
        else "complete"
    )
