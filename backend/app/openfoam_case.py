"""Restricted OpenCFD v2312 case compiler. Source geometry is authoritative mm.

Only generated identifiers, finite numbers and reviewed tokens enter dictionaries.
No browser-supplied OpenFOAM dictionaries, paths or executable text are accepted.
"""

from __future__ import annotations

import hashlib
import json
import math
from pathlib import Path
from typing import Annotated, Any, Literal
from uuid import UUID

from pydantic import Field
from shapely.geometry import Point

from backend.app.climoptix_api import PreparationRequest, prepare
from backend.app.climoptix_provider import PreparationOnlyProvider
from geometry.climoptix_models import Contract, Id, Scenario
from geometry.climoptix_workflow import sampling_planes

Hash = Annotated[str, Field(pattern=r"^[a-f0-9]{64}$")]
LIMITS = {
    "cpu": 1,
    "memoryGb": 4,
    "wallTimeMinutes": 15,
    "storageGb": 1,
    "retentionDays": 3,
    "maxCells": 500000,
    "concurrentJobs": 1,
}


class Submission(Contract):
    contractVersion: Literal[1]
    dialect: Literal["OpenCFD-v2312"]
    sourceUnits: Literal["mm"]
    submissionId: UUID
    operation: Literal["mesh", "run"]
    studyId: Id
    clientRevision: Hash
    sourceHash: Hash
    configurationHash: Hash
    thermalApplication: dict[str, Any] | None
    project: dict[str, Any]
    scenario: Scenario


def validate_submission(request: Submission) -> dict[str, Any]:
    s = request.scenario
    if s.id != request.studyId or s.sourceBuildingId != request.project.get("projectId") or s.archived:
        raise ValueError("Study/source identity does not match, or the study is archived.")
    for key in ("cpu", "memoryGb", "wallTimeMinutes", "storageGb", "retentionDays"):
        if getattr(s.resources, key) > LIMITS[key]:
            raise ValueError(f"Worker limit: {key} must be at most {LIMITS[key]}. Change the study explicitly.")
    if s.mesh.maxCells > LIMITS["maxCells"]:
        raise ValueError("Worker maximum is 500000 cells. Change the study explicitly.")
    p = s.physics
    if (
        p.mode != "steady"
        or p.preset not in ("isothermal", "custom")
        or p.energy
        or p.co2
        or p.boussinesq
        or p.numerics.coupling != "SIMPLE"
        or p.numerics.monitor != "flowBalance"
    ):
        raise ValueError("This worker supports steady isothermal SIMPLE ventilation only.")
    if request.thermalApplication or s.thermalSnapshots:
        raise ValueError("Applied thermal conditions are not supported by this solver adapter.")
    if s.mesh.layers.enabled or s.mesh.alignmentDeg != 0:
        raise ValueError("Boundary layers and rotated background grids are not supported yet.")
    if any((s.outputs.temperature, s.outputs.co2, s.outputs.ageOfAir, s.outputs.comfort)) or any(
        field not in ("U", "p") for field in s.postProcessing.fields
    ):
        raise ValueError("Only velocity and kinematic pressure outputs are supported.")
    if (
        len(s.outputs.probesMm) > 100
        or sum(stack.count for stack in (s.postProcessing.x, s.postProcessing.y, s.postProcessing.z) if stack.enabled)
        > 20
    ):
        raise ValueError("This worker supports at most 100 probes and 20 sampling planes.")
    if p.numerics.maxIterations > 5000:
        raise ValueError("This worker supports at most 5000 steady iterations.")
    for vent in s.vents:
        if (
            vent.openAreaFraction != 1
            or vent.dischargeCoefficient != 1
            or vent.yawDeg
            or vent.pitchDeg
            or vent.recirculationPair
        ):
            raise ValueError("Vents require full open area, unit discharge, normal flow and no recirculation pair.")
    report = prepare(PreparationRequest(project=request.project, scenario=s, clientRevision=request.clientRevision))
    if report["validation"]["errors"] or not report["surface"]["exportable"]:
        raise ValueError("Authoritative geometry/preflight blocks execution. Resolve the study diagnostics.")
    if any(report["validation"][key] != getattr(request, key) for key in ("sourceHash", "configurationHash")):
        raise ValueError("Stale source/configuration fingerprint. Validate the current study again.")
    if len(report["surface"]["triangles"]) > 100000:
        raise ValueError("Canonical surface exceeds the worker triangle limit.")
    if report["domain"].get("slabVoids"):
        raise ValueError("Slab-void cases need a separately verified multi-level seed adapter.")
    for patch in report["patches"]:
        b = patch["boundary"]
        if b["thermal"]["type"] != "adiabatic" or b["roughnessM"] or b["scalarType"] != "zeroFlux":
            raise ValueError("Non-adiabatic, rough-wall and scalar boundary adapters are not enabled.")
        if patch["kind"] not in ("supply", "extract") and b["flow"]["type"] in ("velocity", "volumeFlow", "massFlow"):
            raise ValueError(
                "Assign flow through a Supply/Extract object; arbitrary surface flow is not supported yet."
            )
    for obj in report["objects"]:
        if obj["mode"] == "porousProxy" or obj.get("heatW", 0) or obj.get("co2M3S", 0):
            raise ValueError("Porous objects and heat/scalar sources are not supported by this adapter.")
    for override in s.assetOverrides:
        if override.temperatureK is not None:
            raise ValueError("Fixed-temperature objects require a thermal solver adapter.")
    domain = PreparationOnlyProvider().prepare_geometry(request.project, s)
    for probe in s.outputs.probesMm:
        if not any(
            room.id in domain.included
            and room.air.contains(Point(probe[0], probe[1]))
            and room.base < probe[2] < room.top(probe[0], probe[1])
            for room in domain.regions
        ):
            raise ValueError("Every probe must be strictly inside the selected canonical air volume.")
        if any(
            obj["mode"] == "solidProxy"
            and obj.get("verticesMm")
            and all(
                min(v[i] for v in obj["verticesMm"]) <= probe[i] <= max(v[i] for v in obj["verticesMm"])
                for i in range(3)
            )
            for obj in report["objects"]
        ):
            raise ValueError("A probe intersects a conservative solid-object bound. Move it into free air.")
    return report


