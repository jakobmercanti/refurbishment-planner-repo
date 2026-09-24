from fastapi.testclient import TestClient

from backend.app.main import app


def test_public_catalogue_mutations_are_blocked_even_with_flag(monkeypatch):
    monkeypatch.setenv("RENOVATION_FIT_PUBLIC", "true")
    monkeypatch.setenv("ENABLE_PROGRAMMER_TOOLS", "true")
    client = TestClient(app)
    for method, path in [("put", "/settings"), ("post", "/catalog/items"), ("put", "/catalog/items/example"), ("delete", "/catalog/items/example"), ("patch", "/catalog/categories/example"), ("post", "/catalog/import-website")]:
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
