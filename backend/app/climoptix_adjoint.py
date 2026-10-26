"""Authoritative, stateless vent-movement preparation. Execution fails closed."""

import math
from typing import Any

from shapely.affinity import rotate, translate
from shapely.geometry import MultiPolygon, Point, Polygon, box

from geometry.climoptix_adjoint import AdjointStudy
from geometry.climoptix_models import Scenario, Vent

CAPABILITY = {
    "version": 1,
    "preparation": True,
    "canRun": False,
    "fixedMeshMovement": False,
    "adjoint": False,
    "reason": "Adjoint unavailable: this adapter has no validated fixed-mesh moving-vent boundary law or its adjoint. "
    "Ordinary simpleFoam jobs remesh; they cannot execute this study.",
}


def footprint(vent: Vent, u: float, v: float) -> Polygon:
    if vent.shape == "circle":
        # Circumscribed approximation: do not under-test the physical circle.
        return Point(u, v).buffer(vent.diameterMm / 2 / math.cos(math.pi / 256), quad_segs=64)
    return rotate(
        box(u - vent.widthMm / 2, v - vent.heightMm / 2, u + vent.widthMm / 2, v + vent.heightMm / 2),
        vent.rotationDeg,
        origin=(u, v),
    )


def fixed_port(vent: Vent, host: dict[str, Any]) -> dict[str, Any]:
    """Immutable descriptive snapshot, independently checked against current geometry."""
    return {
        "ventId": vent.id,
        "name": vent.name,
        "role": vent.role,
        "supportId": vent.host.patchId,
        "shape": vent.shape,
        "widthMm": vent.widthMm if vent.shape == "rectangle" else vent.diameterMm,
        "heightMm": vent.heightMm if vent.shape == "rectangle" else vent.diameterMm,
        "rotationDeg": vent.rotationDeg,
        "centreUMm": vent.host.u * host["widthMm"],
        "centreVMm": vent.host.v * host["heightMm"],
        **{key: list(host[key]) for key in ("originMm", "uAxis", "vAxis", "normal")},
    }


