"""Additive railing modules, also used by the floor-opening guard editor."""

from sqlalchemy import select
from sqlalchemy.orm import Session

from database.models import FurnitureItemRecord
from geometry.balustrades import BALUSTRADE_STYLES


def seed_balustrade_defaults(session: Session) -> int:
    changed = 0
    for style in BALUSTRADE_STYLES:
        key = style["key"]
        identifier = f"generic-{key}"
        if session.scalar(select(FurnitureItemRecord.id).where(FurnitureItemRecord.default_key == identifier)):
            continue
        session.add(
            FurnitureItemRecord(
                id=identifier,
                default_key=identifier,
                is_default=True,
                category_id="balustrades",
                fixture_kind="FURNITURE",
                name=f"{style['name']} balustrade",
                supplier="Renovation Fit",
                sku=identifier.upper(),
                subcategory=style["name"],
                representation_key=key,
                width_mm=1000,
                depth_mm=style["depthMm"],
                height_mm=1100,
                color_hex=style["colour"],
                plan_shape="RECTANGLE",
                plan_symbol_url=f"/fixture-symbols/{key}.svg",
                supplier_editable=True,
                description="Generic 1 m balustrade section. Also available around slab openings in Floor properties. "
                "Display and coarse CFD obstruction only; not certified guarding or a structural specification.",
            )
        )
        changed += 1
    return changed
