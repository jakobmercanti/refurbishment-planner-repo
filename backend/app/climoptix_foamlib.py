"""Restricted Foamlib settings export, not a runnable case or execution endpoint.

No user templates, paths, includes, dynamic code or shell commands are accepted.
The optional GPL-3.0-only dependency is lazy-loaded for dictionary serialization.
"""

import io
import json
from typing import Any
from zipfile import ZIP_DEFLATED, ZipFile

from geometry.climoptix_models import Scenario
from geometry.climoptix_workflow import refinement_cell_mm, refinement_level, sampling_planes


def settings_package(scenario: Scenario, report: dict[str, Any]) -> bytes:
    from foamlib import FoamFile

    if report["validation"]["errors"] or not report["surface"]["exportable"]:
        raise ValueError("Validate and repair the geometry/setup before exporting OpenFOAM settings.")
    mesh, physics = scenario.mesh, scenario.physics
    geometry: dict[str, Any] = {"boundary.stl": {"type": "triSurfaceMesh", "name": "airBoundary"}}
    regions: dict[str, Any] = {}
    manifest_regions = []
    for index, region in enumerate(mesh.refinements):
        center, size = region.centerMm, region.sizeMm
        if region.shape == "object":
            obj = next(o for o in report["objects"] if o["id"] == region.objectId)
            low = [min(v[i] for v in obj["verticesMm"]) for i in range(3)]
            high = [max(v[i] for v in obj["verticesMm"]) for i in range(3)]
            center = tuple((a + b) / 2 for a, b in zip(low, high, strict=True))
            size = tuple(b - a for a, b in zip(low, high, strict=True))
        name = f"refinement_{index + 1:03}"
        level = refinement_level(mesh, region)
        if level > 10:
            raise ValueError("A cell-size refinement requires more than 10 levels. Review its cell target.")
        geometry[name] = (
            {"type": "searchableSphere", "centre": [v / 1000 for v in center], "radius": size[0] / 2000}
            if region.shape == "sphere"
            else {
                "type": "searchableBox",
                "min": [(v - s / 2) / 1000 for v, s in zip(center, size, strict=True)],
                "max": [(v + s / 2) / 1000 for v, s in zip(center, size, strict=True)],
            }
        )
        regions[name] = {"mode": "inside", "levels": [[1, level]]}
        manifest_regions.append(
            {
                "key": name,
                "sourceId": region.id,
                "name": region.name,
                "level": level,
                "requestedCellMm": region.cellMm if region.level is None else None,
                "nominalCellMm": refinement_cell_mm(mesh, region),
            }
        )
    planes = sampling_planes(report["domain"]["boundsMm"], scenario.postProcessing)
    slices = {
        p["id"]: {"type": "cuttingPlane", "point": [v / 1000 for v in p["pointMm"]], "normal": p["normal"]}
        for p in planes
    }
    monitor_fields = ["U", "p_rgh" if physics.boussinesq else "p"]
    if physics.energy:
        monitor_fields.append("T")
    if physics.co2:
        monitor_fields.append("CO2")
    functions: dict[str, Any] = {
        "solverInfo": {
            "type": "solverInfo",
            "libs": ["utilityFunctionObjects"],
            "fields": monitor_fields,
            "writeResidualFields": False,
            "executeControl": "timeStep",
            "executeInterval": 1,
            "writeControl": "timeStep",
            "writeInterval": 1,
        },
    }
    if slices:
        functions["climoptixSlices"] = {
            "type": "surfaces",
            "libs": ["sampling"],
            "surfaceFormat": "vtk",
            "formatOptions": {"vtk": {"format": "ascii"}},
            "fields": scenario.postProcessing.fields,
            "interpolationScheme": "cellPoint",
            "writeControl": "writeTime",
            "writeInterval": scenario.postProcessing.writeInterval,
            "surfaces": slices,
        }
    steady = physics.mode == "steady"
    # These are whitelisted intents for the selected OpenCFD dialect, not a
    # claim that every requested transport/source model has a worker adapter.
    solver = (
        ("buoyantBoussinesqSimpleFoam" if steady else "buoyantBoussinesqPimpleFoam")
        if physics.boussinesq
        else ("simpleFoam" if steady else "pimpleFoam")
    )
    controls = {
        "application": solver,
        "startFrom": "startTime",
        "startTime": 0 if steady else physics.time.startS,
        "stopAt": "endTime",
        "endTime": physics.numerics.maxIterations if steady else physics.time.endS,
        "deltaT": 1 if steady else physics.time.stepS,
        "writeControl": "timeStep" if steady else "adjustableRunTime",
        "writeInterval": physics.numerics.writeEveryIterations if steady else physics.time.writeIntervalS,
        "writeFormat": "ascii",
        "runTimeModifiable": False,
        "functions": functions,
    }
    if not steady:
        controls.update(adjustTimeStep=physics.time.adjustable, maxCo=physics.time.maxCourant)
    dictionaries: dict[str, dict[str, Any]] = {
        "snappyHexMeshDict": {
            "castellatedMesh": True,
            "snap": True,
            "addLayers": mesh.layers.enabled,
            "geometry": geometry,
            "castellatedMeshControls": {
                "maxLocalCells": max(1, mesh.maxCells // scenario.resources.cpu),
                "maxGlobalCells": mesh.maxCells,
                "minRefinementCells": 0,
                "nCellsBetweenLevels": 3,
                "maxLoadUnbalance": mesh.loadImbalance,
                "resolveFeatureAngle": mesh.featureAngleDeg,
                "refinementRegions": regions,
            },
            "snapControls": {"nSolveIter": mesh.snapIterations},
            "meshQualityControls": {
                "maxNonOrtho": mesh.maxNonOrthogonality,
                "maxInternalSkewness": mesh.maxSkewness,
                "minVol": mesh.minVolumeM3,
            },
        },
        "controlDict": controls,
        "decomposeParDict": {"numberOfSubdomains": scenario.resources.cpu, "method": "scotch"},
    }
    output = io.BytesIO()
    with ZipFile(output, "w", ZIP_DEFLATED) as archive:
        for name, contents in dictionaries.items():
            data: dict[str | None, Any] = {
                "FoamFile": {"version": 2.0, "format": "ascii", "class": "dictionary", "object": name},
            }
            for key, value in contents.items():
                data[key] = value
            encoded = FoamFile.dumps(data)
            FoamFile.loads(encoded)  # Round-trip every generated dictionary through the actual library.
            archive.writestr(f"settings/system/{name}", encoded)
        archive.writestr("scenario.json", scenario.model_dump_json(indent=2))
        archive.writestr("preparation.json", json.dumps(report))
        archive.writestr(
            "manifest.json",
            json.dumps(
                {
                    "kind": "ClimoptixOpenFOAMSettings",
                    "version": 1,
                    "runnable": False,
                    "dialect": "OpenCFD-v2312",
                    "writer": "foamlib",
                    "solverIntent": solver,
                    "validation": report["validation"],
                    "geometryUnits": "metres",
                    "sourceUnits": "millimetres",
                    "refinements": manifest_regions,
                    "samplingPlanes": planes,
                    "resources": scenario.resources.model_dump(),
                    "requiredWorkerSteps": [
                        "background mesh and locationInMesh",
                        "surface patch mapping and refinement",
                        "complete snapping/layer controls",
                        "initial fields and boundary/source adapters",
                        "transport models, numerics and quality checks",
                        "isolated resource-limited execution",
                    ],
                },
                indent=2,
            ),
        )
        archive.writestr(
            "README.txt",
            (
                "Climoptix OpenFOAM settings — NOT A RUNNABLE CASE\n"
                "Foamlib writes and re-reads the restricted dictionaries. Target dialect: OpenCFD v2312.\n"
                "Plane names and positions are fixed before the run; plane positions in dictionaries are metres.\n"
                "scenario.json retains ALL physics, numerical, resource, source and mesh settings.\n"
                "A worker must implement and validate these before starting any solver.\n"
                "No Allrun or executable is supplied. Export the checked boundary STL in the preparation ZIP.\n"
                "Energy without Boussinesq and CO2 require additional reviewed solver/transport adapters.\n"
                "Pressure dimensions depend on that adapter (incompressible p is kinematic pressure, not Pa).\n"
                "Background cells, origin/alignment, local surface/wake targets and layers need worker translation.\n"
                "Sampling uses ASCII VTK; download full solver VTK artifacts unchanged for ParaView once available.\n"
                "No mesh, residuals or computed fields were produced by this export.\n"
            ),
        )
    return output.getvalue()
