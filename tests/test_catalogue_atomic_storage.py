"""Catalogue swaps retry only Windows sharing failures and retain rollback data."""

import os
from pathlib import Path
from unittest.mock import Mock

import pytest

from database.catalogue_assets import _replace_with_retry, stage_item_picture_replacement


def windows_lock() -> PermissionError:
    error = PermissionError("simulated Windows sharing lock")
    error.winerror = 5
    return error


def test_catalogue_swap_retries_transient_windows_lock_then_succeeds(tmp_path, monkeypatch) -> None:
    monkeypatch.setenv("RENOVATION_FIT_DATABASE", str(tmp_path / "catalogue.sqlite3"))
    original_replace = os.replace
    attempts = 0

    def replace(source: Path, target: Path) -> None:
        nonlocal attempts
        if source.is_dir() and source.name.endswith(".tmp"):
            attempts += 1
            if attempts < 3:
                raise windows_lock()
        original_replace(source, target)

    sleep = Mock()
    monkeypatch.setattr("database.catalogue_assets.os.replace", replace)
    monkeypatch.setattr("database.catalogue_assets.time.sleep", sleep)
    staged = stage_item_picture_replacement("item", [(b"new", "image/png", "png", "Preview")])
    assert (staged.target / "0.png").read_bytes() == b"new"
    assert attempts == 3
    assert sleep.call_count == 2


def test_permanent_catalogue_swap_failure_restores_previous_picture(tmp_path, monkeypatch) -> None:
    monkeypatch.setenv("RENOVATION_FIT_DATABASE", str(tmp_path / "catalogue.sqlite3"))
    target = tmp_path / "catalogue-assets" / "item"
    target.mkdir(parents=True)
    (target / "0.png").write_bytes(b"previous")
    original_replace = os.replace
    attempts = 0

    def replace(source: Path, destination: Path) -> None:
        nonlocal attempts
        if source.is_dir() and source.name.endswith(".tmp"):
            attempts += 1
            raise windows_lock()
        original_replace(source, destination)

    monkeypatch.setattr("database.catalogue_assets.os.replace", replace)
    monkeypatch.setattr("database.catalogue_assets.time.sleep", Mock())
    with pytest.raises(PermissionError):
        stage_item_picture_replacement("item", [(b"new", "image/png", "png", "Preview")])
    assert attempts == 4
    assert (target / "0.png").read_bytes() == b"previous"
    assert list(target.parent.iterdir()) == [target]


def test_non_windows_permission_error_is_not_retried(monkeypatch) -> None:
    replace, sleep = Mock(side_effect=PermissionError("not a sharing lock")), Mock()
    monkeypatch.setattr("database.catalogue_assets.os.replace", replace)
    monkeypatch.setattr("database.catalogue_assets.time.sleep", sleep)
    with pytest.raises(PermissionError):
        _replace_with_retry(Path("source"), Path("target"))
    replace.assert_called_once()
    sleep.assert_not_called()
