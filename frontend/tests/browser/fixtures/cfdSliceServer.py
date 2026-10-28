"""Isolated real API/numerics fixture, never imported by production code."""

import json
import socket
import sys
import tempfile
from pathlib import Path
from uuid import UUID

import uvicorn

ROOT = Path(__file__).resolve().parents[4]
sys.path[:0] = [str(ROOT), str(ROOT / "tests")]
from test_cfd_slices import job_case, write_plane  # noqa: E402

from backend.app.openfoam_service import authenticate, create_app  # noqa: E402
from backend.app.supabase_rest import VerifiedUser  # noqa: E402

with tempfile.TemporaryDirectory(prefix="cfd-slice-browser-") as folder:
    app = create_app(Path(folder), start_runner=False)
    user = VerifiedUser(UUID("11111111-1111-4111-8111-111111111111"), "fixture@example.com", True)
    app.dependency_overrides[authenticate] = lambda: user
    a, ar = job_case(app.state.store, str(user.id), speed=10)
    b, br = job_case(app.state.store, str(user.id), speed=12)
    c, cr = job_case(app.state.store, str(user.id), speed=8, coordinate=0.7)
    ga, gar = job_case(app.state.store, str(user.id), speed=20)
    gb, gbr = job_case(app.state.store, str(user.id), speed=21)
    for root, scale, offset in [(gar, 1, 0), (gbr, -2, -5)]:
        for axis in [0, 1, 2]:
            write_plane(
                root / f"postProcessing/slices/100/{'slice' if axis == 2 else f'gradient_{axis}'}.vtk",
                axis,
                1.25,
                linear=True,
                scale=scale,
                offset=offset,
                triangulated=scale < 0,
            )
    for root, speed in [(ar, 10), (br, 12)]:
        for axis in [0, 1, 2]:
            for coordinate in [0.2, 0.5, 0.8]:
                write_plane(
                    root / f"postProcessing/slices/100/plane_{axis}_{coordinate}.vtk",
                    axis,
                    coordinate,
                    speed + coordinate if axis == 0 else speed,
                )

    @app.post("/fixture/progress")
    def progress():
        app.state.store.update(a["id"], "Running", "fixture incremental write")
        write_plane(ar / "postProcessing/slices/100/plane_later.vtk", 2, 0.95, 10)
        (ar / "solver.log").write_text("Time = 101\n")
        return {"ok": True}

    sock = socket.socket()
    sock.bind(("127.0.0.1", 0))
    sock.listen(128)
    print(
        json.dumps(
            {
                "origin": f"http://127.0.0.1:{sock.getsockname()[1]}",
                "baseline": a["id"],
                "option": b["id"],
                "shifted": c["id"],
                "gradientBaseline": ga["id"],
                "gradientOption": gb["id"],
                "project": a["project"],
                "study": a["study"],
            }
        ),
        flush=True,
    )
    uvicorn.Server(uvicorn.Config(app, log_level="error")).run(sockets=[sock])
