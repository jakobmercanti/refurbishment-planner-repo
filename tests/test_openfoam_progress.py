import json
import pytest

from backend.app.openfoam_progress import phase_progress, write_phase_progress


def test_phase_steps_are_scoped_and_never_predicted(tmp_path):
    request = json.dumps({"operation": "run"})
    write_phase_progress(tmp_path, "Meshing", 1, 3)
    value = phase_progress(tmp_path, "Meshing", "", request)
    assert value["progress"] == pytest.approx(100 / 3)
    assert value["progressBasis"] == "steps"
    assert phase_progress(tmp_path, "Postprocess", "", request)["progress"] is None
    assert phase_progress(tmp_path, "Completed", "", request)["progress"] == 100
    assert phase_progress(tmp_path, "Failed", "", request)["progress"] is None


def test_running_percentage_is_explicitly_an_iteration_budget(tmp_path):
    payload = json.dumps({"operation": "run", "scenario": {"physics": {"numerics": {"maxIterations": 100}}}})
    (tmp_path / "solver.log").write_text("Time = 10\nTime = 25\n")
    result = phase_progress(tmp_path, "Running", "", payload)
    assert result["progress"] == 25
    assert result["progressBasis"] == "iterationBudget"
    (tmp_path / "solver.log").write_text("Time = 1e999\n")
    assert phase_progress(tmp_path, "Running", "", payload)["progress"] is None
    (tmp_path / "phase-progress.json").write_text('{"phase":"Postprocess","progress":999}')
    assert phase_progress(tmp_path, "Postprocess", "", payload)["progress"] is None


def test_group_visibility_is_not_a_solver_setting_or_hash_input():
    from backend.app.openfoam_smoke import fixture
    from backend.app.climoptix_provider import PreparationOnlyProvider

    request = fixture()
    provider = PreparationOnlyProvider()
    original = provider.validate_scenario(request.project, request.scenario, request.clientRevision)
    request.scenario.boundaries.hideDefaultGroup = True
    hidden = provider.validate_scenario(request.project, request.scenario, request.clientRevision)
    assert hidden["validation"]["configurationHash"] == original["validation"]["configurationHash"]
    assert "hideDefaultGroup" not in request.scenario.model_dump()["boundaries"]


def test_postprocessing_archive_keeps_native_data_and_honours_cancellation(tmp_path):
    import hashlib
    import time
    from zipfile import ZipFile
    from backend.app.openfoam_runtime import JobCancelled, postprocessing_artifact

    data = tmp_path / "postProcessing" / "probes" / "0" / "U"
    data.parent.mkdir(parents=True)
    data.write_bytes(b"native velocity samples")
    steps = []
    artifact = postprocessing_artifact(tmp_path, [data], time.monotonic() + 10, lambda: False, steps.append)
    assert artifact["id"] == "postprocessing"
    assert artifact["sha256"] == hashlib.sha256((tmp_path / artifact["path"]).read_bytes()).hexdigest()
    with ZipFile(tmp_path / artifact["path"]) as archive:
        assert archive.read("postProcessing/probes/0/U") == b"native velocity samples"
    assert steps == [1]
    with pytest.raises(JobCancelled):
        postprocessing_artifact(tmp_path, [data], time.monotonic() + 10, lambda: True)
    with pytest.raises(TimeoutError):
        postprocessing_artifact(tmp_path, [data], time.monotonic() - 1, lambda: False)
