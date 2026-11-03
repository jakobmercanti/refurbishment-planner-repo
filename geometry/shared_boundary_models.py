"""Bounded shared Heating/Ventilation source intent; no browser/display meshes."""

from typing import Annotated, Literal

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


class SharedBoundaryInputs(Input):
    version: Literal[1]
    captureEnvelope: bool
    sources: list[SharedHeatSource] = Field(max_length=2000)
    inventory: list[HeatingInventory] = Field(max_length=80)
    unlocated: list["UnlocatedInput"] = Field(default_factory=list, max_length=4)

    @model_validator(mode="after")
    def unique_sources(self) -> "SharedBoundaryInputs":
        if len({s.id for s in self.sources}) != len(self.sources):
            raise ValueError("Shared heat source IDs must be unique.")
        return self


class UnlocatedInput(Input):
    id: Identifier
    name: str = Field(max_length=200)
    floorId: Identifier
    roomId: Identifier
    kind: Literal["people", "equipment", "solar", "infiltration"]
    valueSI: float = Field(ge=0, le=1e9)
    units: Literal["W", "m³/s"]


SharedBoundaryInputs.model_rebuild()
