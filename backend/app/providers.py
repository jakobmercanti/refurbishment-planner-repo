"""Future optional provider interfaces kept outside the engineering decision path."""

from __future__ import annotations

from typing import Protocol


class RenderingProvider(Protocol):
    def render_visualisation(self, cad_artifact: str, camera_view: str) -> str:
        """Return a non-authoritative visualisation artifact location."""


class RoomCaptureProvider(Protocol):
    def capture_candidate_geometry(self, source: str) -> dict[str, object]:
        """Return unverified candidate geometry that must pass manual review."""
