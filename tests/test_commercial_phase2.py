import hashlib
import hmac
import io
from types import SimpleNamespace
from typing import Any
from uuid import uuid4

import pytest
from fastapi import HTTPException
from PIL import Image

from backend.app import commercial_api
from backend.app.commercial_api import _save_asset_classification, _stripe_signature_valid, _validate_project
from backend.app.model_processing import process_model
from backend.app.openai_render import RenderProviderError, render_reference
from backend.app.stripe_gateway import StripeGateway, StripeUnavailable
from backend.app.supabase_rest import VerifiedUser


def _project_document(project_id: str, schema_version: object = 1) -> dict[str, Any]:
    return {
        "schemaVersion": schema_version,
        "projectId": project_id,
        "name": "  Bathroom  ",
        "units": "mm",
        "createdAt": "2026-09-24T00:00:00Z",
        "updatedAt": "2026-09-24T00:00:00Z",
        "generated": {},
        "rooms": [],
        "floorplan": {},
        "assets": [],
        "assetInstances": [],
    }


def test_custom_asset_category_accepts_a_private_custom_subcategory() -> None:
    assert commercial_api._resolve_asset_classification("custom", "  Workshop furniture  ") == {
        "category_id": "custom",
        "category_name": "Custom",
        "subcategory": "Workshop furniture",
    }


@pytest.mark.parametrize(("plan", "limit"), [("free", 5), ("starter", None), ("pro", None), ("studio", None)])
def test_commercial_summary_exposes_the_plan_electrical_capability(
    monkeypatch: pytest.MonkeyPatch, plan: str, limit: int | None,
) -> None:
    user = VerifiedUser(uuid4(), "owner@example.test", True)

    class FakeDatabase:
        def verify_user(self, _token: str) -> VerifiedUser:
            return user

        def rpc(self, _function: str, _parameters: dict[str, Any]) -> dict[str, Any]:
            return {"plan": plan, "status": "free" if plan == "free" else "active", "capabilities": {"can_use_cloud": plan != "free"}}

        def select(self, table: str, query: dict[str, str]) -> list[dict[str, Any]]:
            assert table == "commercial_plans"
            assert query["plan_key"] == f"eq.{plan}"
            assert query["active"] == "eq.true"
            assert query["select"] == "max_electrical_elements_per_project"
            return [{"max_electrical_elements_per_project": limit}]

    monkeypatch.setattr(commercial_api, "supabase_rest", FakeDatabase)
    result = commercial_api.summary("Bearer test-token")

    assert result["capabilities"] == {
        "can_use_cloud": plan != "free",
        "maxElectricalElementsPerProject": limit,
    }


def test_asset_category_must_exist_in_the_database_taxonomy(monkeypatch: pytest.MonkeyPatch) -> None:
    class FakeSession:
        def __enter__(self) -> "FakeSession":
            return self

        def __exit__(self, *_args: object) -> None:
            return None

        def get(self, _model: object, category_id: str) -> object | None:
            return SimpleNamespace(name="Sofas") if category_id == "living-sofas" else None

        def scalar(self, _statement: object) -> str:
            return "catalogue-subcategory-row"

    monkeypatch.setattr(commercial_api, "SessionLocal", FakeSession)
    assert commercial_api._resolve_asset_classification("living-sofas", "Two seater") == {
        "category_id": "living-sofas",
        "category_name": "Sofas",
        "subcategory": "Two seater",
    }

    with pytest.raises(HTTPException) as error:
        commercial_api._resolve_asset_classification("not-a-catalogue-category", "Two seater")
    assert error.value.status_code == 422


