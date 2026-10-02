"""Billing-return reconciliation only uses verified provider state and ownership."""
import asyncio
import hashlib
import hmac
import json
import time
from typing import Any
from uuid import uuid4

import pytest
from fastapi import HTTPException

from backend.app import commercial_api
from backend.app.supabase_rest import VerifiedUser


@pytest.mark.parametrize("status,ending", [("canceled", False), ("active", True), ("active", False)])
def test_billing_sync_projects_current_stripe_state(monkeypatch, status, ending):
    user = VerifiedUser(uuid4(), "owner@example.test", True)
    projections: list[dict[str, Any]] = []

    class Database:
        def verify_user(self, _token):
            return user

        def select(self, table, query):
            assert table == "commercial_subscriptions"
            assert query["user_id"] == f"eq.{user.id}"
            return [{"stripe_subscription_id": "sub_owned", "stripe_customer_id": "cus_owned", "updated_at": "2026-10-02T19:00:00Z"}]

        def service_request(self, table, *, method, query, body):
            assert table == "commercial_subscriptions" and method == "PATCH"
            assert query["user_id"] == f"eq.{user.id}"
            assert query["stripe_subscription_id"] == "eq.sub_owned"
            assert query["updated_at"] == "eq.2026-10-02T19:00:00Z"
            projections.append(body)

        def rpc(self, name, args):
            assert name == "commercial_summary"
            return {"plan": "free" if status == "canceled" else "starter",
                    "status": "free" if status == "canceled" else status, "cancel_at_period_end": ending}

    class Stripe:
        def get_subscription(self, reference):
            assert reference == "sub_owned"
            return {"id": reference, "customer": "cus_owned", "metadata": {"user_id": str(user.id)},
                    "status": status, "cancel_at_period_end": ending}

        def subscription_details(self, subscription):
            return "starter", 100, 200

    monkeypatch.setattr(commercial_api, "supabase_rest", Database)
    monkeypatch.setattr(commercial_api, "stripe_gateway", Stripe)
    result = commercial_api.sync_billing("Bearer verified")
    assert result["plan"] == ("free" if status == "canceled" else "starter")
    assert projections[0]["status"] == status
    assert projections[0]["cancel_at_period_end"] is ending
    assert "last_stripe_event_created" not in projections[0]  # A new subscription's webhook must still win.


def test_billing_sync_rejects_cross_account_subscription(monkeypatch):
    user = VerifiedUser(uuid4(), "owner@example.test", True)

    class Database:
        def verify_user(self, _token):
            return user

        def select(self, _table, _query):
            return [{"stripe_subscription_id": "sub_owned", "stripe_customer_id": "cus_owned"}]

        def rpc(self, *_args):
            pytest.fail("Mismatched provider ownership must not update the database")

    class Stripe:
        def get_subscription(self, reference):
            return {"id": reference, "customer": "cus_foreign", "metadata": {"user_id": str(user.id)}}

    monkeypatch.setattr(commercial_api, "supabase_rest", Database)
    monkeypatch.setattr(commercial_api, "stripe_gateway", Stripe)
    with pytest.raises(HTTPException) as error:
        commercial_api.sync_billing("Bearer verified")
    assert error.value.status_code == 503


def test_billing_sync_without_subscription_stays_free(monkeypatch):
    user = VerifiedUser(uuid4(), None, True)

    class Database:
        def verify_user(self, _token):
            return user

        def select(self, _table, _query):
            return []

        def rpc(self, name, _args):
            assert name == "commercial_summary"
            return {"plan": "free", "status": "free"}

    class Stripe:
        def get_subscription(self, _reference):
            pytest.fail("A Free account must not query or create a Stripe subscription")

    monkeypatch.setattr(commercial_api, "supabase_rest", Database)
    monkeypatch.setattr(commercial_api, "stripe_gateway", Stripe)
    assert commercial_api.sync_billing("Bearer verified")["plan"] == "free"


def test_delayed_active_webhook_uses_stripes_current_canceled_state(monkeypatch):
    user_id = str(uuid4())
    timestamp = int(time.time())
    projections = []
    event = {"id": "evt_delayed", "type": "customer.subscription.updated", "created": timestamp - 10,
             "data": {"object": {"id": "sub_owned", "customer": "cus_owned", "status": "active",
                                  "metadata": {"user_id": user_id}}}}
    body = json.dumps(event).encode()
    digest = hmac.new(b"whsec_example", str(timestamp).encode() + b"." + body, hashlib.sha256).hexdigest()

    class Request:
        async def body(self):
            return body

    class Stripe:
        configured = True
        webhook_secret = "whsec_example"

        def get_subscription(self, reference):
            assert reference == "sub_owned"
            return {"id": reference, "customer": "cus_owned", "status": "canceled",
                    "cancel_at_period_end": False, "metadata": {"user_id": user_id}}

        def subscription_details(self, subscription):
            return "starter", 100, 200

    class Database:
        def rpc(self, name, args):
            assert name == "apply_stripe_event"
            projections.append(args)
            return {"status": "processed"}

    monkeypatch.setattr(commercial_api, "stripe_gateway", Stripe)
    monkeypatch.setattr(commercial_api, "supabase_rest", Database)
    result = asyncio.run(commercial_api.stripe_webhook(Request(), f"t={timestamp},v1={digest}"))
    assert result == {"status": "processed"}
    assert projections[0]["p_subscription_status"] == "canceled"
    assert projections[0]["p_event_created"] == timestamp - 10
