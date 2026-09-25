"""Authenticated commercial workspace API; deterministic fit endpoints remain separate."""

from __future__ import annotations

import hashlib
import hmac
import json
import os
import re
import time
from collections.abc import Callable
from datetime import UTC, datetime
from typing import Any, Literal
from urllib.parse import urlparse
from uuid import UUID, uuid4

from fastapi import APIRouter, Header, HTTPException, Request
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import select

from backend.app.r2_storage import R2Unavailable, r2_storage
from backend.app.stripe_gateway import PACK_KEYS, PLAN_KEYS, StripeUnavailable, stripe_gateway
from backend.app.supabase_rest import InvalidAccessToken, SupabaseREST, SupabaseUnavailable, VerifiedUser, supabase_rest
from database.catalog import SessionLocal
from database.models import FurnitureCategoryRecord, FurnitureItemRecord

router = APIRouter(prefix="/commercial", tags=["commercial workspace"])
_SAFE_SQL_ERRORS: dict[str, tuple[int, str]] = {
    "cloud_entitlement_required": (403, "An active paid plan is required for cloud projects."),
    "active_subscription_required": (403, "An active paid plan is required for this feature."),
    "invalid_project_document": (422, "The project is not a supported Floorplan3D project."),
    "project_too_large": (413, "This project exceeds the 8 MB cloud project limit."),
    "project_quota_exceeded": (409, "The project limit for this plan has been reached."),
    "asset_quota_exceeded": (409, "The asset limit for this plan has been reached."),
    "storage_quota_exceeded": (409, "This would exceed the storage allowance for this plan."),
    "render_credit_unavailable": (409, "No rendering credits remain for this quality."),
    "invalid_asset_upload": (422, "The asset upload details are invalid."),
    "invalid_render_reference": (422, "The render reference image is invalid."),
    "render_reference_missing": (409, "The reference upload expired or is incomplete. Upload it again."),
    "upload_reservation_expired": (409, "The upload expired. Start a new upload."),
    "uploaded_file_mismatch": (422, "The uploaded file did not match its reservation."),
    "asset_upload_not_found": (404, "The asset upload could not be found."),
    "project_not_found": (404, "The cloud project could not be found."),
    "unknown_render_pack": (422, "That render credit pack is not available."),
    "asset_already_uploaded": (409, "This local model is already backed up to the cloud."),
    "project_asset_not_ready": (
        409,
        "Wait for every model asset to finish processing, then back up the project again.",
    ),
    "ai_3d_generation_unavailable": (403, "AI 3D generation is not enabled for this account."),
    "ai_3d_quota_exceeded": (409, "No AI 3D generation allowance remains for this billing period."),
    "ai_3d_upload_limit": (
        429,
        "Too many temporary photos are waiting to be used. Wait for the upload links to expire.",
    ),
    "invalid_ai_3d_reference": (422, "Choose one to three supported reference photos."),
    "ai_3d_reference_missing": (409, "A reference photo upload expired or is incomplete. Upload it again."),
    "invalid_ai_3d_request": (422, "Enter a name and positive dimensions in millimetres."),
}


class ProjectSyncBody(BaseModel):
    model_config = ConfigDict(extra="forbid")
    document: dict[str, Any]
    expected_revision: int | None = Field(default=None, ge=1)


class UploadBody(BaseModel):
    model_config = ConfigDict(extra="forbid")
    name: str = Field(min_length=1, max_length=200)
    format: Literal["glb", "stl"]
    content_type: str = Field(min_length=1, max_length=100)
    expected_bytes: int = Field(ge=20, le=100 * 1024 * 1024)
    source_unit: Literal["mm", "cm", "in"] | None = None
    local_asset_key: str | None = Field(default=None, pattern=r"^local-[a-f0-9]{64}$")
    category_id: str = Field(default="custom", pattern=r"^[a-z0-9][a-z0-9-]{0,79}$")
    subcategory: str = Field(default="General", min_length=1, max_length=120)


class RenderReferenceBody(BaseModel):
    model_config = ConfigDict(extra="forbid")
    content_type: Literal["image/png", "image/jpeg", "image/webp"]
    expected_bytes: int = Field(ge=1, le=10 * 1024 * 1024)


class RenderBody(BaseModel):
    model_config = ConfigDict(extra="forbid")
    reservation_id: UUID
    quality: Literal["medium", "high"] = "medium"
    prompt: str = Field(default="", max_length=1000)
    project_id: UUID | None = None
    idempotency_key: str = Field(min_length=8, max_length=200)


class Ai3DReferenceBody(BaseModel):
    model_config = ConfigDict(extra="forbid")
    content_type: Literal["image/png", "image/jpeg", "image/webp"]
    expected_bytes: int = Field(ge=1, le=10 * 1024 * 1024)


class Ai3DReferenceInput(BaseModel):
    model_config = ConfigDict(extra="forbid")
    reservation_id: UUID
    view: Literal["front", "left", "right", "back"]


class Ai3DDimensions(BaseModel):
    model_config = ConfigDict(extra="forbid")
    width: float = Field(gt=0, le=10000, allow_inf_nan=False)
    depth: float = Field(gt=0, le=10000, allow_inf_nan=False)
    height: float = Field(gt=0, le=10000, allow_inf_nan=False)


class Ai3DGenerationBody(BaseModel):
    model_config = ConfigDict(extra="forbid")
    name: str = Field(min_length=1, max_length=200)
    dimensions_mm: Ai3DDimensions
    references: list[Ai3DReferenceInput] = Field(min_length=1, max_length=3)
    idempotency_key: str = Field(min_length=8, max_length=200)
    category_id: str = Field(default="custom", pattern=r"^[a-z0-9][a-z0-9-]{0,79}$")
    subcategory: str = Field(default="General", min_length=1, max_length=120)


class CheckoutBody(BaseModel):
    model_config = ConfigDict(extra="forbid")
    product_key: str = Field(pattern=r"^(starter|pro|studio|medium_(1|10|50|100)|high_(1|10|50|100))$")


def _http_for_supabase(error: SupabaseUnavailable) -> HTTPException:
    if error.code in _SAFE_SQL_ERRORS:
        status, detail = _SAFE_SQL_ERRORS[error.code]
        return HTTPException(status_code=status, detail=detail)
    if error.status_code in (409, 412):
        return HTTPException(
            status_code=409, detail="This update conflicts with current account data. Refresh and try again."
        )
    if error.status_code == 404:
        return HTTPException(status_code=404, detail="The requested commercial record was not found.")
    if error.status_code in (400, 422):
        return HTTPException(status_code=422, detail="The commercial request could not be validated.")
    return HTTPException(status_code=503, detail="Account services are temporarily unavailable.")