def test_asset_classification_accepts_the_database_category_hierarchy(monkeypatch: pytest.MonkeyPatch) -> None:
    class FakeSession:
        def __enter__(self) -> "FakeSession":
            return self

        def __exit__(self, *_args: object) -> None:
            return None

        def get(self, _model: object, category_id: str) -> object | None:
            return SimpleNamespace(name="Sofas") if category_id == "living-sofas" else None

        def scalar(self, _statement: object) -> str:
            pytest.fail("A category-level assignment must not require choosing a specific catalogue item subtype.")

    monkeypatch.setattr(commercial_api, "SessionLocal", FakeSession)
    assert commercial_api._resolve_asset_classification("living-sofas", "Sofas") == {
        "category_id": "living-sofas",
        "category_name": "Living Room",
        "subcategory": "Sofas",
    }


def test_saving_asset_category_is_scoped_to_the_verified_user() -> None:
    user = VerifiedUser(uuid4(), "owner@example.test", True)
    asset_id = str(uuid4())
    calls: list[dict[str, Any]] = []

    class FakeDatabase:
        def service_request(self, path: str, **kwargs: Any) -> list[dict[str, str]]:
            calls.append({"path": path, **kwargs})
            return [{"asset_id": asset_id}]

    _save_asset_classification(FakeDatabase(), user, asset_id, {
        "category_id": "living-sofas", "category_name": "Sofas", "subcategory": "Two seater",
    })

    assert calls[0]["path"] == "asset_definitions"
    assert calls[0]["method"] == "PATCH"
    assert calls[0]["query"]["asset_id"] == f"eq.{asset_id}"
    assert calls[0]["query"]["user_id"] == f"eq.{user.id}"
    assert calls[0]["body"]["category_id"] == "living-sofas"
    assert calls[0]["body"]["subcategory"] == "Two seater"


def test_project_validator_accepts_canonical_document_and_trims_title() -> None:
    project_id = uuid4()

    assert _validate_project(_project_document(str(project_id)), project_id) == (1, "Bathroom")


@pytest.mark.parametrize("schema_version", [True, 1.0, "1", 2])
def test_project_validator_rejects_noncanonical_schema_version(schema_version: object) -> None:
    project_id = uuid4()

    with pytest.raises(HTTPException) as error:
        _validate_project(_project_document(str(project_id), schema_version), project_id)

    assert error.value.status_code == 422


def test_stripe_signature_checks_digest_and_timestamp_tolerance() -> None:
    secret = "whsec_test_value"
    timestamp = 1_800_000_000
    body = b'{"id":"evt_test","type":"invoice.paid"}'
    digest = hmac.new(secret.encode(), str(timestamp).encode() + b"." + body, hashlib.sha256).hexdigest()
    header = f"t={timestamp},v1={digest}"

    assert _stripe_signature_valid(header, body, secret, now=timestamp)
    assert not _stripe_signature_valid(header, body + b" ", secret, now=timestamp)
    assert not _stripe_signature_valid(header, body, secret, now=timestamp + 301)


@pytest.mark.parametrize(
    ("price_key", "mode", "expected_price_pence"),
    [("pro", "subscription", 1999), ("medium_1", "payment", 50)],
)
def test_stripe_checkout_uses_matching_price_and_managed_payments(
    monkeypatch: pytest.MonkeyPatch, price_key: str, mode: str, expected_price_pence: int
) -> None:
    monkeypatch.setenv("STRIPE_SECRET_KEY", "sk_test_example")
    monkeypatch.setenv("STRIPE_WEBHOOK_SECRET", "whsec_test")
    monkeypatch.setenv(f"STRIPE_PRICE_{price_key.upper()}", "price_example")
    gateway = StripeGateway()
    calls: list[tuple[str, str]] = []
    checkout_fields: list[dict[str, str]] = []

    def request(
        method: str,
        path: str,
        fields: dict[str, str] | None = None,
        *,
        idempotency_key: str | None = None,
    ) -> dict[str, Any]:
        calls.append((method, path))
        if path == "/prices/price_example":
            price: dict[str, Any] = {
                "active": True,
                "currency": "gbp",
                "unit_amount": expected_price_pence,
                "type": "recurring" if mode == "subscription" else "one_time",
            }
            if mode == "subscription":
                price["recurring"] = {"interval": "month", "interval_count": 1}
            return price
        if fields is not None:
            checkout_fields.append(fields)
        return {"url": "https://checkout.stripe.com/cs_test_example"}

    monkeypatch.setattr(gateway, "request", request)
    session = gateway.create_checkout(
        price_key=price_key,
        mode=mode,
        expected_price_pence=expected_price_pence,
        user_id="user-example",
        email=None,
        success_url="https://example.test/success",
        cancel_url="https://example.test/cancel",
        metadata={"product_key": price_key},
        idempotency_key="checkout-test",
    )

    assert session["url"].startswith("https://checkout.stripe.com/")
    assert checkout_fields[0]["managed_payments[enabled]"] == "true"
    assert checkout_fields[0]["mode"] == mode
    assert calls == [("GET", "/prices/price_example"), ("POST", "/checkout/sessions")]


