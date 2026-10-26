"""Owner-scoped native slice inventory and bounded numerical comparison service."""

from __future__ import annotations

import hashlib
import json
import re
import sqlite3
import threading
import time
from functools import lru_cache
from pathlib import Path
from typing import Any, Protocol
from uuid import UUID, uuid4

import numpy as np
from fastapi import HTTPException
from pydantic import BaseModel, ConfigDict, Field

from backend.app.cfd_slice_data import (
    AXES,
    MAX_BYTES,
    Plane,
    difference,
    grid_coordinates,
    json_values,
    read_plane,
    scalar,
    statistics,
)

TERMINAL = {"Completed", "Failed", "Cancelled", "Stale"}
METHOD = "GEOS constrained source-cell triangles / barycentric point tuples / stored cell values"
UNITS = {"U": "m/s", "p": "m²/s²", "k": "m²/s²", "epsilon": "m²/s³", "omega": "s⁻¹"}
_inventory_lock = threading.Lock()
_sampling_slots = threading.BoundedSemaphore(2)


class SliceStore(Protocol):
    def get(self, owner: str, job_id: str) -> sqlite3.Row: ...
    def path(self, job_id: str) -> Path: ...


def view_root(case: Path) -> Path:
    # Never write caches inside a live case: that would change its solver storage
    # budget or become duplicate data in native-case.zip during packaging.
    return case.parent / "slice-views" / str(UUID(case.name))


def safe_path(root: Path, relative: str) -> Path:
    path = root / relative
    if path.is_symlink() or not path.resolve().is_relative_to(root.resolve()) or not path.is_file():
        raise ValueError("Slice missing or unsafe; its worker retention may have expired.")
    if path.stat().st_size > MAX_BYTES:
        raise ValueError("Slice exceeds the 25 MB bound.")
    return path


@lru_cache(maxsize=2)
def load_snapshot(path: str, digest: str, stamp: tuple[int, int]) -> Plane:
    source = Path(path)
    if hashlib.sha256(source.read_bytes()).hexdigest() != digest:
        raise ValueError("Slice integrity check failed; reload its inventory.")
    return read_plane(source)


