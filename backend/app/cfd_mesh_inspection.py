"""Read-only inspection of the final, checked OpenFOAM polyMesh.

Native coordinates are metres. The adapter normalizes to millimetres before
topology operations. Rendering buffers contain original face edges and actual
volume-cell sections, independently of sampled CFD result planes.
"""

from __future__ import annotations

import hashlib
import io
import json
import re
import sqlite3
import struct
import threading
import time
import warnings
from collections import OrderedDict
from collections.abc import Callable
from functools import lru_cache
from pathlib import Path
from typing import Any
from uuid import UUID

import anyio
import numpy as np
import shapely
from fastapi import HTTPException
from pydantic import BaseModel, ConfigDict, Field
from shapely import LineString, Polygon
from starlette.requests import Request

FILES = ("points", "faces", "owner", "neighbour", "boundary")
MAX_SOURCE = 192 * 1024**2
MAX_BUFFER = 48 * 1024**2
MAX_CELLS = 500_000
_slots = threading.BoundedSemaphore(2)
_load_lock = threading.Lock()
_buffer_lock = threading.Lock()
_buffers: OrderedDict[tuple, bytes] = OrderedDict()


def check_cancelled(cancelled: Callable[[], bool]) -> None:
    if cancelled():
        raise HTTPException(499, "Mesh inspection request cancelled.")


class MeshSectionRequest(BaseModel):
    model_config = ConfigDict(extra="forbid", allow_inf_nan=False)
    projectId: UUID
    jobId: UUID
    meshId: str = Field(pattern=r"^[a-f0-9]{64}$")
    axis: str = Field(pattern=r"^[XYZ]$")
    coordinateMm: float = Field(ge=-1e9, le=1e9)


def mesh_files(root: Path) -> list[Path]:
    paths = [root / "constant" / "polyMesh" / name for name in FILES]
    resolved = root.resolve()
    if any(not path.is_file() or path.is_symlink() or not path.resolve().is_relative_to(resolved) for path in paths):
        raise ValueError("The final volume mesh is missing or unsafe. Retain the native case and mesh again.")
    if sum(path.stat().st_size for path in paths) > MAX_SOURCE:
        raise ValueError("This mesh exceeds the 192 MB inspection source limit.")
    return paths


def mesh_revision(root: Path) -> str:
    digest = hashlib.sha256()
    for path in mesh_files(root):
        digest.update(path.name.encode())
        with path.open("rb") as stream:
            while block := stream.read(1024 * 1024):
                digest.update(block)
    return digest.hexdigest()


def retain_mesh(root: Path, manifest: dict[str, Any]) -> None:
    """Publish readiness only after checkMesh passes, including before solving."""
    proof = {key: manifest[key] for key in ("studyId", "clientRevision", "sourceHash", "configurationHash", "mesh")}
    proof.update(schemaVersion=1, meshId=mesh_revision(root), units="mm")
    temporary = root / "mesh-inspection.tmp"
    temporary.write_text(json.dumps(proof), encoding="utf-8")
    temporary.replace(root / "mesh-inspection.json")


def list_body(path: Path) -> tuple[int, str]:
    text = path.read_text(encoding="ascii")
    if not re.search(r"\bformat\s+ascii\s*;", text):
        raise ValueError("Mesh inspection supports native ASCII polyMesh files. Binary meshes need ASCII conversion.")
    text = re.sub(r"/\*.*?\*/|//[^\n]*", "", text, flags=re.S)
    header = re.search(r"\bFoamFile\s*\{[^{}]*\}", text)
    if not header:
        raise ValueError("Invalid OpenFOAM mesh header.")
    body = text[header.end():].strip()
    match = re.fullmatch(r"(\d+)\s*\((.*)\)\s*;?\s*", body, re.S)
    if not match:
        raise ValueError("Invalid OpenFOAM mesh list.")
    return int(match[1]), match[2]


