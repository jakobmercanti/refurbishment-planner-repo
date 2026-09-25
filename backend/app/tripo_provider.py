"""Server-only Tripo v3 adapter for asynchronous image-to-3D generation."""

from __future__ import annotations

import io
import json
import os
import re
import secrets
import warnings
from collections.abc import Callable
from dataclasses import dataclass
from typing import Any, Protocol
from urllib.error import HTTPError, URLError
from urllib.parse import urlparse
from urllib.request import HTTPRedirectHandler, ProxyHandler, Request, build_opener

from PIL import Image, UnidentifiedImageError

TRIPO_BASE_URL = "https://openapi.tripo3d.ai/v3"
MAX_REFERENCE_BYTES = 10 * 1024 * 1024
MAX_REFERENCE_PIXELS = 16_000_000
MAX_MODEL_BYTES = 100 * 1024 * 1024
_VIEW_ORDER = ("front", "left", "back", "right")


class TripoProviderError(RuntimeError):
    """Safe provider failure suitable for internal job status and user display."""

    def __init__(self, message: str, *, retryable: bool = False) -> None:
        super().__init__(message)
        self.retryable = retryable


class Model3DGenerationProvider(Protocol):
    def create_from_images(self, images: list[ImageReference]) -> str: ...

    def get_task(self, task_id: str) -> dict[str, Any]: ...

    def download_result(self, model_url: str) -> bytes: ...


@dataclass(frozen=True)
class ImageReference:
    view: str
    content_type: str
    data: bytes


class _ProviderRedirectHandler(HTTPRedirectHandler):
    """Allow output downloads to redirect only within Tripo's documented CDN."""

    def redirect_request(self, req, fp, code, msg, headers, newurl):  # type: ignore[no-untyped-def]
        Tripo3DGenerationProvider.validate_model_url(newurl)
        return super().redirect_request(req, fp, code, msg, headers, newurl)


