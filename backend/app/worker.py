"""Separate queue worker: uv run python -m backend.app.worker."""

from __future__ import annotations

import logging
import os
import socket
import time
from datetime import UTC, datetime, timedelta
from typing import Any

from backend.app.model_processing import ModelProcessingError, process_model
from backend.app.openai_render import RenderProviderError, render_reference
from backend.app.r2_storage import R2Unavailable, r2_storage
from backend.app.supabase_rest import SupabaseREST, SupabaseUnavailable, supabase_rest
from backend.app.tripo_provider import ImageReference, TripoProviderError, tripo3d_provider

logging.basicConfig(level=os.getenv("LOG_LEVEL", "INFO"))
logger = logging.getLogger("freefloorplan3d.commercial_worker")


def _complete_asset(
    db: SupabaseREST,
    user_id: str,
    asset_id: str,
    status: str,
    *,
    derived_key: str | None = None,
    thumbnail_key: str | None = None,
    derived_bytes: int = 0,
    triangles: int = 0,
    bounds: dict[str, float] | None = None,
    error: str | None = None,
) -> dict[str, Any] | None:
    result = db.rpc(
        "finish_asset_processing",
        {
            "p_user_id": user_id,
            "p_asset_id": asset_id,
            "p_status": status,
            "p_derived_key": derived_key,
            "p_thumbnail_key": thumbnail_key,
            "p_derived_bytes": derived_bytes,
            "p_triangles": triangles,
            "p_bounds": bounds or {},
            "p_error": error[:500] if error else None,
        },
    )
    return result if isinstance(result, dict) else None


def _complete_render(
    db: SupabaseREST, user_id: str, render_id: str, output_bytes: int, usage: dict[str, Any] | None, error: str | None
) -> dict[str, Any] | None:
    result = db.rpc(
        "finish_render_job",
        {
            "p_user_id": user_id,
            "p_render_id": render_id,
            "p_output_bytes": output_bytes,
            "p_provider_usage": usage or {},
            "p_error": error[:500] if error else None,
        },
    )
    return result if isinstance(result, dict) else None


def _complete_ai_3d(
    db: SupabaseREST,
    user_id: str,
    generation_id: str,
    *,
    original_bytes: int = 0,
    derived_bytes: int = 0,
    triangles: int = 0,
    bounds: dict[str, float] | None = None,
    provider_usage: dict[str, Any] | None = None,
    error: str | None = None,
) -> dict[str, Any] | None:
    result = db.rpc(
        "finish_ai_3d_generation",
        {
            "p_user_id": user_id,
            "p_generation_id": generation_id,
            "p_status": "failed" if error else "succeeded",
            "p_original_bytes": original_bytes,
            "p_derived_bytes": derived_bytes,
            "p_triangles": triangles,
            "p_bounds": bounds or {},
            "p_provider_usage": provider_usage or {},
            "p_error": error[:500] if error else None,
        },
    )
    return result if isinstance(result, dict) else None


def _patch_ai_generation(db: SupabaseREST, user_id: str, generation_id: str, values: dict[str, Any]) -> None:
    db.service_request(
        "ai_3d_generation_jobs",
        method="PATCH",
        query={"generation_id": f"eq.{generation_id}", "user_id": f"eq.{user_id}"},
        body={**values, "updated_at": datetime.now(UTC).isoformat()},
        prefer="return=minimal",
    )


def _schedule_ai_generation(
    db: SupabaseREST,
    user_id: str,
    generation_id: str,
    *,
    delay_seconds: int = 10,
) -> None:
    db.service_request(
        "commercial_jobs",
        method="PATCH",
        query={"ai_generation_id": f"eq.{generation_id}", "user_id": f"eq.{user_id}", "status": "eq.processing"},
        body={
            "status": "queued",
            "attempts": 0,
            "available_at": (datetime.now(UTC) + timedelta(seconds=delay_seconds)).isoformat(),
            "locked_at": None,
            "locked_by": None,
        },
        prefer="return=minimal",
    )