def integer_values(text: str) -> np.ndarray:
    if re.search(r"[^\d\s]", text):
        raise ValueError("Invalid mesh addressing.")
    result = np.fromstring(text.strip(), dtype=np.int64, sep=" ") if text.strip() else np.empty(0, dtype=np.int64)
    if np.any(result < 0):
        raise ValueError("Mesh addressing must be nonnegative.")
    return result


def section_polygons(segments: list, tolerance: float) -> list[Polygon]:
    """Walk ordinary closed cut loops directly; node difficult coincidences in GEOS."""
    graph: dict[tuple, set] = {}
    points = {}
    for a, b in segments:
        keys = [(round(point[0] / tolerance), round(point[1] / tolerance)) for point in (a, b)]
        first, second = keys
        if first == second:
            continue
        points[first], points[second] = a, b
        graph.setdefault(first, set()).add(second)
        graph.setdefault(second, set()).add(first)
    if graph and all(len(neighbours) == 2 for neighbours in graph.values()):
        remaining = set(graph)
        rings = []
        while remaining:
            start = min(remaining)
            loop, previous, current = [], None, start
            while current in remaining:
                remaining.remove(current)
                loop.append(points[current])
                following = sorted(graph[current] - {previous})[0]
                previous, current = current, following
            if current != start or len(loop) < 3:
                break
            rings.append(Polygon(loop))
        else:
            if rings and all(ring.is_valid and ring.area > tolerance**2 for ring in rings):
                if len(rings) == 1:
                    return rings
                depths = [sum(other.contains(ring) for other in rings if other is not ring)
                          for ring in rings]
                return [Polygon(ring.exterior, [hole.exterior for hole, level in zip(rings, depths, strict=True)
                                                if level == depth + 1 and ring.contains(hole)])
                        for ring, depth in zip(rings, depths, strict=True) if depth % 2 == 0]
    lines = shapely.union_all([LineString(segment) for segment in segments], grid_size=tolerance)
    polygons = list(shapely.get_parts(shapely.polygonize(list(shapely.get_parts(lines)))))
    rings = [Polygon(polygon.exterior) for polygon in polygons]
    selected = [polygon for polygon in polygons
                if sum(ring.covers(polygon.representative_point()) for ring in rings) % 2]
    return list(shapely.get_parts(shapely.union_all(selected))) if selected else []


