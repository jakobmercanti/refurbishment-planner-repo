"""Physical, access-control and incremental publication acceptance tests."""

import json
import os
import time
from pathlib import Path
from uuid import uuid4
from zipfile import ZipFile

import numpy as np
import pytest
from fastapi.testclient import TestClient

from backend.app.cfd_slice_data import Field, Plane, difference, grid_coordinates, read_plane, scalar, statistics
from backend.app.cfd_slice_service import SliceRequest, incompatibilities, inventory, slice_data, view_root
from backend.app.openfoam_service import Store, authenticate, create_app
from backend.app.openfoam_smoke import fixture
from backend.app.supabase_rest import VerifiedUser


def write_plane(
    path,
    axis=2,
    coordinate=0.5,
    speed=10,
    linear=False,
    reverse=False,
    hole=False,
    temperature=False,
    scale=1,
    offset=0,
    triangulated=False,
):
    points = [[0, 0], [1, 0], [1, 1], [0, 1]] if not hole else [[0, 0], [1, 0], [1, 0.5], [0.5, 0.5], [0.5, 1], [0, 1]]
    axes = [i for i in range(3) if i != axis]
    xyz = np.full((len(points), 3), coordinate)
    xyz[:, axes] = points
    values = (xyz[:, 0] + 2 * xyz[:, 1] + 3 * xyz[:, 2] if linear else np.full(len(points), speed)) * scale + offset
    text = "# vtk DataFile Version 3.0\nactual numeric fixture\nASCII\nDATASET POLYDATA\n"
    text += f"POINTS {len(points)} double\n" + " ".join(map(str, xyz.ravel()))
    polygons = [[0, 1, 2], [0, 2, 3]] if triangulated else [list(range(len(points)))]
    text += f"\nPOLYGONS {len(polygons)} {sum(len(p) + 1 for p in polygons)}\n"
    text += "\n".join(f"{len(p)} " + " ".join(map(str, p)) for p in polygons)
    text += f"\nPOINT_DATA {len(points)}\nFIELD attributes 3\nU 3 {len(points)} double\n"
    text += " ".join(f"{(-1 if reverse else 1) * v} 0 0" for v in values)
    text += f"\np 1 {len(points)} double\n" + " ".join(map(str, values))
    text += (
        f"\n{'T' if temperature else 'q'} 1 {len(points)} double\n"
        + " ".join(str(300 + speed) if temperature else "nan" for _ in points)
        + "\n"
    )
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(text)
    return path


def job_case(store, owner, *, speed=10, phase="Completed", axis=2, coordinate=0.5, hole=False, temperature=False):
    request = fixture()
    request.submissionId = uuid4()
    request.scenario.name = f"Run {speed}"
    row = store.submit(owner, request)
    store.update(row["id"], phase, "fixture native output")
    root = store.path(row["id"])
    write_plane(
        root / "postProcessing/slices/100/slice.vtk", axis, coordinate, speed, hole=hole, temperature=temperature
    )
    (root / "manifest.json").write_text(json.dumps({"fieldUnits": {"T": "K"}}))
    return store.get(owner, row["id"]), root


def request_for(store, owner, a, b=None, **kwargs):
    am = inventory(store.path(a["id"]), a)
    bm = inventory(store.path(b["id"]), b) if b else None
    return SliceRequest(
        projectId=a["project"],
        baseline={"runId": a["id"], "assetId": am["planes"][0]["id"]},
        option={"runId": b["id"], "assetId": bm["planes"][0]["id"]} if b else None,
        field="U",
        **kwargs,
    )


@pytest.mark.parametrize("axis", [0, 1, 2])
def test_three_physical_axis_frames_and_barycentric_linear_interpolation(tmp_path, axis):
    p = read_plane(write_plane(tmp_path / "plane.vtk", axis, 1.25, linear=True))
    assert p.axis == axis
    uv = grid_coordinates(p.bounds, axis, 1.25, 32)
    np.testing.assert_allclose(p.sample(uv, "p")[:, 0], uv[:, 0] + 2 * uv[:, 1] + 3 * uv[:, 2], atol=1e-12)
    assert np.isnan(p.sample(np.array([[50, 50, 50.0]]), "U")).all()
    assert np.isnan(p.sample(uv, "q")).all()


