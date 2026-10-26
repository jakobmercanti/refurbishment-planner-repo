"""A bounded starter ventilation case built from authoritative measured faces.

No display mesh, saved boundary overrides or solver result is trusted here.
Invalid source geometry stays an error; defaults cannot repair a measured room.
"""

from datetime import UTC, datetime
from itertools import combinations
from math import ceil

from shapely.geometry import Polygon, box
from shapely.ops import polylabel

from backend.app.climoptix_provider import PreparationOnlyProvider
from geometry.climoptix_domain import source_geometry
from geometry.climoptix_models import Boundary, Refinement, Scenario, Vent


def default_setup(project: dict, original: Scenario, revision: str) -> Scenario:
    provider = PreparationOnlyProvider()
    rooms = [(floor["id"], room["id"]) for floor in source_geometry(project)["floors"] for room in floor["rooms"]]
    if not rooms:
        raise ValueError("Draw an enclosed measured room before creating a default simulation.")
    seed = original.seed
    floor_id, room_id = (seed.floorId, seed.roomId) if seed and (seed.floorId, seed.roomId) in rooms else rooms[0]
    scenario = Scenario(
        id=original.id, name=original.name, group=original.group,
        sourceBuildingId=project["projectId"], createdAt=original.createdAt, updatedAt=datetime.now(UTC),
        seed={"floorId": floor_id, "roomId": room_id},
        description="Starter ventilation: opposing inlet/outlet, adiabatic no-slip walls, laminar steady isothermal flow. Source furniture is excluded; add it back deliberately after the baseline run.",
        physics={"turbulence": "laminar", "numerics": {"maxIterations": 2000, "residualTarget": 1e-4, "writeEveryIterations": 50}},
        resources={"cpu": 1, "memoryGb": 4, "wallTimeMinutes": 15, "storageGb": 1, "retentionDays": 3},
        boundaries={"groups": {kind: Boundary() for kind in ("wall", "floor", "ceiling", "door", "window", "cap", "slabSide", "object")}},
    )
    report = provider.validate_scenario(project, scenario, revision)
    # Simplest baseline: do not copy uncertain object proxies or source emissions.
    scenario.hiddenObjectIds = [obj["id"] for obj in report["objects"]]
    domain = provider.prepare_geometry(project, scenario)
    region = next((r for r in domain.regions if r.id == room_id and r.floor_id == floor_id), None)
    if region is None or region.air.is_empty:
        raise ValueError("The selected measured room has no valid air volume. Resolve its geometry issues before resetting defaults.")
    point = region.air.representative_point()
    scenario.outputs.probesMm = [(point.x, point.y, (region.base + region.top(point.x, point.y)) / 2)]
    report = provider.validate_scenario(project, scenario, revision)
    walls = [p for p in report["patches"] if p["kind"] == "wall" and p["hostable"] and p.get("host") and abs(p["normal"][2]) < .01]
    candidates = []
    for patch in walls:
        host = patch["host"]
        for rings in host["polygonsMm"]:
            polygon = Polygon(rings[0], rings[1:])
            if not polygon.is_valid or polygon.area < 10000:
                continue
            center = polylabel(polygon, tolerance=2)
            # Largest practical square at an interior point, with actual hole and edge clearance.
            for size in range(800, 99, -50):
                half = size / 2
                if polygon.covers(box(center.x - half, center.y - half, center.x + half, center.y + half).buffer(10)):
                    candidates.append((patch, center.x / host["widthMm"], center.y / host["heightMm"], size))
                    break
    pairs = [(a, b) for a, b in combinations(candidates, 2)
             if a[0]["roomId"] == b[0]["roomId"] and a[0]["id"] != b[0]["id"]
             and sum(x * y for x, y in zip(a[0]["normal"], b[0]["normal"], strict=True)) < -.999]
    if not pairs:
        raise ValueError("No opposing planar walls have enough clear space for the default vents. Keep the measured room and place Supply/Extract manually.")
    inlet, outlet = max(pairs, key=lambda pair: min(pair[0][3], pair[1][3]))
    size = min(inlet[3], outlet[3])
    scenario.vents = [Vent(id=f"default-{role}", name="Default inlet" if role == "supply" else "Default outlet", role=role,
                           host={"patchId": placement[0]["id"], "u": placement[1], "v": placement[2]},
                           widthMm=size, heightMm=size, control="volumeFlow" if role == "supply" else "pressure",
                           valueSI=.005 if role == "supply" else 0)
                      for role, placement in (("supply", inlet), ("extract", outlet))]
    bounds = report["domain"]["boundsMm"]
    if not bounds:
        raise ValueError("The measured air volume has no usable bounds.")
    # ~10k base cells, one uniform split (~80k), preserving a visible vent hole.
    volume_mm3 = max(1, report["domain"]["volumeM3"] * 1e9)
    base = max(25, min(size / 4, ceil((volume_mm3 / 10000) ** (1 / 3) / 5) * 5))
    mesh = scenario.mesh
    mesh.preset = "Draft"
    mesh.baseCellMm, mesh.minCellMm, mesh.maxCellMm = base, base / 4, base * 2
    mesh.wallCellMm = mesh.jetCellMm = mesh.objectCellMm = mesh.wakeCellMm = base
    mesh.ventCellMm = mesh.openingCellMm = base / 2
    mesh.snapToleranceMm = min(50, base / 2)
    mesh.targetCells, mesh.maxCells = 100000, 500000
    mesh.refinements = [Refinement.model_validate({"id": "default-uniform", "name": "Starter uniform mesh", "shape": "box",
                         "centerMm": [(a + b) / 2 for a, b in zip(*bounds, strict=True)],
                         "sizeMm": [b - a + base * 4 for a, b in zip(*bounds, strict=True)], "cellMm": base / 2, "level": 1})]
    # Revalidate assignment types and the SAME geometry path used by Play.
    scenario = Scenario.model_validate(scenario.model_dump())
    final = provider.validate_scenario(project, scenario, revision)
    errors = [d["message"] for d in final["diagnostics"] if d["severity"] == "error"]
    if errors or not final["surface"]["exportable"]:
        raise ValueError("Default setup cannot run on this measured geometry: " + "; ".join(errors[:3]))
    if final["meshRecipe"]["estimate"]["baseCells"] > 60000:
        raise ValueError("This air volume needs a larger worker or a smaller connected domain for a safe starter mesh.")
    return scenario
