"""Versioned, solver-independent Climoptix preparation contracts.

Measured geometry is mm. Physics/flow use explicitly named SI quantities.
Nothing in this module represents a computed mesh, solution or queued job.
"""

from typing import Annotated, Literal, Self, get_args

from pydantic import (
    AwareDatetime,
    BaseModel,
    ConfigDict,
    Field,
    StrictFloat,
    ValidationInfo,
    field_validator,
    model_validator,
)

from geometry.thermal_models import ThermalSetup, ThermalSnapshot

Id = Annotated[str, Field(pattern=r"^[A-Za-z0-9_:-]+$", min_length=1, max_length=150)]
PatchId = Annotated[str, Field(pattern=r"^[A-Za-z0-9_:.-]+$", min_length=1, max_length=500)]
Positive = Annotated[StrictFloat, Field(gt=0, le=1e12)]
CellLength = Annotated[StrictFloat, Field(ge=0.01, le=1e7)]
Nonnegative = Annotated[StrictFloat, Field(ge=0, le=1e12)]
Fraction = Annotated[StrictFloat, Field(ge=0, le=1)]
Temperature = Annotated[StrictFloat, Field(ge=150, le=1500)]
Coordinate = Annotated[StrictFloat, Field(ge=-1e7, le=1e7)]
Vector = tuple[Coordinate, Coordinate, Coordinate]
PatchKind = Literal["wall", "floor", "ceiling", "door", "window", "cap", "supply", "extract", "object", "slabSide"]


class Contract(BaseModel):
    model_config = ConfigDict(extra="forbid", allow_inf_nan=False, validate_default=True)

    @field_validator("*", mode="before")
    @classmethod
    def json_scalar_types(cls, value: object, info: ValidationInfo) -> object:
        field = cls.model_fields[info.field_name or ""]
        annotation = field.annotation
        if (annotation is bool or any(type(arg) is bool for arg in get_args(annotation))) and type(value) is not bool:
            raise ValueError("Use a JSON boolean, not a text or numeric flag.")
        if (
            annotation in (int, float) or float in get_args(annotation) or int in get_args(annotation)
        ) and value is not None:
            if isinstance(value, bool) or not isinstance(value, (int, float)):
                raise ValueError("Use a finite JSON number, not text or a boolean.")
        if info.field_name == "version" and type(value) is not int:
            raise ValueError("Version must be an integer.")
        if info.field_name == "name" and isinstance(value, str) and not value.strip():
            raise ValueError("Names cannot be blank.")
        if info.field_name == "group" and isinstance(value, str):
            return value.strip()
        return value


class Seed(Contract):
    floorId: Id
    roomId: Id


class Flow(Contract):
    type: Literal["noSlip", "slip", "velocity", "volumeFlow", "massFlow", "pressure", "opening", "symmetry"] = "noSlip"
    value: float = Field(default=0, ge=-1e9, le=1e9)


class Thermal(Contract):
    type: Literal["adiabatic", "temperature", "heatFlux", "heatTransfer"] = "adiabatic"
    value: float = Field(default=0, ge=-1e6, le=1e6)
    ambientK: Temperature = 293.15

    @model_validator(mode="after")
    def physical_value(self) -> Self:
        if self.type == "temperature" and not 150 <= self.value <= 1500:
            raise ValueError("Surface temperature must be 150–1500 K.")
        if self.type == "heatTransfer" and self.value < 0:
            raise ValueError("Heat-transfer coefficient cannot be negative.")
        return self


class Boundary(Contract):
    flow: Flow = Field(default_factory=Flow)
    thermal: Thermal = Field(default_factory=Thermal)
    scalarPpm: float = Field(default=420, ge=0, le=1e6)
    scalarType: Literal["zeroFlux", "concentration", "flux"] = "zeroFlux"
    scalarFluxM3M2S: float = Field(default=0, ge=-1000, le=1000)
    materialLabel: str = Field(default="", max_length=200)
    turbulenceIntensity: Fraction = 0.05
    turbulenceLengthM: Positive = 0.01
    roughnessM: Nonnegative = 0


class SimulationGroup(Contract):
    id: Id
    name: str = Field(min_length=1, max_length=80)

    @field_validator("name", mode="before")
    @classmethod
    def trim_name(cls, value: object) -> object:
        return value.strip() if isinstance(value, str) else value


class BoundaryCollection(SimulationGroup):
    patchIds: list[PatchId] = Field(default_factory=list, max_length=20000)
    boundary: Boundary | None = None


