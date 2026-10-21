"""pvlib NREL SPA and explicit isotropic sky transposition; no network or invented weather."""

import math
from datetime import UTC, datetime, timedelta, timezone
from functools import lru_cache
from typing import Any
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from geometry.thermal_models import ThermalSetup


def local_instant(setup: ThermalSetup) -> datetime:
    try:
        local = datetime.fromisoformat(setup.localDateTime)
    except ValueError:
        raise ValueError("Choose a valid local date and time.") from None
    if local.tzinfo or not 1900 <= local.year <= 2100:
        raise ValueError("Use a local time without an embedded offset, in 1900–2100.")
    location = setup.location
    if location.fixedUtcOffsetMinutes is not None:
        return local.replace(tzinfo=timezone(timedelta(minutes=location.fixedUtcOffsetMinutes)))
    try:
        zone = ZoneInfo(location.timezone)
    except (ValueError, ZoneInfoNotFoundError):
        raise ValueError("Choose a valid IANA timezone, such as Europe/London or UTC.") from None
    candidates = [local.replace(tzinfo=zone, fold=fold) for fold in (0, 1)]
    valid = [time for time in candidates if time.astimezone(UTC).astimezone(zone).replace(tzinfo=None) == local]
    if not valid:
        raise ValueError("This local time does not exist because of a DST clock change. Choose another time.")
    if len({time.utcoffset() for time in valid}) > 1:
        if setup.dstChoice == "reject":
            raise ValueError("This local time occurs twice. Select the earlier or later DST occurrence.")
        return sorted(valid, key=lambda time: time.astimezone(UTC))[setup.dstChoice == "later"]
    return valid[0]


@lru_cache(maxsize=64)
def _position(instant: str, latitude: float, longitude: float, altitude: float, temperature: float) -> dict[str, Any]:
    import pandas as pd
    import pvlib

    row = pvlib.solarposition.get_solarposition(
        pd.DatetimeIndex([datetime.fromisoformat(instant)]),
        latitude,
        longitude,
        altitude=altitude,
        temperature=temperature,
        method="nrel_numpy",
    ).iloc[0]
    return {
        "azimuthDeg": float(row.azimuth),
        "elevationDeg": float(row.elevation),
        "zenithDeg": float(row.zenith),
        "instantUtc": instant,
        "method": f"pvlib {pvlib.__version__} · NREL SPA · geometric horizon",
    }


def sun_position(setup: ThermalSetup) -> dict[str, Any]:
    location = setup.location
    if location.latitude is None or location.longitude is None:
        raise ValueError("Enter latitude and longitude; no location is assumed.")
    if not location.source.strip():
        raise ValueError("Describe the location source (manual measurement, city reference or EPW).")
    if setup.weather.temperatureC is None:
        raise ValueError("Enter the outdoor dry-bulb temperature.")
    time = local_instant(setup).astimezone(UTC).isoformat()
    return dict(_position(time, location.latitude, location.longitude, location.elevationM, setup.weather.temperatureC))


def irradiance(tilt: float, azimuth: float, setup: ThermalSetup, sun: dict[str, Any]) -> dict[str, float]:
    if setup.weather.solarMode == "none":
        return {"beamWm2": 0.0, "skyWm2": 0.0, "groundWm2": 0.0, "totalWm2": 0.0}
    weather = setup.weather
    if weather.solarMode != "components":
        raise ValueError("Set incident irradiance on each outdoor face in per-surface mode.")
    if weather.dniWm2 is None or weather.dhiWm2 is None:
        raise ValueError("Enter both DNI and DHI; missing solar components are not inferred.")
    if setup.groundAlbedo is None:
        raise ValueError("Enter ground reflectance/albedo for the tilted-irradiance model.")
    cos_zenith = max(0.0, math.cos(math.radians(sun["zenithDeg"])))
    dni = weather.dniWm2 if sun["elevationDeg"] > 0 else 0.0
    if sun["elevationDeg"] <= 0 and weather.dhiWm2 > 0:
        raise ValueError(
            "Positive diffuse solar below the geometric horizon is unsupported; "
            "use zero night forcing or explicit per-face forcing."
        )
    derived_ghi = dni * cos_zenith + weather.dhiWm2
    if (
        weather.forcingBasis == "instant"
        and weather.ghiWm2 is not None
        and abs(weather.ghiWm2 - derived_ghi) > max(10, derived_ghi * 0.05)
    ):
        raise ValueError("GHI is inconsistent with DNI × cos(zenith) + DHI (5% or 10 W/m² tolerance).")
    import pvlib

    values = pvlib.irradiance.get_total_irradiance(
        tilt,
        azimuth,
        sun["zenithDeg"],
        sun["azimuthDeg"],
        dni,
        derived_ghi if weather.ghiWm2 is None else weather.ghiWm2,
        weather.dhiWm2,
        albedo=setup.groundAlbedo,
        model="isotropic",
    )
    return {
        name: float(values[key])
        for name, key in (
            ("beamWm2", "poa_direct"),
            ("skyWm2", "poa_sky_diffuse"),
            ("groundWm2", "poa_ground_diffuse"),
            ("totalWm2", "poa_global"),
        )
    }