class VolumeMesh:
    def __init__(self, root: Path):
        mesh_files(root)
        base = root / "constant" / "polyMesh"
        count, text = list_body(base / "points")
        if not 4 <= count <= 2_000_000 or re.search(r"[^\d\s.eE+()\-]", text):
            raise ValueError("Invalid or oversized mesh point list.")
        with warnings.catch_warnings():
            warnings.simplefilter("error", DeprecationWarning)
            try:
                points = np.fromstring(text.replace("(", " ").replace(")", " "), dtype=np.float64, sep=" ")
            except DeprecationWarning:
                raise ValueError("Invalid mesh point coordinates.") from None
        if points.size != count * 3 or not np.isfinite(points).all():
            raise ValueError("Mesh points are incomplete or non-finite.")
        self.points = points.reshape((-1, 3)) * 1000
        if np.max(np.abs(self.points)) > 1e9:
            raise ValueError("Mesh coordinates exceed the supported millimetre domain.")
        self.bounds = np.array([self.points.min(axis=0), self.points.max(axis=0)])
        if np.any(self.bounds[1] <= self.bounds[0]):
            raise ValueError("The volume mesh has degenerate bounds.")
        self.tolerance = max(1e-9, float(np.max(self.bounds[1] - self.bounds[0])) * 1e-12)

        face_count, text = list_body(base / "faces")
        if not 4 <= face_count <= 4_000_000:
            raise ValueError("Invalid mesh face count.")
        values = integer_values(text.replace("(", " ").replace(")", " "))
        headers = np.empty(face_count, dtype=np.int64)
        self.offsets = np.zeros(face_count + 1, dtype=np.int64)
        cursor = 0
        for index in range(face_count):
            if cursor >= len(values):
                raise ValueError("Truncated mesh face list.")
            size = int(values[cursor])
            if not 3 <= size <= 1024 or cursor + size >= len(values):
                raise ValueError("Invalid or unsupported mesh face topology.")
            headers[index] = cursor
            self.offsets[index + 1] = self.offsets[index] + size
            cursor += size + 1
        if cursor != len(values):
            raise ValueError("Unexpected trailing face addressing.")
        keep = np.ones(len(values), dtype=bool)
        keep[headers] = False
        indices = values[keep]
        if np.any(indices >= len(self.points)):
            raise ValueError("Mesh face refers to an unavailable point.")
        self.indices = indices.astype(np.int32)
        self.owner = self.addressing(base / "owner", face_count)
        internal_count, _ = list_body(base / "neighbour")
        if internal_count > face_count:
            raise ValueError("Mesh internal-face count exceeds its face count.")
        self.neighbour = self.addressing(base / "neighbour", internal_count)
        self.cells = int(max(np.max(self.owner), np.max(self.neighbour, initial=0))) + 1
        if not 1 <= self.cells <= MAX_CELLS or np.any(self.owner[:internal_count] == self.neighbour):
            raise ValueError("Invalid mesh cell addressing or cell-count limit.")
        used = np.unique(np.concatenate((self.owner, self.neighbour)))
        if len(used) != self.cells:
            raise ValueError("Mesh cell addressing has gaps.")
        incidence = np.bincount(np.concatenate((self.owner, self.neighbour)), minlength=self.cells)
        if np.any(incidence < 4):
            raise ValueError("A volume cell has fewer than four faces.")
        # A vectorized face interval index avoids walking every cell on each drag.
        vertices = self.points[self.indices]
        self.face_min = np.minimum.reduceat(vertices, self.offsets[:-1])
        self.face_max = np.maximum.reduceat(vertices, self.offsets[:-1])
        # Cache convex face classification once. Their source-vertex triangles
        # can then be intersected in a batch, independently of cell type.
        sizes = np.diff(self.offsets)
        self.convex_faces = sizes == 3
        quads = np.flatnonzero(sizes == 4)
        for start in range(0, len(quads), 50_000):
            selected = quads[start:start + 50_000]
            corners = self.points[self.indices[self.offsets[selected, None] + np.arange(4)]]
            edges = np.roll(corners, -1, axis=1) - corners
            crosses = np.cross(edges, np.roll(edges, -1, axis=1))
            normal = crosses.sum(axis=1)
            lengths = np.linalg.norm(normal, axis=1)
            convex = np.all(np.einsum('ijk,ik->ij', crosses, normal) > self.tolerance**4, axis=1)
            self.convex_faces[selected] = convex & (lengths > self.tolerance**2)
        patch_count, text = list_body(base / "boundary")
        self.patches = []
        expected_start = internal_count
        for name, body in re.findall(r"([\w.-]+)\s*\{([^{}]*)\}", text):
            size = re.search(r"\bnFaces\s+(\d+)\s*;", body)
            start = re.search(r"\bstartFace\s+(\d+)\s*;", body)
            if not size or not start or int(start[1]) != expected_start:
                raise ValueError("Boundary patches do not cover the mesh faces in order.")
            expected_start += int(size[1])
            self.patches.append({"name": name, "faces": int(size[1]), "startFace": int(start[1])})
        if len(self.patches) != patch_count or expected_start != face_count:
            raise ValueError("Boundary patch addressing is incomplete.")
        self.internal_count = internal_count

    @staticmethod
    def addressing(path: Path, expected: int) -> np.ndarray:
        count, text = list_body(path)
        values = integer_values(text)
        if count != expected or len(values) != count or np.max(values, initial=0) >= MAX_CELLS:
            raise ValueError("Invalid mesh face-to-cell addressing.")
        return values.astype(np.int32)

    def face(self, index: int) -> np.ndarray:
        return self.indices[self.offsets[index]:self.offsets[index + 1]]

    def face_triangles(self, index: int) -> list[list[int]]:
        ids = self.face(index)
        if len(ids) == 4 and self.convex_faces[index]:
            return [[int(ids[0]), int(ids[1]), int(ids[2])], [int(ids[0]), int(ids[2]), int(ids[3])]]
        return self.triangles(ids)

    def triangles(self, ids: np.ndarray) -> list[list[int]]:
        if len(set(ids.tolist())) != len(ids):
            raise ValueError("Mesh face contains repeated point indices.")
        points = self.points[ids]
        normal = np.sum(np.cross(points - points[0], np.roll(points, -1, axis=0) - points[0]), axis=0)
        if np.linalg.norm(normal) <= self.tolerance**2:
            raise ValueError("Mesh contains a degenerate face.")
        if len(ids) == 3:
            return [ids.tolist()]
        axis = int(np.argmax(np.abs(normal)))
        uv = np.delete(points - points[0], axis, axis=1)
        polygon = Polygon(uv)
        if not polygon.is_valid or polygon.area <= self.tolerance**2:
            raise ValueError("Mesh contains a self-intersecting or degenerate face.")
        lookup = {tuple(point): int(index) for point, index in zip(uv, ids, strict=True)}
        return [[lookup[tuple(point)] for point in list(triangle.exterior.coords)[:3]]
                for triangle in shapely.get_parts(shapely.constrained_delaunay_triangles(polygon))]

    def surface(self, cancelled: Callable[[], bool] = lambda: False) -> tuple[np.ndarray, np.ndarray, np.ndarray, int]:
        triangles, edges = [], set()
        for index in range(self.internal_count, len(self.owner)):
            if index % 64 == 0:
                check_cancelled(cancelled)
            ids = self.face(index)
            triangles.extend(self.face_triangles(index))
            edges.update(tuple(sorted((int(a), int(b)))) for a, b in zip(ids, np.roll(ids, -1), strict=True))
            if len(triangles) > 1_000_000 or len(edges) > 2_000_000:
                raise ValueError("Boundary display exceeds its detailed rendering limit. Use a volume section.")
        return compact_geometry(self.points, triangles, sorted(edges), 0)

    def face_sections(self, candidates: np.ndarray, axis: int, coordinate: float) -> dict:
        """Vectorized cuts of convex source faces; GEOS handles concave faces."""
        output: dict[int, list] = {}
        common = candidates[self.convex_faces[candidates]]
        sizes = np.diff(self.offsets)[common]
        rows = np.concatenate((common, common[sizes == 4]))
        corners = np.concatenate((self.offsets[common, None] + [0, 1, 2],
                                  self.offsets[common[sizes == 4], None] + [0, 2, 3]))
        vertices = self.points[self.indices[corners]]
        distances = vertices[:, :, axis] - coordinate
        following = np.roll(vertices, -1, axis=1)
        next_distance = np.roll(distances, -1, axis=1)
        near = np.abs(distances) <= self.tolerance
        crossing = (distances * next_distance < 0) & ~near & (np.abs(next_distance) > self.tolerance)
        triangle_ids, _ = np.nonzero(near)
        cut_ids, _ = np.nonzero(crossing)
        weights = -distances[crossing] / (next_distance[crossing] - distances[crossing])
        cuts = vertices[crossing] + (following[crossing] - vertices[crossing]) * weights[:, None]
        groups: dict[int, list] = {}
        axes = [value for value in range(3) if value != axis]
        for triangle, point in zip(np.concatenate((triangle_ids, cut_ids)),
                                   np.concatenate((vertices[near], cuts))[:, axes], strict=True):
            groups.setdefault(int(triangle), []).append(tuple(point))
        coplanar: set[int] = set()
        # A completely coplanar face contributes its original perimeter once.
        for face_id in candidates:
            if max(abs(self.face_min[face_id, axis] - coordinate),
                   abs(self.face_max[face_id, axis] - coordinate)) <= self.tolerance:
                points = self.points[self.face(int(face_id))][:, axes]
                output[int(face_id)] = [(tuple(a), tuple(b))
                                        for a, b in zip(points, np.roll(points, -1, axis=0), strict=True)]
                coplanar.add(int(face_id))
        for triangle, points in groups.items():
            face_id = int(rows[triangle])
            if face_id in coplanar:
                continue
            values = sorted(set(points))
            if near[triangle].all():
                output.setdefault(face_id, []).extend(zip(values, values[1:] + values[:1], strict=True))
                continue
            if len(values) >= 2 and values[0] != values[-1]:
                output.setdefault(face_id, []).append((values[0], values[-1]))
        return output

    def section(self, axis: int, coordinate: float,
                cancelled: Callable[[], bool] = lambda: False) -> tuple[np.ndarray, np.ndarray, np.ndarray, int]:
        check_cancelled(cancelled)
        tolerance = self.tolerance
        if coordinate < self.bounds[0, axis] - tolerance or coordinate > self.bounds[1, axis] + tolerance:
            return compact_geometry(self.points, [], [], 0)
        axes = [index for index in range(3) if index != axis]
        candidates = np.flatnonzero((self.face_min[:, axis] <= coordinate + tolerance)
                                   & (self.face_max[:, axis] >= coordinate - tolerance))
        face_segments = self.face_sections(candidates, axis, coordinate)
        cells: dict[int, list[tuple[tuple[float, float], tuple[float, float]]]] = {}
        for face_id in candidates:
            if face_id % 32 == 0:
                check_cancelled(cancelled)
            ids = self.face(int(face_id))
            points = self.points[ids]
            segments = []
            if int(face_id) in face_segments:
                segments = face_segments[int(face_id)]
            elif self.convex_faces[face_id]:
                continue
            elif np.max(np.abs(points[:, axis] - coordinate)) <= tolerance:
                segments = [(tuple(a[axes]), tuple(b[axes]))
                            for a, b in zip(points, np.roll(points, -1, axis=0), strict=True)]
            else:
                # Triangulate actual face vertices, including concave/warped faces.
                # Per-cell polygon union below removes tessellation diagonals.
                for triangle in self.triangles(ids):
                    vertices = self.points[triangle]
                    intersections = {}
                    for a, b in zip(vertices, np.roll(vertices, -1, axis=0), strict=True):
                        da, db = a[axis] - coordinate, b[axis] - coordinate
                        if abs(da) <= tolerance:
                            point = a[axes]
                            intersections[tuple(np.rint(point / tolerance).astype(np.int64))] = tuple(point)
                        if da * db < 0 and abs(da) > tolerance and abs(db) > tolerance:
                            point = (a + (b - a) * (-da / (db - da)))[axes]
                            intersections[tuple(np.rint(point / tolerance).astype(np.int64))] = tuple(point)
                    values = list(intersections.values())
                    if len(values) == 2 and values[0] != values[1]:
                        segments.append((values[0], values[1]))
            if not segments:
                continue
            cells.setdefault(int(self.owner[face_id]), []).extend(segments)
            if face_id < self.internal_count:
                cells.setdefault(int(self.neighbour[face_id]), []).extend(segments)

        positions, triangles, edges = [], [], set()
        point_ids, seen_polygons = {}, set()
        selected_cells = 0
        for cell_id in sorted(cells):
            if cell_id % 32 == 0:
                check_cancelled(cancelled)
            segments = cells[cell_id]
            cell_polygons = section_polygons(segments, tolerance)
            contributed = False
            for polygon in cell_polygons:
                if polygon.area <= tolerance**2:
                    continue
                canonical = shapely.normalize(polygon).wkb
                if canonical in seen_polygons:
                    continue  # A coincident internal face belongs to one section cell.
                seen_polygons.add(canonical)
                contributed = True

                def point_id(uv: tuple[float, float]) -> int:
                    point_key = tuple(np.rint(np.array(uv) / tolerance).astype(np.int64))
                    if point_key not in point_ids:
                        point_ids[point_key] = len(positions)
                        point = [0.0, 0.0, 0.0]
                        point[axis] = coordinate
                        point[axes[0]], point[axes[1]] = uv
                        positions.append(point)
                    return point_ids[point_key]

                for ring in [polygon.exterior, *polygon.interiors]:
                    ids = [point_id(tuple(uv)) for uv in list(ring.coords)[:-1]]
                    edges.update(tuple(sorted((a, b))) for a, b in zip(ids, ids[1:] + ids[:1], strict=True))
                for triangle in shapely.get_parts(shapely.constrained_delaunay_triangles(polygon)):
                    triangles.append([point_id(tuple(uv)) for uv in list(triangle.exterior.coords)[:3]])
            selected_cells += int(contributed)
            if len(triangles) > 1_000_000 or len(positions) > 1_000_000:
                raise ValueError("This detailed section exceeds its rendering limit.")
        return compact_geometry(np.array(positions).reshape((-1, 3)), triangles, sorted(edges), selected_cells)


