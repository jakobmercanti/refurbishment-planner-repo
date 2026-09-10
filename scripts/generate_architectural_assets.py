"""Generate matching render-only staircase geometry, plan symbols and previews.

Coordinates and nominal bounds are millimetres. These illustrations do not replace
the geometry kernel's conservative placement envelopes or certify stair design.
"""
import json
import math
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
PUBLIC = ROOT / "frontend/public"
MODELS = {}


def build(slug, width, depth, layout, open_riser=False):
    steps = []

    def tread(points, level):
        steps.append({"points": points, "top": level * 175})

    def rect(x, z, w, d, level):
        tread([[x, z + d], [x, z], [x + w, z], [x + w, z + d]], level)

    def arc(cx, cz, inner, outer, start, end, count, first):
        for i in range(count):
            a = start + (end - start) * i / count
            b = start + (end - start) * (i + 1) / count
            angles = [a + (b - a) * j / 6 for j in range(7)]
            tread([[cx + r * math.cos(t), cz + r * math.sin(t)]
                   for r, seq in ((inner, angles), (outer, angles[::-1])) for t in seq], first + i)

    if layout == "straight":
        for i in range(16):
            rect(0, depth - (i + 1) * depth / 16, width, depth / 16, i + 1)
    elif layout == "l":
        for i in range(7):
            rect(0, depth - (i + 1) * (depth - 1000) / 7, 1000, (depth - 1000) / 7, i + 1)
        rect(0, 0, 1000, 1000, 8)
        for i in range(8):
            rect(1000 + i * (width - 1000) / 8, 0, (width - 1000) / 8, 1000, i + 9)
        if slug.endswith("left"):
            for step in steps:
                step["points"] = [[width - x, z] for x, z in step["points"]][::-1]
    elif layout == "quarter":
        for i in range(6):
            rect(0, depth - (i + 1) * 2000 / 6, 1000, 2000 / 6, i + 1)
        tread([[0, 1000], [0, 0], [1000, 1000]], 7)
        tread([[0, 0], [1000, 0], [1000, 1000]], 8)
        for i in range(8):
            rect(1000 + i * 250, 0, 250, 1000, i + 9)
    elif layout in ("u", "u-winder"):
        count = 7 if layout == "u" else 6
        for i in range(count):
            rect(0, depth - (i + 1) * 2000 / count, 1000, 2000 / count, i + 1)
        if layout == "u":
            rect(0, 0, width, 1000, 8)
            for i in range(8):
                rect(width - 1000, 1000 + i * 250, 1000, 250, i + 9)
        else:
            # Four triangular winders around the inside edge of the stairwell.
            tread([[0, 1000], [0, 0], [1100, 1000]], 7)
            tread([[0, 0], [1100, 0], [1100, 1000]], 8)
            tread([[1100, 0], [width, 0], [1100, 1000]], 9)
            tread([[width, 0], [width, 1000], [1100, 1000]], 10)
            for i in range(6):
                rect(width - 1000, 1000 + i * 2000 / 6, 1000, 2000 / 6, i + 11)
    elif layout in ("spiral", "curved"):
        radius = min(width, depth) / 2 - 30
        arc(width / 2, depth / 2, 100 if layout == "spiral" else radius * .42,
            radius, math.pi / 2, math.pi / 2 + (math.pi * 1.7 if layout == "spiral" else math.pi), 16, 1)
    elif layout == "bifurcated":
        for i in range(7):
            rect(width / 2 - 600, depth - (i + 1) * (depth - 1000) / 7, 1200, (depth - 1000) / 7, i + 1)
        rect(0, 0, width, 1000, 8)
        for i in range(8):
            for x in (0, width - 1000):
                rect(x, 1000 + i * (depth - 1000) / 8, 1000, (depth - 1000) / 8, i + 9)

    rails = []
    if layout in ("spiral", "curved"):
        for step in steps:
            points = step["points"]
            for i in range(7, 13):
                rails.append({"a": [*points[i], step["top"]], "b": [*points[i + 1], step["top"]], "post": i == 7,
                              "guard_a": 870 - (i - 7) * 175 / 6, "guard_b": 870 - (i - 6) * 175 / 6})
    else:
        # Only exposed edges receive guarding; shared tread/landing edges stay open.
        def inside(x, z, poly):
            result = False
            for a, b in zip(poly, poly[1:] + poly[:1]):
                if (a[1] > z) != (b[1] > z) and x < (b[0] - a[0]) * (z - a[1]) / (b[1] - a[1]) + a[0]:
                    result = not result
            return result
        for step in steps:
            poly = step["points"]
            for a, b in zip(poly, poly[1:] + poly[:1]):
                dx, dz = b[0] - a[0], b[1] - a[1]
                length = math.hypot(dx, dz)
                if not length:
                    continue
                mx, mz = (a[0] + b[0]) / 2, (a[1] + b[1]) / 2
                # Probe both sides, robust to mirrored polygons.
                occupied = [any(inside(mx + sign * dz / length * 2, mz - sign * dx / length * 2, other["points"])
                                for other in steps) for sign in (-1, 1)]
                if all(occupied):
                    continue
                # Leave the foot and upper exit of each flight unobstructed.
                if step["top"] in (175, 2800) and abs(dz) < 1:
                    continue
                rails.append({"a": [a[0], a[1], step["top"]], "b": [b[0], b[1], step["top"]], "post": True})
    joints = {}
    for rail in rails:
        for p in (rail["a"], rail["b"]):
            joints.setdefault((round(p[0], 2), round(p[1], 2)), []).append(p[2])
    for rail in rails:
        for end in ("a", "b"):
            p = rail[end]
            levels = joints[(round(p[0], 2), round(p[1], 2))]
            rail.setdefault(f"guard_{end}", sum(levels) / len(levels) + 870 - p[2])
            p[0] = min(width - 22, max(22, p[0]))
            p[1] = min(depth - 22, max(22, p[1]))
    key = f"furniture-stair-{slug}"
    MODELS[key] = {"width": width, "depth": depth, "height": 3700, "open": open_riser or layout in ("spiral", "curved"),
                   "column": layout == "spiral", "steps": steps, "rails": rails}