class Tripo3DGenerationProvider:
    def __init__(
        self,
        api_key: str | None = None,
        *,
        model: str | None = None,
        opener: Any | None = None,
        transport: Callable[[Request, int], bytes] | None = None,
    ) -> None:
        self.api_key = (api_key if api_key is not None else os.getenv("TRIPO_API_KEY", "")).strip()
        self.model = (model or os.getenv("TRIPO_GENERATION_MODEL", "v3.1-20260211")).strip()
        self.opener = opener or build_opener(ProxyHandler({}), _ProviderRedirectHandler())
        self.transport = transport

    @property
    def configured(self) -> bool:
        return bool(self.api_key)

    @staticmethod
    def validate_model_url(model_url: str) -> str:
        parsed = urlparse(model_url)
        if (
            parsed.scheme != "https"
            or parsed.hostname != "cdn.tripo3d.ai"
            or parsed.username
            or parsed.password
            or parsed.port not in (None, 443)
            or not parsed.path.startswith("/")
        ):
            raise TripoProviderError("Tripo returned an unsupported model download location.")
        return model_url

    @staticmethod
    def _normalize_image(image: ImageReference) -> tuple[bytes, str]:
        if image.content_type not in {"image/png", "image/jpeg", "image/webp"}:
            raise TripoProviderError("Choose PNG, JPEG or WebP reference images.")
        if not 1 <= len(image.data) <= MAX_REFERENCE_BYTES:
            raise TripoProviderError("Each reference image must be 10 MB or smaller.")
        try:
            with warnings.catch_warnings():
                warnings.simplefilter("error", Image.DecompressionBombWarning)
                with Image.open(io.BytesIO(image.data)) as source:
                    actual = {"PNG": "image/png", "JPEG": "image/jpeg", "WEBP": "image/webp"}.get(source.format or "")
                    if actual != image.content_type:
                        raise TripoProviderError("The reference image type does not match its file content.")
                    if (
                        source.width < 1
                        or source.height < 1
                        or source.width * source.height > MAX_REFERENCE_PIXELS
                    ):
                        raise TripoProviderError("Reference images must be under 16 megapixels.")
                    source.load()
                    if "A" in source.getbands():
                        rgba = source.convert("RGBA")
                        background = Image.new("RGB", rgba.size, "white")
                        background.paste(rgba, mask=rgba.getchannel("A"))
                        normalized = background
                    else:
                        normalized = source.convert("RGB")
                    output = io.BytesIO()
                    normalized.save(output, format="JPEG", quality=90, optimize=True)
                    data = output.getvalue()
        except TripoProviderError:
            raise
        except (UnidentifiedImageError, OSError, Image.DecompressionBombError, Image.DecompressionBombWarning):
            raise TripoProviderError("A reference file is not a supported, readable image.") from None
        if not 1 <= len(data) <= MAX_REFERENCE_BYTES:
            raise TripoProviderError("A reference image is too large after safe normalization.")
        return data, "image/jpeg"

    def _read(self, request: Request, *, max_bytes: int = 2_000_000, timeout: int = 45) -> bytes:
        if self.transport:
            return self.transport(request, max_bytes)
        try:
            with self.opener.open(request, timeout=timeout) as response:
                payload = response.read(max_bytes + 1)
                if len(payload) > max_bytes:
                    raise TripoProviderError("Tripo returned a response that exceeded the allowed size.")
                return payload
        except HTTPError as error:
            if error.code == 402:
                message = "Tripo reports that the API account has insufficient credits."
            elif error.code == 429:
                message = "Tripo is rate limiting requests. Try again shortly."
            else:
                message = f"Tripo returned HTTP {error.code}."
            raise TripoProviderError(message, retryable=error.code == 429 or error.code >= 500) from None
        except (URLError, TimeoutError, OSError):
            raise TripoProviderError("Tripo could not be reached. Try again shortly.", retryable=True) from None

    def _api_json(
        self, path: str, payload: bytes | None = None, content_type: str = "application/json"
    ) -> dict[str, Any]:
        if not self.api_key:
            raise TripoProviderError("AI 3D generation is not configured on the server.")
        request = Request(
            f"{TRIPO_BASE_URL}{path}",
            data=payload,
            method="POST" if payload is not None else "GET",
            headers={
                "Authorization": f"Bearer {self.api_key}",
                "Accept": "application/json",
                **({"Content-Type": content_type} if payload is not None else {}),
            },
        )
        try:
            response = json.loads(self._read(request))
        except (json.JSONDecodeError, UnicodeDecodeError):
            raise TripoProviderError("Tripo returned an invalid response.") from None
        if not isinstance(response, dict) or response.get("code") not in (0, "0"):
            raise TripoProviderError(
                "Tripo rejected the generation request. Check the selected photos and account credits."
            )
        data = response.get("data")
        if not isinstance(data, dict):
            raise TripoProviderError("Tripo returned an incomplete response.")
        return data

    def _upload_image(self, image: ImageReference) -> str:
        data, content_type = self._normalize_image(image)
        boundary = "----FreeFloorplan3D" + secrets.token_hex(18)
        body = b"".join(
            (
                (
                    f"--{boundary}\r\nContent-Disposition: form-data; "
                    'name="file"; filename="reference.jpg"\r\n'
                ).encode(),
                f"Content-Type: {content_type}\r\n\r\n".encode(),
                data,
                f"\r\n--{boundary}--\r\n".encode(),
            )
        )
        response = self._api_json("/files", body, f"multipart/form-data; boundary={boundary}")
        token = response.get("file_token")
        if not isinstance(token, str) or not re.fullmatch(r"[A-Za-z0-9_-]{6,200}", token):
            raise TripoProviderError("Tripo did not return a valid image upload token.")
        return token

    def create_from_images(self, images: list[ImageReference]) -> str:
        if not 1 <= len(images) <= 3:
            raise TripoProviderError("Upload between one and three reference images.")
        views = [image.view for image in images]
        if any(view not in _VIEW_ORDER for view in views) or len(set(views)) != len(views):
            raise TripoProviderError("Assign each photo a different front, left, right or back view.")
        if len(images) > 1 and "front" not in views:
            raise TripoProviderError("A front-view photo is required when using multiple photos.")

        tokens = [self._upload_image(image) for image in images]
        model = self.model or "v3.1-20260211"
        common = {
            "model": model,
            "texture": True,
            "pbr": True,
            "texture_quality": "standard",
            "face_limit": 50000,
        }
        if len(tokens) == 1:
            request_data = {"input": tokens[0], **common}
            endpoint = "/generation/image-to-model"
        else:
            request_data = {
                "inputs": [{image.view: token} for image, token in zip(images, tokens, strict=True)],
                **common,
            }
            endpoint = "/generation/multiview-to-model"
        created = self._api_json(endpoint, json.dumps(request_data, separators=(",", ":")).encode())
        task_id = created.get("task_id")
        if not isinstance(task_id, str) or not re.fullmatch(r"task_[A-Za-z0-9_-]{6,200}", task_id):
            raise TripoProviderError("Tripo did not return a valid generation task ID.")
        return task_id

    def get_task(self, task_id: str) -> dict[str, Any]:
        if not re.fullmatch(r"task_[A-Za-z0-9_-]{6,200}", task_id):
            raise TripoProviderError("The saved Tripo task identifier is invalid.")
        return self._api_json(f"/tasks/{task_id}")

    def download_result(self, model_url: str) -> bytes:
        url = self.validate_model_url(model_url)
        request = Request(url, headers={"Accept": "model/gltf-binary, application/octet-stream"})
        data = self._read(request, max_bytes=MAX_MODEL_BYTES, timeout=60)
        return data


def tripo3d_provider() -> Tripo3DGenerationProvider:
    return Tripo3DGenerationProvider()
