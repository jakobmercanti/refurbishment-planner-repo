"""Additive occupant catalogue; never overwrite user-edited records."""

from sqlalchemy import select
from sqlalchemy.orm import Session

from database.models import FurnitureItemRecord
from geometry.people import PERSON_MODELS, STATURE_PRESETS, person_dimensions


def seed_people_defaults(session: Session) -> int:
    changed = 0
    for model in PERSON_MODELS:
        for stature in STATURE_PRESETS:
            identifier = f"generic-{model['key']}-{stature}"
            if session.scalar(select(FurnitureItemRecord.id).where(FurnitureItemRecord.default_key == identifier)):
                continue
            width, depth, height = person_dimensions(stature, model["posture"])
            session.add(
                FurnitureItemRecord(
                    id=identifier,
                    default_key=identifier,
                    is_default=True,
                    category_id="people",
                    fixture_kind="FURNITURE",
                    name=f"{model['label']} person · {stature} mm stature",
                    supplier="Renovation Fit",
                    sku=identifier.upper(),
                    subcategory=model["label"],
                    representation_key=model["key"],
                    width_mm=width,
                    depth_mm=depth,
                    height_mm=height,
                    color_hex="#426A83",
                    plan_shape="RECTANGLE",
                    plan_symbol_url=f"/fixture-symbols/{model['key']}.svg",
                    description=(
                        "Generic occupant for display and CFD obstruction preparation. "
                        "Stature is standing body height; listed dimensions are the posed envelope. "
                        "Casual, Smart and Mannequin display styles are available. "
                        "Not ergonomic certification or a thermal/metabolic boundary condition."
                    ),
                    supplier_editable=True,
                )
            )
            changed += 1
    return changed
