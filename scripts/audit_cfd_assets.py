"""Read-only catalogue CFD audit and optional fixed-setting Gmsh fluid benchmark.

Run with uv from the repository root. Generated reports/meshes belong in an
ignored QA directory. Gmsh is optional and is not an application dependency.
"""

import argparse
import json
import math
import os
import subprocess
from collections import Counter
from itertools import pairwise, product
from pathlib import Path

from shapely import unary_union
from shapely.geometry import Polygon
from sqlalchemy import select

from database.catalog import SessionLocal
from database.cfd_proxies import cfd_proxy_for
from database.models import FurnitureItemRecord as Item
from geometry.cfd import build_cfd_mesh, cfd_stl
from geometry.cfd_profiles import PROFILES, Prism


def historical_triangles(boxes):
    """Frozen v1 grid-face counter, for reproducible before/after comparisons."""
    axes = [sorted({round(b[i], 10) for b in boxes} | {round(b[i + 3], 10) for b in boxes}) for i in range(3)]
    cells = set()
    for cell in product(*(range(len(a) - 1) for a in axes)):
        centre = [(axes[i][cell[i]] + axes[i][cell[i] + 1]) / 2 for i in range(3)]
        if any(all(box[i] < centre[i] < box[i + 3] for i in range(3)) for box in boxes):
            cells.add(cell)
    return 2 * sum(
        tuple(cell[i] + (sign if i == axis else 0) for i in range(3)) not in cells
        for cell in cells
        for axis, sign in product(range(3), (-1, 1))
    )


def old_prisms(boxes):
    return tuple(Prism(((x, y), (u, y), (u, v), (x, v)), z, w) for x, y, z, u, v, w in boxes)


def geo_source(solids, dimensions, cell_size):
    """Same analytic obstruction union as the STL, inside a floor-contact room."""
    w, d, h = dimensions
    lines = [
        'SetFactory("OpenCASCADE");',
        "General.NumThreads = 1;",
        "Mesh.MshFileVersion = 2.2;",
        f"Mesh.MeshSizeMin = {cell_size};",
        f"Mesh.MeshSizeMax = {cell_size};",
        "Mesh.MeshSizeFromPoints = 0;",
        "Mesh.MeshSizeFromCurvature = 0;",
        "Mesh.MeshSizeExtendFromBoundary = 0;",
        "Mesh.Algorithm3D = 1;",
        "Mesh.RandomSeed = 1;",
    ]
    volumes = []
    for i, solid in enumerate(solids):
        points, curves = [], []
        for j, (x, y) in enumerate(solid.footprint):
            tag = f"p{i}_{j}"
            points.append(tag)
            lines.append(f"{tag}=newp; Point({tag})={{{x * w:.12g},{y * d:.12g},{solid.bottom * h:.12g},{cell_size}}};")
        for j, point in enumerate(points):
            tag = f"l{i}_{j}"
            curves.append(tag)
            lines.append(f"{tag}=newl; Line({tag})={{{point},{points[(j + 1) % len(points)]}}};")
        lines.extend(
            (
                f"loop{i}=newll; Curve Loop(loop{i})={{{','.join(curves)}}};",
                f"surface{i}=news; Plane Surface(surface{i})={{loop{i}}};",
                f"piece{i}[]=Extrude{{0,0,{(solid.top - solid.bottom) * h:.12g}}}{{Surface{{surface{i}}};}};",
            )
        )
        volumes.append(f"piece{i}[1]")
    if len(volumes) > 1:
        lines.append(
            f"body[]=BooleanUnion{{Volume{{{volumes[0]}}};Delete;}}{{Volume{{{','.join(volumes[1:])}}};Delete;}};"
        )
    else:
        lines.append(f"body[]={{{volumes[0]}}};")
    margin = max(dimensions) * 0.25
    lines.extend(
        (
            f"room=newv; Box(room)={{{-margin},{-margin},0,{w + 2 * margin},{d + 2 * margin},{h + margin}}};",
            "fluid[]=BooleanDifference{Volume{room};Delete;}{Volume{body[]};Delete;};",
            'Physical Volume("fluid")={fluid[]};',
        )
    )
    return "\n".join(lines)


