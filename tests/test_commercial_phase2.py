import hashlib
import hmac
import io
from typing import Any
from uuid import uuid4

import pytest
from fastapi import HTTPException
from PIL import Image

from backend.app.commercial_api import _stripe_signature_valid, _validate_project
from backend.app.model_processing import process_model
from backend.app.openai_render import RenderProviderError, render_reference
from backend.app.stripe_gateway import StripeGateway, StripeUnavailable


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


def test_stripe_checkout_uses_only_active_matching_monthly_price(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("STRIPE_SECRET_KEY", "sk_test_example")
    monkeypatch.setenv("STRIPE_WEBHOOK_SECRET", "whsec_test")
    monkeypatch.setenv("STRIPE_PRICE_PRO", "price_example")
    gateway = StripeGateway()
    calls: list[tuple[str, str]] = []

    def request(
        method: str,
        path: str,
        fields: dict[str, str] | None = None,
        *,
        idempotency_key: str | None = None,
    ) -> dict[str, Any]:
        calls.append((method, path))
        if path == "/prices/price_example":
            return {
                "active": True,
                "currency": "gbp",
                "unit_amount": 1999,
                "type": "recurring",
                "recurring": {"interval": "month", "interval_count": 1},
            }
        return {"url": "https://checkout.stripe.com/cs_test_example"}

    monkeypatch.setattr(gateway, "request", request)
    session = gateway.create_checkout(
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

    assert session["url"].startswith("https://checkout.stripe.com/")
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
