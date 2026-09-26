"""Additive electrical catalogue defaults; shared dimensions remain in millimetres."""
from __future__ import annotations

import base64
import json
from pathlib import Path

from sqlalchemy import select
from database.models import FurnitureCategoryRecord, FurnitureItemRecord

ELECTRICAL_ASSETS = json.loads(
    (Path(__file__).resolve().parents[1] / "frontend/lib/electricalAssets.json").read_text(encoding="utf-8")
)


def _plan_symbol(asset: dict) -> str:
    """Embed self-contained plan symbols so exports do not rely on remote images."""
    key = asset["key"]
    family = asset["subcategory"]
    stroke = 'fill="none" stroke="#071B38" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"'
    if family == "Switches":
        content = '<circle cx="50" cy="55" r="20"/><path d="M64 40 85 16"/>'
        if key.endswith("double"):
            content += '<path d="M68 50 91 25"/>'
        if key.endswith("pull"):
            content += '<path stroke-dasharray="4 4" d="M50 0V30"/><circle cx="50" cy="55" r="5"/>'
        if key.endswith("dimmer"):
            content += '<path d="m30 70 40-30"/>'
    elif family == "Sockets":
        content = '<rect x="8" y="8" width="84" height="84" rx="9"/>'
        centres = (50,) if key.endswith("single") else (30, 70)
        content += "".join(f'<path d="M{x} 26v14m-9 16h5m8 0h5"/>' for x in centres)
        if key.endswith("usb"):
            content += '<rect x="36" y="72" width="13" height="7"/><rect x="58" y="72" width="8" height="7" rx="3"/>'
    elif family in ("Ceiling lights", "Pendants", "Wall lights"):
        content = ('<rect x="10" y="10" width="80" height="80" rx="4"/>' if key.endswith(("square", "linear")) else '<circle cx="50" cy="50" r="39"/>')
        content += '<path d="m24 24 52 52m0-52L24 76"/>'
        if family == "Wall lights":
            content += '<path d="M4 5v90"/>'
        if family == "Pendants":
            content += '<circle cx="50" cy="50" r="8"/>'
    elif family == "CO and fume sensors":
        label = "CO" if key.endswith("co") else "H" if key.endswith("heat") else "S"
        content = f'<circle cx="50" cy="50" r="40"/><text x="50" y="61" text-anchor="middle" font-family="sans-serif" font-size="30" fill="#071B38" stroke="none">{label}</text>'
    elif family == "Extractor fans":
        content = '<rect x="7" y="7" width="86" height="86" rx="5"/>'
        # Repeat one smooth blade by exact quarter-turns for four-way symmetry.
        blade = '<path d="M54 47 C59 38 68 19 77 17 C86 16 88 25 82 32 C76 39 63 47 53 52 Z"/>'
        content += ''.join(f'<g transform="rotate({angle} 50 50)">{blade}</g>' for angle in (0, 90, 180, 270))
        content += '<circle cx="50" cy="50" r="8" fill="#fff"/>'
    else:
        content = '<rect x="7" y="7" width="86" height="86" rx="4"/><path d="M15 35h70M15 70h70"/>'
        content += "".join(f'<rect x="{x}" y="44" width="8" height="18"/>' for x in range(17, 80, 13))
    svg = f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><g {stroke}>{content}</g></svg>'
    return "data:image/svg+xml;base64," + base64.b64encode(svg.encode()).decode()


def seed_electrical_defaults(session) -> None:
    category = session.get(FurnitureCategoryRecord, "electric")
    if category is None:
        session.add(FurnitureCategoryRecord(
            id="electric", name="Electrical", description="Hardwired electrical fittings, lighting and ventilation.",
            sort_order=120, default_side_clearance_mm=0, default_front_clearance_mm=0,
        ))
    elif category.name == "Electric":
        category.name = "Electrical"
        category.description = "Hardwired electrical fittings, lighting and ventilation."
    session.flush()
    for asset in ELECTRICAL_ASSETS:
        default_key = "generic-" + asset["key"]
        existing = session.scalar(select(FurnitureItemRecord).where(FurnitureItemRecord.default_key == default_key))
        if existing:
            # Upgrade the original cooker-hood icon in existing installations.
            if asset["key"] == "electrical-fan-hood" and existing.representation_version < 2:
                existing.plan_symbol_data_url = _plan_symbol(asset)
                existing.representation_version = 2
            continue  # Retain edits to dimensions, appearance, descriptions and visibility.
        session.add(FurnitureItemRecord(
            id=default_key, default_key=default_key, is_default=True, category_id="electric",
            fixture_kind="FURNITURE", name=asset["name"], supplier="FreeFloorplan3D",
            sku=asset["key"].upper(), subcategory=asset["subcategory"], representation_key=asset["key"],
            representation_version=2 if asset["key"] == "electrical-fan-hood" else 1,
            plan_symbol_url="", plan_symbol_data_url=_plan_symbol(asset),
            plan_shape="ELLIPSE" if asset["key"].endswith(("round", "downlight", "drum", "globe", "smoke", "heat", "pull")) else "RECTANGLE",
            width_mm=asset["width"], depth_mm=asset["depth"], height_mm=asset["height"],
            color_hex=asset["colour"], side_clearance_mm=0, front_clearance_mm=0,
            description=f'{asset["name"]}. Dedicated 3D model with matching plan symbol. {asset["mount"].capitalize()} mounted; dimensions and mounting height can be adjusted.',
            supplier_editable=True,
        ))
