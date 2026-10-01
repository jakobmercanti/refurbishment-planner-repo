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
        rocker_count = {"electrical-switch-double": 2, "electrical-switch-triple": 3, "electrical-switch-quadruple": 4}.get(key, 1)
        for index in range(1, rocker_count):
            content += f'<path d="M{64 + index * 4} {40 + index * 9} {85 + index * 3} {16 + index * 9}"/>'
        if key.endswith("pull"):
            content += '<path stroke-dasharray="4 4" d="M50 0V30"/><circle cx="50" cy="55" r="5"/>'
        if "switch-dimmer" in key:
            content += '<path d="m30 70 40-30"/>'
            if key.endswith("double"):
                content += '<circle cx="75" cy="75" r="16"/><path d="M75 62v9"/>'
    elif family == "Sockets":
        content = '<rect x="8" y="8" width="84" height="84" rx="9"/>'
        centres = (50,) if key.endswith("single") else (30, 70)
        content += "".join(f'<path d="M{x} 26v14m-9 16h5m8 0h5"/>' for x in centres)
        if key.endswith("usb"):
            content += '<rect x="36" y="72" width="13" height="7"/><rect x="58" y="72" width="8" height="7" rx="3"/>'
    elif family in ("Ceiling lights", "Pendants") or key.startswith("electrical-wall-"):
        content = ('<rect x="10" y="10" width="80" height="80" rx="4"/>' if key.endswith(("square", "linear")) else '<circle cx="50" cy="50" r="39"/>')
        content += '<path d="m24 24 52 52m0-52L24 76"/>'
        if key.startswith("electrical-wall-"):
            content += '<path d="M4 5v90"/>'
        if family == "Pendants":
            content += '<circle cx="50" cy="50" r="8"/>'
    elif family == "CO and fume sensors":
        label = "CO" if key.endswith("co") else "H" if key.endswith("heat") else "S"
        content = f'<circle cx="50" cy="50" r="40"/><text x="50" y="61" text-anchor="middle" font-family="sans-serif" font-size="30" fill="#071B38" stroke="none">{label}</text>'
    elif family == "Extractor fans":
        content = '<rect x="7" y="7" width="86" height="86" rx="5"/>'
        # Keep the symbol inside the sanitizer's inert SVG subset: transforms
        # are deliberately unsupported for catalogue-provided plan symbols.
        blades = (
            "M44 44 C38 32 38 14 50 14 C62 14 62 32 56 44 Z",
            "M56 44 C68 38 86 38 86 50 C86 62 68 62 56 56 Z",
            "M56 56 C62 68 62 86 50 86 C38 86 38 68 44 56 Z",
            "M44 56 C32 62 14 62 14 50 C14 38 32 38 44 44 Z",
        )
        content += "".join(f'<path d="{blade}"/>' for blade in blades)
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
            # Update only untouched legacy switch finishes. Saved placements
            # and catalogue entries with custom colours retain their appearance.
            legacy_switch_colours = {
                "electrical-switch-single": "#F4F3EE",
                "electrical-switch-double": "#F4F3EE",
                "electrical-switch-dimmer": "#ADB3B6",
            }
            legacy_colour = legacy_switch_colours.get(asset["key"])
            if legacy_colour and existing.representation_version < 2:
                if (existing.color_hex or "").upper() == legacy_colour:
                    existing.color_hex = asset["colour"]
                existing.representation_version = 2
            # Replace older fan icons with the centred, mirror-symmetric face.
            # Paths stay inside the sanitizer's inert, transform-free subset.
            if asset["subcategory"] == "Extractor fans" and existing.representation_version < 4:
                existing.plan_symbol_data_url = _plan_symbol(asset)
                existing.representation_version = 4
            continue  # Retain edits to dimensions, appearance, descriptions and visibility.
        session.add(FurnitureItemRecord(
            id=default_key, default_key=default_key, is_default=True, category_id="electric",
            fixture_kind="FURNITURE", name=asset["name"], supplier="FreeFloorplan3D",
            sku=asset["key"].upper(), subcategory=asset["subcategory"], representation_key=asset["key"],
            representation_version=4 if asset["subcategory"] == "Extractor fans" else 2 if asset["key"].startswith("electrical-switch-") and not asset["key"].endswith("pull") else 1,
            plan_symbol_url="", plan_symbol_data_url=_plan_symbol(asset),
            plan_shape="ELLIPSE" if asset["key"].endswith(("round", "downlight", "drum", "globe", "cone", "cage", "smoke", "heat", "pull")) else "RECTANGLE",
            width_mm=asset["width"], depth_mm=asset["depth"], height_mm=asset["height"],
            color_hex=asset["colour"], side_clearance_mm=0, front_clearance_mm=0,
            description=f'{asset["name"]}. Dedicated 3D model with matching plan symbol. {asset["mount"].capitalize()} mounted; dimensions and mounting height can be adjusted.',
            supplier_editable=True,
        ))
