"""Measured phase work units, not predicted wall time or convergence completion."""
import json
import math
import re
from pathlib import Path

from backend.app.openfoam_telemetry import read_complete_lines


def write_phase_progress(root: Path, phase: str, completed: int, total: int) -> None:
    target = root / "phase-progress.json"
    temporary = root / "phase-progress.tmp"
    temporary.write_text(json.dumps({"phase": phase, "progress": min(100, completed / max(1, total) * 100)}), encoding="ascii")
    temporary.replace(target)


def phase_progress(root: Path | None, phase: str, message: str, payload: str) -> dict:
    result: dict = {"progress": 100 if phase == "Completed" else None}
    try:
        request = json.loads(payload) if payload else {}
        if request.get("operation") in ("mesh", "run"):
            result["operation"] = request["operation"]
        if phase == "Running" and root:
            lines, _ = read_complete_lines(root / "solver.log", root, 128 * 1024)
            times = re.findall(r"^Time\s*=\s*([\d.eE+-]+)\s*$", "\n".join(lines), re.MULTILINE)
            budget = request.get("scenario", {}).get("physics", {}).get("numerics", {}).get("maxIterations")
            if times and isinstance(budget, (int, float)) and budget > 0:
                value = float(times[-1]) / budget * 100
                if math.isfinite(value) and value >= 0:
                    result.update(progress=min(99.9, value), progressBasis="iterationBudget")
        elif phase in ("Meshing", "MeshCheck", "Postprocess") and root:
            path = root / "phase-progress.json"
            if path.is_file() and not path.is_symlink() and path.stat().st_size < 1024:
                value = json.loads(path.read_text())
                progress = value.get("progress")
                if value.get("phase") == phase and isinstance(progress, (int, float)) and math.isfinite(progress) and 0 <= progress <= 100:
                    result.update(progress=progress, progressBasis="steps")
    except (OSError, ValueError, TypeError, KeyError):
        pass  # Missing/incomplete output is unknown, never a fabricated percentage.
    return result
