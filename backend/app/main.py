"""HTTP adapter for deterministic fit verification."""

from __future__ import annotations

from datetime import UTC, datetime
from itertools import pairwise
from pathlib import Path
from typing import Annotated
from uuid import UUID, uuid4

from fastapi import Body, Depends, FastAPI, Header, HTTPException, Query, Response
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from sqlalchemy import func, or_, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from backend.app.schemas import (
    CADResponse,
    CatalogueCategoryResponse,
    CatalogueItemInput,
    CatalogueItemResponse,
    DemoResponse,
    FitRequest,
    GeometryInvalidation,
    PolygonUpdate,
    ProjectFloorplanResponse,
    ProjectCreate,
    ProjectResponse,
    RoomValidationResponse,
    WallSummary,
)
from backend.app.floorplan_recognition import recognise_rooms
from cad.generator import generate_cad
from database.catalog import catalogue_session, initialise_catalogue
from database.models import FurnitureCategoryRecord, FurnitureItemRecord
from geometry.engine import check_fit
from geometry.fixtures import build_l_shaped_fixture
from geometry.layout_engine import analyse_layout
from geometry.models import FitResult, GenericOpening, LayoutResult, ObstacleDefinition, Placement, RoomDefinition
from geometry.shapes import obstacle_footprint
from geometry.walls import PolygonValidationError, derive_walls, room_polygon

app = FastAPI(
    title="Renovation Fit API",
    version="0.1.0",
    description="Deterministic millimetre-based spatial fit verification",
)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000"],
    allow_credentials=False,
    allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE"],
    allow_headers=["Content-Type", "X-Filename"],
)
initialise_catalogue()

projects: dict[UUID, ProjectResponse] = {}
rooms: dict[UUID, RoomDefinition] = {}
fit_results: dict[UUID, FitResult] = {}

CATEGORY_KINDS = {
    "showers": "SHOWER",
    "basins": "BASIN",
    "toilets": "TOILET",
    "storage": "FURNITURE",
}
CatalogueSession = Annotated[Session, Depends(catalogue_session)]
CatalogueSearch = Annotated[str | None, Query(max_length=100)]


def catalogue_item_response(item: FurnitureItemRecord) -> CatalogueItemResponse:
    return CatalogueItemResponse(
        id=item.id,
        category_id=item.category_id,
        category_name=item.category.name,
        fixture_kind=item.fixture_kind,
        name=item.name,
        supplier=item.supplier,
        sku=item.sku,
        width_mm=item.width_mm,
        depth_mm=item.depth_mm,
        height_mm=item.height_mm,
        color_hex=item.color_hex,
        description=item.description,
        is_default=item.is_default,
        stl_filename=item.stl_filename,
        stl_base64=item.stl_base64,
        supplier_editable=item.supplier_editable,
        active=item.active,
        created_at=item.created_at,
        updated_at=item.updated_at,
    )


def validate_catalogue_category(session: Session, payload: CatalogueItemInput) -> FurnitureCategoryRecord:
    category = session.get(FurnitureCategoryRecord, payload.category_id)
    if category is None:
        raise HTTPException(status_code=422, detail="catalogue category not found")
    expected_kind = CATEGORY_KINDS.get(category.id)
    if expected_kind != payload.fixture_kind:
        raise HTTPException(status_code=422, detail=f"{category.name} entries must use fixture_kind {expected_kind}")
    return category


@app.exception_handler(PolygonValidationError)
async def polygon_validation_error(_request: object, error: PolygonValidationError) -> JSONResponse:
    return JSONResponse(status_code=422, content={"detail": str(error)})


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok", "engine": "deterministic", "unit": "mm"}


