"""HTTP adapter for deterministic fit verification."""

from __future__ import annotations

from datetime import UTC, datetime
from itertools import pairwise
import base64
import http.client
import ipaddress
import json
from pathlib import Path
import socket
import ssl
from typing import Annotated, Any, Awaitable, Callable
from urllib.parse import urljoin, urlparse
from uuid import UUID, uuid4

from fastapi import Body, Depends, FastAPI, Header, HTTPException, Query, Response
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from pydantic import ValidationError
from sqlalchemy import func, or_, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from backend.app.schemas import (
    CADResponse,
    CatalogueCategoryResponse,
    CatalogueCategoryUpdate,
    CatalogueWebsiteImport,
    CatalogueWebsiteImportResponse,
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
    MaterialCollectionResponse,
    MaterialFamilyResponse,
    MaterialItemResponse,
)
from backend.app.floorplan_recognition import recognise_rooms
from cad.generator import generate_cad
from database.catalog import catalogue_session, initialise_catalogue
from database.catalogue_assets import (
    PictureReplacement,
    asset_root,
    decode_picture,
    remove_item_pictures,
    stage_item_picture_replacement,
)
from database.models import FurnitureCategoryRecord, FurnitureItemRecord, MaterialCollectionRecord, MaterialFamilyRecord, MaterialItemRecord
from geometry.engine import check_fit
from geometry.fixtures import build_l_shaped_fixture
from geometry.layout_engine import analyse_layout
from geometry.models import FitResult, GenericOpening, LayoutResult, ObstacleDefinition, Placement, RoomDefinition
from geometry.shapes import obstacle_footprint
from geometry.walls import PolygonValidationError, derive_walls, room_polygon

class RequestBodyLimitMiddleware:
    """Reject oversized streamed request bodies before route parsing."""

    def __init__(self, app: Callable[..., Awaitable[None]], default_limit: int = 34_000_000) -> None:
        self.app = app
        self.default_limit = default_limit

    async def __call__(self, scope: dict[str, Any], receive: Callable[..., Awaitable[dict[str, Any]]], send: Callable[..., Awaitable[None]]) -> None:
        if scope.get("type") != "http" or scope.get("method") not in {"POST", "PUT", "PATCH"}:
            await self.app(scope, receive, send)
            return
        limit = 25_000_000 if scope.get("path") == "/project-floorplan/detect" else self.default_limit
        messages: list[dict[str, Any]] = []
        total = 0
        while True:
            message = await receive()
            messages.append(message)
            if message.get("type") == "http.request":
                total += len(message.get("body", b""))
                if total > limit:
                    await send({"type": "http.response.start", "status": 413, "headers": [(b"content-type", b"application/json")]})
                    await send({"type": "http.response.body", "body": b'{"detail":"Request body is too large."}'})
                    return
                if not message.get("more_body", False):
                    break
            elif message.get("type") == "http.disconnect":
                return
        index = 0

        async def replay() -> dict[str, Any]:
            nonlocal index
            if index >= len(messages):
                return {"type": "http.request", "body": b"", "more_body": False}
            message = messages[index]
            index += 1
            return message

        await self.app(scope, replay, send)


app = FastAPI(
    title="Renovation Fit API",
    version="0.1.0",
    description="Deterministic millimetre-based spatial fit verification",
)
app.add_middleware(RequestBodyLimitMiddleware)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000"],
    allow_credentials=False,
    allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE"],
    allow_headers=["Content-Type", "X-Filename", "X-Gap-Closure"],
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
    try:
        images = json.loads(item.image_data_json or "[]")
        if not isinstance(images, list):
            images = []
        images = [image for image in images if isinstance(image, dict) and image.get("url")][:3]
    except json.JSONDecodeError:
        images = []
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
        side_clearance_mm=item.side_clearance_mm,
        front_clearance_mm=item.front_clearance_mm,
        subcategory=item.subcategory,
        plan_shape=item.plan_shape,
        representation_key=item.representation_key,
        plan_symbol_url=item.plan_symbol_url,
        plan_symbol_data_url=item.plan_symbol_data_url,
        images=images,
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