def _db_call[Result](function: Callable[[], Result]) -> Result:
    try:
        return function()
    except SupabaseUnavailable as error:
        raise _http_for_supabase(error) from None


def _auth_user(authorization: str | None, db: SupabaseREST) -> VerifiedUser:
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Sign in to continue.")
    try:
        return db.verify_user(authorization[7:].strip())
    except InvalidAccessToken:
        raise HTTPException(status_code=401, detail="Your session expired. Sign in again.") from None
    except PermissionError:
        raise HTTPException(
            status_code=403, detail="Verify your email address before using the paid workspace."
        ) from None
    except SupabaseUnavailable as error:
        raise _http_for_supabase(error) from None


def _require_active_subscription(user: VerifiedUser, db: SupabaseREST) -> dict[str, Any]:
    summary = _db_call(lambda: db.rpc("commercial_summary", {"p_user_id": str(user.id)}))
    if not isinstance(summary, dict) or summary.get("status") not in {"active", "trialing"}:
        raise HTTPException(status_code=403, detail="An active paid plan is required for this feature.")
    return summary


def _ai_3d_available(user: VerifiedUser, db: SupabaseREST) -> tuple[dict[str, Any], bool]:
    quota = _db_call(lambda: db.rpc("ai_3d_generation_quota", {"p_user_id": str(user.id)}))
    if not isinstance(quota, dict):
        raise HTTPException(status_code=503, detail="AI 3D generation availability could not be checked.")
    configured = os.getenv("AI_3D_GENERATION_ENABLED", "false").lower() == "true"
    storage_configured = all(
        os.getenv(key, "").strip()
        for key in ("R2_ACCOUNT_ID", "R2_BUCKET", "R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY")
    )
    enabled = bool(quota.get("enabled")) and configured and storage_configured
    return quota, enabled


def _validate_project(document: dict[str, Any], project_id: UUID) -> tuple[int, str]:
    required = {
        "schemaVersion",
        "projectId",
        "name",
        "units",
        "createdAt",
        "updatedAt",
        "generated",
        "rooms",
        "floorplan",
        "assets",
        "assetInstances",
    }
    if (
        set(document) != required
        or type(document.get("schemaVersion")) is not int
        or document.get("schemaVersion") != 1
        or document.get("units") != "mm"
        or document.get("projectId") != str(project_id)
    ):
        raise HTTPException(status_code=422, detail="The project is not a supported Floorplan3D project.")
    name = document.get("name")
    if not isinstance(name, str) or not name.strip() or len(name) > 200:
        raise HTTPException(status_code=422, detail="Project names must contain 1–200 characters.")
    for field, maximum in (("rooms", 1000), ("assets", 100), ("assetInstances", 1000)):
        value = document.get(field)
        if not isinstance(value, list) or len(value) > maximum:
            raise HTTPException(status_code=422, detail="The project contains too many items or an invalid collection.")

    def inspect(value: Any, depth: int = 0) -> None:
        if depth > 40:
            raise HTTPException(status_code=422, detail="Project nesting exceeds the supported limit.")
        if isinstance(value, dict):
            for key, child in value.items():
                if key in {"__proto__", "prototype", "constructor", "stl_base64", "stl_filename"}:
                    raise HTTPException(status_code=422, detail="The project contains unsupported content.")
                if (
                    isinstance(child, str)
                    and re.search(r"(?:url|uri|path)$", key, re.I)
                    and not re.fullmatch(r"/fixture-(?:symbols|previews)/[\w-]+\.(?:svg|png|jpg|webp)", child)
                ):
                    raise HTTPException(status_code=422, detail="The project contains an external resource reference.")
                inspect(child, depth + 1)
        elif isinstance(value, list):
            for child in value:
                inspect(child, depth + 1)
        elif isinstance(value, float) and not __import__("math").isfinite(value):
            raise HTTPException(status_code=422, detail="The project contains a non-finite number.")
        elif isinstance(value, str) and len(value) > 100_000:
            raise HTTPException(status_code=422, detail="Project text exceeds the supported limit.")

    inspect(document)
    try:
        encoded = json.dumps(document, ensure_ascii=False, allow_nan=False, separators=(",", ":")).encode("utf-8")
    except (TypeError, ValueError):
        raise HTTPException(status_code=422, detail="The project contains unsupported data.") from None
    if len(encoded) > 8 * 1024 * 1024:
        raise HTTPException(status_code=413, detail="This project exceeds the 8 MB cloud project limit.")
    return 1, name.strip()


def _public_app_url(suffix: str) -> str:
    origin = os.getenv("PUBLIC_APP_URL", "").strip().rstrip("/")
    parsed = urlparse(origin)
    local_http = parsed.scheme == "http" and parsed.hostname in {"localhost", "127.0.0.1"}
    if (parsed.scheme != "https" and not local_http) or not parsed.netloc or parsed.username or parsed.password:
        raise HTTPException(status_code=503, detail="The public planner URL is not configured.")
    base_path = os.getenv("PLANNER_BASE_PATH", "/planner").strip().rstrip("/")
    if base_path and not base_path.startswith("/"):
        raise HTTPException(status_code=503, detail="The planner URL configuration is invalid.")
    return f"{origin}{base_path}{suffix}"


def _asset_record(user: VerifiedUser, asset_id: UUID, db: SupabaseREST) -> dict[str, Any]:
    rows = _db_call(
        lambda: db.select(
            "asset_definitions",
            {
                "select": (
                    "asset_id,user_id,name,original_format,content_hash,original_object_key,derived_object_key,"
                    "thumbnail_object_key,original_byte_size,derived_byte_size,triangle_count,computed_bounds_mm,"
                    "declared_dimensions_mm,source_unit,geometry_authority,category_id,category_name,subcategory,"
                    "processing_status,processing_error,"
                    "created_at,updated_at"
                ),
                "asset_id": f"eq.{asset_id}",
                "user_id": f"eq.{user.id}",
                "processing_status": "neq.deleted",
                "limit": "1",
            },
        )
    )
    if not isinstance(rows, list) or not rows:
        raise HTTPException(status_code=404, detail="The requested asset could not be found.")
    return dict(rows[0])