@app.post("/project-floorplan/detect", response_model=ProjectFloorplanResponse)
def detect_project_floorplan(
    document: bytes = Body(...),
    filename: str = Header("floorplan", alias="X-Filename"),
) -> ProjectFloorplanResponse:
    if len(document) > 25_000_000:
        raise HTTPException(status_code=413, detail="Floorplan files must be 25 MB or smaller.")
    try:
        width, height, rooms_detected = recognise_rooms(document, filename)
    except ValueError as error:
        raise HTTPException(status_code=422, detail=str(error)) from error
    return ProjectFloorplanResponse(
        source_width_px=width,
        source_height_px=height,
        rooms=[{"id": room.identifier, "name": room.name, "vertices": room.vertices, "area_px2": room.area_px2} for room in rooms_detected],
        warning="Detected outlines are drafts. Confirm the scale and edit the selected room before using it for fit decisions.",
    )


@app.post("/projects", response_model=ProjectResponse, status_code=201)
def create_project(payload: ProjectCreate) -> ProjectResponse:
    project = ProjectResponse(name=payload.name, created_at=datetime.now(UTC))
    projects[project.id] = project
    return project


@app.get("/projects/{project_id}", response_model=ProjectResponse)
def get_project(project_id: UUID) -> ProjectResponse:
    try:
        return projects[project_id]
    except KeyError as error:
        raise HTTPException(status_code=404, detail="project not found") from error


@app.post("/rooms", response_model=RoomDefinition, status_code=201)
def create_room(room: RoomDefinition) -> RoomDefinition:
    room_polygon(room)
    derive_walls(room)
    rooms[room.id] = room
    return room


def validate_room_draft(room: RoomDefinition) -> RoomValidationResponse:
    polygon = room_polygon(room)
    walls = derive_walls(room)
    wall_lookup = {wall.id: wall for wall in walls}
    invalidations: list[GeometryInvalidation] = []
    openings_by_wall: dict[str, list[GenericOpening]] = {}
    for opening in room.openings:
        wall = wall_lookup.get(opening.parent_wall_id)
        if wall is None:
            raise PolygonValidationError(f"opening {opening.id} references missing {opening.parent_wall_id}")
        if opening.offset_mm + opening.width.value > wall.length_mm:
            raise PolygonValidationError(
                f"opening {opening.id} ends at {opening.offset_mm + opening.width.value:.1f} mm, "
                f"beyond the {wall.length_mm:.1f} mm wall"
            )
        if opening.sill_height_mm + opening.height.value > room.wall_height.value:
            raise PolygonValidationError(
                f"opening {opening.id} top is {opening.sill_height_mm + opening.height.value:.1f} mm, "
                f"above the {room.wall_height.value:.1f} mm wall"
            )
        openings_by_wall.setdefault(opening.parent_wall_id, []).append(opening)
        reason = "Wall geometry changed; re-confirm the opening offset and width before fit analysis."
        invalidations.append(GeometryInvalidation(entity_id=opening.id, entity_type="OPENING", reason=reason))
    for wall_id, wall_openings in openings_by_wall.items():
        ordered = sorted(wall_openings, key=lambda item: item.offset_mm)
        for first, second in pairwise(ordered):
            if first.offset_mm + first.width.value > second.offset_mm:
                raise PolygonValidationError(f"openings {first.id} and {second.id} overlap on {wall_id}")
    for obstacle in room.obstacles:
        reason = (
            "Obstacle is partly outside the revised internal room polygon."
            if not polygon.covers(obstacle_footprint(obstacle))
            else "Room geometry changed; re-confirm the obstacle position before fit analysis."
        )
        invalidations.append(
            GeometryInvalidation(
                entity_id=obstacle.id,
                entity_type="OBSTACLE",
                reason=reason,
            )
        )
    warnings = ["Every saved polygon revision invalidates previous product placements and fit analyses."]
    if room.openings:
        warnings.append("Door and window wall associations require explicit re-verification.")
    return RoomValidationResponse(
        area_mm2=polygon.area,
        perimeter_mm=polygon.length,
        walls=[WallSummary(id=wall.id, start=wall.start, end=wall.end, length_mm=wall.length_mm) for wall in walls],
        invalidations=invalidations,
        warnings=warnings,
    )


@app.post("/rooms/validate", response_model=RoomValidationResponse)
def validate_room(room: RoomDefinition) -> RoomValidationResponse:
    return validate_room_draft(room)


