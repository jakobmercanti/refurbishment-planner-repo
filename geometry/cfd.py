"""Deterministic, coarse obstruction surfaces. All exported coordinates are mm.

The union of a few prisms preserves major gaps without exporting intersecting
solids or internal faces. Coplanar faces are merged before triangulation. These
are generic CFD inputs, never fit geometry or a claim about solver accuracy.
"""

import math
from functools import lru_cache
from typing import Literal

from pydantic import BaseModel, ConfigDict

from geometry.cfd_profiles import PROFILES
from geometry.cfd_surface import surface_mesh


class CfdProxySpec(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)
    version: Literal[1] = 1
    profile: Literal[
        "block",
        "table",
        "chair",
        "stool",
        "sofa",
        "sofa-left",
        "sofa-right",
        "bed",
        "basin",
        "pedestal-basin",
        "toilet",
        "toilet-low",
        "bath",
        "shower-alcove",
        "shower-corner",
        "shower-screen",
        "chair-open",
        "armchair",
        "basin-corner",
        "toilet-wall",
        "bath-oval",
        "bath-raised",
        "bath-corner",
        "shower-wet-room",
        "shower-enclosed",
        "shower-quadrant",
        "people-standing",
        "people-seated",
        "people-lying",
        "balustrade-open",
        "balustrade-rails",
        "balustrade-solid",
        "balustrade-glass",
    ]


class CfdMesh(BaseModel):
    model_config = ConfigDict(frozen=True)
    version: Literal[1] = 1
    geometry_revision: Literal[2] = 2
    units: Literal["mm"] = "mm"
    profile: str
    label: str
    dimensions_mm: tuple[float, float, float]
    vertices_mm: tuple[tuple[float, float, float], ...]
    triangles: tuple[tuple[int, int, int], ...]
    assumptions: tuple[str, ...]


@lru_cache(maxsize=512)
def build_cfd_mesh(profile: str, width_mm: float, depth_mm: float, height_mm: float) -> CfdMesh:
    if profile not in PROFILES:
        raise ValueError("Unknown CFD profile")
    dimensions = (width_mm, depth_mm, height_mm)
    if any(not math.isfinite(v) or not 0.001 <= v <= 20_000 for v in dimensions):
        raise ValueError("CFD dimensions must be finite millimetres between 0.001 and 20000")
    recipe = PROFILES[profile]
    points, triangles = surface_mesh(recipe.solids())
    vertices = tuple((x * width_mm, y * depth_mm, z * height_mm) for x, y, z in points)
    assumptions = [
        "Generic obstruction approximation, not manufacturer geometry or validated CFD results.",
        "Major airflow paths are retained; small details/cavities are omitted or sealed as noted below.",
        "Cell count depends on the mesher, gap/refinement settings and boundary layers. Check mesh independence.",
        *recipe.notes,
    ]
    return CfdMesh(
        profile=profile,
        label=recipe.label,
        dimensions_mm=dimensions,
        vertices_mm=tuple(vertices),
        triangles=tuple(triangles),
        assumptions=tuple(assumptions),
    )


def cfd_stl(mesh: CfdMesh) -> str:
    """Unitless STL with an explicit mm label; solvers must apply their own unit scale."""
    lines = ["solid catalogue_cfd_mm"]
    for triangle in mesh.triangles:
        a, b, c = [mesh.vertices_mm[i] for i in triangle]
        ab, ac = [b[i] - a[i] for i in range(3)], [c[i] - a[i] for i in range(3)]
        normal = tuple(ab[(i + 1) % 3] * ac[(i + 2) % 3] - ab[(i + 2) % 3] * ac[(i + 1) % 3] for i in range(3))
        length = math.sqrt(sum(v * v for v in normal))
        lines.append("facet normal " + " ".join(f"{v / length:.12g}" for v in normal))
        lines.append("outer loop")
        lines.extend("vertex " + " ".join(f"{v:.12g}" for v in p) for p in (a, b, c))
        lines.extend(("endloop", "endfacet"))
    return "\n".join([*lines, "endsolid catalogue_cfd_mm", ""])
