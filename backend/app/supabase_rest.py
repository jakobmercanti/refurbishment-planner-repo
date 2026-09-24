"""Small server-only Supabase Auth/PostgREST adapter using the standard library."""

from __future__ import annotations

import json
import os
from dataclasses import dataclass
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode
from urllib.request import ProxyHandler, Request, build_opener
from uuid import UUID


class SupabaseUnavailable(RuntimeError):
    """Supabase integration is disabled or unavailable."""

    def __init__(self, message: str, *, status_code: int = 503, code: str | None = None) -> None:
        super().__init__(message)
        self.status_code = status_code
        self.code = code


class InvalidAccessToken(RuntimeError):
    """The supplied user access token is invalid or expired."""


@dataclass(frozen=True)
class VerifiedUser:
    id: UUID
    email: str | None
    email_confirmed: bool


class SupabaseREST:
    def __init__(self) -> None:
        self.url = os.getenv("SUPABASE_URL", "").strip().rstrip("/")
        self.publishable_key = os.getenv("SUPABASE_PUBLISHABLE_KEY", "").strip()
        self.service_key = os.getenv("SUPABASE_SERVICE_ROLE_KEY", "").strip()
        self.opener = build_opener(ProxyHandler({}))

    @property
    def auth_configured(self) -> bool:
        return bool(self.url and self.publishable_key)

    @property
    def database_configured(self) -> bool:
        return bool(self.url and self.service_key)

    def _read(self, request: Request, *, max_bytes: int = 2_000_000) -> tuple[bytes, int]:
        try:
            with self.opener.open(request, timeout=8) as response:
                payload = response.read(max_bytes + 1)
                if len(payload) > max_bytes:
                    raise SupabaseUnavailable("Database response exceeded the allowed size.")
                return payload, response.status
        except HTTPError as error:
            body = error.read(4096)
            # Auth rejection is distinguished without echoing provider content.
            if request.full_url.endswith("/auth/v1/user") and error.code in (401, 403):
                raise InvalidAccessToken("Sign in again to continue.") from None
            message = "Supabase rejected a commercial request."
            code = None
            try:
                parsed = json.loads(body)
                provider_message = parsed.get("message")
                provider_code = parsed.get("code")
                if isinstance(provider_message, str) and provider_message.replace("_", "").isalnum():
                    code = provider_message[:80]
                elif isinstance(provider_code, str) and provider_code.isalnum():
                    code = provider_code[:20]
            except (json.JSONDecodeError, AttributeError):
                pass
            raise SupabaseUnavailable(message, status_code=error.code, code=code) from None
        except (URLError, TimeoutError, OSError) as error:
            raise SupabaseUnavailable("Supabase could not be reached.") from error

    def verify_user(self, access_token: str) -> VerifiedUser:
        if not self.auth_configured:
            raise SupabaseUnavailable("Account services are not configured yet.")
        if len(access_token) > 8192 or not access_token.strip():
            raise InvalidAccessToken("Sign in again to continue.")
        request = Request(
            f"{self.url}/auth/v1/user",
            headers={
                "apikey": self.publishable_key,
                "Authorization": f"Bearer {access_token}",
                "Accept": "application/json",
            },
            method="GET",
        )
        payload, _ = self._read(request, max_bytes=64_000)
        try:
            user = json.loads(payload)
            user_id = UUID(str(user["id"]))
        except (json.JSONDecodeError, KeyError, TypeError, ValueError):
            raise InvalidAccessToken("Sign in again to continue.") from None
        confirmed = bool(user.get("email_confirmed_at") or user.get("confirmed_at"))
        if os.getenv("REQUIRE_VERIFIED_EMAIL", "true").lower() == "true" and not confirmed:
            raise PermissionError("Verify your email address before using the paid workspace.")
        email = user.get("email")
        return VerifiedUser(user_id, email if isinstance(email, str) else None, confirmed)

    def service_request(
        self,
        path: str,
        *,
        method: str = "GET",
        query: dict[str, str] | None = None,
        body: Any = None,
        prefer: str | None = None,
        max_bytes: int = 2_000_000,
    ) -> Any:
        if not self.database_configured:
            raise SupabaseUnavailable("Commercial database access is not configured yet.")
        if path.startswith("/") or ".." in path.split("/"):
            raise ValueError("Invalid Supabase resource path.")
        url = f"{self.url}/rest/v1/{path}"
        if query:
            url += "?" + urlencode(query)
        data = None if body is None else json.dumps(body, separators=(",", ":"), ensure_ascii=False).encode("utf-8")
        headers = {
            "apikey": self.service_key,
            "Authorization": f"Bearer {self.service_key}",
            "Accept": "application/json",
        }
        if data is not None:
            headers["Content-Type"] = "application/json"
        if prefer:
            headers["Prefer"] = prefer
        request = Request(url, data=data, headers=headers, method=method)
        payload, status = self._read(request, max_bytes=max_bytes)
        if status == 204 or not payload:
            return None
        try:
            return json.loads(payload)
        except json.JSONDecodeError:
            raise SupabaseUnavailable("Supabase returned an invalid response.") from None

    def rpc(self, function: str, parameters: dict[str, Any], *, max_bytes: int = 2_000_000) -> Any:
        if not function.replace("_", "").isalnum():
            raise ValueError("Invalid RPC name.")
        return self.service_request(f"rpc/{function}", method="POST", body=parameters, max_bytes=max_bytes)

    def select(self, table: str, query: dict[str, str], *, max_bytes: int = 2_000_000) -> Any:
        if not table.replace("_", "").isalnum():
            raise ValueError("Invalid table name.")
        return self.service_request(table, query=query, max_bytes=max_bytes)


def supabase_rest() -> SupabaseREST:
    return SupabaseREST()
