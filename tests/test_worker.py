"""Exercise queue and storage failure paths without paid providers or live accounts."""

from unittest.mock import Mock

import pytest

from backend.app import worker
from backend.app.openai_render import RenderProviderError
from backend.app.r2_storage import ObjectMetadata, R2Unavailable
from backend.app.supabase_rest import SupabaseREST
from backend.app.tripo_provider import TripoProviderError


@pytest.fixture
def services(monkeypatch: pytest.MonkeyPatch) -> tuple[Mock, Mock]:
    db, storage = Mock(spec=SupabaseREST), Mock()
    db.rpc.return_value = {"status": "ready"}
    db.select.return_value = []
    storage.get.return_value = (b"source", ObjectMetadata(6, "image/png", None))
    monkeypatch.setattr(worker, "r2_storage", lambda: storage)
    return db, storage


def asset_job() -> dict:
    return {
        "user_id": "owner",
        "asset": {
            "asset_id": "asset",
            "user_id": "owner",
            "original_format": "glb",
            "original_object_key": "users/owner/assets/asset/original/model.glb",
        },
    }


def render_job() -> dict:
    return {
        "user_id": "owner",
        "render": {
            "render_id": "render",
            "user_id": "owner",
            "quality_class": "medium",
            "reference_object_key": "temporary/render-references/reservation/reference",
            "output_object_key": "users/owner/renders/render/output.webp",
        },
    }


@pytest.mark.parametrize(
    "job_type, handler",
    [
        ("process-asset", "_process_asset"),
        ("render", "_process_render"),
        ("ai-3d-asset", "_process_ai_3d_asset"),
    ],
)
def test_claimed_job_dispatches_exactly_once(services, monkeypatch, job_type, handler) -> None:
    db, _ = services
    job = {"job_type": job_type}
    db.rpc.return_value = job
    handle = Mock()
    monkeypatch.setattr(worker, handler, handle)
    assert worker.process_next_job(db)
    handle.assert_called_once_with(job, db)
    assert db.rpc.call_args.args[0] == "claim_commercial_job"


def test_empty_queue_has_no_work(services) -> None:
    db, storage = services
    db.rpc.return_value = None
    assert not worker.process_next_job(db)
    storage.put.assert_not_called()


def test_unexpected_worker_error_does_not_log_secrets(services, monkeypatch, caplog) -> None:
    db, _ = services
    db.rpc.return_value = {"job_type": "render"}
    monkeypatch.setattr(worker, "_process_render", Mock(side_effect=RuntimeError("private-token-do-not-log")))
    assert worker.process_next_job(db)
    assert "private-token-do-not-log" not in caplog.text
    assert "RuntimeError" in caplog.text


@pytest.mark.parametrize("completion", ["ready", "quota_exceeded"])
def test_asset_success_and_quota_rollback(services, monkeypatch, completion) -> None:
    db, storage = services
    db.rpc.return_value = {"status": completion}
    monkeypatch.setattr(
        worker,
        "process_model",
        Mock(
            return_value=(
                b"model",
                b"preview",
                {
                    "triangles": 12,
                    "bounds": {"width_mm": 100},
                },
            )
        ),
    )
    worker._process_asset(asset_job(), db)
    assert storage.put.call_count == 2
    assert db.rpc.call_args.args[1]["p_derived_bytes"] == len(b"modelpreview")
    assert db.rpc.call_args.args[1]["p_status"] == "ready"
    assert storage.delete.call_count == (2 if completion == "quota_exceeded" else 0)


def test_asset_storage_failure_rolls_back_and_records_safe_error(services, monkeypatch) -> None:
    db, storage = services
    monkeypatch.setattr(
        worker,
        "process_model",
        Mock(
            return_value=(
                b"model",
                b"preview",
                {
                    "triangles": 12,
                    "bounds": {},
                },
            )
        ),
    )
    storage.put.side_effect = [None, R2Unavailable("private signed URL")]
    worker._process_asset(asset_job(), db)
    assert storage.delete.call_count == 2
    result = db.rpc.call_args.args[1]
    assert result["p_status"] == "failed"
    assert "private signed URL" not in result["p_error"]