def test_common_grid_different_tessellations_holes_and_area_statistics():
    points = np.array([[0.0, 0, 0], [2, 0, 0], [2, 1, 0], [1, 1, 0], [1, 2, 0], [0, 2, 0]])
    f = Field((points[:, 0] + 2 * points[:, 1])[:, None], False)
    coarse = Plane(points, [[0, 1, 2, 3, 4, 5]], {"q": f})
    fine = Plane(points, [[0, 1, 3], [1, 2, 3], [0, 3, 5], [3, 4, 5]], {"q": f})
    grid = grid_coordinates(coarse.bounds, 2, 0, 64)
    a, b = coarse.sample(grid, "q")[:, 0], fine.sample(grid, "q")[:, 0]
    np.testing.assert_allclose(a, b, atol=1e-12)
    assert np.isnan(a).sum() == 1024  # Concave empty quadrant, no convex-hull fill.
    delta = b - a
    stats = statistics(delta, 4)
    assert stats["coverage"] == 0.75 and stats["commonAreaM2"] == 3
    assert abs(stats["mean"]) < 1e-12


def test_signed_speed_vector_and_percent_semantics():
    a, b = np.array([10.0, 0, 1e-10]), np.array([12.0, 2, 3])
    np.testing.assert_array_equal(difference(a, b, "absolute", 1e-6), [2, 2, 3 - 1e-10])
    np.testing.assert_array_equal(difference(b, a, "absolute", 1e-6), [-2, -2, 1e-10 - 3])
    result = difference(a, b, "percent", 1e-6)
    assert result[0] == 20 and np.isnan(result[1:]).all()
    av, bv = np.array([[2.0, 0, 0]]), np.array([[-2.0, 0, 0]])
    assert difference(scalar(av, -1), scalar(bv, -1), "absolute", 1e-6)[0] == 0
    assert difference(scalar(av, -1), scalar(bv, -1), "vector", 1e-6, av, bv)[0] == 4


@pytest.mark.parametrize("axis", [0, 1, 2])
@pytest.mark.parametrize("component,mode", [(0, "absolute"), (0, "percent"), (-1, "absolute"), (-1, "vector")])
def test_nonuniform_different_mesh_rasters_and_picked_deltas_match_analytic_fields(tmp_path, axis, component, mode):
    store, owner = Store(tmp_path), str(uuid4())
    a, ar = job_case(store, owner)
    b, br = job_case(store, owner)
    for root, scale, offset in [(ar, 1, 0), (br, -2, -5)]:
        write_plane(
            root / "postProcessing/slices/100/slice.vtk",
            axis,
            1.25,
            linear=True,
            scale=scale,
            offset=offset,
            triangulated=scale < 0,
        )
    req = request_for(store, owner, a, b, size=32, component=component, deltaMode=mode)
    result = slice_data(store, owner, req)
    assert result["compatibility"] == []
    points = grid_coordinates([0, 0, 1, 1], axis, 1.25, 32)
    expected_a = points @ np.array([1, 2, 3])
    expected_b = -2 * expected_a - 5
    if component == -1:
        expected_b = -expected_b
    expected_delta = expected_b - expected_a
    if mode == "percent":
        expected_delta = 100 * expected_delta / expected_a
    elif mode == "vector":
        expected_delta = 3 * expected_a + 5
    np.testing.assert_allclose(result["a"], expected_a, rtol=1e-12)
    np.testing.assert_allclose(result["b"], expected_b, rtol=1e-12)
    np.testing.assert_allclose(result["delta"], expected_delta, rtol=1e-12)
    assert result["statistics"]["mean"] == pytest.approx(expected_delta.mean())
    assert result["statistics"]["rms"] == pytest.approx(np.sqrt(np.mean(expected_delta**2)))
    assert result["statistics"]["coverage"] == 1
    for index in (0, 173, len(points) - 1):
        req.point = tuple(points[index])
        probe = slice_data(store, owner, req)["probe"]
        assert probe["baseline"]["value"] == pytest.approx(expected_a[index])
        assert probe["option"]["value"] == pytest.approx(expected_b[index])
        assert probe["delta"] == pytest.approx(expected_delta[index])


def test_retained_runs_comparison_swap_temperature_and_exact_probe(tmp_path):
    store, owner = Store(tmp_path), str(uuid4())
    a, _ = job_case(store, owner, speed=10, temperature=True)
    b, _ = job_case(store, owner, speed=12, temperature=True)
    req = request_for(store, owner, a, b, size=96)
    result = slice_data(store, owner, req)
    assert set(result["delta"]) == {2} and result["statistics"]["coverage"] == 1
    assert result["range"] == [10, 12]
    empty_run, _ = job_case(store, owner, speed=14)
    missing = request_for(store, owner, empty_run, size=16).model_copy(update={"field": "q"})
    empty = slice_data(store, owner, missing)
    assert empty["range"] is None and set(empty["a"]) == {None}
    reverse = slice_data(store, owner, request_for(store, owner, b, a, size=32))
    assert set(reverse["delta"]) == {-2}
    assert result["key"] != reverse["key"]
    req.point = (0.25, 0.25, 0.5)
    probe = slice_data(store, owner, req)["probe"]
    assert probe["delta"] == 2 and probe["baseline"]["velocity"] == [10, 0, 0]
    req.point = (2, 2, 0.5)
    assert slice_data(store, owner, req)["probe"]["delta"] is None
    req.point = None
    req.field = "T"
    req.temperature = "C"
    c = slice_data(store, owner, req)
    assert c["a"][0] == pytest.approx(36.85) and c["delta"][0] == 2 and c["deltaUnit"] == "K"
    req.deltaMode = "percent"
    assert slice_data(store, owner, req)["delta"][0] == pytest.approx(200 / 310)
    req.point = (0.25, 0.25, 0.5)
    assert slice_data(store, owner, req)["probe"]["delta"] == pytest.approx(200 / 310)


