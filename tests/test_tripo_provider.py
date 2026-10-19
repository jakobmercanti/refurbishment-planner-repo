"""Focused tests for request mapping and safe Tripo result retrieval."""

from __future__ import annotations

import io
import json
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.request import Request

import pytest
from PIL import Image

from backend.app.tripo_provider import ImageReference, Tripo3DGenerationProvider, TripoProviderError


class CapturingTripo(Tripo3DGenerationProvider):
    def __init__(self) -> None:
        super().__init__(api_key="test-key", model="v3.1-test")
        self.uploaded: list[ImageReference] = []
        self.request_path = ""
        self.request_body: dict[str, Any] = {}

    def _upload_image(self, image: ImageReference) -> str:
        self.uploaded.append(image)
        return f"file_token_{len(self.uploaded)}"

    def _api_json(
        self, path: str, payload: bytes | None = None, content_type: str = "application/json"
    ) -> dict[str, Any]:
        self.request_path = path
        self.request_body = json.loads(payload) if payload else {}
        return {"task_id": "task_abc123"}


def _image(view: str) -> ImageReference:
    return ImageReference(view, "image/jpeg", b"image bytes")


def test_single_photo_uses_image_to_model_request() -> None:
    provider = CapturingTripo()

    task_id = provider.create_from_images([_image("front")])

    assert task_id == "task_abc123"
    assert provider.request_path == "/generation/image-to-model"
    assert provider.request_body["input"] == "file_token_1"
    assert provider.request_body["model"] == "v3.1-test"
    assert provider.request_body["pbr"] is True
    assert provider.request_body["face_limit"] == 50000
    assert "compress" not in provider.request_body


def test_two_or_three_photos_use_distinct_multiview_keys() -> None:
    provider = CapturingTripo()

    provider.create_from_images([_image("front"), _image("left"), _image("right")])

    assert provider.request_path == "/generation/multiview-to-model"
    assert provider.request_body["inputs"] == [
        {"front": "file_token_1"},
        {"left": "file_token_2"},
        {"right": "file_token_3"},
    ]


@pytest.mark.parametrize(
    "images",
    [[], [_image("left"), _image("right")], [_image("front"), _image("front")], [_image("front")] * 4],
)
def test_invalid_photo_sets_are_rejected_before_provider_upload(images: list[ImageReference]) -> None:
    provider = CapturingTripo()

    with pytest.raises(TripoProviderError):
        provider.create_from_images(images)

    assert provider.uploaded == []


@pytest.mark.parametrize(
    "url",
    [
        "http://cdn.tripo3d.ai/output/model.glb",
        "https://cdn.tripo3d.ai.attacker.invalid/model.glb",
        "https://user@cdn.tripo3d.ai/model.glb",
        "https://cdn.tripo3d.ai:444/model.glb",
        "https://cdn.tripo3d.ai:invalid/model.glb",
        "https://cdn.tripo3d.ai:99999/model.glb",
        "https://[invalid/model.glb",
        "file:///etc/passwd",
    ],
)
def test_provider_model_download_rejects_untrusted_urls(url: str) -> None:
    with pytest.raises(TripoProviderError):
        Tripo3DGenerationProvider.validate_model_url(url)


def test_provider_model_download_accepts_only_documented_https_cdn_host() -> None:
    assert Tripo3DGenerationProvider.validate_model_url("https://cdn.tripo3d.ai/output/model.glb") == (
        "https://cdn.tripo3d.ai/output/model.glb"
    )


def test_image_normalization_checks_mime_and_reencodes_to_jpeg() -> None:
    image_data = io.BytesIO()
    Image.new("RGBA", (256, 256), (255, 20, 30, 100)).save(image_data, format="PNG")

    normalized, content_type = Tripo3DGenerationProvider._normalize_image(
        ImageReference("front", "image/png", image_data.getvalue())
    )

    assert content_type == "image/jpeg"
    assert normalized[:2] == b"\xff\xd8"
    with pytest.raises(TripoProviderError, match="does not match"):
        Tripo3DGenerationProvider._normalize_image(ImageReference("front", "image/jpeg", image_data.getvalue()))


def test_transport_cannot_bypass_response_size_limit() -> None:
    provider = Tripo3DGenerationProvider(transport=lambda request, limit: b"x" * (limit + 1))
    with pytest.raises(TripoProviderError, match="exceeded"):
        provider._read(Request("https://example.invalid/"), max_bytes=8)


@pytest.mark.parametrize("status, retryable", [(402, False), (429, True), (500, True), (403, False)])
def test_provider_http_errors_are_safe_and_classified(status: int, retryable: bool) -> None:
    def transport(request: Request, limit: int) -> bytes:
        raise HTTPError("https://example.invalid/?secret=must-not-leak", status, "private details", {}, None)

    provider = Tripo3DGenerationProvider(transport=transport)
    with pytest.raises(TripoProviderError) as caught:
        provider._read(Request("https://example.invalid/"))
    assert caught.value.retryable is retryable
    assert "must-not-leak" not in str(caught.value)
    assert "private details" not in str(caught.value)


def test_provider_network_failure_is_retryable() -> None:
    def transport(request: Request, limit: int) -> bytes:
        raise URLError("private connection details")

    with pytest.raises(TripoProviderError) as caught:
        Tripo3DGenerationProvider(transport=transport)._read(Request("https://example.invalid/"))
    assert caught.value.retryable
    assert "private connection details" not in str(caught.value)


def test_empty_model_configuration_keeps_supported_default(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("TRIPO_GENERATION_MODEL", "")
    assert Tripo3DGenerationProvider().model == "v3.1-20260211"