def _resolve_asset_classification(category_id: str, subcategory: str) -> dict[str, str]:
    category_id = category_id.strip()
    subcategory = subcategory.strip()
    if not category_id or not subcategory or len(subcategory) > 120 or any(ord(char) < 32 for char in subcategory):
        raise HTTPException(status_code=422, detail="Choose a valid asset category and subcategory.")
    if category_id == "custom":
        return {"category_id": "custom", "category_name": "Custom", "subcategory": subcategory}
    with SessionLocal() as session:
        category = session.get(FurnitureCategoryRecord, category_id)
        if category is None:
            raise HTTPException(status_code=422, detail="Choose a category from the built-in catalogue or Custom.")
        category_name = category.name
        exists = session.scalar(
            select(FurnitureItemRecord.id).where(
                FurnitureItemRecord.category_id == category_id,
                FurnitureItemRecord.subcategory == subcategory,
                FurnitureItemRecord.active.is_(True),
            ).limit(1)
        )
    if exists is None:
        raise HTTPException(status_code=422, detail="Choose a subcategory from the selected built-in category.")
    return {"category_id": category_id, "category_name": category_name, "subcategory": subcategory}


def _save_asset_classification(
    db: SupabaseREST, user: VerifiedUser, asset_id: str, classification: dict[str, str]
) -> None:
    updated = _db_call(
        lambda: db.service_request(
            "asset_definitions",
            method="PATCH",
            query={"asset_id": f"eq.{asset_id}", "user_id": f"eq.{user.id}", "processing_status": "neq.deleted"},
            body={**classification, "updated_at": datetime.now(UTC).isoformat()},
            prefer="return=representation",
        )
    )
    if not isinstance(updated, list) or not updated:
        raise HTTPException(status_code=503, detail="The private asset category could not be saved.")


@router.get("/catalogue")
def catalogue() -> dict[str, Any]:
    db = supabase_rest()
    plans = _db_call(
        lambda: db.select(
            "commercial_plans",
            {
                "select": (
                    "plan_key,name,monthly_price_pence,storage_limit_bytes,asset_limit,project_limit,"
                    "included_medium,included_high"
                ),
                "active": "eq.true",
                "order": "monthly_price_pence.asc",
            },
        )
    )
    packs = _db_call(
        lambda: db.select(
            "render_credit_packs",
            {
                "select": "pack_key,quality_class,quantity,price_pence",
                "active": "eq.true",
                "order": "price_pence.asc",
            },
        )
    )
    if not isinstance(plans, list) or not isinstance(packs, list):
        raise HTTPException(status_code=503, detail="The product catalogue is temporarily unavailable.")
    return {
        "currency": "GBP",
        "plans": plans,
        "packs": packs,
        "billing_enabled": stripe_gateway().billing_enabled,
        "cloud_enabled": db.database_configured,
        "ai_enabled": bool(os.getenv("OPENAI_API_KEY", "").strip()),
    }


@router.get("/summary")
def summary(authorization: str | None = Header(default=None)) -> dict[str, Any]:
    db = supabase_rest()
    user = _auth_user(authorization, db)
    result = _db_call(lambda: db.rpc("commercial_summary", {"p_user_id": str(user.id)}))
    if not isinstance(result, dict):
        raise HTTPException(status_code=503, detail="Account usage is temporarily unavailable.")
    return result


@router.get("/projects")
def list_cloud_projects(authorization: str | None = Header(default=None)) -> dict[str, Any]:
    db = supabase_rest()
    user = _auth_user(authorization, db)
    rows = _db_call(
        lambda: db.select(
            "cloud_projects",
            {
                "select": "project_id,schema_version,title,revision,byte_size,created_at,updated_at",
                "user_id": f"eq.{user.id}",
                "deleted_at": "is.null",
                "order": "updated_at.desc",
                "limit": "1000",
            },
        )
    )
    return {"projects": rows if isinstance(rows, list) else []}


@router.get("/projects/{project_id}")
def get_cloud_project(project_id: UUID, authorization: str | None = Header(default=None)) -> dict[str, Any]:
    db = supabase_rest()
    user = _auth_user(authorization, db)
    rows = _db_call(
        lambda: db.select(
            "cloud_projects",
            {
                "select": "project_id,schema_version,title,project_json,revision,byte_size,created_at,updated_at",
                "project_id": f"eq.{project_id}",
                "user_id": f"eq.{user.id}",
                "deleted_at": "is.null",
                "limit": "1",
            },
        )
    )
    if not isinstance(rows, list) or not rows:
        raise HTTPException(status_code=404, detail="The cloud project could not be found.")
    return dict(rows[0])


@router.put("/projects/{project_id}")
def save_cloud_project(
    project_id: UUID, payload: ProjectSyncBody, authorization: str | None = Header(default=None)
) -> dict[str, Any]:
    db = supabase_rest()
    user = _auth_user(authorization, db)
    schema_version, title = _validate_project(payload.document, project_id)
    result = _db_call(
        lambda: db.rpc(
            "save_cloud_project",
            {
                "p_user_id": str(user.id),
                "p_project_id": str(project_id),
                "p_schema_version": schema_version,
                "p_title": title,
                "p_project_json": payload.document,
                "p_expected_revision": payload.expected_revision,
            },
        )
    )
    if not isinstance(result, dict):
        raise HTTPException(status_code=503, detail="The project could not be saved to the cloud.")
    if result.get("status") == "conflict":
        raise HTTPException(
            status_code=409,
            detail={
                "code": "revision_conflict",
                "message": "A newer cloud copy exists. Choose which copy to keep.",
                "serverRevision": result.get("revision"),
                "serverProject": result.get("project_json"),
            },
        )
    return result


@router.delete("/projects/{project_id}")
def delete_cloud_project(project_id: UUID, authorization: str | None = Header(default=None)) -> dict[str, str]:
    db = supabase_rest()
    user = _auth_user(authorization, db)
    result = _db_call(
        lambda: db.rpc("delete_cloud_project", {"p_user_id": str(user.id), "p_project_id": str(project_id)})
    )
    if not isinstance(result, dict) or result.get("status") != "deleted":
        raise HTTPException(status_code=404, detail="The cloud project could not be found.")
    return {"status": "deleted"}


@router.get("/assets")
def list_assets(authorization: str | None = Header(default=None)) -> dict[str, Any]:
    db = supabase_rest()
    user = _auth_user(authorization, db)
    rows = _db_call(
        lambda: db.select(
            "asset_definitions",
            {
                "select": (
                    "asset_id,local_asset_key,name,original_format,original_byte_size,derived_byte_size,triangle_count,"
                    "computed_bounds_mm,declared_dimensions_mm,source_unit,geometry_authority,category_id,category_name,subcategory,processing_status,"
                    "processing_error,created_at,updated_at"
                ),
                "user_id": f"eq.{user.id}",
                "processing_status": "neq.deleted",
                "order": "created_at.desc",
                "limit": "1000",
            },
        )
    )
    return {"assets": rows if isinstance(rows, list) else []}