for args in [("straight", 1000, 4000, "straight"), ("open", 1000, 4000, "straight", True),
             ("l-left", 3000, 3000, "l"), ("l-right", 3000, 3000, "l"),
             ("u-landing", 2200, 3000, "u"), ("u-winder", 2200, 3000, "u-winder"),
             ("quarter-winder", 3000, 3000, "quarter"), ("spiral", 2000, 2000, "spiral"),
             ("curved", 3000, 3000, "curved"), ("bifurcated", 4000, 3500, "bifurcated")]:
    build(*args)


def points_text(points):
    return " ".join(f"{x:.2f},{y:.2f}" for x, y in points)


for key, model in MODELS.items():
    w, d = model["width"], model["depth"]
    plan = []
    for step in model["steps"]:
        dashed = ' stroke-dasharray="65 40"' if step["top"] > 1200 else ""
        plan.append(f'<polygon points="{points_text(step["points"])}" fill="white" stroke="#222" stroke-width="12"{dashed}/>')
    centres = [[sum(p[0] for p in s["points"]) / len(s["points"]), sum(p[1] for p in s["points"]) / len(s["points"])] for s in model["steps"]]
    if key.endswith("bifurcated"):
        centres = centres[:8] + centres[8::2]
    route = centres[:min(len(centres), 12)]
    plan.append(f'<polyline points="{points_text(route)}" fill="none" stroke="#111" stroke-width="18" marker-end="url(#up)"/>')
    x, z = centres[0]
    plan.append(f'<text x="{x + 70}" y="{z}" font-family="Arial" font-size="120">UP</text>')
    # Conventional break across the flight at plan cut height.
    step = model["steps"][6]
    a, b = step["points"][0], step["points"][-1]
    plan.append(f'<path d="M{a[0]} {a[1]-35} L{(a[0]+b[0])/2-60} {(a[1]+b[1])/2-100} l120 130 L{b[0]} {b[1]+35}" fill="none" stroke="white" stroke-width="45"/>')
    plan.append(f'<path d="M{a[0]} {a[1]-35} L{(a[0]+b[0])/2-60} {(a[1]+b[1])/2-100} l120 130 L{b[0]} {b[1]+35}" fill="none" stroke="#111" stroke-width="16"/>')
    svg = f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {w} {d}"><title>{key.removeprefix("furniture-").replace("-", " ")} — lower floor plan</title><defs><marker id="up" markerWidth="10" markerHeight="8" refX="9" refY="4" orient="auto"><path d="M0 0 L10 4 L0 8" fill="none" stroke="#111"/></marker></defs>{"".join(plan)}</svg>'
    (PUBLIC / "fixture-symbols" / f"{key}.svg").write_text(svg, encoding="utf8")

    def project(x, z, y):
        return ((x - z) * .72, (x + z) * .30 - y * .85)

    faces = []
    for step in sorted(model["steps"], key=lambda s: sum(p[0] + p[1] for p in s["points"]) / len(s["points"])):
        top = step["top"]
        bottom = top - 45 if model["open"] else 0
        poly = step["points"]
        for a, b in zip(poly, poly[1:] + poly[:1]):
            face = [project(*a, bottom), project(*b, bottom), project(*b, top), project(*a, top)]
            faces.append(f'<polygon points="{points_text(face)}" fill="#79573c" stroke="#674b36" stroke-width="7"/>')
        faces.append(f'<polygon points="{points_text([project(*p, top) for p in poly])}" fill="url(#oak)" stroke="#775738" stroke-width="7"/>')
    for rail in model["rails"]:
        a, b = rail["a"], rail["b"]
        p, q = project(a[0], a[1], a[2] + 870), project(b[0], b[1], b[2] + 870)
        faces.append(f'<polyline points="{points_text([p,q])}" stroke="#343d40" stroke-width="30" fill="none"/>')
        if rail["post"]:
            faces.append(f'<polyline points="{points_text([project(*a),p])}" stroke="#535a5a" stroke-width="18"/>')
    bounds = [project(x, z, y) for x in (0, w) for z in (0, d) for y in (0, 3700)]
    left, top = min(p[0] for p in bounds)-150, min(p[1] for p in bounds)-150
    vw, vh = max(p[0] for p in bounds)-left+150, max(p[1] for p in bounds)-top+150
    preview = f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="{left} {top} {vw} {vh}"><defs><pattern id="oak" width="130" height="55" patternUnits="userSpaceOnUse"><rect width="130" height="55" fill="#bd9364"/><path d="M0 12 Q60 2 130 17 M0 36 Q60 44 130 32" stroke="#99734e" stroke-width="3" fill="none" opacity=".45"/></pattern></defs>{"".join(faces)}</svg>'
    (PUBLIC / "fixture-previews" / f"{key}.svg").write_text(preview, encoding="utf8")