class ObjectCollection(SimulationGroup):
    memberIds: list[Annotated[str, Field(pattern=r"^(vent|object):[\w:-]{1,150}$")]] = Field(default_factory=list, max_length=3000)


class ObjectCopy(Contract):
    id: Id
    sourceObjectId: Id
    name: str = Field(min_length=1, max_length=120)

    @field_validator("name", mode="before")
    @classmethod
    def trim_name(cls, value: object) -> object:
        return value.strip() if isinstance(value, str) else value


class Boundaries(Contract):
    hideDefaultGroup: bool = Field(default=False, exclude=True)
    groups: dict[PatchKind, Boundary] = Field(default_factory=dict, max_length=11)
    patches: dict[PatchId, Boundary] = Field(default_factory=dict, max_length=10000)
    collections: list[BoundaryCollection] = Field(default_factory=list, max_length=100)

    @model_validator(mode="after")
    def unique_groups(self) -> Self:
        members = [pid for group in self.collections for pid in group.patchIds]
        if len(self.collections) == 100 and not any(g.id == "all-surfaces" for g in self.collections):
            raise ValueError("Boundary groups reserve one of 100 slots for Default surfaces.")
        if (len({g.id for g in self.collections}) != len(self.collections)
                or len({g.name.lower() for g in self.collections}) != len(self.collections)
                or len(set(members)) != len(members) or len(members) > 20000):
            raise ValueError("Boundary groups require unique IDs, names and surface membership.")
        return self


class Host(Contract):
    patchId: PatchId
    u: Fraction = 0.5
    v: Fraction = 0.5


class VentOptimization(Contract):
    locked: bool = True
    maxDisplacementMm: Nonnegative = 500
    minSpacingMm: Nonnegative = 100
    allowablePolygon: list[tuple[Fraction, Fraction]] = Field(default_factory=list, max_length=100)


class Vent(Contract):
    id: Id
    name: str = Field(min_length=1, max_length=120)
    role: Literal["supply", "extract"]
    shape: Literal["rectangle", "circle"] = "rectangle"
    host: Host
    widthMm: float = Field(default=300, ge=10, le=10000)
    heightMm: float = Field(default=200, ge=10, le=10000)
    diameterMm: float = Field(default=200, ge=10, le=10000)
    rotationDeg: float = Field(default=0, ge=-360, le=360)
    edgeClearanceMm: Nonnegative = 10
    openAreaFraction: float = Field(default=1, ge=1e-6, le=1)
    dischargeCoefficient: float = Field(default=1, gt=0, le=1)
    control: Literal["volumeFlow", "massFlow", "velocity", "pressure"] = "volumeFlow"
    valueSI: float = Field(default=0.05, ge=-1e9, le=1e9)
    temperatureK: Temperature = 293.15
    co2Ppm: float = Field(default=420, ge=0, le=1e6)
    turbulenceIntensity: Fraction = 0.05
    turbulenceLengthM: Positive = 0.03
    yawDeg: float = Field(default=0, ge=-90, le=90)
    pitchDeg: float = Field(default=0, ge=-90, le=90)
    group: str = Field(default="", max_length=100)
    recirculationPair: str = Field(default="", max_length=100)
    notes: str = Field(default="", max_length=2000)
    optimization: VentOptimization = Field(default_factory=VentOptimization)

    @model_validator(mode="after")
    def positive_flow(self) -> Self:
        if self.control != "pressure" and self.valueSI <= 0:
            raise ValueError("Flow rate/velocity must be positive; supply/extract determines direction.")
        polygon = self.optimization.allowablePolygon
        if polygon and len(polygon) < 3:
            raise ValueError("An allowable movement region needs at least three vertices.")
        return self


class AssetOverride(Contract):
    objectId: Id
    mode: Literal["none", "solidProxy", "porousProxy", "sourceOnly"] = "solidProxy"
    heatW: Nonnegative = 0
    co2M3S: Nonnegative = 0
    count: int = Field(default=1, ge=1, le=10000)
    temperatureK: Temperature | None = None
    radiantFraction: Fraction = 0
    schedule: str = Field(default="constant", max_length=200)
    notes: str = Field(default="", max_length=2000)
    offsetMm: Vector = (0, 0, 0)
    refinementMm: Positive = 100

    @model_validator(mode="after")
    def one_thermal_control(self) -> Self:
        if self.temperatureK is not None and self.heatW > 0:
            raise ValueError("Choose heat power or a fixed surface temperature, not both.")
        if self.mode == "sourceOnly" and self.temperatureK is not None:
            raise ValueError("Source-only objects have no thermal surface; use heat power instead.")
        return self