@router.post("/assets/upload")
def reserve_asset_upload(payload: UploadBody, authorization: str | None = Header(default=None)) -> dict[str, Any]:
    db, storage = supabase_rest(), r2_storage()
    user = _auth_user(authorization, db)
    mime_types = {
        "glb": {"model/gltf-binary", "application/octet-stream"},
        "stl": {"model/stl", "application/sla", "application/octet-stream"},
    }
    safe_name = payload.name.strip()
    if (
        payload.content_type not in mime_types[payload.format]
        or (payload.format == "stl" and payload.source_unit is None)
        or (payload.format == "glb" and payload.source_unit is not None)
        or (payload.local_asset_key is not None and payload.format != "glb")
        or not safe_name
        or any(ord(character) < 32 or ord(character) == 127 for character in safe_name)
        or "/" in safe_name
        or "\\" in safe_name
    ):
        raise HTTPException(status_code=422, detail="Choose a supported format and declare the STL source unit.")
    classification = _resolve_asset_classification(payload.category_id, payload.subcategory)
    asset_id, reservation_id = uuid4(), uuid4()
    object_key = f"users/{user.id}/assets/{asset_id}/source.{payload.format}"
    try:
        signed = storage.presign("PUT", object_key, expires_seconds=900, content_type=payload.content_type)
    except (R2Unavailable, ValueError):
        raise HTTPException(status_code=503, detail="Private asset storage is not available.") from None
    reserved = _db_call(
        lambda: db.rpc(
            "reserve_asset_upload",
            {
                "p_user_id": str(user.id),
                "p_asset_id": str(asset_id),
                "p_reservation_id": str(reservation_id),
                "p_name": safe_name,
                "p_format": payload.format,
                "p_content_type": payload.content_type,
                "p_object_key": object_key,
                "p_expected_bytes": payload.expected_bytes,
                "p_source_unit": payload.source_unit,
                "p_local_asset_key": payload.local_asset_key,
            },
        )
    )
    _save_asset_classification(db, user, str(asset_id), classification)
    return {
        **reserved,
        "upload_url": signed,
        "required_headers": {"Content-Type": payload.content_type},
        "expires_in_seconds": 900,
    }


@router.post("/assets/{asset_id}/finalize")
def finalize_asset_upload(asset_id: UUID, authorization: str | None = Header(default=None)) -> dict[str, Any]:
    db, storage = supabase_rest(), r2_storage()
    user = _auth_user(authorization, db)
    asset = _asset_record(user, asset_id, db)
    current_status = asset.get("processing_status")
    if current_status in {"queued", "processing", "ready"}:
        return {"asset_id": str(asset_id), "processing_status": current_status, "idempotent": True}
    if current_status != "uploading":
        raise HTTPException(status_code=409, detail="This asset upload is not awaiting completion.")
    try:
        content, metadata = storage.get(str(asset["original_object_key"]), max_bytes=100 * 1024 * 1024)
    except (R2Unavailable, KeyError):
        raise HTTPException(status_code=422, detail="The uploaded object is missing or too large.") from None
    digest = hashlib.sha256(content).hexdigest()
    result = _db_call(
        lambda: db.rpc(
            "finalize_asset_upload",
            {
                "p_user_id": str(user.id),
                "p_asset_id": str(asset_id),
                "p_actual_bytes": metadata.byte_size,
                "p_content_hash": digest,
            },
        )
    )
    if isinstance(result, dict) and result.get("status") == "rejected":
        raise HTTPException(status_code=422, detail="The uploaded file did not match its reservation.")
    if not isinstance(result, dict):
        raise HTTPException(status_code=503, detail="The uploaded file could not be finalized.")
    return result


@router.get("/assets/{asset_id}/download")
def asset_download(
    asset_id: UUID,
    variant: Literal["source", "model", "thumbnail"] = "model",
    authorization: str | None = Header(default=None),
) -> dict[str, Any]:
    db, storage = supabase_rest(), r2_storage()
    user = _auth_user(authorization, db)
    asset = _asset_record(user, asset_id, db)
    key_field = {"source": "original_object_key", "model": "derived_object_key", "thumbnail": "thumbnail_object_key"}[
        variant
    ]
    key = asset.get(key_field)
    if not key or (variant != "source" and asset.get("processing_status") != "ready"):
        raise HTTPException(status_code=409, detail="This asset is not ready for download.")
    try:
        signed = storage.presign("GET", str(key), expires_seconds=300)
    except (R2Unavailable, ValueError):
        raise HTTPException(status_code=503, detail="Private asset storage is not available.") from None
    return {"url": signed, "expires_in_seconds": 300}


@router.delete("/assets/{asset_id}")
def delete_asset(asset_id: UUID, authorization: str | None = Header(default=None)) -> dict[str, str]:
    db, storage = supabase_rest(), r2_storage()
    user = _auth_user(authorization, db)
    result = _db_call(lambda: db.rpc("soft_delete_asset", {"p_user_id": str(user.id), "p_asset_id": str(asset_id)}))
    if not isinstance(result, dict) or result.get("status") == "not_found":
        raise HTTPException(status_code=404, detail="The requested asset could not be found.")
    if result.get("status") == "in_use":
        raise HTTPException(status_code=409, detail="Remove this model from saved cloud projects before deleting it.")
    if result.get("status") == "processing":
        raise HTTPException(status_code=409, detail="Wait for model processing to finish before deleting this asset.")
    if result.get("status") == "uploading":
        raise HTTPException(
            status_code=409,
            detail="This upload link is still active. Try deleting the asset after the 15-minute upload link expires.",
        )
    keys = result.get("object_keys", [])
    for key in keys:
        if not isinstance(key, str) or not key:
            continue
        try:
            storage.delete(key)
        except R2Unavailable:
            continue
    return {"status": "deleted"}


@router.get("/assets/local/{local_asset_key}/download")
def download_local_project_asset(
    local_asset_key: str, authorization: str | None = Header(default=None)
) -> dict[str, Any]:
    if not re.fullmatch(r"local-[a-f0-9]{64}", local_asset_key):
        raise HTTPException(status_code=404, detail="The project model could not be found.")
    db, storage = supabase_rest(), r2_storage()
    user = _auth_user(authorization, db)
    rows = _db_call(
        lambda: db.select(
            "asset_definitions",
            {
                "select": "derived_object_key,name",
                "user_id": f"eq.{user.id}",
                "local_asset_key": f"eq.{local_asset_key}",
                "processing_status": "eq.ready",
                "limit": "1",
            },
        )
    )
    if not isinstance(rows, list) or not rows or not rows[0].get("derived_object_key"):
        raise HTTPException(status_code=404, detail="The project model is not available in the cloud yet.")
    try:
        signed = storage.presign("GET", str(rows[0]["derived_object_key"]), expires_seconds=300)
    except (R2Unavailable, ValueError):
        raise HTTPException(status_code=503, detail="Private asset storage is not available.") from None
    return {"url": signed, "name": rows[0].get("name"), "expires_in_seconds": 300}


