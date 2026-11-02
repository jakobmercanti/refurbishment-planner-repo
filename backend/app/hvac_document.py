"""Bounded shared HVAC persistence contract; CFD consumes resolved Scenario/Vent contracts."""

from __future__ import annotations

import json
from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, FiniteFloat, model_validator

from geometry.climoptix_models import Vent

Identifier = Annotated[str, Field(pattern=r"^[\w:-]{1,150}$")]
Nonnegative = Annotated[FiniteFloat, Field(ge=0, le=1e9)]


class Contract(BaseModel):
    model_config = ConfigDict(extra="forbid")


class Conditions(Contract):
    roomC: Annotated[FiniteFloat, Field(ge=-50, le=80)] = 20
    outdoorC: Annotated[FiniteFloat, Field(ge=-80, le=80)] = -3
    supplyC: Annotated[FiniteFloat, Field(ge=-50, le=100)] = 30
    densityKgM3: Annotated[FiniteFloat, Field(gt=0, le=10)] = 1.2
    cpJKgK: Annotated[FiniteFloat, Field(gt=0, le=10000)] = 1005
    infiltrationM3S: Annotated[FiniteFloat, Field(ge=0, le=1e5)] = 0
    occupants: Annotated[int, Field(ge=0, le=100000)] = 0
    sensibleWPerson: Annotated[FiniteFloat, Field(ge=0, le=1000)] = 75
    equipmentW: Nonnegative = 0
    solarW: Nonnegative = 0
    targetACH: Annotated[FiniteFloat, Field(ge=0, le=1000)] = 3
    litresPerson: Annotated[FiniteFloat, Field(ge=0, le=1000)] = 0
    litresM2: Annotated[FiniteFloat, Field(ge=0, le=1000)] = 0
    includeHeating: bool = True
    durationHours: Annotated[FiniteFloat, Field(gt=0, le=8784)] | None = None


class VentOperation(Contract):
    enabled: bool | None = None
    valueSI: FiniteFloat | None = None
    temperatureK: Annotated[FiniteFloat, Field(ge=150, le=1500)] | None = None


class HeaterOperation(Contract):
    enabled: bool = True
    actualW: Nonnegative | None = None


class OperatingScenario(Contract):
    id: Identifier
    name: Annotated[str, Field(min_length=1, max_length=100)]
    floorId: Identifier
    roomId: Identifier
    conditions: Conditions
    ventOverrides: dict[Identifier, VentOperation] = Field(default_factory=dict, max_length=500)
    heaterOverrides: dict[Identifier, HeaterOperation] = Field(default_factory=dict, max_length=3000)


class Device(Contract):
    vent: Vent
    floorId: Identifier
    roomId: Identifier
    outdoorAirFraction: Annotated[FiniteFloat, Field(ge=0, le=1)] = 1
    extractKind: Literal["exhaust", "return"] = "exhaust"
    enabled: bool = True


class Binding(Contract):
    operatingScenarioId: Identifier | None = None
    deviceIds: list[Identifier] = Field(max_length=500)
    editMode: Literal["design", "override"] = "design"
    overrides: dict[Identifier, VentOperation] = Field(default_factory=dict, max_length=500)


class Snapshot(Contract):
    caseId: Identifier
    operatingScenarioId: Identifier
    createdAt: Annotated[str, Field(max_length=50)]
    inputHash: Annotated[str, Field(pattern=r"^[a-f0-9]{64}$")]
    boundaryJson: Annotated[str, Field(max_length=100000)]

    @model_validator(mode="after")
    def valid_package(self) -> Snapshot:
        data = json.loads(self.boundaryJson)
        if not isinstance(data, dict) or data.get("version") != 1 or not isinstance(data.get("sourceInput"), str):
            raise ValueError("Invalid HVAC boundary snapshot.")
        return self


class HvacProject(Contract):
    version: Literal[1]
    devices: list[Device] = Field(max_length=500)
    scenarios: list[OperatingScenario] = Field(default_factory=list, max_length=100)
    activeScenarioId: Identifier | None = None
    bindings: dict[Identifier, Binding] = Field(default_factory=dict, max_length=100)
    migrationWarnings: list[Annotated[str, Field(max_length=500)]] = Field(default_factory=list, max_length=500)
    snapshots: list[Snapshot] = Field(default_factory=list, max_length=5)

    @model_validator(mode="after")
    def shared_ids(self) -> HvacProject:
        ids = {d.vent.id for d in self.devices}
        if len(ids) != len(self.devices) or len({s.id for s in self.scenarios}) != len(self.scenarios):
            raise ValueError("HVAC entity IDs must be unique.")
        for binding in self.bindings.values():
            if len(set(binding.deviceIds)) != len(binding.deviceIds) or not set(binding.deviceIds) <= ids:
                raise ValueError("HVAC bindings must reference unique shared device IDs.")
        devices = {d.vent.id: d for d in self.devices}
        for overrides in [s.ventOverrides for s in self.scenarios] + [b.overrides for b in self.bindings.values()]:
            for key, override in overrides.items():
                if key in devices and devices[key].vent.control != "pressure" and override.valueSI is not None:
                    if override.valueSI <= 0:
                        raise ValueError(
                            "Prescribed scenario flow must be positive; disable the device to turn it off."
                        )
        return self