@app.put("/rooms/{room_id}", response_model=RoomDefinition)
def save_room(room_id: UUID, room: RoomDefinition) -> RoomDefinition:
    if room.id != room_id:
        raise HTTPException(status_code=409, detail="room ID does not match request path")
    validate_room_draft(room)
    previous = rooms.get(room_id)
    next_version = max(room.version, previous.version + 1 if previous else room.version)
    saved = room.model_copy(update={"version": next_version, "updated_at": datetime.now(UTC)})
    rooms[room_id] = saved
    return saved


@app.get("/rooms/{room_id}", response_model=RoomDefinition)
def get_room(room_id: UUID) -> RoomDefinition:
    try:
        return rooms[room_id]
    except KeyError as error:
        raise HTTPException(status_code=404, detail="room not found") from error


@app.put("/rooms/{room_id}/polygon", response_model=RoomDefinition)
def update_room_polygon(room_id: UUID, payload: PolygonUpdate) -> RoomDefinition:
    existing = get_room(room_id)
    updated = existing.model_copy(
        update={"vertices": payload.vertices, "version": existing.version + 1, "updated_at": datetime.now(UTC)}
    )
    room_polygon(updated)
    rooms[room_id] = updated
    return updated


@app.post("/rooms/{room_id}/openings", response_model=RoomDefinition, status_code=201)
def add_opening(room_id: UUID, opening: GenericOpening) -> RoomDefinition:
    existing = get_room(room_id)
    updated = existing.model_copy(
        update={
            "openings": [*existing.openings, opening],
            "version": existing.version + 1,
            "updated_at": datetime.now(UTC),
        }
    )
    validate_room_draft(updated)
    rooms[room_id] = updated
    return updated


@app.post("/rooms/{room_id}/obstacles", response_model=RoomDefinition, status_code=201)
def add_obstacle(room_id: UUID, obstacle: ObstacleDefinition) -> RoomDefinition:
    existing = get_room(room_id)
    updated = existing.model_copy(
        update={
            "obstacles": [*existing.obstacles, obstacle],
            "version": existing.version + 1,
            "updated_at": datetime.now(UTC),
        }
    )
    rooms[room_id] = updated
    return updated


@app.post("/placements", response_model=Placement, status_code=201)
def validate_placement(placement: Placement) -> Placement:
    return placement


@app.post("/fit-checks", response_model=FitResult, status_code=201)
def run_fit_check(payload: FitRequest) -> FitResult:
    result = check_fit(payload.room, payload.product, payload.placement)
    analysis_id = uuid4()
    fit_results[analysis_id] = result
    return result


@app.post("/layout-checks", response_model=LayoutResult, status_code=201)
def run_layout_check(room: RoomDefinition) -> LayoutResult:
    return analyse_layout(room)


@app.get("/fit-checks/{analysis_id}", response_model=FitResult)
def get_fit_check(analysis_id: UUID) -> FitResult:
    try:
        return fit_results[analysis_id]
    except KeyError as error:
        raise HTTPException(status_code=404, detail="fit analysis not found") from error


@app.get("/catalog/categories", response_model=list[CatalogueCategoryResponse])
def list_catalogue_categories(session: CatalogueSession) -> list[CatalogueCategoryResponse]:
    rows = session.execute(
        select(FurnitureCategoryRecord, func.count(FurnitureItemRecord.id))
        .outerjoin(
            FurnitureItemRecord,
            (FurnitureItemRecord.category_id == FurnitureCategoryRecord.id) & FurnitureItemRecord.active,
        )
        .group_by(FurnitureCategoryRecord.id)
        .order_by(FurnitureCategoryRecord.sort_order)
    ).all()
    return [
        CatalogueCategoryResponse(
            id=category.id,
            name=category.name,
            description=category.description,
            item_count=count,
        )
        for category, count in rows
    ]


