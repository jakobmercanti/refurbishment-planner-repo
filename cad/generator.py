"""Application-side adapter that invokes FreeCAD in an isolated process."""

from __future__ import annotations

import argparse
import json
import os
import shutil
import subprocess
import tempfile
from pathlib import Path

from geometry.engine import check_fit
from geometry.fixtures import build_l_shaped_fixture
from geometry.models import FitResult, Placement, ProductDefinition, RoomDefinition


class FreeCADGenerationError(RuntimeError):
    """Raised when a real FreeCAD runtime cannot generate the requested document."""


def find_freecad_cmd(explicit: str | Path | None = None) -> Path:
    if explicit is not None:
        requested = Path(explicit)
        if requested.is_file():
            return requested.resolve()
        raise FreeCADGenerationError(f"FreeCADCmd was not found at {requested}; no placeholder CAD file was created.")
    candidates = [
        Path(os.environ["FREECAD_CMD"]) if os.environ.get("FREECAD_CMD") else None,
        Path(r"C:\Program Files\FreeCAD 26.3\bin\freecadcmd.exe"),
        Path(r"C:\Program Files\FreeCAD 1.0\bin\FreeCADCmd.exe"),
    ]
    discovered = shutil.which("FreeCADCmd") or shutil.which("freecadcmd")
    if discovered:
        candidates.insert(0, Path(discovered))
    for candidate in candidates:
        if candidate is not None and candidate.is_file():
            return candidate.resolve()
    raise FreeCADGenerationError(
        "FreeCADCmd was not found. Install FreeCAD or set FREECAD_CMD; no placeholder CAD file was created."
    )


def _snapshot(
    room: RoomDefinition,
    product: ProductDefinition,
    placement: Placement,
    result: FitResult,
) -> dict[str, object]:
    return {
        "room": room.model_dump(mode="json"),
        "product": product.model_dump(mode="json"),
        "placement": placement.model_dump(mode="json"),
        "fit_result": result.model_dump(mode="json"),
    }


def generate_cad(
    room: RoomDefinition,
    product: ProductDefinition,
    placement: Placement,
    output_path: str | Path,
    *,
    freecad_cmd: str | Path | None = None,
) -> Path:
    """Generate a genuine FCStd document from validated authoritative inputs."""

    result = check_fit(room, product, placement)
    output = Path(output_path).resolve()
    output.parent.mkdir(parents=True, exist_ok=True)
    executable = find_freecad_cmd(freecad_cmd)
    worker = Path(__file__).with_name("freecad_worker.py").resolve()
    with tempfile.TemporaryDirectory(prefix="renovation-fit-cad-") as temporary_directory:
        snapshot_path = Path(temporary_directory) / "engineering_snapshot.json"
        snapshot_path.write_text(json.dumps(_snapshot(room, product, placement, result), indent=2), encoding="utf-8")
        environment = os.environ.copy()
        environment["RENOVATION_FIT_SNAPSHOT"] = str(snapshot_path)
        environment["RENOVATION_FIT_OUTPUT"] = str(output)
        worker_source = str(worker)
        worker_command = f"exec(compile(open({worker_source!r}, encoding='utf-8').read(), {worker_source!r}, 'exec'))"
        process = subprocess.run(
            [str(executable), "-c", worker_command],
            capture_output=True,
            text=True,
            timeout=120,
            check=False,
            env=environment,
        )
    if process.returncode != 0 or not output.is_file():
        detail = (process.stderr or process.stdout or "unknown FreeCAD error").strip()
        raise FreeCADGenerationError(f"FreeCAD generation failed: {detail}")
    return output


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--demo", action="store_true", help="generate the mandatory FIT fixture")
    parser.add_argument("output", type=Path)
    parser.add_argument("--freecad-cmd", type=Path, default=None)
    arguments = parser.parse_args()
    if not arguments.demo:
        parser.error("milestone 1 currently supports the validated --demo fixture")
    fixture = build_l_shaped_fixture()
    generated = generate_cad(
        fixture.room,
        fixture.product,
        fixture.placements["FIT"],
        arguments.output,
        freecad_cmd=arguments.freecad_cmd,
    )
    print(generated)


if __name__ == "__main__":
    main()