class TimeControls(Contract):
    startS: Nonnegative = 0
    endS: Positive = 600
    stepS: Positive = 0.1
    adjustable: bool = True
    maxCourant: Positive = 1
    writeIntervalS: Positive = 10
    statisticsStartS: Nonnegative = 300

    @model_validator(mode="after")
    def ordered(self) -> Self:
        if self.endS <= self.startS or self.stepS > self.endS - self.startS:
            raise ValueError("Time end must follow start and contain at least one time step.")
        if not self.startS <= self.statisticsStartS <= self.endS:
            raise ValueError("Statistics start must be within the simulation interval.")
        return self


class Numerics(Contract):
    coupling: Literal["SIMPLE", "PIMPLE"] = "SIMPLE"
    gradient: Literal["linear", "limitedLinear"] = "limitedLinear"
    convection: Literal["upwind", "linearUpwind", "limitedLinear"] = "upwind"
    nonOrthogonalCorrections: int = Field(default=2, ge=0, le=20)
    relaxation: float = Field(default=0.7, gt=0, le=1)
    residualTarget: float = Field(default=1e-5, gt=0, lt=1)
    maxIterations: int = Field(default=1000, ge=1, le=10000000)
    writeEveryIterations: int = Field(default=50, ge=1, le=10000000)
    balanceTolerance: float = Field(default=0.05, gt=0, le=1)
    monitor: Literal["flowBalance", "temperature", "co2"] = "flowBalance"


class Physics(Contract):
    preset: Literal["isothermal", "buoyant", "co2", "custom"] = "isothermal"
    mode: Literal["steady", "transient"] = "steady"
    energy: bool = False
    co2: bool = False
    boussinesq: bool = False
    turbulence: Literal["laminar", "kEpsilon", "kOmegaSST"] = "kEpsilon"
    densityKgM3: float = Field(default=1.204, ge=0.01, le=100)
    dynamicViscosityPaS: float = Field(default=1.81e-5, ge=1e-8, le=1)
    heatCapacityJKgK: float = Field(default=1005, ge=100, le=1e5)
    conductivityWMK: float = Field(default=0.0257, ge=1e-5, le=1000)
    prandtl: float = Field(default=0.71, ge=0.01, le=1e4)
    expansionPerK: float = Field(default=0.00341, ge=1e-6, le=0.1)
    referenceTemperatureK: Temperature = 293.15
    referencePressurePa: float = Field(default=101325, ge=1000, le=1e7)
    outdoorTemperatureK: Temperature = 283.15
    humidityFraction: Fraction = 0.5
    gravityMS2: Vector = (0, 0, -9.81)
    initialVelocityMS: Vector = (0, 0, 0)
    initialPressurePa: float = Field(default=0, ge=-1e9, le=1e9)
    initialTemperatureK: Temperature = 293.15
    initialCo2Ppm: float = Field(default=420, ge=0, le=1e6)
    outdoorCo2Ppm: float = Field(default=420, ge=0, le=1e6)
    initialK: Nonnegative = 0.01
    initialEpsilon: Positive = 0.001
    initialOmega: Positive = 1
    time: TimeControls = Field(default_factory=TimeControls)
    numerics: Numerics = Field(default_factory=Numerics)

    @model_validator(mode="after")
    def dependencies(self) -> Self:
        if self.boussinesq and not self.energy:
            raise ValueError("Buoyancy needs the energy equation.")
        if self.boussinesq and sum(v * v for v in self.gravityMS2) == 0:
            raise ValueError("Buoyancy needs nonzero gravity.")
        return self


class Refinement(Contract):
    id: Id
    name: str = Field(min_length=1, max_length=120)
    shape: Literal["box", "sphere", "object"] = "box"
    centerMm: Vector = (0, 0, 0)
    sizeMm: tuple[Positive, Positive, Positive] = (1000, 1000, 1000)
    objectId: Id | None = None
    cellMm: Positive = 50
    level: int | None = Field(default=None, ge=0, le=10)


class Layers(Contract):
    enabled: bool = False
    count: int = Field(default=3, ge=1, le=30)
    firstMm: Positive = 2
    growth: float = Field(default=1.2, ge=1, le=2)
    minThicknessMm: Positive = 0.2
    coverage: Fraction = 0.8
    targetYPlus: Positive = 30