_AI_3D_JOB_SELECT = (
    "generation_id,asset_id,asset_name,declared_dimensions_mm,status,progress,"
    "safe_error,created_at,updated_at,completed_at"
)
_R2_STORAGE_ENV = ("R2_ACCOUNT_ID", "R2_BUCKET", "R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY")


def _ai_3d_job_view(row: dict[str, Any], classification: dict[str, str] | None = None) -> dict[str, Any]:
    fields = (
        "generation_id",
        "asset_id",
        "asset_name",
        "declared_dimensions_mm",
        "status",
        "progress",
        "safe_error",
        "created_at",
        "updated_at",
        "completed_at",
    )
    return {**{key: row.get(key) for key in fields}, **(classification or {})}


def _asset_classifications_for_user(
    db: SupabaseREST, user: VerifiedUser, asset_ids: list[str]
) -> dict[str, dict[str, str]]:
    ids = sorted({asset_id for asset_id in asset_ids if re.fullmatch(r"[0-9a-fA-F-]{36}", asset_id)})
    if not ids:
        return {}
    rows = _db_call(
        lambda: db.select(
            "asset_definitions",
            {
                "select": "asset_id,category_id,category_name,subcategory",
                "user_id": f"eq.{user.id}",
                "asset_id": f"in.({','.join(ids)})",
                "processing_status": "neq.deleted",
                "limit": str(len(ids)),
            },
        )
    )
    if not isinstance(rows, list):
        return {}
    return {
        str(row["asset_id"]): {
            "category_id": str(row.get("category_id") or "custom"),
            "category_name": str(row.get("category_name") or "Custom"),
            "subcategory": str(row.get("subcategory") or "General"),
        }
        for row in rows if isinstance(row, dict) and row.get("asset_id")
    }


@router.get("/ai-3d/status")
def ai_3d_status(authorization: str | None = Header(default=None)) -> dict[str, Any]:
    db = supabase_rest()
    user = _auth_user(authorization, db)
    quota, enabled = _ai_3d_available(user, db)
    reason = None
    if os.getenv("AI_3D_GENERATION_ENABLED", "false").lower() != "true":
        reason = "AI 3D generation is not enabled on the server yet."
    elif not all(os.getenv(key, "").strip() for key in _R2_STORAGE_ENV):
        reason = "Private model storage is not configured."
    elif not quota.get("enabled"):
        reason = "AI 3D generation is not enabled for this account yet."
    return {"enabled": enabled, "remaining": max(0, int(quota.get("remaining", 0))), "reason": reason}


@router.post("/ai-3d/references/upload")
def reserve_ai_3d_reference(
    payload: Ai3DReferenceBody, authorization: str | None = Header(default=None)
) -> dict[str, Any]:
    db, storage = supabase_rest(), r2_storage()
    user = _auth_user(authorization, db)
    _quota, enabled = _ai_3d_available(user, db)
    if not enabled:
        raise HTTPException(status_code=403, detail="AI 3D generation is not enabled for this account yet.")
    reservation_id = uuid4()
    object_key = f"temporary/ai-3d-references/{user.id}/{reservation_id}/reference"
    reserved = _db_call(
        lambda: db.rpc(
            "reserve_ai_3d_reference",
            {
                "p_user_id": str(user.id),
                "p_reservation_id": str(reservation_id),
                "p_object_key": object_key,
                "p_content_type": payload.content_type,
                "p_expected_bytes": payload.expected_bytes,
            },
        )
    )
    try:
        signed = storage.presign("PUT", object_key, expires_seconds=900, content_type=payload.content_type)
    except (R2Unavailable, ValueError):
        raise HTTPException(status_code=503, detail="Private asset storage is not available.") from None
    return {
        **(reserved if isinstance(reserved, dict) else {}),
        "upload_url": signed,
        "required_headers": {"Content-Type": payload.content_type},
        "expires_in_seconds": 900,
    }


@router.post("/ai-3d/jobs")
def create_ai_3d_job(
    payload: Ai3DGenerationBody, authorization: str | None = Header(default=None)
) -> dict[str, Any]:
    db, storage = supabase_rest(), r2_storage()
    user = _auth_user(authorization, db)
    classification = _resolve_asset_classification(payload.category_id, payload.subcategory)
    prior = _db_call(
        lambda: db.select(
            "ai_3d_generation_jobs",
            {
                "select": _AI_3D_JOB_SELECT,
                "user_id": f"eq.{user.id}",
                "idempotency_key": f"eq.{payload.idempotency_key}",
                "limit": "1",
            },
        )
    )
    if isinstance(prior, list) and prior:
        prior_job = dict(prior[0])
        _save_asset_classification(db, user, str(prior_job["asset_id"]), classification)
        return {"status": "existing", "generation": _ai_3d_job_view(prior_job, classification)}
    _quota, enabled = _ai_3d_available(user, db)
    if not enabled:
        raise HTTPException(status_code=403, detail="AI 3D generation is not enabled for this account yet.")
    views = [reference.view for reference in payload.references]
    if len(set(views)) != len(views) or "front" not in views or (len(views) == 1 and views[0] != "front"):
        raise HTTPException(status_code=422, detail="Use one front photo, or assign a front view plus distinct angles.")
    safe_name = payload.name.strip()
    if (
        not safe_name
        or any(ord(character) < 32 or ord(character) == 127 for character in safe_name)
        or "/" in safe_name
        or "\\" in safe_name
    ):
        raise HTTPException(status_code=422, detail="Enter a valid asset name.")
    resolved: list[dict[str, Any]] = []
    for reference in payload.references:
        rows = _db_call(
            lambda reference=reference: db.select(
                "upload_reservations",
                {"select": "object_key,content_type,expected_byte_size,status,expires_at",
                 "reservation_id": f"eq.{reference.reservation_id}", "user_id": f"eq.{user.id}",
                 "purpose": "eq.ai-3d-reference", "status": "eq.reserved", "limit": "1"},
            )
        )
        if not isinstance(rows, list) or not rows:
            raise HTTPException(status_code=409, detail="A reference photo upload expired. Upload the photos again.")
        row = rows[0]
        try:
            metadata = storage.head(str(row["object_key"]))
        except (R2Unavailable, KeyError):
            raise HTTPException(status_code=409, detail="A reference photo upload is incomplete.") from None
        expected = int(row["expected_byte_size"])
        if (
            metadata.byte_size < 1
            or metadata.byte_size > 10 * 1024 * 1024
            or metadata.byte_size > expected
            or metadata.content_type != row["content_type"]
        ):
            raise HTTPException(status_code=422, detail="A reference photo does not match its upload reservation.")
        resolved.append({"reservation_id": str(reference.reservation_id), "view": reference.view})
    model = os.getenv("TRIPO_GENERATION_MODEL", "v3.1-20260211").strip()
    if not re.fullmatch(r"[A-Za-z0-9._-]{1,100}", model):
        raise HTTPException(status_code=503, detail="The Tripo model setting is invalid.")
    generation_id, asset_id = uuid4(), uuid4()
    result = _db_call(
        lambda: db.rpc(
            "create_ai_3d_generation_job",
            {
                "p_user_id": str(user.id),
                "p_generation_id": str(generation_id),
                "p_asset_id": str(asset_id),
                "p_asset_name": safe_name,
                "p_dimensions_mm": payload.dimensions_mm.model_dump(),
                "p_references": resolved,
                "p_idempotency_key": payload.idempotency_key,
                "p_provider_model": model,
            },
        )
    )
    if not isinstance(result, dict) or not isinstance(result.get("generation"), dict):
        raise HTTPException(status_code=503, detail="The AI 3D generation could not be queued.")
    _save_asset_classification(db, user, str(asset_id), classification)
    return {
        "status": result.get("status", "created"),
        "generation": _ai_3d_job_view(result["generation"], classification),
    }