def _delete_ai_3d_references(storage: Any, user_id: str, references: Any) -> None:
    if not isinstance(references, list):
        return
    prefix = f"temporary/ai-3d-references/{user_id}/"
    for reference in references:
        key = reference.get("object_key") if isinstance(reference, dict) else None
        if isinstance(key, str) and key.startswith(prefix) and ".." not in key.split("/"):
            try:
                storage.delete(key)
            except R2Unavailable:
                logger.warning("A temporary AI 3D reference could not be deleted immediately")


def _process_ai_3d_asset(job: dict[str, Any], db: SupabaseREST) -> None:
    generation = job.get("generation")
    if not isinstance(generation, dict):
        raise ValueError("The queued AI 3D generation record is missing.")
    user_id = str(job.get("user_id", ""))
    generation_id = str(generation.get("generation_id", ""))
    asset_id = str(generation.get("asset_id", ""))
    if not user_id or not generation_id or not asset_id or str(generation.get("user_id")) != user_id:
        raise ValueError("The AI 3D generation owner does not match its queued job.")
    storage = r2_storage()
    references = generation.get("reference_inputs")
    model_key = f"users/{user_id}/assets/{asset_id}/derived/model.glb"
    thumbnail_key = f"users/{user_id}/assets/{asset_id}/derived/thumbnail.png"
    provider_usage: dict[str, Any] = {
        "provider": "tripo",
        "model": str(generation.get("provider_model", "")),
    }
    task_id = generation.get("provider_task_id")
    provider = tripo3d_provider(model=str(generation.get("provider_model") or ""))
    stored_keys: list[str] = []

    def fail(message: str) -> None:
        _delete_ai_3d_references(storage, user_id, references)
        for key in stored_keys:
            try:
                storage.delete(key)
            except R2Unavailable:
                pass
        _complete_ai_3d(db, user_id, generation_id, provider_usage=provider_usage, error=message)

    if not task_id:
        # Persist this state before the external submit. Tripo does not document
        # an idempotency key; after an uncertain crash, fail rather than submit
        # a second potentially billable generation.
        if generation.get("status") == "submitting":
            fail("The Tripo submission outcome could not be confirmed. Start a new generation.")
            return
        _patch_ai_generation(db, user_id, generation_id, {"status": "submitting", "progress": 5})
        if not isinstance(references, list) or not 1 <= len(references) <= 3:
            fail("The saved reference photos are missing. Upload them again.")
            return
        images: list[ImageReference] = []
        reference_prefix = f"temporary/ai-3d-references/{user_id}/"
        try:
            for reference in references:
                if not isinstance(reference, dict):
                    raise ValueError("The saved reference-photo record is invalid.")
                object_key = reference.get("object_key")
                if (
                    not isinstance(object_key, str)
                    or not object_key.startswith(reference_prefix)
                    or ".." in object_key.split("/")
                ):
                    raise ValueError("The reference photo is outside its private owner namespace.")
                image, metadata = storage.get(object_key, max_bytes=10 * 1024 * 1024)
                if metadata.content_type != reference.get("content_type") or len(image) > int(
                    reference.get("expected_byte_size", 0)
                ):
                    raise ValueError("A reference photo does not match its saved upload.")
                images.append(ImageReference(str(reference.get("view", "")), metadata.content_type, image))
            task_id = provider.create_from_images(images)
        except TripoProviderError as error:
            fail(str(error))
            return
        except (R2Unavailable, KeyError, TypeError, ValueError):
            fail("A reference photo could not be retrieved or validated.")
            return
        provider_usage["task_id"] = task_id
        # Save the remote ID before queueing another poll. A worker restart can
        # then query this task instead of creating another model.
        _patch_ai_generation(
            db,
            user_id,
            generation_id,
            {"provider_task_id": task_id, "status": "generating", "progress": 10, "reference_inputs": []},
        )
        _delete_ai_3d_references(storage, user_id, references)
        _schedule_ai_generation(db, user_id, generation_id)
        return

    task_id = str(task_id)
    provider_usage["task_id"] = task_id
    try:
        task = provider.get_task(task_id)
    except TripoProviderError as error:
        retries = int(generation.get("retry_count", 0))
        if error.retryable and retries < 3:
            _patch_ai_generation(
                db,
                user_id,
                generation_id,
                {"retry_count": retries + 1, "status": "generating", "progress": int(generation.get("progress", 10))},
            )
            _schedule_ai_generation(db, user_id, generation_id, delay_seconds=30)
            return
        fail(str(error))
        return

    status = task.get("status")
    if status in {"queued", "running"}:
        remote_progress = task.get("progress", 0)
        remote_progress = max(0, min(100, int(remote_progress))) if isinstance(remote_progress, (int, float)) else 0
        progress = min(94, 10 + round(remote_progress * 0.84))
        _patch_ai_generation(db, user_id, generation_id, {"status": "generating", "progress": progress})
        _schedule_ai_generation(db, user_id, generation_id)
        return
    if status != "success":
        code = task.get("error_code")
        provider_usage["error_code"] = code if isinstance(code, int) else None
        fail("Tripo could not generate a model from these photos. Review the photos and try again.")
        return

    output = task.get("output")
    model_url = output.get("model_url") if isinstance(output, dict) else None
    if not isinstance(model_url, str):
        fail("Tripo completed without providing a model file.")
        return
    credits = task.get("credits_consumed")
    if isinstance(credits, (int, float)) and credits >= 0:
        provider_usage["credits_consumed"] = credits
    _patch_ai_generation(db, user_id, generation_id, {"status": "storing", "progress": 96})
    try:
        source = provider.download_result(model_url)
        if len(source) > 50 * 1024 * 1024:
            raise ModelProcessingError("The generated model is larger than the 50 MB planner limit.")
        derived, thumbnail, info = process_model(source, "glb", None)
        if len(derived) + len(thumbnail) > 50 * 1024 * 1024:
            raise ModelProcessingError("The generated model and preview exceed the 50 MB planner limit.")
        storage.put(model_key, derived, "model/gltf-binary")
        stored_keys.append(model_key)
        storage.put(thumbnail_key, thumbnail, "image/png")
        stored_keys.append(thumbnail_key)
        provider_usage["triangle_count"] = int(info["triangles"])
        result = _complete_ai_3d(
            db,
            user_id,
            generation_id,
            original_bytes=0,
            derived_bytes=len(derived) + len(thumbnail),
            triangles=int(info["triangles"]),
            bounds=info["bounds"],
            provider_usage=provider_usage,
        )
        if isinstance(result, dict) and result.get("status") != "succeeded":
            for key in stored_keys:
                storage.delete(key)
    except TripoProviderError as error:
        fail(str(error))
    except (ModelProcessingError, R2Unavailable) as error:
        message = (
            str(error)
            if isinstance(error, ModelProcessingError)
            else "The generated model could not be saved privately."
        )
        fail(message)


