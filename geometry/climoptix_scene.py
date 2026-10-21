"""Read-only, millimetre viewer geometry from the authoritative air-domain kernel.

This is deliberately independent of a study's seed, validation or solver setup.
The scene is not a solver case or an exportable simulation mesh.
"""

from dataclasses import replace
from datetime import UTC, datetime
from typing import Any

from geometry.climoptix_domain import boundary_faces, discover_domain
from geometry.climoptix_models import Scenario
from geometry.climoptix_surface import triangulate_skin


def building_scene(project: dict[str, Any]) -> dict[str, Any]:
    now = datetime.now(UTC)
    viewer = Scenario(
        id="viewer", name="Building viewer", sourceBuildingId=project["projectId"], createdAt=now, updatedAt=now
    )
    domain = discover_domain(project, viewer)
    ids = {room.id for room in domain.regions}
    graph: dict[str, set[str]] = {room_id: set() for room_id in ids}
    for portal in domain.portals:
        if portal.traversable and len(portal.room_ids) == 2:
            first, second = portal.room_ids
            graph[first].add(second)
            graph[second].add(first)
    for void in domain.floor_voids:
        graph[void["lower"]].add(void["upper"])
        graph[void["upper"]].add(void["lower"])
    remaining = set(ids)
    volumes = []
    while remaining:
        connected: set[str] = set()
        pending = [min(remaining)]
        while pending:
            current = pending.pop()
            if current in connected:
                continue
            connected.add(current)
            pending.extend(graph[current] - connected)
        remaining -= connected
        volumes.append(sorted(connected))
    faces, patches = boundary_faces(replace(domain, included=ids))
    skin = triangulate_skin(faces)
    return {
        "kind": "ClimoptixBuildingView",
        "units": "mm",
        "sourceHash": domain.source_hash,
        "rooms": [{"id": r.id, "floorId": r.floor_id} for r in domain.regions],
        "airVolumes": volumes,
        "patches": list(patches.values()),
        "verticesMm": skin["verticesMm"],
        "triangles": skin["triangles"],
        "trianglePatches": skin["trianglePatches"],
    }
