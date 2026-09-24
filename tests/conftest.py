import pytest


@pytest.fixture(autouse=True)
def local_programmer_environment(monkeypatch):
    """Existing catalogue tests exercise the explicit local programmer mode."""
    monkeypatch.setenv("ENABLE_PROGRAMMER_TOOLS", "true")
    monkeypatch.setenv("RENOVATION_FIT_PUBLIC", "false")