def inventory(root: Path, row: sqlite3.Row) -> dict[str, Any]:
    if row["expires"] <= time.time() or not row["payload"]:
        raise HTTPException(410, "These result files expired. Restore a retained case or choose another run.")
    payload = json.loads(row["payload"])
    scenario = payload["scenario"]
    # Native v2312 case coordinates are global SI, not Three's [X,Z,-Y].
    result = {
        "schemaVersion": 1,
        "runId": row["id"],
        "projectId": row["project"],
        "studyId": row["study"],
        "name": scenario.get("name", row["study"]),
        "createdAt": row["created"],
        "updatedAt": row["updated"],
        "status": row["phase"],
        "message": row["message"],
        "sourceHash": payload["sourceHash"],
        "configurationHash": payload["configurationHash"],
        "revision": row["revision"],
        "frame": "global-XYZ-m-Z-up",
        "solver": "simpleFoam",
        "timeKind": "steady-iteration",
        "domain": scenario.get("domain", {}),
        "planes": [],
        "warnings": [],
        "pending": 0,
    }
    # pRefCell is not a comparable physical reference after geometry changes.
    reference = [payload["sourceHash"], scenario.get("boundaries"), scenario.get("vents")]
    result["pressureReference"] = hashlib.sha256(json.dumps(reference, sort_keys=True).encode()).hexdigest()
    if not root.is_dir():
        result["warnings"].append("No completed sampled-plane write is available yet.")
        return result
    with _inventory_lock:
        cache = view_root(root)
        cache.mkdir(parents=True, exist_ok=True)
        index_path = cache / "slice-index.json"
        try:
            index = json.loads(index_path.read_text()) if index_path.is_file() else {}
        except (ValueError, OSError):
            index = {}
        case = json.loads((root / "manifest.json").read_text()) if (root / "manifest.json").is_file() else {}
        expected = {p["id"]: p for p in case.get("samplingPlanes", [])}
        # A later solver iteration proves the earlier field-write call returned.
        # Never advertise a growing current-time file as ready, even if parseable.
        last_iteration = -np.inf
        log = root / "solver.log"
        if log.is_file():
            with log.open("rb") as stream:
                stream.seek(max(0, log.stat().st_size - 256 * 1024))
                times = re.findall(rb"(?:^|\n)Time = ([0-9.eE+-]+)\s*\n", stream.read())
                if times:
                    last_iteration = float(times[-1])
        paths = sorted((root / "postProcessing/slices").glob("*/*.vtk"))
        # Latest ten stored write times, max 20 planes/time; existing native files
        # remain in the archive. No volume fields are loaded into the browser.
        valid = [p for p in paths if re.fullmatch(r"[0-9.eE+-]+", p.parent.name)]
        times = sorted({float(p.parent.name) for p in valid if np.isfinite(float(p.parent.name))})[-10:]
        candidates = [p for p in valid if float(p.parent.name) in times][-200:]
        bytes_read = 0
        for source in candidates:
            relative = source.relative_to(root).as_posix()
            stamp = [source.stat().st_size, source.stat().st_mtime_ns]
            key = relative
            if row["phase"] not in TERMINAL | {"Postprocess"} and float(source.parent.name) >= last_iteration:
                result["pending"] += 1
                continue
            try:
                safe_path(root, relative)
                cached = index.get(key)
                if cached and cached["stamp"] == stamp:
                    result["planes"].append(cached["meta"])
                    continue
                bytes_read += source.stat().st_size
                if bytes_read > 128 * 1024**2:
                    result["warnings"].append("Inventory read bound reached. Narrow the retained output cadence.")
                    break
                plane = read_plane(source)
                wanted = scenario.get("postProcessing", {}).get("fields", ["U", "p"])
                if not all(name in plane.fields for name in wanted):
                    raise ValueError("The requested field write is incomplete; required arrays are missing.")
                declared = expected.get(source.stem)
                if declared and (
                    declared["axis"] != AXES[plane.axis]
                    or abs(declared["pointMm"][plane.axis] / 1000 - plane.coordinate) > 1e-6
                ):
                    raise ValueError("Stored plane does not match its pinned physical coordinates.")
                data = source.read_bytes()
                if stamp != [source.stat().st_size, source.stat().st_mtime_ns]:
                    raise ValueError("Plane is still being written; retry shortly.")
                digest = hashlib.sha256(data).hexdigest()
                folder = cache / "snapshots"
                folder.mkdir(exist_ok=True)
                target = folder / f"{digest}.vtk"
                if not target.is_file():
                    if sum(p.stat().st_size for p in cache.parent.rglob("*.vtk")) + len(data) > 128 * 1024**2:
                        raise ValueError("Snapshot retention bound reached; download the native archive.")
                    temporary = folder / f"{uuid4()}.tmp"
                    temporary.write_bytes(data)
                    temporary.replace(target)
                units = {**UNITS, **case.get("fieldUnits", {})}
                fields = [
                    {
                        "name": name,
                        "components": field.values.shape[1],
                        "cell": field.cell,
                        "unit": units.get(name, "unverified file units"),
                    }
                    for name, field in plane.fields.items()
                ]
                asset_id = hashlib.sha256(f"{relative}:{digest}".encode()).hexdigest()
                meta = {
                    "id": asset_id,
                    "sha256": digest,
                    "name": source.name,
                    "axis": AXES[plane.axis],
                    "coordinate": plane.coordinate,
                    "time": source.parent.name,
                    "status": "ready",
                    "bounds": plane.bounds,
                    "fields": fields,
                    "method": METHOD,
                }
                index[key] = {"stamp": stamp, "meta": meta}
                result["planes"].append(meta)
            except (ValueError, OSError, KeyError) as error:
                result["warnings"].append(f"{source.name} @ {source.parent.name}: {str(error)[:200]}")
                result["pending"] += 1
        temp = cache / "slice-index.tmp"
        temp.write_text(json.dumps(index))
        temp.replace(index_path)
    # Collapse duplicate assets/physical planes, never invent constant spacing.
    unique = {(p["axis"], round(p["coordinate"], 9), p["time"]): p for p in result["planes"]}
    result["planes"] = sorted(unique.values(), key=lambda p: (float(p["time"]), p["axis"], p["coordinate"]))
    result["warnings"] = result["warnings"][:20]
    return result


class Selection(BaseModel):
    model_config = ConfigDict(extra="forbid")
    runId: UUID
    assetId: str = Field(pattern=r"^[a-f0-9]{64}$")


class SliceRequest(BaseModel):
    model_config = ConfigDict(extra="forbid", allow_inf_nan=False)
    projectId: UUID
    baseline: Selection
    option: Selection | None = None
    field: str = Field(min_length=1, max_length=200)
    component: int = Field(default=-1, ge=-1, le=8)
    size: int = Field(default=96, ge=16, le=512)
    deltaMode: str = Field(default="absolute", pattern=r"^(absolute|percent|vector)$")
    epsilon: float = Field(default=1e-6, gt=0, le=1e10)
    temperature: str = Field(default="K", pattern=r"^(K|C)$")
    point: tuple[float, float, float] | None = None


