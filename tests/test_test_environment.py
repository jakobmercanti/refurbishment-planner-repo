"""The test harness must never use developer storage or live provider transports."""

from urllib.request import urlopen

import pytest

from database.catalog import ENGINE, database_path
from database.software_settings import software_settings_path


def test_application_storage_is_isolated_before_module_import(isolated_app_root) -> None:
    assert database_path() == isolated_app_root / "catalogue.sqlite3"
    assert ENGINE.url.database == str(database_path().as_posix())
    assert software_settings_path() == isolated_app_root / "settings.json"


def test_unmocked_provider_requests_fail_before_network_access() -> None:
    with pytest.raises(pytest.fail.Exception, match="external requests are disabled"):
        urlopen("https://example.invalid/no-real-request", timeout=1)