def prepare_optimisation(scenario: Scenario, study: AdjointStudy, report: dict[str, Any]) -> dict[str, Any]:
    issues: list[dict[str, Any]] = []

    def issue(code: str, message: str, repair: str, port: str | None = None) -> None:
        issues.append({"code": code, "message": message, "repair": repair, "ventId": port})

    stamp = report["validation"]
    if any(getattr(study.baseline, key) != stamp[key] for key in ("sourceHash", "configurationHash", "clientRevision")):
        issue(
            "baselineChanged",
            "The building or physical CFD setup has changed since this configuration was captured.",
            "Keep this saved configuration for reference; create a new configuration from the current setup.",
        )
    if stamp["errors"] or not report["surface"]["exportable"]:
        issue(
            "geometry",
            "Current CFD geometry/preflight is not ready.",
            "Open Export → Review issues and repair every error.",
        )
    vents = {v.id: v for v in scenario.vents}
    snapshots = {p.ventId: p for p in study.baseline.ports}
    patches = {p["id"]: p for p in report["patches"]}
    if set(p.ventId for p in study.ports) != set(vents):
        issue(
            "portSetChanged",
            "Saved port membership does not match the existing CFD vents.",
            "Create a new configuration; port count, shape, size and support cannot change inside a study.",
        )
    if not any(p.movable for p in study.ports):
        issue("noMovablePorts", "No inlet or outlet is selected for movement.", "Select at least one existing port.")
    envelopes: dict[str, Any] = {}
    records = []
    for port in study.ports:
        vent = vents.get(port.ventId)
        if vent is None:
            continue
        patch = patches.get(vent.host.patchId, {})
        host = patch.get("host")
        if not host or not patch.get("hostable"):
            issue(
                "support",
                f"{vent.name} has no single current planar support.",
                "Choose a supported wall, ceiling or floor in Objects and create a new configuration.",
                vent.id,
            )
            continue
        u, v = vent.host.u * host["widthMm"], vent.host.v * host["heightMm"]
        if vent.id not in snapshots or snapshots[vent.id].model_dump() != fixed_port(vent, host):
            issue(
                "baselinePortChanged",
                f"{vent.name}'s captured footprint, support or frame is missing or changed.",
                "Capture a new configuration from current geometry. Saved baseline snapshots are not rewritten.",
                vent.id,
            )
        hole = footprint(vent, u, v)
        bounds = port.bounds
        if port.movable:
            if port.lockU and port.lockV:
                issue(
                    "locked",
                    f"{vent.name} is movable but both axes are locked.",
                    "Unlock an axis or unselect this port.",
                    vent.id,
                )
            if not (bounds.uMinMm <= u <= bounds.uMaxMm and bounds.vMinMm <= v <= bounds.vMaxMm):
                issue(
                    "outsideRegion",
                    f"{vent.name}'s baseline centre is outside its movement bounds.",
                    "Include the baseline centre in the allowed region; coordinates are host-local millimetres.",
                    vent.id,
                )
            if (not port.lockU and bounds.uMinMm == bounds.uMaxMm) or (
                not port.lockV and bounds.vMinMm == bounds.vMaxMm
            ):
                issue(
                    "zeroRange",
                    f"{vent.name} has zero range on an unlocked axis.",
                    "Lock that axis or enlarge its region.",
                    vent.id,
                )
            us = [u] if port.lockU else [bounds.uMinMm, bounds.uMaxMm]
            vs = [v] if port.lockV else [bounds.vMinMm, bounds.vMaxMm]
            envelope = MultiPolygon([translate(hole, a - u, b - v) for a in us for b in vs]).convex_hull
        else:
            envelope = hole
        envelopes[vent.id] = envelope
        physical = MultiPolygon([Polygon(rings[0], rings[1:]) for rings in host["polygonsMm"]])
        clearance = max(port.clearanceMm, vent.edgeClearanceMm)
        if not physical.covers(envelope.buffer(clearance)):
            issue(
                "sweptFootprint",
                f"{vent.name}'s full swept footprint and clearance leave the support or intersect an opening.",
                "Narrow the U/V bounds or reduce an explicit clearance. "
                "The entire region, not only the centre, must fit.",
                vent.id,
            )
        if vent.optimization.allowablePolygon:
            region = Polygon(
                [(a * host["widthMm"], b * host["heightMm"]) for a, b in vent.optimization.allowablePolygon]
            )
            centre_region = (
                box(min(us), min(vs), max(us), max(vs)) if port.movable and not port.lockU and not port.lockV else None
            )
            points = [(a, b) for a in us for b in vs] if port.movable else [(u, v)]
            from shapely.geometry import MultiPoint

            if not region.is_valid or not region.covers(
                centre_region if centre_region is not None else MultiPoint(points).convex_hull
            ):
                issue(
                    "existingRegion",
                    f"{vent.name}'s bounds leave its existing allowable polygon.",
                    "Narrow the region in this configuration.",
                    vent.id,
                )
        records.append(
            {
                "ventId": vent.id,
                "name": vent.name,
                "role": vent.role,
                "supportId": vent.host.patchId,
                "shape": vent.shape,
                "widthMm": vent.widthMm if vent.shape == "rectangle" else vent.diameterMm,
                "heightMm": vent.heightMm if vent.shape == "rectangle" else vent.diameterMm,
                "rotationDeg": vent.rotationDeg,
                "centreMm": [u, v],
                "frame": host,
            }
        )
    for i, a in enumerate(study.ports):
        for b in study.ports[i + 1 :]:
            if a.ventId not in envelopes or b.ventId not in envelopes or not (a.movable or b.movable):
                continue
            va, vb = vents[a.ventId], vents[b.ventId]
            if va.host.patchId != vb.host.patchId:
                continue
            clearance = max(
                a.clearanceMm,
                b.clearanceMm,
                va.optimization.minSpacingMm,
                vb.optimization.minSpacingMm,
                va.edgeClearanceMm,
                vb.edgeClearanceMm,
            )
            if envelopes[a.ventId].distance(envelopes[b.ventId]) <= clearance:
                issue(
                    "collision",
                    f"Movement regions for {va.name} and {vb.name} can overlap or violate clearance.",
                    "Separate the swept regions. This conservative check covers simultaneous movement.",
                    va.id,
                )
    p = scenario.physics
    if p.energy or p.boussinesq or p.co2 or p.mode != "steady" or scenario.thermalSnapshots:
        issue(
            "physics",
            "Thermal, buoyant, scalar, applied-heating or transient physics is not supported by this worker.",
            "Keep this intent saved. A consistently coupled primal/adjoint adapter is required; "
            "do not disable physics silently.",
        )
    return {
        "version": 1,
        "kind": "AdjointPreparation",
        "studyId": study.id,
        "units": "mm",
        "state": "configurationInvalid" if issues else "adjointUnavailable",
        "configurationReady": not issues,
        "canRun": False,
        "capability": CAPABILITY,
        "binding": {key: stamp[key] for key in ("sourceHash", "configurationHash", "clientRevision")},
        "issues": issues,
        "ports": records,
        "iterations": [],
        "meshHash": None,
        "limitations": [
            "No CFD objective, gradient, cost, iteration or mesh-invariance measurement has been computed.",
            "Region checks are conservative swept planar footprints; nearby 3D obstruction coverage "
            "and mesh-face resolution need separate validation.",
            "A baseline run ID is a saved reference only. Ownership, convergence and mesh compatibility "
            "must be checked by an enabled authenticated runner.",
        ],
    }