def _process_asset(job: dict[str, Any], db: SupabaseREST) -> None:
    asset = job.get("asset")
    if not isinstance(asset, dict):
        raise ModelProcessingError("The queued asset record is missing.")
    user_id, asset_id = str(job["user_id"]), str(asset["asset_id"])
    if str(asset.get("user_id")) != user_id:
        raise ModelProcessingError("The asset owner does not match the queued owner.")
    storage = r2_storage()
    derived_key: str | None = None
    thumbnail_key: str | None = None
    try:
        db.service_request(
            "asset_definitions",
            method="PATCH",
            query={"asset_id": f"eq.{asset_id}", "user_id": f"eq.{user_id}", "processing_status": "eq.queued"},
            body={"processing_status": "processing"},
            prefer="return=minimal",
        )
        original_key = str(asset["original_object_key"])
        if not original_key.startswith(f"users/{user_id}/assets/{asset_id}/"):
            raise ModelProcessingError("The source object is outside the asset owner namespace.")
        source, _metadata = storage.get(original_key, max_bytes=100 * 1024 * 1024)
        derived, thumbnail, info = process_model(source, str(asset["original_format"]), asset.get("source_unit"))
        derived_key = f"users/{user_id}/assets/{asset_id}/derived/model.glb"
        thumbnail_key = f"users/{user_id}/assets/{asset_id}/derived/thumbnail.png"
        storage.put(derived_key, derived, "model/gltf-binary")
        storage.put(thumbnail_key, thumbnail, "image/png")
        result = _complete_asset(
            db,
            user_id,
            asset_id,
            "ready",
            derived_key=derived_key,
            thumbnail_key=thumbnail_key,
            derived_bytes=len(derived) + len(thumbnail),
            triangles=int(info["triangles"]),
            bounds=info["bounds"],
        )
        if isinstance(result, dict) and result.get("status") == "quota_exceeded":
            storage.delete(derived_key)
            storage.delete(thumbnail_key)
    except Exception as error:
        safe_error = (
            str(error)[:500]
            if isinstance(error, ModelProcessingError)
            else "The model could not be retrieved, processed, or stored."
        )
        for key in (derived_key, thumbnail_key):
            if key:
                try:
                    storage.delete(key)
                except R2Unavailable:
                    pass
        try:
            _complete_asset(db, user_id, asset_id, "failed", error=safe_error)
        except SupabaseUnavailable:
            logger.exception("Unable to record an asset processing failure")


