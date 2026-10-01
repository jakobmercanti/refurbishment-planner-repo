"""Bounded STL/GLB validation and visual-only GLB/thumbnail derivation."""

from __future__ import annotations

import json
import math
import re
import struct
import sys
from array import array
from collections.abc import Iterable
from typing import Any

from PIL import Image, ImageDraw

MAX_TRIANGLES = 2_000_000
MAX_GLB_BYTES = 100 * 1024 * 1024
_VERTEX = re.compile(r"\bvertex\s+([-+0-9.eE]+)\s+([-+0-9.eE]+)\s+([-+0-9.eE]+)\b", re.I)
Vec3 = tuple[float, float, float]
Triangle = tuple[Vec3, Vec3, Vec3]


class ModelProcessingError(ValueError):
    """The supplied model is malformed, unsupported, or exceeds safe limits."""


def _thumbnail(bounds: Vec3, triangles: list[Triangle] | None = None) -> bytes:
    image = Image.new("RGB", (512, 512), "#f4f7f8")
    draw = ImageDraw.Draw(image)
    if triangles:
        projected: list[tuple[tuple[float, float], ...]] = []
        for source_triangle in triangles:
            projected.append(tuple((x + z * 0.35, y + z * 0.18) for x, y, z in source_triangle))
        points = [point for projected_triangle in projected for point in projected_triangle]
        min_x, max_x = min(p[0] for p in points), max(p[0] for p in points)
        min_y, max_y = min(p[1] for p in points), max(p[1] for p in points)
        scale = min(400 / max(max_x - min_x, 1e-6), 400 / max(max_y - min_y, 1e-6))
        origin_x = (512 - (max_x - min_x) * scale) / 2
        origin_y = (512 - (max_y - min_y) * scale) / 2
        for projected_triangle in projected:
            polygon = [
                (origin_x + (x - min_x) * scale, 512 - origin_y - (y - min_y) * scale) for x, y in projected_triangle
            ]
            draw.polygon(polygon, fill="#d8e7ee", outline="#385968")
    else:
        x, y, z = (max(value, 1) for value in bounds)
        scale = min(280 / max(x, y, z), 1)
        sx, sy, sz = x * scale, y * scale, z * scale
        cx, cy = 256, 256
        top = [
            (cx - sx / 2, cy - sy / 2),
            (cx + sx / 2, cy - sy / 2),
            (cx + sx / 2, cy + sy / 2),
            (cx - sx / 2, cy + sy / 2),
        ]
        draw.polygon(top, fill="#d8e7ee", outline="#385968")
        draw.rectangle(
            (cx - sx / 2 + sz * 0.25, cy - sy / 2 + sz * 0.25, cx + sx / 2 + sz * 0.25, cy + sy / 2 + sz * 0.25),
            outline="#385968",
            width=3,
        )
    import io

    output = io.BytesIO()
    image.save(output, format="PNG", optimize=True)
    return output.getvalue()


def _glb_document(document: dict[str, Any], binary: bytes) -> dict[str, Any]:
    if document.get("asset", {}).get("version") != "2.0":
        raise ModelProcessingError("Only glTF 2.0 binary models are supported.")
    if len(document.get("buffers", [])) != 1 or document["buffers"][0].get("uri") is not None:
        raise ModelProcessingError("The GLB must contain one embedded buffer and no external resources.")
    if document["buffers"][0].get("byteLength", len(binary)) > len(binary):
        raise ModelProcessingError("The GLB buffer is incomplete.")
    accessors, views = document.get("accessors", []), document.get("bufferViews", [])
    if len(accessors) > 100_000 or len(views) > 100_000:
        raise ModelProcessingError("The GLB contains too many data records.")
    triangles = 0
    bounds: list[tuple[float, float, float]] = []
    for mesh in document.get("meshes", []):
        for primitive in mesh.get("primitives", []):
            if primitive.get("mode", 4) != 4:
                raise ModelProcessingError("Only triangle-list GLB geometry is supported.")
            attributes = primitive.get("attributes", {})
            position_index = attributes.get("POSITION")
            if not isinstance(position_index, int) or not 0 <= position_index < len(accessors):
                raise ModelProcessingError("A GLB mesh has no valid position data.")
            position = accessors[position_index]
            count = position.get("count")
            if (
                not isinstance(count, int)
                or count < 3
                or count > MAX_TRIANGLES * 3
                or position.get("type") != "VEC3"
                or position.get("componentType") != 5126
            ):
                raise ModelProcessingError("A GLB mesh has unsupported position data.")
            if "sparse" in position:
                raise ModelProcessingError("Sparse GLB accessors are not supported.")
            view_index = position.get("bufferView")
            if not isinstance(view_index, int) or not 0 <= view_index < len(views):
                raise ModelProcessingError("A GLB mesh references missing position data.")
            view = views[view_index]
            offset = int(view.get("byteOffset", 0)) + int(position.get("byteOffset", 0))
            stride = int(view.get("byteStride", 12))
            length = int(view.get("byteLength", 0))
            if (
                stride < 12
                or stride > 252
                or offset < 0
                or offset + (count - 1) * stride + 12 > len(binary)
                or offset + (count - 1) * stride + 12 > int(view.get("byteOffset", 0)) + length
            ):
                raise ModelProcessingError("A GLB position buffer is out of bounds.")
            mins, maxs = position.get("min"), position.get("max")
            if not (isinstance(mins, list) and isinstance(maxs, list) and len(mins) == 3 and len(maxs) == 3):
                raise ModelProcessingError("GLB position bounds are missing.")
            pair_x = (float(mins[0]), float(maxs[0]))
            pair_y = (float(mins[1]), float(maxs[1]))
            pair_z = (float(mins[2]), float(maxs[2]))
            if not all(
                math.isfinite(number) and abs(number) <= 10_000
                for axis_bounds in (pair_x, pair_y, pair_z)
                for number in axis_bounds
            ):
                raise ModelProcessingError("GLB position bounds are invalid.")
            bounds.append(
                (
                    max(pair_x[1] - pair_x[0], 0.000001) * 1000,
                    max(pair_y[1] - pair_y[0], 0.000001) * 1000,
                    max(pair_z[1] - pair_z[0], 0.000001) * 1000,
                )
            )
            index = primitive.get("indices")
            if index is None:
                triangles += count // 3
            elif isinstance(index, int) and 0 <= index < len(accessors):
                index_count = accessors[index].get("count")
                if not isinstance(index_count, int):
                    raise ModelProcessingError("GLB triangle indices are invalid.")
                triangles += index_count // 3
            else:
                raise ModelProcessingError("A GLB mesh references invalid triangle indices.")
            if triangles > MAX_TRIANGLES:
                raise ModelProcessingError("The model exceeds the 2 million triangle limit.")
    if not bounds:
        raise ModelProcessingError("The GLB contains no renderable triangle mesh.")
    overall = (
        max(row[0] for row in bounds),
        max(row[1] for row in bounds),
        max(row[2] for row in bounds),
    )
    return {"triangles": triangles, "bounds": {"x": overall[0], "y": overall[1], "z": overall[2]}}


