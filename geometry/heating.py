"""Portable catalogue emitter specifications; no geometry or derived output here."""
from pydantic import BaseModel, Field
from typing import Literal

class HeatingPerformancePoint(BaseModel):
    flowC: float = Field(ge=5, le=95)
    returnC: float = Field(ge=5, le=95)
    roomC: float = Field(ge=5, le=35)
    outputW: float = Field(ge=0, le=100_000)
    fanMode: Literal["Silent", "Normal", "Boost"] = "Normal"
    electricalW: float = Field(ge=0, le=100_000)
    soundDb: float | None = Field(default=None, ge=0, le=150)

class HeatingElementSpec(BaseModel):
    category: Literal["Type 10", "Type 11", "Type 21", "Type 22", "Type 33", "Towel", "Custom", "Boiler"] = "Custom"
    estimatedOutput: bool = False
    manufacturer: str = Field(default="", max_length=1000)
    model: str = Field(default="", max_length=1000)
    emitterTechnology: Literal["Hydronic", "Electric", "Hybrid"] = "Hydronic"
    ratedOutputW: float | None = Field(default=None, ge=0, le=100_000)
    ratedDeltaTK: float = Field(default=50, gt=0, le=100)
    exponent: float = Field(default=1.3, gt=0, le=3)
    electricalInputW: float = Field(default=0, ge=0, le=100_000)
    fanMode: Literal["Silent", "Normal", "Boost"] = "Normal"
    manufacturerPerformanceData: list[HeatingPerformancePoint] = Field(default_factory=list, max_length=1000)
    performanceReference: str | None = Field(default=None, max_length=1000)
    catalogueItemId: str | None = Field(default=None, max_length=150)
    locked: bool = False
