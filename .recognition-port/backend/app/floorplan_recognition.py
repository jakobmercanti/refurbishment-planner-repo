"""Local raster floor-plan recognition for the project-floorplan importer."""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

import cv2
import fitz
import numpy as np


@dataclass(frozen=True)
class DetectedRoom:
    identifier: str
    name: str
    vertices: list[dict[str, float]]
    area_px2: float
    confidence: float


def _decode_document(data: bytes, filename: str) -> np.ndarray:
    suffix = Path(filename).suffix.lower()
    if suffix == ".pdf":
        document = fitz.open(stream=data, filetype="pdf")
        if not document.page_count:
            raise ValueError("The PDF contains no pages.")
        page = document.load_page(0)
        pixmap = page.get_pixmap(matrix=fitz.Matrix(2, 2), alpha=False)
        image = np.frombuffer(pixmap.samples, dtype=np.uint8).reshape(pixmap.height, pixmap.width, pixmap.n)
        return cv2.cvtColor(image, cv2.COLOR_RGB2BGR)
    image = cv2.imdecode(np.frombuffer(data, dtype=np.uint8), cv2.IMREAD_COLOR)
    if image is None:
        raise ValueError("This image could not be read. Use a PDF, JPG, PNG, or WEBP floorplan.")
    return image


def _polygon_area(vertices: list[dict[str, float]]) -> float:
    return sum(
        first["x"] * second["y"] - second["x"] * first["y"]
        for first, second in zip(vertices, [*vertices[1:], vertices[0]], strict=True)
    ) / 2


def _clean_contour_vertices(points: np.ndarray) -> np.ndarray:
    """Remove narrow return loops made by door arcs, labels, and line repairs."""
    cleaned = [point.astype(float) for point in points]
    if len(cleaned) < 3:
        return points

    changed = True
    while changed and len(cleaned) >= 3:
        changed = False
        for index in range(len(cleaned)):
            previous = cleaned[index - 1]
            current = cleaned[index]
            following = cleaned[(index + 1) % len(cleaned)]
            previous_leg = float(np.linalg.norm(current - previous))
            next_leg = float(np.linalg.norm(following - current))
            shortcut = float(np.linalg.norm(following - previous))
            # A long out-and-back excursion with endpoints only a few pixels apart
            # is never a usable architectural corner.
            if min(previous_leg, next_leg) >= 12 and shortcut <= min(previous_leg, next_leg) * 0.3:
                cleaned.pop(index)
                changed = True
                break
            if shortcut > 0:
                projection = float(np.dot(current - previous, following - previous) / (shortcut * shortcut))
                direction = following - previous
                offset = current - previous
                distance_from_line = abs(float(direction[0] * offset[1] - direction[1] * offset[0])) / shortcut
                if 0.05 < projection < 0.95 and distance_from_line <= 2.5:
                    cleaned.pop(index)
                    changed = True
                    break

    return np.asarray(cleaned, dtype=np.float32)


def _to_plan_vertices(contour: np.ndarray, image_height: int) -> list[dict[str, float]]:
    perimeter = cv2.arcLength(contour, True)
    approximate = cv2.approxPolyDP(contour, max(3.0, perimeter * 0.012), True).reshape(-1, 2)
    approximate = _clean_contour_vertices(approximate)
    vertices = [{"x": float(x), "y": float(image_height - y)} for x, y in approximate]
    if len(vertices) < 3:
        return []
    if _polygon_area(vertices) < 0:
        vertices.reverse()
    return vertices


def _has_structural_boundary(component: np.ndarray, thick_core: np.ndarray) -> bool:
    """Reject spaces enclosed mainly by dimensions or aggressive gap repairs.

    Door gaps are allowed, but most of a candidate room boundary must still sit
    beside the original thick wall cores. This prevents a site boundary, garden,
    or annotation frame from becoming a selectable room.
    """
    boundary = cv2.morphologyEx(component, cv2.MORPH_GRADIENT, np.ones((3, 3), np.uint8))
    boundary_pixels = np.count_nonzero(boundary)
    if not boundary_pixels:
        return False
    nearest_core = cv2.distanceTransform(cv2.bitwise_not(thick_core), cv2.DIST_L2, 5)
    supported = np.count_nonzero((boundary > 0) & (nearest_core <= 10))
    return supported / boundary_pixels >= 0.58