def catalogue_item_values(payload: CatalogueItemInput) -> dict[str, object]:
    return payload.model_dump(exclude={"images"})


def resolved_catalogue_pictures(item_id: str, payload: CatalogueItemInput, existing_json: str | None = None) -> list[tuple[bytes, str, str, str]]:
    try:
        existing = json.loads(existing_json or "[]")
    except json.JSONDecodeError:
        existing = []
    by_url = {record.get("url"): record for record in existing if isinstance(record, dict) and record.get("url")}
    pictures: list[tuple[bytes, str, str, str]] = []
    for picture in payload.images:
        try:
            if picture.data_url:
                data, content_type, extension = decode_picture(picture.data_url)
            elif picture.url and picture.url in by_url:
                record = by_url[picture.url]
                filename = str(record.get("filename") or "")
                path = asset_root() / item_id / filename
                if not filename or path.parent != asset_root() / item_id or not path.is_file():
                    raise ValueError("existing catalogue picture is unavailable")
                data = path.read_bytes()
                content_type = str(record.get("content_type"))
                data, content_type, extension = decode_picture(f"data:{content_type};base64,{base64.b64encode(data).decode()}")
            else:
                raise ValueError("catalogue picture must contain uploaded data or an existing item URL")
        except (OSError, ValueError) as error:
            raise HTTPException(status_code=422, detail=str(error)) from error
        pictures.append((data, content_type, extension, picture.alt))
    return pictures


def resolve_public_catalogue_url(url: str) -> tuple[str, str, int, str]:
    parsed = urlparse(url)
    if parsed.scheme not in {"http", "https"} or not parsed.hostname or parsed.username or parsed.password:
        raise HTTPException(status_code=422, detail="source must be a public HTTP(S) URL")
    try:
        port = parsed.port or (443 if parsed.scheme == "https" else 80)
        addresses = {record[4][0] for record in socket.getaddrinfo(parsed.hostname, port, type=socket.SOCK_STREAM)}
    except ValueError as error:
        raise HTTPException(status_code=422, detail="source URL contains an invalid port") from error
    except socket.gaierror as error:
        raise HTTPException(status_code=422, detail="source host could not be resolved") from error
    if not addresses or any(not ipaddress.ip_address(address).is_global for address in addresses):
        raise HTTPException(status_code=422, detail="private, local and reserved source hosts are not allowed")
    return parsed.scheme, sorted(addresses)[0], port, parsed.hostname


def safe_catalogue_url(payload: CatalogueWebsiteImport) -> str:
    url = urljoin(payload.source_url.rstrip("/") + "/", payload.page.strip()) if payload.page.strip() else payload.source_url
    resolve_public_catalogue_url(url)
    return url


class PinnedHTTPSConnection(http.client.HTTPSConnection):
    def __init__(self, pinned_ip: str, server_hostname: str, port: int, timeout: float) -> None:
        super().__init__(server_hostname, port=port, timeout=timeout, context=ssl.create_default_context())
        self.pinned_ip = pinned_ip

    def connect(self) -> None:
        raw_socket = socket.create_connection((self.pinned_ip, self.port), self.timeout, self.source_address)
        self.sock = self._context.wrap_socket(raw_socket, server_hostname=self.host)


def open_pinned_catalogue_response(url: str) -> http.client.HTTPResponse:
    scheme, pinned_ip, port, hostname = resolve_public_catalogue_url(url)
    parsed = urlparse(url)
    connection: http.client.HTTPConnection
    if scheme == "https":
        connection = PinnedHTTPSConnection(pinned_ip, hostname, port, 6)
    else:
        connection = http.client.HTTPConnection(pinned_ip, port=port, timeout=6)
    path = parsed.path or "/"
    if parsed.query:
        path += f"?{parsed.query}"
    host_header = hostname if parsed.port is None else f"{hostname}:{port}"
    connection.request("GET", path, headers={"Host": host_header, "User-Agent": "RenovationFitCatalogueImporter/1.0", "Accept": "text/html,application/json"})
    return connection.getresponse()