def number(value: float) -> str:
    if not math.isfinite(value):
        raise ValueError("Non-finite solver value.")
    return f"{value:.12g}"


def vector(values: Any, scale: float = 1) -> str:
    return "(" + " ".join(number(float(v) * scale) for v in values) + ")"


def patch_name(identifier: str) -> str:
    return "p_" + hashlib.sha256(identifier.encode()).hexdigest()[:24]


def write_dictionary(root: Path, name: str, body: str, kind: str = "dictionary") -> None:
    from foamlib import FoamFile

    text = f"FoamFile {{ version 2.0; format ascii; class {kind}; object {Path(name).name}; }}\n" + body + "\n"
    # A grammar round-trip is a syntax check, not runtime/physical validation.
    FoamFile.loads(text)
    path = root / name
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(text, encoding="ascii")


def interior_point(report: dict[str, Any], request: Submission) -> list[float]:
    """Conservative deterministic seed, never a rendering mesh or display transform."""
    boxes = []
    for obj in report["objects"]:
        vertices = obj.get("verticesMm", [])
        if obj["mode"] == "solidProxy" and vertices:
            boxes.append(
                ([min(v[i] for v in vertices) for i in range(3)], [max(v[i] for v in vertices) for i in range(3)])
            )
    domain = PreparationOnlyProvider().prepare_geometry(request.project, request.scenario)
    for room in domain.regions:
        if room.id not in domain.included:
            continue
        polygon = room.air
        lowx, lowy, highx, highy = polygon.bounds
        # Use the lowest ceiling: a seed below it is inside every sloped roof zone.
        point = polygon.representative_point()
        candidates = [(point.x, point.y)] + [
            (lowx + (highx - lowx) * x / 10, lowy + (highy - lowy) * y / 10) for x in range(1, 10) for y in range(1, 10)
        ]
        for x, y in candidates:
            z = (room.base + room.top(x, y)) / 2 if polygon.contains(Point(x, y)) else room.base
            p = [x, y, z]
            if polygon.contains(Point(x, y)) and not any(
                all(a[i] - 1 <= p[i] <= b[i] + 1 for i in range(3)) for a, b in boxes
            ):
                return p
    raise ValueError("Cannot find a conservative interior mesh seed outside solid objects.")


