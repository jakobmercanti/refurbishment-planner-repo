"""Deterministic mesh-level and sampling intent, in the source millimetre frame."""

import math
from typing import Any

from geometry.climoptix_models import MeshRecipe, PostProcessing, Refinement


def refinement_level(mesh: MeshRecipe, region: Refinement) -> int:
    """snappyHexMesh halves each axis per level; legacy cell-size regions round finer."""
    if region.level is not None:
        return region.level
    # Subtract logs: the ratio can overflow even though both inputs are finite.
    return max(0, math.ceil(math.log2(mesh.baseCellMm) - math.log2(region.cellMm) - 1e-12))


def refinement_cell_mm(mesh: MeshRecipe, region: Refinement) -> float:
    """Nominal snappy cell intent, including quantisation of legacy cell targets."""
    return math.ldexp(mesh.baseCellMm, -refinement_level(mesh, region))


def sampling_planes(bounds: list[list[float]], settings: PostProcessing) -> list[dict[str, Any]]:
    planes = []
    for i, axis in enumerate(("x", "y", "z")):
        stack = getattr(settings, axis)
        if not stack.enabled:
            continue
        for index in range(stack.count):
            point = [(low + high) / 2 for low, high in zip(*bounds, strict=True)]
            point[i] = bounds[0][i] + (bounds[1][i] - bounds[0][i]) * (index + 1) / (stack.count + 1)
            planes.append(
                {
                    "id": f"slice_{axis}_{index + 1:03}",
                    "axis": axis.upper(),
                    "pointMm": point,
                    "normal": [int(j == i) for j in range(3)],
                }
            )
    return planes