def fetch_catalogue_page(url: str) -> str:
    current_url = url
    for redirect_count in range(4):
        try:
            response = open_pinned_catalogue_response(current_url)
            if response.status in {301, 302, 303, 307, 308}:
                location = response.getheader("Location")
                response.close()
                if not location:
                    raise HTTPException(status_code=502, detail="source returned a redirect without a destination")
                if redirect_count == 3:
                    raise HTTPException(status_code=502, detail="source exceeded the redirect limit")
                current_url = urljoin(current_url, location)
                resolve_public_catalogue_url(current_url)
                continue
            if response.status >= 400:
                status = response.status
                response.close()
                raise HTTPException(status_code=502, detail=f"source website returned HTTP {status}")
            content = response.read(2_000_001)
            response.close()
        except (OSError, http.client.HTTPException, ssl.SSLError) as error:
            raise HTTPException(status_code=502, detail=f"source website could not be fetched: {error}") from error
        if len(content) > 2_000_000:
            raise HTTPException(status_code=413, detail="source page must be 2 MB or smaller")
        return content.decode("utf-8", errors="replace")
    raise HTTPException(status_code=502, detail="source exceeded the redirect limit")


def json_ld_products(document: str) -> list[dict[str, object]]:
    import re

    products: list[dict[str, object]] = []
    for raw in re.findall(r'<script[^>]+type=["\']application/ld\+json["\'][^>]*>(.*?)</script>', document, re.I | re.S):
        try:
            value = json.loads(raw)
        except json.JSONDecodeError:
            continue
        stack = value if isinstance(value, list) else [value]
        while stack:
            candidate = stack.pop()
            if not isinstance(candidate, dict):
                continue
            graph = candidate.get("@graph")
            if isinstance(graph, list):
                stack.extend(graph)
            kind = candidate.get("@type")
            if kind == "Product" or isinstance(kind, list) and "Product" in kind:
                products.append(candidate)
    return products


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
    gap_closure: float = Header(0.15, alias="X-Gap-Closure", ge=0.035, le=0.18),
) -> ProjectFloorplanResponse:
    if len(document) > 25_000_000:
        raise HTTPException(status_code=413, detail="Floorplan files must be 25 MB or smaller.")
    try:
        width, height, rooms_detected = recognise_rooms(document, filename, gap_closure)
    except ValueError as error:
        raise HTTPException(status_code=422, detail=str(error)) from error
    return ProjectFloorplanResponse(
        source_width_px=width,
        source_height_px=height,
        rooms=[{"id": room.identifier, "name": room.name, "vertices": room.vertices, "area_px2": room.area_px2, "confidence": room.confidence} for room in rooms_detected],
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
def run_layout_check(room: RoomDefinition, session: CatalogueSession) -> LayoutResult:
    """Resolve category defaults at the trusted backend boundary before clash analysis."""
    resolved: list[ObstacleDefinition] = []
    for obstacle in room.obstacles:
        item = session.get(FurnitureItemRecord, obstacle.model_id) if obstacle.model_id else None
        category = item.category if item is not None else None
        side = obstacle.side_clearance_mm if obstacle.side_clearance_mm is not None else (item.side_clearance_mm if item and item.side_clearance_mm is not None else (category.default_side_clearance_mm if category else 0.0))
        front = obstacle.front_clearance_mm if obstacle.front_clearance_mm is not None else (item.front_clearance_mm if item and item.front_clearance_mm is not None else (category.default_front_clearance_mm if category else 0.0))
        resolved.append(obstacle.model_copy(update={"side_clearance_mm": side, "front_clearance_mm": front}))
    return analyse_layout(room.model_copy(update={"obstacles": resolved}))


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
            default_side_clearance_mm=category.default_side_clearance_mm,
            default_front_clearance_mm=category.default_front_clearance_mm,
        )
        for category, count in rows
    ]


