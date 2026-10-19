from __future__ import annotations

import subprocess
from pathlib import Path
from unittest.mock import patch

import pytest

from cad.generator import FreeCADGenerationError, find_freecad_cmd, generate_cad
from geometry.fixtures import build_l_shaped_fixture


def test_missing_freecad_fails_instead_of_creating_placeholder(tmp_path: Path) -> None:
    missing = tmp_path / "FreeCADCmd-does-not-exist"
    with pytest.raises(FreeCADGenerationError, match="was not found"):
        find_freecad_cmd(missing)


def test_installed_freecad_is_discoverable() -> None:
    expected = Path(r"C:\Program Files\FreeCAD 26.3\bin\freecadcmd.exe")
    if not expected.is_file():
        pytest.skip("FreeCAD 26.3 is not installed on this host")
    assert find_freecad_cmd(expected) == expected.resolve()


def test_success_without_new_cad_output_cannot_return_a_stale_file(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr("cad.generator.os.environ", {})
    output = tmp_path / "room.FCStd"
    output.write_bytes(b"previous valid document")
    fixture = build_l_shaped_fixture()
    with (
        patch("cad.generator.find_freecad_cmd", return_value=Path("FreeCADCmd")),
        patch("cad.generator.subprocess.run", return_value=subprocess.CompletedProcess([], 0, "", "")),
        pytest.raises(FreeCADGenerationError, match="failed"),
    ):
        generate_cad(fixture.room, fixture.product, fixture.placements["FIT"], output)
    assert output.read_bytes() == b"previous valid document"


@pytest.mark.parametrize("exit_code", [0, 1])
def test_new_cad_replaces_previous_output_only_on_success(
    tmp_path: Path, exit_code: int, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr("cad.generator.os.environ", {})
    output = tmp_path / "room.FCStd"
    output.write_bytes(b"previous valid document")
    fixture = build_l_shaped_fixture()

    def run_worker(*args: object, **kwargs: object) -> subprocess.CompletedProcess[str]:
        environment = kwargs["env"]
        assert isinstance(environment, dict)
        Path(environment["RENOVATION_FIT_OUTPUT"]).write_bytes(b"new generated document")
        return subprocess.CompletedProcess([], exit_code, "", "worker failure" if exit_code else "")

    with (
        patch("cad.generator.find_freecad_cmd", return_value=Path("FreeCADCmd")),
        patch("cad.generator.subprocess.run", side_effect=run_worker),
    ):
        if exit_code:
            with pytest.raises(FreeCADGenerationError, match="worker failure"):
                generate_cad(fixture.room, fixture.product, fixture.placements["FIT"], output)
        else:
            assert generate_cad(fixture.room, fixture.product, fixture.placements["FIT"], output) == output
    assert output.read_bytes() == (b"new generated document" if not exit_code else b"previous valid document")
    assert list(tmp_path.iterdir()) == [output]


def test_cad_timeout_is_a_safe_generation_error(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr("cad.generator.os.environ", {})
    output = tmp_path / "room.FCStd"
    output.write_bytes(b"previous valid document")
    fixture = build_l_shaped_fixture()
    with (
        patch("cad.generator.find_freecad_cmd", return_value=Path("FreeCADCmd")),
        patch("cad.generator.subprocess.run", side_effect=subprocess.TimeoutExpired("FreeCADCmd", 120)),
        pytest.raises(FreeCADGenerationError, match="timed out"),
    ):
        generate_cad(fixture.room, fixture.product, fixture.placements["FIT"], output)
    assert output.read_bytes() == b"previous valid document"


@pytest.mark.parametrize("failure", ["empty", "launch", "replace"])
def test_cad_failed_output_never_overwrites_previous_document(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, failure: str
) -> None:
    monkeypatch.setattr("cad.generator.os.environ", {})
    output = tmp_path / "room.FCStd"
    output.write_bytes(b"previous valid document")
    fixture = build_l_shaped_fixture()

    def run_worker(*args: object, **kwargs: object) -> subprocess.CompletedProcess[str]:
        if failure == "launch":
            raise OSError("cannot launch")
        environment = kwargs["env"]
        assert isinstance(environment, dict)
        Path(environment["RENOVATION_FIT_OUTPUT"]).write_bytes(b"" if failure == "empty" else b"new document")
        return subprocess.CompletedProcess([], 0, "", "")

    original_replace = Path.replace

    def replace(path: Path, target: Path) -> Path:
        if failure == "replace":
            raise PermissionError("output locked")
        return original_replace(path, target)

    with (
        patch("cad.generator.find_freecad_cmd", return_value=Path("FreeCADCmd")),
        patch("cad.generator.subprocess.run", side_effect=run_worker),
        patch.object(Path, "replace", replace),
        pytest.raises(FreeCADGenerationError),
    ):
        generate_cad(fixture.room, fixture.product, fixture.placements["FIT"], output)
    assert output.read_bytes() == b"previous valid document"
    assert list(tmp_path.iterdir()) == [output]
