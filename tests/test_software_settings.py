"""Settings updates preserve customisations and never leave partial writes."""

import json
from pathlib import Path
from unittest.mock import patch

import pytest

from database.software_settings import _normalise, _write, load_software_settings, update_software_settings


@pytest.fixture
def settings_path(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Path:
    path = tmp_path / "settings.json"
    monkeypatch.setenv("RENOVATION_FIT_SETTINGS_FILE", str(path))
    return path


@pytest.mark.parametrize("raw", [None, [], "bad", {"toolbars": []}, {"ui": {"style": "UNKNOWN"}}])
def test_invalid_settings_get_safe_defaults_without_mutating_input(raw: object) -> None:
    before = json.dumps(raw)
    result = _normalise(raw)
    assert result["schema_version"] == 1
    assert result["toolbars"]["layout_analysis"] is True
    assert result["toolbars"]["human_mockup"] is False
    assert result["ui"]["style"] == "DEFAULT"
    assert json.dumps(raw) == before


def test_settings_update_retains_future_sections_and_custom_theme(settings_path: Path) -> None:
    saved = {
        "future": {"enabled": True},
        "toolbars": {"human_mockup": True, "future_toolbar": False},
        "ui": {"style": "MODERN", "themes": {"MODERN": {"colours": {"ink": "#123456"}}}},
    }
    settings_path.write_text(json.dumps(saved), encoding="utf8")
    result = update_software_settings(layout_analysis_toolbar_visible=False)
    assert result["future"] == saved["future"]
    assert result["toolbars"] == {"human_mockup": True, "future_toolbar": False, "layout_analysis": False}
    assert result["ui"]["style"] == "MODERN"
    assert result["ui"]["themes"]["MODERN"]["colours"]["ink"] == "#123456"
    assert json.loads(settings_path.read_text(encoding="utf8")) == result
    with patch("database.software_settings._write") as write:
        assert load_software_settings() == result
        write.assert_not_called()


@pytest.mark.parametrize("content", [b"{truncated", b"\xff\xfe\xff"])
def test_corrupt_settings_recover_to_valid_document(settings_path: Path, content: bytes) -> None:
    settings_path.write_bytes(content)
    result = load_software_settings()
    assert json.loads(settings_path.read_text(encoding="utf8")) == result


@pytest.mark.parametrize("failure", ["serialize", "replace"])
def test_atomic_settings_failure_preserves_previous_file_and_cleans_temp(settings_path: Path, failure: str) -> None:
    settings_path.write_text('{"previous":true}', encoding="utf8")
    target = "database.software_settings.json.dump" if failure == "serialize" else "pathlib.Path.replace"
    with patch(target, side_effect=OSError("simulated disk failure")), pytest.raises(OSError):
        _write(settings_path, {"next": True})
    assert settings_path.read_text(encoding="utf8") == '{"previous":true}'
    assert list(settings_path.parent.iterdir()) == [settings_path]