def tetrahedra_summary(path):
    """Reject inverted/empty meshes and count only volume cells, not boundary faces."""
    source = path.read_text(encoding="utf8")
    nodes = {
        int(line.split()[0]): tuple(map(float, line.split()[1:]))
        for line in source.split("$Nodes\n", 1)[1].split("$EndNodes", 1)[0].splitlines()[1:]
        if line.strip()
    }
    cells = source.split("$Elements\n", 1)[1].split("$EndElements", 1)[0].splitlines()[1:]
    volumes = []
    for line in cells:
        entry = list(map(int, line.split()))
        if not entry or entry[1] != 4:
            continue
        a, b, c, d = [nodes[i] for i in entry[3 + entry[2] :]]
        u, v, w = ([point[i] - a[i] for i in range(3)] for point in (b, c, d))
        volume = sum(u[i] * (v[(i + 1) % 3] * w[(i + 2) % 3] - v[(i + 2) % 3] * w[(i + 1) % 3]) for i in range(3)) / 6
        if not volume > 0:
            raise ValueError(f"Non-positive tetrahedron in {path.name}")
        volumes.append(volume)
    if not volumes:
        raise ValueError(f"No volume tetrahedra in {path.name}")
    return {"tetrahedra": len(volumes), "volume_mm3": math.fsum(volumes), "minimum_cell_volume_mm3": min(volumes)}


def run_mesher(executable, geo):
    msh, log = geo.with_suffix(".msh"), geo.with_suffix(".log")
    # Never accept a leftover QA mesh if the external tool fails to replace it.
    msh.unlink(missing_ok=True)
    startup = None
    if os.name == "nt":
        startup = subprocess.STARTUPINFO()
        startup.dwFlags |= subprocess.STARTF_USESHOWWINDOW
        startup.wShowWindow = 0
    result = subprocess.run(
        [str(executable), str(geo), "-3", "-nopopup", "-nt", "1", "-format", "msh2", "-o", str(msh), "-log", str(log)],
        capture_output=True,
        text=True,
        timeout=90,
        startupinfo=startup,
    )
    if result.returncode or not msh.is_file():
        raise RuntimeError(
            f"Gmsh did not produce {geo.stem}; inspect {log.name}: {result.stdout[-500:]} {result.stderr[-500:]}"
        )
    if "Error   :" in log.read_text(encoding="utf8"):
        raise RuntimeError(f"Gmsh reported an error; inspect {log.name}")
    return tetrahedra_summary(msh)


def mesh_case(executable, directory, stem, solids, dimensions, cell_size):
    geo = directory / f"{stem}.geo"
    geo.write_text(geo_source(solids, dimensions, cell_size), encoding="utf8")
    result = run_mesher(executable, geo)
    levels = sorted({p.bottom for p in solids} | {p.top for p in solids})
    obstruction = sum(
        unary_union([Polygon(s.footprint) for s in solids if s.bottom < (lo + hi) / 2 < s.top]).area * (hi - lo)
        for lo, hi in pairwise(levels)
    ) * math.prod(dimensions)
    w, d, h = dimensions
    margin = max(dimensions) * 0.25
    expected = (w + 2 * margin) * (d + 2 * margin) * (h + margin) - obstruction
    if not math.isclose(result["volume_mm3"], expected, rel_tol=1e-7):
        raise ValueError(f"Fluid volume mismatch in {stem}")
    return result


