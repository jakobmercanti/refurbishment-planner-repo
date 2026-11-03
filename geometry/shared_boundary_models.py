"""Bounded shared Heating/Ventilation source intent; no browser/display meshes."""

from typing import Annotated, Any, Literal, TypedDict

from pydantic import BaseModel, ConfigDict, Field, model_validator

Identifier = Annotated[str, Field(pattern=r"^[\w:-]{1,150}$")]


class Input(BaseModel):
    model_config = ConfigDict(extra="forbid", allow_inf_nan=False)


class PlanPoint(Input):
    x: float = Field(ge=-1e7, le=1e7)
    y: float = Field(ge=-1e7, le=1e7)


class HeatedCircuit(Input):
    id: Identifier
    spacingMm: float = Field(ge=1, le=1000)
    pathMm: list[PlanPoint] = Field(min_length=2, max_length=12000)


class SharedHeatSource(Input):
    id: Identifier
    name: str = Field(max_length=200)
    floorId: Identifier
    roomId: Identifier
    kind: Literal["radiator", "ufh"]
    watts: float | None = Field(ge=0, le=1e9)
    enabled: bool
    geometryValid: bool
    planningAreaM2: float | None = Field(ge=0, le=1e9)
    circuits: list[HeatedCircuit] = Field(max_length=2000)
    exclusions: list[Annotated[list[PlanPoint], Field(min_length=3, max_length=12000)]] = Field(max_length=1000)


class HeatingInventory(Input):
    floorId: Identifier
    kind: Literal["boiler", "pipe", "manifold", "exclusion"]
    count: int = Field(ge=0, le=10000)


class UnlocatedInput(Input):
    id: Identifier
    name: str = Field(max_length=200)
    floorId: Identifier
    roomId: Identifier
    kind: Literal["people", "equipment", "solar", "infiltration"]
    valueSI: float = Field(ge=0, le=1e9)
    units: Literal["W", "m³/s"]

    @model_validator(mode="after")
    def matching_units(self) -> "UnlocatedInput":
        if (self.kind == "infiltration") != (self.units == "m³/s"):
            raise ValueError("Infiltration uses m³/s; sensible gains use W.")
        return self


class SharedBoundaryInputs(Input):
    version: Literal[1]
    captureEnvelope: bool
    sources: list[SharedHeatSource] = Field(max_length=2000)
    inventory: list[HeatingInventory] = Field(max_length=80)
    unlocated: list[UnlocatedInput] = Field(default_factory=list, max_length=4)

    @model_validator(mode="after")
    def unique_sources(self) -> "SharedBoundaryInputs":
        ids = [s.id for s in self.sources] + [s.id for s in self.unlocated]
        if len(set(ids)) != len(ids):
            raise ValueError("Shared heat source IDs must be unique.")
        return self


BoundaryStatus = Literal["incomplete", "unassigned", "applied", "off", "outside"]


class BoundaryCapture(TypedDict):
    id: str
    name: str
    floorId: str
    roomId: str
    kind: str
    status: BoundaryStatus
    patchIds: list[str]
    areaM2: float
    watts: float | None
    appliedW: float
    uWm2K: float | None
    rsiM2KW: float | None
    coefficientWm2K: float | None
    ambientK: float | None
    message: str


class SharedBoundaryAudit(TypedDict):
    version: Literal[1]
    state: Literal["complete", "review"]
    sources: list[BoundaryCapture]
    envelope: list[BoundaryCapture]
    inventory: list[dict[str, Any]]
