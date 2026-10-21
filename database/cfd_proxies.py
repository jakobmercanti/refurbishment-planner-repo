"""Application-owned catalogue CFD eligibility; never modifies product dimensions."""

from sqlalchemy import select
from sqlalchemy.orm import Session

from database.models import FurnitureItemRecord
from geometry.balustrades import BALUSTRADE_STYLES
from geometry.cfd import CfdProxySpec


def cfd_proxy_for(category: str, kind: str, representation: str) -> dict[str, object] | None:
    key = representation or ""
    if (
        kind in ("DOOR", "WINDOW")
        or category == "electric"
        or category.startswith(("doors", "windows", "staircases"))
        or key.startswith(("electrical-", "door-", "window-", "furniture-stair-"))
    ):
        return None
    if key.startswith("balustrade-") and kind == "FURNITURE":
        profile = next((style["cfdProfile"] for style in BALUSTRADE_STYLES if style["key"] == key), None)
        if profile is None:
            return None
    elif key in ("people-standing", "people-seated", "people-lying") and kind == "FURNITURE":
        profile = key
    elif kind == "SHOWER":
        profile = {
            "shower-walk-in": "shower-screen",
            "shower-wet-room": "shower-wet-room",
            "shower-alcove": "shower-alcove",
            "shower-quadrant": "shower-quadrant",
            "shower-freestanding": "shower-enclosed",
        }.get(key, "shower-corner")
    elif kind == "TOILET":
        profile = "toilet-wall" if "wall-mounted" in key else "toilet" if "close-coupled" in key else "toilet-low"
    elif kind == "BASIN":
        profile = (
            "block"
            if any(p in key for p in ("vanity", "undermount"))
            else "pedestal-basin"
            if "pedestal" in key
            else "basin-corner"
            if "corner" in key
            else "basin"
        )
    elif kind != "FURNITURE":
        return None
    elif key.startswith("furniture-table-") or category in ("living-tables", "bedroom-tables"):
        profile = "table"
    elif key.startswith("furniture-chair-") or category in ("living-chairs", "bedroom-chairs"):
        profile = (
            "stool"
            if "stool" in key
            else "chair-open"
            if key.rsplit("-", 1)[-1] in ("classic", "wishbone", "ladder", "crossback")
            else "chair"
        )
    elif key.startswith("furniture-sofa-") and "corner" in key:
        profile = "sofa-left" if "left" in key else "sofa-right"
    elif key.startswith("furniture-armchair-") or category == "living-armchairs":
        profile = "armchair"
    elif key.startswith("furniture-sofa-") or category == "living-sofas":
        profile = "sofa"
    elif key.startswith("furniture-bed-") or category == "bedroom-beds":
        profile = "bed"
    elif key.startswith("furniture-bath-") or category == "baths":
        profile = (
            "bath-corner"
            if "corner" in key
            else "bath-raised"
            if "slipper" in key
            else "bath-oval"
            if "oval" in key
            else "bath"
        )
    else:
        profile = "block"
    return CfdProxySpec.model_validate({"profile": profile}).model_dump()


def seed_cfd_proxies(session: Session) -> int:
    changed = 0
    for item in session.scalars(select(FurnitureItemRecord)).all():
        spec = cfd_proxy_for(item.category_id, item.fixture_kind, item.representation_key)
        if item.cfd_proxy != spec:
            item.cfd_proxy = spec
            changed += 1
    return changed