def _process_render(job: dict[str, Any], db: SupabaseREST) -> None:
    render = job.get("render")
    if not isinstance(render, dict):
        raise ValueError("The queued render record is missing.")
    user_id, render_id = str(job["user_id"]), str(render["render_id"])
    output_key = str(render["output_object_key"])
    if not output_key.startswith(f"users/{user_id}/renders/{render_id}/"):
        raise ValueError("The output object is outside the render owner namespace.")
    storage = r2_storage()
    reference_key: str | None = None
    try:
        db.service_request(
            "render_jobs",
            method="PATCH",
            query={"render_id": f"eq.{render_id}", "user_id": f"eq.{user_id}", "status": "eq.queued"},
            body={"status": "processing"},
            prefer="return=minimal",
        )
        reference_key = str(render["reference_object_key"])
        if not reference_key.startswith("temporary/render-references/") or ".." in reference_key.split("/"):
            raise ValueError("The reference object is outside the render owner namespace.")
        reference, metadata = storage.get(reference_key, max_bytes=10 * 1024 * 1024)
        output, usage = render_reference(
            reference, metadata.content_type, str(render["quality_class"]), str(render.get("prompt", ""))
        )
        storage.put(output_key, output, "image/webp")
        completion = _complete_render(db, user_id, render_id, len(output), usage, None)
        if isinstance(completion, dict) and completion.get("status") == "failed":
            storage.delete(output_key)
    except Exception as error:
        safe_error = (
            str(error)
            if isinstance(error, RenderProviderError)
            else "The render could not be retrieved, generated, or stored."
        )
        try:
            _complete_render(db, user_id, render_id, 0, None, safe_error)
        except SupabaseUnavailable:
            logger.exception("Unable to record a render failure and refund its credit")
    finally:
        if reference_key:
            try:
                storage.delete(reference_key)
            except R2Unavailable:
                pass


def process_next_job(db: SupabaseREST | None = None) -> bool:
    db = db or supabase_rest()
    worker_id = f"{socket.gethostname()}-{os.getpid()}"
    job = db.rpc("claim_commercial_job", {"p_worker_id": worker_id})
    if not isinstance(job, dict):
        return False
    try:
        if job.get("job_type") == "process-asset":
            _process_asset(job, db)
        elif job.get("job_type") == "render":
            _process_render(job, db)
        elif job.get("job_type") == "ai-3d-asset":
            _process_ai_3d_asset(job, db)
        else:
            logger.error("Claimed an unsupported commercial job type")
    except Exception:
        # Keep request/provider payloads out of logs; never include bearer URLs or keys.
        logger.exception("Commercial job failed before its result was recorded")
    return True


