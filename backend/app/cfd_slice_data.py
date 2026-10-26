"""Bounded, format-independent physical-plane sampling. Never samples colours.

Native POLYDATA is adapted to triangles; GEOS constrained triangulation preserves
concave fluid boundaries. STRtree locates original cells, NumPy interpolates their
point tuples. No Delaunay interpolation across a hole or outside a fluid polygon.
"""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Any, cast

import numpy as np
import shapely
from shapely import Polygon, STRtree

MAX_BYTES = 25 * 1024**2
MAX_POINTS = 250_000
AXES = "XYZ"


@dataclass
class Field:
    values: np.ndarray
    cell: bool


class Plane:
    def __init__(self, points: np.ndarray, polygons: list[list[int]], fields: dict[str, Field]):
        self.points, self.fields = points, fields
        span = np.ptp(points, axis=0)
        self.axis = int(np.argmin(span))
        if span[self.axis] > max(1e-7, float(max(span)) * 1e-7):
            raise ValueError("Not a single axis-aligned physical plane.")
        self.coordinate = float(np.mean(points[:, self.axis]))
        self.axes = [i for i in range(3) if i != self.axis]
        uv = points[:, self.axes]
        self.bounds = [*np.min(uv, axis=0).tolist(), *np.max(uv, axis=0).tolist()]
        if min(span[self.axes]) <= 1e-10:
            raise ValueError("The plane has zero or degenerate area.")
        triangles, cells = [], []
        for cell, ids in enumerate(polygons):
            if len(ids) < 3:
                continue
            polygon = Polygon(uv[ids])
            if not polygon.is_valid or polygon.area <= 1e-18:
                continue
            lookup = {tuple(uv[i]): i for i in ids}
            for tri in shapely.get_parts(shapely.constrained_delaunay_triangles(polygon)):
                triangles.append([lookup[tuple(p)] for p in list(tri.exterior.coords)[:3]])
                cells.append(cell)
            if len(triangles) > 500_000:
                raise ValueError("Plane exceeds 500,000 triangles.")
        if not triangles:
            raise ValueError("No finite, valid fluid polygons in this plane.")
        self.triangles, self.cells = np.array(triangles), np.array(cells)
        self.vertices = uv[self.triangles]
        self.tree = STRtree(shapely.polygons(self.vertices))

    def sample(self, coordinates: np.ndarray, name: str) -> np.ndarray:
        """Return NaN for holes, nonfinite source tuples and outside points."""
        field = self.fields.get(name)
        if field is None:
            raise ValueError(f"Field {name} is not available on this plane.")
        result = np.full((len(coordinates), field.values.shape[1]), np.nan)
        for start in range(0, len(coordinates), 8192):
            uv = coordinates[start : start + 8192, self.axes]
            point_ids, triangle_ids = self.tree.query(shapely.points(uv), predicate="intersects")
            if not len(point_ids):
                continue
            # Shared edges choose the lowest original triangle deterministically.
            order = np.lexsort((triangle_ids, point_ids))
            point_ids, triangle_ids = point_ids[order], triangle_ids[order]
            unique = np.r_[True, point_ids[1:] != point_ids[:-1]]
            point_ids, triangle_ids = point_ids[unique], triangle_ids[unique]
            verts = self.vertices[triangle_ids]
            a, b, q = verts[:, 1] - verts[:, 0], verts[:, 2] - verts[:, 0], uv[point_ids] - verts[:, 0]
            det = a[:, 0] * b[:, 1] - a[:, 1] * b[:, 0]
            v = (q[:, 0] * b[:, 1] - q[:, 1] * b[:, 0]) / det
            w = (a[:, 0] * q[:, 1] - a[:, 1] * q[:, 0]) / det
            if field.cell:
                values = field.values[self.cells[triangle_ids]]
            else:
                source = field.values[self.triangles[triangle_ids]]
                # Affine differences preserve a constant field exactly, avoiding
                # a bogus rainbow autoscale from round-off in sum(weights * C).
                values = (
                    source[:, 0]
                    + (source[:, 1] - source[:, 0]) * v[:, None]
                    + (source[:, 2] - source[:, 0]) * w[:, None]
                )
            on_plane = np.abs(coordinates[start + point_ids, self.axis] - self.coordinate) <= 1e-7
            valid = (
                on_plane & np.isfinite(values).all(axis=1) & (np.abs(values) <= np.finfo(np.float32).max).all(axis=1)
            )
            result[start + point_ids[valid]] = values[valid]
        return result


