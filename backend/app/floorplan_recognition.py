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


def _to_plan_vertices(contour: np.ndarray, image_height: int) -> list[dict[str, float]]:
    perimeter = cv2.arcLength(contour, True)
    approximate = cv2.approxPolyDP(contour, max(3.0, perimeter * 0.012), True).reshape(-1, 2)
    vertices = [{"x": float(x), "y": float(image_height - y)} for x, y in approximate]
    if len(vertices) < 3:
        return []
    if _polygon_area(vertices) < 0:
        vertices.reverse()
    return vertices


def recognise_rooms(data: bytes, filename: str) -> tuple[int, int, list[DetectedRoom]]:
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
    walls = cv2.threshold(grayscale, 215, 255, cv2.THRESH_BINARY_INV)[1]
    walls = cv2.morphologyEx(walls, cv2.MORPH_CLOSE, np.ones((7, 7), np.uint8), iterations=2)
    walls = cv2.dilate(walls, np.ones((5, 5), np.uint8), iterations=1)
    empty_space = cv2.bitwise_not(walls)
    labels, _label_image, statistics, _centroids = cv2.connectedComponentsWithStats(empty_space, connectivity=8)

    minimum_area = max(1_500, width * height * 0.003)
    rooms: list[DetectedRoom] = []
    for label in range(1, labels):
        x, y, component_width, component_height, area = statistics[label]
        if area < minimum_area:
            continue
        # The outside of the drawing touches an image edge; enclosed rooms do not.
        if x <= 1 or y <= 1 or x + component_width >= width - 1 or y + component_height >= height - 1:
            continue
        mask = np.where(_label_image == label, 255, 0).astype(np.uint8)
        contours, _ = cv2.findContours(mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
        if not contours:
            continue
        vertices = _to_plan_vertices(max(contours, key=cv2.contourArea), height)
        if len(vertices) < 3:
            continue
        rooms.append(DetectedRoom(f"room-{len(rooms) + 1:02d}", f"Detected room {len(rooms) + 1}", vertices, float(area)))

    rooms.sort(key=lambda room: room.area_px2, reverse=True)
    if rooms:
        return width, height, rooms

    # A scan with gaps in all walls is still useful: give the user a clean outline
    # for the drawing extents rather than failing the import completely.
    margin = max(20, round(min(width, height) * 0.04))
    fallback = [
        {"x": float(margin), "y": float(margin)},
        {"x": float(width - margin), "y": float(margin)},
        {"x": float(width - margin), "y": float(height - margin)},
        {"x": float(margin), "y": float(height - margin)},
    ]
    return width, height, [DetectedRoom("room-01", "Project outline (review required)", fallback, float((width - margin * 2) * (height - margin * 2)))]