def cleanup_deleted_objects(db: SupabaseREST) -> None:
    """Retry object deletion after user deletes if R2 was temporarily unavailable."""
    storage = r2_storage()
    deleted_assets = db.select(
        "asset_definitions",
        {
            "select": "asset_id,user_id,original_object_key,derived_object_key,thumbnail_object_key",
            "processing_status": "eq.deleted",
            "objects_deleted_at": "is.null",
            "limit": "25",
        },
    )
    for asset in deleted_assets if isinstance(deleted_assets, list) else []:
        if not isinstance(asset, dict):
            continue
        user_id, asset_id = str(asset.get("user_id", "")), str(asset.get("asset_id", ""))
        prefix = f"users/{user_id}/assets/{asset_id}/"
        keys = [asset.get(field) for field in ("original_object_key", "derived_object_key", "thumbnail_object_key")]
        if (
            not user_id
            or not asset_id
            or any(key is not None and (not isinstance(key, str) or not key.startswith(prefix)) for key in keys)
        ):
            logger.error("A deleted asset has an invalid object namespace; cleanup was skipped")
            continue
        try:
            for key in keys:
                if key:
                    storage.delete(key)
            db.service_request(
                "asset_definitions",
                method="PATCH",
                query={"asset_id": f"eq.{asset_id}", "user_id": f"eq.{user_id}", "processing_status": "eq.deleted"},
                body={"objects_deleted_at": datetime.now(UTC).isoformat()},
                prefer="return=minimal",
            )
        except (R2Unavailable, SupabaseUnavailable):
            logger.warning("Deleted asset object cleanup will be retried")

    failed_renders = db.select(
        "render_jobs",
        {
            "select": "render_id,user_id,output_object_key",
            "status": "eq.failed",
            "output_deleted_at": "is.null",
            "limit": "25",
        },
    )
    for render in failed_renders if isinstance(failed_renders, list) else []:
        if not isinstance(render, dict):
            continue
        user_id, render_id = str(render.get("user_id", "")), str(render.get("render_id", ""))
        key = render.get("output_object_key")
        if (
            not user_id
            or not render_id
            or not isinstance(key, str)
            or not key.startswith(f"users/{user_id}/renders/{render_id}/")
        ):
            logger.error("A failed render has an invalid object namespace; cleanup was skipped")
            continue
        try:
            storage.delete(key)
            db.service_request(
                "render_jobs",
                method="PATCH",
                query={"render_id": f"eq.{render_id}", "user_id": f"eq.{user_id}", "status": "eq.failed"},
                body={"output_deleted_at": datetime.now(UTC).isoformat()},
                prefer="return=minimal",
            )
        except R2Unavailable:
            logger.warning("Failed render output cleanup will be retried")
        except SupabaseUnavailable:
            logger.warning("Failed render cleanup marker will be retried")


def main() -> None:
    if os.getenv("COMMERCIAL_WORKER_ENABLED", "false").lower() != "true":
        raise SystemExit("Set COMMERCIAL_WORKER_ENABLED=true only in the dedicated worker service.")
    db = supabase_rest()
    if not db.database_configured:
        raise SystemExit("Supabase service credentials are required by the commercial worker.")
    next_cleanup = 0.0
    while True:
        try:
            if time.monotonic() >= next_cleanup:
                cleanup_deleted_objects(db)
                next_cleanup = time.monotonic() + 60
            if not process_next_job(db):
                time.sleep(max(1, min(int(os.getenv("COMMERCIAL_WORKER_POLL_SECONDS", "3")), 30)))
        except SupabaseUnavailable:
            logger.exception("Commercial job queue is temporarily unavailable")
            time.sleep(5)


if __name__ == "__main__":
    main()