def compile_case(root: Path, request: Submission, report: dict[str, Any]) -> dict[str, Any]:
    s, mesh, physics = request.scenario, request.scenario.mesh, request.scenario.physics
    surface = report["surface"]
    ids = sorted(set(surface["trianglePatches"]))
    patches = {p["id"]: p for p in report["patches"] if p["id"] in ids}
    names = {pid: patch_name(pid) for pid in ids}
    if set(patches) != set(ids):
        raise ValueError("Canonical surface patch mapping is incomplete.")
    (root / "constant/triSurface").mkdir(parents=True)
    triangles: dict[str, list[Any]] = {pid: [] for pid in ids}
    for triangle, pid in zip(surface["triangles"], surface["trianglePatches"], strict=True):
        triangles[pid].append([surface["verticesMm"][i] for i in triangle])
    # A multi-region closed surface, in metres exactly once.
    with (root / "constant/triSurface/boundary.stl").open("w", encoding="ascii") as out:
        for pid in ids:
            out.write(f"solid {names[pid]}\n")
            for vertices in triangles[pid]:
                a, b, c = vertices
                ab, ac = [b[i] - a[i] for i in range(3)], [c[i] - a[i] for i in range(3)]
                normal = [ab[1] * ac[2] - ab[2] * ac[1], ab[2] * ac[0] - ab[0] * ac[2], ab[0] * ac[1] - ab[1] * ac[0]]
                length = math.sqrt(sum(v * v for v in normal))
                out.write("facet normal " + " ".join(number(v / length) for v in normal) + "\nouter loop\n")
                for vertex in vertices:
                    out.write("vertex " + " ".join(number(v * 0.001) for v in vertex) + "\n")
                out.write("endloop\nendfacet\n")
            out.write(f"endsolid {names[pid]}\n")
    low, high = report["domain"]["boundsMm"]
    base = mesh.baseCellMm
    lo = [mesh.originMm[i] + (math.floor((low[i] - mesh.originMm[i]) / base) - 2) * base for i in range(3)]
    hi = [mesh.originMm[i] + (math.ceil((high[i] - mesh.originMm[i]) / base) + 2) * base for i in range(3)]
    counts = [round((hi[i] - lo[i]) / base) for i in range(3)]
    if math.prod(counts) > mesh.maxCells:
        raise ValueError("Background grid alone exceeds the cell budget. Increase the base cell size.")
    verts = [[x, y, z] for z in (lo[2], hi[2]) for y in (lo[1], hi[1]) for x in (lo[0], hi[0])]
    # OpenFOAM hexahedron vertex winding.
    verts = [verts[i] for i in (0, 1, 3, 2, 4, 5, 7, 6)]
    write_dictionary(
        root,
        "system/blockMeshDict",
        f"scale 1; vertices ({' '.join(vector(v, 0.001) for v in verts)});\n"
        f"blocks (hex (0 1 2 3 4 5 6 7) {vector(counts)} simpleGrading (1 1 1));\n"
        "edges (); boundary (farfield {type patch; faces ((0 3 2 1)(4 5 6 7)(0 1 5 4)"
        "(1 2 6 5)(2 3 7 6)(3 0 4 7));}); mergePatchPairs ();",
    )

    def level(cell: float) -> int:
        if cell < mesh.minCellMm:
            cell = mesh.minCellMm
        result = max(0, math.ceil(math.log2(base / cell) - 1e-12))
        if base / 2**result < mesh.minCellMm - 1e-6:
            raise ValueError("Quantized refinement would be finer than the minimum cell. Use compatible cell sizes.")
        return result

    region_names = " ".join(f"{name} {{name {name};}}" for name in names.values())
    geometry = f'"boundary.stl" {{type triSurfaceMesh; name building; regions {{{region_names}}}}}\n'
    local_regions = ""
    auto_regions = []
    # Near-device jets and obstacle wakes are explicit bounded volume refinements,
    # not a surface colour or a promise that the target cell count will be met.
    vent_specs = {v.id: v for v in s.vents}
    for index, vent in enumerate(report["vents"]):
        spec = vent_specs[vent["id"]]
        length = 4 * max(spec.widthMm, spec.heightMm, spec.diameterMm)
        centre, normal = vent["centerMm"], vent["outwardNormal"]
        end = [centre[i] - normal[i] * length for i in range(3)]
        radius = max(spec.widthMm, spec.heightMm, spec.diameterMm) / 2
        auto_regions.append(
            (
                f"jet_{index}",
                [min(centre[i], end[i]) - radius for i in range(3)],
                [max(centre[i], end[i]) + radius for i in range(3)],
                mesh.jetCellMm,
            )
        )
    for index, obj in enumerate(report["objects"]):
        vertices = obj.get("verticesMm", [])
        if obj["mode"] == "solidProxy" and vertices:
            auto_regions.append(
                (
                    f"wake_{index}",
                    [min(v[i] for v in vertices) - 2 * mesh.wakeCellMm for i in range(3)],
                    [max(v[i] for v in vertices) + 2 * mesh.wakeCellMm for i in range(3)],
                    mesh.wakeCellMm,
                )
            )
    for name, a, b, cell in auto_regions:
        geometry += f"{name} {{type searchableBox; min {vector(a, 0.001)}; max {vector(b, 0.001)};}}\n"
        local_regions += f"{name} {{mode inside; levels ((1e15 {level(cell)}));}}\n"
    for index, refinement in enumerate(mesh.refinements):
        name = f"refine_{index}"
        centre, size = list(refinement.centerMm), list(refinement.sizeMm)
        if refinement.shape == "object":
            obj = next((o for o in report["objects"] if o["id"] == refinement.objectId), None)
            if not obj or not obj.get("verticesMm"):
                raise ValueError("Object refinement has no canonical solid geometry.")
            a = [min(v[i] for v in obj["verticesMm"]) - mesh.wakeCellMm for i in range(3)]
            b = [max(v[i] for v in obj["verticesMm"]) + mesh.wakeCellMm for i in range(3)]
        else:
            a, b = ([centre[i] - size[i] / 2 for i in range(3)], [centre[i] + size[i] / 2 for i in range(3)])
        if refinement.shape == "sphere":
            geometry += (
                f"{name} {{type searchableSphere; centre {vector(centre, 0.001)}; "
                f"radius {number(size[0] * 0.0005)};}}\n"
            )
        else:
            geometry += f"{name} {{type searchableBox; min {vector(a, 0.001)}; max {vector(b, 0.001)};}}\n"
        lev = refinement.level if refinement.level is not None else level(refinement.cellMm)
        if base / 2**lev < mesh.minCellMm - 1e-6:
            raise ValueError("Refinement level exceeds the study's minimum cell size.")
        local_regions += f"{name} {{mode inside; levels ((1e15 {lev}));}}\n"
    surf_regions = []
    for pid, patch in patches.items():
        cell = (
            mesh.ventCellMm
            if patch["kind"] in ("supply", "extract")
            else mesh.openingCellMm
            if patch["kind"] in ("door", "window", "cap")
            else mesh.objectCellMm
            if patch["kind"] == "object"
            else mesh.wallCellMm
        )
        if patch["kind"] == "object":
            override = next((o for o in s.assetOverrides if o.objectId == patch["sourceId"]), None)
            if override:
                cell = min(cell, override.refinementMm)
        lev = level(cell)
        flow = patch["boundary"]["flow"]["type"]
        kind = "symmetryPlane" if flow == "symmetry" else "wall" if flow == "noSlip" else "patch"
        surf_regions.append(f"{names[pid]} {{level ({lev} {lev}); patchInfo {{type {kind};}}}}")
    quality = (
        f"maxNonOrtho {number(mesh.maxNonOrthogonality)}; maxBoundarySkewness {number(mesh.maxSkewness)}; "
        f"maxInternalSkewness {number(mesh.maxSkewness)}; maxConcave 80; minVol {number(mesh.minVolumeM3)}; "
        "minTetQuality 1e-15; minArea -1; minTwist 0.02; minDeterminant 0.001; minFaceWeight 0.02; "
        "minVolRatio 0.01; minTriangleTwist -1; nSmoothScale 4; errorReduction 0.75;"
    )
    write_dictionary(root, "system/meshQualityDict", quality)
    write_dictionary(
        root,
        "system/surfaceFeatureExtractDict",
        '"boundary.stl" {extractionMethod extractFromSurface; '
        f"extractFromSurfaceCoeffs {{includedAngle {number(180 - mesh.featureAngleDeg)};}} writeObj no;}}",
    )
    write_dictionary(
        root,
        "system/snappyHexMeshDict",
        f"castellatedMesh true; snap true; addLayers false; geometry {{{geometry}}}\n"
        f"castellatedMeshControls {{maxLocalCells {mesh.maxCells}; maxGlobalCells {mesh.maxCells}; "
        f"minRefinementCells 0; maxLoadUnbalance {number(mesh.loadImbalance)}; nCellsBetweenLevels 3; "
        f'features ({{file "boundary.eMesh"; level {level(mesh.ventCellMm)};}}); '
        f"refinementSurfaces {{building {{level (0 0); regions {{{' '.join(surf_regions)}}}}}}} "
        f"resolveFeatureAngle {number(mesh.featureAngleDeg)}; refinementRegions {{{local_regions}}} "
        f"locationInMesh {vector(interior_point(report, request), 0.001)}; allowFreeStandingZoneFaces true;}}\n"
        f"snapControls {{nSmoothPatch 3; tolerance {number(mesh.snapToleranceMm / mesh.minCellMm)}; "
        f"nSolveIter {mesh.snapIterations}; nRelaxIter 5; nFeatureSnapIter 10; "
        "implicitFeatureSnap false; explicitFeatureSnap true; multiRegionFeatureSnap true;}\n"
        "addLayersControls {relativeSizes true; layers {}; expansionRatio 1.2; finalLayerThickness 0.3; "
        "minThickness 0.1; nGrow 0; featureAngle 60; nRelaxIter 5; nSmoothSurfaceNormals 1; nSmoothNormals 3; "
        "nSmoothThickness 10; maxFaceThicknessRatio 0.5; maxThicknessToMedialRatio 0.3; minMedialAxisAngle 90; "
        "nBufferCellsNoExtrude 0; nLayerIter 50;}\n"
        f"meshQualityControls {{{quality}}} "
        f"mergeTolerance {number(mesh.geometryToleranceMm / max(hi[i] - lo[i] for i in range(3)))};",
    )
    nu = physics.dynamicViscosityPaS / physics.densityKgM3
    write_dictionary(
        root, "constant/transportProperties", f"transportModel Newtonian; nu [0 2 -1 0 0 0 0] {number(nu)};"
    )
    turbulent = physics.turbulence != "laminar"
    write_dictionary(
        root,
        "constant/turbulenceProperties",
        "simulationType "
        + (
            "RAS; RAS {RASModel " + physics.turbulence + "; turbulence on; printCoeffs on;}"
            if turbulent
            else "laminar;"
        ),
    )
    vent_by_patch = {v["patchId"]: v for v in report["vents"]}
    vents = {v.id: v for v in s.vents}
    fields = {
        "U": ("[0 1 -1 0 0 0 0]", vector(physics.initialVelocityMS)),
        "p": ("[0 2 -2 0 0 0 0]", number(physics.initialPressurePa / physics.densityKgM3)),
    }
    if turbulent:
        fields.update(k=("[0 2 -2 0 0 0 0]", number(max(physics.initialK, 1e-12))), nut=("[0 2 -1 0 0 0 0]", "0"))
        fields["epsilon" if physics.turbulence == "kEpsilon" else "omega"] = (
            ("[0 2 -3 0 0 0 0]", number(physics.initialEpsilon))
            if physics.turbulence == "kEpsilon"
            else ("[0 0 -1 0 0 0 0]", number(physics.initialOmega))
        )
    for field, (dimensions, initial) in fields.items():
        boundary = "farfield {type zeroGradient;}\n"
        for pid, patch in patches.items():
            b = patch["boundary"]
            flow = b["flow"]["type"]
            vent = vent_by_patch.get(pid)
            source = vents[vent["id"]] if vent else None
            wall = flow == "noSlip" and not vent
            condition = "type zeroGradient;"
            if flow == "symmetry" and not vent:
                condition = "type symmetryPlane;"
            elif field == "U":
                if source and source.control != "pressure":
                    q = abs(vent["volumeFlowM3S"]) * (1 if source.role == "supply" else -1)
                    condition = (
                        f"type flowRateInletVelocity; volumetricFlowRate constant {number(q)}; value uniform (0 0 0);"
                    )
                elif source or flow in ("pressure", "opening"):
                    condition = "type pressureInletOutletVelocity; value uniform (0 0 0);"
                elif wall:
                    condition = "type noSlip;"
                elif flow == "slip":
                    condition = "type slip;"
            elif field == "p":
                if (source and source.control == "pressure") or (not source and flow in ("pressure", "opening")):
                    value = source.valueSI if source else b["flow"]["value"]
                    condition = f"type fixedValue; value uniform {number(value / physics.densityKgM3)};"
            elif field == "nut":
                condition = "type nutkWallFunction; value uniform 0;" if wall else "type calculated; value uniform 0;"
            elif wall:
                wall_type = {"k": "kqRWallFunction", "epsilon": "epsilonWallFunction", "omega": "omegaWallFunction"}[
                    field
                ]
                condition = f"type {wall_type}; value uniform {initial};"
            else:
                intensity = source.turbulenceIntensity if source else b["turbulenceIntensity"]
                length = source.turbulenceLengthM if source else b["turbulenceLengthM"]
                speed = vent["meanVelocityMS"] if vent and vent.get("meanVelocityMS") is not None else 0.1
                k = max(1.5 * (intensity * speed) ** 2, 1e-12)
                inlet = {
                    "k": k,
                    "epsilon": 0.09**0.75 * k**1.5 / length,
                    "omega": math.sqrt(k) / (0.09**0.25 * length),
                }[field]
                condition = f"type inletOutlet; inletValue uniform {number(inlet)}; value uniform {initial};"
            boundary += f"{names[pid]} {{{condition}}}\n"
        write_dictionary(
            root,
            f"0/{field}",
            f"dimensions {dimensions}; internalField uniform {initial}; boundaryField {{{boundary}}}",
            "volVectorField" if field == "U" else "volScalarField",
        )
    n = physics.numerics
    gradient = "Gauss linear" if n.gradient == "linear" else "cellLimited Gauss linear 1"
    convection = {
        "upwind": "Gauss upwind",
        "linearUpwind": "Gauss linearUpwind grad(U)",
        "limitedLinear": "Gauss limitedLinear 1",
    }[n.convection]
    write_dictionary(
        root,
        "system/fvSchemes",
        f"ddtSchemes {{default steadyState;}} gradSchemes {{default {gradient};}} "
        f"divSchemes {{default none; div(phi,U) {convection}; div(phi,k) Gauss upwind; "
        "div(phi,epsilon) Gauss upwind; div(phi,omega) Gauss upwind; div((nuEff*dev2(T(grad(U))))) Gauss linear;} "
        "laplacianSchemes {default Gauss linear corrected;} interpolationSchemes {default linear;} "
        "snGradSchemes {default corrected;} wallDist {method meshWave;}",
    )
    write_dictionary(
        root,
        "system/fvSolution",
        "solvers {p {solver GAMG; tolerance 1e-8; relTol 0.01; smoother GaussSeidel;} "
        '"(U|k|epsilon|omega)" {solver smoothSolver; smoother symGaussSeidel; tolerance 1e-8; relTol 0.01;}} '
        f"SIMPLE {{nNonOrthogonalCorrectors {n.nonOrthogonalCorrections}; consistent no; pRefCell 0; "
        f"pRefValue {number(physics.initialPressurePa / physics.densityKgM3)}; "
        f'residualControl {{p {number(n.residualTarget)}; "(U|k|epsilon|omega)" {number(n.residualTarget)};}}}} '
        f'relaxationFactors {{fields {{p 0.3;}} equations {{".*" {number(n.relaxation)};}}}}',
    )
    functions = ""
    planes = sampling_planes(report["domain"]["boundsMm"], s.postProcessing)
    if planes:
        plane_dict = " ".join(
            f"{plane['id']} {{type cuttingPlane; planeType pointAndNormal; "
            f"pointAndNormalDict {{point {vector(plane['pointMm'], 0.001)}; normal {vector(plane['normal'])};}} "
            "interpolate true;}"
            for plane in planes
        )
        functions += (
            "slices {type surfaces; libs (sampling); surfaceFormat vtk; "
            "formatOptions {vtk {format ascii; legacy true;}} interpolationScheme cellPoint; "
            f"fields ({' '.join(s.postProcessing.fields)}); writeControl writeTime; "
            f"writeInterval {s.postProcessing.writeInterval}; surfaces {{{plane_dict}}}" + "}\n"
        )
    if s.outputs.probesMm:
        functions += (
            "probes {type probes; libs (sampling); fields (U p); writeControl timeStep; writeInterval 1; "
            f"probeLocations ({' '.join(vector(v, 0.001) for v in s.outputs.probesMm)});}}\n"
        )
    for pid, patch in patches.items():
        if patch["kind"] in ("supply", "extract") or patch["boundary"]["flow"]["type"] in ("pressure", "opening"):
            name = names[pid]
            functions += (
                f"flux_{name} {{type surfaceFieldValue; libs (fieldFunctionObjects); regionType patch; "
                f"name {name}; operation sum; fields (phi); writeFields false; "
                "writeControl timeStep; writeInterval 1; log true;}\n"
            )
    write_dictionary(
        root,
        "system/controlDict",
        f"application simpleFoam; startFrom startTime; startTime 0; stopAt endTime; "
        f"endTime {n.maxIterations}; deltaT 1; writeControl timeStep; writeInterval {n.writeEveryIterations}; "
        f"purgeWrite 2; writeFormat ascii; writePrecision 10; writeCompression off; timeFormat general; "
        f"timePrecision 10; runTimeModifiable false; functions {{{functions}}}",
    )
    write_dictionary(root, "system/decomposeParDict", f"numberOfSubdomains {s.resources.cpu}; method scotch;")
    manifest = {
        "dialect": request.dialect,
        "sourceUnits": "mm",
        "solverUnits": "m",
        "pressureUnit": "m2/s2",
        "pressureToPa": physics.densityKgM3,
        "clientRevision": request.clientRevision,
        "sourceHash": request.sourceHash,
        "configurationHash": request.configurationHash,
        "studyId": request.studyId,
        "patches": names,
        "samplingPlanes": planes,
        "resources": s.resources.model_dump(),
        "solver": "simpleFoam",
        "turbulence": physics.turbulence,
        "meshIntentNotes": [
            "targetCells is advisory; maxCells is checked against the actual mesh.",
            "Near-device jet AABBs extend four device widths into the room; wake AABBs extend two wake cells.",
            "Surface cell sizes are rounded to native halving levels; incompatible minimum cells are rejected.",
        ],
    }
    (root / "manifest.json").write_text(json.dumps(manifest, indent=2), encoding="utf-8")
    return manifest
