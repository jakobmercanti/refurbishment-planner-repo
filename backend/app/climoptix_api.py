"""Stateless preparation endpoints, sharing the existing project/security boundary."""

from typing import Any
from uuid import UUID

from fastapi import APIRouter, HTTPException
from fastapi.responses import Response
from pydantic import BaseModel, ConfigDict, Field
from shapely.errors import GEOSException

from backend.app.climoptix_provider import PreparationOnlyProvider
from backend.app.commercial_api import _validate_project
from geometry.climoptix_models import ProviderCapabilities, Scenario

router = APIRouter(prefix="/climoptix", tags=["Climoptix preparation"])
provider = PreparationOnlyProvider()


class PreparationRequest(BaseModel):
    model_config = ConfigDict(extra="forbid", allow_inf_nan=False)
    project: dict[str, Any]
    scenario: Scenario
    clientRevision: str = Field(pattern=r"^[a-f0-9]{64}$")


@router.get("/capabilities", response_model=ProviderCapabilities)
def capabilities() -> ProviderCapabilities:
    return provider.capabilities()


@router.post("/prepare")
def prepare(request: PreparationRequest) -> dict[str, Any]:
    try:
        _validate_project(request.project, UUID(request.project["projectId"]))
        return provider.validate_scenario(request.project, request.scenario, request.clientRevision)
    except (KeyError, TypeError, ValueError, GEOSException) as error:
        raise HTTPException(
            status_code=422, detail=f"Cannot prepare this source geometry: {str(error)[:1500]}"
        ) from None


@router.post("/openfoam-settings")
def openfoam_settings(request: PreparationRequest) -> Response:
    """Revalidate trusted source; never accept a browser-supplied report or server path."""
    from backend.app.climoptix_foamlib import settings_package

    report = prepare(request)
    try:
        content = settings_package(request.scenario, report)
    except ImportError:
        raise HTTPException(
            503, "Foamlib is not installed on this service. Enable the optional cfd dependency."
        ) from None
    except (ValueError, KeyError, StopIteration) as error:
        raise HTTPException(422, str(error)[:1500]) from None
    return Response(
        content,
        media_type="application/zip",
        headers={
            "Content-Disposition": 'attachment; filename="climoptix-openfoam-settings.zip"',
            "Cache-Control": "no-store",
        },
    )