def selected(
    store: SliceStore, owner: str, project: str, selection: Selection
) -> tuple[dict[str, Any], dict[str, Any], Plane]:
    row = store.get(owner, str(selection.runId))
    if row["project"] != project:
        raise HTTPException(404, "Run not found in this project.")
    root = store.path(row["id"])
    manifest = inventory(root, row)
    meta = next((p for p in manifest["planes"] if p["id"] == selection.assetId), None)
    if not meta:
        raise HTTPException(409, "Selected slice changed or expired. Refresh the available planes.")
    path = safe_path(view_root(root), f"snapshots/{meta['sha256']}.vtk")
    stat = path.stat()
    return manifest, meta, load_snapshot(str(path), meta["sha256"], (stat.st_size, stat.st_mtime_ns))


def incompatibilities(
    a: dict[str, Any], ap: dict[str, Any], b: dict[str, Any], bp: dict[str, Any], name: str
) -> list[str]:
    reasons = []
    if a["frame"] != b["frame"]:
        reasons.append("Coordinate frames differ; align the source fields before comparison.")
    if ap["axis"] != bp["axis"] or abs(ap["coordinate"] - bp["coordinate"]) > 1e-7:
        reasons.append("No matching physical plane. Nearest-plane viewing is non-quantitative; delta is disabled.")
    if a["timeKind"] != b["timeKind"] or (a["timeKind"] != "steady-iteration" and ap["time"] != bp["time"]):
        reasons.append("Physical times do not match.")
    af, bf = (next((f for f in p["fields"] if f["name"] == name), None) for p in (ap, bp))
    if not af or not bf:
        reasons.append("The selected field is missing in one run.")
    elif af["unit"] != bf["unit"] or "unverified" in af["unit"] or af["components"] != bf["components"]:
        reasons.append("Field units/components are not physically comparable.")
    if name == "p" and a["pressureReference"] != b["pressureReference"]:
        reasons.append(
            "Kinematic pressure references may differ after geometry/boundary changes; normalize externally first."
        )
    return reasons


def probe_data(
    plane: Plane, points: np.ndarray, name: str, component: int, temperature: str, unit: str
) -> dict[str, Any]:
    if name not in plane.fields:
        return {"value": None, "velocity": None, "method": METHOD, "reason": "Field unavailable"}
    value = scalar(plane.sample(points, name), component)[0]
    if name == "T" and unit == "K" and temperature == "C":
        value -= 273.15
    velocity = plane.sample(points, "U")[0] if "U" in plane.fields and plane.fields["U"].values.shape[1] == 3 else None
    return {
        "value": float(value) if np.isfinite(value) else None,
        "velocity": json_values(velocity) if velocity is not None and np.isfinite(velocity).all() else None,
        "method": "Stored cell value" if plane.fields[name].cell else "Barycentric source point data",
        "reason": "" if np.isfinite(value) else "Outside valid fluid data / off plane / nonfinite source tuple",
    }