class MeshRecipe(Contract):
    preset: Literal["Draft", "Standard", "Fine", "Custom"] = "Standard"
    baseCellMm: CellLength = 200
    minCellMm: CellLength = 25
    maxCellMm: CellLength = 400
    originMm: Vector = (0, 0, 0)
    alignmentDeg: float = Field(default=0, ge=-360, le=360)
    targetCells: int = Field(default=100000, ge=1, le=1000000000)
    maxCells: int = Field(default=500000, ge=1, le=1000000000)
    geometryToleranceMm: float = Field(default=0.01, gt=0, le=1)
    smallFeatureMm: Positive = 5
    snapToleranceMm: Positive = 2
    ventCellMm: Positive = 25
    jetCellMm: Positive = 50
    openingCellMm: Positive = 50
    objectCellMm: Positive = 100
    wakeCellMm: Positive = 100
    wallCellMm: Positive = 100
    refinements: list[Refinement] = Field(default_factory=list, max_length=200)
    layers: Layers = Field(default_factory=Layers)
    featureAngleDeg: float = Field(default=30, gt=0, lt=180)
    snapIterations: int = Field(default=5, ge=1, le=100)
    maxNonOrthogonality: float = Field(default=65, gt=0, lt=90)
    maxSkewness: Positive = 4
    maxAspectRatio: Positive = 100
    minVolumeM3: Positive = 1e-15
    loadImbalance: Fraction = 0.1

    @model_validator(mode="after")
    def ordered(self) -> Self:
        if not self.minCellMm <= self.baseCellMm <= self.maxCellMm:
            raise ValueError("Mesh cell sizes must satisfy min ≤ base ≤ max.")
        if self.targetCells > self.maxCells:
            raise ValueError("Target cells cannot exceed the hard maximum.")
        if len({r.id for r in self.refinements}) != len(self.refinements):
            raise ValueError("Refinement IDs must be unique.")
        return self


class Resources(Contract):
    cpu: int = Field(default=1, ge=1, le=1024)
    memoryGb: Positive = 4
    wallTimeMinutes: int = Field(default=15, ge=1, le=43200)
    storageGb: Positive = 1
    retentionDays: int = Field(default=3, ge=1, le=3650)
    queue: str = Field(default="unassigned", max_length=100)


class Outputs(Contract):
    velocity: bool = True
    pressure: bool = True
    temperature: bool = False
    co2: bool = False
    ageOfAir: bool = False
    comfort: bool = False
    probesMm: list[Vector] = Field(default_factory=list, max_length=1000)


class SliceStack(Contract):
    enabled: bool = False
    count: int = Field(default=3, ge=1, le=100)


def default_slice_fields() -> list[Literal["U", "p", "T", "CO2"]]:
    return ["U", "p"]


class PostProcessing(Contract):
    """Interior evenly spaced planes; coordinates follow the source X/Y/Z frame."""

    x: SliceStack = Field(default_factory=SliceStack)
    y: SliceStack = Field(default_factory=SliceStack)
    z: SliceStack = Field(default_factory=lambda: SliceStack(enabled=True))
    fields: list[Literal["U", "p", "T", "CO2"]] = Field(
        default_factory=default_slice_fields, min_length=1, max_length=4
    )
    writeInterval: int = Field(default=1, ge=1, le=1000000)
    format: Literal["vtk"] = "vtk"

    @model_validator(mode="after")
    def unique_fields(self) -> Self:
        if len(set(self.fields)) != len(self.fields):
            raise ValueError("Post-processing fields must be unique.")
        return self


class Optimization(Contract):
    enabled: Literal[False] = False
    objective: Literal["comfort", "co2", "uniformity", "pressureLoss"] = "uniformity"
    notes: str = Field(default="", max_length=2000)


class ValidationStamp(Contract):
    clientRevision: str = Field(pattern=r"^[a-f0-9]{64}$")
    sourceHash: str = Field(pattern=r"^[a-f0-9]{64}$")
    configurationHash: str = Field(pattern=r"^[a-f0-9]{64}$")
    checkedAt: AwareDatetime
    errors: int = Field(ge=0)
    warnings: int = Field(ge=0)


