import re
import tomllib
from pathlib import Path

from fastapi.testclient import TestClient

from backend.app.main import app


def test_api_image_installs_pinned_openfoam_settings_writer():
    root = Path(__file__).resolve().parents[1]
    dockerfile = (root / 'Dockerfile').read_text()
    assert re.search(r'RUN\s+uv\s+sync\b[^\n]*--extra\s+cfd\b', dockerfile)
    config = tomllib.loads((root / 'pyproject.toml').read_text())
    assert any(requirement.startswith('foamlib==') for requirement in config['project']['optional-dependencies']['cfd'])


def test_public_catalogue_mutations_are_blocked_even_with_flag(monkeypatch):
    monkeypatch.setenv("RENOVATION_FIT_PUBLIC", "true")
    monkeypatch.setenv("ENABLE_PROGRAMMER_TOOLS", "true")
    client = TestClient(app)
    for method, path in [
        ("put", "/settings"),
        ("post", "/catalog/items"),
        ("put", "/catalog/items/example"),
        ("delete", "/catalog/items/example"),
        ("patch", "/catalog/categories/example"),
        ("post", "/catalog/import-website"),
    ]:
        assert client.request(method, path, json={}).status_code == 403
    assert client.get("/health").status_code == 200
    assert client.get("/catalog/categories").status_code == 200
    assert client.get("/settings").status_code == 200
    assert client.post("/projects", json={}).status_code == 404
    assert client.post("/cad/generate", json={}).status_code == 404


def test_programmer_flag_is_required_and_loopback_only(monkeypatch):
    monkeypatch.delenv("ENABLE_PROGRAMMER_TOOLS")
    assert TestClient(app).put("/settings", json={}).status_code == 403
    monkeypatch.setenv("ENABLE_PROGRAMMER_TOOLS", "true")
    assert TestClient(app, client=("203.0.113.5", 1234)).put("/settings", json={}).status_code == 403


def test_private_routes_default_to_closed_and_cannot_use_a_remote_forwarded_origin(monkeypatch):
    monkeypatch.delenv("RENOVATION_FIT_PUBLIC")
    monkeypatch.setenv("ENABLE_PROGRAMMER_TOOLS", "true")
    client = TestClient(app)
    for path in ("/docs", "/openapi.json", "/redoc", "/rooms", "/projects"):
        assert client.get(path).status_code == 404
    assert client.put("/settings", json={}).status_code == 403
    private_response = client.get("/commercial/projects")
    assert private_response.status_code == 401
    assert private_response.headers["Cache-Control"] == "private, no-store"
    monkeypatch.setenv("RENOVATION_FIT_PUBLIC", "false")
    assert client.put("/settings", json={}, headers={"X-Forwarded-For": "203.0.113.8"}).status_code == 403
    assert client.put("/settings", json={}, headers={"Origin": "https://other.example"}).status_code == 403