def slice_data(store: SliceStore, owner: str, request: SliceRequest) -> dict[str, Any]:
    if not _sampling_slots.acquire(blocking=False):
        raise HTTPException(429, "Two slice samplers are busy. Retry shortly.")
    try:
        a, ap, plane = selected(store, owner, str(request.projectId), request.baseline)
        b, bp, other = (
            selected(store, owner, str(request.projectId), request.option) if request.option else (None, None, None)
        )
        if b is not None:
            assert bp is not None
        if request.field not in plane.fields:
            raise ValueError("The selected field is no longer available on the baseline plane.")
        reasons = incompatibilities(a, ap, b, bp, request.field) if b and bp else []
        if request.deltaMode == "vector" and (request.field != "U" or plane.fields[request.field].values.shape[1] != 3):
            reasons.append("Vector difference is only defined for three-component U.")
        if b and a["runId"] == b["runId"]:
            reasons.append("Choose two different runs; self-comparison is not enabled.")
        unit = next(f["unit"] for f in ap["fields"] if f["name"] == request.field)
        output = {
            "schemaVersion": 1,
            "baseline": {"run": a["runId"], "asset": ap["id"], "time": ap["time"]},
            "option": {"run": b["runId"], "asset": bp["id"], "time": bp["time"]} if b and bp else None,
            "axis": ap["axis"],
            "coordinate": ap["coordinate"],
            "field": request.field,
            "component": request.component,
            "unit": "°C" if request.field == "T" and unit == "K" and request.temperature == "C" else unit,
            "deltaUnit": "%"
            if request.deltaMode == "percent"
            else "K"
            if request.field == "T" and unit == "K"
            else unit,
            "deltaMode": request.deltaMode,
            "epsilon": request.epsilon,
            "definition": "Option − Baseline" if request.deltaMode != "vector" else "|U_option − U_baseline|",
            "compatibility": reasons,
            "method": METHOD,
            "notes": [
                "Steady solver iterations are not physical seconds.",
                "Scenario/operating and design changes both affect delta.",
                "Geometry differs; only common valid fluid samples contribute."
                if b and a["sourceHash"] != b["sourceHash"]
                else "Pinned global physical frame.",
            ],
        }
        if request.point is not None:
            points = np.array([request.point])
            pa = probe_data(plane, points, request.field, request.component, request.temperature, unit)
            pb = (
                probe_data(other, points, request.field, request.component, request.temperature, unit)
                if other
                else None
            )
            delta = None
            if pb and not reasons and pa["value"] is not None and pb["value"] is not None:
                offset = 273.15 if request.field == "T" and unit == "K" and request.temperature == "C" else 0
                delta = difference(
                    np.array([pa["value"] + offset]),
                    np.array([pb["value"] + offset]),
                    request.deltaMode,
                    request.epsilon,
                    np.array([pa["velocity"]]) if pa["velocity"] else None,
                    np.array([pb["velocity"]]) if pb["velocity"] else None,
                )[0]
            return {
                **output,
                "point": request.point,
                "probe": {
                    "baseline": pa,
                    "option": pb,
                    "delta": float(delta) if delta is not None and np.isfinite(delta) else None,
                },
            }
        bounds = plane.bounds.copy()
        if other and bp and ap["axis"] == bp["axis"]:
            bounds = [
                min(bounds[0], other.bounds[0]),
                min(bounds[1], other.bounds[1]),
                max(bounds[2], other.bounds[2]),
                max(bounds[3], other.bounds[3]),
            ]
        points = grid_coordinates(bounds, plane.axis, plane.coordinate, request.size)
        av = plane.sample(points, request.field)
        option_points = points.copy()
        if other:
            option_points[:, other.axis] = other.coordinate
        # Nonmatching nearest planes can be viewed independently, but never
        # participate in delta arithmetic or coordinated cross-run numeric probes.
        bv = other.sample(option_points, request.field) if other and request.field in other.fields else None
        aa = scalar(av, request.component)
        bb = scalar(bv, request.component) if bv is not None else None
        delta = (
            difference(aa, bb, request.deltaMode, request.epsilon, av, bv)
            if bb is not None and not reasons
            else np.full(len(aa), np.nan)
        )
        if request.field == "T" and unit == "K" and request.temperature == "C":
            aa = aa - 273.15
            bb = bb - 273.15 if bb is not None else None
        finite = np.concatenate([aa[np.isfinite(aa)], bb[np.isfinite(bb)] if bb is not None else []])
        extent_area = (bounds[2] - bounds[0]) * (bounds[3] - bounds[1])
        # Digests already include geometry/field/time bytes; include all numerical
        # settings and immutable run metadata, never display legend preferences.
        cache_key = hashlib.sha256(
            json.dumps(
                [
                    request.model_dump(mode="json"),
                    [
                        a[k]
                        for k in (
                            "sourceHash",
                            "configurationHash",
                            "revision",
                            "frame",
                            "timeKind",
                            "pressureReference",
                        )
                    ],
                    [
                        b[k]
                        for k in (
                            "sourceHash",
                            "configurationHash",
                            "revision",
                            "frame",
                            "timeKind",
                            "pressureReference",
                        )
                    ]
                    if b
                    else None,
                    ap,
                    bp,
                    METHOD,
                ],
                sort_keys=True,
            ).encode()
        ).hexdigest()
        return {
            **output,
            "key": cache_key,
            "bounds": bounds,
            "size": request.size,
            "a": json_values(aa),
            "b": json_values(bb) if bb is not None else None,
            "delta": json_values(delta),
            "range": [float(min(finite)), float(max(finite))] if len(finite) else None,
            "statistics": statistics(delta, extent_area),
        }
    except (ValueError, OSError, KeyError) as error:
        raise HTTPException(422, str(error)[:1000]) from None
    finally:
        _sampling_slots.release()
