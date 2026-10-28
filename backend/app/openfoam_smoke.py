"""Trusted runtime acceptance fixture, using the SAME compiler and execution path.

No authentication bypass or HTTP route is exposed for this administrator fixture.
"""

from __future__ import annotations

import json
import shutil
from datetime import UTC, datetime
from pathlib import Path
from uuid import uuid4

from backend.app.climoptix_provider import PreparationOnlyProvider
from backend.app.openfoam_case import Submission, validate_submission
from backend.app.openfoam_runtime import execute
from backend.app.openfoam_telemetry import telemetry
from geometry.climoptix_models import Scenario, Vent


def fixture(cpu: int = 1, turbulence: str = "laminar") -> Submission:
    now = datetime.now(UTC).isoformat()

    def measured(value):
        return {"value": value, "verified": False, "uncertainty_mm": 0, "source_type": "USER_MEASURED"}

    project = {
        "schemaVersion": 1,
        "projectId": "949d7ba0-05f1-4d89-a98f-0654715bcdb7",
        "name": "Worker acceptance",
        "units": "mm",
        "createdAt": now,
        "updatedAt": now,
        "generated": False,
        "floorplan": None,
        "assets": [],
        "assetInstances": [],
        "rooms": [
            {
                "id": "room",
                "name": "Acceptance room",
                "version": 1,
                "vertices": [{"x": 0, "y": 0}, {"x": 2000, "y": 0}, {"x": 2000, "y": 1000}, {"x": 0, "y": 1000}],
                "wall_height": measured(1000),
                "wall_thickness": measured(100),
                "openings": [],
                "obstacles": [],
            }
        ],
    }
    scenario = Scenario(
        id="acceptance",
        name="Runtime acceptance",
        sourceBuildingId=project["projectId"],
        createdAt=now,
        updatedAt=now,
        seed={"floorId": "floor-ground", "roomId": "room"},
        resources={"cpu": cpu, "memoryGb": 4, "wallTimeMinutes": 5, "storageGb": 1, "retentionDays": 1},
        mesh={
            "baseCellMm": 100,
            "minCellMm": 25,
            "maxCellMm": 200,
            "targetCells": 10000,
            "maxCells": 100000,
            "wallCellMm": 100,
            "ventCellMm": 50,
            "jetCellMm": 100,
            "snapToleranceMm": 50,
            "refinements": [
                {
                    "id": "uniform-acceptance",
                    "name": "Uniform acceptance mesh",
                    "shape": "box",
                    "centerMm": [1000, 500, 500],
                    "sizeMm": [3000, 2000, 2000],
                    "cellMm": 50,
                    "level": 1,
                }
            ],
        },
        physics={
            "turbulence": turbulence,
            "numerics": {"maxIterations": 1500, "residualTarget": 1e-4, "writeEveryIterations": 50},
        },
        postProcessing={"z": {"enabled": True, "count": 1}},
        outputs={"probesMm": [(1000, 500, 500)]},
    )
    report = PreparationOnlyProvider().validate_scenario(project, scenario, "a" * 64)
    # Opposed, wall-hosted devices exercise the canonical vent-hole adapter.
    walls = [p for p in report["patches"] if p["kind"] == "wall" and abs(p["normal"][0]) > 0.9]
    scenario.vents = [
        Vent(
            id=f"device-{i}",
            name=f"Device {i}",
            role="supply" if p["normal"][0] < 0 else "extract",
            host={"patchId": p["id"]},
            widthMm=800,
            heightMm=800,
            control="volumeFlow" if p["normal"][0] < 0 else "pressure",
            valueSI=0.005 if p["normal"][0] < 0 else 0,
        )
        for i, p in enumerate(walls)
    ]
    report = PreparationOnlyProvider().validate_scenario(project, scenario, "a" * 64)
    return Submission(
        contractVersion=1,
        dialect="OpenCFD-v2312",
        sourceUnits="mm",
        submissionId=uuid4(),
        operation="run",
        studyId=scenario.id,
        clientRevision="a" * 64,
        sourceHash=report["validation"]["sourceHash"],
        configurationHash=report["validation"]["configurationHash"],
        thermalApplication=None,
        project=project,
        scenario=scenario,
    )


def acceptance(root: Path, cancelled=lambda: False):
    # Runtime acceptance repeats on each startup; no saved flag can enable a
    # different binary or modified compiler without exercising it again.
    if root.exists():
        shutil.rmtree(root)
    root.mkdir(parents=True)
    results = []
    # Two-processor execution must pass the actual deployed runtime too, not
    # merely a local compile or a serial substitute for a parallel request.
    for cpu, turbulence in ((cpu, model) for cpu in (1, 2) for model in ("laminar", "kEpsilon", "kOmegaSST")):
        request = fixture(cpu, turbulence)
        report = validate_submission(request)
        case = root / f"{cpu}-{turbulence}"
        try:
            result = execute(
                case,
                request,
                report,
                lambda phase, message, c=cpu, t=turbulence: print(
                    f"acceptance {c} {t}: {phase}: {message}", flush=True
                ),
                cancelled,
            )
        except Exception:
            # This is a server-owned fixture log; it never receives auth config.
            if (case / "solver.log").exists():
                print((case / "solver.log").read_text(errors="replace")[-6000:], flush=True)
            raise
        if not result["accepted"] or not any(a["kind"] == "vtk" for a in result["artifacts"]):
            print(
                "Acceptance native outputs:",
                [str(p.relative_to(case)) for p in (case / "postProcessing").rglob("*") if p.is_file()][:30],
                flush=True,
            )
            raise ValueError(
                f"Runtime acceptance failed for {cpu} CPU / {turbulence}: "
                f"{result.get('convergence')} {result.get('conservation')}; artifacts={result['artifacts']}"
            )
        measured = telemetry(case)
        if not measured["balance"] or len(measured["probes"]) != 1 or not any(
            sample["velocityMS"] is not None and sample["pressureM2S2"] is not None
            for sample in measured["probes"][0]["samples"]
        ):
            raise ValueError(f"Native probe/flux telemetry acceptance failed for {turbulence}.")
        results.append(
            {
                "cpu": cpu,
                "turbulence": turbulence,
                "mesh": result["mesh"],
                "convergence": result["convergence"],
                "conservation": result["conservation"],
                "telemetry": measured,
            }
        )
    (root / "acceptance.json").write_text(json.dumps(results, indent=2))
    print("OpenFOAM runtime acceptance passed", flush=True)


if __name__ == "__main__":
    import sys

    acceptance(Path(sys.argv[1]))
