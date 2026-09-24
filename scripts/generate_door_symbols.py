"""Author shared architectural door symbols for catalogue and floorplan views."""
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
models = json.loads((ROOT / "frontend/lib/doorModels.json").read_text(encoding="utf8"))
symbols = {}
for model in models:
    paths = []
    def path(d, dash=False, fill="none", weight=8):
        paths.append({"d": d, "dash": dash, "fill": fill, "weight": weight})
    leaves, operation = model["leaves"], model["operation"]
    path("M0 -25 V25 M1000 -25 V25", weight=16)
    if operation == "HINGED":
        double = leaves > 1
        reach = 500 if double else 1000
        path(f"M0 0 V{reach} H18 V0 Z", fill="white")
        path(f"M{reach} 0 A{reach} {reach} 0 0 1 0 {reach}", dash=True, weight=5)
        if double:
            path("M1000 0 V500 H982 V0 Z", fill="white")
            path("M500 0 A500 500 0 0 0 1000 500", dash=True, weight=5)
        if model["style"] in ("french-classic", "glazed", "entrance-glazed"):
            path(f"M9 55 V{reach-55}", weight=3)
            if double:
                path("M991 55 V445", weight=3)
        if model["style"] == "entrance":
            path("M0 -12 H1000", weight=5)
        height = reach
    elif operation == "SLIDING":
        path("M0 -30 H1000 M0 45 H1000", weight=5)
        for i in range(leaves):
            x, span = i * 1000 / leaves, 1000 / leaves
            z = 0 if i % 2 == 0 else 24
            path(f"M{x} {z} h{span} v18 h{-span} Z", fill="white")
            mid = x + span / 2
            sign = -1 if i == 0 else 1
            path(f"M{mid-sign*span*.20} 125 h{sign*span*.40} m{-sign*40} -25 l{sign*40} 25 l{-sign*40} 25", weight=6)
        if model["key"] == "door-sliding-pocket":
            path("M0 -50 H500 V-110 H0", dash=True, weight=5)
        height = 180
    else:
        span = 1000 / leaves
        for i in range(leaves):
            x = i * span
            path(f"M{x} {0 if i%2 == 0 else span*.55} L{x+span} {span*.55 if i%2 == 0 else 0}", weight=16)
        path("M0 0 H1000", dash=True, weight=5)
        height = span * .55 + 40
    symbols[model["key"]] = {"height": height, "paths": paths}
    body = "".join(f'<path d="{p["d"]}" fill="{p["fill"]}" stroke="#222" stroke-width="{p["weight"]}"' + (' stroke-dasharray="22 14"' if p["dash"] else '') + '/>' for p in paths)
    svg = f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="-30 -130 1060 {height+170}"><title>{model["familyName"]}: {model["name"]}</title>{body}</svg>'
    (ROOT / "frontend/public/fixture-symbols" / f'{model["key"]}.svg').write_text(svg, encoding="utf8")
(ROOT / "frontend/lib/doorPlanSymbols.json").write_text(json.dumps(symbols, indent=2), encoding="utf8")
