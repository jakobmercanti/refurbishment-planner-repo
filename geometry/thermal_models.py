"""Versioned sensible-only thermal intentions, separate from computed CFD results."""

from typing import Annotated, Literal, Self

from pydantic import BaseModel, ConfigDict, Field, model_validator

Fraction = Annotated[float, Field(ge=0, le=1)]
Positive = Annotated[float, Field(gt=0, le=1e8)]
Celsius = Annotated[float, Field(ge=-100, le=200)]
Key = Annotated[str, Field(min_length=1, max_length=1000)]
ShortText = Annotated[str, Field(max_length=2000)]


class ThermalContract(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True, allow_inf_nan=False, validate_default=True)


class ThermalLocation(ThermalContract):
    name: ShortText = ""
    latitude: Annotated[float, Field(ge=-90, le=90)] | None = None
    longitude: Annotated[float, Field(ge=-180, le=180)] | None = None
    timezone: Annotated[str, Field(max_length=100)] = ""
    elevationM: Annotated[float, Field(ge=-500, le=9000)] = 0
    fixedUtcOffsetMinutes: Annotated[int, Field(ge=-840, le=840)] | None = None
    source: ShortText = ""


class ThermalWeather(ThermalContract):
    scenario: Literal["custom", "summerDesign", "winterDesign", "summerDaytime", "winterDaytime"] = "custom"
    source: ShortText = ""
    temperatureC: Celsius | None = None
    relativeHumidity: Fraction | None = None
    windMS: Annotated[float, Field(ge=0, le=150)] | None = None
    externalH: Annotated[float, Field(gt=0, le=1000)] | None = None
    solarMode: Literal["none", "components", "perSurface"] = "none"
    forcingBasis: Literal["instant", "hourlyMean"] = "instant"
    dniWm2: Annotated[float, Field(ge=0, le=2000)] | None = None
    dhiWm2: Annotated[float, Field(ge=0, le=2000)] | None = None
    ghiWm2: Annotated[float, Field(ge=0, le=2000)] | None = None
    epwRecord: ShortText = ""


class ThermalAirExchange(ThermalContract):
    mode: Literal["unspecified", "none", "ach", "volume", "mass", "devices"] = "unspecified"
    value: Annotated[float, Field(ge=0, le=1e6)] = 0
    supplyTemperatureC: Celsius | None = None
    extractValue: Annotated[float, Field(ge=0, le=1e6)] | None = None
    source: ShortText = ""


class ThermalGain(ThermalContract):
    id: Annotated[str, Field(min_length=1, max_length=150)]
    name: Annotated[str, Field(min_length=1, max_length=120)]
    kind: Literal["people", "lighting", "equipment", "other"] = "equipment"
    objectId: Annotated[str, Field(max_length=150)] | None = None
    roomId: Annotated[str, Field(max_length=150)] | None = None
    count: Annotated[int, Field(ge=0, le=10000)] = 1
    powerW: Annotated[float, Field(ge=0, le=1e7)] = 0
    sensibleFraction: Fraction = 1
    operatingFraction: Fraction = 1
    radiantFraction: Fraction = 0
    enabled: bool = True
    source: ShortText = ""


class ThermalOverride(ThermalContract):
    assemblyId: Annotated[str, Field(max_length=180)] | None = None
    uWm2K: Annotated[float, Field(gt=0, le=100)] | None = None
    uIncludesFilms: bool | None = None
    rsi: Annotated[float, Field(ge=0, le=10)] | None = None
    rse: Annotated[float, Field(ge=0, le=10)] | None = None
    exposure: Literal["auto", "outdoors", "ground", "adjacent", "adiabatic"] = "auto"
    ambientC: Celsius | None = None
    alpha: Fraction | None = None
    emissivity: Fraction | None = None
    gValue: Fraction | None = None
    shadingFactor: Fraction | None = None
    incidentWm2: Annotated[float, Field(ge=0, le=3000)] | None = None
    externalH: Annotated[float, Field(gt=0, le=1000)] | None = None
    longwaveWm2: Annotated[float, Field(ge=-2000, le=2000)] | None = None
    method: Literal["inherit", "robin", "fixedFlux", "temperature", "adiabatic"] = "inherit"
    fixedFluxWm2: Annotated[float, Field(ge=-1e5, le=1e5)] | None = None
    fixedTemperatureC: Celsius | None = None
    acknowledgedAssemblyRevision: Annotated[str, Field(max_length=64)] = ""
    reason: ShortText = ""
    updatedAt: Annotated[str, Field(max_length=40)] = ""


class ThermalSetup(ThermalContract):
    schemaVersion: Literal[1] = 1
    thermalMode: Literal["steady_no_hvac"] = "steady_no_hvac"
    insulationScenarios: dict[Key, str | None] = Field(default_factory=dict, max_length=20)
    location: ThermalLocation = Field(default_factory=ThermalLocation)
    northDeg: Annotated[float, Field(ge=0, le=360)] = 0
    localDateTime: Annotated[str, Field(max_length=40)] = ""
    dstChoice: Literal["reject", "earlier", "later"] = "reject"
    weather: ThermalWeather = Field(default_factory=ThermalWeather)
    airExchange: ThermalAirExchange = Field(default_factory=ThermalAirExchange)
    gains: list[ThermalGain] = Field(default_factory=list, max_length=2000)
    includeCFDSources: bool = False
    assumptionsAccepted: bool = False
    referenceIndoorC: Celsius = 20
    rhoKgM3: Annotated[float, Field(gt=0, le=10)] = 1.2
    cpJKgK: Annotated[float, Field(gt=0, le=10000)] = 1005
    groundTemperatureC: Celsius | None = None
    opaqueAbsorptance: Fraction | None = None
    groundAlbedo: Fraction | None = None
    shadingFactor: Fraction = 1
    longwaveWm2: Annotated[float, Field(ge=-2000, le=2000)] = 0
    method: Literal["robin", "fixedFlux"] = "robin"
    balanceToleranceW: Annotated[float, Field(gt=0, le=100)] = 0.01
    overrides: dict[Key, ThermalOverride] = Field(default_factory=dict, max_length=6000)


