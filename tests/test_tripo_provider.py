"""Focused tests for request mapping and safe Tripo result retrieval."""

from __future__ import annotations

import io
import json
from typing import Any

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
