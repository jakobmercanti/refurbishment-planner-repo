"""Dedicated authenticated single-runner service; never mounted in the public API."""

from __future__ import annotations

import hashlib
import json
import logging
import math
import os
import shutil
import sqlite3
import threading
import time
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Annotated
from uuid import UUID, uuid4

from fastapi import Depends, FastAPI, Header, HTTPException, Query
from fastapi.responses import FileResponse, JSONResponse
from starlette.requests import Request

from backend.app.cfd_slice_service import SliceRequest, inventory, slice_data, view_root
from backend.app.openfoam_case import LIMITS, Submission, validate_submission
from backend.app.openfoam_runtime import JobCancelled, execute, runtime_available
from backend.app.openfoam_telemetry import telemetry
from backend.app.supabase_rest import InvalidAccessToken, SupabaseREST, SupabaseUnavailable, VerifiedUser

TERMINAL = ("Completed", "Failed", "Cancelled", "Stale")
ACTIVE_SQL = "('Queued','Meshing','MeshCheck','Running','Postprocess')"
MAX_BODY = 4 * 1024**2
logger = logging.getLogger(__name__)


def finite_json_number(value: str) -> float:
    number = float(value)
    if not math.isfinite(number):
        raise ValueError("Non-finite JSON number")
    return number


class Store:
    def __init__(self, root: Path):
        self.root = root.resolve()
        self.root.mkdir(parents=True, exist_ok=True)
        with self.connect() as db:
            db.executescript("""
                PRAGMA journal_mode=WAL;
                CREATE TABLE IF NOT EXISTS jobs (
                    id TEXT PRIMARY KEY, owner TEXT NOT NULL, submission TEXT NOT NULL,
                    digest TEXT NOT NULL, payload TEXT NOT NULL, project TEXT NOT NULL,
                    study TEXT NOT NULL, revision TEXT NOT NULL, phase TEXT NOT NULL,
                    message TEXT NOT NULL DEFAULT '', cancelled INTEGER NOT NULL DEFAULT 0,
                    created REAL NOT NULL, updated REAL NOT NULL, expires REAL NOT NULL,
                    UNIQUE(owner,submission)
                );
                CREATE INDEX IF NOT EXISTS jobs_owner ON jobs(owner,created);
            """)

    def connect(self):
        db = sqlite3.connect(self.root / "jobs.sqlite3", timeout=10)
        db.row_factory = sqlite3.Row
        return db

    def get(self, owner: str, job_id: str):
        with self.connect() as db:
            row = db.execute("SELECT * FROM jobs WHERE owner=? AND id=?", (owner, job_id)).fetchone()
        if row is None:
            raise HTTPException(404, "Job not found or expired.")
        return row

    def path(self, job_id: str) -> Path:
        return self.root / str(UUID(job_id))

    def submit(self, owner: str, request: Submission):
        payload = request.model_dump_json()
        digest = hashlib.sha256(
            json.dumps(json.loads(payload), sort_keys=True, separators=(",", ":")).encode()
        ).hexdigest()
        with self.connect() as db:
            db.execute("BEGIN IMMEDIATE")
            existing = db.execute(
                "SELECT * FROM jobs WHERE owner=? AND submission=?", (owner, str(request.submissionId))
            ).fetchone()
            if existing:
                if existing["digest"] != digest:
                    raise HTTPException(409, "This submission ID already belongs to different immutable input.")
                return existing
            if db.execute(f"SELECT count(*) FROM jobs WHERE owner=? AND phase IN {ACTIVE_SQL}", (owner,)).fetchone()[0]:
                raise HTTPException(409, "This account already has an active job. Wait or cancel it first.")
            if db.execute(f"SELECT count(*) FROM jobs WHERE phase IN {ACTIVE_SQL}").fetchone()[0] >= 4:
                raise HTTPException(429, "The bounded worker queue is full.")
            if (
                db.execute(
                    "SELECT count(*) FROM jobs WHERE owner=? AND created>?", (owner, time.time() - 86400)
                ).fetchone()[0]
                >= 20
            ):
                raise HTTPException(429, "Initial worker limit: 20 submissions per account per day.")
            if sum(p.stat().st_size for p in self.root.rglob("*") if p.is_file()) > 3 * 1000**3:
                raise HTTPException(507, "Worker storage is full. Wait for automatic retention cleanup.")
            # Recheck AFTER idempotent lookup so a retry returns its accepted job.
            validate_submission(request)
            job_id, now = str(uuid4()), time.time()
            db.execute(
                "INSERT INTO jobs VALUES (?,?,?,?,?,?,?,?,?,?,0,?,?,?)",
                (
                    job_id,
                    owner,
                    str(request.submissionId),
                    digest,
                    payload,
                    request.project["projectId"],
                    request.studyId,
                    request.clientRevision,
                    "Queued",
                    "Waiting for the single worker",
                    now,
                    now,
                    now + request.scenario.resources.retentionDays * 86400,
                ),
            )
        return self.get(owner, job_id)

    def update(self, job_id: str, phase: str, message: str):
        with self.connect() as db:
            db.execute(
                "UPDATE jobs SET phase=?, message=?, updated=? WHERE id=?", (phase, message[:2000], time.time(), job_id)
            )

    def cancelled(self, job_id: str) -> bool:
        with self.connect() as db:
            row = db.execute("SELECT cancelled FROM jobs WHERE id=?", (job_id,)).fetchone()
            return not row or bool(row[0])

    def recover(self):
        with self.connect() as db:
            db.execute(
                "UPDATE jobs SET phase='Failed', message='Worker restarted; incomplete execution was not resumed.', "
                "updated=? WHERE phase NOT IN ('Queued','Completed','Failed','Cancelled','Stale')",
                (time.time(),),
            )

    def cleanup(self):
        with self.connect() as db:
            expired = db.execute(
                "SELECT id FROM jobs WHERE expires<? AND payload<>'' "
                "AND phase IN ('Completed','Failed','Cancelled','Stale')",
                (time.time(),),
            ).fetchall()
            for row in expired:
                target = self.path(row["id"])
                if target.parent == self.root and target.exists() and not target.is_symlink():
                    shutil.rmtree(target)
                views = view_root(target)
                if views.parent == self.root / "slice-views" and views.exists() and not views.is_symlink():
                    shutil.rmtree(views)
                # Keep a small idempotency tombstone; a late retry must never
                # charge for a second execution after its artifacts expire.
                db.execute(
                    "UPDATE jobs SET payload='', phase='Stale', "
                    "message='Artifacts expired; this submission will not run again.' WHERE id=?",
                    (row["id"],),
                )