def read_plane(path: Path) -> Plane:
    """Strict legacy ASCII adapter for the actual pinned worker writer, incl FIELD."""
    if path.stat().st_size > MAX_BYTES:
        raise ValueError("Slice exceeds 25 MB; export a smaller plane.")
    text = path.read_text(encoding="ascii")
    lines = text.splitlines()
    if len(lines) < 4 or not lines[0].startswith("# vtk DataFile Version") or lines[2].strip() != "ASCII":
        raise ValueError("The slice is not native ASCII VTK POLYDATA.")
    tokens = " ".join(lines[3:]).split()
    cursor = 0

    def take() -> str:
        nonlocal cursor
        if cursor >= len(tokens):
            raise ValueError("Incomplete native slice; wait for a completed field write.")
        value = tokens[cursor]
        cursor += 1
        return value

    def count(limit: int = MAX_POINTS) -> int:
        value = int(take())
        if not 0 <= value <= limit:
            raise ValueError("Slice array exceeds its bounded size.")
        return value

    def numbers(n: int) -> np.ndarray:
        nonlocal cursor
        if n > 4_000_000 or cursor + n > len(tokens):
            raise ValueError("Incomplete or oversized native numeric array.")
        values = np.array(tokens[cursor : cursor + n], dtype=np.float64)
        cursor += n
        return values

    if (take(), take()) != ("DATASET", "POLYDATA"):
        raise ValueError("Only sampled POLYDATA planes are supported, not a full volume mesh.")
    points: np.ndarray | None = None
    polygons: list[list[int]] = []
    fields: dict[str, Field] = {}
    tuples, cell, cell_count, array_values = 0, False, 0, 0

    def store(name: str, n: int, components: int, keep: bool = True) -> None:
        nonlocal array_values
        array_values += n * components
        if array_values > 4_000_000 or len(fields) >= 64 or components < 1:
            raise ValueError("Too many native field values.")
        values = numbers(n * components).reshape(n, components)
        if keep:
            if n != tuples or name in fields or len(name) > 200:
                raise ValueError("Duplicate or mismatched native field.")
            fields[name] = Field(values, cell)

    while cursor < len(tokens):
        section = take()
        if section == "POINTS":
            n = count()
            take()  # numeric type; values parsed as bounded doubles
            points = numbers(n * 3).reshape(n, 3)
        elif section in ("POLYGONS", "VERTICES", "LINES", "TRIANGLE_STRIPS"):
            n, size = count(), count(2_500_000)
            before = cursor
            for _ in range(n):
                ids = [count() for _ in range(count())]
                if points is None or any(i >= len(points) for i in ids):
                    raise ValueError("Missing native geometry vertex.")
                if section != "POLYGONS":
                    raise ValueError("Export polygon-only slices for numerical 2D comparison.")
                polygons.append(ids)
            if cursor - before != size:
                raise ValueError("Invalid native polygon connectivity.")
            cell_count += n
        elif section in ("POINT_DATA", "CELL_DATA"):
            tuples, cell = count(), section == "CELL_DATA"
            if points is None or tuples != (cell_count if cell else len(points)):
                raise ValueError("Native field tuple count differs from geometry.")
        elif section == "FIELD":
            take()
            for _ in range(count(64)):
                name, components, n = take(), count(9), count()
                take()
                store(name, n, components, bool(tuples))
        elif section in ("SCALARS", "VECTORS"):
            name = take()
            take()
            components = count(9) if section == "SCALARS" else 3
            if section == "SCALARS" and (take(), take()) != ("LOOKUP_TABLE", "default"):
                raise ValueError("Unsupported native scalar lookup table.")
            store(name, tuples, components)
        else:
            raise ValueError(f"Unsupported native section {section[:50]}.")
    if points is None or not len(points) or not np.isfinite(points).all():
        raise ValueError("Native slice needs finite physical coordinates.")
    return Plane(points, polygons, fields)


def scalar(values: np.ndarray, component: int) -> np.ndarray:
    if component == -1:
        return np.linalg.norm(values, axis=1) if values.shape[1] > 1 else values[:, 0]
    if component < 0 or component >= values.shape[1]:
        raise ValueError("This field has no selected vector component.")
    return values[:, component]


def difference(
    a: np.ndarray, b: np.ndarray, mode: str, epsilon: float, av: np.ndarray | None = None, bv: np.ndarray | None = None
) -> np.ndarray:
    if mode == "vector":
        if av is None or bv is None or av.shape[1] != 3 or bv.shape[1] != 3:
            raise ValueError("Vector difference requires actual three-component velocities in both runs.")
        return np.asarray(np.linalg.norm(bv - av, axis=1))
    delta = b - a
    if mode == "percent":
        valid = np.abs(a) > epsilon
        return np.asarray(np.divide(delta * 100, np.abs(a), out=np.full_like(a, np.nan), where=valid))
    return np.asarray(delta)


def json_values(values: np.ndarray) -> list[Any]:
    output = values.astype(object)
    output[~np.isfinite(values)] = None
    return cast(list[Any], output.tolist())


def grid_coordinates(bounds: list[float], axis: int, coordinate: float, size: int) -> np.ndarray:
    """Uniform area-centred samples. Equal areas justify mean/RMS weights."""
    low, high = np.array(bounds[:2]), np.array(bounds[2:])
    uv = [np.linspace(low[i], high[i], size, endpoint=False) + (high[i] - low[i]) / (2 * size) for i in range(2)]
    x, y = np.meshgrid(*uv)
    points = np.full((size * size, 3), coordinate, dtype=np.float64)
    points[:, [i for i in range(3) if i != axis]] = np.stack([x.ravel(), y.ravel()], axis=1)
    return points


def statistics(delta: np.ndarray, area: float) -> dict[str, Any]:
    finite = delta[np.isfinite(delta)]
    return {
        "valid": len(finite),
        "missing": len(delta) - len(finite),
        "coverage": len(finite) / len(delta),
        "min": float(min(finite)) if len(finite) else None,
        "max": float(max(finite)) if len(finite) else None,
        "mean": float(np.mean(finite)) if len(finite) else None,
        "rms": float(np.sqrt(np.mean(finite**2))) if len(finite) else None,
        "commonAreaM2": area * len(finite) / len(delta),
        "method": "Uniform area-centred grid; no extrapolation",
    }