@router.get("/ai-3d/jobs")
def list_ai_3d_jobs(authorization: str | None = Header(default=None)) -> dict[str, Any]:
    db = supabase_rest()
    user = _auth_user(authorization, db)
    rows = _db_call(
        lambda: db.select(
            "ai_3d_generation_jobs",
            {
                "select": _AI_3D_JOB_SELECT,
                "user_id": f"eq.{user.id}",
                "order": "created_at.desc",
                "limit": "20",
            },
        )
    )
    job_rows = [dict(row) for row in rows if isinstance(row, dict)] if isinstance(rows, list) else []
    classifications = _asset_classifications_for_user(db, user, [str(row.get("asset_id", "")) for row in job_rows])
    jobs = [_ai_3d_job_view(row, classifications.get(str(row.get("asset_id", "")))) for row in job_rows]
    return {"jobs": jobs}


@router.get("/ai-3d/jobs/{generation_id}")
def get_ai_3d_job(generation_id: UUID, authorization: str | None = Header(default=None)) -> dict[str, Any]:
    db = supabase_rest()
    user = _auth_user(authorization, db)
    rows = _db_call(
        lambda: db.select(
            "ai_3d_generation_jobs",
            {
                "select": _AI_3D_JOB_SELECT,
                "generation_id": f"eq.{generation_id}",
                "user_id": f"eq.{user.id}",
                "limit": "1",
            },
        )
    )
    if not isinstance(rows, list) or not rows:
        raise HTTPException(status_code=404, detail="The AI 3D generation job could not be found.")
    job = dict(rows[0])
    asset_id = str(job.get("asset_id", ""))
    classification = _asset_classifications_for_user(db, user, [asset_id]).get(asset_id)
    return _ai_3d_job_view(job, classification)


@router.post("/render-references/upload")
def reserve_render_reference(
    payload: RenderReferenceBody, authorization: str | None = Header(default=None)
) -> dict[str, Any]:
    db, storage = supabase_rest(), r2_storage()
    user = _auth_user(authorization, db)
    _require_active_subscription(user, db)
    reservation_id = uuid4()
    # Keep short-lived source images in a dedicated lifecycle-manageable prefix;
    # they are removed by the worker after rendering or by the bucket TTL.
    object_key = f"temporary/render-references/{reservation_id}/reference"
    try:
        signed = storage.presign("PUT", object_key, expires_seconds=900, content_type=payload.content_type)
    except (R2Unavailable, ValueError):
        raise HTTPException(status_code=503, detail="Private asset storage is not available.") from None
    reserved = _db_call(
        lambda: db.rpc(
            "reserve_render_reference",
            {
                "p_user_id": str(user.id),
                "p_reservation_id": str(reservation_id),
                "p_object_key": object_key,
                "p_content_type": payload.content_type,
                "p_expected_bytes": payload.expected_bytes,
            },
        )
    )
    return {
        **reserved,
        "upload_url": signed,
        "required_headers": {"Content-Type": payload.content_type},
        "expires_in_seconds": 900,
    }


@router.post("/renders")
def create_render(payload: RenderBody, authorization: str | None = Header(default=None)) -> dict[str, Any]:
    db, storage = supabase_rest(), r2_storage()
    user = _auth_user(authorization, db)
    _require_active_subscription(user, db)
    prior = _db_call(
        lambda: db.select(
            "render_jobs",
            {
                "select": "render_id,project_id,quality_class,status,created_at,completed_at",
                "user_id": f"eq.{user.id}",
                "idempotency_key": f"eq.{payload.idempotency_key}",
                "limit": "1",
            },
        )
    )
    if isinstance(prior, list) and prior:
        return {"status": "existing", "render": prior[0]}
    rows = _db_call(
        lambda: db.select(
            "upload_reservations",
            {
                "select": "object_key,content_type,expected_byte_size,status,expires_at",
                "reservation_id": f"eq.{payload.reservation_id}",
                "user_id": f"eq.{user.id}",
                "purpose": "eq.render-reference",
                "status": "eq.reserved",
                "limit": "1",
            },
        )
    )
    if not isinstance(rows, list) or not rows:
        raise HTTPException(status_code=409, detail="The reference upload expired. Upload it again.")
    try:
        metadata = storage.head(str(rows[0]["object_key"]))
    except (R2Unavailable, KeyError):
        raise HTTPException(status_code=409, detail="The reference image upload is incomplete.") from None
    if (
        metadata.byte_size < 1
        or metadata.byte_size > 10 * 1024 * 1024
        or metadata.content_type != rows[0]["content_type"]
        or metadata.byte_size > int(rows[0]["expected_byte_size"])
    ):
        raise HTTPException(status_code=422, detail="The reference image does not match its upload reservation.")
    render_id = uuid4()
    model = "gpt-image-2.5-flare" if payload.quality == "medium" else "gpt-image-2.5-sunburst"
    result = _db_call(
        lambda: db.rpc(
            "create_render_job",
            {
                "p_user_id": str(user.id),
                "p_render_id": str(render_id),
                "p_project_id": str(payload.project_id) if payload.project_id else None,
                "p_reservation_id": str(payload.reservation_id),
                "p_quality": payload.quality,
                "p_prompt": payload.prompt.strip(),
                "p_idempotency_key": payload.idempotency_key,
                "p_provider_model": model,
                "p_size": "1024x1024",
            },
        )
    )
    if not isinstance(result, dict):
        raise HTTPException(status_code=503, detail="The render could not be queued.")
    return result