def public_job(row, root: Path | None = None) -> dict:
    from backend.app.openfoam_progress import phase_progress
    return {
        "id": row["id"],
        "studyId": row["study"],
        "clientRevision": row["revision"],
        "phase": row["phase"],
        "projectId": row["project"],
        "createdAt": row["created"],
        "name": json.loads(row["payload"])["scenario"]["name"] if row["payload"] else row["study"],
        **phase_progress(root, row["phase"], row["message"], row["payload"]),
        "message": row["message"],
    }


def authenticate(authorization: str | None = Header(default=None)) -> VerifiedUser:
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(401, "Sign in to use the CFD worker.")
    try:
        user = SupabaseREST().verify_user(authorization[7:], require_confirmed_email=True)
    except InvalidAccessToken:
        raise HTTPException(401, "Sign in again to continue.") from None
    except PermissionError:
        raise HTTPException(403, "Verify your account email first.") from None
    except SupabaseUnavailable:
        raise HTTPException(503, "Account verification is unavailable.") from None
    allowed = os.environ.get("CFD_ALLOWED_EMAIL", "").strip().casefold()
    if not user.email_confirmed or not allowed or (user.email or "").casefold() != allowed:
        raise HTTPException(403, "This account is not enabled for the initial CFD worker.")
    return user


WorkerUser = Annotated[VerifiedUser, Depends(authenticate)]