def compact_geometry(points: np.ndarray, triangles: list, edges: list,
                     cells: int) -> tuple[np.ndarray, np.ndarray, np.ndarray, int]:
    faces = np.asarray(triangles, dtype=np.uint32).reshape((-1, 3))
    lines = np.asarray(edges, dtype=np.uint32).reshape((-1, 2))
    used = np.unique(np.concatenate((faces.reshape(-1), lines.reshape(-1))))
    if not len(used):
        return np.empty((0, 3)), faces, lines, cells
    mapping = np.zeros(int(np.max(used)) + 1, dtype=np.uint32)
    mapping[used] = np.arange(len(used), dtype=np.uint32)
    return points[used], mapping[faces], mapping[lines], cells


def geometry_bytes(mesh_id: str, geometry: tuple, *, axis: str | None = None, coordinate: float | None = None) -> bytes:
    points, triangles, edges, cells = geometry
    header = json.dumps({"schemaVersion": 1, "meshId": mesh_id, "units": "mm", "points": len(points),
                         "triangles": len(triangles), "edges": len(edges), "sectionCells": cells,
                         "axis": axis, "coordinateMm": coordinate}, separators=(",", ":")).encode()
    header += b" " * (-len(header) % 8)
    expected = 8 + len(header) + points.size * 8 + (triangles.size + edges.size) * 4
    if expected > MAX_BUFFER:
        raise ValueError("Detailed mesh view exceeds its 48 MB rendering-buffer limit.")
    output = io.BytesIO()
    output.write(b"CMI1" + struct.pack("<I", len(header)) + header)
    for data, dtype in ((points, "<f8"), (triangles, "<u4"), (edges, "<u4")):
        output.write(np.asarray(data, dtype=dtype).tobytes())
    return output.getvalue()