(ROOT / "frontend/lib/staircaseModels.json").write_text(json.dumps(MODELS, separators=(",", ":")), encoding="utf8")

# Conventional horizontal sections: jambs, glazing lines and frame posts. Sash
# leaves slide vertically, so no door-style swing arc is drawn on their plan.
for family, w, d in [("bay", 2400, 650), ("bow", 3000, 700), ("sash", 1000, 180), ("casement", 1200, 160)]:
    if family == "bay":
        vertices = [[20, d - 20], [w * .2, 25], [w * .8, 25], [w - 20, d - 20]]
    elif family == "bow":
        vertices = [[20 + (w - 40) * (1 - math.cos(math.pi * i / 5)) / 2, d - 20 - (d - 45) * math.sin(math.pi * i / 5)] for i in range(6)]
    else:
        vertices = [[20, d / 2], [w - 20, d / 2]]
    lines = []
    for a, b in zip(vertices, vertices[1:]):
        dx, dz = b[0] - a[0], b[1] - a[1]
        length = math.hypot(dx, dz)
        for shift in (-15, 0, 15):
            poly = [[p[0] - dz / length * shift, p[1] + dx / length * shift] for p in (a, b)]
            lines.append(f'<polyline points="{points_text(poly)}" fill="none" stroke="#222" stroke-width="{5 if shift == 0 else 9}"/>')
    for x, z in vertices:
        lines.append(f'<rect x="{x-16}" y="{z-18}" width="32" height="36" fill="white" stroke="#222" stroke-width="8"/>')
    if family == "sash":
        lines.append(f'<path d="M20 {d/2+28} H{w-20}" stroke="#222" stroke-width="5"/>')
    if family == "casement":
        lines.append(f'<path d="M20 {d/2} L{w*.4} {d-10} M{w-20} {d/2} L{w*.6} {d-10}" fill="none" stroke="#222" stroke-width="7"/>')
        lines.append(f'<rect x="{w/2-10}" y="{d/2-20}" width="20" height="40" fill="white" stroke="#222" stroke-width="6"/>')
    svg = f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {w} {d}"><title>{family.title()} window plan</title>{"".join(lines)}</svg>'
    (PUBLIC / "fixture-symbols" / f"window-{family}.svg").write_text(svg, encoding="utf8")