@pytest.mark.parametrize("reference", ["users/other/private.png", "temporary/render-references/../private.png"])
def test_invalid_render_reference_is_never_read_or_deleted(services, reference) -> None:
    db, storage = services
    job = render_job()
    job["render"]["reference_object_key"] = reference
    worker._process_render(job, db)
    storage.get.assert_not_called()
    storage.put.assert_not_called()
    storage.delete.assert_not_called()
    assert db.rpc.call_args.args[1]["p_error"]


def test_render_owner_mismatch_is_rejected_before_storage_access(services) -> None:
    db, storage = services
    job = render_job()
    job["render"]["user_id"] = "other"
    with pytest.raises(ValueError, match="owner"):
        worker._process_render(job, db)
    storage.get.assert_not_called()
    storage.delete.assert_not_called()


@pytest.mark.parametrize("provider_fails", [False, True])
def test_render_always_removes_only_valid_reference(services, monkeypatch, provider_fails) -> None:
    db, storage = services
    provider = Mock(return_value=(b"render", {"quality": "medium"}))
    if provider_fails:
        provider.side_effect = RenderProviderError("Provider unavailable")
    monkeypatch.setattr(worker, "render_reference", provider)
    worker._process_render(render_job(), db)
    storage.delete.assert_called_once_with("temporary/render-references/reservation/reference")
    completion = db.rpc.call_args.args[1]
    assert completion["p_output_bytes"] == (0 if provider_fails else 6)
    assert bool(completion["p_error"]) is provider_fails


@pytest.mark.parametrize("retryable", [False, True])
def test_ai_poll_retries_transient_failure_without_resubmitting(services, monkeypatch, retryable) -> None:
    db, storage = services
    provider = Mock()
    provider.get_task.side_effect = TripoProviderError("Try later", retryable=retryable)
    monkeypatch.setattr(worker, "tripo3d_provider", lambda **kwargs: provider)
    worker._process_ai_3d_asset(
        {
            "user_id": "owner",
            "generation": {
                "generation_id": "generation",
                "asset_id": "asset",
                "user_id": "owner",
                "provider_task_id": "task_abc123",
                "retry_count": 0,
                "reference_inputs": [],
            },
        },
        db,
    )
    provider.create_from_images.assert_not_called()
    storage.put.assert_not_called()
    if retryable:
        assert db.service_request.call_args.args[0] == "commercial_jobs"
        assert db.service_request.call_args.kwargs["body"]["status"] == "queued"
        db.rpc.assert_not_called()
    else:
        assert db.rpc.call_args.args[1]["p_status"] == "failed"


def test_ai_uncertain_submission_never_submits_twice(services, monkeypatch) -> None:
    db, _ = services
    provider = Mock()
    monkeypatch.setattr(worker, "tripo3d_provider", lambda **kwargs: provider)
    worker._process_ai_3d_asset(
        {
            "user_id": "owner",
            "generation": {
                "generation_id": "generation",
                "asset_id": "asset",
                "user_id": "owner",
                "status": "submitting",
                "reference_inputs": [],
            },
        },
        db,
    )
    provider.create_from_images.assert_not_called()
    assert "could not be confirmed" in db.rpc.call_args.args[1]["p_error"]


@pytest.mark.parametrize("storage_fails", [False, True])
def test_deleted_object_cleanup_retries_and_rejects_other_namespaces(services, storage_fails) -> None:
    db, storage = services
    db.select.side_effect = [
        [
            {"asset_id": "asset", "user_id": "owner", "original_object_key": "users/other/private.glb"},
            {"asset_id": "asset", "user_id": "owner", "original_object_key": "users/owner/assets/asset/model.glb"},
        ],
        [],
    ]
    if storage_fails:
        storage.delete.side_effect = R2Unavailable("temporarily unavailable")
    worker.cleanup_deleted_objects(db)
    storage.delete.assert_called_once_with("users/owner/assets/asset/model.glb")
    assert db.service_request.call_count == (0 if storage_fails else 1)