@lru_cache(maxsize=1)
def loaded_mesh(root: str, mesh_id: str, stamps: tuple) -> VolumeMesh:
    if mesh_revision(Path(root)) != mesh_id:
        raise ValueError("Retained mesh integrity changed. Reload its inspection metadata.")
    return VolumeMesh(Path(root))


def source_metadata(root: Path, row: sqlite3.Row) -> tuple[dict, VolumeMesh]:
    if row["expires"] <= time.time():
        raise HTTPException(410, "This mesh expired. Generate a new mesh or restore retained worker files.")
    payload = json.loads(row["payload"])
    proof_path = root / "mesh-inspection.json"
    legacy_path = root / "result.json"
    path = proof_path if proof_path.is_file() else legacy_path
    if not path.is_file() or path.is_symlink() or path.stat().st_size > 1024**2:
        raise HTTPException(409, "A checked volume mesh is not available yet.")
    proof = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(proof.get("mesh"), dict) or any(proof.get(key) != payload.get(key)
        for key in ("studyId", "clientRevision", "sourceHash", "configurationHash")):
        raise ValueError("The retained mesh does not match this simulation revision.")
    paths = mesh_files(root)
    mesh_id = proof.get("meshId") or mesh_revision(root)
    stamps = tuple((path.stat().st_size, path.stat().st_mtime_ns) for path in paths)
    with _load_lock:
        mesh = loaded_mesh(str(root), mesh_id, stamps)
    if proof["mesh"].get("cells") != mesh.cells:
        raise ValueError("Native mesh cell count differs from its checked result.")
    return {"schemaVersion": 1, "meshId": mesh_id, "jobId": row["id"], "projectId": row["project"],
            "studyId": row["study"], "clientRevision": row["revision"], "units": "mm", "cells": mesh.cells,
            "faces": len(mesh.owner), "points": len(mesh.points), "boundsMm": mesh.bounds.tolist(),
            "patches": mesh.patches, "regions": ["defaultRegion"], "expiresAt": row["expires"],
            "representation": "Final polyMesh boundary faces and volume-cell intersections"}, mesh


