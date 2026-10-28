"""Public CFD allowance is owner-scoped, durable and charged on accepted runs only."""

from concurrent.futures import ThreadPoolExecutor
from uuid import uuid4

import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient

from backend.app.openfoam_service import Store, authenticate, create_app
from backend.app.openfoam_smoke import fixture
from backend.app.supabase_rest import VerifiedUser


def complete(store, owner, *, phase="Completed", operation="run"):
    request = fixture()
    request.operation = operation
    row = store.submit(owner, request)
    store.update(row["id"], phase, "Native acceptance result")
    return request, row


def test_five_completed_runs_reject_sixth_but_not_idempotent_retry_or_mesh(tmp_path):
    store, owner = Store(tmp_path), str(uuid4())
    for _ in range(5):
        request, row = complete(store, owner)
    assert store.quota(owner) == {"tier": "free", "period": "lifetime", "limit": 5, "completed": 5, "remaining": 0}
    assert store.submit(owner, request)["id"] == row["id"]
    store.update(row["id"], "Completed", "Repeated completion is not a new charge")
    assert store.quota(owner)["completed"] == 5
    with pytest.raises(HTTPException) as failure:
        store.submit(owner, fixture())
    assert failure.value.status_code == 429 and "five completed" in failure.value.detail
    complete(store, owner, operation="mesh")
    assert store.quota(owner)["completed"] == 5
    assert store.submit(str(uuid4()), fixture())["phase"] == "Queued"


def test_failed_cancelled_mesh_and_expiry_do_not_reset_or_spend_allowance(tmp_path):
    store, owner = Store(tmp_path), str(uuid4())
    for phase, operation in (("Failed", "run"), ("Cancelled", "run"), ("Completed", "mesh")):
        complete(store, owner, phase=phase, operation=operation)
    assert store.quota(owner)["completed"] == 0
    request, row = complete(store, owner)
    with store.connect() as db:
        db.execute("UPDATE jobs SET expires=0")
    store.cleanup()
    restarted = Store(tmp_path)
    assert restarted.quota(owner)["completed"] == 1
    assert restarted.submit(owner, request)["phase"] == "Stale"
    assert restarted.quota(owner)["completed"] == 1
    assert restarted.get(owner, row["id"])["payload"] == ""


def test_quota_is_shared_across_projects_and_final_slot_is_atomic(tmp_path):
    store, owner = Store(tmp_path), str(uuid4())
    for _ in range(4):
        complete(store, owner)
    requests = [fixture(), fixture()]
    # Both immutable submissions use different projects; neither creates a new allowance.
    for request in requests:
        project = str(uuid4())
        request.project["projectId"] = project
        request.scenario.sourceBuildingId = project
        from backend.app.climoptix_provider import PreparationOnlyProvider
        report = PreparationOnlyProvider().validate_scenario(request.project, request.scenario, request.clientRevision)
        request.sourceHash = report["validation"]["sourceHash"]
        request.configurationHash = report["validation"]["configurationHash"]

    def submit(request):
        try:
            return store.submit(owner, request)
        except HTTPException as error:
            return error.status_code

    with ThreadPoolExecutor(max_workers=2) as executor:
        results = list(executor.map(submit, requests))
    assert sum(not isinstance(result, int) for result in results) == 1
    assert 409 in results
    accepted = next(result for result in results if not isinstance(result, int))
    store.update(accepted["id"], "Completed", "Accepted final run")
    assert store.quota(owner)["remaining"] == 0
    with pytest.raises(HTTPException) as error:
        store.submit(owner, fixture())
    assert error.value.status_code == 429


def test_upgrade_backfills_retained_completed_runs_once(tmp_path):
    store, owner = Store(tmp_path), str(uuid4())
    complete(store, owner)
    complete(store, owner, phase="Failed")
    complete(store, owner, operation="mesh")
    with store.connect() as db:
        # Emulate the old schema before quota accounting was installed.
        db.execute("DROP TABLE simulation_completions")
    assert Store(tmp_path).quota(owner)["completed"] == 1
    assert Store(tmp_path).quota(owner)["completed"] == 1


def test_exhausted_user_keeps_capabilities_and_owned_results_but_cannot_run(tmp_path):
    app = create_app(tmp_path, start_runner=False)
    owner = VerifiedUser(uuid4(), "public@example.com", True)
    app.dependency_overrides[authenticate] = lambda: owner
    app.state.worker.update(ready=True, reason="Native runtime ready")
    for _ in range(5):
        _, row = complete(app.state.store, str(owner.id))
    with TestClient(app) as client:
        response = client.get("/climoptix/worker/capabilities")
        assert response.status_code == 200
        caps = response.json()
        assert caps["connected"] and caps["mesh"] and not caps["run"]
        assert caps["namespace"] == str(owner.id) and caps["simulationQuota"]["remaining"] == 0
        assert client.get(f"/climoptix/worker/jobs/{row['id']}").status_code == 200
        assert client.post("/climoptix/worker/jobs", json=fixture().model_dump(mode="json")).status_code == 429
        app.dependency_overrides[authenticate] = lambda: VerifiedUser(uuid4(), "other@example.com", True)
        assert client.get("/climoptix/worker/capabilities").json()["simulationQuota"]["completed"] == 0
        assert client.get(f"/climoptix/worker/jobs/{row['id']}").status_code == 404
