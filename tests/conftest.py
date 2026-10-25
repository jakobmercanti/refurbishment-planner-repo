import os
import socket
import sys
from http.client import HTTPConnection
from pathlib import Path
from tempfile import TemporaryDirectory

import pytest

_ISOLATED_ROOT = pytest.StashKey[Path]()


def pytest_configure(config: pytest.Config) -> None:
    """Configure storage before collection imports the application's database."""
    if "database.catalog" in sys.modules:
        raise pytest.UsageError("The catalogue must not be imported before test storage is isolated.")
    temporary = TemporaryDirectory(prefix="renovation-fit-tests-", ignore_cleanup_errors=True)
    root = Path(temporary.name)
    environment = pytest.MonkeyPatch()
    config.stash[_ISOLATED_ROOT] = root
    for name in tuple(os.environ):
        if (
            name.startswith(("SUPABASE_", "R2_", "STRIPE_", "TRIPO_", "NEXT_PUBLIC_SUPABASE_"))
            or name == "OPENAI_API_KEY"
        ):
            environment.delenv(name)
    environment.setenv("RENOVATION_FIT_DATABASE", str(root / "catalogue.sqlite3"))
    environment.setenv("RENOVATION_FIT_SETTINGS_FILE", str(root / "settings.json"))

    def cleanup() -> None:
        catalogue = sys.modules.get("database.catalog")
        if catalogue is not None:
            catalogue.ENGINE.dispose()
        environment.undo()
        temporary.cleanup()

    config.add_cleanup(cleanup)


@pytest.fixture(scope="session")
def isolated_app_root(pytestconfig: pytest.Config) -> Path:
    return pytestconfig.stash[_ISOLATED_ROOT]


@pytest.fixture(autouse=True)
def prevent_external_requests(monkeypatch: pytest.MonkeyPatch) -> None:
    def blocked(*args: object, **kwargs: object) -> None:
        pytest.fail("Tests must replace network transports; external requests are disabled.", pytrace=False)

    monkeypatch.setattr(socket, "create_connection", blocked)
    monkeypatch.setattr(HTTPConnection, "send", blocked)


@pytest.fixture(autouse=True)
def local_programmer_environment(monkeypatch):
    """Existing catalogue tests exercise the explicit local programmer mode."""
    monkeypatch.setenv("ENABLE_PROGRAMMER_TOOLS", "true")
    monkeypatch.setenv("RENOVATION_FIT_PUBLIC", "false")
