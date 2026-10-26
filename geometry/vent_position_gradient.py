"""Boundary-translation mathematics, NOT an OpenFOAM adjoint implementation.

Coordinates here are explicit SI metres at the numerical adapter boundary.
Callers must supply the *full reduced* sensitivity; a primal contour is invalid.
Convention: grad_p J = integral_boundary(A) g n_edge dl, descent = -grad_p J.
"""

import math
from collections.abc import Callable
from typing import Literal

import numpy as np
from numpy.typing import NDArray


def perimeter_gradient(
    sensitivity: Callable[[float, float], float],
    *,
    shape: Literal["rectangle", "circle"],
    centre_m: tuple[float, float],
    width_m: float,
    height_m: float,
    angle_deg: float = 0,
    order: int = 32,
) -> tuple[float, float]:
    """Whole-perimeter quadrature; circle width is diameter (height must match)."""
    if (
        shape not in ("rectangle", "circle")
        or type(order) is not int
        or not 4 <= order <= 512
        or len(centre_m) != 2
        or not all(math.isfinite(v) for v in (*centre_m, width_m, height_m, angle_deg))
        or min(width_m, height_m) <= 0
    ):
        raise ValueError("Finite positive footprint and quadrature order 4–512 required.")
    if shape == "circle" and width_m != height_m:
        raise ValueError("A circular footprint needs equal diameters.")
    c, s = math.cos(math.radians(angle_deg)), math.sin(math.radians(angle_deg))
    rotation = np.array([[c, -s], [s, c]])
    if shape == "circle":
        theta = (np.arange(order * 4) + 0.5) * (2 * math.pi / (order * 4))
        normals = np.column_stack([np.cos(theta), np.sin(theta)])
        points = normals * (width_m / 2)
        weights = np.full(len(points), math.pi * width_m / len(points))
    else:
        t, w = np.polynomial.legendre.leggauss(order)
        a, b = width_m / 2, height_m / 2
        points = np.concatenate(
            [
                np.column_stack([np.full(order, a), b * t]),
                np.column_stack([np.full(order, -a), b * t]),
                np.column_stack([a * t, np.full(order, b)]),
                np.column_stack([a * t, np.full(order, -b)]),
            ]
        )
        normals = np.repeat([[1, 0], [-1, 0], [0, 1], [0, -1]], order, axis=0)
        weights = np.concatenate([w * b, w * b, w * a, w * a])
    points = points @ rotation.T + centre_m
    normals = normals @ rotation.T
    values = np.array([sensitivity(float(u), float(v)) for u, v in points])
    if values.ndim != 1 or not np.isfinite(values).all():
        raise ValueError("Every perimeter sensitivity sample must be finite and scalar.")
    gradient = np.sum(normals * (weights * values)[:, None], axis=0)
    if not np.isfinite(gradient).all():
        raise ValueError("Perimeter gradient overflowed; rescale or repair the sensitivity input.")
    return float(gradient[0]), float(gradient[1])


def normalised_flux_derivative(
    mask: NDArray[np.float64],
    dmask: NDArray[np.float64],
    areas_m2: NDArray[np.float64],
    total_m3s: float,
) -> tuple[NDArray[np.float64], NDArray[np.float64]]:
    """Integrated face flux Q*A*m/S and full derivative incl dS.

    Algebraic building block only; it does not establish a stable pressure/velocity
    boundary law, primal conservation, no-slip, wall leakage or outlet sensitivity.
    """
    if (
        mask.ndim != 1
        or dmask.shape != (len(mask), 2)
        or areas_m2.shape != mask.shape
        or not all(np.isfinite(a).all() for a in (mask, dmask, areas_m2))
        or not math.isfinite(total_m3s)
        or total_m3s <= 0
        or np.any(areas_m2 <= 0)
        or np.any(mask < 0)
        or np.any(mask > 1)
    ):
        raise ValueError("Finite masks in [0,1], positive areas/flow and two derivatives required.")
    # Common area scaling cancels analytically; avoid squaring tiny/large areas.
    scaled_areas = areas_m2 / np.max(areas_m2)
    weighted = mask * scaled_areas
    area = float(weighted.sum())
    if not math.isfinite(area) or area <= 0:
        raise ValueError("Empty effective opening.")
    derivative = dmask * scaled_areas[:, None]
    fraction = weighted / area
    flux = total_m3s * fraction
    dflux = total_m3s * (derivative - fraction[:, None] * derivative.sum(axis=0)) / area
    if not np.isfinite(flux).all() or not np.isfinite(dflux).all():
        raise ValueError("Flux normalization overflowed; repair or rescale the input.")
    return flux, dflux
