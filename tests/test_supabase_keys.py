"""Supabase privileged keys must never be confused with user bearer tokens."""

import json
from uuid import uuid4

import pytest

from backend.app.supabase_rest import SupabaseREST


@pytest.mark.parametrize("modern_name,legacy,expected,has_bearer", [
    ("sb_secret_modern", "legacy.jwt.value", "sb_secret_modern", False),
    ("", "legacy.jwt.value", "legacy.jwt.value", True),
    ("", "sb_secret_compat", "sb_secret_compat", False),
])
def test_service_headers_and_key_precedence(monkeypatch, modern_name, legacy, expected, has_bearer):
    monkeypatch.setenv("SUPABASE_URL", "https://project.supabase.co")
    monkeypatch.setenv("SUPABASE_SECRET_KEY", modern_name)
    monkeypatch.setenv("SUPABASE_SERVICE_ROLE_KEY", legacy)
    db = SupabaseREST()
    assert db.database_configured

    def read(request, **kwargs):
        assert request.get_header("Apikey") == expected
        assert request.get_header("Authorization") == (f"Bearer {expected}" if has_bearer else None)
        return b"[]", 200

    monkeypatch.setattr(db, "_read", read)
    assert db.select("commercial_plans", {}) == []


def test_auth_keeps_user_token_separate_from_privileged_key(monkeypatch):
    monkeypatch.setenv("SUPABASE_URL", "https://project.supabase.co")
    monkeypatch.setenv("SUPABASE_PUBLISHABLE_KEY", "sb_publishable_browser")
    monkeypatch.setenv("SUPABASE_SECRET_KEY", "sb_secret_server")
    db = SupabaseREST()
    user_id = str(uuid4())

    def read(request, **kwargs):
        assert request.get_header("Apikey") == "sb_publishable_browser"
        assert request.get_header("Authorization") == "Bearer user.jwt.token"
        return json.dumps({"id": user_id, "email_confirmed_at": "2026-10-01T00:00:00Z"}).encode(), 200

    monkeypatch.setattr(db, "_read", read)
    assert str(db.verify_user("user.jwt.token").id) == user_id