def _unpack_stl(data: bytes) -> Iterable[Triangle]:
    if len(data) >= 84:
        count = struct.unpack_from("<I", data, 80)[0]
        if count <= MAX_TRIANGLES and 84 + count * 50 == len(data):
            for index in range(count):
                values = struct.unpack_from("<12fH", data, 84 + index * 50)
                yield (
                    (float(values[3]), float(values[4]), float(values[5])),
                    (float(values[6]), float(values[7]), float(values[8])),
                    (float(values[9]), float(values[10]), float(values[11])),
                )
            return
    try:
        text = data.decode("ascii")
    except UnicodeDecodeError:
        raise ModelProcessingError("The file is neither a valid binary nor ASCII STL.") from None
    if not text.lstrip().lower().startswith("solid"):
        raise ModelProcessingError("The file is not a supported STL.")
    pending: list[tuple[float, float, float]] = []
    count = 0
    for match in _VERTEX.finditer(text):
        vertex = (float(match.group(1)), float(match.group(2)), float(match.group(3)))
        if not all(math.isfinite(value) and abs(value) <= 10_000_000 for value in vertex):
            raise ModelProcessingError("The STL contains invalid coordinates.")
        pending.append(vertex)
        if len(pending) == 3:
            count += 1
            if count > MAX_TRIANGLES:
                raise ModelProcessingError("The model exceeds the 2 million triangle limit.")
            yield (pending[0], pending[1], pending[2])
            pending = []
    if pending or count == 0:
        raise ModelProcessingError("The ASCII STL has an incomplete or empty triangle list.")


