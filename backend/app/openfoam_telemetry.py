"""Bounded, read-only native probe and boundary-flux telemetry.

Never infer missing samples, interpolate different iterations or use renderer data.
The full native files remain in the case archive; this is a recent-history view.
"""
from __future__ import annotations

import json
import math
import re
from pathlib import Path

MAX_PROBES = 100
MAX_PROBE_SAMPLES = 32
MAX_BALANCE_SAMPLES = 120
MAX_PATCHES = 128


def _number(value: str) -> float:
    number = float(value)
    if not math.isfinite(number) or abs(number) > 1e12:
        raise ValueError("Non-finite/out-of-range native telemetry")
    return number


def read_complete_lines(path: Path, root: Path, limit: int, *, require_complete: bool = False) -> tuple[list[str], bool]:
    if path.is_symlink() or not path.resolve().is_relative_to(root.resolve()):
        raise ValueError("Unsafe telemetry path")
    with path.open("rb") as stream:
        size = path.stat().st_size
        start = max(0, size - limit)
        stream.seek(start)
        data = stream.read(limit)
    if require_complete and data and not data.endswith(b"\n"):
        raise ValueError("Incomplete native telemetry.")
    if start:
        data = data.partition(b"\n")[2]
    # A native writer can be between writes. Only parse complete lines.
    return data[:data.rfind(b"\n") + 1].decode("ascii", errors="replace").splitlines(), bool(start)


def latest_time_file(paths) -> Path | None:
    candidates = []
    for path in paths:
        try:
            time = _number(path.parent.name)
            if path.is_file():
                candidates.append((time, path))
        except ValueError:
            continue
    return max(candidates, key=lambda item: item[0])[1] if candidates else None


def telemetry(root: Path) -> dict:
    result = {"version": 1, "truncated": False, "warnings": [], "balance": None, "probes": []}
    warnings: set[str] = set()
    manifest = {}
    try:
        path = root / "manifest.json"
        if path.is_file() and path.stat().st_size <= 1024**2:
            manifest = json.loads(path.read_text())
    except (OSError, ValueError):
        warnings.add("Case metadata is not available yet.")
    if not isinstance(manifest, dict):
        manifest = {}
        warnings.add("Case metadata is not available yet.")
    post = root / "postProcessing"
    expected = manifest.get("flowPatchNames")
    if isinstance(expected, list) and any(
        not isinstance(name, str) or not re.fullmatch(r"p_[a-f0-9]+", name) for name in expected
    ):
        expected = []
        warnings.add("Invalid flux metadata was omitted.")
    flux_dirs = ([post / f"flux_{name}" for name in expected] if isinstance(expected, list)
                 else sorted(post.glob("flux_*")))
    if len(flux_dirs) > MAX_PATCHES:
        result["truncated"] = True
        warnings.add("Too many flux patches for the live view; use the full native archive.")
    elif flux_dirs:
        flux = {}
        for folder in flux_dirs:
            if not re.fullmatch(r"flux_p_[a-f0-9]+", folder.name):
                continue
            path = latest_time_file(folder.glob("*/surfaceFieldValue.dat"))
            rows = {}
            if path:
                try:
                    lines, clipped = read_complete_lines(path, root, 16384)
                    result["truncated"] |= clipped
                    for line in lines:
                        if not line.strip() or line.lstrip().startswith("#"):
                            continue
                        try:
                            time, value = line.split()
                            time = _number(time)
                            if time < 0:
                                raise ValueError("Invalid iteration")
                            rows[time] = _number(value)
                        except ValueError:
                            warnings.add("Invalid boundary-flux samples were omitted.")
                except (OSError, ValueError):
                    warnings.add("Some native boundary-flux data is not readable yet.")
            result["truncated"] |= len(rows) > MAX_BALANCE_SAMPLES
            flux[folder.name.removeprefix("flux_")] = dict(list(rows.items())[-MAX_BALANCE_SAMPLES:])
        # All patches must agree on an iteration; reading midway through a native
        # write may show an older common iteration, never a false partial balance.
        common = set.intersection(*(set(rows) for rows in flux.values())) if flux else set()
        samples = []
        for time in sorted(common)[-MAX_BALANCE_SAMPLES:]:
            values = {name: rows[time] for name, rows in flux.items()}
            incoming = -sum(min(value, 0) for value in values.values())
            outgoing = sum(max(value, 0) for value in values.values())
            net = outgoing - incoming
            samples.append({"iteration": time, "relativeImbalance": abs(net) / max((incoming + outgoing) / 2, 1e-12),
                            "incomingM3S": incoming, "outgoingM3S": outgoing, "netM3S": net})
        if samples:
            time = samples[-1]["iteration"]
            tolerance = manifest.get("balanceTolerance")
            if not isinstance(tolerance, (int, float)) or not math.isfinite(tolerance) or not 0 < tolerance <= 1:
                tolerance = None
            result["balance"] = {"samples": samples, "fluxM3S": {name: rows[time] for name, rows in flux.items()},
                                 "tolerance": tolerance}

    positions = manifest.get("probePositionsMm", [])
    if not isinstance(positions, list) or any(
        not isinstance(point, (list, tuple)) or len(point) != 3
        or any(not isinstance(value, (int, float)) or not math.isfinite(value) or abs(value) > 1e12 for value in point)
        for point in positions
    ):
        positions = []
        warnings.add("Invalid probe position metadata was omitted.")
    positions = positions[:MAX_PROBES]
    vectors, pressures = {}, {}
    for field, target in (("U", vectors), ("p", pressures)):
        path = latest_time_file((post / "probes").glob(f"*/{field}"))
        if not path:
            continue
        try:
            lines, clipped = read_complete_lines(path, root, 256 * 1024)
            result["truncated"] |= clipped
            for line in lines:
                if not line.strip() or line.lstrip().startswith("#"):
                    continue
                try:
                    time, raw = line.split(maxsplit=1)
                    if field == "U":
                        matches = re.findall(r"\(([^()]*)\)", raw)
                        if re.sub(r"\([^()]*\)", "", raw).strip():
                            raise ValueError("Invalid vector row")
                        values = [list(map(_number, value.split())) for value in matches]
                        if any(len(value) != 3 for value in values):
                            raise ValueError("Invalid vector")
                    else:
                        values = list(map(_number, raw.split()))
                    if not values or len(values) > MAX_PROBES or (positions and len(values) != len(positions)):
                        raise ValueError("Invalid probe count")
                    time = _number(time)
                    if time < 0:
                        raise ValueError("Invalid iteration")
                    target[time] = values
                except ValueError:
                    warnings.add("Invalid/out-of-domain probe samples were omitted.")
        except (OSError, ValueError):
            warnings.add("Some native probe data is not readable yet.")
    times = sorted(vectors.keys() | pressures.keys())
    result["truncated"] |= len(times) > MAX_PROBE_SAMPLES
    times = times[-MAX_PROBE_SAMPLES:]
    count = max((len(values) for values in (*vectors.values(), *pressures.values())), default=0)
    for index in range(count):
        samples = []
        for time in times:
            velocity, pressure = vectors.get(time, []), pressures.get(time, [])
            samples.append({"iteration": time, "velocityMS": velocity[index] if index < len(velocity) else None,
                            "pressureM2S2": pressure[index] if index < len(pressure) else None})
        result["probes"].append({"index": index, "positionMm": positions[index] if index < len(positions) else None,
                                 "samples": samples})
    result["warnings"] = sorted(warnings)[:8]
    return result
