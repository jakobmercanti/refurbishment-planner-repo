"""Bounded, non-authoritative catalogue picture storage."""

from __future__ import annotations

import base64
import binascii
from dataclasses import dataclass
from io import BytesIO
import json
import os
import re
import shutil
import warnings
from pathlib import Path
from uuid import uuid4

from PIL import Image, ImageFile, UnidentifiedImageError

MAX_PICTURE_BYTES = 500_000
MAX_PICTURES = 3
MAX_IMAGE_DIMENSION = 4096
MAX_IMAGE_PIXELS = 16_000_000
_DATA_URL = re.compile(r"^data:(image/(?:jpeg|png|webp));base64,(.+)$", re.I | re.S)
_EXTENSIONS = {"image/jpeg": "jpg", "image/png": "png", "image/webp": "webp"}


def asset_root() -> Path:
    configured = os.environ.get("RENOVATION_FIT_DATABASE")
    project_root = Path(__file__).resolve().parents[1]
    database_file = Path(configured) if configured else project_root / "data" / "renovation_fit.sqlite3"
    root = database_file.resolve().parent / "catalogue-assets"
    root.mkdir(parents=True, exist_ok=True)
    return root


def decode_picture(data_url: str) -> tuple[bytes, str, str]:
    match = _DATA_URL.fullmatch(data_url)
    if not match:
        raise ValueError("picture must be a JPEG, PNG or WebP data URL")
    content_type = match.group(1).lower()
    try:
        data = base64.b64decode(match.group(2), validate=True)
    except binascii.Error as error:
        raise ValueError("invalid base64 picture data") from error
    if len(data) > MAX_PICTURE_BYTES:
        raise ValueError("each catalogue picture must be 500 KB or smaller")
    signatures = {
        "image/jpeg": data.startswith(b"\xff\xd8\xff"),
        "image/png": data.startswith(b"\x89PNG\r\n\x1a\n"),
        "image/webp": len(data) >= 12 and data.startswith(b"RIFF") and data[8:12] == b"WEBP",
    }
    if not signatures[content_type]:
        raise ValueError("picture bytes do not match the declared image type")
    expected_format = {"image/jpeg": "JPEG", "image/png": "PNG", "image/webp": "WEBP"}[content_type]
    try:
        ImageFile.LOAD_TRUNCATED_IMAGES = False
        with warnings.catch_warnings():
            warnings.simplefilter("error", Image.DecompressionBombWarning)
            with Image.open(BytesIO(data)) as image:
                width, height = image.size
                if image.format != expected_format:
                    raise ValueError("picture bytes do not match the declared image type")
                if width <= 0 or height <= 0 or width > MAX_IMAGE_DIMENSION or height > MAX_IMAGE_DIMENSION:
                    raise ValueError(f"picture dimensions must not exceed {MAX_IMAGE_DIMENSION} by {MAX_IMAGE_DIMENSION} pixels")
                if width * height > MAX_IMAGE_PIXELS:
                    raise ValueError(f"picture must contain no more than {MAX_IMAGE_PIXELS:,} pixels")
                image.verify()
            with Image.open(BytesIO(data)) as image:
                image.load()
    except ValueError:
        raise
    except (Image.DecompressionBombError, Image.DecompressionBombWarning, OSError, SyntaxError, UnidentifiedImageError) as error:
        raise ValueError("picture is corrupt or incomplete") from error
    return data, content_type, _EXTENSIONS[content_type]


def picture_metadata(item_id: str, index: int, filename: str, alt: str, content_type: str, size_bytes: int) -> dict[str, object]:
    return {
        "url": f"/catalog/items/{item_id}/images/{index}",
        "filename": filename,
        "alt": alt,
        "content_type": content_type,
        "size_bytes": size_bytes,
    }


@dataclass
class PictureReplacement:
    metadata: list[dict[str, object]]
    target: Path
    backup: Path | None

    def rollback(self) -> None:
        """Restore the pre-swap files after a database rollback."""
        if self.target.exists():
            shutil.rmtree(self.target)
        if self.backup is not None and self.backup.exists():
            os.replace(self.backup, self.target)

    def finalize(self) -> None:
        """Discard the recoverable backup only after the database commit."""
        if self.backup is not None and self.backup.exists():
            shutil.rmtree(self.backup)

    def finalize_best_effort(self) -> None:
        try:
            self.finalize()
        except OSError:
            # Hidden backup directories are harmless and can be retried/cleaned later.
            pass


def stage_item_picture_replacement(item_id: str, pictures: list[tuple[bytes, str, str, str]]) -> PictureReplacement:
    """Swap staged pictures into place while retaining a rollback backup."""
    if len(pictures) > MAX_PICTURES:
        raise ValueError("each item can have up to three pictures")
    root = asset_root()
    target = root / item_id
    staging = root / f".{item_id}-{uuid4().hex}.tmp"
    backup = root / f".{item_id}-{uuid4().hex}.bak"
    metadata: list[dict[str, object]] = []
    try:
        if pictures:
            staging.mkdir(parents=True)
        for index, (data, content_type, extension, alt) in enumerate(pictures):
            filename = f"{index}.{extension}"
            temporary = staging / f"{filename}.tmp"
            temporary.write_bytes(data)
            os.replace(temporary, staging / filename)
            metadata.append(picture_metadata(item_id, index, filename, alt, content_type, len(data)))
        if target.exists():
            os.replace(target, backup)
        if pictures:
            os.replace(staging, target)
        return PictureReplacement(metadata=metadata, target=target, backup=backup if backup.exists() else None)
    except Exception:
        if staging.exists():
            shutil.rmtree(staging)
        if backup.exists() and not target.exists():
            os.replace(backup, target)
        raise


def replace_item_pictures(item_id: str, pictures: list[tuple[bytes, str, str, str]]) -> list[dict[str, object]]:
    """Immediately replace pictures for migration callers without a database transaction."""
    replacement = stage_item_picture_replacement(item_id, pictures)
    replacement.finalize_best_effort()
    return replacement.metadata


def remove_item_pictures(item_id: str) -> None:
    directory = asset_root() / item_id
    if directory.exists():
        shutil.rmtree(directory)


def migrate_legacy_pictures(item_id: str, raw_json: str | None) -> str:
    try:
        records = json.loads(raw_json or "[]")
    except json.JSONDecodeError:
        return "[]"
    if not isinstance(records, list) or not records:
        return "[]"
    if all(isinstance(record, dict) and record.get("url") and not record.get("data_url") for record in records):
        return json.dumps(records)
    pictures: list[tuple[bytes, str, str, str]] = []
    try:
        for record in records[:MAX_PICTURES]:
            if not isinstance(record, dict) or not isinstance(record.get("data_url"), str):
                continue
            data, content_type, extension = decode_picture(record["data_url"])
            pictures.append((data, content_type, extension, str(record.get("alt") or "Catalogue picture")[:200]))
        return json.dumps(replace_item_pictures(item_id, pictures))
    except (OSError, ValueError):
        return "[]"