@router.get("/renders")
def list_renders(authorization: str | None = Header(default=None)) -> dict[str, Any]:
    db = supabase_rest()
    user = _auth_user(authorization, db)
    rows = _db_call(
        lambda: db.select(
            "render_jobs",
            {
                "select": (
                    "render_id,project_id,quality_class,provider_model,requested_size,prompt,status,safe_error,"
                    "created_at,completed_at,output_byte_size"
                ),
                "user_id": f"eq.{user.id}",
                "order": "created_at.desc",
                "limit": "100",
            },
        )
    )
    return {"renders": rows if isinstance(rows, list) else []}


@router.get("/renders/{render_id}")
def get_render(render_id: UUID, authorization: str | None = Header(default=None)) -> dict[str, Any]:
    db = supabase_rest()
    user = _auth_user(authorization, db)
    rows = _db_call(
        lambda: db.select(
            "render_jobs",
            {
                "select": (
                    "render_id,project_id,quality_class,provider_model,requested_size,prompt,status,safe_error,"
                    "created_at,completed_at,output_byte_size,output_object_key"
                ),
                "render_id": f"eq.{render_id}",
                "user_id": f"eq.{user.id}",
                "limit": "1",
            },
        )
    )
    if not isinstance(rows, list) or not rows:
        raise HTTPException(status_code=404, detail="The render could not be found.")
    row = dict(rows[0])
    key = row.pop("output_object_key", None)
    if row.get("status") == "succeeded" and key:
        try:
            row["image_url"] = r2_storage().presign("GET", str(key), expires_seconds=300)
        except (R2Unavailable, ValueError):
            raise HTTPException(status_code=503, detail="Private render storage is temporarily unavailable.") from None
    return row


@router.post("/billing/checkout")
def create_checkout(
    payload: CheckoutBody,
    authorization: str | None = Header(default=None),
    idempotency_key: str | None = Header(default=None),
) -> dict[str, str]:
    db, stripe = supabase_rest(), stripe_gateway()
    user = _auth_user(authorization, db)
    if idempotency_key is not None and not re.fullmatch(r"[A-Za-z0-9._:-]{1,200}", idempotency_key):
        raise HTTPException(status_code=422, detail="The checkout idempotency key is invalid.")
    key = payload.product_key
    if key in PACK_KEYS:
        _require_active_subscription(user, db)
        product_rows = _db_call(
            lambda: db.select(
                "render_credit_packs",
                {"select": "price_pence", "pack_key": f"eq.{key}", "active": "eq.true", "limit": "1"},
            )
        )
        mode, metadata = "payment", {"credit_pack_key": key}
    elif key in PLAN_KEYS:
        state = _db_call(lambda: db.rpc("commercial_summary", {"p_user_id": str(user.id)}))
        if isinstance(state, dict) and state.get("status") in {"active", "trialing"}:
            raise HTTPException(status_code=409, detail="Manage an active subscription through the billing portal.")
        product_rows = _db_call(
            lambda: db.select(
                "commercial_plans",
                {"select": "monthly_price_pence", "plan_key": f"eq.{key}", "active": "eq.true", "limit": "1"},
            )
        )
        mode, metadata = "subscription", {"plan_key": key}
    else:
        raise HTTPException(status_code=422, detail="Choose an available plan or credit pack.")
    if (
        not isinstance(product_rows, list)
        or not product_rows
        or not isinstance(product_rows[0], dict)
        or type(product_rows[0].get("price_pence", product_rows[0].get("monthly_price_pence"))) is not int
    ):
        raise HTTPException(status_code=503, detail="The selected product is not available for checkout.")
    expected_price_value = product_rows[0].get("price_pence", product_rows[0].get("monthly_price_pence"))
    if type(expected_price_value) is not int:
        raise HTTPException(status_code=503, detail="The selected product is not available for checkout.")
    expected_price = expected_price_value
    try:
        session = stripe.create_checkout(
            price_key=key,
            mode=mode,
            expected_price_pence=expected_price,
            user_id=str(user.id),
            email=user.email,
            success_url=_public_app_url("/billing/?checkout=success"),
            cancel_url=_public_app_url("/billing/?checkout=cancelled"),
            metadata=metadata,
            idempotency_key=idempotency_key or f"checkout-{user.id}-{key}-{uuid4()}",
        )
    except StripeUnavailable as error:
        raise HTTPException(status_code=503, detail=str(error)) from None
    url = session.get("url")
    if not isinstance(url, str) or not url.startswith("https://checkout.stripe.com/"):
        raise HTTPException(status_code=502, detail="Stripe did not return a valid checkout link.")
    return {"url": url}


@router.post("/billing/portal")
def create_billing_portal(authorization: str | None = Header(default=None)) -> dict[str, str]:
    db, stripe = supabase_rest(), stripe_gateway()
    user = _auth_user(authorization, db)
    rows = _db_call(
        lambda: db.select(
            "commercial_subscriptions", {"select": "stripe_customer_id", "user_id": f"eq.{user.id}", "limit": "1"}
        )
    )
    customer = rows[0].get("stripe_customer_id") if isinstance(rows, list) and rows else None
    if not isinstance(customer, str) or not customer.startswith("cus_"):
        raise HTTPException(status_code=404, detail="No billing customer is linked to this account yet.")
    try:
        session = stripe.create_portal(customer, _public_app_url("/billing/"))
    except StripeUnavailable as error:
        raise HTTPException(status_code=503, detail=str(error)) from None
    url = session.get("url")
    if not isinstance(url, str) or not url.startswith("https://billing.stripe.com/"):
        raise HTTPException(status_code=502, detail="Stripe did not return a valid billing portal link.")
    return {"url": url}


def _stripe_signature_valid(header: str | None, body: bytes, secret: str, now: int | None = None) -> bool:
    if not header or not secret or len(body) > 1_000_000:
        return False
    values: dict[str, list[str]] = {}
    for item in header.split(","):
        key, separator, value = item.strip().partition("=")
        if separator:
            values.setdefault(key, []).append(value)
    try:
        timestamp = int(values.get("t", [""])[0])
    except ValueError:
        return False
    current = int(time.time()) if now is None else now
    if abs(current - timestamp) > 300:
        return False
    digest = hmac.new(secret.encode("utf-8"), f"{timestamp}.".encode("ascii") + body, hashlib.sha256).hexdigest()
    return any(hmac.compare_digest(digest, signature) for signature in values.get("v1", []))


