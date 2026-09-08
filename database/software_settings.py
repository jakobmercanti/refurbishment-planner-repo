"""Readable, file-backed application settings.

The object catalogue manager owns these settings.  They intentionally live
outside the catalogue database so administrators can inspect and version the
configuration without needing SQLite tools.
"""

from __future__ import annotations

import json
import os
from copy import deepcopy
from pathlib import Path
from tempfile import NamedTemporaryFile
from threading import Lock
from typing import Any

DEFAULT_SOFTWARE_SETTINGS = {
    "schema_version": 1,
    "toolbars": {
        "layout_analysis": True,
        "human_mockup": False,
    },
}

_settings_lock = Lock()


def software_settings_path() -> Path:
    """Return the configurable, project-local settings file path."""

    configured = os.environ.get("RENOVATION_FIT_SETTINGS_FILE")
    project_root = Path(__file__).resolve().parents[1]
    path = Path(configured) if configured else project_root / "data" / "software_settings.json"
    path.parent.mkdir(parents=True, exist_ok=True)
    return path.resolve()


def _normalise(raw: object) -> dict[str, Any]:
    """Keep the on-disk format small, typed, and safe to load at startup."""

    # Preserve future administrator-owned sections so adding one setting never
    # erases another setting that a newer version of the manager understands.
    settings = deepcopy(raw) if isinstance(raw, dict) else deepcopy(DEFAULT_SOFTWARE_SETTINGS)
    settings["schema_version"] = 1
    toolbars = deepcopy(settings.get("toolbars")) if isinstance(settings.get("toolbars"), dict) else {}
    if not isinstance(toolbars.get("layout_analysis"), bool):
        toolbars["layout_analysis"] = DEFAULT_SOFTWARE_SETTINGS["toolbars"]["layout_analysis"]
    if not isinstance(toolbars.get("human_mockup"), bool):
        toolbars["human_mockup"] = DEFAULT_SOFTWARE_SETTINGS["toolbars"]["human_mockup"]
    settings["toolbars"] = toolbars
    defaults = json.loads((Path(__file__).resolve().parents[1] / "data" / "ui_theme_defaults.json").read_text(encoding="utf-8"))
    ui = settings.get("ui") if isinstance(settings.get("ui"), dict) else {}
    # Merge additions while preserving administrator-edited theme profiles.
    def merge(default: dict, saved: dict) -> dict:
        result = deepcopy(default)
        for key, value in saved.items():
            if key in default and isinstance(default[key], dict):
                if isinstance(value, dict):
                    result[key] = merge(default[key], value)
            elif isinstance(value, str):
                result[key] = value
        return result
    settings["ui"] = merge(defaults, ui)
    if settings["ui"]["style"] not in ("DEFAULT", "MODERN"):
        settings["ui"]["style"] = "DEFAULT"
    return settings


def _write(path: Path, settings: dict[str, Any]) -> None:
    """Atomically replace the JSON file so a running app never reads a partial write."""

    with NamedTemporaryFile(
        "w", encoding="utf-8", dir=path.parent, prefix=f".{path.stem}-", suffix=".tmp", delete=False
    ) as temporary:
        json.dump(settings, temporary, indent=2)
        temporary.write("\n")
        temporary_path = Path(temporary.name)
    temporary_path.replace(path)


def load_software_settings() -> dict[str, Any]:
    """Load settings on startup, creating the readable default file if needed."""

    path = software_settings_path()
    with _settings_lock:
        try:
            raw = json.loads(path.read_text(encoding="utf-8")) if path.exists() else None
        except (OSError, json.JSONDecodeError):
            raw = None
        settings = _normalise(raw)
        if raw != settings:
            _write(path, settings)
        return settings


def update_software_settings(
    *,
    layout_analysis_toolbar_visible: bool | None = None,
    human_mockup_toolbar_visible: bool | None = None,
    ui_style: str | None = None,
) -> dict[str, Any]:
    """Persist the manager-controlled settings and return the canonical document."""

    path = software_settings_path()
    with _settings_lock:
        try:
            raw = json.loads(path.read_text(encoding="utf-8")) if path.exists() else None
        except (OSError, json.JSONDecodeError):
            raw = None
        settings = _normalise(raw)
        if ui_style is not None:
            settings["ui"]["style"] = ui_style
        if layout_analysis_toolbar_visible is not None:
            settings["toolbars"]["layout_analysis"] = layout_analysis_toolbar_visible
        if human_mockup_toolbar_visible is not None:
            settings["toolbars"]["human_mockup"] = human_mockup_toolbar_visible
        _write(path, settings)
        return settings