def _structural_wall_mask(grayscale: np.ndarray, gap_closure: float) -> np.ndarray:
    """Extract thick architectural walls and bridge conventional door gaps.

    Text, dimensions and door-swing arcs are normally one or two pixels wide;
    wall cores are materially thicker. A distance transform separates those
    classes before directional closing reconnects walls interrupted by doors.
    """
    height, width = grayscale.shape
    ink = cv2.threshold(grayscale, 175, 255, cv2.THRESH_BINARY_INV)[1]
    distance = cv2.distanceTransform(ink, cv2.DIST_L2, 5)
    thick_core = np.where(distance >= max(1.8, min(width, height) * 0.0035), 255, 0).astype(np.uint8)
    reconstructed = cv2.dilate(thick_core, np.ones((7, 7), np.uint8), iterations=1)

    minimum_run = max(12, round(min(width, height) * 0.025))
    horizontal = cv2.morphologyEx(reconstructed, cv2.MORPH_OPEN, np.ones((3, minimum_run), np.uint8))
    vertical = cv2.morphologyEx(reconstructed, cv2.MORPH_OPEN, np.ones((minimum_run, 3), np.uint8))
    structural = cv2.bitwise_or(horizontal, vertical)
    structural = cv2.bitwise_or(structural, reconstructed)

    horizontal_gap = max(14, round(width * gap_closure))
    vertical_gap = max(14, round(height * gap_closure))
    horizontal_closed = cv2.morphologyEx(structural, cv2.MORPH_CLOSE, np.ones((3, horizontal_gap), np.uint8))
    vertical_closed = cv2.morphologyEx(structural, cv2.MORPH_CLOSE, np.ones((vertical_gap, 3), np.uint8))
    walls = cv2.bitwise_or(horizontal_closed, vertical_closed)
    return cv2.dilate(walls, np.ones((3, 3), np.uint8), iterations=1)


def recognise_rooms(data: bytes, filename: str, gap_closure: float = 0.15) -> tuple[int, int, list[DetectedRoom]]:
    """Find enclosed light areas in a drawing, returning outlines in image pixels.

    The result is deliberately a draft: doors, open plans and scanned drawings can
    break walls, so the user always chooses the room and can edit it afterwards.
    """
    image = _decode_document(data, filename)
    height, width = image.shape[:2]
    maximum_dimension = 2200
    if max(width, height) > maximum_dimension:
        scale = maximum_dimension / max(width, height)
        image = cv2.resize(image, (round(width * scale), round(height * scale)), interpolation=cv2.INTER_AREA)
        height, width = image.shape[:2]

    grayscale = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
    requested_gap_closure = max(0.035, min(0.18, gap_closure))
    walls = _structural_wall_mask(grayscale, requested_gap_closure)
    ink = cv2.threshold(grayscale, 175, 255, cv2.THRESH_BINARY_INV)[1]
    distance = cv2.distanceTransform(ink, cv2.DIST_L2, 5)
    thick_core = np.where(distance >= max(1.8, min(width, height) * 0.0035), 255, 0).astype(np.uint8)
    empty_space = cv2.bitwise_not(walls)
    labels, _label_image, statistics, _centroids = cv2.connectedComponentsWithStats(empty_space, connectivity=8)

    minimum_area = max(1_500, width * height * 0.012)
    drawing_margin = max(12, round(min(width, height) * 0.04))
    rooms: list[DetectedRoom] = []
    for label in range(1, labels):
        x, y, component_width, component_height, area = statistics[label]
        if area < minimum_area:
            continue
        # The outside of the drawing touches an image edge; enclosed rooms do not.
        if x <= 1 or y <= 1 or x + component_width >= width - 1 or y + component_height >= height - 1:
            continue
        # Survey frames and exterior gardens are often enclosed by dimensions or
        # a partial site boundary. Do not promote areas sitting in the drawing
        # margin to editable rooms.
        if x < drawing_margin or y < drawing_margin or x + component_width > width - drawing_margin or y + component_height > height - drawing_margin:
            continue
        mask = np.where(_label_image == label, 255, 0).astype(np.uint8)
        if not _has_structural_boundary(mask, thick_core):
            continue
        contours, _ = cv2.findContours(mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
        if not contours:
            continue
        vertices = _to_plan_vertices(max(contours, key=cv2.contourArea), height)
        if len(vertices) < 3:
            continue
        rectangularity = min(1.0, float(area) / max(1.0, component_width * component_height))
        size_score = min(1.0, float(area) / max(1.0, width * height * 0.08))
        confidence = float(round(0.55 * rectangularity + 0.45 * size_score, 2))
        rooms.append(DetectedRoom(f"room-{len(rooms) + 1:02d}", f"Detected room {len(rooms) + 1}", vertices, float(area), confidence))

    rooms.sort(key=lambda room: room.area_px2, reverse=True)
    if rooms:
        renamed = [DetectedRoom(f"room-{index:02d}", f"Detected room {index}", room.vertices, room.area_px2, room.confidence) for index, room in enumerate(rooms, start=1)]
        return width, height, renamed

    # A scan with gaps in all walls is still useful: give the user a clean outline
    # for the drawing extents rather than failing the import completely.
    margin = max(20, round(min(width, height) * 0.04))
    fallback = [
        {"x": float(margin), "y": float(margin)},
        {"x": float(width - margin), "y": float(margin)},
        {"x": float(width - margin), "y": float(height - margin)},
        {"x": float(margin), "y": float(height - margin)},
    ]
    return width, height, [DetectedRoom("room-01", "Project outline (review required)", fallback, float((width - margin * 2) * (height - margin * 2)), 0.2)]
