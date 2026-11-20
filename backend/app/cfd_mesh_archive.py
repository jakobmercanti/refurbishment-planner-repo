"""Bounded, temporary inspection of an authenticated client's retained case ZIP.

This compatibility adapter never runs or modifies a case. Raw files live only
in a temporary directory while the existing native mesh parser reads them.
"""
import hashlib
import io
import json
import secrets
import threading
import time
from collections import OrderedDict
from pathlib import Path
from tempfile import TemporaryDirectory
from uuid import UUID
from zipfile import BadZipFile, ZipFile

import anyio
from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import Response
from pydantic import BaseModel, ConfigDict, Field

from backend.app.cfd_mesh_inspection import (
    FILES,
    MAX_SOURCE,
    VolumeMesh,
    geometry_bytes,
    inspection_response,
    mesh_revision,
)

router = APIRouter(prefix="/mesh-archives", tags=["Climoptix preparation"])
_lock = threading.Lock()
_slots = threading.BoundedSemaphore(1)
_meshes: OrderedDict[str, tuple[float, dict, VolumeMesh]] = OrderedDict()


class ArchiveSource(BaseModel):
    model_config = ConfigDict(extra="forbid")
    projectId: UUID
    jobId: UUID
    studyId: str = Field(min_length=1, max_length=200)
    clientRevision: str = Field(pattern=r"^[a-f0-9]{64}$")
    sourceHash: str = Field(pattern=r"^[a-f0-9]{64}$")
    configurationHash: str = Field(pattern=r"^[a-f0-9]{64}$")
    sha256: str = Field(pattern=r"^[a-f0-9]{64}$")


def read_archive(data: bytes, source: ArchiveSource) -> tuple[dict, VolumeMesh]:
    if len(data) > 32 * 1024**2 or hashlib.sha256(data).hexdigest() != source.sha256:
        raise ValueError("The retained archive failed its size or checksum check.")
    with ZipFile(io.BytesIO(data)) as archive, TemporaryDirectory(prefix="cfd-inspection-") as directory:
        entries = archive.infolist()
        if len(entries) > 5000 or len({item.filename for item in entries}) != len(entries):
            raise ValueError("Invalid native archive directory.")
        wanted = {"result.json", *("constant/polyMesh/" + name for name in FILES)}
        selected = {item.filename: item for item in entries if item.filename in wanted}
        if set(selected) != wanted or sum(item.file_size for item in selected.values()) > MAX_SOURCE:
            raise ValueError("The archive has no complete, bounded final volume mesh.")
        if selected["result.json"].file_size > 1024**2:
            raise ValueError("Oversized mesh check record.")
        if any(item.flag_bits & 1 for item in selected.values()):
            raise ValueError("Encrypted native archives are unsupported.")
        proof = json.loads(archive.read(selected["result.json"]))
        if not isinstance(proof, dict) or not isinstance(proof.get("mesh"), dict):
            raise ValueError("Invalid checked mesh record.")
        if proof.get("accepted") is not True or any(proof.get(key) != getattr(source, key)
                for key in ("studyId", "clientRevision", "sourceHash", "configurationHash")):
            raise ValueError("The retained mesh does not match this checked job.")
        root = Path(directory)
        for name in FILES:
            path = root / "constant" / "polyMesh" / name
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_bytes(archive.read(selected["constant/polyMesh/" + name]))
        mesh = VolumeMesh(root)
        if proof.get("mesh", {}).get("cells") != mesh.cells:
            raise ValueError("Native cell count differs from the checked job.")
        metadata = {"schemaVersion": 1, "meshId": mesh_revision(root), "jobId": str(source.jobId),
            "projectId": str(source.projectId), "studyId": source.studyId, "clientRevision": source.clientRevision,
            "units": "mm", "cells": mesh.cells, "faces": len(mesh.owner), "points": len(mesh.points),
            "boundsMm": mesh.bounds.tolist(), "patches": mesh.patches, "regions": ["defaultRegion"],
            "expiresAt": time.time() + 600, "representation": "Final checked polyMesh from verified native archive"}
        return metadata, mesh


@router.post("")
async def upload(request: Request) -> dict:
    if request.headers.get("content-type", "").split(";")[0] != "application/zip":
        raise HTTPException(415, "Choose a native case ZIP.")
    try:
        source = ArchiveSource.model_validate(dict(request.query_params))
    except ValueError as error:
        raise HTTPException(422, "Invalid mesh source metadata.") from error
    data = await request.body()
    if len(data) > 32 * 1024**2:
        raise HTTPException(413, "Retained mesh archive exceeds 32 MB.")
    if not _slots.acquire(blocking=False):
        raise HTTPException(429, "Mesh inspection is busy. Retry shortly.")
    try:
        metadata, mesh = await anyio.to_thread.run_sync(lambda: read_archive(data, source))
        token = secrets.token_urlsafe(32)
        with _lock:
            now = time.time()
            for key in list(_meshes):
                if _meshes[key][0] <= now:
                    del _meshes[key]
            _meshes[token] = (metadata["expiresAt"], metadata, mesh)
            while len(_meshes) > 2:
                _meshes.popitem(last=False)
        return {"token": token, "metadata": metadata}
    except (ValueError, OSError, KeyError, BadZipFile, NotImplementedError) as error:
        raise HTTPException(422, "Cannot inspect this retained mesh: " + str(error)[:300]) from None
    finally:
        _slots.release()


@router.get("/{token}")
async def geometry(request: Request, token: str, meshId: str, axis: str | None = None,
                   coordinateMm: float | None = None) -> Response:
    with _lock:
        entry = _meshes.get(token)
        if entry is None or entry[0] <= time.time():
            _meshes.pop(token, None)
            raise HTTPException(410, "Temporary mesh inspection expired. Retry mesh to reload it.")
        _meshes.move_to_end(token)
    if meshId != entry[1]["meshId"]:
        raise HTTPException(409, "Mesh revision changed.")
    if axis is not None and (axis not in ("X", "Y", "Z") or coordinateMm is None
            or not -1e9 <= coordinateMm <= 1e9):
        raise HTTPException(422, "Choose a valid mesh section.")
    if axis is None and coordinateMm is not None:
        raise HTTPException(422, "A mesh section needs an axis.")
    def compute(cancelled):
        if not _slots.acquire(blocking=False):
            raise HTTPException(429, "Mesh inspection is busy. Retry shortly.")
        try:
            mesh = entry[2]
            value = (mesh.surface(cancelled) if axis is None
                     else mesh.section("XYZ".index(axis), coordinateMm, cancelled))
            return geometry_bytes(meshId, value, axis=axis, coordinate=coordinateMm)
        except ValueError as error:
            raise HTTPException(422, str(error)[:300]) from None
        finally:
            _slots.release()
    data = await inspection_response(request, compute)
    return Response(data, media_type="application/octet-stream", headers={"Cache-Control": "no-store"})