def _stripe_epoch(value: Any) -> str | None:
    if not isinstance(value, (int, float)) or value <= 0:
        return None
    try:
        return datetime.fromtimestamp(value, UTC).isoformat()
    except (OverflowError, OSError, ValueError):
        return None


def _event_subscription_id(invoice: dict[str, Any]) -> str | None:
    direct = invoice.get("subscription")
    if isinstance(direct, str):
        return direct
    parent = invoice.get("parent")
    details = parent.get("subscription_details") if isinstance(parent, dict) else None
    value = details.get("subscription") if isinstance(details, dict) else None
    return value if isinstance(value, str) else None


@router.post("/stripe/webhook")
async def stripe_webhook(
    request: Request, stripe_signature: str | None = Header(default=None, alias="Stripe-Signature")
) -> dict[str, str]:
    stripe = stripe_gateway()
    if not stripe.configured or not stripe.webhook_secret:
        raise HTTPException(status_code=503, detail="Billing webhooks are not configured.")
    body = await request.body()
    if not _stripe_signature_valid(stripe_signature, body, stripe.webhook_secret):
        raise HTTPException(status_code=400, detail="Invalid Stripe webhook signature.")
    try:
        event_value = json.loads(body)
    except json.JSONDecodeError:
        raise HTTPException(status_code=400, detail="Invalid Stripe event payload.") from None
    if not isinstance(event_value, dict):
        raise HTTPException(status_code=400, detail="Invalid Stripe event payload.")
    event_id, event_type, event_created = event_value.get("id"), event_value.get("type"), event_value.get("created")
    event_data = event_value.get("data")
    event_object = event_data.get("object") if isinstance(event_data, dict) else None
    if (
        not isinstance(event_id, str)
        or not re.fullmatch(r"evt_[A-Za-z0-9]+", event_id)
        or not isinstance(event_type, str)
        or type(event_created) is not int
        or not isinstance(event_object, dict)
    ):
        raise HTTPException(status_code=400, detail="Invalid Stripe event payload.")
    obj: dict[str, Any] = event_object
    supported = {
        "checkout.session.completed",
        "checkout.session.async_payment_succeeded",
        "customer.subscription.created",
        "customer.subscription.updated",
        "customer.subscription.deleted",
        "invoice.paid",
        "invoice.payment_failed",
    }
    if event_type not in supported:
        return {"status": "ignored"}
    metadata_value = obj.get("metadata")
    metadata: dict[str, Any] = metadata_value if isinstance(metadata_value, dict) else {}
    user_id = metadata.get("user_id") or obj.get("client_reference_id")
    subscription_id = (
        obj.get("id")
        if event_type.startswith("customer.subscription.")
        else _event_subscription_id(obj)
        if event_type.startswith("invoice.")
        else obj.get("subscription")
    )
    customer = obj.get("customer")
    customer_id = customer if isinstance(customer, str) else customer.get("id") if isinstance(customer, dict) else None
    plan_key, status = metadata.get("plan_key"), obj.get("status")
    period_start, period_end = obj.get("current_period_start"), obj.get("current_period_end")
    cancel_at_period_end = bool(obj.get("cancel_at_period_end", False))
    invoice_id = obj.get("id") if event_type.startswith("invoice.") else None
    invoice_period_start = invoice_period_end = None
    pack_key = metadata.get("credit_pack_key") if event_type.startswith("checkout.session.") else None
    checkout_id = obj.get("id") if event_type.startswith("checkout.session.") else None

    if event_type.startswith("customer.subscription."):
        if status == "incomplete_expired" or event_type.endswith("deleted"):
            status = "canceled"
        if plan_key not in PLAN_KEYS:
            plan_key = None
    if event_type.startswith("checkout.session."):
        if obj.get("mode") == "payment":
            if event_type == "checkout.session.completed" and obj.get("payment_status") != "paid":
                return {"status": "awaiting_payment"}
            if pack_key not in PACK_KEYS:
                return {"status": "ignored"}
        else:
            return {"status": "awaiting_subscription_event"}
    if event_type.startswith("invoice."):
        lines = obj.get("lines", {}).get("data", []) if isinstance(obj.get("lines"), dict) else []
        if isinstance(lines, list) and lines and isinstance(lines[0], dict):
            period = lines[0].get("period", {})
            if isinstance(period, dict):
                invoice_period_start, invoice_period_end = (
                    _stripe_epoch(period.get("start")),
                    _stripe_epoch(period.get("end")),
                )
        if subscription_id:
            try:
                subscription = stripe.get_subscription(str(subscription_id))
            except StripeUnavailable:
                raise HTTPException(
                    status_code=503, detail="Stripe subscription details could not be retrieved."
                ) from None
            sub_metadata_value = subscription.get("metadata")
            sub_metadata: dict[str, Any] = sub_metadata_value if isinstance(sub_metadata_value, dict) else {}
            user_id = user_id or sub_metadata.get("user_id")
            plan_key, status = sub_metadata.get("plan_key"), subscription.get("status")
            period_start, period_end = subscription.get("current_period_start"), subscription.get("current_period_end")
            cancel_at_period_end = bool(subscription.get("cancel_at_period_end", False))
            sub_customer = subscription.get("customer")
            customer_id = sub_customer if isinstance(sub_customer, str) else customer_id
    try:
        parsed_user_id = str(UUID(str(user_id))) if user_id else None
    except ValueError:
        raise HTTPException(status_code=400, detail="Billing event account metadata is invalid.") from None
    normalized_status = (
        status if status in {"incomplete", "trialing", "active", "past_due", "unpaid", "canceled", "paused"} else None
    )
    if plan_key not in PLAN_KEYS:
        plan_key = None
    db = supabase_rest()
    result = _db_call(
        lambda: db.rpc(
            "apply_stripe_event",
            {
                "p_event_id": event_id,
                "p_event_type": event_type,
                "p_user_id": parsed_user_id,
                "p_customer_id": customer_id,
                "p_subscription_id": subscription_id,
                "p_plan_key": plan_key,
                "p_subscription_status": normalized_status,
                "p_period_start": _stripe_epoch(period_start),
                "p_period_end": _stripe_epoch(period_end),
                "p_cancel_at_period_end": cancel_at_period_end,
                "p_invoice_id": invoice_id,
                "p_credit_pack_key": pack_key,
                "p_checkout_id": checkout_id,
                "p_event_created": event_created,
                "p_invoice_period_start": invoice_period_start,
                "p_invoice_period_end": invoice_period_end,
            },
        )
    )
    return {"status": result.get("status", "processed") if isinstance(result, dict) else "processed"}