class Scenario(Contract):
    version: Literal[1] = 1
    id: Id
    name: str = Field(min_length=1, max_length=120)
    description: str = Field(default="", max_length=2000)
    group: str = Field(default="General", min_length=1, max_length=80)
    archived: bool = False
    createdAt: AwareDatetime
    updatedAt: AwareDatetime
    sourceBuildingId: Id
    seed: Seed | None = None
    vents: list[Vent] = Field(default_factory=list, max_length=500)
    assetOverrides: list[AssetOverride] = Field(default_factory=list, max_length=2000)
    objectGroups: list[ObjectCollection] = Field(default_factory=list, max_length=100)
    objectCopies: list[ObjectCopy] = Field(default_factory=list, max_length=500)
    hiddenObjectIds: list[Id] = Field(default_factory=list, max_length=2000)
    boundaries: Boundaries = Field(default_factory=Boundaries)
    physics: Physics = Field(default_factory=Physics)
    mesh: MeshRecipe = Field(default_factory=MeshRecipe)
    resources: Resources = Field(default_factory=Resources)
    outputs: Outputs = Field(default_factory=Outputs)
    postProcessing: PostProcessing = Field(default_factory=PostProcessing)
    optimization: Optimization = Field(default_factory=Optimization)
    validation: ValidationStamp | None = None
    thermalEnvelope: ThermalSetup | None = None
    thermalSnapshots: list[ThermalSnapshot] = Field(default_factory=list, max_length=3)

    @model_validator(mode="after")
    def unique_entities(self) -> Self:
        groups, copies, hidden = self.objectGroups or [], self.objectCopies or [], self.hiddenObjectIds or []
        members = [mid for group in groups for mid in group.memberIds]
        if (len({g.id for g in groups}) != len(groups) or len({g.name.lower() for g in groups}) != len(groups)
                or len(set(members)) != len(members) or len(members) > 3000
                or (len(groups) == 100 and not any(g.id == "objects-default" for g in groups))
                or len({o.id for o in copies}) != len(copies) or any(o.sourceObjectId in {v.id for v in copies} for o in copies)
                or len(set(hidden)) != len(hidden)):
            raise ValueError("Object groups, copies and hidden IDs must have unique valid membership; copies reference original measured objects.")
        for collection, key in ((self.vents, "id"), (self.assetOverrides, "objectId")):
            if len({getattr(item, key) for item in collection}) != len(collection):
                raise ValueError("Scenario object IDs must be unique.")
        return self


class Diagnostic(Contract):
    severity: Literal["error", "warning", "info"]
    group: Literal["geometry", "connectivity", "vents", "boundaries", "physics", "mesh", "resources", "outputs"]
    code: str
    objectId: str | None = None
    message: str
    repair: str


class ProviderCapabilities(Contract):
    id: str = "preparation-only"
    status: Literal["notConnected", "connected", "disabled"] = "notConnected"
    canValidate: bool = True
    canPrepareGeometry: bool = True
    canPrepareMeshRecipe: bool = True
    canGenerateCase: bool = False
    canMesh: bool = False
    canRun: bool = False
    canCancel: bool = False
    canOptimize: bool = False
    reason: str = "Preparation only. No CFD mesher, solver or job service is connected."


class PreparedCase(Contract):
    """Future artifact reference, never an arbitrary server path or shell template."""

    artifactId: Id
    sourceHash: str = Field(pattern=r"^[a-f0-9]{64}$")
    configurationHash: str = Field(pattern=r"^[a-f0-9]{64}$")
    dialect: str = Field(min_length=1, max_length=100)


class JobHandle(Contract):
    id: Id
    providerId: Id
    sourceHash: str = Field(pattern=r"^[a-f0-9]{64}$")
    configurationHash: str = Field(pattern=r"^[a-f0-9]{64}$")
    state: Literal[
        "Queued", "Meshing", "MeshCheck", "Running", "Postprocess", "Completed", "Failed", "Cancelled", "Stale"
    ]
    createdAt: AwareDatetime


class ResultField(Contract):
    name: Literal["velocity", "pressure", "temperature", "co2", "ageOfAir"]
    unit: str = Field(min_length=1, max_length=40)
    artifactId: Id


class ResultManifest(Contract):
    version: Literal[1] = 1
    jobId: Id
    providerId: Id
    sourceHash: str = Field(pattern=r"^[a-f0-9]{64}$")
    configurationHash: str = Field(pattern=r"^[a-f0-9]{64}$")
    fields: list[ResultField] = Field(max_length=100)
    converged: bool
