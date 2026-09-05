"""Idempotent generic fixtures; editable dimensions are never manufacturer claims.

Representation keys identify versioned parametric models and their matching plan
symbols. Manufacturer products can reuse a key and supply their own dimensions,
photographs and STL without changing the category/subcategory hierarchy.
"""
from sqlalchemy import select
from database.models import FurnitureItemRecord

FIXTURE_DEFAULTS = {
    "showers": ("SHOWER", [
        ("corner", "Corner", 900, 900, 2000),
        ("quadrant", "Quadrant", 900, 900, 2000),
        ("walk-in", "Walk-in", 1200, 800, 2000),
        ("alcove", "Alcove", 1200, 800, 2000),
        ("freestanding", "Freestanding", 1000, 1000, 2100),
        ("wet-room", "Wet room", 1200, 900, 2000),
    ]),
    "basins": ("BASIN", [
        ("wall-mounted", "Wall mounted", 550, 450, 850),
        ("pedestal", "Pedestal", 550, 450, 850),
        ("countertop", "Countertop / vessel", 500, 400, 850),
        ("undermount", "Undermount", 550, 450, 850),
        ("vanity", "Vanity", 600, 500, 850),
        ("double-vanity", "Double vanity", 1200, 500, 850),
        ("corner", "Corner", 450, 450, 850),
    ]),
    "toilets": ("TOILET", [
        ("freestanding", "Freestanding", 380, 600, 420),
        ("wall-mounted", "Wall mounted", 360, 540, 420),
        ("close-coupled", "Close coupled", 380, 650, 800),
        ("back-to-wall", "Back to wall", 360, 560, 420),
    ]),
}

# Keep old IDs and customisations; classify legacy products once.
LEGACY = {
    "RF-SH-800": ("Corner", "shower-corner"), "RF-SH-900": ("Corner", "shower-corner"),
    "RF-SH-1200": ("Walk-in", "shower-walk-in"),
    "RF-BA-450": ("Wall mounted", "basin-wall-mounted"),
    "RF-VA-600": ("Vanity", "basin-vanity"), "RF-VA-1200": ("Double vanity", "basin-double-vanity"),
    "RF-WC-360": ("Wall mounted", "toilet-wall-mounted"),
    "RF-WC-365": ("Freestanding", "toilet-freestanding"),
    "RF-WC-380": ("Close coupled", "toilet-close-coupled"),
}


def seed_fixture_defaults(session):
    session.flush()
    for item in session.scalars(select(FurnitureItemRecord)).all():
        if item.representation_key and not item.plan_symbol_url:
            item.plan_symbol_url = f"/fixture-symbols/{item.representation_key}.svg"
        if item.default_key in LEGACY and not item.representation_key:
            subcategory, key = LEGACY[item.default_key]
            if item.subcategory in ("General", "Enclosures", "Basins and vanities", "Toilets"):
                item.subcategory = subcategory
            item.representation_key = key
            item.plan_symbol_url = f"/fixture-symbols/{key}.svg"
    for category, (kind, variants) in FIXTURE_DEFAULTS.items():
        for slug, subcategory, width, depth, height in variants:
            key = f"{kind.lower()}-{slug}"
            if session.scalar(select(FurnitureItemRecord.id).where(FurnitureItemRecord.default_key == f"generic-{key}")):
                continue
            session.add(FurnitureItemRecord(
                id=f"generic-{key}", default_key=f"generic-{key}", is_default=True,
                category_id=category, fixture_kind=kind, name="Default", supplier="Renovation Fit",
                sku=f"GENERIC-{key.upper()}", subcategory=subcategory, representation_key=key,
                plan_symbol_url=f"/fixture-symbols/{key}.svg",
                width_mm=width, depth_mm=depth, height_mm=height, color_hex="#F4F3EE",
                description="Generic parametric fixture with matching architectural plan symbol. Set dimensions for your design; not a certified manufacturer drawing.",
                supplier_editable=True, plan_shape="RECTANGLE",
            ))
