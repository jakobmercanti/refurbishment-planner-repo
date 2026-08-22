"""HTTP adapter for deterministic fit verification."""

from __future__ import annotations

from datetime import UTC, datetime
from pathlib import Path
from uuid import UUID, uuid4

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from backend.app.schemas import (
    CADResponse,
    DemoResponse,
    FitRequest,
    PolygonUpdate,
    ProjectCreate,
    ProjectResponse,
)
from cad.generator import generate_cad
from geometry.engine import check_fit
from geometry.fixtures import build_l_shaped_fixture
from geometry.models import FitResult, GenericOpening, ObstacleDefinition, Placement, RoomDefinition
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
    allow_methods=["GET", "POST", "PUT", "PATCH"],
    allow_headers=["Content-Type"],
)

projects: dict[UUID, ProjectResponse] = {}
rooms: dict[UUID, RoomDefinition] = {}
fit_results: dict[UUID, FitResult] = {}


@app.exception_handler(PolygonValidationError)
async def polygon_validation_error(_request: object, error: PolygonValidationError) -> JSONResponse:
    return JSONResponse(status_code=422, content={"detail": str(error)})


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok", "engine": "deterministic", "unit": "mm"}


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
    derive_walls(updated)
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


@app.get("/fit-checks/{analysis_id}", response_model=FitResult)
def get_fit_check(analysis_id: UUID) -> FitResult:
    try:
        return fit_results[analysis_id]
    except KeyError as error:
        raise HTTPException(status_code=404, detail="fit analysis not found") from error


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
