"""Deterministic insulation/UFH projection onto the prepared air skin.

Heat flux is positive into air. Robin uses Rtotal - Rsi once; UFH supplies
additional reviewed upward watts, never water temperature or whole-floor heat.
"""

from copy import deepcopy
from typing import Any

from shapely import unary_union
from shapely.geometry import LineString, Polygon

from geometry.climoptix_domain import Domain, canonical_hash
from geometry.climoptix_models import Diagnostic, Scenario, Thermal
from geometry.climoptix_surface import Face, dot, sub, triangulate_skin
from geometry.shared_boundary_models import BoundaryCapture, BoundaryStatus, SharedBoundaryAudit, SharedBoundaryInputs
from geometry.thermal_envelope import envelope_records


def _row(key: str, name: str, floor: str, room: str, kind: str) -> BoundaryCapture:
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


def _issue(domain: Domain, row: BoundaryCapture, code: str) -> None:
    domain.diagnostics.append(
        Diagnostic(
            severity="warning",
            group="boundaries",
            code=code,
            objectId=row["id"],
            message=f"{row['name']}: {row['message']}",
            repair="Review the shared source or the explicit thermal override; no missing value is invented.",
        )
    )


def _envelope_condition(
    record: dict[str, Any], scenario: Scenario
) -> tuple[dict[str, Any] | None, BoundaryStatus, str]:
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


def _prepare_envelope(
    project: dict[str, Any],
    scenario: Scenario,
    domain: Domain,
    faces: list[Face],
    patches: dict[str, Any],
    audit: SharedBoundaryAudit,
) -> list[Face]:
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
    return new_faces


def _prepare_source_masks(inputs: SharedBoundaryInputs, domain: Domain, audit: SharedBoundaryAudit):
    regions = {(r.floor_id, r.id): r for r in domain.regions if r.id in domain.included}
    masks: dict[str, Any] = {}
    source_rows: dict[str, BoundaryCapture] = {}
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
    return masks, source_rows, regions


def _reject_overlapping_ufh(masks: dict[str, Any], source_rows: dict[str, BoundaryCapture]) -> None:
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


def _map_ufh_source(
    faces: list[Face],
    patches: dict[str, Any],
    row: BoundaryCapture,
    key: str,
    mask: Any,
) -> list[Face]:
    parts: list[tuple[Face, Any]] = []
    for face in faces:
        patch = patches[face.patch]
        if patch["kind"] != "floor" or (patch["floorId"], patch["roomId"]) != (row["floorId"], row["roomId"]):
            continue
        if abs(face.normal[2]) < 0.999999:
            continue
        rings = [mask] if isinstance(mask, Polygon) else list(mask.geoms)
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
        row.update(status="incomplete", message="UFH has no exposed floor area or exceeds the supported flux range.")
        return faces
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
    return updated


def _capture_unlocated(inputs: SharedBoundaryInputs, regions: dict, audit: SharedBoundaryAudit) -> None:
    for value in inputs.unlocated:
        row = _row(value.id, value.name, value.floorId, value.roomId, value.kind)
        row["watts"] = value.valueSI if value.units == "W" else None
        row["status"] = "incomplete" if (value.floorId, value.roomId) in regions else "outside"
        row["message"] = (
            f"{value.valueSI:g} {value.units} is captured as zone-average input, but has no physical "
            "opening/object/receiving-surface mapping. It is not added as an arbitrary CFD boundary."
        )
        audit["sources"].append(row)


def prepare_shared_surfaces(
    project: dict[str, Any], scenario: Scenario, domain: Domain, faces: list[Face], patches: dict[str, Any]
) -> tuple[list[Face], SharedBoundaryAudit]:
    inputs = scenario.sharedBoundaries
    if inputs is None:
        raise ValueError("Shared boundary intent is required for source mapping.")
    audit: SharedBoundaryAudit = dict(
        version=1, state="complete", sources=[], envelope=[], inventory=[i.model_dump() for i in inputs.inventory]
    )
    if inputs.captureEnvelope:
        faces = _prepare_envelope(project, scenario, domain, faces, patches, audit)
    masks, source_rows, regions = _prepare_source_masks(inputs, domain, audit)
    _reject_overlapping_ufh(masks, source_rows)
    for key in sorted(masks):
        row = source_rows[key]
        if row["status"] == "applied":
            faces = _map_ufh_source(faces, patches, row, key, masks[key])
    _capture_unlocated(inputs, regions, audit)
    return faces, audit


def _apply_envelope_conditions(patches: dict[str, Any], audit: SharedBoundaryAudit) -> None:
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


def _finalize_ufh(row: BoundaryCapture, found: list[dict[str, Any]]) -> None:
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
            patch["boundaryOrigin"] = "shared UFH + insulation" if thermal["type"] == "heatTransfer" else "shared UFH"
            patch.pop("needsReview", None)
            row["appliedW"] += flux * patch["areaM2"]


def _finalize_radiator(row: BoundaryCapture, found: list[dict[str, Any]], domain: Domain) -> None:
    row["patchIds"] = [p["id"] for p in found]
    row["areaM2"] = sum(p["areaM2"] for p in found)
    row["appliedW"] = sum(
        p["boundary"]["thermal"]["value"] * p["areaM2"] for p in found if p["boundary"]["thermal"]["type"] == "heatFlux"
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


def finalize_shared_boundaries(domain: Domain, patches: dict[str, Any], audit: SharedBoundaryAudit) -> None:
    _apply_envelope_conditions(patches, audit)
    # Index once: source-by-source scans over every patch become costly on large floors.
    ufh: dict[str, list[dict[str, Any]]] = {}
    radiators: dict[str, list[dict[str, Any]]] = {}
    for patch in patches.values():
        if source := patch.get("sharedSourceId"):
            ufh.setdefault(source, []).append(patch)
        if patch["kind"] == "object":
            radiators.setdefault(patch["sourceId"], []).append(patch)
    for row in audit["sources"]:
        if row["kind"] == "ufh":
            _finalize_ufh(row, ufh.get(row["id"], []))
        elif row["kind"] == "radiator":
            _finalize_radiator(row, radiators.get(row["id"], []), domain)
        elif row["status"] == "incomplete":
            _issue(domain, row, "shared-source-unlocated")
            continue
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
