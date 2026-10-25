"""Malformed provider responses map to safe service errors, not uncaught exceptions."""

from unittest.mock import MagicMock

import pytest

from backend.app.r2_storage import R2Storage, R2Unavailable
from backend.app.supabase_rest import SupabaseREST, SupabaseUnavailable


@pytest.mark.parametrize("content_length", ["invalid", "-1", "999999"])
def test_invalid_or_excessive_storage_size_is_rejected_before_reading(monkeypatch, content_length) -> None:
    for key, value in {
        "R2_ACCOUNT_ID": "test",
        "R2_BUCKET": "test",
        "R2_ACCESS_KEY_ID": "test",
        "R2_SECRET_ACCESS_KEY": "test",
    }.items():
        monkeypatch.setenv(key, value)
    storage = R2Storage()
    storage.opener = MagicMock()
    response = storage.opener.open.return_value.__enter__.return_value
    response.headers = {"content-length": content_length}
    with pytest.raises(R2Unavailable, match="size"):
        storage.get("users/owner/assets/asset/source.glb", max_bytes=10)
    response.read.assert_not_called()


@pytest.mark.parametrize("payload", [b"\xff\xfe\xff", b"{invalid"])
def test_invalid_database_json_is_a_safe_service_error(monkeypatch, payload) -> None:
    monkeypatch.setenv("SUPABASE_URL", "https://example.invalid")
    monkeypatch.setenv("SUPABASE_SERVICE_ROLE_KEY", "test")
    db = SupabaseREST()
    db.opener = MagicMock()
    response = db.opener.open.return_value.__enter__.return_value
    response.status = 200
    response.read.return_value = payload
    with pytest.raises(SupabaseUnavailable, match="invalid response"):
        db.service_request("asset_definitions")