def test_stripe_checkout_rejects_a_mispriced_price_id(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("STRIPE_SECRET_KEY", "sk_test_example")
    monkeypatch.setenv("STRIPE_WEBHOOK_SECRET", "whsec_test")
    monkeypatch.setenv("STRIPE_PRICE_PRO", "price_example")
    gateway = StripeGateway()
    checkout_created = False

    def request(
        method: str,
        path: str,
        fields: dict[str, str] | None = None,
        *,
        idempotency_key: str | None = None,
    ) -> dict[str, Any]:
        nonlocal checkout_created
        if path == "/checkout/sessions":
            checkout_created = True
            return {"url": "https://checkout.stripe.com/cs_test_example"}
        return {
            "active": True,
            "currency": "gbp",
            "unit_amount": 199,
            "type": "recurring",
            "recurring": {"interval": "month"},
        }

    monkeypatch.setattr(gateway, "request", request)
    with pytest.raises(StripeUnavailable):
        gateway.create_checkout(
            price_key="pro",
            mode="subscription",
            expected_price_pence=1999,
            user_id="user-example",
            email=None,
            success_url="https://example.test/success",
            cancel_url="https://example.test/cancel",
            metadata={"plan_key": "pro"},
            idempotency_key="checkout-test",
        )

    assert not checkout_created


def test_stripe_checkout_requires_a_webhook_secret(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("STRIPE_SECRET_KEY", "sk_test_example")
    monkeypatch.setenv("STRIPE_PRICE_PRO", "price_example")
    monkeypatch.delenv("STRIPE_WEBHOOK_SECRET", raising=False)
    gateway = StripeGateway()

    with pytest.raises(StripeUnavailable, match="webhooks must be configured"):
        gateway.create_checkout(
            price_key="pro",
            mode="subscription",
            expected_price_pence=1999,
            user_id="user-example",
            email=None,
            success_url="https://example.test/success",
            cancel_url="https://example.test/cancel",
            metadata={"plan_key": "pro"},
            idempotency_key="checkout-test",
        )


def test_stl_conversion_scales_declared_inches_to_visual_mm_bounds() -> None:
    source = b"""solid unit-test
facet normal 0 0 1
outer loop
vertex 0 0 0
vertex 1 0 0
vertex 0 1 1
endloop
endfacet
endsolid unit-test
"""

    glb, thumbnail, info = process_model(source, "stl", "in")

    assert glb[:4] == b"glTF"
    with Image.open(io.BytesIO(thumbnail)) as preview:
        assert preview.size == (512, 512)
    assert info["triangles"] == 1
    assert info["bounds"] == pytest.approx({"x": 25.4, "y": 25.4, "z": 25.4})


def test_render_worker_rejects_a_mismatched_image_mime_type(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("OPENAI_API_KEY", "test-key")
    image_data = io.BytesIO()
    Image.new("RGB", (8, 8), "white").save(image_data, format="PNG")

    with pytest.raises(RenderProviderError, match="does not match"):
        render_reference(image_data.getvalue(), "image/jpeg", "medium", "")