def test_mismatched_planes_masked_geometry_and_reference_semantics(tmp_path):
    store, owner = Store(tmp_path), str(uuid4())
    a, _ = job_case(store, owner)
    b, _ = job_case(store, owner, speed=12, coordinate=0.75)
    result = slice_data(store, owner, request_for(store, owner, a, b, size=16))
    assert any("matching physical" in reason for reason in result["compatibility"])
    assert set(result["delta"]) == {None} and set(result["b"]) == {12}
    am, bm = inventory(store.path(a["id"]), a), inventory(store.path(b["id"]), b)
    bm["frame"] = "rotated unknown vector frame"
    assert any("frames differ" in r for r in incompatibilities(am, am["planes"][0], bm, bm["planes"][0], "U"))
    bm["pressureReference"] = "changed gauge anchor"
    assert any("pressure references" in r for r in incompatibilities(am, am["planes"][0], bm, bm["planes"][0], "p"))
    c, _ = job_case(store, owner, speed=12, hole=True)
    result = slice_data(store, owner, request_for(store, owner, a, c, size=32))
    assert result["statistics"]["coverage"] == 0.75


def test_progressive_writes_only_publish_closed_complete_planes_and_keep_history(tmp_path):
    store, owner = Store(tmp_path), str(uuid4())
    row, root = job_case(store, owner, phase="Running")
    assert inventory(root, row)["planes"] == []
    (root / "solver.log").write_text("Time = 101\n")
    first = inventory(root, row)
    assert len(first["planes"]) == 1
    path = write_plane(root / "postProcessing/slices/120/another.vtk")
    assert inventory(root, row)["pending"] == 1
    (root / "solver.log").write_text("Time = 121\n")
    ready = inventory(root, row)
    assert len(ready["planes"]) == 2 and len({p["id"] for p in ready["planes"]}) == 2
    assert ready["planes"][0]["id"] == first["planes"][0]["id"]
    path.write_text(path.read_text()[:-8])
    assert inventory(root, row)["pending"] == 1
    store.update(row["id"], "Failed", "native failure")
    assert inventory(root, store.get(owner, row["id"]))["planes"][0]["id"] == first["planes"][0]["id"]


def test_percent_label_option_coordinates_and_incompatible_axes_are_truthful(tmp_path):
    store, owner = Store(tmp_path), str(uuid4())
    a, _ = job_case(store, owner)
    b, _ = job_case(store, owner, speed=12, coordinate=0.75)
    result = slice_data(store, owner, request_for(store, owner, a, b, size=16, deltaMode="percent"))
    assert result["definition"] == "100 × (Option − Baseline) / |Baseline|"
    assert result["option"]["coordinate"] == 0.75 and result["option"]["axis"] == "Z"
    c, _ = job_case(store, owner, speed=12, axis=0)
    result = slice_data(store, owner, request_for(store, owner, a, c, size=16))
    assert result["b"] is None and set(result["delta"]) == {None}
    req = request_for(store, owner, a, c, point=(0.5, 0.5, 0.5))
    assert slice_data(store, owner, req)["probe"]["option"] is None


def test_unit_mismatch_never_relabels_option_temperature_or_samples_its_values(tmp_path):
    store, owner = Store(tmp_path), str(uuid4())
    a, _ = job_case(store, owner, temperature=True)
    b, root = job_case(store, owner, speed=12, temperature=True)
    (root / "manifest.json").write_text(json.dumps({"fieldUnits": {"T": "degF"}}))
    req = request_for(store, owner, a, b, temperature="C", size=16)
    req.field = "T"
    result = slice_data(store, owner, req)
    assert result["unit"] == "°C" and result["b"] is None
    assert any("units/components" in reason for reason in result["compatibility"])
    req.point = (0.25, 0.25, 0.5)
    assert slice_data(store, owner, req)["probe"]["option"] is None


