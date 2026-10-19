"""Author local seating catalogue illustrations and plan symbols; no application checks."""

from itertools import pairwise
from math import cos, pi, sin, sqrt
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1] / "frontend/public"


def illustration(key):
    chair = key.startswith("furniture-chair-")
    variant = key.split("-")[-1]
    faces = []
    wood, cloth = "#a78966", "#b9afa1"

    def project(p):
        x, y, z = p
        return (160 + 139 * x - 96 * z, 235 - 173 * y + 47 * x + 66 * z)

    def face(points, colour, shade=1):
        rgb = [min(255, int(int(colour[i : i + 2], 16) * shade)) for i in (1, 3, 5)]
        fill = "#" + "".join(f"{v:02x}" for v in rgb)
        depth = sum(p[0] * 0.55 + p[1] * 0.6 + p[2] * 0.8 for p in points) / len(points)
        faces.append(
            (
                depth,
                (
                    f"<polygon"
                    f' points="{" ".join(f"{project(p)[0]:.2f},{project(p)[1]:.2f}" for p in points)}"'
                    f' fill="{fill}" stroke="{fill}" stroke-width=".35"'
                    f' stroke-linejoin="round"/>'
                ),
            )
        )

    def box(x, y, z, w, h, d, colour):
        a, b, c, e = (
            (x - w / 2, y - h / 2, z - d / 2),
            (x + w / 2, y - h / 2, z - d / 2),
            (x + w / 2, y - h / 2, z + d / 2),
            (x - w / 2, y - h / 2, z + d / 2),
        )

        def top(p):
            return (p[0], p[1] + h, p[2])

        face([a, b, top(b), top(a)], colour, 0.76)
        face([b, c, top(c), top(b)], colour, 0.85)
        face([c, e, top(e), top(c)], colour, 0.96)
        face([e, a, top(a), top(e)], colour, 0.8)
        face([top(a), top(b), top(c), top(e)], colour, 1.09)

    def rod(a, b, r, colour):
        delta = [b[i] - a[i] for i in range(3)]
        length = sqrt(sum(v * v for v in delta))
        v = [q / length for q in delta]
        u = [v[2], 0, -v[0]] if abs(v[1]) < 0.95 else [1, 0, 0]
        norm = sqrt(sum(q * q for q in u))
        u = [q / norm for q in u]
        w = [v[1] * u[2] - v[2] * u[1], v[2] * u[0] - v[0] * u[2], v[0] * u[1] - v[1] * u[0]]

        def ring(p, t):
            return tuple(p[i] + r * (u[i] * cos(t) + w[i] * sin(t)) for i in range(3))

        for i in range(10):
            t = i * pi / 5
            n = (i + 1) * pi / 5
            face([ring(a, t), ring(b, t), ring(b, n), ring(a, n)], colour, 0.88 + 0.17 * cos(t))

    for x in (-1, 1):
        for z in (-1, 1):
            rod((x * 0.39, 0.02, z * 0.39), (x * 0.32, 0.48 if chair else 0.31, z * 0.29), 0.026, wood)
    if chair:
        box(0, 0.49, 0.025, 0.91, 0.075, 0.85, wood)
        if variant in ("classic", "wishbone"):
            points = [(sin(t) * 0.47, 0.97, 0.06 - cos(t) * 0.46) for t in [(i / 20 * 2 - 1) * 1.15 for i in range(21)]]
            for a, b in pairwise(points):
                rod(a, b, 0.025, wood)
            if variant == "classic":
                for x in (-0.34, -0.225, -0.11, 0, 0.11, 0.225, 0.34):
                    rod((x * 0.88, 0.53, -0.31), (x, 0.95, 0.06 - sqrt(0.46**2 - x * x)), 0.013, wood)
            else:
                for x in (-1, 1):
                    rod((x * 0.34, 0.49, -0.27), (x * 0.43, 0.94, -0.13), 0.022, wood)
                    rod((0, 0.7, -0.39), (x * 0.18, 0.92, -0.36), 0.022, wood)
                rod((0, 0.54, -0.36), (0, 0.71, -0.39), 0.022, wood)
        elif variant in ("ladder", "crossback"):
            for x in (-1, 1):
                rod((x * 0.36, 0.49, -0.29), (x * 0.40, 0.98, -0.38), 0.023, wood)
            for y in (0.93,) if variant == "crossback" else (0.65, 0.79, 0.93):
                box(0, y, -0.32 - (y - 0.5) * 0.15, 0.78, 0.09, 0.045, wood)
            if variant == "crossback":
                for x in (-1, 1):
                    rod((x * 0.34, 0.56, -0.32), (-x * 0.35, 0.88, -0.375), 0.023, wood)
        else:
            for i in range(24):
                a = (i / 24 * 2 - 1) * 1.13
                b = ((i + 1) / 24 * 2 - 1) * 1.13
                face(
                    [
                        (sin(t) * 0.47, y, 0.055 - cos(t) * 0.47)
                        for t, y in [(a, 0.66), (b, 0.66), (b, 0.97), (a, 0.97)]
                    ],
                    wood,
                    0.95 + 0.09 * cos(a),
                )
            for x in (-1, 1):
                rod((x * 0.29, 0.50, -0.28), (x * 0.29, 0.75, -0.31), 0.018, wood)
    else:
        box(0, 0.33, 0.01, 0.89, 0.15, 0.86, wood if variant == "scandi" else cloth)
        if variant == "tub":
            for i in range(32):
                a = (i / 32 * 2 - 1) * 2.1
                b = ((i + 1) / 32 * 2 - 1) * 2.1

                def top(t):
                    return 0.97 - (abs(t) / 2.1) ** 1.5 * 0.3

                face(
                    [
                        (sin(t) * 0.49, y, 0.055 - cos(t) * 0.49)
                        for t, y in [(a, 0.31), (b, 0.31), (b, top(b)), (a, top(a))]
                    ],
                    cloth,
                    0.88 + 0.12 * cos(a),
                )
            box(0, 0.697, -0.267, 0.62, 0.38, 0.15, cloth)
        else:
            box(0, 0.70, -0.325, 0.76, 0.57 if variant == "classic" else 0.5, 0.15, cloth)
            for x in (-1, 1):
                if variant == "scandi":
                    for z in (-0.29, 0.26):
                        rod((x * 0.43, 0.30, z), (x * 0.43, 0.63, z), 0.025, wood)
                    box(x * 0.43, 0.645, -0.045, 0.105, 0.065, 0.77, wood)
                else:
                    box(x * 0.413, 0.49, 0.025, 0.165, 0.37 if variant == "classic" else 0.28, 0.87, cloth)
                    if variant == "club":
                        rod((x * 0.39, 0.635, -0.34), (x * 0.39, 0.635, 0.38), 0.105, cloth)
                    if variant == "classic":
                        box(x * 0.355, 0.80, -0.24, 0.16, 0.34, 0.25, cloth)
        box(0, 0.453, 0.04, 0.74 if variant in ("tub", "scandi") else 0.68, 0.155, 0.7, "#c6bcb0")
    return (
        (
            '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 300"><rect'
            ' width="320" height="300" fill="#eef1ed"/><ellipse cx="160" cy="245"'
            ' rx="100" ry="22" fill="#263d3020"/>'
        )
        + "".join(svg for _, svg in sorted(faces, key=lambda item: item[0]))
        + "</svg>"
    )


