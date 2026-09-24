"""Narrow, server-side relay for anonymous floorplan action totals."""

from __future__ import annotations

import asyncio
import json
import os
from typing import Literal
from urllib.request import ProxyHandler, Request as URLRequest, build_opener

from fastapi import APIRouter, HTTPException, Request, Response
from pydantic import BaseModel, ConfigDict, model_validator

router = APIRouter()


class AggregateEvent(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)

    event: Literal["floorplan_generated", "floorplan_downloaded"]
    format: Literal["floorplan3d", "pdf", "png", "jpg", "svg", "json"] | None = None

    @model_validator(mode="after")
    def format_matches_event(self) -> "AggregateEvent":
        if (self.event == "floorplan_downloaded") != (self.format is not None):
            raise ValueError("Format is required only for a download.")
        return self


def _send_to_posthog(payload: bytes) -> None:
    # Match httpx trust_env=False: do not route analytics through environment proxies.
    opener = build_opener(ProxyHandler({}))
    request = URLRequest(
        "https://us.i.posthog.com/i/v0/e/",
        data=payload,
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    with opener.open(request, timeout=3.0) as result:
        if not 200 <= result.status < 300:
            raise OSError("PostHog rejected the event")


@router.post("/analytics/event", status_code=204)
async def record_aggregate_action(request: Request, event: AggregateEvent) -> Response:
    # The Cloudflare worker sends only the canonical Origin and JSON body.
    if request.headers.get("origin") != "https://www.freefloorplan3d.com":
        raise HTTPException(status_code=403, detail="Forbidden")
    if request.headers.get("content-type", "").split(";", 1)[0].strip().lower() != "application/json":
        raise HTTPException(status_code=415, detail="JSON required")
    token = os.getenv("POSTHOG_PROJECT_TOKEN")
    if not token:
        raise HTTPException(status_code=503, detail="Analytics is unavailable")
    properties: dict[str, str | bool] = {
        "distinct_id": "aggregate-production",
        "$process_person_profile": False,
        "$geoip_disable": True,
    }
    if event.format is not None:
        properties["format"] = event.format
    # Never pass through request headers, source IP, URL, referrer, or cookies.
    payload = json.dumps(
        {"api_key": token, "event": event.event, "properties": properties},
        separators=(",", ":"),
    ).encode("utf-8")
    try:
        await asyncio.to_thread(_send_to_posthog, payload)
    except Exception:
        raise HTTPException(status_code=502, detail="Analytics is unavailable") from None
    return Response(status_code=204, headers={"Cache-Control": "no-store"})