def inspection(store: Any, owner: str, job_id: str, project_id: str, *, mesh_id: str | None = None,
               axis: str | None = None, coordinate: float | None = None, metadata_only: bool = False,
               cancelled: Callable[[], bool] = lambda: False) -> dict | bytes:
    row = store.get(owner, job_id)
    if row["project"] != project_id:
        raise HTTPException(404, "Mesh not found in this project.")
    if not _slots.acquire(blocking=False):
        raise HTTPException(429, "Mesh inspection is busy. Retry the current view.")
    try:
        check_cancelled(cancelled)
        metadata, mesh = source_metadata(store.path(job_id), row)
        if mesh_id and metadata["meshId"] != mesh_id:
            raise HTTPException(409, "The mesh revision changed. Reload its metadata.")
        if metadata_only:
            return metadata
        key = (metadata["meshId"], axis, coordinate)
        with _buffer_lock:
            if key in _buffers:
                _buffers.move_to_end(key)
                return _buffers[key]
        check_cancelled(cancelled)
        geometry = (mesh.surface(cancelled) if axis is None
                    else mesh.section("XYZ".index(axis), float(coordinate), cancelled))
        check_cancelled(cancelled)
        data = geometry_bytes(metadata["meshId"], geometry, axis=axis, coordinate=coordinate)
        with _buffer_lock:
            _buffers[key] = data
            while len(_buffers) > 12 or sum(map(len, _buffers.values())) > 64 * 1024**2:
                _buffers.popitem(last=False)
        return data
    except (ValueError, OSError, KeyError, UnicodeError) as error:
        raise HTTPException(422, "Cannot inspect this volume mesh: " + str(error)[:400]) from None
    finally:
        _slots.release()


async def inspection_response(request: Request, compute: Callable[[Callable[[], bool]], dict | bytes]) -> bytes:
    """Stop CPU work promptly when a debounced browser request is abandoned."""
    stop = threading.Event()
    result: dict[str, Any] = {}
    async with anyio.create_task_group() as group:
        async def work() -> None:
            try:
                result["data"] = await anyio.to_thread.run_sync(lambda: compute(stop.is_set), abandon_on_cancel=True)
            except Exception as error:
                result["error"] = error
            finally:
                group.cancel_scope.cancel()

        group.start_soon(work)
        try:
            while True:
                await anyio.sleep(.05)
                if await request.is_disconnected():
                    group.cancel_scope.cancel()
                    break
        finally:
            stop.set()
    if "error" in result:
        raise result["error"]
    if "data" not in result:
        raise HTTPException(499, "Mesh inspection request cancelled.")
    return result["data"]
