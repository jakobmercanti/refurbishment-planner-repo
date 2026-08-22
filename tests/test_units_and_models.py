from __future__ import annotations

import math

import pytest
from pydantic import ValidationError

from geometry.fixtures import measured
from geometry.models import Measurement, SourceType


def test_internal_measurements_reject_unknown_units() -> None:
    with pytest.raises(ValidationError, match="unit"):
        Measurement.model_validate(
            {
                "value": 2.4,
                "unit": "m",
                "source_type": "USER_MEASURED",
                "verified": True,
            }
        )


@pytest.mark.parametrize("value", [math.nan, math.inf, -math.inf])
def test_measurements_reject_non_finite_values(value: float) -> None:
    with pytest.raises(ValidationError, match="finite"):
        measured(value)


def test_measurements_reject_negative_lengths() -> None:
    with pytest.raises(ValidationError, match="greater than or equal to 0"):
        Measurement(
            value=-1.0,
            source_type=SourceType.USER_MEASURED,
            verified=True,
            uncertainty_mm=0.0,
        )


def test_ai_extracted_value_cannot_arrive_verified() -> None:
    with pytest.raises(ValidationError, match="manual verification"):
        Measurement(
            value=1200.0,
            source_type=SourceType.AI_EXTRACTED,
            verified=True,
            uncertainty_mm=20.0,
        )


def test_measurement_interval_is_conservative() -> None:
    measurement = Measurement(
        value=1207.0,
        source_type=SourceType.ROOM_SCAN,
        verified=False,
        uncertainty_mm=12.0,
    )
    assert measurement.lower_mm == 1195.0
    assert measurement.upper_mm == 1219.0