def verify_stl(executable, directory, profile, dimensions):
    """Mesh the actual exported triangle surface, not just its analytic recipe."""
    mesh = build_cfd_mesh(profile, *dimensions)
    stl = directory / f"{profile}-export.stl"
    stl.write_text(cfd_stl(mesh), encoding="utf8")
    geo = stl.with_suffix(".geo")
    geo.write_text(
        f'Merge "{stl.name}";\nsl=newsl; Surface Loop(sl)={{Surface{{:}}}};\n'
        "v=newv; Volume(v)={sl};\nPhysical Volume(1)={v};\nMesh.MshFileVersion=2.2;",
        encoding="utf8",
    )
    summary = run_mesher(executable, geo)
    signed_volume = 0
    for face in mesh.triangles:
        a, b, c = [mesh.vertices_mm[i] for i in face]
        signed_volume += (
            sum(a[i] * (b[(i + 1) % 3] * c[(i + 2) % 3] - b[(i + 2) % 3] * c[(i + 1) % 3]) for i in range(3)) / 6
        )
    if not math.isclose(summary["volume_mm3"], signed_volume, rel_tol=1e-7):
        raise ValueError(f"Exported STL volume mismatch: {profile}")
    return {"profile": profile, **summary}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--baseline", type=Path, help="Optional v1 QA checkpoint for before/after comparison")
    parser.add_argument("--output-dir", type=Path, required=True)
    parser.add_argument("--gmsh", type=Path)
    parser.add_argument("--verify-stl", action="store_true", help="Also volume-mesh all exported profile STLs")
    parser.add_argument("--cell-size-mm", type=float, default=100)
    parser.add_argument("--representative-limit", type=int, default=100)
    args = parser.parse_args()
    args.output_dir = args.output_dir.resolve()
    args.output_dir.mkdir(parents=True, exist_ok=True)
    if not math.isfinite(args.cell_size_mm) or args.cell_size_mm <= 0:
        parser.error("cell size must be positive mm")
    if args.verify_stl and not args.gmsh:
        parser.error("--verify-stl requires --gmsh")
    baseline = json.loads(args.baseline.read_text(encoding="utf8")) if args.baseline else {"items": [], "profiles": {}}
    before = {item["id"]: item for item in baseline["items"]}
    entries = []
    representatives = {}
    with SessionLocal() as session:
        rows = session.execute(
            select(
                Item.id,
                Item.category_id,
                Item.fixture_kind,
                Item.representation_key,
                Item.width_mm,
                Item.depth_mm,
                Item.height_mm,
            )
        ).all()
        for identifier, category, kind, key, w, d, h in rows:
            spec = cfd_proxy_for(category, kind, key)
            if spec is None:
                continue
            profile = spec["profile"]
            mesh = build_cfd_mesh(profile, w, d, h)
            edges = Counter(tuple(sorted((face[i], face[(i + 1) % 3]))) for face in mesh.triangles for i in range(3))
            if set(edges.values()) != {2}:
                raise ValueError(f"Non-manifold surface for {identifier}")
            old = before.get(identifier)
            previous = old["spec"]["profile"] if old and old["spec"] else None
            entry = dict(
                id=identifier,
                key=key,
                dimensions_mm=[w, d, h],
                before_profile=previous,
                profile=profile,
                triangles=len(mesh.triangles),
                before_triangles=historical_triangles(baseline["profiles"][previous][1]) if previous else None,
            )
            entries.append(entry)
            representatives.setdefault(profile, entry)
    comparisons = []
    if args.gmsh:
        for entry in sorted(representatives.values(), key=lambda e: e["profile"])[: args.representative_limit]:
            profile = entry["profile"]
            new = PROFILES[profile].solids()
            row = dict(profile=profile, cell_size_mm=args.cell_size_mm)
            cases = [("after", new)]
            if entry["before_profile"]:
                cases.insert(0, ("before", old_prisms(baseline["profiles"][entry["before_profile"]][1])))
            for state, solids in cases:
                summary = mesh_case(
                    args.gmsh, args.output_dir, f"{profile}-{state}", solids, entry["dimensions_mm"], args.cell_size_mm
                )
                row[state + "_fluid_tetrahedra"] = summary["tetrahedra"]
                row[state + "_fluid_volume_mm3"] = summary["volume_mm3"]
            comparisons.append(row)
            print(json.dumps(row), flush=True)
    stl_checks = []
    if args.verify_stl:
        for profile in PROFILES:
            dimensions = representatives.get(profile, {}).get("dimensions_mm", (1200, 850, 950))
            stl_checks.append(verify_stl(args.gmsh, args.output_dir, profile, dimensions))
        print(f"Verified volume meshing of all {len(stl_checks)} exported profile STLs", flush=True)
    report = dict(
        geometry_revision=2,
        assets=entries,
        mesh_benchmarks=comparisons,
        exported_stl_checks=stl_checks,
        note="Fixed-setting Gmsh fluid-mesh comparison, not a CFD convergence study or a guarantee for another mesher.",
    )
    (args.output_dir / "audit.json").write_text(json.dumps(report, indent=2), encoding="utf8")
    print(
        f"Audited {len(entries)} catalogue proxies, {len(representatives)} used profiles; "
        f"wrote {args.output_dir / 'audit.json'}",
        flush=True,
    )


if __name__ == "__main__":
    main()
