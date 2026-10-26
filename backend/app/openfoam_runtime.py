"""Fixed executable pipeline, measured mesh gates and bounded native artifacts."""

from __future__ import annotations

import hashlib
import json
import math
import os
import re
import shutil
import signal
import subprocess
import time
from collections.abc import Callable
from pathlib import Path
from typing import Any
from zipfile import ZIP_DEFLATED, ZipFile

from backend.app.openfoam_case import Submission, compile_case
from backend.app.openfoam_telemetry import latest_time_file, read_complete_lines

MAX_LOG = 8 * 1024 * 1024
MAX_ARTIFACT = 128 * 1024 * 1024


class JobCancelled(RuntimeError):
    pass


def postprocessing_artifact(root: Path, paths: list[Path], deadline: float, cancelled: Callable[[], bool],
                            progress: Callable[[int], None] = lambda _count: None) -> dict:
    """Retain the actual native probes, fluxes and slices in a separate bounded ZIP."""
    target = root / "postprocessing.zip"
    with ZipFile(target, "w", ZIP_DEFLATED) as archive:
        for index, path in enumerate(paths):
            if cancelled():
                raise JobCancelled("Cancelled during post-processing packaging.")
            if time.monotonic() > deadline:
                raise TimeoutError("Job time limit reached during post-processing packaging.")
            if path.is_symlink() or not path.resolve().is_relative_to(root.resolve()) or not path.is_file():
                raise ValueError("Unsafe post-processing file.")
            archive.write(path, path.relative_to(root).as_posix())
            progress(index + 1)
            if target.stat().st_size > MAX_ARTIFACT:
                raise ValueError("Post-processing archive exceeds its 128 MB bound.")
    if target.stat().st_size > MAX_ARTIFACT:
        raise ValueError("Post-processing archive exceeds its 128 MB bound.")
    return {"id": "postprocessing", "path": target.name, "kind": "zip", "size": target.stat().st_size,
            "sha256": hashlib.sha256(target.read_bytes()).hexdigest()}


def child_limits() -> None:
    """Called in a small exec helper, not preexec_fn in a threaded Python server."""
    import resource

    resource.setrlimit(resource.RLIMIT_CORE, (0, 0))
    resource.setrlimit(resource.RLIMIT_FSIZE, (MAX_ARTIFACT, MAX_ARTIFACT))
    resource.setrlimit(resource.RLIMIT_NOFILE, (256, 256))
    resource.setrlimit(resource.RLIMIT_NPROC, (128, 128))
    cpu_seconds = int(os.environ["CFD_JOB_CPU_SECONDS"])
    memory_bytes = int(os.environ["CFD_JOB_MEMORY_BYTES"])
    resource.setrlimit(resource.RLIMIT_CPU, (cpu_seconds, cpu_seconds))
    resource.setrlimit(resource.RLIMIT_AS, (memory_bytes, memory_bytes))


def mesh_metrics(text: str, boundary: str, expected: set[str], scenario: Any) -> dict[str, Any]:
    def measured(pattern: str, label: str) -> float:
        matches = re.findall(pattern, text)
        if not matches:
            raise ValueError(f"checkMesh did not report {label}.")
        value = float(matches[-1].rstrip("."))
        if not math.isfinite(value):
            raise ValueError(f"checkMesh reported non-finite {label}.")
        return value

    m = scenario.mesh
    metrics = {
        "cells": int(measured(r"\bcells:\s+(\d+)", "cell count")),
        "maxNonOrthogonality": measured(r"Mesh non-orthogonality Max:\s*([\deE+.-]+)", "non-orthogonality"),
        "maxSkewness": measured(r"Max skewness\s*=\s*([\deE+.-]+)", "skewness"),
        "maxAspectRatio": measured(r"Max aspect ratio\s*=\s*([\deE+.-]+)", "aspect ratio"),
        "minVolumeM3": measured(r"Min volume\s*=\s*([\deE+.-]+)", "minimum volume"),
    }
    if "Mesh OK." not in text or re.search(r"Failed [1-9]\d* mesh checks", text):
        raise ValueError("checkMesh did not pass all topology/geometry checks.")
    if (
        metrics["cells"] > m.maxCells
        or metrics["cells"] < 1
        or metrics["maxNonOrthogonality"] > m.maxNonOrthogonality
        or metrics["maxSkewness"] > m.maxSkewness
        or metrics["maxAspectRatio"] > m.maxAspectRatio
        or metrics["minVolumeM3"] < m.minVolumeM3
    ):
        raise ValueError("Measured mesh quality/cell count exceeds the study's limits.")
    sizes = {name: int(count) for name, count in re.findall(r"(\w+)\s*\{[^{}]*?nFaces\s+(\d+)\s*;[^{}]*\}", boundary)}
    if any(sizes.get(name, 0) <= 0 for name in expected) or any(
        count > 0 and name not in expected for name, count in sizes.items()
    ):
        raise ValueError("Meshing lost an expected patch or retained an unassigned background boundary.")
    metrics["patchFaces"] = sizes
    return metrics