def test_snapshot_cache_retains_only_indexed_iterations_without_removing_native_data(tmp_path):
    store, owner = Store(tmp_path), str(uuid4())
    row, root = job_case(store, owner)
    first = inventory(root, row)["planes"][0]
    for iteration in range(101, 114):
        write_plane(root / f"postProcessing/slices/{iteration}/slice.vtk", speed=iteration)
        current = inventory(root, row)
    assert len(current["planes"]) == 10
    assert len(json.loads((view_root(root) / "slice-index.json").read_text())) == 10
    assert len(list((view_root(root) / "snapshots").glob("*.vtk"))) == 10
    assert len(list((root / "postProcessing/slices").glob("*/*.vtk"))) == 14
    assert first["id"] not in {p["id"] for p in current["planes"]}
    (view_root(root) / "slice-index.json").write_text("[]")
    assert len(inventory(root, row)["planes"]) == 10  # damaged index rebuilds
    next((view_root(root) / "snapshots").glob("*.vtk")).unlink()
    assert len(inventory(root, row)["planes"]) == 10  # missing copy rebuilds
    index_path = view_root(root) / "slice-index.json"
    index = json.loads(index_path.read_text())
    index[next(iter(index))]["meta"]["axis"] = "corrupt"
    index_path.write_text(json.dumps(index))
    assert {p["axis"] for p in inventory(root, row)["planes"]} == {"Z"}


@pytest.mark.parametrize(
    "field,value", [("size", "96"), ("component", False), ("epsilon", True), ("point", [True, 0.5, 0.5])]
)
def test_sampling_contract_rejects_text_and_boolean_numeric_parameters(tmp_path, field, value):
    from pydantic import ValidationError

    store, owner = Store(tmp_path), str(uuid4())
    row, _ = job_case(store, owner)
    body = request_for(store, owner, row).model_dump(mode="json")
    with pytest.raises(ValidationError):
        SliceRequest.model_validate({**body, field: value})


def test_slice_api_owner_project_expiry_integrity_and_payload_limits(tmp_path):
    app = create_app(tmp_path, start_runner=False)
    owner = VerifiedUser(uuid4(), "allowed@example.com", True)
    app.dependency_overrides[authenticate] = lambda: owner
    row, root = job_case(app.state.store, str(owner.id))
    with TestClient(app) as client:
        endpoint = f"/climoptix/worker/jobs/{row['id']}/slices?projectId={row['project']}"
        assert client.get(endpoint).status_code == 200
        assert client.get(endpoint.replace(row["project"], str(uuid4()))).status_code == 404
        req = request_for(app.state.store, str(owner.id), row, size=16)
        result = client.post("/climoptix/worker/slice-data", json=req.model_dump(mode="json"))
        assert result.status_code == 200 and result.headers["cache-control"] == "no-store"
        req.size = 513
        assert client.post("/climoptix/worker/slice-data", json=req.model_dump(mode="json")).status_code == 422
        app.dependency_overrides[authenticate] = lambda: VerifiedUser(uuid4(), "other@example.com", True)
        assert client.get(endpoint).status_code == 404
        app.dependency_overrides[authenticate] = lambda: owner
        assert not (root / "slice-index.json").exists() and not (root / "slice-snapshots").exists()
        snapshot = next((view_root(root) / "snapshots").glob("*.vtk"))
        snapshot.write_text("tampered")
        req.size = 16
        assert client.post("/climoptix/worker/slice-data", json=req.model_dump(mode="json")).status_code == 422
        with app.state.store.connect() as db:
            db.execute("UPDATE jobs SET expires=? WHERE id=?", (time.time() - 10, row["id"]))
        assert client.get(endpoint).status_code == 410


@pytest.mark.parametrize("size", [256, 512])
def test_representative_raster_performance_and_memory_bounds(tmp_path, size):
    p = read_plane(write_plane(tmp_path / "grid.vtk"))
    start = time.monotonic()
    result = p.sample(grid_coordinates(p.bounds, 2, 0.5, size), "U")
    assert result.shape == (size * size, 3) and np.isfinite(result).all()
    assert time.monotonic() - start < 10


def test_retained_real_native_planes_when_archive_is_supplied(tmp_path):
    archive = os.environ.get("CFD_NATIVE_ARCHIVE")
    if not archive:
        pytest.skip("Set CFD_NATIVE_ARCHIVE to audit a retained real solve without running OpenFOAM.")
    with ZipFile(Path(archive)) as case:
        planes = [
            i
            for i in case.infolist()
            if i.filename.startswith("postProcessing/slices/")
            and i.filename.endswith(".vtk")
            and i.file_size <= 25 * 1024**2
        ]
        assert planes, "Retained native case has no sampled numeric plane"
        for i, entry in enumerate(planes[-20:]):
            path = tmp_path / f"native-{i}.vtk"
            path.write_bytes(case.read(entry))
            plane = read_plane(path)
            assert "U" in plane.fields and "p" in plane.fields
            data = plane.sample(grid_coordinates(plane.bounds, plane.axis, plane.coordinate, 32), "U")
            assert np.isfinite(data).any()
