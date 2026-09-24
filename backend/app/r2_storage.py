"""Private Cloudflare R2 access using the S3 Signature V4 protocol.

Credentials are read only from server-side environment variables. Presigned
URLs are short-lived bearer tokens and are never persisted in project data.
"""

from __future__ import annotations

import hashlib
import hmac
import os
from dataclasses import dataclass
from datetime import UTC, datetime
from urllib.error import HTTPError, URLError
from urllib.parse import quote, urlencode, urlsplit
from urllib.request import ProxyHandler, Request, build_opener


class R2Unavailable(RuntimeError):
    """The private object store is unavailable or rejected a request."""


@dataclass(frozen=True)
class ObjectMetadata:
    byte_size: int
    content_type: str
    etag: str | None


class R2Storage:
    def __init__(self) -> None:
        self.account_id = os.getenv("R2_ACCOUNT_ID", "").strip()
        self.bucket = os.getenv("R2_BUCKET", "").strip()
        self.access_key = os.getenv("R2_ACCESS_KEY_ID", "").strip()
        self.secret_key = os.getenv("R2_SECRET_ACCESS_KEY", "").strip()
        self.endpoint = f"https://{self.account_id}.r2.cloudflarestorage.com" if self.account_id else ""
        self.opener = build_opener(ProxyHandler({}))

    @property
    def configured(self) -> bool:
        return all((self.account_id, self.bucket, self.access_key, self.secret_key))

    def _require_config(self) -> None:
        if not self.configured:
            raise R2Unavailable("Private asset storage is not configured.")

    def _object_url(self, key: str) -> tuple[str, str, str]:
        self._require_config()
        if not key or key.startswith("/") or ".." in key.split("/") or "\\" in key:
            raise ValueError("Invalid object key.")
        host = urlsplit(self.endpoint).netloc
        path = "/" + quote(self.bucket, safe="-_.~") + "/" + quote(key, safe="/-_.~")
        return self.endpoint + path, host, path

    @staticmethod
    def _hmac(key: bytes, value: str) -> bytes:
        return hmac.new(key, value.encode("utf-8"), hashlib.sha256).digest()

    def _signing_key(self, date_stamp: str) -> bytes:
        secret = ("AWS4" + self.secret_key).encode("utf-8")
        date_key = self._hmac(secret, date_stamp)
        region_key = self._hmac(date_key, "auto")
        service_key = self._hmac(region_key, "s3")
        return self._hmac(service_key, "aws4_request")

    def presign(self, method: str, key: str, *, expires_seconds: int = 900, content_type: str | None = None) -> str:
        self._require_config()
        if method not in {"GET", "PUT", "HEAD", "DELETE"}:
            raise ValueError("Unsupported presigned operation.")
        if not 1 <= expires_seconds <= 604800:
            raise ValueError("Presigned URL expiry is outside the S3 limit.")
        url, host, canonical_uri = self._object_url(key)
        now = datetime.now(UTC)
        amz_date = now.strftime("%Y%m%dT%H%M%SZ")
        date_stamp = now.strftime("%Y%m%d")
        scope = f"{date_stamp}/auto/s3/aws4_request"
        signed_headers = "content-type;host" if content_type else "host"
        credential = f"{self.access_key}/{scope}"
        params = {
            "X-Amz-Algorithm": "AWS4-HMAC-SHA256",
            "X-Amz-Credential": credential,
            "X-Amz-Date": amz_date,
            "X-Amz-Expires": str(expires_seconds),
            "X-Amz-SignedHeaders": signed_headers,
        }
        canonical_query = urlencode(sorted(params.items()), quote_via=quote, safe="-_.~")
        canonical_headers = f"host:{host}\n"
        if content_type:
            canonical_headers = f"content-type:{content_type.strip()}\n" + canonical_headers
        canonical_request = "\n".join(
            (method, canonical_uri, canonical_query, canonical_headers, signed_headers, "UNSIGNED-PAYLOAD")
        )
        string_to_sign = "\n".join(
            ("AWS4-HMAC-SHA256", amz_date, scope, hashlib.sha256(canonical_request.encode()).hexdigest())
        )
        signature = hmac.new(self._signing_key(date_stamp), string_to_sign.encode(), hashlib.sha256).hexdigest()
        return f"{url}?{canonical_query}&X-Amz-Signature={signature}"

    def _request(
        self, method: str, key: str, *, body: bytes = b"", content_type: str | None = None, max_bytes: int = 0
    ) -> tuple[bytes, dict[str, str]]:
        url, host, canonical_uri = self._object_url(key)
        now = datetime.now(UTC)
        amz_date = now.strftime("%Y%m%dT%H%M%SZ")
        date_stamp = now.strftime("%Y%m%d")
        payload_hash = hashlib.sha256(body).hexdigest()
        headers = {"Host": host, "x-amz-content-sha256": payload_hash, "x-amz-date": amz_date}
        if content_type:
            headers["Content-Type"] = content_type
        normalized = {name.lower(): " ".join(value.strip().split()) for name, value in headers.items()}
        signed_headers = ";".join(sorted(normalized))
        canonical_headers = "".join(f"{name}:{normalized[name]}\n" for name in sorted(normalized))
        canonical_request = "\n".join((method, canonical_uri, "", canonical_headers, signed_headers, payload_hash))
        scope = f"{date_stamp}/auto/s3/aws4_request"
        string_to_sign = "\n".join(
            ("AWS4-HMAC-SHA256", amz_date, scope, hashlib.sha256(canonical_request.encode()).hexdigest())
        )
        signature = hmac.new(self._signing_key(date_stamp), string_to_sign.encode(), hashlib.sha256).hexdigest()
        headers["Authorization"] = (
            f"AWS4-HMAC-SHA256 Credential={self.access_key}/{scope}, "
            f"SignedHeaders={signed_headers}, Signature={signature}"
        )
        request = Request(url, data=body if method in {"PUT", "POST"} else None, headers=headers, method=method)
        try:
            with self.opener.open(request, timeout=20) as response:
                response_headers = {k.lower(): v for k, v in response.headers.items()}
                content_length = int(response_headers.get("content-length", "0") or 0)
                if max_bytes and content_length > max_bytes:
                    raise R2Unavailable("Stored object exceeds its allowed size.")
                payload = response.read(max_bytes + 1 if max_bytes else 1)
                if max_bytes and len(payload) > max_bytes:
                    raise R2Unavailable("Stored object exceeds its allowed size.")
                return payload, response_headers
        except HTTPError as error:
            # Do not include the URL or response body: they can contain signed
            # credentials or provider-specific details.
            raise R2Unavailable(f"Object storage returned HTTP {error.code}.") from None
        except (URLError, TimeoutError, OSError) as error:
            raise R2Unavailable("Object storage could not be reached.") from error

    def head(self, key: str) -> ObjectMetadata:
        _body, headers = self._request("HEAD", key)
        try:
            size = int(headers.get("content-length", "-1"))
        except ValueError:
            size = -1
        if size < 0:
            raise R2Unavailable("Object storage did not return a valid object size.")
        return ObjectMetadata(size, headers.get("content-type", "application/octet-stream"), headers.get("etag"))

    def get(self, key: str, *, max_bytes: int) -> tuple[bytes, ObjectMetadata]:
        body, headers = self._request("GET", key, max_bytes=max_bytes)
        return body, ObjectMetadata(
            len(body), headers.get("content-type", "application/octet-stream"), headers.get("etag")
        )

    def put(self, key: str, body: bytes, content_type: str) -> ObjectMetadata:
        _payload, headers = self._request("PUT", key, body=body, content_type=content_type)
        return ObjectMetadata(len(body), content_type, headers.get("etag"))

    def delete(self, key: str) -> None:
        self._request("DELETE", key)


def r2_storage() -> R2Storage:
    return R2Storage()
