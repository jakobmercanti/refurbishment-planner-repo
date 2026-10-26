"""Saved preparation ONLY. No field in this contract asserts a computed adjoint."""

from typing import Annotated, Literal, Self

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

Identifier = Annotated[str, Field(pattern=r"^[A-Za-z0-9_:-]+$", min_length=1, max_length=150)]
Hash = Annotated[str, Field(pattern=r"^[a-f0-9]{64}$")]
Length = Annotated[float, Field(ge=0, le=1e7)]


class Model(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True, allow_inf_nan=False, validate_default=True)


class FixedPort(Model):
    ventId: Identifier
    name: Annotated[str, Field(min_length=1, max_length=120)]
    role: Literal["supply", "extract"]
    supportId: Annotated[str, Field(pattern=r"^[A-Za-z0-9_:.-]+$", min_length=1, max_length=500)]
    shape: Literal["rectangle", "circle"]
    widthMm: Annotated[float, Field(gt=0, le=10000)]
    heightMm: Annotated[float, Field(gt=0, le=10000)]
    rotationDeg: Annotated[float, Field(ge=-360, le=360)]
    centreUMm: Length
    centreVMm: Length
    originMm: Annotated[list[float], Field(min_length=3, max_length=3)]
    uAxis: Annotated[list[float], Field(min_length=3, max_length=3)]
    vAxis: Annotated[list[float], Field(min_length=3, max_length=3)]
    normal: Annotated[list[float], Field(min_length=3, max_length=3)]


class Baseline(Model):
    sourceHash: Hash
    configurationHash: Hash
    clientRevision: Hash
    # A reference, never evidence of ownership, convergence, or mesh identity.
    runId: Annotated[str, Field(pattern=r"^[a-f0-9-]{36}$")] | None = None
    ports: Annotated[list[FixedPort], Field(max_length=100)] = Field(default_factory=list)

    @model_validator(mode="after")
    def unique_ports(self) -> Self:
        if len({p.ventId for p in self.ports}) != len(self.ports):
            raise ValueError("Baseline port snapshots require unique IDs.")
        return self


class MovementBounds(Model):
    uMinMm: Length
    uMaxMm: Length
    vMinMm: Length
    vMaxMm: Length

    @model_validator(mode="after")
    def ordered(self) -> Self:
        if self.uMinMm > self.uMaxMm or self.vMinMm > self.vMaxMm:
            raise ValueError("Movement minima must not exceed maxima.")
        return self


class MovablePort(Model):
    ventId: Identifier
    movable: bool = False
    lockU: bool = False
    lockV: bool = False
    clearanceMm: Length = 10
    maxDisplacementMm: Annotated[float, Field(gt=0, le=10000)] = 100
    bounds: MovementBounds


class Objective(Model):
    kind: Literal["velocityUniformity", "draught"] = "velocityUniformity"
    referenceVelocityMS: Annotated[float, Field(gt=0, le=100)] = 1
    targetVelocityMS: Annotated[float, Field(ge=0, le=100)] = 0.2
    region: Literal["wholeFluid"] = "wholeFluid"


class Strategy(Model):
    maxAcceptedSteps: Annotated[int, Field(ge=1, le=50)] = 3
    initialStepMm: Annotated[float, Field(gt=0, le=1000)] = 50
    minimumStepMm: Annotated[float, Field(gt=0, le=1000)] = 1
    maximumStepMm: Annotated[float, Field(gt=0, le=1000)] = 100
    maskTransitionMm: Annotated[float, Field(gt=0, le=1000)] = 10
    maxRejectedTrials: Annotated[int, Field(ge=0, le=15)] = 5
    maxPrimalSolves: Annotated[int, Field(ge=1, le=200)] = 20
    budgetSeconds: Annotated[int, Field(ge=60, le=3600)] = 900

    @model_validator(mode="after")
    def ordered(self) -> Self:
        if not self.minimumStepMm <= self.initialStepMm <= self.maximumStepMm:
            raise ValueError("Require minimum ≤ initial ≤ maximum translation step.")
        if self.maxPrimalSolves < self.maxAcceptedSteps + 1:
            raise ValueError("Primal budget must cover a baseline and every accepted movement.")
        return self


class AdjointStudy(Model):
    version: Literal[1] = 1
    id: Identifier
    name: Annotated[str, Field(min_length=1, max_length=120)]
    baseline: Baseline
    ports: Annotated[list[MovablePort], Field(max_length=100)]
    objective: Objective = Field(default_factory=Objective)
    strategy: Strategy = Field(default_factory=Strategy)

    @field_validator("version", mode="before")
    @classmethod
    def integer_version(cls, value: object) -> object:
        if type(value) is not int:
            raise ValueError("Version must be an integer, not a boolean or text.")
        return value

    @model_validator(mode="after")
    def unique(self) -> Self:
        if not self.name.strip() or len({p.ventId for p in self.ports}) != len(self.ports):
            raise ValueError("Use a nonblank study name and unique port IDs.")
        return self
