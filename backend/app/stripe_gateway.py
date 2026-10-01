"""Minimal server-side Stripe REST client with a fixed product allowlist."""

from __future__ import annotations

import json
import os
import re
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode
from urllib.request import ProxyHandler, Request, build_opener


class StripeUnavailable(RuntimeError):
    """Billing is not configured or Stripe could not complete the request."""


PLAN_KEYS = ("starter", "pro", "studio")
PACK_KEYS = ("medium_1", "medium_10", "medium_50", "medium_100", "high_1", "high_10", "high_50", "high_100")


class StripeGateway:
    def __init__(self) -> None:
        self.secret = os.getenv("STRIPE_SECRET_KEY", "").strip()
        self.webhook_secret = os.getenv("STRIPE_WEBHOOK_SECRET", "").strip()
        self.opener = build_opener(ProxyHandler({}))

    @property
    def configured(self) -> bool:
        if not self.secret:
            return False
        return not self.secret.startswith("sk_live_") or os.getenv("STRIPE_ALLOW_LIVE", "false").lower() == "true"

    @property
    def billing_enabled(self) -> bool:
        if not self.configured or not self.webhook_secret:
            return False
        return all(
            re.fullmatch(r"price_[A-Za-z0-9]+", os.getenv(f"STRIPE_PRICE_{key.upper()}", "").strip())
            for key in (*PLAN_KEYS, *PACK_KEYS)
        )

    def price_id(self, key: str) -> str:
        if key not in (*PLAN_KEYS, *PACK_KEYS):
            raise ValueError("Unknown fixed product key.")
        value = os.getenv(f"STRIPE_PRICE_{key.upper()}", "").strip()
        if not re.fullmatch(r"price_[A-Za-z0-9]+", value):
            raise StripeUnavailable("Stripe price IDs are not configured for the selected product.")
        return value

    def request(
        self, method: str, path: str, fields: dict[str, str] | None = None, *, idempotency_key: str | None = None
    ) -> dict[str, Any]:
        if not self.configured:
            raise StripeUnavailable("Stripe is not configured. Live billing remains disabled until explicitly enabled.")
        if not path.startswith("/") or ".." in path.split("/"):
            raise ValueError("Invalid Stripe resource path.")
        body = urlencode(fields or {}).encode("utf-8") if fields is not None else None
        headers = {"Authorization": f"Bearer {self.secret}", "Accept": "application/json"}
        if body is not None:
            headers["Content-Type"] = "application/x-www-form-urlencoded"
        if idempotency_key:
            headers["Idempotency-Key"] = idempotency_key[:200]
        request = Request(f"https://api.stripe.com/v1{path}", data=body, headers=headers, method=method)
        try:
            with self.opener.open(request, timeout=12) as response:
                payload = response.read(256_001)
                if len(payload) > 256_000:
                    raise StripeUnavailable("Stripe response exceeded the allowed size.")
        except HTTPError as error:
            # Provider bodies can contain customer data; never echo them to the browser.
            raise StripeUnavailable(f"Stripe returned HTTP {error.code}.") from None
        except (URLError, TimeoutError, OSError):
            raise StripeUnavailable("Stripe could not be reached.") from None
        try:
            result = json.loads(payload)
        except json.JSONDecodeError:
            raise StripeUnavailable("Stripe returned an invalid response.") from None
        if not isinstance(result, dict):
            raise StripeUnavailable("Stripe returned an invalid response.")
        return result

    def create_checkout(
        self,
        *,
        price_key: str,
        mode: str,
        expected_price_pence: int,
        user_id: str,
        email: str | None,
        success_url: str,
        cancel_url: str,
        metadata: dict[str, str],
        idempotency_key: str,
    ) -> dict[str, Any]:
        if not self.webhook_secret:
            raise StripeUnavailable("Stripe webhooks must be configured before checkout can be enabled.")
        price_id = self.price_id(price_key)
        price = self.request("GET", f"/prices/{price_id}")
        expected_type = "recurring" if mode == "subscription" else "one_time"
        recurring_value = price.get("recurring")
        recurring = recurring_value if isinstance(recurring_value, dict) else {}
        if (
            price.get("active") is not True
            or price.get("currency") != "gbp"
            or price.get("unit_amount") != expected_price_pence
            or price.get("type") != expected_type
            or (
                mode == "subscription"
                and (recurring.get("interval") != "month" or recurring.get("interval_count", 1) != 1)
            )
        ):
            raise StripeUnavailable("The configured Stripe price does not match the active product catalogue.")
        fields = {
            "mode": mode,
            "managed_payments[enabled]": "true",
            "line_items[0][price]": price_id,
            "line_items[0][quantity]": "1",
            "client_reference_id": user_id,
            "success_url": success_url,
            "cancel_url": cancel_url,
            "metadata[user_id]": user_id,
        }
        if email:
            fields["customer_email"] = email
        if mode == "subscription":
            fields["subscription_data[metadata][user_id]"] = user_id
            fields["subscription_data[metadata][plan_key]"] = price_key
        for key, value in metadata.items():
            fields[f"metadata[{key}]"] = value
        return self.request("POST", "/checkout/sessions", fields, idempotency_key=idempotency_key)

    def create_portal(self, customer_id: str, return_url: str) -> dict[str, Any]:
        return self.request("POST", "/billing_portal/sessions", {"customer": customer_id, "return_url": return_url})

    def get_subscription(self, subscription_id: str) -> dict[str, Any]:
        if not subscription_id.startswith("sub_") or len(subscription_id) > 100:
            raise ValueError("Invalid Stripe subscription reference.")
        return self.request("GET", f"/subscriptions/{subscription_id}")


def stripe_gateway() -> StripeGateway:
    return StripeGateway()
