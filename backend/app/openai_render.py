"""Worker-only image edit adapter. Project JSON and geometry are never sent to the provider."""

from __future__ import annotations

import base64
import io
import json
import os
import secrets
import warnings
from urllib.error import HTTPError, URLError
from urllib.request import ProxyHandler, Request, build_opener

from PIL import Image, UnidentifiedImageError


class RenderProviderError(RuntimeError):
    """A non-sensitive render error suitable for recording in the job ledger."""


MAX_REFERENCE_BYTES = 10 * 1024 * 1024
MAX_OUTPUT_BYTES = 50 * 1024 * 1024


def render_reference(
    reference: bytes, content_type: str, quality: str, prompt: str
) -> tuple[bytes, dict[str, int | str]]:
    api_key = os.getenv("OPENAI_API_KEY", "").strip()
    if not api_key:
        raise RenderProviderError("AI image generation is not configured.")
    if (
        quality not in {"medium", "high"}
        or content_type not in {"image/png", "image/jpeg", "image/webp"}
        or not 1 <= len(reference) <= MAX_REFERENCE_BYTES
    ):
        raise RenderProviderError("The render reference is invalid or too large.")
    try:
        with warnings.catch_warnings():
            warnings.simplefilter("error", Image.DecompressionBombWarning)
            with Image.open(io.BytesIO(reference)) as image:
                if image.width < 1 or image.height < 1 or image.width * image.height > 16_000_000:
                    raise RenderProviderError("The reference image dimensions are too large.")
                actual_content_type = (
                    {"PNG": "image/png", "JPEG": "image/jpeg", "WEBP": "image/webp"}.get(image.format)
                    if image.format
                    else None
                )
                if actual_content_type != content_type:
                    raise RenderProviderError("The reference image type does not match its upload declaration.")
                image.verify()
    except (UnidentifiedImageError, OSError, Image.DecompressionBombError, Image.DecompressionBombWarning):
        raise RenderProviderError("The reference file is not a supported image.") from None

    model = "gpt-image-2.5-flare" if quality == "medium" else "gpt-image-2.5-sunburst"
    safe_prompt = prompt.strip() or (
        "Create a polished, realistic interior-design visualization guided by this reference image. "
        "Keep this as a visual concept only; do not infer or alter measured dimensions, wall geometry, "
        "clearances, or fit decisions."
    )
    boundary = "----FreeFloorplan3D" + secrets.token_hex(18)
    filename = {"image/png": "reference.png", "image/jpeg": "reference.jpg", "image/webp": "reference.webp"}[
        content_type
    ]
    fields = [
        ("model", model),
        ("prompt", safe_prompt[:1000]),
        ("quality", quality),
        ("size", "1024x1024"),
        ("output_format", "webp"),
    ]
    chunks: list[bytes] = []
    for key, value in fields:
        chunks.extend((f'--{boundary}\r\nContent-Disposition: form-data; name="{key}"\r\n\r\n{value}\r\n'.encode(),))
    chunks.extend(
        (
            (
                f'--{boundary}\r\nContent-Disposition: form-data; name="image"; filename="{filename}"\r\n'
                f"Content-Type: {content_type}\r\n\r\n"
            ).encode(),
            reference,
            f"\r\n--{boundary}--\r\n".encode(),
        )
    )
    body = b"".join(chunks)
    request = Request(
        "https://api.openai.com/v1/images/edits",
        data=body,
        method="POST",
        headers={
            "Authorization": f"Bearer {api_key}",
            "Content-Type": f"multipart/form-data; boundary={boundary}",
            "Accept": "application/json",
        },
    )
    opener = build_opener(ProxyHandler({}))
    try:
        with opener.open(request, timeout=240) as response:
            payload = response.read(80 * 1024 * 1024 + 1)
    except HTTPError as error:
        # The provider response can contain prompts or account metadata.
        raise RenderProviderError(f"The image provider returned HTTP {error.code}.") from None
    except (URLError, TimeoutError, OSError):
        raise RenderProviderError("The image provider could not be reached.") from None
    if len(payload) > 80 * 1024 * 1024:
        raise RenderProviderError("The provider image exceeded the response size limit.")
    try:
        result = json.loads(payload)
        encoded = result["data"][0]["b64_json"]
        image_bytes = base64.b64decode(encoded, validate=True)
    except (json.JSONDecodeError, KeyError, IndexError, TypeError, ValueError):
        raise RenderProviderError("The image provider returned an invalid image response.") from None
    if not 1 <= len(image_bytes) <= MAX_OUTPUT_BYTES:
        raise RenderProviderError("The generated image exceeded the output size limit.")
    try:
        with warnings.catch_warnings():
            warnings.simplefilter("error", Image.DecompressionBombWarning)
            with Image.open(io.BytesIO(image_bytes)) as image:
                if image.width > 4096 or image.height > 4096 or image.width < 1 or image.height < 1:
                    raise RenderProviderError("The generated image dimensions are invalid.")
                image.load()
                normalized = io.BytesIO()
                image.convert("RGB").save(normalized, format="WEBP", quality=88, method=5)
                output = normalized.getvalue()
    except (UnidentifiedImageError, OSError, Image.DecompressionBombError, Image.DecompressionBombWarning):
        raise RenderProviderError("The provider returned an unsupported image.") from None
    if not 1 <= len(output) <= MAX_OUTPUT_BYTES:
        raise RenderProviderError("The generated image exceeded the storage limit.")
    usage = result.get("usage") if isinstance(result, dict) else None
    safe_usage: dict[str, int | str] = {"model": model, "quality": quality}
    if isinstance(usage, dict):
        for key in ("input_tokens", "output_tokens", "total_tokens"):
            token_count = usage.get(key)
            if isinstance(token_count, int) and token_count >= 0:
                safe_usage[key] = token_count
    return output, safe_usage
