"""Additive catalogue upgrade, sharing the same published dataset as Heating Layout."""
import json
from pathlib import Path
from sqlalchemy import select
from database.models import FurnitureCategoryRecord, FurnitureItemRecord
from geometry.heating import HeatingElementSpec

def seed_heating_defaults(session):
    if session.get(FurnitureCategoryRecord, "heating") is None:
        session.add(FurnitureCategoryRecord(id="heating", name="Heating elements", description="Radiators and fan-assisted emitters with editable thermal specifications.", sort_order=113, default_side_clearance_mm=0, default_front_clearance_mm=0))
    if session.get(FurnitureCategoryRecord, "heating-boilers") is None:
        session.add(FurnitureCategoryRecord(id="heating-boilers", name="Boilers", description="Heat generators, not room emitters. Central-heating capacities from manufacturer data.", sort_order=114, default_side_clearance_mm=0, default_front_clearance_mm=0))
    session.flush()
    products = json.loads((Path(__file__).resolve().parents[1] / "frontend/lib/heatingProducts.json").read_text(encoding="utf-8"))
    for product in products:
        identifier = "heating-" + product["catalogueId"]
        if session.get(FurnitureItemRecord, identifier):
            continue  # Preserve user modifications to installed catalogues.
        spec = HeatingElementSpec.model_validate({**product, "catalogueItemId": identifier}).model_dump(exclude_none=True)
        session.add(FurnitureItemRecord(id=identifier, category_id="heating-boilers" if product["category"] == "Boiler" else "heating", fixture_kind="FURNITURE", name=product["model"], supplier=product["manufacturer"], sku=product["catalogueId"], width_mm=product["widthMm"], depth_mm=product["depthMm"], height_mm=product["heightMm"], color_hex="#FFFFFF", description="Published reference data; check operating conditions and current manufacturer specification.", is_default=True, default_key=identifier, subcategory="System boilers" if product["category"] == "Boiler" else product["emitterTechnology"], representation_key="heating-boiler" if product["category"] == "Boiler" else "furniture-radiator-horizontal-2-1000", heating_spec=spec))
    estimates = json.loads((Path(__file__).resolve().parents[1] / "frontend/lib/heatingEstimates.json").read_text(encoding="utf-8"))
    for item in session.scalars(select(FurnitureItemRecord).where((FurnitureItemRecord.category_id.like("radiators-%")) | (FurnitureItemRecord.category_id == "heating"))):
        if item.heating_spec is None:
            item.heating_spec = HeatingElementSpec(model=item.name, category="Towel" if item.category_id == "radiators-bathroom" else "Custom").model_dump(exclude_none=True)
        if item.heating_spec.get("ratedOutputW") is None and not item.heating_spec.get("manufacturerPerformanceData") and item.heating_spec.get("emitterTechnology") != "Electric":
            item.heating_spec = {**item.heating_spec, "ratedOutputW": max(1, round(estimates["referenceOutputW"] * item.width_mm / estimates["referenceWidthMm"] * item.height_mm / estimates["referenceHeightMm"])), "estimatedOutput": True, "performanceReference": estimates["reference"]}
