"""Local native-runtime acceptance; never an adjoint capability claim.

Uses the production case compiler/runtime and trusted laminar fixture. It neither
starts an HTTP service nor contacts Railway. Existing output directories are
refused, not deleted. Run with the OpenCFD environment and PYTHONPATH set.
"""

from __future__ import annotations

import argparse
import json
import os
import resource
import subprocess
import sys
import time
from pathlib import Path

import numpy as np

from backend.app.cfd_slice_data import AXES, grid_coordinates, read_plane
from backend.app.climoptix_provider import PreparationOnlyProvider
from backend.app.openfoam_case import validate_submission
from backend.app.openfoam_runtime import execute, runtime_available
from backend.app.openfoam_smoke import fixture
from backend.app.openfoam_telemetry import telemetry
from geometry.climoptix_workflow import sampling_planes


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output-directory", type=Path, required=True)
    parser.add_argument("--cpu", type=int, choices=(1, 2), default=1)
    options = parser.parse_args()
    root = options.output_directory.resolve()
    if root.exists():
        parser.error("Output directory already exists. Choose a new directory; nothing was removed.")
    if os.getuid() == 0:
        parser.error("Run this acceptance as the unprivileged Linux development user, not root.")
    if not runtime_available():
        parser.error("Source the pinned OpenCFD v2312 environment first.")

    root.mkdir(parents=True)
    started = time.perf_counter()
    request = fixture(cpu=options.cpu, turbulence="laminar")
    for axis in (
        request.scenario.postProcessing.x, request.scenario.postProcessing.y, request.scenario.postProcessing.z
    ):
        axis.enabled, axis.count = True, 1
    prepared = PreparationOnlyProvider().validate_scenario(request.project, request.scenario, request.clientRevision)
    request.sourceHash = prepared["validation"]["sourceHash"]
    request.configurationHash = prepared["validation"]["configurationHash"]
    report = validate_submission(request)
    result = execute(root / "laminar-case", request, report, lambda phase, message: print(
        f"{phase}: {message}", flush=True
    ), lambda: False)
    measured = telemetry(root / "laminar-case")
    probe_ready = bool(measured["balance"]) and len(measured["probes"]) == 1 and any(
        sample["velocityMS"] is not None and sample["pressureM2S2"] is not None
        for sample in measured["probes"][0]["samples"]
    )
    expected = {p["id"]: p for p in sampling_planes(report["domain"]["boundsMm"], request.scenario.postProcessing)}
    slices = []
    for path in sorted((root / "laminar-case/postProcessing/slices").glob("*/*.vtk")):
        plane = read_plane(path)
        declared = expected[path.stem]
        if AXES[plane.axis] != declared["axis"] or abs(
            plane.coordinate - declared["pointMm"][plane.axis] / 1000
        ) > 1e-7:
            raise ValueError(f"Native plane does not match its pinned coordinates: {path}")
        coordinates = grid_coordinates(plane.bounds, plane.axis, plane.coordinate, 32)
        if not all(np.isfinite(plane.sample(coordinates, name)).any() for name in ("U", "p")):
            raise ValueError(f"Native plane has no finite numeric U/p samples: {path}")
        slices.append({
            "path": str(path.relative_to(root)), "axis": AXES[plane.axis], "coordinateM": plane.coordinate,
            "normalSpanM": float(np.ptp(plane.points[:, plane.axis])),
        })
    slices_ready = {p["axis"] for p in slices} == set(AXES)
    output = {
        "kind": "LocalNativeRuntimeAcceptance",
        "adjointValidated": False,
        "solver": "simpleFoam",
        "processors": options.cpu,
        "foamVersion": os.environ.get("WM_PROJECT_VERSION"),
        "foamBuild": os.environ.get("WM_OPTIONS"),
        "python": sys.version.split()[0],
        "packages": subprocess.run([
            "dpkg-query", "-W", "openfoam2312", "openfoam2312-dev", "openfoam2312-source", "openfoam2312-tools"
        ], check=True, capture_output=True, text=True).stdout.splitlines(),
        "elapsedSeconds": time.perf_counter() - started,
        "maximumChildRssKiB": resource.getrusage(resource.RUSAGE_CHILDREN).ru_maxrss,
        "mesh": result["mesh"],
        "convergence": result["convergence"],
        "conservation": result["conservation"],
        "nativeSliceCount": sum(artifact["kind"] == "vtk" for artifact in result["artifacts"]),
        "numericSlices": slices,
        "numericSlicesReady": slices_ready,
        "telemetryReady": probe_ready,
        "accepted": bool(result["accepted"] and probe_ready and slices_ready and any(
            artifact["kind"] == "vtk" for artifact in result["artifacts"]
        )),
    }
    (root / "runtime-acceptance.json").write_text(json.dumps(output, indent=2), encoding="utf-8")
    print(json.dumps(output, indent=2), flush=True)
    return 0 if output["accepted"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