@app.patch("/catalog/categories/{category_id}", response_model=CatalogueCategoryResponse)
def update_catalogue_category(
    category_id: str,
    payload: CatalogueCategoryUpdate,
    session: CatalogueSession,
) -> CatalogueCategoryResponse:
    category = session.get(FurnitureCategoryRecord, category_id)
    if category is None:
        raise HTTPException(status_code=404, detail="catalogue category not found")
    category.default_side_clearance_mm = payload.default_side_clearance_mm
    category.default_front_clearance_mm = payload.default_front_clearance_mm
    session.commit()
    count = session.scalar(select(func.count(FurnitureItemRecord.id)).where(FurnitureItemRecord.category_id == category.id, FurnitureItemRecord.active)) or 0
    return CatalogueCategoryResponse(
        id=category.id, name=category.name, description=category.description, item_count=count,
        default_side_clearance_mm=category.default_side_clearance_mm,
        default_front_clearance_mm=category.default_front_clearance_mm,
    )


@app.get("/catalog/materials", response_model=list[MaterialCollectionResponse])
def list_catalogue_materials(session: CatalogueSession, kind: str | None = None) -> list[MaterialCollectionResponse]:
    collections = session.scalars(select(MaterialCollectionRecord).where(MaterialCollectionRecord.kind == kind) if kind else select(MaterialCollectionRecord)).all()
    response: list[MaterialCollectionResponse] = []
    for collection in sorted(collections, key=lambda item: (item.sort_order, item.name)):
        families = session.scalars(select(MaterialFamilyRecord).where(MaterialFamilyRecord.collection_id == collection.id).order_by(MaterialFamilyRecord.sort_order)).all()
        response.append(MaterialCollectionResponse(
            id=collection.id, kind=collection.kind, name=collection.name, source_url=collection.source_url,
            families=[MaterialFamilyResponse(id=family.id, name=family.name, items=[MaterialItemResponse(id=item.id, name=item.name, code=item.code, color_hex=item.color_hex.upper(), metadata=item.metadata_json) for item in session.scalars(select(MaterialItemRecord).where(MaterialItemRecord.family_id == family.id).order_by(MaterialItemRecord.name)).all()]) for family in families],
        ))
    return response


@app.get("/catalog/items", response_model=list[CatalogueItemResponse])
def list_catalogue_items(
    session: CatalogueSession,
    category_id: str | None = None,
    subcategory: str | None = None,
    search: CatalogueSearch = None,
) -> list[CatalogueItemResponse]:
    statement = select(FurnitureItemRecord).where(FurnitureItemRecord.active).order_by(FurnitureItemRecord.name)
    if category_id:
        statement = statement.where(FurnitureItemRecord.category_id == category_id)
    if subcategory:
        statement = statement.where(FurnitureItemRecord.subcategory == subcategory)
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
    item_id = str(uuid4())
    pictures = resolved_catalogue_pictures(item_id, payload)
    item = FurnitureItemRecord(id=item_id, **catalogue_item_values(payload), image_data_json="[]", supplier_editable=True)
    session.add(item)
    replacement: PictureReplacement | None = None
    try:
        session.flush()
        replacement = stage_item_picture_replacement(item_id, pictures)
        item.image_data_json = json.dumps(replacement.metadata)
        session.commit()
    except IntegrityError as error:
        session.rollback()
        if replacement:
            replacement.rollback()
        raise HTTPException(status_code=409, detail="this supplier SKU already exists") from error
    except Exception as error:
        session.rollback()
        if replacement:
            replacement.rollback()
        raise HTTPException(status_code=500, detail="catalogue pictures could not be stored") from error
    replacement.finalize_best_effort()
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
    pictures = resolved_catalogue_pictures(item.id, payload, item.image_data_json)
    for field, value in catalogue_item_values(payload).items():
        setattr(item, field, value)
    replacement: PictureReplacement | None = None
    try:
        session.flush()
        replacement = stage_item_picture_replacement(item.id, pictures)
        item.image_data_json = json.dumps(replacement.metadata)
        session.commit()
    except IntegrityError as error:
        session.rollback()
        if replacement:
            replacement.rollback()
        raise HTTPException(status_code=409, detail="this supplier SKU already exists") from error
    except Exception as error:
        session.rollback()
        if replacement:
            replacement.rollback()
        raise HTTPException(status_code=500, detail="catalogue pictures could not be stored") from error
    replacement.finalize_best_effort()
    session.refresh(item)
    return catalogue_item_response(item)