def create_app(root: Path | None = None, *, start_runner: bool = True) -> FastAPI:
    store = Store(root or Path(os.environ.get("CFD_DATA_ROOT", "/data/cfd")))
    stop = threading.Event()
    state = {"ready": False, "reason": "OpenFOAM runtime acceptance is pending."}

    def run_queue():
        try:
            store.recover()
            if not runtime_available():
                raise ValueError("The pinned OpenCFD v2312 runtime is unavailable.")
            from backend.app.openfoam_smoke import acceptance

            acceptance(store.root / "acceptance", stop.is_set)
            state.update(
                ready=True,
                reason=(
                    "OpenCFD v2312: steady isothermal SIMPLE; one serial job, max 4 GB / 15 minutes. "
                    "Parallel execution is not enabled."
                ),
            )
            while not stop.is_set():
                store.cleanup()
                with store.connect() as db:
                    row = db.execute("SELECT * FROM jobs WHERE phase='Queued' ORDER BY created LIMIT 1").fetchone()
                if not row:
                    stop.wait(1)
                    continue
                job_id = row["id"]
                if store.cancelled(job_id):
                    store.update(job_id, "Cancelled", "Cancelled before execution.")
                    continue
                try:
                    submission = Submission.model_validate_json(row["payload"])
                    report = validate_submission(submission)
                    result = execute(
                        store.path(job_id),
                        submission,
                        report,
                        lambda phase, message, jid=job_id: store.update(jid, phase, message),
                        lambda jid=job_id: stop.is_set() or store.cancelled(jid),
                    )
                    if store.cancelled(job_id) or stop.is_set():
                        raise JobCancelled("Cancelled before final acceptance.")
                    store.update(
                        job_id,
                        "Completed" if result["accepted"] else "Failed",
                        "Checked mesh completed."
                        if submission.operation == "mesh"
                        else "Solve converged and conservation checks passed."
                        if result["accepted"]
                        else "Solver finished but convergence/conservation checks failed. Inspect diagnostics.",
                    )
                except JobCancelled as error:
                    store.update(job_id, "Cancelled", str(error))
                except Exception as error:
                    logger.exception("CFD job %s failed", job_id)
                    store.update(job_id, "Failed", str(error)[:2000])
        except Exception:
            logger.exception("OpenFOAM acceptance/runner failed")
            store.recover()
            state.update(
                ready=False,
                reason="Worker runtime acceptance failed. Execution is disabled; administrator action required.",
            )

    @asynccontextmanager
    async def lifespan(app):
        # Volume-backed flock prevents two processes from running the same queue.
        lock = None
        if start_runner:
            import fcntl

            lock = (store.root / "runner.lock").open("w")
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
            thread = threading.Thread(target=run_queue, daemon=True, name="openfoam-single-runner")
            thread.start()
        yield
        stop.set()
        if start_runner:
            thread.join(timeout=10)
            lock.close()

    app = FastAPI(title="Climoptix OpenFOAM worker", docs_url=None, redoc_url=None, openapi_url=None, lifespan=lifespan)
    app.state.store, app.state.worker = store, state

    @app.middleware("http")
    async def bounded_json(request: Request, call_next):
        if request.method == "POST":
            if request.headers.get("content-type", "").split(";")[0] != "application/json":
                return JSONResponse({"detail": "JSON required."}, status_code=415)
            data = bytearray()
            async for chunk in request.stream():
                data.extend(chunk)
                if len(data) > MAX_BODY:
                    return JSONResponse({"detail": "Request exceeds 4 MB."}, status_code=413)
            try:
                parsed = json.loads(data or b"{}", parse_float=finite_json_number, parse_constant=finite_json_number)
                stack = [(parsed, 0)]
                nodes = 0
                while stack:
                    value, depth = stack.pop()
                    nodes += 1
                    if depth > 50 or nodes > 200000 or len(stack) > 200000:
                        raise ValueError("JSON nesting/node bound exceeded")
                    children = value.values() if isinstance(value, dict) else value if isinstance(value, list) else ()
                    stack.extend((child, depth + 1) for child in children)
            except (ValueError, UnicodeDecodeError, RecursionError):
                return JSONResponse({"detail": "Finite JSON required."}, status_code=422)
            request._body = bytes(data or b"{}")
        response = await call_next(request)
        response.headers["Cache-Control"] = "no-store"
        response.headers["X-Content-Type-Options"] = "nosniff"
        return response

    @app.get("/health")
    def health():
        return {"status": "ok", "executionReady": state["ready"]}

    prefix = "/climoptix/worker"

    @app.get(prefix + "/capabilities")
    def capabilities(user: WorkerUser):
        return {
            "connected": True,
            "mesh": state["ready"],
            "run": state["ready"],
            "reason": state["reason"],
            "namespace": str(user.id),
            "limits": LIMITS,
        }

    @app.post(prefix + "/jobs")
    def submit(body: Submission, user: WorkerUser):
        if not state["ready"]:
            raise HTTPException(503, state["reason"])
        try:
            row = store.submit(str(user.id), body)
            return public_job(row, store.path(row["id"]))
        except ValueError as error:
            raise HTTPException(422, str(error)[:2000]) from None

    @app.get(prefix + "/jobs")
    def jobs(projectId: UUID, user: WorkerUser):
        with store.connect() as db:
            rows = db.execute(
                "SELECT * FROM jobs WHERE owner=? AND project=? ORDER BY created DESC LIMIT 100",
                (str(user.id), str(projectId)),
            ).fetchall()
        return [public_job(row, store.path(row["id"])) for row in rows]

    @app.get(prefix + "/jobs/{job_id}")
    def status(job_id: UUID, user: WorkerUser):
        return public_job(store.get(str(user.id), str(job_id)), store.path(str(job_id)))

    @app.post(prefix + "/jobs/{job_id}/cancel")
    def cancel(job_id: UUID, user: WorkerUser):
        row = store.get(str(user.id), str(job_id))
        if row["phase"] not in TERMINAL:
            with store.connect() as db:
                db.execute("UPDATE jobs SET cancelled=1 WHERE id=? AND owner=?", (str(job_id), str(user.id)))
            if row["phase"] == "Queued":
                store.update(str(job_id), "Cancelled", "Cancelled before execution.")
        return public_job(store.get(str(user.id), str(job_id)), store.path(str(job_id)))

    @app.get(prefix + "/jobs/{job_id}/logs")
    def logs(job_id: UUID, user: WorkerUser, cursor: int = Query(default=0, ge=0, le=8 * 1024**2)):
        row = store.get(str(user.id), str(job_id))
        path = store.path(str(job_id)) / "solver.log"
        size = min(path.stat().st_size, 8 * 1024**2) if path.exists() else 0
        if cursor > size:
            raise HTTPException(409, "Log cursor is no longer valid.")
        data = b""
        if size:
            with path.open("rb") as stream:
                stream.seek(cursor)
                data = stream.read(min(128 * 1024, size - cursor))
        return {
            **public_job(row, store.path(str(job_id))),
            "cursor": cursor,
            "nextCursor": cursor + len(data),
            "text": data.decode("utf-8", errors="replace"),
            "telemetry": telemetry(store.path(str(job_id))),
        }

    @app.get(prefix + "/jobs/{job_id}/result")
    def result(job_id: UUID, user: WorkerUser):
        row = store.get(str(user.id), str(job_id))
        path = store.path(str(job_id)) / "result.json"
        if row["phase"] not in TERMINAL or not path.is_file():
            raise HTTPException(409, "No finalized result manifest is available.")
        manifest = json.loads(path.read_text())
        for artifact in manifest.get("artifacts", []):
            artifact.pop("path", None)
        return {**manifest, "jobId": str(job_id), "expiresAt": row["expires"]}

    @app.get(prefix + "/jobs/{job_id}/slices")
    def slices(job_id: UUID, projectId: UUID, user: WorkerUser):
        row = store.get(str(user.id), str(job_id))
        if row["project"] != str(projectId):
            raise HTTPException(404, "Run not found in this project.")
        try:
            return inventory(store.path(str(job_id)), row)
        except (ValueError, OSError, KeyError) as error:
            raise HTTPException(422, f"Cannot read retained slice inventory: {str(error)[:500]}") from None

    @app.post(prefix + "/slice-data")
    def sample_slices(body: SliceRequest, user: WorkerUser):
        return slice_data(store, str(user.id), body)

    @app.get(prefix + "/jobs/{job_id}/artifacts/{artifact_id}")
    def artifact(job_id: UUID, artifact_id: str, user: WorkerUser):
        row = store.get(str(user.id), str(job_id))
        root = store.path(str(job_id))
        if row["phase"] not in TERMINAL or not (root / "result.json").is_file():
            raise HTTPException(404, "Artifact not found.")
        manifest = json.loads((root / "result.json").read_text())
        item = next((a for a in manifest.get("artifacts", []) if a["id"] == artifact_id), None)
        if not item:
            raise HTTPException(404, "Artifact not found.")
        path = (root / item["path"]).resolve()
        if (
            not path.is_relative_to(root)
            or path.is_symlink()
            or not path.is_file()
            or path.stat().st_size != item["size"]
        ):
            raise HTTPException(409, "Artifact integrity check failed.")
        if hashlib.sha256(path.read_bytes()).hexdigest() != item["sha256"]:
            raise HTTPException(409, "Artifact integrity check failed.")
        return FileResponse(
            path,
            filename=artifact_id + (".zip" if item["kind"] == "zip" else ".vtk"),
            media_type="application/zip" if item["kind"] == "zip" else "application/octet-stream",
        )

    return app


def factory():
    return create_app()