def _stl_to_glb(triangles: Iterable[Triangle], unit: str) -> tuple[bytes, dict[str, Any], bytes]:
    scale = {"mm": 0.001, "cm": 0.01, "in": 0.0254}.get(unit)
    if scale is None:
        raise ModelProcessingError("Choose mm, cm or inches for STL coordinates.")
    positions, normals = array("f"), array("f")
    min_v, max_v = [math.inf] * 3, [-math.inf] * 3
    preview: list[Triangle] = []
    total = 0
    for triangle in triangles:
        source_a, source_b, source_c = triangle
        points: Triangle = (
            (float(source_a[0]) * scale, float(source_a[1]) * scale, float(source_a[2]) * scale),
            (float(source_b[0]) * scale, float(source_b[1]) * scale, float(source_b[2]) * scale),
            (float(source_c[0]) * scale, float(source_c[1]) * scale, float(source_c[2]) * scale),
        )
        if not all(math.isfinite(value) and abs(value) <= 10_000 for point in points for value in point):
            raise ModelProcessingError("The STL contains invalid or oversized coordinates.")
        a, b, c = points
        u = tuple(b[i] - a[i] for i in range(3))
        v = tuple(c[i] - a[i] for i in range(3))
        normal: Vec3 = (
            u[1] * v[2] - u[2] * v[1],
            u[2] * v[0] - u[0] * v[2],
            u[0] * v[1] - u[1] * v[0],
        )
        magnitude = math.sqrt(sum(component * component for component in normal))
        normal = (
            (normal[0] / magnitude, normal[1] / magnitude, normal[2] / magnitude)
            if magnitude > 1e-20
            else (0.0, 0.0, 1.0)
        )
        for point in points:
            positions.extend(point)
            normals.extend(normal)
            for axis in range(3):
                min_v[axis] = min(min_v[axis], point[axis])
                max_v[axis] = max(max_v[axis], point[axis])
        total += 1
        if len(preview) < 20_000:
            preview.append(points)
        if total > MAX_TRIANGLES:
            raise ModelProcessingError("The model exceeds the 2 million triangle limit.")
    if total == 0:
        raise ModelProcessingError("The STL contains no triangles.")
    if sys.byteorder != "little":
        positions.byteswap()
        normals.byteswap()
    pos_bytes, normal_bytes = positions.tobytes(), normals.tobytes()
    binary = pos_bytes + normal_bytes
    dimension_m = [max_v[i] - min_v[i] for i in range(3)]
    if not all(math.isfinite(value) and value > 0 for value in dimension_m):
        raise ModelProcessingError("The model has empty or invalid bounds.")
    doc = {
        "asset": {"version": "2.0", "generator": "FreeFloorplan3D bounded STL converter"},
        "scene": 0,
        "scenes": [{"nodes": [0]}],
        "nodes": [{"mesh": 0}],
        "meshes": [{"primitives": [{"attributes": {"POSITION": 0, "NORMAL": 1}, "mode": 4}]}],
        "buffers": [{"byteLength": len(binary)}],
        "bufferViews": [
            {"buffer": 0, "byteOffset": 0, "byteLength": len(pos_bytes), "target": 34962},
            {"buffer": 0, "byteOffset": len(pos_bytes), "byteLength": len(normal_bytes), "target": 34962},
        ],
        "accessors": [
            {"bufferView": 0, "componentType": 5126, "count": total * 3, "type": "VEC3", "min": min_v, "max": max_v},
            {"bufferView": 1, "componentType": 5126, "count": total * 3, "type": "VEC3"},
        ],
    }
    json_chunk = json.dumps(doc, separators=(",", ":")).encode("utf-8")
    json_chunk += b" " * ((-len(json_chunk)) % 4)
    binary += b"\0" * ((-len(binary)) % 4)
    total_len = 12 + 8 + len(json_chunk) + 8 + len(binary)
    glb = (
        struct.pack("<4sII", b"glTF", 2, total_len)
        + struct.pack("<II", len(json_chunk), 0x4E4F534A)
        + json_chunk
        + struct.pack("<II", len(binary), 0x004E4942)
        + binary
    )
    bounds = {"x": dimension_m[0] * 1000, "y": dimension_m[1] * 1000, "z": dimension_m[2] * 1000}
    return (
        glb,
        {"triangles": total, "bounds": bounds},
        _thumbnail((dimension_m[0], dimension_m[1], dimension_m[2]), preview),
    )


def process_model(data: bytes, file_format: str, source_unit: str | None) -> tuple[bytes, bytes, dict[str, Any]]:
    if len(data) > MAX_GLB_BYTES or len(data) < 20:
        raise ModelProcessingError("The model must be between 20 bytes and 100 MB.")
    if file_format == "stl":
        derived, info, thumbnail = _stl_to_glb(_unpack_stl(data), source_unit or "")
        return derived, thumbnail, info
    if (
        file_format != "glb"
        or struct.unpack_from("<4sII", data)[:2] != (b"glTF", 2)
        or struct.unpack_from("<I", data, 8)[0] != len(data)
    ):
        raise ModelProcessingError("The file is not a valid glTF 2.0 binary.")
    json_size, json_type = struct.unpack_from("<II", data, 12)
    if json_type != 0x4E4F534A or json_size > 4 * 1024 * 1024 or 20 + json_size > len(data):
        raise ModelProcessingError("The GLB JSON chunk is invalid.")
    try:
        document = json.loads(data[20 : 20 + json_size])
    except (json.JSONDecodeError, UnicodeDecodeError):
        raise ModelProcessingError("The GLB JSON chunk is invalid.") from None
    if not isinstance(document, dict):
        raise ModelProcessingError("The GLB document must be an object.")
    stack = [document]
    while stack:
        current = stack.pop()
        if isinstance(current, dict):
            if "uri" in current:
                raise ModelProcessingError("External and embedded data URLs are not supported in GLB assets.")
            stack.extend(current.values())
        elif isinstance(current, list):
            stack.extend(current)
    binary_offset = 20 + json_size
    if binary_offset + 8 > len(data):
        raise ModelProcessingError("The GLB binary chunk is missing.")
    binary_size, binary_type = struct.unpack_from("<II", data, binary_offset)
    if binary_type != 0x004E4942 or binary_offset + 8 + binary_size > len(data):
        raise ModelProcessingError("The GLB binary chunk is invalid.")
    binary = data[binary_offset + 8 : binary_offset + 8 + binary_size]
    info = _glb_document(document, binary)
    bounds = info["bounds"]
    thumbnail = _thumbnail((bounds["x"] / 1000, bounds["y"] / 1000, bounds["z"] / 1000))
    return data, thumbnail, info