class ThermalLayer(ThermalContract):
    layerId: str
    name: str
    thicknessMm: float
    lambdaWMK: float | None
    rM2KW: float | None
    reference: str


class ThermalBC(ThermalContract):
    model: Literal["adiabatic", "externalRobin", "fixedFlux", "fixedTemperature"]
    rOutwardM2KW: float | None = None
    tEqOutsideK: float | None = None
    fluxIntoRoomWm2: float | None = None
    temperatureK: float | None = None
    referenceIndoorK: float | None = None


class ThermalSurface(ThermalContract):
    surfaceId: Key
    patchId: Key
    roomId: str
    roomName: str
    floorId: str
    elementId: Key
    kind: str
    category: str
    exposure: Literal["outdoors", "ground", "adjacent", "internal", "adiabatic"]
    neighborRoomId: str | None
    areaM2: Positive
    normal: list[float] = Field(min_length=3, max_length=3)
    centroidMm: list[float] = Field(min_length=3, max_length=3)
    azimuthDeg: float
    tiltDeg: float
    verticesMm: list[list[float]] = Field(max_length=50000)
    triangles: list[list[int]] = Field(max_length=50000)
    assemblyId: str | None
    assemblyName: str
    assemblyRevision: str
    insulationRevision: str
    insulationAssemblyId: str | None = None
    insulationAssemblyName: str = "Unknown source construction"
    insulationUWm2K: float | None = None
    insulationRsi: float | None = None
    insulationRse: float | None = None
    insulationAssemblyLayers: list[ThermalLayer] | None = None
    assemblyLayers: list[ThermalLayer]
    uWm2K: float | None
    rTotalM2KW: float | None
    rsi: float | None
    rse: float | None
    source: str
    alpha: float | None
    emissivity: float | None
    gValue: float | None
    shadingFactor: float
    ambientC: float | None
    status: Literal["valid", "incomplete", "overridden", "stale", "inapplicable"]
    warnings: list[str]
    override: ThermalOverride | None
    method: Literal["robin", "fixedFlux", "temperature", "adiabatic"]
    incidentWm2: float | None
    absorbedWm2: float | None
    transmittedW: float | None
    equivalentC: float | None
    conductanceWK: float | None
    fluxWm2: float | None
    heatW: float | None
    cfdBC: ThermalBC | None


class ThermalPreview(ThermalContract):
    modelFidelity: Literal["lumped_steady_screening"] = "lumped_steady_screening"
    equilibriumAirTempC: float | None = None
    heatBalanceResidualW: float | None = None
    envelopeConductanceWK: float = 0
    airConductanceWK: float = 0
    totalConductanceWK: float = 0
    transmittedSolarW: float = 0
    internalGainsW: float = 0
    opaqueSolarEquivalentW: float = 0
    airExchangeW: float | None = None
    netAtReferenceW: float | None = None


class ThermalSource(ThermalContract):
    id: str
    name: str
    powerW: float
    radiantFraction: float
    roomId: str | None
    objectId: str | None
    source: str
    deposition: Literal["lumped_sensible_air"] = "lumped_sensible_air"


class ThermalExchangeResult(ThermalContract):
    mode: str
    volumeFlowM3S: float = 0
    massFlowKgS: float = 0
    supplyTemperatureC: float | None = None


class ThermalSun(ThermalContract):
    azimuthDeg: float
    elevationDeg: float
    zenithDeg: float
    instantUtc: str
    method: str


class ThermalValidation(ThermalContract):
    errors: list[str]
    warnings: list[str]
    projectionErrors: list[str]
    previewReady: bool
    applyReady: bool
    energyCompatible: bool


class ThermalPackage(ThermalContract):
    schemaVersion: Literal[1] = 1
    kind: Literal["ThermalBoundaryPackage"] = "ThermalBoundaryPackage"
    projectId: str
    domainId: str
    sourceRevision: str
    caseHash: str
    geometryHash: str
    constructionHash: str
    configurationHash: str
    scenario: ThermalSetup
    surfaces: list[ThermalSurface] = Field(max_length=6000)
    internalSources: list[ThermalSource]
    airExchange: ThermalExchangeResult
    sun: ThermalSun | None
    cardinalIrradianceWm2: dict[str, float]
    preview: ThermalPreview
    validation: ThermalValidation
    limitations: list[str]
    temperatureUnits: Literal["C display / K handoff"] = "C display / K handoff"
    fluxConvention: Literal["positive into selected air domain"] = "positive into selected air domain"
    adapter: Literal["OpenCFD-v2312-contract-only"] = "OpenCFD-v2312-contract-only"
    executed: Literal[False] = False
    runnable: Literal[False] = False


class ThermalSnapshot(ThermalContract):
    """Immutable historical handoff, not a trusted report for server calculations."""

    schemaVersion: Literal[1]
    caseHash: Annotated[str, Field(pattern=r"^[a-f0-9]{64}$")]
    sourceRevision: Annotated[str, Field(pattern=r"^[a-f0-9]{64}$")]
    createdAt: Annotated[str, Field(max_length=40)]
    package: ThermalPackage

    @model_validator(mode="after")
    def consistent_history(self) -> Self:
        if self.caseHash != self.package.caseHash or self.sourceRevision != self.package.sourceRevision:
            raise ValueError("Historical thermal package hashes must match their immutable snapshot.")
        return self