@app.get("/catalog/items", response_model=list[CatalogueItemResponse])
def list_catalogue_items(
    session: CatalogueSession,
    category_id: str | None = None,
    search: CatalogueSearch = None,
) -> list[CatalogueItemResponse]:
    statement = select(FurnitureItemRecord).where(FurnitureItemRecord.active).order_by(FurnitureItemRecord.name)
    if category_id:
        statement = statement.where(FurnitureItemRecord.category_id == category_id)
    if search:
        term = f"%{search.strip()}%"
        statement = statement.where(or_(
            FurnitureItemRecord.name.ilike(term),
            FurnitureItemRecord.supplier.ilike(term),
            FurnitureItemRecord.sku.ilike(term),
        ))
    return [catalogue_item_response(item) for item in session.scalars(statement).all()]


@app.get("/catalog/items/{item_id}", response_model=CatalogueItemResponse)
def get_catalogue_item(item_id: str, session: CatalogueSession) -> CatalogueItemResponse:
    item = session.get(FurnitureItemRecord, item_id)
    if item is None or not item.active:
        raise HTTPException(status_code=404, detail="catalogue item not found")
    return catalogue_item_response(item)


@app.post("/catalog/items", response_model=CatalogueItemResponse, status_code=201)
def create_catalogue_item(
    payload: CatalogueItemInput,
    session: CatalogueSession,
) -> CatalogueItemResponse:
    validate_catalogue_category(session, payload)
    item = FurnitureItemRecord(**payload.model_dump(), supplier_editable=True)
    session.add(item)
    try:
        session.commit()
    except IntegrityError as error:
        session.rollback()
        raise HTTPException(status_code=409, detail="this supplier SKU already exists") from error
    session.refresh(item)
    return catalogue_item_response(item)


@app.put("/catalog/items/{item_id}", response_model=CatalogueItemResponse)
def update_catalogue_item(
    item_id: str,
    payload: CatalogueItemInput,
    session: CatalogueSession,
) -> CatalogueItemResponse:
    item = session.get(FurnitureItemRecord, item_id)
    if item is None or not item.active:
        raise HTTPException(status_code=404, detail="catalogue item not found")
    if not item.supplier_editable:
        raise HTTPException(status_code=403, detail="catalogue item is read-only")
    validate_catalogue_category(session, payload)
    for field, value in payload.model_dump().items():
        setattr(item, field, value)
    try:
        session.commit()
    except IntegrityError as error:
        session.rollback()
        raise HTTPException(status_code=409, detail="this supplier SKU already exists") from error
    session.refresh(item)
    return catalogue_item_response(item)


@app.delete("/catalog/items/{item_id}", status_code=204)
def archive_catalogue_item(item_id: str, session: CatalogueSession) -> Response:
    item = session.get(FurnitureItemRecord, item_id)
    if item is None or not item.active:
        raise HTTPException(status_code=404, detail="catalogue item not found")
    if not item.supplier_editable:
        raise HTTPException(status_code=403, detail="catalogue item is read-only")
    if item.is_default:
        raise HTTPException(status_code=403, detail="default catalogue objects can be modified but not archived")
    item.active = False
    session.commit()
    return Response(status_code=204)


@app.get("/products")
def list_products() -> list[dict[str, object]]:
    product = build_l_shaped_fixture().product
    return [product.model_dump(mode="json")]


@app.get("/products/{product_id}")
def get_product(product_id: UUID) -> dict[str, object]:
    product = build_l_shaped_fixture().product
    if product.id != product_id:
        raise HTTPException(status_code=404, detail="product not found")
    return product.model_dump(mode="json")


@app.get("/demo", response_model=DemoResponse)
def demo() -> DemoResponse:
    fixture = build_l_shaped_fixture()
    return DemoResponse(
        room=fixture.room,
        product=fixture.product,
        placements=fixture.placements,
        results={
            name: check_fit(fixture.room, fixture.product, placement) for name, placement in fixture.placements.items()
        },
    )


@app.post("/cad/generate", response_model=CADResponse, status_code=201)
def generate_cad_artifact(payload: FitRequest) -> CADResponse:
    artifact_id = uuid4()
    output = Path("cad/output") / f"{artifact_id}.FCStd"
    generated = generate_cad(payload.room, payload.product, payload.placement, output)
    return CADResponse(artifact_id=artifact_id, path=generated)
