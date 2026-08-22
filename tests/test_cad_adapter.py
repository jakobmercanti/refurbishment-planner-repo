from __future__ import annotations

from pathlib import Path

import pytest

from cad.generator import FreeCADGenerationError, find_freecad_cmd


def test_missing_freecad_fails_instead_of_creating_placeholder(tmp_path: Path) -> None:
    missing = tmp_path / "FreeCADCmd-does-not-exist"
    with pytest.raises(FreeCADGenerationError, match="was not found"):
        find_freecad_cmd(missing)


def test_installed_freecad_is_discoverable() -> None:
    expected = Path(r"C:\Program Files\FreeCAD 26.3\bin\freecadcmd.exe")
    if not expected.is_file():
        pytest.skip("FreeCAD 26.3 is not installed on this host")
    assert find_freecad_cmd(expected) == expected.resolve()
