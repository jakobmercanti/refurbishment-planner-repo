"""Render-only colour regions shared by catalogue records and browser models."""
import json
from pathlib import Path

MANIFEST = json.loads((Path(__file__).resolve().parents[1] / "frontend/lib/assetColourParts.json").read_text(encoding="utf-8"))


def colour_parts_for(representation_key: str, colour: str, *, imported_mesh: bool = False) -> list[dict[str, str]]:
    # STL has no semantic part/material assignments. Do not invent mesh regions.
    profile = "whole" if imported_mesh else MANIFEST["representations"].get(representation_key, "whole")
    return [
        {**part, "default_color_hex": colour.upper() if part["default_color_hex"] == "$catalogue" else part["default_color_hex"]}
        for part in MANIFEST["profiles"][profile]
    ]
