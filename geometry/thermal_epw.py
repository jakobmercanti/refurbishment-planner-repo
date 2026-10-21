"""Bounded user-uploaded EPW hourly forcing. No paths, URLs or downloads.

EPW hour 1 denotes the interval ending 01:00. Solar position is evaluated at
its midpoint (00:30), in the file's fixed local STANDARD time, never DST.
Hourly Wh/m² radiation numerically equals the hourly mean W/m² forcing.
"""

import csv
import hashlib
import io
import math
from datetime import datetime, timedelta
from typing import Any


def parse_epw(text: str, filename: str) -> dict[str, Any]:
    if len(text.encode("utf-8")) > 4 * 1024 * 1024:
        raise ValueError("EPW upload exceeds 4 MB.")
    rows = csv.reader(io.StringIO(text.lstrip("\ufeff")))
    header = next(rows, [])
    if len(header) < 10 or header[0] != "LOCATION":
        raise ValueError("Expected an EPW LOCATION header.")
    try:
        lat, lon, offset, elevation = map(float, header[6:10])
    except ValueError:
        raise ValueError("EPW location fields are not numeric.") from None
    if not all(math.isfinite(v) for v in (lat, lon, offset, elevation)) or not (
        -90 <= lat <= 90 and -180 <= lon <= 180 and -14 <= offset <= 14 and -500 <= elevation <= 9000
    ):
        raise ValueError("EPW location is outside supported latitude/longitude/timezone/elevation ranges.")
    if abs(offset * 60 - round(offset * 60)) > 1e-6:
        raise ValueError("EPW timezone must resolve to whole offset minutes.")
    for _ in range(7):
        next(rows, None)
    records, rejected, seen = [], 0, set()
    for index, row in enumerate(rows):
        if index >= 8784:
            raise ValueError("EPW supports at most 8784 hourly records.")
        try:
            year, month, day, hour, minute = map(int, row[:5])
            if not 1900 <= year <= 2100 or not 1 <= hour <= 24 or minute != 60:
                raise ValueError()
            midpoint = datetime(year, month, day) + timedelta(hours=hour - 1, minutes=30)
            temp, rh, ghi, dni, dhi, wind = [float(row[i]) for i in (6, 8, 13, 14, 15, 21)]
            if temp == 99.9:  # EPW missing dry-bulb sentinel, not a valid hot condition.
                raise ValueError()
            if not all(math.isfinite(v) for v in (temp, rh, ghi, dni, dhi, wind)) or not (
                -100 <= temp <= 200
                and 0 <= rh <= 100
                and 0 <= wind <= 150
                and all(0 <= v <= 2000 for v in (ghi, dni, dhi))
            ):
                raise ValueError()
            label = midpoint.isoformat(timespec="minutes")
            if label in seen:
                raise ValueError()
            seen.add(label)
            records.append(
                {
                    "index": index,
                    "localDateTime": label,
                    "temperatureC": temp,
                    "relativeHumidity": rh / 100,
                    "windMS": wind,
                    "ghiWm2": ghi,
                    "dniWm2": dni,
                    "dhiWm2": dhi,
                }
            )
        except (ValueError, IndexError):
            rejected += 1
    if not records:
        raise ValueError(
            "No valid hourly EPW rows. Missing sentinels, duplicate times "
            "and unsupported sub-hourly records are rejected."
        )
    digest = hashlib.sha256(text.encode("utf-8")).hexdigest()
    name = filename.replace("\\", "/").split("/")[-1][:120]
    return {
        "location": {
            "name": f"{header[1]}, {header[3]}",
            "latitude": lat,
            "longitude": lon,
            "timezone": "",
            "fixedUtcOffsetMinutes": round(offset * 60),
            "elevationM": elevation,
            "source": f"User EPW {name} · {digest}",
        },
        "records": records,
        "rejectedRows": rejected,
        "source": f"EPW {name} · SHA256 {digest}",
        "timeConvention": "Hourly mean forcing at interval midpoint in EPW fixed local STANDARD time (no DST).",
    }
