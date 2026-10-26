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
from geometry.thermal_models import ThermalPackage

router = APIRouter(prefix="/climoptix", tags=["Climoptix preparation"])
provider = PreparationOnlyProvider()


class PreparationRequest(BaseModel):
    model_config = ConfigDict(extra="forbid", allow_inf_nan=False)
    project: dict[str, Any]
    scenario: Scenario
    clientRevision: str = Field(pattern=r"^[a-f0-9]{64}$")


class GeometryRequest(BaseModel):
    model_config = ConfigDict(extra="forbid", allow_inf_nan=False)
    project: dict[str, Any]


@router.post("/geometry")
def geometry(request: GeometryRequest) -> dict[str, Any]:
    """Browse the entire building without changing or validating a study."""
    from geometry.climoptix_scene import building_scene

    try:
        _validate_project(request.project, UUID(request.project["projectId"]))
        return building_scene(request.project)
    except (KeyError, TypeError, ValueError, GEOSException) as error:
        raise HTTPException(422, f"Cannot display this source geometry: {str(error)[:1500]}") from None


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


@router.post("/default-setup", response_model=Scenario)
def reset_defaults(request: PreparationRequest) -> Scenario:
    from backend.app.climoptix_defaults import default_setup

    try:
        _validate_project(request.project, UUID(request.project["projectId"]))
        return default_setup(request.project, request.scenario, request.clientRevision)
    except (KeyError, TypeError, ValueError, GEOSException) as error:
        raise HTTPException(422, f"Cannot create default setup: {str(error)[:1500]}") from None


@router.post("/thermal-envelope", response_model=ThermalPackage)
def thermal_envelope(request: PreparationRequest) -> ThermalPackage:
    return _thermal(request, calculate=False)


@router.post("/thermal-preview", response_model=ThermalPackage)
def thermal_preview(request: PreparationRequest) -> ThermalPackage:
    return _thermal(request, calculate=True)


def _thermal(request: PreparationRequest, *, calculate: bool) -> ThermalPackage:
    from geometry.thermal_balance import thermal_package

    report = prepare(request)
    try:
        return thermal_package(request.project, request.scenario, report, calculate=calculate)
    except ImportError:
        raise HTTPException(
            503, "Thermal dependencies are unavailable. Install the pinned pvlib/tzdata dependencies on this service."
        ) from None
    except (KeyError, TypeError, ValueError, GEOSException) as error:
        raise HTTPException(422, f"Cannot prepare the thermal envelope: {str(error)[:1500]}") from None


class EPWRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    text: str = Field(max_length=4 * 1024 * 1024)
    filename: str = Field(max_length=120)


@router.post("/thermal-epw")
def thermal_epw(request: EPWRequest) -> dict[str, Any]:
    from geometry.thermal_epw import parse_epw

    try:
        return parse_epw(request.text, request.filename)
    except ValueError as error:
        raise HTTPException(422, str(error)[:1500]) from None


@router.post("/openfoam-settings")
def openfoam_settings(request: PreparationRequest) -> Response:
    """Revalidate trusted source; never accept a browser-supplied report or server path."""
    from backend.app.climoptix_foamlib import settings_package

    report = prepare(request)
    try:
        thermal = _thermal(request, calculate=True) if request.scenario.thermalEnvelope else None
        content = settings_package(request.scenario, report, thermal=thermal)
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
