"""Stateless replacement-API checks; no login, payment, saved project or CFD job."""
from __future__ import annotations

import argparse
import io
import json
from zipfile import ZipFile

import httpx

from backend.app.openfoam_smoke import fixture


def check_api(base: str) -> dict:
    checks: dict[str, object] = {}
    with httpx.Client(base_url=base.rstrip("/"), timeout=45, follow_redirects=False) as client:
        def get(path: str, status: int = 200):
            response = client.get(path)
            assert response.status_code == status, f"{path}: HTTP {response.status_code}, expected {status}"
            checks[path] = status
            return response

        assert get("/health").json()["status"] == "ok"
        categories = get("/catalog/categories").json()
        assert isinstance(categories, list) and categories, "Catalogue categories are missing"
        checks["catalogueCategories"] = len(categories)
        get("/settings")
        get("/climoptix/capabilities")
        catalogue = get("/commercial/catalogue").json()
        checks["commercialCatalogueAvailable"] = bool(catalogue)
        get("/commercial/summary", 401)
        get("/commercial/projects", 401)
        get("/projects", 404)
        response = client.post("/catalog/items", json={})
        assert response.status_code == 403, "Public catalogue mutations must be blocked"
        checks["publicMutationBlocked"] = True

        request = fixture()
        body = {"project": request.project, "scenario": request.scenario.model_dump(mode="json"), "clientRevision": request.clientRevision}
        response = client.post("/climoptix/default-setup", json=body)
        assert response.status_code == 200, f"Default setup: HTTP {response.status_code}"
        scenario = response.json()
        assert len(scenario["vents"]) == 2 and scenario["resources"]["cpu"] == 1
        body["scenario"] = scenario
        response = client.post("/climoptix/prepare", json=body)
        assert response.status_code == 200, f"Preparation: HTTP {response.status_code}"
        report = response.json()
        assert report["validation"]["errors"] == 0 and report["surface"]["exportable"]
        checks["defaultSetupAndGeometry"] = "passed"
        response = client.post("/climoptix/thermal-envelope", json=body)
        assert response.status_code == 200, f"Thermal envelope: HTTP {response.status_code}"
        checks["thermalEnvelopePreparation"] = "passed"
        response = client.post("/climoptix/openfoam-settings", json=body)
        assert response.status_code == 200, f"Settings export: HTTP {response.status_code}"
        with ZipFile(io.BytesIO(response.content)) as archive:
            assert archive.namelist() and archive.testzip() is None
            checks["settingsZipFiles"] = len(archive.namelist())
        response = client.post("/climoptix/default-setup", content='{"value":1e999}', headers={"Content-Type": "application/json"})
        assert response.status_code == 422, "Non-finite inputs must be rejected"
        checks["nonFiniteInputRejected"] = True
    return checks


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("url", help="API origin; use the replacement Railway domain before cutover")
    args = parser.parse_args()
    print(json.dumps(check_api(args.url), indent=2))