def convergence(text: str, target: float, turbulent: str) -> dict[str, Any]:
    # Inspect INITIAL residuals of the final outer iteration, not the reduced
    # residual of a single linear equation solve or an earlier converged time.
    iterations = re.split(r"(?m)^Time = ", text)
    tail = iterations[-1]
    try:
        final_iteration = float(tail.splitlines()[0]) if len(iterations) > 1 else None
    except (ValueError, IndexError):
        final_iteration = None
    if final_iteration is not None and (not math.isfinite(final_iteration) or final_iteration < 0):
        final_iteration = None
    residuals = {}
    for field, value in re.findall(r"Solving for (\w+), Initial residual = ([\deE+.-]+)", tail):
        residuals.setdefault(field, float(value))
    required = {"Ux", "Uy", "Uz", "p"}
    if turbulent != "laminar":
        required.update(("k", "epsilon" if turbulent == "kEpsilon" else "omega"))
    # OpenFOAM may omit identically zero vector components; never infer convergence
    # for absent components without a reported vector solve.
    passed = final_iteration is not None and required.issubset(residuals) and all(
        math.isfinite(residuals[f]) and residuals[f] <= target for f in required
    )
    return {"converged": passed, "finalInitialResiduals": residuals, "target": target, "finalIteration": final_iteration}


def flow_balance(root: Path, names: list[str], tolerance: float, *, expected_iteration: float | None = None) -> dict[str, Any]:
    values = []
    times = []
    for name in names:
        path = latest_time_file((root / "postProcessing" / f"flux_{name}").glob("*/surfaceFieldValue.dat"))
        if path is None:
            raise ValueError("No measured boundary flux was written.")
        lines, _ = read_complete_lines(path, root, 16384, require_complete=True)
        rows = [
            line.split() for line in lines if line.strip() and not line.lstrip().startswith("#")
        ]
        if not rows or len(rows[-1]) != 2:
            raise ValueError("Invalid boundary flux telemetry.")
        t, q = map(float, rows[-1])
        if not math.isfinite(q) or not math.isfinite(t):
            raise ValueError("Non-finite boundary flux.")
        times.append(t)
        values.append(q)
    if times and len(set(times)) != 1:
        raise ValueError("Boundary flux samples have different iteration timestamps.")
    if expected_iteration is not None and (not times or any(t != expected_iteration for t in times)):
        raise ValueError("Boundary flux does not match the final solver iteration.")
    denominator = max(sum(abs(q) for q in values) / 2, 1e-12)
    error = abs(sum(values)) / denominator
    return {
        "passed": error <= tolerance,
        "relativeImbalance": error,
        "tolerance": tolerance,
        "fluxM3S": dict(zip(names, values, strict=True)),
    }