@app.delete("/catalog/items/{item_id}", status_code=204)
def archive_catalogue_item(item_id: str, session: CatalogueSession) -> Response:
    item = session.get(FurnitureItemRecord, item_id)
    if item is None:
        raise HTTPException(status_code=404, detail="catalogue item not found")
    if not item.active:
        try:
            remove_item_pictures(item.id)
        except OSError:
            pass
        raise HTTPException(status_code=404, detail="catalogue item not found")
    if not item.supplier_editable:
        raise HTTPException(status_code=403, detail="catalogue item is read-only")
    if item.is_default:
        raise HTTPException(status_code=403, detail="default catalogue objects can be modified but not archived")
    item.active = False
    session.commit()
    try:
        remove_item_pictures(item.id)
    except OSError:
        # The committed inactive state makes the asset endpoint inaccessible.
        # A later maintenance pass can retry physical cleanup.
        pass
    return Response(status_code=204)


@app.get("/catalog/items/{item_id}/images/{image_index}")
def get_catalogue_item_picture(item_id: str, image_index: int, session: CatalogueSession) -> FileResponse:
    item = session.get(FurnitureItemRecord, item_id)
    if item is None or not item.active:
        raise HTTPException(status_code=404, detail="catalogue item not found")
    try:
        images = json.loads(item.image_data_json or "[]")
        image = images[image_index]
        filename = str(image["filename"])
        content_type = str(image["content_type"])
    except (IndexError, KeyError, TypeError, json.JSONDecodeError):
        raise HTTPException(status_code=404, detail="catalogue picture not found") from None
    path = (asset_root() / item.id / filename).resolve()
    expected_parent = (asset_root() / item.id).resolve()
    if path.parent != expected_parent or not path.is_file():
        raise HTTPException(status_code=404, detail="catalogue picture not found")
    return FileResponse(path, media_type=content_type)


@app.post("/catalog/import-website", response_model=CatalogueWebsiteImportResponse)
def import_catalogue_website(
    payload: CatalogueWebsiteImport,
    session: CatalogueSession,
) -> CatalogueWebsiteImportResponse:
    category = session.get(FurnitureCategoryRecord, payload.category_id)
    if category is None or CATEGORY_KINDS.get(category.id) != payload.fixture_kind:
        raise HTTPException(status_code=422, detail="category and fixture kind do not match")
    url = safe_catalogue_url(payload)
    products = json_ld_products(fetch_catalogue_page(url))
    candidates = products or [{"name": payload.fallback_name, "sku": payload.fallback_sku}]
    imported: list[CatalogueItemResponse] = []
    skipped: list[str] = []
    validated: list[CatalogueItemInput] = []
    for index, product in enumerate(candidates[:50]):
        name_value = product.get("name")
        sku_value = product.get("sku")
        if not isinstance(name_value, str) or not name_value.strip() or not isinstance(sku_value, (str, int)) or not str(sku_value).strip():
            skipped.append(f"candidate {index + 1}: missing valid product name or SKU")
            continue
        try:
            validated.append(CatalogueItemInput(
                category_id=payload.category_id, fixture_kind=payload.fixture_kind, name=name_value.strip(),
                supplier=payload.supplier, sku=str(sku_value).strip(), width_mm=payload.width_mm, depth_mm=payload.depth_mm,
                height_mm=payload.height_mm, color_hex=payload.color_hex,
                description=f"Imported from {url}", subcategory=payload.subcategory, plan_shape=payload.plan_shape,
            ))
        except ValidationError as error:
            skipped.append(f"candidate {index + 1}: {error.errors()[0]['msg']}")
    inserted: list[FurnitureItemRecord] = []
    for item_payload in validated:
        item = FurnitureItemRecord(id=str(uuid4()), **catalogue_item_values(item_payload), image_data_json="[]", supplier_editable=True)
        try:
            with session.begin_nested():
                session.add(item)
                session.flush()
        except IntegrityError:
            skipped.append(f"{item_payload.sku}: supplier SKU already exists")
            continue
        inserted.append(item)
    try:
        session.commit()
    except Exception:
        session.rollback()
        raise
    imported.extend(catalogue_item_response(item) for item in inserted)
    return CatalogueWebsiteImportResponse(imported=imported, skipped=skipped)


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