def plan(key):
    chair = key.startswith("furniture-chair-")
    tub = key.endswith("tub")
    back = '<path d="M24 56 Q18 16 60 16 Q102 16 96 56"/>' if tub else '<path d="M23 29 Q60 13 97 29"/>'
    arms = "" if chair else '<path d="M23 30 V96 M97 30 V96" stroke-width="9"/>'
    spindles = (
        "".join(f'<path d="M{x} 23 V34"/>' for x in (33, 46, 60, 74, 87)) if key.endswith("classic") and chair else ""
    )
    return (
        f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 120"><g'
        f' fill="#f1eee7" stroke="#283e36" stroke-width="2.5" stroke-linecap="round">'
        f'<rect x="25" y="32" width="70" height="68" rx="12"/>{back}{arms}{spindles}'
        f'<path d="M32 92 H88" fill="none"/></g></svg>'
    )


if __name__ == "__main__":
    for family, variants in (
        ("chair", ("classic", "modern", "wishbone", "ladder", "crossback")),
        ("armchair", ("classic", "modern", "tub", "scandi", "club")),
    ):
        for variant in variants:
            key = f"furniture-{family}-{variant}"
            (ROOT / "fixture-previews" / f"{key}.svg").write_text(illustration(key), encoding="utf8")
            (ROOT / "fixture-symbols" / f"{key}.svg").write_text(plan(key), encoding="utf8")