def execute(
    root: Path,
    request: Submission,
    report: dict[str, Any],
    update: Callable[[str, str], None],
    cancelled: Callable[[], bool],
) -> dict[str, Any]:
    manifest = compile_case(root, request, report)
    deadline = time.monotonic() + request.scenario.resources.wallTimeMinutes * 60
    log = root / "solver.log"
    max_bytes = int(request.scenario.resources.storageGb * 1000**3)
    # Child processes receive only runtime/library settings, never auth credentials.
    environment = {
        k: v
        for k, v in os.environ.items()
        if k.startswith(("FOAM", "WM_", "MPI", "OPAL"))
        or k in ("PATH", "LD_LIBRARY_PATH", "HOME", "USER", "LANG", "LC_ALL")
    }
    environment.update(OMP_NUM_THREADS="1", OPENBLAS_NUM_THREADS="1")
    # Single-container MPI: avoid shared-memory transports/PMIx datastore sizing
    # against the host's (rather than the container's) memory topology.
    environment.update(OMPI_MCA_btl="self,tcp", OMPI_MCA_pml="ob1", PMIX_MCA_gds="hash", MALLOC_ARENA_MAX="2")
    environment["PYTHONPATH"] = str(Path(__file__).resolve().parents[2])
    environment["CFD_JOB_CPU_SECONDS"] = str(request.scenario.resources.wallTimeMinutes * 60)
    environment["CFD_JOB_MEMORY_BYTES"] = str(int(min(request.scenario.resources.memoryGb * 1000**3, 3 * 1024**3)))

    def command(args: list[str], phase: str) -> None:
        update(phase, "Executing " + args[0])
        with log.open("ab", buffering=0) as output:
            output.write(("\n--- " + " ".join(args) + " ---\n").encode())
            # Resource limits are installed in an exec'd helper; no unsafe
            # preexec_fn call in this multi-threaded service.
            process = subprocess.Popen(
                [os.sys.executable, "-m", "backend.app.openfoam_runtime", *args],
                cwd=root,
                stdout=output,
                stderr=subprocess.STDOUT,
                env=environment,
                start_new_session=True,
            )
            try:
                while process.poll() is None:
                    if cancelled():
                        raise JobCancelled("Cancelled by the authenticated owner.")
                    if time.monotonic() > deadline:
                        raise TimeoutError("Job reached its wall-time limit.")
                    if log.stat().st_size > MAX_LOG:
                        raise ValueError("Solver log exceeded its 8 MB bound.")
                    size = sum(p.stat().st_size for p in root.rglob("*") if p.is_file())
                    if size > max_bytes:
                        raise ValueError("Job exceeded its persistent storage limit.")
                    time.sleep(0.25)
                if process.returncode:
                    raise ValueError(f"{args[0]} failed (exit {process.returncode}); inspect the bounded solver log.")
            finally:
                # Also kill any surviving MPI ranks, including when their launcher exited.
                try:
                    os.killpg(process.pid, signal.SIGKILL)
                except ProcessLookupError:
                    pass
                process.wait()

    from backend.app.openfoam_progress import write_phase_progress
    for completed, args in enumerate((["blockMesh"], ["surfaceFeatureExtract"], ["snappyHexMesh", "-overwrite"])):
        write_phase_progress(root, "Meshing", completed, 3)
        command(args, "Meshing")
        write_phase_progress(root, "Meshing", completed + 1, 3)
    write_phase_progress(root, "MeshCheck", 0, 1)
    command(["checkMesh", "-allGeometry", "-allTopology"], "MeshCheck")
    write_phase_progress(root, "MeshCheck", 1, 1)
    metrics = mesh_metrics(
        log.read_text(errors="replace"),
        (root / "constant/polyMesh/boundary").read_text(),
        set(manifest["patches"].values()),
        request.scenario,
    )
    manifest["mesh"] = metrics
    if request.operation == "run":
        cpu = request.scenario.resources.cpu
        if cpu > 1:
            command(["decomposePar", "-force"], "Running")
            command(["mpirun", "-np", str(cpu), "simpleFoam", "-parallel"], "Running")
            command(["reconstructPar", "-latestTime"], "Postprocess")
        else:
            command(["simpleFoam"], "Running")
        text = log.read_text(errors="replace")
        manifest["convergence"] = convergence(
            text, request.scenario.physics.numerics.residualTarget, request.scenario.physics.turbulence
        )
        flow_names = [
            manifest["patches"][patch["id"]]
            for patch in report["patches"]
            if patch["id"] in manifest["patches"]
            and (patch["kind"] in ("supply", "extract") or patch["boundary"]["flow"]["type"] in ("pressure", "opening"))
        ]
        final_iteration = manifest["convergence"]["finalIteration"]
        if final_iteration is None:
            raise ValueError("No finite final solver iteration was reported.")
        manifest["conservation"] = flow_balance(root, flow_names, request.scenario.physics.numerics.balanceTolerance,
                                              expected_iteration=final_iteration)
    update("Postprocess", "Packaging provenance-bound native fields and ASCII slices")
    write_phase_progress(root, "Postprocess", 0, 1)
    manifest["accepted"] = request.operation == "mesh" or (
        manifest["convergence"]["converged"] and manifest["conservation"]["passed"]
    )
    # Native pressure remains kinematic. Do not label it as Pa or rewrite native fields.
    artifacts = []
    slice_paths = sorted((root / "postProcessing/slices").rglob("*.vtk"))
    # Bound browser artifacts to the latest sampled time, not every field write.
    if slice_paths:
        latest_time = max(float(p.parent.name) for p in slice_paths)
        slice_paths = [p for p in slice_paths if float(p.parent.name) == latest_time]
    for path in slice_paths:
        if path.stat().st_size <= 25 * 1024**2:
            text = path.read_text(encoding="ascii")
            lines = text.splitlines()
            if len(lines) < 4 or lines[2].strip() != "ASCII" or "DATASET POLYDATA" not in lines:
                raise ValueError("The native slice writer did not produce bounded ASCII POLYDATA.")
            count = re.search(r"(?m)^POINTS\s+(\d+)\s+", text)
            if not count or int(count[1]) > 250000:
                continue  # Full native output remains available in the archive.
            if re.search(r"\b(?:nan|[-+]?inf)\b", text, re.IGNORECASE):
                raise ValueError("Native sampled fields contain non-finite values.")
            artifacts.append(
                {
                    "id": f"slice-{len(artifacts)}",
                    "name": path.name,
                    "path": str(path.relative_to(root)),
                    "size": path.stat().st_size,
                    "sha256": hashlib.sha256(path.read_bytes()).hexdigest(),
                    "kind": "vtk",
                    "pressureUnit": "m2/s2",
                }
            )
    (root / "result.json").write_text(json.dumps(manifest, indent=2), encoding="utf-8")
    archive_path = root / "native-case.zip"
    paths = sorted(path for path in root.rglob("*") if path.is_file() and path.name not in
                   {"native-case.zip", "postprocessing.zip", "phase-progress.json", "phase-progress.tmp"}
                   and not any(part.startswith("processor") for part in path.parts))
    post_paths = sorted(path for path in (root / "postProcessing").rglob("*") if path.is_file()) if request.operation == "run" else []
    total_steps = len(paths) + len(post_paths) + 2  # file writes plus archive integrity hashes
    with ZipFile(archive_path, "w", ZIP_DEFLATED) as archive:
        for index, path in enumerate(paths):
            if path.is_file() and path != archive_path and not any(part.startswith("processor") for part in path.parts):
                if cancelled():
                    raise JobCancelled("Cancelled during native artifact packaging.")
                if time.monotonic() > deadline:
                    raise TimeoutError("Job time limit reached during native packaging.")
                archive.write(path, path.relative_to(root).as_posix())
                write_phase_progress(root, "Postprocess", index + 1, total_steps)
                if archive_path.stat().st_size > MAX_ARTIFACT:
                    raise ValueError("Native case archive exceeds its 128 MB bound.")
    if archive_path.stat().st_size > MAX_ARTIFACT:
        raise ValueError("Native case archive exceeds its 128 MB bound.")
    if cancelled():
        raise JobCancelled("Cancelled during native artifact packaging.")
    if time.monotonic() > deadline or sum(p.stat().st_size for p in root.rglob("*") if p.is_file()) > max_bytes:
        raise ValueError("Job time/storage limit reached while packaging artifacts.")
    artifacts.append(
        {
            "id": "native-case",
            "path": "native-case.zip",
            "size": archive_path.stat().st_size,
            "sha256": hashlib.sha256(archive_path.read_bytes()).hexdigest(),
            "kind": "zip",
        }
    )
    if request.operation == "run":
        artifacts.append(postprocessing_artifact(root, post_paths, deadline, cancelled,
                         lambda count: write_phase_progress(root, "Postprocess", len(paths) + count + 1, total_steps)))
    if sum(p.stat().st_size for p in root.rglob("*") if p.is_file()) > max_bytes:
        raise ValueError("Job storage limit reached while packaging post-processing.")
    manifest["artifacts"] = artifacts
    (root / "result.json").write_text(json.dumps(manifest, indent=2), encoding="utf-8")
    write_phase_progress(root, "Postprocess", total_steps, total_steps)
    return manifest


def runtime_available() -> bool:
    return os.environ.get("WM_PROJECT_VERSION") == "v2312" and all(
        shutil.which(name)
        for name in (
            "blockMesh",
            "surfaceFeatureExtract",
            "snappyHexMesh",
            "checkMesh",
            "simpleFoam",
            "decomposePar",
            "mpirun",
            "reconstructPar",
        )
    )


if __name__ == "__main__":
    child_limits()
    args = os.sys.argv[1:]
    allowed = {
        "blockMesh",
        "surfaceFeatureExtract",
        "snappyHexMesh",
        "checkMesh",
        "simpleFoam",
        "decomposePar",
        "mpirun",
        "reconstructPar",
    }
    if not args or args[0] not in allowed:
        raise SystemExit("Unknown fixed runtime command")
    os.execvpe(args[0], args, os.environ)
