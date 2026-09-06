"""Install versioned rendered previews without replacing supplier photographs."""
import base64
import hashlib
import json
from pathlib import Path

from sqlalchemy import select

from database.models import FurnitureItemRecord
from database.fixture_defaults import FIXTURE_DEFAULTS
from database.catalogue_assets import decode_picture, stage_item_picture_replacement

REPRESENTATION_VERSION = 2
KNOWN_KEYS = {f"{kind.lower()}-{variant[0]}" for kind, variants in FIXTURE_DEFAULTS.values() for variant in variants}


def install_fixture_previews(session):
    replacements = []
    try:
        for item in session.scalars(select(FurnitureItemRecord)).all():
            if not item.default_key or not item.default_key.startswith("generic-") or item.stl_base64:
                continue
            if item.representation_key not in KNOWN_KEYS:
                continue
            path = Path(__file__).resolve().parents[1] / "frontend/public/fixture-previews" / f"{item.representation_key}.png"
            if not path.is_file():
                continue
            item.representation_version = REPRESENTATION_VERSION
            previous = json.loads(item.image_data_json or "[]")
            if previous and not all(record.get("generated_representation") for record in previous):
                continue
            data = path.read_bytes()
            digest = hashlib.sha256(data).hexdigest()
            if previous and previous[0].get("sha256") == digest:
                continue
            validated, mime, extension = decode_picture("data:image/png;base64," + base64.b64encode(data).decode("ascii"))
            replacement = stage_item_picture_replacement(item.id, [(validated, mime, extension, f"{item.name} — rendered model preview")])
            replacements.append(replacement)
            replacement.metadata[0].update(generated_representation=REPRESENTATION_VERSION, sha256=digest)
            item.image_data_json = json.dumps(replacement.metadata)
        session.commit()
    except Exception:
        session.rollback()
        for replacement in reversed(replacements):
            replacement.rollback()
        raise
    for replacement in replacements:
        replacement.finalize_best_effort()
